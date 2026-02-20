"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
  athlete_id: string;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
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
  avgMinutes: number;
  goalsPer90: number;
  score: number;
};

type SortDirection = "desc" | "asc";

function calculatePerformanceScore({
  totalMinutes,
  totalGoals,
  totalAssists,
  totalYellow,
  totalRed,
}: {
  totalMinutes: number;
  totalGoals: number;
  totalAssists: number;
  totalYellow: number;
  totalRed: number;
}) {
  const scoreBase =
    totalMinutes / 90 +
    totalGoals * 5 +
    totalAssists * 3 -
    totalYellow * 1 -
    totalRed * 3;

  return Math.max(0, Math.min(100, Math.round(scoreBase)));
}

function pickMatch(match: MatchRelation): MatchMeta | null {
  if (!match) return null;
  return Array.isArray(match) ? (match[0] ?? null) : match;
}

function formatDecimal(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [competitionOptions, setCompetitionOptions] = useState<string[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);

  const [competitionFilter, setCompetitionFilter] = useState("ALL");
  const [seasonFilter, setSeasonFilter] = useState("ALL");

  const [scoreSortDirection, setScoreSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const [{ data: athletesData, error: athletesError }, { data: statsData, error: statsError }, { data: matchesData, error: matchesError }] =
          await Promise.all([
            supabase.from("athletes").select("id,name").order("name", { ascending: true }),
            supabase
              .from("match_player_stats")
              .select(
                "athlete_id,minutes,goals,assists,yellow_cards,red_cards,match:matches(competition_name,season_year)"
              ),
            supabase
              .from("matches")
              .select("competition_name,season_year")
              .order("match_date", { ascending: false })
              .limit(1000),
          ]);

        if (athletesError || statsError || matchesError) {
          setError("Não foi possível carregar os dados de analytics.");
          setRows([]);
          setLoading(false);
          return;
        }

        const athletes = (athletesData as Athlete[]) ?? [];
        const statsRows = (statsData as StatsRow[]) ?? [];
        const matchesRows = (matchesData as MatchMeta[]) ?? [];

        const competitions = Array.from(
          new Set(matchesRows.map((row) => row.competition_name).filter((value): value is string => !!value))
        ).sort();

        const seasons = Array.from(
          new Set(matchesRows.map((row) => row.season_year).filter((value): value is number => Number.isFinite(value)))
        )
          .sort((a, b) => b - a)
          .map((value) => String(value));

        setCompetitionOptions(competitions);
        setSeasonOptions(seasons);

        const base = athletes.reduce<Record<string, AnalyticsRow>>((acc, athlete) => {
          acc[athlete.id] = {
            athleteId: athlete.id,
            name: athlete.name,
            games: 0,
            totalMinutes: 0,
            totalGoals: 0,
            totalAssists: 0,
            totalYellow: 0,
            totalRed: 0,
            avgMinutes: 0,
            goalsPer90: 0,
            score: 0,
          };
          return acc;
        }, {});

        for (const row of statsRows) {
          const target = base[row.athlete_id];
          if (!target) continue;

          const match = pickMatch(row.match);
          if (!match) continue;

          if (competitionFilter !== "ALL" && match.competition_name !== competitionFilter) continue;
          if (seasonFilter !== "ALL" && String(match.season_year) !== seasonFilter) continue;

          target.games += 1;
          target.totalMinutes += row.minutes ?? 0;
          target.totalGoals += row.goals ?? 0;
          target.totalAssists += row.assists ?? 0;
          target.totalYellow += row.yellow_cards ?? 0;
          target.totalRed += row.red_cards ?? 0;
        }

        const result = Object.values(base).map((item) => {
          const avgMinutes = item.games > 0 ? item.totalMinutes / item.games : 0;
          const goalsPer90 = item.totalMinutes > 0 ? (item.totalGoals / item.totalMinutes) * 90 : 0;
          const score = calculatePerformanceScore({
            totalMinutes: item.totalMinutes,
            totalGoals: item.totalGoals,
            totalAssists: item.totalAssists,
            totalYellow: item.totalYellow,
            totalRed: item.totalRed,
          });

          return {
            ...item,
            avgMinutes,
            goalsPer90,
            score,
          };
        });

        setRows(result);
        setLoading(false);
      })();
    });
  }, [competitionFilter, seasonFilter]);

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (scoreSortDirection === "desc") return b.score - a.score;
      return a.score - b.score;
    });
    return copy;
  }, [rows, scoreSortDirection]);

  const top5 = useMemo(
    () => [...sortedRows].sort((a, b) => b.score - a.score).slice(0, 5),
    [sortedRows]
  );

  const bestAthlete = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.score - a.score)[0] ?? null;
  }, [rows]);

  const highestMinutes = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalMinutes - a.totalMinutes)[0] ?? null;
  }, [rows]);

  const topScorer = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalGoals - a.totalGoals)[0] ?? null;
  }, [rows]);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Analytics do Elenco</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Comparativo de desempenho entre atletas com filtros por competição e temporada.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Aplique filtros para comparar o desempenho em contextos específicos.</CardDescription>
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

      {!loading && !error && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Melhor atleta</CardDescription>
                <CardTitle className="text-xl">{bestAthlete?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge>{bestAthlete ? `Score ${bestAthlete.score}` : "Sem dados"}</Badge>
              </CardContent>
            </Card>

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
                <CardTitle className="text-xl">{topScorer?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="success">{topScorer ? `${topScorer.totalGoals} gols` : "Sem dados"}</Badge>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top 5 por Performance Score</CardTitle>
              <CardDescription>Ranking visual dos atletas com maior score.</CardDescription>
            </CardHeader>
            <CardContent className="h-[320px]">
              {top5.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Sem dados para o gráfico.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top5}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                    <XAxis dataKey="name" stroke="#A0A0A0" tick={{ fill: "#A0A0A0", fontSize: 12 }} />
                    <YAxis stroke="#A0A0A0" tick={{ fill: "#A0A0A0", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#161616",
                        border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: "#fff" }}
                      itemStyle={{ color: "#C9A227" }}
                    />
                    <Bar dataKey="score" fill="#C9A227" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle>Ranking do elenco</CardTitle>
                  <CardDescription>Ordenado por score (desc por padrão).</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setScoreSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))}
                >
                  Score: {scoreSortDirection === "desc" ? "Maior → Menor" : "Menor → Maior"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sortedRows.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Nenhum atleta encontrado para os filtros selecionados.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="text-right">Jogos</TableHead>
                      <TableHead className="text-right">Minutos</TableHead>
                      <TableHead className="text-right">Gols</TableHead>
                      <TableHead className="text-right">Assistências</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow key={row.athleteId}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{row.games}</TableCell>
                        <TableCell className="text-right">{row.totalMinutes}</TableCell>
                        <TableCell className="text-right">{row.totalGoals}</TableCell>
                        <TableCell className="text-right">{row.totalAssists}</TableCell>
                        <TableCell className="text-right">
                          <span className="font-semibold text-[var(--gold)]">{row.score}</span>
                          <span className="ml-2 text-xs text-[var(--muted)]">avg {formatDecimal(row.avgMinutes)} | g/90 {formatDecimal(row.goalsPer90)}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
