"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/lib/supabase/client";

type Match = {
  id: string;
  match_date: string;
};

type StatRow = {
  match_id: string;
  minutes: number;
  yellow_cards: number;
  red_cards: number;
};

type Kpis = {
  totalAthletes: number;
  totalMatches: number;
  totalMinutes: number;
  totalYellow: number;
  totalRed: number;
};

type MinutesByMatchPoint = {
  date: string;
  minutes: number;
};

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", { month: "2-digit", day: "2-digit" }).format(new Date(date));
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<Kpis>({
    totalAthletes: 0,
    totalMatches: 0,
    totalMinutes: 0,
    totalYellow: 0,
    totalRed: 0,
  });
  const [minutesByMatch, setMinutesByMatch] = useState<MinutesByMatchPoint[]>([]);

  useEffect(() => {
    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const [{ count: athletesCount, error: athletesError }, { count: matchesCount, error: matchesError }] =
          await Promise.all([
            supabase.from("athletes").select("id", { count: "exact", head: true }),
            supabase.from("matches").select("id", { count: "exact", head: true }),
          ]);

        if (athletesError || matchesError) {
          setError("Não foi possível carregar os KPIs do dashboard.");
          setLoading(false);
          return;
        }

        const { data: allStats, error: statsError } = await supabase
          .from("match_player_stats")
          .select("match_id,minutes,yellow_cards,red_cards");

        if (statsError) {
          setError("Não foi possível carregar as estatísticas dos jogos.");
          setLoading(false);
          return;
        }

        const statsRows = (allStats as StatRow[]) ?? [];

        const totalMinutes = statsRows.reduce((acc, row) => acc + (row.minutes ?? 0), 0);
        const totalYellow = statsRows.reduce((acc, row) => acc + (row.yellow_cards ?? 0), 0);
        const totalRed = statsRows.reduce((acc, row) => acc + (row.red_cards ?? 0), 0);

        const { data: lastMatches, error: lastMatchesError } = await supabase
          .from("matches")
          .select("id,match_date")
          .order("match_date", { ascending: false })
          .limit(10);

        if (lastMatchesError) {
          setError("Não foi possível carregar os jogos para o gráfico.");
          setLoading(false);
          return;
        }

        const orderedMatches = ((lastMatches as Match[]) ?? []).slice().reverse();
        const minutesByMatchId = statsRows.reduce<Record<string, number>>((acc, row) => {
          acc[row.match_id] = (acc[row.match_id] ?? 0) + (row.minutes ?? 0);
          return acc;
        }, {});

        const chartPoints = orderedMatches.map((match) => ({
          date: formatShortDate(match.match_date),
          minutes: minutesByMatchId[match.id] ?? 0,
        }));

        setKpis({
          totalAthletes: athletesCount ?? 0,
          totalMatches: matchesCount ?? 0,
          totalMinutes,
          totalYellow,
          totalRed,
        });
        setMinutesByMatch(chartPoints);
        setLoading(false);
      })();
    });
  }, []);

  const cards = useMemo(
    () => [
      { title: "Total de atletas", value: kpis.totalAthletes },
      { title: "Total de jogos", value: kpis.totalMatches },
      { title: "Total de minutos", value: kpis.totalMinutes },
      { title: "Cartões (A/V)", value: `${kpis.totalYellow} / ${kpis.totalRed}` },
    ],
    [kpis]
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Indicadores consolidados do elenco e dos jogos.</p>
        </div>
        <Badge>Visão geral</Badge>
      </div>

      {loading && <p className="text-sm text-[var(--muted)]">Carregando dashboard...</p>}
      {!loading && error && <p className="text-sm text-red-400">{error}</p>}

      {!loading && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => (
              <Card key={card.title}>
                <CardHeader className="pb-2">
                  <CardDescription>{card.title}</CardDescription>
                  <CardTitle className="text-3xl">{card.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Minutos por jogo</CardTitle>
              <CardDescription>Somatório de minutos por partida nos últimos 10 jogos.</CardDescription>
            </CardHeader>
            <CardContent className="h-[340px]">
              {minutesByMatch.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Sem dados de jogos para exibir no gráfico.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={minutesByMatch}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                    <XAxis dataKey="date" stroke="#A0A0A0" tick={{ fill: "#A0A0A0", fontSize: 12 }} />
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
                    <Bar dataKey="minutes" fill="#C9A227" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
