"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

type SyncSummary = {
  source?: string;
  competitions_checked?: number;
  matches_found?: number;
  matches_imported?: number;
  players_linked?: number;
};

type SyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary_json: SyncSummary | null;
  error_text: string | null;
};

function statusVariant(status: string): "default" | "success" | "destructive" | "outline" {
  if (status === "DONE") return "success";
  if (status === "ERROR") return "destructive";
  if (status === "RUNNING") return "default";
  return "outline";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function renderSummary(summary: SyncSummary | null) {
  if (!summary) return "Sem resumo.";

  return `source=${summary.source ?? "-"} | comps=${summary.competitions_checked ?? 0} | found=${summary.matches_found ?? 0} | imported=${summary.matches_imported ?? 0} | linked=${summary.players_linked ?? 0}`;
}

export default function AdminSyncPage() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadRuns() {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("sync_runs")
      .select("id,started_at,finished_at,status,summary_json,error_text")
      .order("started_at", { ascending: false })
      .limit(20);

    if (queryError) {
      setError("Não foi possível carregar o histórico de sync.");
      setRuns([]);
    } else {
      setRuns((data as SyncRun[]) ?? []);
    }

    setLoading(false);
  }

  async function handleRunSync() {
    setRunning(true);

    const response = await fetch("/api/sync/run", { method: "POST" });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      toast({
        variant: "destructive",
        title: "Falha no sync",
        description: payload.error ?? "Não foi possível executar o sync da FPF.",
      });
      setRunning(false);
      await loadRuns();
      return;
    }

    toast({
      title: "Sync finalizado",
      description: "Execução concluída com sucesso.",
    });

    setRunning(false);
    await loadRuns();
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadRuns();
    });
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Admin Sync</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Execute e monitore sincronizações do sistema.</p>
        </div>
        <Button onClick={handleRunSync} disabled={running}>
          {running ? "Executando..." : "Rodar sync agora"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimos sync runs</CardTitle>
          <CardDescription>Histórico das últimas 20 execuções.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando histórico...</p>}

          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && runs.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nenhuma execução encontrada.</p>
          )}

          {!loading && !error && runs.length > 0 && (
            <div className="space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                    <span className="text-xs text-[var(--muted)]">Início: {formatDate(run.started_at)}</span>
                    <span className="text-xs text-[var(--muted)]">Fim: {formatDate(run.finished_at)}</span>
                  </div>

                  <p className="mt-2 text-sm text-[var(--muted)]">{renderSummary(run.summary_json)}</p>

                  {run.error_text && <p className="mt-2 text-sm text-red-400">Erro: {run.error_text}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
