"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";

type Athlete = {
  id: string;
  name: string;
};

type MatchMeta = {
  competition_name: string;
  season_year: number;
};

type MatchRelation = MatchMeta | MatchMeta[] | null;

type StatsRow = {
  athlete_id: string | null;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  yellow_cards: number | null;
  red_cards: number | null;
  match: MatchRelation;
};

type AnalyticsRow = {
  athleteId: string;
  name: string;
  games: number;
  totalMinutes: number;
  totalGoals: number;
  totalAssists: number;
  totalYellow: number;
  totalRed: number;
  totalCards: number;
  score: number;
};

function pickMatch(match: MatchRelation): MatchMeta | null {
  if (!match) return null;
  return Array.isArray(match) ? (match[0] ?? null) : match;
}

function calculatePerformanceScore(input: {
  totalMinutes: number;
  totalGoals: number;
  totalAssists: number;
  totalYellow: number;
  totalRed: number;
}) {
  return (
    input.totalGoals * 4 +
    input.totalAssists * 3 +
    input.totalMinutes / 90 -
    input.totalYellow * 1 -
    input.totalRed * 3
  );
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [athletesById, setAthletesById] = useState<Record<string, string>>({});
  const [statsRows, setStatsRows] = useState<StatsRow[]>([]);

  const [competitionOptions, setCompetitionOptions] = useState<string[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);

  const [competitionFilter, setCompetitionFilter] = useState("ALL");
  const [seasonFilter, setSeasonFilter] = useState("ALL");

  useEffect(() => {
    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const [{ data: athletesData, error: athletesError }, { data: statsData, error: statsError }] = await Promise.all([
          supabase.from("athletes").select("id,name"),
          supabase
            .from("match_player_stats")
            .select("athlete_id,minutes,goals,assists,yellow_cards:yellow,red_cards:red,match:matches(competition_name,season_year)"),
        ]);

        if (athletesError || statsError) {
          setError("Não foi possível carregar os dados de analytics.");
          setStatsRows([]);
          setAthletesById({});
          setLoading(false);
          return;
        }

        const athletes = (athletesData as Athlete[]) ?? [];
        const stats = (statsData as StatsRow[]) ?? [];

        const athleteMap = athletes.reduce<Record<string, string>>((acc, athlete) => {
          acc[athlete.id] = athlete.name;
          return acc;
        }, {});

        const competitions = Array.from(
          new Set(
            stats
              .map((row) => pickMatch(row.match)?.competition_name)
              .filter((value): value is string => !!value)
          )
        ).sort();

        const seasons = Array.from(
          new Set(
            stats
              .map((row) => pickMatch(row.match)?.season_year)
              .filter((value): value is number => Number.isFinite(value))
          )
        )
          .sort((a, b) => b - a)
          .map((value) => String(value));

        setAthletesById(athleteMap);
        setStatsRows(stats);
        setCompetitionOptions(competitions);
        setSeasonOptions(seasons);
        setLoading(false);
      })();
    });
  }, []);

  const rows = useMemo(() => {
    const grouped = new Map<string, AnalyticsRow>();

    for (const stat of statsRows) {
      if (!stat.athlete_id) continue;

      const match = pickMatch(stat.match);
      if (!match) continue;

      if (competitionFilter !== "ALL" && match.competition_name !== competitionFilter) continue;
      if (seasonFilter !== "ALL" && String(match.season_year) !== seasonFilter) continue;

      const athleteId = stat.athlete_id;
      const athleteName = athletesById[athleteId] ?? `Atleta ${athleteId.slice(0, 8)}`;

      if (!grouped.has(athleteId)) {
        grouped.set(athleteId, {
          athleteId,
          name: athleteName,
          games: 0,
          totalMinutes: 0,
          totalGoals: 0,
          totalAssists: 0,
          totalYellow: 0,
          totalRed: 0,
          totalCards: 0,
          score: 0,
        });
      }

      const item = grouped.get(athleteId)!;
      item.games += 1;
      item.totalMinutes += stat.minutes ?? 0;
      item.totalGoals += stat.goals ?? 0;
      item.totalAssists += stat.assists ?? 0;
      item.totalYellow += stat.yellow_cards ?? 0;
      item.totalRed += stat.red_cards ?? 0;
      item.totalCards = item.totalYellow + item.totalRed;
    }

    const aggregated = Array.from(grouped.values()).map((item) => ({
      ...item,
      score: calculatePerformanceScore({
        totalMinutes: item.totalMinutes,
        totalGoals: item.totalGoals,
        totalAssists: item.totalAssists,
        totalYellow: item.totalYellow,
        totalRed: item.totalRed,
      }),
    }));

    aggregated.sort((a, b) => b.score - a.score);
    return aggregated;
  }, [athletesById, competitionFilter, seasonFilter, statsRows]);

  const top10 = useMemo(() => rows.slice(0, 10), [rows]);

  const highestMinutes = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalMinutes - a.totalMinutes)[0] ?? null;
  }, [rows]);

  const highestGoals = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalGoals - a.totalGoals)[0] ?? null;
  }, [rows]);

  const highestAssists = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalAssists - a.totalAssists)[0] ?? null;
  }, [rows]);

  const highestCards = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalCards - a.totalCards)[0] ?? null;
  }, [rows]);

  const hasData = rows.length > 0;

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Analytics do Elenco</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Dados reais de desempenho por atleta a partir de match_player_stats.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Filtre por competição e temporada para refinar a análise.</CardDescription>
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

      {loading && <p className="text-sm text-[var(--muted)]">Carregando analytics...</p>}
      {!loading && error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && !hasData && (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma estatística encontrada</CardTitle>
            <CardDescription>
              Ainda não há dados em <code>match_player_stats</code> para os filtros selecionados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted)]">
              Assim que os jogos tiverem estatísticas vinculadas aos atletas, os cards e ranking aparecerão aqui.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && hasData && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Maior minutagem</CardDescription>
                <CardTitle className="text-xl">{highestMinutes?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">{highestMinutes ? `${highestMinutes.totalMinutes} min` : "Sem dados"}</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mais gols</CardDescription>
                <CardTitle className="text-xl">{highestGoals?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="success">{highestGoals ? `${highestGoals.totalGoals} gols` : "Sem dados"}</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mais assistências</CardDescription>
                <CardTitle className="text-xl">{highestAssists?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">{highestAssists ? `${highestAssists.totalAssists} assists` : "Sem dados"}</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mais cartões (amarelo/vermelho)</CardDescription>
                <CardTitle className="text-xl">{highestCards?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="destructive">
                  {highestCards ? `${highestCards.totalYellow}/${highestCards.totalRed} (total ${highestCards.totalCards})` : "Sem dados"}
                </Badge>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Ranking Top 10 por Performance Score</CardTitle>
              <CardDescription>
                score = (goals*4) + (assists*3) + (minutes/90) - (yellow*1) - (red*3)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Atleta</TableHead>
                    <TableHead className="text-right">Jogos</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">G</TableHead>
                    <TableHead className="text-right">A</TableHead>
                    <TableHead className="text-right">Y/R</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top10.map((row, index) => (
                    <TableRow key={row.athleteId}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">{row.games}</TableCell>
                      <TableCell className="text-right">{row.totalMinutes}</TableCell>
                      <TableCell className="text-right">{row.totalGoals}</TableCell>
                      <TableCell className="text-right">{row.totalAssists}</TableCell>
                      <TableCell className="text-right">{row.totalYellow}/{row.totalRed}</TableCell>
                      <TableCell className="text-right font-semibold text-[var(--gold)]">{formatScore(row.score)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
