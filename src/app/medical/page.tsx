import { Card } from "@/components/ui/card";

export default function MedicalPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Médico</h1>
      <Card>
        <h2 className="text-xl font-semibold">Saúde e acompanhamento</h2>
        <p className="mt-2 text-[var(--muted)]">Gestão inicial para exames, lesões, retorno e carga de treino.</p>
      </Card>
    </section>
  );
}
