alter table public.match_player_stats
  add column if not exists assists int not null default 0,
  add column if not exists athlete_name_raw text,
  add column if not exists cbf_registry text,
  add column if not exists participated boolean not null default false,
  add column if not exists document_id uuid references public.documents(id) on delete set null,
  add column if not exists event_uid text,
  add column if not exists match_key text;

update public.match_player_stats
set
  minutes = coalesce(minutes, minutes_played, 0),
  yellow = coalesce(yellow, yellow_cards, 0),
  red = coalesce(red, red_cards, 0),
  match_key = coalesce(match_key, 'PROD:' || match_id::text)
where
  minutes is null
  or yellow is null
  or red is null
  or match_key is null;

alter table public.match_player_stats
  alter column event_uid set not null,
  alter column match_key set not null;

create or replace function public.match_player_stats_block_derived_updates()
returns trigger
language plpgsql
as $$
begin
  if old.source = 'DERIVED' then
    raise exception 'match_player_stats rows with source=DERIVED are immutable. Use rebuild pipeline.';
  end if;
  return new;
end;
$$;

drop trigger if exists match_player_stats_block_derived_updates_bu on public.match_player_stats;
create trigger match_player_stats_block_derived_updates_bu
before update on public.match_player_stats
for each row
execute function public.match_player_stats_block_derived_updates();
