"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { getAthleteSuspensionHistory, getNextMatchSuspensions, type SuspensionMatchInfo } from "@/lib/analytics/suspension";
import { downloadCsv } from "@/lib/export/csv";
import { supabase } from "@/lib/supabase/client";

type Athlete = {
  id: string;
  name: string;
};

type MatchInfo = SuspensionMatchInfo;

type MatchRelation = MatchInfo | MatchInfo[] | null;

type StatsRow = {
  athlete_id: string | null;
  source: string | null;
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

type SuspensionAlertView = {
  athleteId: string;
  name: string;
  reason: string;
  yellowCountInCycle: number;
};

type SuspensionRiskView = {
  athleteId: string;
  name: string;
  yellowCountInCycle: number;
};

function pickMatch(match: MatchRelation): MatchInfo | null {
  if (!match) return null;
  return Array.isArray(match) ? (match[0] ?? null) : match;
}

function isCompletedStatRow(row: StatsRow & { match: MatchInfo | null }) {
  if (!row.match) return false;
  if (row.source !== "MOCK") return true;
  return row.minutes !== null && row.minutes > 0;
}

function calculatePerformanceScore(input: {
  totalMinutes: number;
  totalGoals: number;
  totalAssists: number;
  totalYellow: number;
  totalRed: number;
}) {
  return input.totalGoals * 4 + input.totalAssists * 3 + input.totalMinutes / 90 - input.totalYellow * 1 - input.totalRed * 3;
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function toHomeAwayLabel(home: boolean) {
  return home ? "Casa" : "Fora";
}

function sanitizeFilenamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function getMatchControlColumnLabel(match: MatchInfo) {
  const fixtureLabel = match.home ? `GALO x ${match.opponent}` : `${match.opponent} x GALO`;
  return `${formatShortDate(match.match_date)} ${fixtureLabel}`;
}

function getMatchControlCellValue(input: { yellow: number; red: number; suspended: boolean }) {
  const parts: string[] = [];

  if (input.yellow > 0) {
    parts.push(input.yellow === 1 ? "A" : `${input.yellow}A`);
  }

  if (input.red > 0) {
    parts.push(input.red === 1 ? "V" : `${input.red}V`);
  }

  if (input.suspended) {
    parts.push("SUSP");
  }

  return parts.join(" + ");
}

export default function AnalyticsPage() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [athletesById, setAthletesById] = useState<Record<string, string>>({});
  const [statsRows, setStatsRows] = useState<StatsRow[]>([]);
  const [matches, setMatches] = useState<MatchInfo[]>([]);

  const [competitionOptions, setCompetitionOptions] = useState<string[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<string[]>([]);

  const [competitionFilter, setCompetitionFilter] = useState("ALL");
  const [seasonFilter, setSeasonFilter] = useState("ALL");
  const [exportingCardsCsv, setExportingCardsCsv] = useState(false);

  useEffect(() => {
    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const [{ data: athletesData, error: athletesError }, { data: statsData, error: statsError }, { data: matchesData, error: matchesError }] =
          await Promise.all([
            supabase.from("athletes").select("id,name"),
            supabase
              .from("match_player_stats")
              .select(
                "athlete_id,source,minutes,goals,assists,yellow_cards,red_cards,match:matches(id,competition_name,season_year,match_date,opponent,home,goals_for,goals_against)"
              ),
            supabase
              .from("matches")
              .select("id,competition_name,season_year,match_date,opponent,home,goals_for,goals_against")
              .order("match_date", { ascending: false }),
          ]);

        if (athletesError || statsError || matchesError) {
          setError("Nao foi possivel carregar os dados de analytics.");
          setStatsRows([]);
          setMatches([]);
          setAthletesById({});
          setLoading(false);
          return;
        }

        const athletes = (athletesData as Athlete[]) ?? [];
        const stats = (statsData as StatsRow[]) ?? [];
        const loadedMatches = (matchesData as MatchInfo[]) ?? [];

        const athleteMap = athletes.reduce<Record<string, string>>((acc, athlete) => {
          acc[athlete.id] = athlete.name;
          return acc;
        }, {});

        const competitions = Array.from(new Set(loadedMatches.map((row) => row.competition_name).filter((value): value is string => !!value))).sort();
        const seasons = Array.from(
          new Set(loadedMatches.map((row) => row.season_year).filter((value): value is number => Number.isFinite(value)))
        )
          .sort((a, b) => b - a)
          .map((value) => String(value));

        setAthletesById(athleteMap);
        setStatsRows(stats);
        setMatches(loadedMatches);
        setCompetitionOptions(competitions);
        setSeasonOptions(seasons);
        setLoading(false);
      })();
    });
  }, []);

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
      if (competitionFilter !== "ALL" && match.competition_name !== competitionFilter) return false;
      if (seasonFilter !== "ALL" && String(match.season_year) !== seasonFilter) return false;
      return true;
    });
  }, [competitionFilter, matches, seasonFilter]);

  const filteredStatsRows = useMemo(
    () =>
      statsRows
        .map((row) => ({ ...row, match: pickMatch(row.match) }))
        .filter((row): row is StatsRow & { match: MatchInfo } => {
          if (!row.match) return false;
          if (competitionFilter !== "ALL" && row.match.competition_name !== competitionFilter) return false;
          if (seasonFilter !== "ALL" && String(row.match.season_year) !== seasonFilter) return false;
          return isCompletedStatRow(row);
        }),
    [competitionFilter, seasonFilter, statsRows]
  );

  const rows = useMemo(() => {
    const grouped = new Map<string, AnalyticsRow>();

    for (const stat of filteredStatsRows) {
      if (!stat.athlete_id) continue;

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
  }, [athletesById, filteredStatsRows]);

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

  const disciplinaryStatus = useMemo(() => {
    const result = getNextMatchSuspensions({
      matches: filteredMatches,
      statsRows: filteredStatsRows,
    });

    const alerts: SuspensionAlertView[] = result.alerts
      .map((alert) => ({
        athleteId: alert.athleteId,
        name: athletesById[alert.athleteId] ?? `Atleta ${alert.athleteId.slice(0, 8)}`,
        reason: alert.reason,
        yellowCountInCycle: alert.yellowCountInCycle,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    const risks: SuspensionRiskView[] = result.risks
      .map((risk) => ({
        athleteId: risk.athleteId,
        name: athletesById[risk.athleteId] ?? `Atleta ${risk.athleteId.slice(0, 8)}`,
        yellowCountInCycle: risk.yellowCountInCycle,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

    return {
      ...result,
      alerts,
      risks,
    };
  }, [athletesById, filteredMatches, filteredStatsRows]);

  const cardControlCsvRows = useMemo(() => {
    const orderedMatches = [...filteredMatches].sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime());
    const rowsByAthlete = filteredStatsRows.reduce<Map<string, Array<StatsRow & { match: MatchInfo }>>>((acc, row) => {
      if (!row.athlete_id) return acc;
      const current = acc.get(row.athlete_id) ?? [];
      current.push(row);
      acc.set(row.athlete_id, current);
      return acc;
    }, new Map());

    const totalsByAthlete = filteredStatsRows.reduce<
      Map<
        string,
        {
          totalYellow: number;
          totalRed: number;
          totalCards: number;
        }
      >
    >((acc, row) => {
      if (!row.athlete_id) return acc;

      const current = acc.get(row.athlete_id) ?? {
        totalYellow: 0,
        totalRed: 0,
        totalCards: 0,
      };

      current.totalYellow += row.yellow_cards ?? 0;
      current.totalRed += row.red_cards ?? 0;
      current.totalCards = current.totalYellow + current.totalRed;
      acc.set(row.athlete_id, current);
      return acc;
    }, new Map());

    const suspensionTargetsByAthlete = new Map<string, Set<string>>();

    for (const athleteId of rowsByAthlete.keys()) {
      const historyResult = getAthleteSuspensionHistory({
        athleteId,
        matches: filteredMatches,
        statsRows: filteredStatsRows,
      });

      const targetMatchIds = new Set(historyResult.history.map((item) => item.targetMatch.id));
      suspensionTargetsByAthlete.set(athleteId, targetMatchIds);
    }

    const athleteIds = Array.from(
      new Set([
        ...Array.from(rowsByAthlete.entries())
          .filter(([, athleteRows]) => athleteRows.some((row) => (row.yellow_cards ?? 0) > 0 || (row.red_cards ?? 0) > 0))
          .map(([athleteId]) => athleteId),
        ...Array.from(suspensionTargetsByAthlete.entries())
          .filter(([, targetIds]) => targetIds.size > 0)
          .map(([athleteId]) => athleteId),
      ])
    ).sort((a, b) => (athletesById[a] ?? a).localeCompare(athletesById[b] ?? b, "pt-BR"));

    return athleteIds.map((athleteId) => {
      const totals = totalsByAthlete.get(athleteId) ?? {
        totalYellow: 0,
        totalRed: 0,
        totalCards: 0,
      };
      const athleteRowsByMatchId = new Map(
        (rowsByAthlete.get(athleteId) ?? []).map((row) => [row.match.id, row] as const)
      );
      const suspensionTargetIds = suspensionTargetsByAthlete.get(athleteId) ?? new Set<string>();

      const csvRow: Record<string, string | number> = {
        atleta: athletesById[athleteId] ?? `Atleta ${athleteId.slice(0, 8)}`,
        total_amarelos: totals.totalYellow,
        total_vermelhos: totals.totalRed,
        total_cartoes: totals.totalCards,
      };

      for (const match of orderedMatches) {
        const row = athleteRowsByMatchId.get(match.id);
        csvRow[getMatchControlColumnLabel(match)] = getMatchControlCellValue({
          yellow: row?.yellow_cards ?? 0,
          red: row?.red_cards ?? 0,
          suspended: suspensionTargetIds.has(match.id),
        });
      }

      return csvRow;
    });
  }, [athletesById, filteredMatches, filteredStatsRows]);

  function handleExportCardsCsv() {
    if (cardControlCsvRows.length === 0) {
      toast({
        variant: "destructive",
        title: "Nada para exportar",
        description: "Nao ha atletas com cartoes nos filtros selecionados.",
      });
      return;
    }

    setExportingCardsCsv(true);

    const competitionSuffix = competitionFilter === "ALL" ? "todas_competicoes" : sanitizeFilenamePart(competitionFilter);
    const seasonSuffix = seasonFilter === "ALL" ? "todas_temporadas" : seasonFilter;

    downloadCsv(`controle_cartoes_${competitionSuffix}_${seasonSuffix}.csv`, cardControlCsvRows);

    toast({
      title: "CSV gerado",
      description: "Arquivo de controle de cartoes baixado com sucesso.",
    });

    setExportingCardsCsv(false);
  }

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
          <CardDescription>Filtre por competicao e temporada para refinar a analise.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm text-[var(--muted)]">Competicao</span>
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

      {!loading && !error && disciplinaryStatus.supported && disciplinaryStatus.nextMatch && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Exportacao disciplinar</p>
              <p className="text-sm text-[var(--muted)]">Baixe um CSV no formato de ficha de controle, com atletas nas linhas, jogos nas colunas e totais individuais.</p>
            </div>
            <Button variant="outline" onClick={handleExportCardsCsv} disabled={exportingCardsCsv}>
              {exportingCardsCsv ? "Exportando..." : "Exportar controle de cartoes (CSV)"}
            </Button>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
          <Card className="border-red-500/30 bg-red-950/10">
            <CardHeader>
              <CardTitle>SUSPENSO PROXIMO JOGO</CardTitle>
              <CardDescription>
                {formatDate(disciplinaryStatus.nextMatch.match_date)} • {toHomeAwayLabel(disciplinaryStatus.nextMatch.home)} •{" "}
                {disciplinaryStatus.nextMatch.opponent}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[var(--muted)]">
                Aqui aparecem somente os atletas suspensos para a proxima partida. Quem ja cumpriu suspensao nao permanece nesta lista.
              </p>

              {disciplinaryStatus.alerts.length === 0 ? (
                <Badge variant="success">Nenhum atleta suspenso para o proximo jogo</Badge>
              ) : (
                <div className="space-y-2">
                  {disciplinaryStatus.alerts.map((alert) => (
                    <div key={alert.athleteId} className="rounded-lg border border-red-500/25 bg-red-500/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/athletes/${alert.athleteId}`} className="font-medium text-white hover:text-[var(--gold)]">
                          {alert.name}
                        </Link>
                        <Badge variant="destructive">{alert.reason}</Badge>
                        <Badge variant="outline">{alert.yellowCountInCycle} amarelo(s) no ciclo</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-amber-500/30 bg-amber-950/10">
            <CardHeader>
              <CardTitle>ALERTA DE SUSPENSAO</CardTitle>
              <CardDescription>Atletas em risco para o proximo jogo por acumulacao de amarelos.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[var(--muted)]">
                Considera os amarelos acumulados no ciclo atual do REC. Quando a fase zera os cartoes, a lista e reiniciada automaticamente.
              </p>

              {disciplinaryStatus.risks.length === 0 ? (
                <Badge variant="outline">Nenhum atleta pendurado neste momento</Badge>
              ) : (
                <div className="space-y-2">
                  {disciplinaryStatus.risks.map((risk) => (
                    <div key={risk.athleteId} className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/athletes/${risk.athleteId}`} className="font-medium text-white hover:text-[var(--gold)]">
                          {risk.name}
                        </Link>
                        <Badge className="border-amber-500/35 bg-amber-500/15 text-amber-300">{risk.yellowCountInCycle} amarelos no ciclo</Badge>
                        <Badge variant="outline">Risco de suspensao no proximo amarelo</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}

      {!loading && !error && !disciplinaryStatus.supported && competitionFilter !== "ALL" && (
        <Card>
          <CardHeader>
            <CardTitle>Alerta disciplinar</CardTitle>
            <CardDescription>O calculo automatico desta tela esta configurado com base no REC do Paranaense Sub-20 2026 - 1a Divisao.</CardDescription>
          </CardHeader>
        </Card>
      )}

      {!loading && !error && !hasData && (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma estatistica encontrada</CardTitle>
            <CardDescription>
              Ainda nao ha dados em <code>match_player_stats</code> para os filtros selecionados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted)]">
              Assim que os jogos tiverem estatisticas vinculadas aos atletas, os cards e ranking aparecerao aqui.
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
                <CardDescription>Mais assistencias</CardDescription>
                <CardTitle className="text-xl">{highestAssists?.name ?? "-"}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">{highestAssists ? `${highestAssists.totalAssists} assists` : "Sem dados"}</Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Mais cartoes (amarelo/vermelho)</CardDescription>
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
              <CardDescription>score = (goals*4) + (assists*3) + (minutes/90) - (yellow*1) - (red*3)</CardDescription>
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
                      <TableCell className="text-right">
                        {row.totalYellow}/{row.totalRed}
                      </TableCell>
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
