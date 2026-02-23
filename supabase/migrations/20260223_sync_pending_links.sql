create extension if not exists pgcrypto;

create table if not exists public.sync_pending_links (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists sync_pending_links_created_at_idx
  on public.sync_pending_links (created_at desc);

create index if not exists sync_pending_links_resolved_at_idx
  on public.sync_pending_links (resolved_at);

create index if not exists sync_pending_links_source_kind_idx
  on public.sync_pending_links (source, kind);
