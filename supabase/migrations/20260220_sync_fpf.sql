-- Sync state to detect upstream changes per competition
create table if not exists public.sync_state (
  competition_id uuid primary key references public.competitions_registry(id) on delete cascade,
  last_hash text,
  last_checked_at timestamptz not null default now(),
  last_changed_at timestamptz
);

-- Fields used to deduplicate imported matches from FPF
alter table public.matches
  add column if not exists external_match_id text;

alter table public.matches
  add column if not exists source_url text;

create unique index if not exists matches_competition_external_match_id_key
  on public.matches (competition_name, season_year, external_match_id)
  where external_match_id is not null;
