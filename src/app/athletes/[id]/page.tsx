"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

type Athlete = {
  id: string;
  name: string;
  nickname: string | null;
  position: string | null;
  dob: string | null;
};

const athleteSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório."),
  nickname: z.string().optional(),
  position: z.string().optional(),
  dob: z.string().optional(),
});

type AthleteFormValues = z.infer<typeof athleteSchema>;

export default function EditAthletePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const athleteId = useMemo(() => {
    const raw = params?.id;
    return Array.isArray(raw) ? raw[0] : raw;
  }, [params]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<AthleteFormValues>({
    resolver: zodResolver(athleteSchema),
    defaultValues: {
      name: "",
      nickname: "",
      position: "",
      dob: "",
    },
  });

  async function onSubmit(values: AthleteFormValues) {
    if (!athleteId) return;

    const { error } = await supabase
      .from("athletes")
      .update({
        name: values.name.trim(),
        nickname: values.nickname?.trim() || null,
        position: values.position?.trim() || null,
        dob: values.dob || null,
      })
      .eq("id", athleteId);

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Não foi possível atualizar o atleta.",
      });
      return;
    }

    toast({
      title: "Atleta atualizado",
      description: "As alterações foram salvas.",
    });
    router.refresh();
  }

  async function onDelete() {
    if (!athleteId) return;

    const confirmed = window.confirm("Tem certeza que deseja excluir este atleta?");
    if (!confirmed) return;

    const { error } = await supabase.from("athletes").delete().eq("id", athleteId);

    if (error) {
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

  useEffect(() => {
    if (!athleteId) return;

    Promise.resolve().then(() => {
      void (async () => {
        setLoading(true);
        setLoadError(null);

        const { data, error } = await supabase
          .from("athletes")
          .select("id,name,nickname,position,dob")
          .eq("id", athleteId)
          .single<Athlete>();

        if (error || !data) {
          setLoadError("Não foi possível carregar este atleta.");
          setLoading(false);
          return;
        }

        form.reset({
          name: data.name ?? "",
          nickname: data.nickname ?? "",
          position: data.position ?? "",
          dob: data.dob ?? "",
        });

        setLoading(false);
      })();
    });
  }, [athleteId, form]);

  if (!athleteId) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-red-400">ID de atleta inválido.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Editar atleta</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Atualize os dados cadastrais.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/athletes">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados do atleta</CardTitle>
          <CardDescription>Edite os campos e salve as alterações.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-[var(--muted)]">Carregando atleta...</p>}

          {!loading && loadError && <p className="text-sm text-red-400">{loadError}</p>}

          {!loading && !loadError && (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                  <Button type="button" variant="destructive" onClick={onDelete}>
                    Excluir
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
