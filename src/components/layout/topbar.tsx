"use client";

import { Bell, Menu, Search } from "lucide-react";

type TopbarProps = {
  onMenuClick: () => void;
};

export function Topbar({ onMenuClick }: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-[var(--bg)]/85 px-4 backdrop-blur md:px-8">
      <button
        aria-label="Abrir menu"
        onClick={onMenuClick}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white transition hover:border-[var(--gold)] hover:text-[var(--gold)] md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-[var(--muted)] md:flex">
        <Search className="h-4 w-4" />
        <span className="text-sm">Buscar atletas, exames e competições...</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="rounded-full border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-3 py-1 text-xs font-semibold text-[var(--gold)]">
          Galo Maringá
        </span>
        <button
          aria-label="Notificações"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-white transition hover:border-[var(--gold)] hover:text-[var(--gold)]"
        >
          <Bell className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
