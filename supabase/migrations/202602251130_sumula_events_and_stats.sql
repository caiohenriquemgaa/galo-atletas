create extension if not exists pgcrypto;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  doc_type text not null default 'FPF_SUMULA',
  source text not null default 'FPF',
  storage_bucket text not null default 'match-reports',
  storage_path text not null,
  checksum_sha256 text null,
  uploaded_at timestamptz not null default now(),
  unique (source, doc_type, match_id)
);

create table if not exists public.match_lineups (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  cbf_registry text null,
  shirt_number int null,
  role text not null,
  is_captain boolean not null default false,
  source text not null default 'FPF_SUMULA',
  created_at timestamptz not null default now(),
  unique (match_id, team_side, athlete_id, source),
  constraint match_lineups_team_side_check check (team_side in ('HOME', 'AWAY')),
  constraint match_lineups_role_check check (role in ('STARTER', 'RESERVE', 'GK_STARTER', 'GK_RESERVE'))
);

create index if not exists match_lineups_match_id_idx
  on public.match_lineups (match_id);

create index if not exists match_lineups_athlete_id_idx
  on public.match_lineups (athlete_id);

create index if not exists match_lineups_match_team_side_idx
  on public.match_lineups (match_id, team_side);

create table if not exists public.match_goals (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  cbf_registry text null,
  shirt_number int null,
  half smallint not null,
  minute int not null,
  kind text not null default 'GOAL',
  source text not null default 'FPF_SUMULA',
  created_at timestamptz not null default now(),
  unique (match_id, team_side, half, minute, athlete_id, kind, source),
  constraint match_goals_team_side_check check (team_side in ('HOME', 'AWAY')),
  constraint match_goals_half_check check (half in (1, 2))
);

create index if not exists match_goals_match_id_idx
  on public.match_goals (match_id);

create index if not exists match_goals_athlete_id_idx
  on public.match_goals (athlete_id);

create index if not exists match_goals_match_team_side_idx
  on public.match_goals (match_id, team_side);

create table if not exists public.match_cards (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  half smallint not null,
  minute int not null,
  card_type text not null,
  reason text null,
  source text not null default 'FPF_SUMULA',
  created_at timestamptz not null default now(),
  unique (match_id, team_side, half, minute, athlete_id, card_type, source),
  constraint match_cards_team_side_check check (team_side in ('HOME', 'AWAY')),
  constraint match_cards_half_check check (half in (1, 2)),
  constraint match_cards_card_type_check check (card_type in ('YELLOW', 'RED', 'SECOND_YELLOW'))
);

create index if not exists match_cards_match_id_idx
  on public.match_cards (match_id);

create index if not exists match_cards_athlete_id_idx
  on public.match_cards (athlete_id);

create table if not exists public.match_substitutions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  team_side text not null,
  half smallint not null,
  minute int not null,
  athlete_out_id uuid not null references public.athletes(id) on delete restrict,
  athlete_in_id uuid not null references public.athletes(id) on delete restrict,
  source text not null default 'FPF_SUMULA',
  created_at timestamptz not null default now(),
  unique (match_id, team_side, half, minute, athlete_out_id, athlete_in_id, source),
  constraint match_substitutions_team_side_check check (team_side in ('HOME', 'AWAY')),
  constraint match_substitutions_half_check check (half in (1, 2))
);

create index if not exists match_substitutions_match_id_idx
  on public.match_substitutions (match_id);

create index if not exists match_substitutions_athlete_out_id_idx
  on public.match_substitutions (athlete_out_id);

create index if not exists match_substitutions_athlete_in_id_idx
  on public.match_substitutions (athlete_in_id);

create table if not exists public.match_player_stats (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  athlete_id uuid not null references public.athletes(id) on delete restrict,
  team_side text not null,
  minutes_played int not null default 0,
  started boolean not null default false,
  is_captain boolean not null default false,
  goals int not null default 0,
  yellow_cards int not null default 0,
  red_cards int not null default 0,
  source text not null default 'DERIVED',
  updated_at timestamptz not null default now(),
  unique (match_id, athlete_id, source)
);

alter table public.match_player_stats
  add column if not exists team_side text,
  add column if not exists minutes_played int not null default 0,
  add column if not exists started boolean not null default false,
  add column if not exists is_captain boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

-- If old generated columns exist, replace them with writable aggregate columns.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_player_stats'
      and column_name = 'yellow_cards'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.match_player_stats drop column yellow_cards;
    alter table public.match_player_stats add column yellow_cards int not null default 0;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_player_stats'
      and column_name = 'red_cards'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.match_player_stats drop column red_cards;
    alter table public.match_player_stats add column red_cards int not null default 0;
  end if;
end $$;

alter table public.match_player_stats
  add column if not exists yellow_cards int not null default 0,
  add column if not exists red_cards int not null default 0;

update public.match_player_stats
set
  minutes_played = coalesce(minutes_played, minutes, 0),
  yellow_cards = coalesce(yellow_cards, yellow, 0),
  red_cards = coalesce(red_cards, red, 0),
  team_side = coalesce(team_side, 'HOME')
where
  minutes_played is null
  or yellow_cards is null
  or red_cards is null
  or team_side is null;

update public.match_player_stats
set source = 'DERIVED'
where source is null or source = 'FPF';

-- Derived table can be safely recomputed, so rows without athlete mapping are removed.
delete from public.match_player_stats
where athlete_id is null;

alter table public.match_player_stats
  alter column athlete_id set not null,
  alter column source set default 'DERIVED',
  alter column team_side set not null,
  alter column updated_at set default now();

alter table public.match_player_stats
  drop constraint if exists match_player_stats_athlete_id_fkey;

alter table public.match_player_stats
  add constraint match_player_stats_athlete_id_fkey
  foreign key (athlete_id) references public.athletes(id) on delete restrict;

drop index if exists public.match_player_stats_match_athlete_unique;

create unique index if not exists match_player_stats_match_athlete_source_unique
  on public.match_player_stats (match_id, athlete_id, source);

create index if not exists match_player_stats_match_id_idx
  on public.match_player_stats (match_id);

create index if not exists match_player_stats_athlete_id_idx
  on public.match_player_stats (athlete_id);

create index if not exists match_player_stats_match_team_side_idx
  on public.match_player_stats (match_id, team_side);

-- Event tables are the source of truth for official match occurrences.
-- match_player_stats is a derived aggregate and can be recalculated at any time.
