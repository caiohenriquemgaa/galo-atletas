create extension if not exists pgcrypto;

create table if not exists public.competitions_registry (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  season_year int not null,
  url_base text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint competitions_registry_category_check check (category in ('PROFISSIONAL', 'BASE')),
  constraint competitions_registry_season_year_check check (season_year >= 2000)
);

create unique index if not exists competitions_registry_name_season_year_key
  on public.competitions_registry (name, season_year);

create index if not exists competitions_registry_active_idx
  on public.competitions_registry (is_active);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary_json jsonb,
  error_text text,
  constraint sync_runs_status_check check (status in ('RUNNING', 'DONE', 'ERROR'))
);

create index if not exists sync_runs_started_at_idx
  on public.sync_runs (started_at desc);

create index if not exists sync_runs_status_idx
  on public.sync_runs (status);

create table if not exists public.athletes (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'MANUAL',
  cbf_registry text,
  name text not null,
  nickname text,
  position text,
  dob date,
  habilitation_date date,
  club_name text,
  fpf_competition_id text,
  is_active_fpf boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists athletes_source_cbf_registry_key
  on public.athletes (source, cbf_registry)
  where cbf_registry is not null;

create index if not exists athletes_name_idx
  on public.athletes (name);

create index if not exists athletes_club_name_idx
  on public.athletes (club_name);

create index if not exists athletes_source_idx
  on public.athletes (source);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  competition_name text not null,
  season_year int not null,
  match_date date not null,
  opponent text not null,
  home boolean not null default false,
  goals_for int,
  goals_against int,
  source text not null default 'MOCK',
  source_url text,
  external_match_id text,
  venue text,
  kickoff_time text,
  referee text,
  home_team text,
  away_team text,
  created_at timestamptz not null default now()
);

create index if not exists matches_match_date_idx
  on public.matches (match_date desc);

create index if not exists matches_competition_season_idx
  on public.matches (competition_name, season_year);

create index if not exists matches_source_idx
  on public.matches (source);
