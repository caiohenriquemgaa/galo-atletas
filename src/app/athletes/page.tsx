import { Card } from "@/components/ui/card";

export default function AthletesPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Atletas</h1>
      <Card>
        <h2 className="text-xl font-semibold">Cadastro e elenco</h2>
        <p className="mt-2 text-[var(--muted)]">Área inicial para listagem, filtros e gestão do plantel.</p>
      </Card>
    </section>
  );
}
