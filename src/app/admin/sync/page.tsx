import { Card } from "@/components/ui/card";

export default function AdminSyncPage() {
  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Admin Sync</h1>
      <Card>
        <h2 className="text-xl font-semibold">Integrações e sincronização</h2>
        <p className="mt-2 text-[var(--muted)]">Base pronta para rotinas de importação/exportação e jobs administrativos.</p>
      </Card>
    </section>
  );
}
