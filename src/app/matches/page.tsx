"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase/client";

type MatchRow = {
  id: string;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number;
  goals_against: number;
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(new Date(date));
}

export default function MatchesPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadMatches() {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("matches")
      .select("id,match_date,opponent,home,goals_for,goals_against")
      .order("match_date", { ascending: false })
      .limit(20);

    if (queryError) {
      setError("Não foi possível carregar os jogos.");
      setMatches([]);
    } else {
      setMatches((data as MatchRow[]) ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadMatches();
    });
  }, []);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Jogos</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Últimos jogos importados no sistema.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de jogos</CardTitle>
          <CardDescription>Selecione um jogo para ver os detalhes.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando jogos...</p>}
          {!loading && error && <p className="text-sm text-red-400">{error}</p>}

          {!loading && !error && matches.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Nenhum jogo encontrado.</p>
          )}

          {!loading && !error && matches.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Adversário</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead className="text-right">Placar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.map((match) => (
                  <TableRow key={match.id}>
                    <TableCell>
                      <Link href={`/matches/${match.id}`} className="font-medium hover:text-[var(--gold)]">
                        {formatDate(match.match_date)}
                      </Link>
                    </TableCell>
                    <TableCell>{match.opponent}</TableCell>
                    <TableCell>
                      <Badge variant={match.home ? "default" : "outline"}>{match.home ? "Casa" : "Fora"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {match.goals_for} x {match.goals_against}
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
