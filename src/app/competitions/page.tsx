import { Card } from "@/components/ui/card";

export default function CompetitionsPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Competições</h1>
      <Card>
        <h2 className="text-xl font-semibold">Calendário competitivo</h2>
        <p className="mt-2 text-[var(--muted)]">Espaço preparado para jogos, desempenho por rodada e histórico.</p>
      </Card>
    </section>
  );
}
