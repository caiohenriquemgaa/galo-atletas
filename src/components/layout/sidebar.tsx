"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshCcw, Stethoscope, Trophy, Users, X, LayoutDashboard, CalendarDays, BarChart3, Link2 } from "lucide-react";

type SidebarProps = {
  mobileOpen: boolean;
  onClose: () => void;
};

const links = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/athletes", label: "Atletas", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/matches", label: "Jogos", icon: CalendarDays },
  { href: "/competitions", label: "Competições", icon: Trophy },
  { href: "/medical", label: "Médico", icon: Stethoscope },
  { href: "/admin/sync", label: "Admin Sync", icon: RefreshCcw },
  { href: "/admin/pending", label: "Pendências", icon: Link2 },
];

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="mt-6 flex flex-col gap-2">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;

        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active
                ? "border border-[var(--gold)]/40 bg-[var(--gold)]/15 text-[var(--gold)]"
                : "text-[var(--muted)] hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <div className="rounded-xl border border-[var(--gold)]/35 bg-[var(--gold)]/10 p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--gold)]">Sistema</p>
        <h2 className="mt-1 text-lg font-semibold text-white">Gestão de Atletas</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Galo Maringá</p>
      </div>
      <NavLinks pathname={pathname} onNavigate={onNavigate} />
    </>
  );
}

export function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-white/10 bg-[#101010] p-5 md:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden ${mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />

      <aside
        className={`fixed left-0 top-0 z-50 h-screen w-72 border-r border-white/10 bg-[#101010] p-5 transition-transform md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mb-3 flex justify-end">
          <button
            aria-label="Fechar menu"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-white transition hover:border-[var(--gold)] hover:text-[var(--gold)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SidebarContent pathname={pathname} onNavigate={onClose} />
      </aside>
    </>
  );
}
