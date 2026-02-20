"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";

type Athlete = {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  dob: string | null;
};

type MatchInfo = {
  id: string;
  competition_name: string;
  season_year: number;
  match_date: string;
  opponent: string;
  home: boolean;
  goals_for: number;
  goals_against: number;
};

type AthleteStatRow = {
  minutes: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  match: MatchInfo | MatchInfo[] | null;
};

type Kpis = {
  games: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
};

type ChartPoint = {
  label: string;
  minutes: number;
};

const athleteSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório."),
  nickname: z.string().optional(),
  position: z.string().optional(),
  dob: z.string().optional(),
});

type AthleteFormValues = z.infer<typeof athleteSchema>;

function toDateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(value));
}

function toHomeAwayLabel(home: boolean) {
  return home ? "Casa" : "Fora";
}

function pickMatch(match: AthleteStatRow["match"]): MatchInfo | null {
  if (!match) return null;
  return Array.isArray(match) ? (match[0] ?? null) : match;
}

export default function AthleteProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const athleteId = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [athlete, setAthlete] = useState<Athlete | null>(null);
  const [statsRows, setStatsRows] = useState<AthleteStatRow[]>([]);

  const form = useForm<AthleteFormValues>({
    resolver: zodResolver(athleteSchema),
    defaultValues: {
      name: "",
      nickname: "",
      position: "",
      dob: "",
    },
  });

  useEffect(() => {
    if (!athleteId) return;

    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setError(null);

        const { data: athleteData, error: athleteError } = await supabase
          .from("athletes")
          .select("*")
          .eq("id", athleteId)
          .single<Athlete>();

        if (athleteError || !athleteData) {
          setError("Não foi possível carregar o atleta.");
          setLoading(false);
          return;
        }

        const { data: statsData, error: statsError } = await supabase
          .from("match_player_stats")
          .select(
            "minutes,goals,assists,yellow_cards,red_cards, match:matches(id,competition_name,season_year,match_date,opponent,home,goals_for,goals_against)"
          )
          .eq("athlete_id", athleteId)
          .order("created_at", { ascending: false })
          .limit(15);

        if (statsError) {
          setError("Não foi possível carregar estatísticas do atleta.");
          setLoading(false);
          return;
        }

        setAthlete(athleteData);
        form.reset({
          name: athleteData.name ?? "",
          nickname: athleteData.nickname ?? "",
          position: athleteData.position ?? "",
          dob: athleteData.dob ?? "",
        });
        setStatsRows((statsData as AthleteStatRow[]) ?? []);
        setLoading(false);
      })();
    });
  }, [athleteId, form]);

  const normalizedRows = useMemo(
    () =>
      statsRows
        .map((row) => ({
          ...row,
          match: pickMatch(row.match),
        }))
        .filter((row) => row.match !== null),
    [statsRows]
  );

  const kpis = useMemo<Kpis>(() => {
    return normalizedRows.reduce(
      (acc, row) => ({
        games: acc.games + 1,
        minutes: acc.minutes + (row.minutes ?? 0),
        goals: acc.goals + (row.goals ?? 0),
        assists: acc.assists + (row.assists ?? 0),
        yellow: acc.yellow + (row.yellow_cards ?? 0),
        red: acc.red + (row.red_cards ?? 0),
      }),
      { games: 0, minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0 }
    );
  }, [normalizedRows]);

  const chartData = useMemo<ChartPoint[]>(() => {
    return [...normalizedRows]
      .sort((a, b) => new Date(a.match!.match_date).getTime() - new Date(b.match!.match_date).getTime())
      .map((row) => ({
        label: toDateLabel(row.match!.match_date),
        minutes: row.minutes ?? 0,
      }));
  }, [normalizedRows]);

  async function handleSave(values: AthleteFormValues) {
    if (!athleteId) return;

    const { error: updateError } = await supabase
      .from("athletes")
      .update({
        name: values.name.trim(),
        nickname: values.nickname?.trim() || null,
        position: values.position?.trim() || null,
        dob: values.dob || null,
      })
      .eq("id", athleteId);

    if (updateError) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Não foi possível atualizar o atleta.",
      });
      return;
    }

    setAthlete((prev) =>
      prev
        ? {
            ...prev,
            name: values.name.trim(),
            nickname: values.nickname?.trim() || null,
            position: values.position?.trim() || null,
            dob: values.dob || null,
          }
        : prev
    );

    toast({
      title: "Dados atualizados",
      description: "Perfil do atleta atualizado com sucesso.",
    });
    router.refresh();
  }

  async function handleDelete() {
    if (!athleteId) return;

    const confirmed = window.confirm("Tem certeza que deseja excluir este atleta?");
    if (!confirmed) return;

    const { error: deleteError } = await supabase.from("athletes").delete().eq("id", athleteId);

    if (deleteError) {
      toast({
        variant: "destructive",
        title: "Erro ao excluir",
        description: "Não foi possível excluir o atleta.",
      });
      return;
    }

    toast({
      title: "Atleta excluído",
      description: "Registro removido com sucesso.",
    });

    router.push("/athletes");
    router.refresh();
  }

  if (!athleteId) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-red-400">ID de atleta inválido.</p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Carregando perfil do atleta...</p>;
  }

  if (error || !athlete) {
    return <p className="text-sm text-red-400">{error ?? "Atleta não encontrado."}</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{athlete.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {athlete.position && <Badge>{athlete.position}</Badge>}
            {athlete.nickname && <Badge variant="outline">{athlete.nickname}</Badge>}
            <Badge variant="success">Perfil do Atleta</Badge>
          </div>
        </div>

        <Button asChild variant="outline">
          <Link href="/athletes">Voltar</Link>
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="edit">Editar</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Jogos</CardDescription>
                <CardTitle className="text-3xl">{kpis.games}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Minutos</CardDescription>
                <CardTitle className="text-3xl">{kpis.minutes}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Gols</CardDescription>
                <CardTitle className="text-3xl">{kpis.goals}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Assistências</CardDescription>
                <CardTitle className="text-3xl">{kpis.assists}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Amarelos</CardDescription>
                <CardTitle className="text-3xl">{kpis.yellow}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Vermelhos</CardDescription>
                <CardTitle className="text-3xl">{kpis.red}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Minutos por jogo</CardTitle>
              <CardDescription>Últimos 15 jogos do atleta.</CardDescription>
            </CardHeader>
            <CardContent className="h-[320px]">
              {chartData.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Sem jogos suficientes para o gráfico.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.12)" />
                    <XAxis dataKey="label" stroke="#A0A0A0" tick={{ fill: "#A0A0A0", fontSize: 12 }} />
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

          <Card>
            <CardHeader>
              <CardTitle>Últimos jogos</CardTitle>
              <CardDescription>Desempenho individual recente.</CardDescription>
            </CardHeader>
            <CardContent>
              {normalizedRows.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Sem jogos registrados para este atleta.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Competição</TableHead>
                      <TableHead>Adversário</TableHead>
                      <TableHead>Local</TableHead>
                      <TableHead>Placar</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">G</TableHead>
                      <TableHead className="text-right">A</TableHead>
                      <TableHead className="text-right">Am</TableHead>
                      <TableHead className="text-right">Vm</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {normalizedRows.map((row, index) => (
                      <TableRow key={`${row.match!.id}-${index}`}>
                        <TableCell>
                          <Link href={`/matches/${row.match!.id}`} className="font-medium hover:text-[var(--gold)]">
                            {toDateLabel(row.match!.match_date)}
                          </Link>
                        </TableCell>
                        <TableCell>{row.match!.competition_name}</TableCell>
                        <TableCell>{row.match!.opponent}</TableCell>
                        <TableCell>{toHomeAwayLabel(row.match!.home)}</TableCell>
                        <TableCell>
                          {row.match!.goals_for} x {row.match!.goals_against}
                        </TableCell>
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
        </TabsContent>

        <TabsContent value="edit">
          <Card className="max-w-2xl">
            <CardHeader>
              <CardTitle>Editar atleta</CardTitle>
              <CardDescription>Atualize os dados cadastrais sem sair do perfil.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSave)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nome *</FormLabel>
                        <FormControl>
                          <Input placeholder="Nome do atleta" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="nickname"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Apelido</FormLabel>
                        <FormControl>
                          <Input placeholder="Apelido" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Posição</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Lateral" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dob"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data de nascimento</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="submit" disabled={form.formState.isSubmitting}>
                      {form.formState.isSubmitting ? "Salvando..." : "Salvar"}
                    </Button>
                    <Button type="button" variant="destructive" onClick={handleDelete}>
                      Excluir atleta
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
