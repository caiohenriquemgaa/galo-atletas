"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";

type PendingPayload = {
  match_id?: string;
  athlete_name_raw?: string | null;
  cbf_registry?: string | null;
};

type PendingItem = {
  id: string;
  source: string;
  kind: string;
  payload: PendingPayload;
  created_at: string;
  resolved_at: string | null;
};

type AthleteItem = {
  id: string;
  name: string;
  cbf_registry: string | null;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminPendingPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [athletes, setAthletes] = useState<AthleteItem[]>([]);
  const [selectedAthleteByPending, setSelectedAthleteByPending] = useState<Record<string, string>>({});

  async function loadData() {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/pending", { method: "GET" });
    const payload = (await response.json()) as {
      pending?: PendingItem[];
      athletes?: AthleteItem[];
      error?: string;
    };

    if (!response.ok) {
      setError(payload.error ?? "Não foi possível carregar pendências.");
      setPending([]);
      setAthletes([]);
      setLoading(false);
      return;
    }

    setPending(payload.pending ?? []);
    setAthletes(payload.athletes ?? []);
    setLoading(false);
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadData();
    });
  }, []);

  const athleteOptions = useMemo(() => {
    return athletes.map((athlete) => ({
      id: athlete.id,
      label: athlete.cbf_registry ? `${athlete.name} (${athlete.cbf_registry})` : athlete.name,
    }));
  }, [athletes]);

  async function handleResolve(pendingId: string) {
    const athleteId = selectedAthleteByPending[pendingId];

    if (!athleteId) {
      toast({
        variant: "destructive",
        title: "Atleta obrigatório",
        description: "Selecione um atleta para resolver a pendência.",
      });
      return;
    }

    setResolvingId(pendingId);

    const response = await fetch("/api/admin/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pending_id: pendingId, athlete_id: athleteId }),
    });

    const payload = (await response.json()) as { error?: string; updated_rows?: number };

    if (!response.ok) {
      toast({
        variant: "destructive",
        title: "Falha ao resolver",
        description: payload.error ?? "Não foi possível resolver a pendência.",
      });
      setResolvingId(null);
      return;
    }

    toast({
      title: "Pendência resolvida",
      description: `${payload.updated_rows ?? 0} registro(s) atualizados em match_player_stats.`,
    });

    setResolvingId(null);
    await loadData();
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Pendências de Sync</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Vincule manualmente pendências de atletas não reconhecidos no sync.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Itens pendentes</CardTitle>
          <CardDescription>Pendências abertas em <code>sync_pending_links</code> com kind <code>athlete_stat</code>.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando pendências...</p>}
          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && pending.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nenhuma pendência em aberto.</p>
          )}

          {!loading && !error && pending.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Criado em</TableHead>
                  <TableHead>Fonte</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Match ID</TableHead>
                  <TableHead>Atleta (raw)</TableHead>
                  <TableHead>CBF</TableHead>
                  <TableHead>Resolver com</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{formatDateTime(item.created_at)}</TableCell>
                    <TableCell><Badge variant="outline">{item.source}</Badge></TableCell>
                    <TableCell><Badge>{item.kind}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{item.payload.match_id ?? "-"}</TableCell>
                    <TableCell>{item.payload.athlete_name_raw ?? "-"}</TableCell>
                    <TableCell>{item.payload.cbf_registry ?? "-"}</TableCell>
                    <TableCell>
                      <select
                        value={selectedAthleteByPending[item.id] ?? ""}
                        onChange={(event) =>
                          setSelectedAthleteByPending((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        className="h-9 w-[260px] max-w-full rounded-md border border-white/15 bg-black/25 px-2 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                        disabled={resolvingId === item.id}
                      >
                        <option value="">Selecione um atleta...</option>
                        {athleteOptions.map((athlete) => (
                          <option key={athlete.id} value={athlete.id}>
                            {athlete.label}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => void handleResolve(item.id)}
                        disabled={resolvingId === item.id}
                      >
                        {resolvingId === item.id ? "Resolvendo..." : "Resolver"}
                      </Button>
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
