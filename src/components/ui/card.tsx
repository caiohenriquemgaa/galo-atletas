import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export function Card({ children, className = "" }: CardProps) {
  return (
    <section className={`app-card rounded-xl border border-white/10 bg-[var(--card)] p-6 shadow-lg shadow-black/20 ${className}`}>
      {children}
    </section>
  );
}
