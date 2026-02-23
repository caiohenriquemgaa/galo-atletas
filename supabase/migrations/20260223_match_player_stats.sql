create extension if not exists pgcrypto;

create table if not exists public.match_player_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  athlete_id uuid null references public.athletes(id) on delete set null,
  cbf_registry text null,
  athlete_name_raw text null,
  minutes int null,
  goals int not null default 0,
  assists int not null default 0,
  yellow int not null default 0,
  red int not null default 0,
  yellow_cards int generated always as (yellow) stored,
  red_cards int generated always as (red) stored,
  source text not null default 'FPF',
  created_at timestamptz not null default now()
);

alter table public.match_player_stats
  add column if not exists cbf_registry text null,
  add column if not exists athlete_name_raw text null,
  add column if not exists minutes int null,
  add column if not exists goals int not null default 0,
  add column if not exists assists int not null default 0,
  add column if not exists yellow int not null default 0,
  add column if not exists red int not null default 0,
  add column if not exists source text not null default 'FPF',
  add column if not exists created_at timestamptz not null default now();

alter table public.match_player_stats
  add column if not exists yellow_cards int generated always as (yellow) stored,
  add column if not exists red_cards int generated always as (red) stored;

create unique index if not exists match_player_stats_match_athlete_unique
  on public.match_player_stats (match_id, athlete_id)
  where athlete_id is not null;

create index if not exists match_player_stats_match_id_idx
  on public.match_player_stats (match_id);

create index if not exists match_player_stats_cbf_registry_idx
  on public.match_player_stats (cbf_registry);
