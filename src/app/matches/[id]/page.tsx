"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";

type Match = {
  id: string;
  competition_name: string;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  venue: string | null;
  kickoff_time: string | null;
  referee: string | null;
  home_team: string | null;
  away_team: string | null;
};

type Stat = {
  athlete_id: string;
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
};

type Athlete = {
  id: string;
  name: string;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
  }).format(new Date(date));
}

export default function MatchDetailsPage() {
  const params = useParams<{ id: string }>();
  const matchId = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [match, setMatch] = useState<Match | null>(null);
  const [stats, setStats] = useState<Stat[]>([]);
  const [namesByAthlete, setNamesByAthlete] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;

    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const { data: matchData, error: matchError } = await supabase
          .from("matches")
          .select("id,competition_name,match_date,opponent,home,goals_for,goals_against,venue,kickoff_time,referee,home_team,away_team")
          .eq("id", matchId)
          .single<Match>();

        if (matchError || !matchData) {
          setError("Não foi possível carregar o jogo.");
          setLoading(false);
          return;
        }

        const { data: statData, error: statError } = await supabase
          .from("match_player_stats")
          .select("athlete_id,minutes,goals,assists,yellow_cards,red_cards")
          .eq("match_id", matchId)
          .order("minutes", { ascending: false });

        if (statError) {
          setError("Não foi possível carregar as estatísticas do jogo.");
          setLoading(false);
          return;
        }

        const statsRows = (statData as Stat[]) ?? [];
        const athleteIds = Array.from(new Set(statsRows.map((row) => row.athlete_id)));

        let namesMap: Record<string, string> = {};

        if (athleteIds.length > 0) {
          const { data: athletesData, error: athletesError } = await supabase
            .from("athletes")
            .select("id,name")
            .in("id", athleteIds);

          if (athletesError) {
            setError("Não foi possível carregar os nomes dos atletas.");
            setLoading(false);
            return;
          }

          namesMap = ((athletesData as Athlete[]) ?? []).reduce<Record<string, string>>((acc, athlete) => {
            acc[athlete.id] = athlete.name;
            return acc;
          }, {});
        }

        setMatch(matchData);
        setStats(statsRows);
        setNamesByAthlete(namesMap);
        setLoading(false);
      })();
    });
  }, [matchId]);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Detalhes do jogo</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Estatísticas por atleta desta partida.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/matches">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Partida</CardTitle>
          <CardDescription>Resumo geral do jogo.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando...</p>}
          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && match && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{match.competition_name}</Badge>
                <Badge variant={match.home ? "default" : "outline"}>{match.home ? "Casa" : "Fora"}</Badge>
              </div>
              <p className="text-sm text-[var(--muted)]">{formatDate(match.match_date)}</p>
              {match.goals_for === null || match.goals_against === null ? (
                <p className="text-sm text-[var(--muted)]">Partida ainda não realizada.</p>
              ) : (
                <p className="text-lg font-semibold text-white">
                  Galo {match.goals_for} x {match.goals_against} {match.opponent}
                </p>
              )}
              {match.venue && <p className="text-sm text-[var(--muted)]">Local: {match.venue}</p>}
              {match.kickoff_time && <p className="text-sm text-[var(--muted)]">Horário: {match.kickoff_time}</p>}
              {match.referee && <p className="text-sm text-[var(--muted)]">Árbitro: {match.referee}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estatísticas dos atletas</CardTitle>
          <CardDescription>Minutos e ações individuais no jogo.</CardDescription>
        </CardHeader>
        <CardContent>
          {!loading && !error && stats.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Sem estatísticas registradas para este jogo.</p>
          )}

          {!loading && !error && stats.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Atleta</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Gols</TableHead>
                  <TableHead className="text-right">Assists</TableHead>
                  <TableHead className="text-right">Amarelo</TableHead>
                  <TableHead className="text-right">Vermelho</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.map((row, idx) => (
                  <TableRow key={`${row.athlete_id}-${idx}`}>
                    <TableCell>{namesByAthlete[row.athlete_id] ?? row.athlete_id}</TableCell>
                    <TableCell className="text-right">{row.minutes}</TableCell>
                    <TableCell className="text-right">{row.goals}</TableCell>
                    <TableCell className="text-right">{row.assists}</TableCell>
                    <TableCell className="text-right">{row.yellow_cards}</TableCell>
                    <TableCell className="text-right">{row.red_cards}</TableCell>
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
