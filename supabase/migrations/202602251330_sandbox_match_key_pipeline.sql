create extension if not exists pgcrypto;

create table if not exists public.sandbox_matches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  home_team text not null,
  away_team text not null,
  match_date timestamptz not null,
  competition text null,
  category text null,
  season int null,
  created_at timestamptz not null default now()
);

alter table public.documents
  add column if not exists scope text,
  add column if not exists match_key text,
  add column if not exists parser_version text,
  add column if not exists sha256 text,
  add column if not exists sandbox_match_id uuid references public.sandbox_matches(id) on delete cascade;

update public.documents
set scope = 'PROD'
where scope is null;

update public.documents
set sha256 = coalesce(sha256, checksum_sha256)
where sha256 is null;

-- Decision: enforce match_key derivation at database level with a trigger.
-- This keeps PROD/SANDBOX invariants consistent even if writes come from multiple services.
create or replace function public.documents_set_scope_and_match_key()
returns trigger
language plpgsql
as $$
begin
  new.scope := coalesce(new.scope, 'PROD');

  if new.scope = 'PROD' then
    if new.match_id is null then
      raise exception 'documents.match_id is required when scope=PROD';
    end if;

    if new.sandbox_match_id is not null then
      raise exception 'documents.sandbox_match_id must be null when scope=PROD';
    end if;

    new.match_key := 'PROD:' || new.match_id::text;
  elsif new.scope = 'SANDBOX' then
    if new.sandbox_match_id is null then
      raise exception 'documents.sandbox_match_id is required when scope=SANDBOX';
    end if;

    if new.match_id is not null then
      raise exception 'documents.match_id must be null when scope=SANDBOX';
    end if;

    new.match_key := 'SANDBOX:' || new.sandbox_match_id::text;
  else
    raise exception 'documents.scope must be PROD or SANDBOX';
  end if;

  if new.sha256 is null and new.checksum_sha256 is not null then
    new.sha256 := new.checksum_sha256;
  end if;

  return new;
end;
$$;

drop trigger if exists documents_scope_match_key_biu on public.documents;
create trigger documents_scope_match_key_biu
before insert or update on public.documents
for each row
execute function public.documents_set_scope_and_match_key();

update public.documents
set match_key = 'PROD:' || match_id::text
where match_id is not null
  and (match_key is null or match_key = '');

alter table public.documents
  alter column match_id drop not null;

alter table public.documents
  drop constraint if exists documents_scope_check;

alter table public.documents
  add constraint documents_scope_check
  check (scope in ('SANDBOX', 'PROD'));

alter table public.documents
  add constraint documents_match_scope_check
  check (
    (scope = 'PROD' and match_id is not null and sandbox_match_id is null)
    or (scope = 'SANDBOX' and sandbox_match_id is not null and match_id is null)
  );

alter table public.documents
  alter column scope set default 'PROD',
  alter column scope set not null,
  alter column match_key set not null;

alter table public.documents
  drop constraint if exists documents_source_doc_type_match_id_key;

create unique index if not exists documents_source_doc_type_match_key_key
  on public.documents (source, doc_type, match_key);

create index if not exists documents_match_key_idx
  on public.documents (match_key);

-- Event tables keep backwards compatibility with existing match_id writes:
-- if match_key/event_uid are omitted, triggers backfill them from row content.
create or replace function public.match_lineups_fill_scope_fields()
returns trigger
language plpgsql
as $$
begin
  if new.match_key is null and new.match_id is not null then
    new.match_key := 'PROD:' || new.match_id::text;
  end if;

  if new.match_key is null then
    raise exception 'match_lineups.match_key is required';
  end if;

  if new.event_uid is null or btrim(new.event_uid) = '' then
    new.event_uid := md5(concat_ws('|', new.team_side, new.athlete_id::text, new.role, coalesce(new.source, 'FPF_SUMULA')));
  end if;

  return new;
end;
$$;

create or replace function public.match_goals_fill_scope_fields()
returns trigger
language plpgsql
as $$
begin
  if new.match_key is null and new.match_id is not null then
    new.match_key := 'PROD:' || new.match_id::text;
  end if;

  if new.match_key is null then
    raise exception 'match_goals.match_key is required';
  end if;

  if new.event_uid is null or btrim(new.event_uid) = '' then
    new.event_uid := md5(concat_ws('|', new.team_side, new.athlete_id::text, new.half::text, new.minute::text, coalesce(new.kind, 'GOAL'), coalesce(new.source, 'FPF_SUMULA')));
  end if;

  return new;
end;
$$;

create or replace function public.match_cards_fill_scope_fields()
returns trigger
language plpgsql
as $$
begin
  if new.match_key is null and new.match_id is not null then
    new.match_key := 'PROD:' || new.match_id::text;
  end if;

  if new.match_key is null then
    raise exception 'match_cards.match_key is required';
  end if;

  if new.event_uid is null or btrim(new.event_uid) = '' then
    new.event_uid := md5(concat_ws('|', new.team_side, new.athlete_id::text, new.half::text, new.minute::text, new.card_type, coalesce(new.source, 'FPF_SUMULA')));
  end if;

  return new;
end;
$$;

create or replace function public.match_substitutions_fill_scope_fields()
returns trigger
language plpgsql
as $$
begin
  if new.match_key is null and new.match_id is not null then
    new.match_key := 'PROD:' || new.match_id::text;
  end if;

  if new.match_key is null then
    raise exception 'match_substitutions.match_key is required';
  end if;

  if new.event_uid is null or btrim(new.event_uid) = '' then
    new.event_uid := md5(concat_ws('|', new.team_side, new.half::text, new.minute::text, new.athlete_out_id::text, new.athlete_in_id::text, coalesce(new.source, 'FPF_SUMULA')));
  end if;

  return new;
end;
$$;

create or replace function public.match_player_stats_fill_scope_fields()
returns trigger
language plpgsql
as $$
begin
  if new.match_key is null and new.match_id is not null then
    new.match_key := 'PROD:' || new.match_id::text;
  end if;

  if new.match_key is null then
    raise exception 'match_player_stats.match_key is required';
  end if;

  if new.event_uid is null or btrim(new.event_uid) = '' then
    new.event_uid := md5(concat_ws('|', new.athlete_id::text, coalesce(new.source, 'DERIVED')));
  end if;

  return new;
end;
$$;

alter table public.match_lineups
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists match_key text,
  add column if not exists event_uid text;

update public.match_lineups
set match_key = 'PROD:' || match_id::text
where match_key is null and match_id is not null;

update public.match_lineups
set event_uid = md5(concat_ws('|', team_side, athlete_id::text, role, coalesce(source, 'FPF_SUMULA')))
where event_uid is null or btrim(event_uid) = '';

alter table public.match_lineups
  alter column match_key set not null,
  alter column event_uid set not null;

drop trigger if exists match_lineups_scope_fields_biu on public.match_lineups;
create trigger match_lineups_scope_fields_biu
before insert or update on public.match_lineups
for each row
execute function public.match_lineups_fill_scope_fields();

create unique index if not exists match_lineups_match_key_event_uid_unique
  on public.match_lineups (match_key, event_uid);

create index if not exists match_lineups_match_key_idx
  on public.match_lineups (match_key);

create index if not exists match_lineups_document_id_idx
  on public.match_lineups (document_id);

alter table public.match_goals
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists match_key text,
  add column if not exists event_uid text;

update public.match_goals
set match_key = 'PROD:' || match_id::text
where match_key is null and match_id is not null;

update public.match_goals
set event_uid = md5(concat_ws('|', team_side, athlete_id::text, half::text, minute::text, coalesce(kind, 'GOAL'), coalesce(source, 'FPF_SUMULA')))
where event_uid is null or btrim(event_uid) = '';

alter table public.match_goals
  alter column match_key set not null,
  alter column event_uid set not null;

drop trigger if exists match_goals_scope_fields_biu on public.match_goals;
create trigger match_goals_scope_fields_biu
before insert or update on public.match_goals
for each row
execute function public.match_goals_fill_scope_fields();

create unique index if not exists match_goals_match_key_event_uid_unique
  on public.match_goals (match_key, event_uid);

create index if not exists match_goals_match_key_idx
  on public.match_goals (match_key);

create index if not exists match_goals_document_id_idx
  on public.match_goals (document_id);

alter table public.match_cards
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists match_key text,
  add column if not exists event_uid text;

update public.match_cards
set match_key = 'PROD:' || match_id::text
where match_key is null and match_id is not null;

update public.match_cards
set event_uid = md5(concat_ws('|', team_side, athlete_id::text, half::text, minute::text, card_type, coalesce(source, 'FPF_SUMULA')))
where event_uid is null or btrim(event_uid) = '';

alter table public.match_cards
  alter column match_key set not null,
  alter column event_uid set not null;

drop trigger if exists match_cards_scope_fields_biu on public.match_cards;
create trigger match_cards_scope_fields_biu
before insert or update on public.match_cards
for each row
execute function public.match_cards_fill_scope_fields();

create unique index if not exists match_cards_match_key_event_uid_unique
  on public.match_cards (match_key, event_uid);

create index if not exists match_cards_match_key_idx
  on public.match_cards (match_key);

create index if not exists match_cards_document_id_idx
  on public.match_cards (document_id);

alter table public.match_substitutions
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists match_key text,
  add column if not exists event_uid text;

update public.match_substitutions
set match_key = 'PROD:' || match_id::text
where match_key is null and match_id is not null;

update public.match_substitutions
set event_uid = md5(concat_ws('|', team_side, half::text, minute::text, athlete_out_id::text, athlete_in_id::text, coalesce(source, 'FPF_SUMULA')))
where event_uid is null or btrim(event_uid) = '';

alter table public.match_substitutions
  alter column match_key set not null,
  alter column event_uid set not null;

drop trigger if exists match_substitutions_scope_fields_biu on public.match_substitutions;
create trigger match_substitutions_scope_fields_biu
before insert or update on public.match_substitutions
for each row
execute function public.match_substitutions_fill_scope_fields();

create unique index if not exists match_substitutions_match_key_event_uid_unique
  on public.match_substitutions (match_key, event_uid);

create index if not exists match_substitutions_match_key_idx
  on public.match_substitutions (match_key);

create index if not exists match_substitutions_document_id_idx
  on public.match_substitutions (document_id);

alter table public.match_player_stats
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists match_key text,
  add column if not exists event_uid text;

update public.match_player_stats
set match_key = 'PROD:' || match_id::text
where match_key is null and match_id is not null;

update public.match_player_stats
set event_uid = md5(concat_ws('|', athlete_id::text, coalesce(source, 'DERIVED')))
where event_uid is null or btrim(event_uid) = '';

alter table public.match_player_stats
  alter column match_key set not null,
  alter column event_uid set not null;

drop trigger if exists match_player_stats_scope_fields_biu on public.match_player_stats;
create trigger match_player_stats_scope_fields_biu
before insert or update on public.match_player_stats
for each row
execute function public.match_player_stats_fill_scope_fields();

create unique index if not exists match_player_stats_match_key_event_uid_unique
  on public.match_player_stats (match_key, event_uid);

create index if not exists match_player_stats_match_key_idx
  on public.match_player_stats (match_key);

create index if not exists match_player_stats_document_id_idx
  on public.match_player_stats (document_id);
