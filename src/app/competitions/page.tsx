"use client";

import { FormEvent, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

type CompetitionCategory = "PROFISSIONAL" | "BASE";

type Competition = {
  id: string;
  name: string;
  category: CompetitionCategory;
  season_year: number;
  url_base: string | null;
  is_active: boolean;
};

type FormState = {
  id: string | null;
  name: string;
  category: CompetitionCategory;
  season_year: string;
  url_base: string;
  is_active: boolean;
};

const DEFAULT_COMPETITION = {
  name: "Paranaense Sub-20 2026 - 1ª Divisão",
  category: "BASE" as CompetitionCategory,
  season_year: 2026,
  url_base: "https://federacaopr.com.br/competicoes/Estadual/2026/47",
  is_active: true,
};

const initialForm: FormState = {
  id: null,
  name: "",
  category: "BASE",
  season_year: String(new Date().getFullYear()),
  url_base: "",
  is_active: true,
};

export default function CompetitionsPage() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Competition[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);

  async function ensureDefaultCompetition() {
    const { data: existing, error: checkError } = await supabase
      .from("competitions_registry")
      .select("id")
      .eq("name", DEFAULT_COMPETITION.name)
      .eq("season_year", DEFAULT_COMPETITION.season_year)
      .maybeSingle<{ id: string }>();

    if (checkError) {
      throw new Error(checkError.message);
    }

    if (existing) return false;

    const { error: insertError } = await supabase.from("competitions_registry").insert(DEFAULT_COMPETITION);

    if (insertError) {
      throw new Error(insertError.message);
    }

    return true;
  }

  async function loadCompetitions() {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("competitions_registry")
      .select("id,name,category,season_year,url_base,is_active")
      .order("season_year", { ascending: false })
      .order("name", { ascending: true });

    if (queryError) {
      setError("Não foi possível carregar as competições.");
      setItems([]);
    } else {
      setItems((data as Competition[]) ?? []);
    }

    setLoading(false);
  }

  async function handleSeedDefault() {
    setSaving(true);

    try {
      const inserted = await ensureDefaultCompetition();
      await loadCompetitions();

      toast({
        title: inserted ? "Competição adicionada" : "Competição já existente",
        description: inserted
          ? "Competição padrão criada com sucesso."
          : "A competição padrão já estava cadastrada.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro ao adicionar competição padrão.";
      toast({ variant: "destructive", title: "Falha", description: message });
    }

    setSaving(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Validação", description: "Nome é obrigatório." });
      return;
    }

    const parsedSeason = Number(form.season_year);
    if (!Number.isFinite(parsedSeason) || parsedSeason < 2000) {
      toast({ variant: "destructive", title: "Validação", description: "Temporada inválida." });
      return;
    }

    setSaving(true);

    const payload = {
      name: form.name.trim(),
      category: form.category,
      season_year: parsedSeason,
      url_base: form.url_base.trim() || null,
      is_active: form.is_active,
    };

    const operation = form.id
      ? supabase.from("competitions_registry").update(payload).eq("id", form.id)
      : supabase.from("competitions_registry").insert(payload);

    const { error: mutationError } = await operation;

    if (mutationError) {
      toast({ variant: "destructive", title: "Falha ao salvar", description: mutationError.message });
      setSaving(false);
      return;
    }

    toast({ title: form.id ? "Competição atualizada" : "Competição criada", description: "Operação concluída com sucesso." });

    setForm(initialForm);
    await loadCompetitions();
    setSaving(false);
  }

  function startCreate() {
    setForm(initialForm);
  }

  function startEdit(item: Competition) {
    setForm({
      id: item.id,
      name: item.name,
      category: item.category,
      season_year: String(item.season_year),
      url_base: item.url_base ?? "",
      is_active: item.is_active,
    });
  }

  async function toggleActive(item: Competition) {
    const { error: toggleError } = await supabase
      .from("competitions_registry")
      .update({ is_active: !item.is_active })
      .eq("id", item.id);

    if (toggleError) {
      toast({ variant: "destructive", title: "Falha", description: toggleError.message });
      return;
    }

    toast({
      title: item.is_active ? "Competição desativada" : "Competição ativada",
      description: `${item.name} foi atualizada.`,
    });

    await loadCompetitions();
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void (async () => {
        try {
          await ensureDefaultCompetition();
        } catch {
          // seed failures are shown only on manual action
        }
        await loadCompetitions();
      })();
    });
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Competições</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Gerencie as competições monitoradas no sync da FPF.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSeedDefault} disabled={saving}>
            Adicionar competição padrão
          </Button>
          <Button onClick={startCreate}>Nova competição</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{form.id ? "Editar competição" : "Nova competição"}</CardTitle>
          <CardDescription>Defina as competições usadas pelo sync real da FPF.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 md:col-span-2">
              <span className="text-sm text-[var(--muted)]">Nome</span>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Nome da competição"
                required
              />
            </label>

            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Categoria</span>
              <select
                value={form.category}
                onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value as CompetitionCategory }))}
                className="h-10 w-full rounded-md border border-white/15 bg-black/25 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
              >
                <option value="PROFISSIONAL">PROFISSIONAL</option>
                <option value="BASE">BASE</option>
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Temporada</span>
              <Input
                type="number"
                value={form.season_year}
                onChange={(event) => setForm((prev) => ({ ...prev, season_year: event.target.value }))}
                min={2000}
              />
            </label>

            <label className="space-y-1 md:col-span-2">
              <span className="text-sm text-[var(--muted)]">URL base (FPF)</span>
              <Input
                value={form.url_base}
                onChange={(event) => setForm((prev) => ({ ...prev, url_base: event.target.value }))}
                placeholder="https://federacaopr.com.br/competicoes/..."
              />
            </label>

            <label className="flex items-center gap-2 md:col-span-2">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => setForm((prev) => ({ ...prev, is_active: event.target.checked }))}
                className="h-4 w-4 rounded border-white/20 bg-black/25"
              />
              <span className="text-sm">Competição ativa</span>
            </label>

            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar competição"}
              </Button>
              {form.id && (
                <Button type="button" variant="outline" onClick={startCreate}>
                  Cancelar edição
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Competições cadastradas</CardTitle>
          <CardDescription>Lista completa com status e ação de ativar/desativar.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando competições...</p>}
          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nenhuma competição cadastrada.</p>
          )}

          {!loading && !error && items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Temporada</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>URL Base</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.season_year}</TableCell>
                    <TableCell>
                      <Badge variant={item.is_active ? "success" : "outline"}>
                        {item.is_active ? "Ativa" : "Inativa"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate text-xs text-[var(--muted)]">{item.url_base ?? "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => startEdit(item)}>
                          Editar
                        </Button>
                        <Button size="sm" variant={item.is_active ? "destructive" : "default"} onClick={() => toggleActive(item)}>
                          {item.is_active ? "Desativar" : "Ativar"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
