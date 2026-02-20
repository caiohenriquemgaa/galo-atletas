"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Athlete = {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  dob: string | null;
  created_at: string;
};

export default function AthletesPage() {
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadAthletes() {
    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("athletes")
      .select("id,name,nickname,position,dob,created_at")
      .order("created_at", { ascending: false });

    if (queryError) {
      setError("Não foi possível carregar os atletas. Tente novamente.");
      setAthletes([]);
    } else {
      setAthletes(data ?? []);
    }

    setLoading(false);
  }

  useEffect(() => {
    Promise.resolve().then(() => {
      void loadAthletes();
    });
  }, []);

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Atletas</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Gerencie o elenco cadastrado no sistema.</p>
        </div>
        <Button asChild>
          <Link href="/athletes/new">Novo atleta</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Lista de atletas</CardTitle>
          <CardDescription>Clique em um atleta para abrir a edição.</CardDescription>
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
                      </div>
                      <span className="text-xs text-[var(--muted)]">Editar</span>
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
