alter table public.documents
  drop constraint if exists documents_status_check;

alter table public.documents
  add constraint documents_status_check
  check (status in ('UPLOADED', 'PARSED_RAW', 'CANONICAL', 'EVENTS_SAVED', 'ERROR'));

alter table public.match_lineups
  alter column match_id drop not null,
  alter column athlete_id drop not null,
  add column if not exists athlete_name_raw text;

alter table public.match_goals
  alter column match_id drop not null,
  alter column athlete_id drop not null,
  add column if not exists athlete_name_raw text;

alter table public.match_cards
  alter column match_id drop not null,
  alter column athlete_id drop not null,
  add column if not exists athlete_name_raw text;

alter table public.match_substitutions
  alter column match_id drop not null,
  alter column athlete_out_id drop not null,
  alter column athlete_in_id drop not null,
  add column if not exists athlete_out_name_raw text,
  add column if not exists athlete_in_name_raw text;
