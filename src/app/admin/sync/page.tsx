"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

type SyncSummary = {
  source?: string;
  competition_id?: string | null;
  competition_name?: string | null;
  category?: string | null;
  season_year?: number | null;
  competitions_checked?: number;
  comps_checked?: number;
  matches_found?: number;
  matches_imported?: number;
  players_linked?: number;
  athletes_found?: number;
  athletes_imported?: number;
  athletes_updated?: number;
  rows_total?: number;
  rows_discarded?: number;
  galo_rows?: number;
  imported?: number;
  updated?: number;
  pending_loaded?: number;
  processed?: number;
  errors?: number;
};

type SyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  summary_json: SyncSummary | null;
  error_text: string | null;
};

type CompetitionOption = {
  id: string;
  name: string;
  category: string | null;
  season_year: number;
};

type ProcessingStatus = {
  total: number;
  processed: number;
  pending: number;
  errors: number;
};

type MatchProcessingRow = {
  processed: boolean | null;
  processing_error: string | null;
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

function formatCompetitionLabel(competition: CompetitionOption) {
  return competition.name.includes(String(competition.season_year))
    ? competition.name
    : `${competition.name} ${competition.season_year}`;
}

function renderSummary(summary: SyncSummary | null) {
  if (!summary) return "Sem resumo.";

  const competitionText = summary.competition_name
    ? ` | competition=${summary.competition_name} (${summary.category ?? "-"} ${summary.season_year ?? "-"})`
    : "";

  if (summary.source === "FPF_ROSTER") {
    return `source=FPF_ROSTER${competitionText} | comps=${summary.comps_checked ?? 0} | imported=${summary.imported ?? summary.athletes_imported ?? 0} | updated=${summary.updated ?? summary.athletes_updated ?? 0} | rows=${summary.rows_total ?? 0} | galo_rows=${summary.galo_rows ?? 0}`;
  }

  if (summary.source === "FPF_PROCESS_MATCHES") {
    return `source=FPF_PROCESS_MATCHES${competitionText} | loaded=${summary.pending_loaded ?? 0} | processed=${summary.processed ?? 0} | errors=${summary.errors ?? 0}`;
  }

  return `source=${summary.source ?? "-"}${competitionText} | comps=${summary.competitions_checked ?? 0} | found=${summary.matches_found ?? 0} | imported=${summary.matches_imported ?? 0} | linked=${summary.players_linked ?? 0}`;
}

export default function AdminSyncPage() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingCompetitions, setLoadingCompetitions] = useState(true);
  const [loadingProcessingStatus, setLoadingProcessingStatus] = useState(false);
  const [importingMatches, setImportingMatches] = useState(false);
  const [runningMatches, setRunningMatches] = useState(false);
  const [runningRoster, setRunningRoster] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [competitionsError, setCompetitionsError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);

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

  async function loadCompetitions() {
    setLoadingCompetitions(true);
    setCompetitionsError(null);

    const { data, error: queryError } = await supabase
      .from("competitions_registry")
      .select("id,name,category,season_year")
      .eq("is_active", true)
      .order("season_year", { ascending: false })
      .order("name", { ascending: true });

    if (queryError) {
      setCompetitionsError("NÃ£o foi possÃ­vel carregar as competiÃ§Ãµes ativas.");
      setCompetitions([]);
    } else {
      setCompetitions((data as CompetitionOption[]) ?? []);
    }

    setLoadingCompetitions(false);
  }

  function selectedCompetitionPayload() {
    return selectedCompetitionId === "all" ? null : selectedCompetitionId;
  }

  const selectedCompetition = useCallback(() => {
    return competitions.find((competition) => competition.id === selectedCompetitionId) ?? null;
  }, [competitions, selectedCompetitionId]);

  const loadProcessingStatus = useCallback(async () => {
    setLoadingProcessingStatus(true);

    const competition = selectedCompetition();
    let query = supabase.from("matches").select("processed,processing_error");

    if (competition) {
      query = query.eq("competition_name", competition.name).eq("season_year", competition.season_year);
    }

    const { data, error: queryError } = await query;

    if (queryError) {
      setProcessingStatus(null);
      setLoadingProcessingStatus(false);
      return;
    }

    const rows = (data as MatchProcessingRow[]) ?? [];
    const processed = rows.filter((row) => row.processed === true).length;
    const errors = rows.filter((row) => !!row.processing_error).length;

    setProcessingStatus({
      total: rows.length,
      processed,
      pending: rows.length - processed,
      errors,
    });
    setLoadingProcessingStatus(false);
  }, [selectedCompetition]);

  async function handleImportMatches() {
    setImportingMatches(true);

    const response = await fetch("/api/cron/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competition_id: selectedCompetitionPayload() }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      toast({
        variant: "destructive",
        title: "Falha na importação",
        description: payload.error ?? "Não foi possível importar os jogos da FPF.",
      });
      setImportingMatches(false);
      await loadRuns();
      await loadProcessingStatus();
      return;
    }

    toast({
      title: "Jogos importados",
      description: "Importação concluída com sucesso.",
    });

    setImportingMatches(false);
    await loadRuns();
    await loadProcessingStatus();
  }

  async function handleRunSync() {
    setRunningMatches(true);

    const response = await fetch("/api/cron/process-matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competition_id: selectedCompetitionPayload() }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      toast({
        variant: "destructive",
        title: "Falha no sync",
        description: payload.error ?? "Não foi possível executar o sync da FPF.",
      });
      setRunningMatches(false);
      await loadRuns();
      await loadProcessingStatus();
      return;
    }

    toast({
      title: "Lote processado",
      description: "Execução concluída com sucesso.",
    });

    setRunningMatches(false);
    await loadRuns();
    await loadProcessingStatus();
  }

  async function handleRunRosterSync() {
    setRunningRoster(true);

    const response = await fetch("/api/sync/roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competition_id: selectedCompetitionPayload() }),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      toast({
        variant: "destructive",
        title: "Falha no sync de elenco",
        description: payload.error ?? "Não foi possível executar o sync de atletas habilitados.",
      });
      setRunningRoster(false);
      await loadRuns();
      await loadProcessingStatus();
      return;
    }

    toast({
      title: "Sync de elenco finalizado",
      description: "Execução concluída com sucesso.",
    });

    setRunningRoster(false);
    await loadRuns();
    await loadProcessingStatus();
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadRuns();
      void loadCompetitions();
    });
  }, []);

  useEffect(() => {
    if (loadingCompetitions) return;

    Promise.resolve().then(() => {
      void loadProcessingStatus();
    });
  }, [loadingCompetitions, loadProcessingStatus]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Admin Sync</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Execute e monitore sincronizações do sistema.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64">
            <label className="mb-1 block text-xs font-medium text-[var(--muted)]" htmlFor="competition-sync-select">
              Competição
            </label>
            <select
              id="competition-sync-select"
              value={selectedCompetitionId}
              onChange={(event) => setSelectedCompetitionId(event.target.value)}
              disabled={loadingCompetitions || importingMatches || runningMatches || runningRoster}
              className="h-10 w-full rounded-md border border-white/15 bg-black/25 px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="all">Todas</option>
              {competitions.map((competition) => (
                <option key={competition.id} value={competition.id}>
                  {formatCompetitionLabel(competition)}
                </option>
              ))}
            </select>
            {competitionsError && <p className="mt-1 text-xs text-red-400">{competitionsError}</p>}
          </div>
          <Button variant="outline" onClick={handleImportMatches} disabled={importingMatches || runningMatches || runningRoster}>
            {importingMatches ? "Importando..." : "Importar jogos"}
          </Button>
          <Button onClick={handleRunSync} disabled={importingMatches || runningMatches || runningRoster}>
            {runningMatches ? "Processando..." : "Rodar sync agora"}
          </Button>
          <Button variant="outline" onClick={handleRunRosterSync} disabled={importingMatches || runningMatches || runningRoster}>
            {runningRoster ? "Sincronizando elenco..." : "Sync elenco FPF"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status do processamento</CardTitle>
          <CardDescription>
            {selectedCompetition()
              ? `${selectedCompetition()!.name} ${selectedCompetition()!.season_year}`
              : "Todas as competições ativas"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingProcessingStatus && <p className="text-sm text-[var(--muted)]">Carregando status...</p>}

          {!loadingProcessingStatus && processingStatus && (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-[var(--muted)]">Total de jogos</p>
                  <p className="text-2xl font-semibold text-white">{processingStatus.total}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-[var(--muted)]">Processados</p>
                  <p className="text-2xl font-semibold text-white">{processingStatus.processed}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-[var(--muted)]">Pendentes</p>
                  <p className="text-2xl font-semibold text-white">{processingStatus.pending}</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-xs text-[var(--muted)]">Erros</p>
                  <p className="text-2xl font-semibold text-white">{processingStatus.errors}</p>
                </div>
              </div>

              {processingStatus.pending > 0 && (
                <p className="text-sm text-amber-300">
                  ⚠️ Ainda existem {processingStatus.pending} jogos pendentes. Clique em &quot;Rodar sync agora&quot; novamente.
                </p>
              )}
              {processingStatus.pending === 0 && (
                <p className="text-sm text-emerald-300">✅ Todos os jogos desta competição foram processados.</p>
              )}
              {processingStatus.errors > 0 && (
                <p className="text-sm text-red-300">❌ Existem {processingStatus.errors} jogos com erro. Verifique os logs.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                    <Badge variant="outline">{run.summary_json?.source ?? "-"}</Badge>
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
