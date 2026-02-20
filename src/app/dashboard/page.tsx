import { Card } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Dashboard</h1>
        <span className="badge-gold">Visão geral</span>
      </div>

      <Card>
        <h2 className="text-xl font-semibold">Painel inicial</h2>
        <p className="mt-2 text-[var(--muted)]">Acompanhe indicadores de atletas, performance e status médico.</p>
      </Card>
    </section>
  );
}
