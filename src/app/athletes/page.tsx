"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { downloadCsv } from "@/lib/export/csv";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

type Athlete = {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  cbf_registry: string | null;
  dob: string | null;
  created_at: string;
  source: "FPF" | "MANUAL" | string | null;
  is_active_fpf: boolean | null;
};

type MatchMeta = {
  competition_name: string;
  season_year: number;
};

type MatchRelation = MatchMeta | MatchMeta[] | null;

type StatsExportRow = {
  athlete_id: string;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  match: MatchRelation;
};

function pickMatch(match: MatchRelation): MatchMeta | null {
  if (!match) return null;
  return Array.isArray(match) ? (match[0] ?? null) : match;
}

export default function AthletesPage() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [competitionFilter, setCompetitionFilter] = useState("ALL");
  const [seasonFilter, setSeasonFilter] = useState("ALL");
  const [filterLoading, setFilterLoading] = useState(false);
  const [competitionOptions, setCompetitionOptions] = useState<string[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);

  const [exporting, setExporting] = useState(false);

  async function loadAthletes() {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("athletes")
      .select("id,name,nickname,position,cbf_registry,dob,created_at,source,is_active_fpf")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError("Não foi possível carregar os atletas. Tente novamente.");
      setAthletes([]);
    } else {
      setAthletes(data ?? []);
    }

    setLoading(false);
  }

  async function loadFilters() {
    setFilterLoading(true);

    const { data, error: queryError } = await supabase
      .from("matches")
      .select("competition_name,season_year")
      .order("match_date", { ascending: false })
      .limit(500);

    if (!queryError) {
      const rows = (data as MatchMeta[]) ?? [];
      const competitions = Array.from(
        new Set(rows.map((row) => row.competition_name).filter((value): value is string => !!value))
      ).sort();

      const seasons = Array.from(
        new Set(rows.map((row) => row.season_year).filter((value): value is number => Number.isFinite(value)))
      )
        .sort((a, b) => b - a)
        .map((value) => String(value));

      setCompetitionOptions(competitions);
      setSeasonOptions(seasons);
    }

    setFilterLoading(false);
  }

  async function handleExportSquadCsv() {
    setExporting(true);

    const { data: athleteData, error: athleteError } = await supabase
      .from("athletes")
      .select("id,name,position")
      .order("name", { ascending: true });

    if (athleteError) {
      toast({
        variant: "destructive",
        title: "Erro na exportação",
        description: "Não foi possível carregar o elenco para exportar.",
      });
      setExporting(false);
      return;
    }

    const { data: statsData, error: statsError } = await supabase
      .from("match_player_stats")
      .select("minutes,goals,assists,yellow_cards,red_cards,athlete_id,match:matches(competition_name,season_year)");

    if (statsError) {
      toast({
        variant: "destructive",
        title: "Erro na exportação",
        description: "Não foi possível carregar as estatísticas para exportar.",
      });
      setExporting(false);
      return;
    }

    const athletesBase = ((athleteData as Array<{ id: string; name: string; position: string | null }>) ?? []).map(
      (athlete) => ({
        ...athlete,
        games: 0,
        minutes: 0,
        goals: 0,
        assists: 0,
        yellow_cards: 0,
        red_cards: 0,
      })
    );

    const byAthleteId = athletesBase.reduce<Record<string, (typeof athletesBase)[number]>>((acc, athlete) => {
      acc[athlete.id] = athlete;
      return acc;
    }, {});

    const statRows = (statsData as StatsExportRow[]) ?? [];

    for (const row of statRows) {
      const match = pickMatch(row.match);
      if (!match) continue;

      if (competitionFilter !== "ALL" && match.competition_name !== competitionFilter) continue;
      if (seasonFilter !== "ALL" && String(match.season_year) !== seasonFilter) continue;

      const target = byAthleteId[row.athlete_id];
      if (!target) continue;

      target.games += 1;
      target.minutes += row.minutes ?? 0;
      target.goals += row.goals ?? 0;
      target.assists += row.assists ?? 0;
      target.yellow_cards += row.yellow_cards ?? 0;
      target.red_cards += row.red_cards ?? 0;
    }

    const csvRows = athletesBase.map((athlete) => ({
      name: athlete.name,
      position: athlete.position ?? "",
      games: athlete.games,
      minutes: athlete.minutes,
      goals: athlete.goals,
      assists: athlete.assists,
      yellow_cards: athlete.yellow_cards,
      red_cards: athlete.red_cards,
    }));

    downloadCsv("elenco.csv", csvRows);

    toast({
      title: "CSV gerado",
      description: "Arquivo elenco.csv baixado com sucesso.",
    });

    setExporting(false);
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadAthletes();
      void loadFilters();
    });
  }, []);

  const hasFilters = useMemo(() => competitionOptions.length > 0 || seasonOptions.length > 0, [competitionOptions, seasonOptions]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Atletas</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Gerencie o elenco cadastrado no sistema.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleExportSquadCsv} disabled={exporting || filterLoading}>
            {exporting ? "Exportando..." : "Exportar elenco (CSV)"}
          </Button>
          <Button asChild>
            <Link href="/athletes/new">Novo atleta</Link>
          </Button>
        </div>
      </div>

      {hasFilters && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filtros para exportação</CardTitle>
            <CardDescription>Selecione competição e temporada para filtrar os totais do CSV.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Competição</span>
                <select
                  value={competitionFilter}
                  onChange={(event) => setCompetitionFilter(event.target.value)}
                  className="h-10 w-full rounded-md border border-white/15 bg-black/25 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <option value="ALL">Todas</option>
                  {competitionOptions.map((competition) => (
                    <option key={competition} value={competition}>
                      {competition}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-sm text-[var(--muted)]">Temporada</span>
                <select
                  value={seasonFilter}
                  onChange={(event) => setSeasonFilter(event.target.value)}
                  className="h-10 w-full rounded-md border border-white/15 bg-black/25 px-3 text-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
                >
                  <option value="ALL">Todas</option>
                  {seasonOptions.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lista de atletas</CardTitle>
          <CardDescription>Clique em um atleta para abrir o perfil e a edição.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando atletas...</p>}

          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && athletes.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nenhum atleta cadastrado ainda.</p>
          )}

          {!loading && !error && athletes.length > 0 && (
            <ul className="space-y-3">
              {athletes.map((athlete) => (
                <li key={athlete.id}>
                  <Link
                    href={`/athletes/${athlete.id}`}
                    className="block rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-[var(--gold)]/60 hover:bg-black/35"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-white">{athlete.name}</p>
                        <p className="text-sm text-[var(--muted)]">
                          {athlete.position || "Sem posição"}
                          {athlete.nickname ? ` • ${athlete.nickname}` : ""}
                        </p>
                        {athlete.cbf_registry && (
                          <p className="text-xs text-[var(--muted)]">Registro CBF: {athlete.cbf_registry}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge variant={athlete.source === "FPF" ? "default" : "outline"}>
                            {athlete.source === "FPF" ? "FPF" : "MANUAL"}
                          </Badge>
                          {athlete.source === "FPF" && athlete.is_active_fpf === false && (
                            <Badge variant="destructive">INATIVO</Badge>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-[var(--muted)]">Perfil</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
