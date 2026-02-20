"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";

type Athlete = {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  created_at: string;
};

export default function AthletesPage() {
  const [loading, setLoading] = useState(true);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadAthletes() {
    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("athletes")
      .select("id,name,nickname,position,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
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
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Atletas</h1>
        <p className="text-[var(--muted)]">Lista de atletas cadastrados no sistema.</p>
      </div>

      <Card className="p-4">
        {loading && <p>Carregando...</p>}
        {!loading && error && <p className="text-red-500">Erro: {error}</p>}
        {!loading && !error && athletes.length === 0 && <p>Nenhum atleta cadastrado ainda.</p>}

        {!loading && !error && athletes.length > 0 && (
          <ul className="space-y-2">
            {athletes.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-md border border-white/10 p-3">
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {a.position ?? "Sem posição"} {a.nickname ? `• ${a.nickname}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
