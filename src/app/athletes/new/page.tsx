"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

const athleteSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório."),
  nickname: z.string().optional(),
  position: z.string().optional(),
  dob: z.string().optional(),
});

type AthleteFormValues = z.infer<typeof athleteSchema>;

export default function NewAthletePage() {
  const router = useRouter();
  const { toast } = useToast();

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
    const { error } = await supabase.from("athletes").insert({
      name: values.name.trim(),
      nickname: values.nickname?.trim() || null,
      position: values.position?.trim() || null,
      dob: values.dob || null,
    });

    if (error) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: "Não foi possível cadastrar o atleta. Tente novamente.",
      });
      return;
    }

    toast({
      title: "Atleta cadastrado",
      description: "Cadastro realizado com sucesso.",
    });

    router.push("/athletes");
    router.refresh();
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Novo atleta</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Preencha os dados para criar um novo registro.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/athletes">Voltar</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cadastro</CardTitle>
          <CardDescription>Os campos com * são obrigatórios.</CardDescription>
        </CardHeader>
        <CardContent>
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
                      <Input placeholder="Ex: Zagueiro" {...field} />
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
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </section>
  );
}
