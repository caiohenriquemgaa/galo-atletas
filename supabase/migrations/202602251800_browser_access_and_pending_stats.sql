grant usage on schema public to anon, authenticated;

grant select on public.athletes to anon, authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.competitions_registry to anon, authenticated;
grant select on public.sync_runs to anon, authenticated;
grant select on public.match_player_stats to anon, authenticated;

grant insert, update, delete on public.athletes to anon, authenticated;
grant insert, update, delete on public.competitions_registry to anon, authenticated;

alter table public.athletes disable row level security;
alter table public.matches disable row level security;
alter table public.competitions_registry disable row level security;
alter table public.sync_runs disable row level security;
alter table public.match_player_stats disable row level security;

alter table public.match_player_stats
  alter column athlete_id drop not null;

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
    new.event_uid := md5(
      concat_ws(
        '|',
        coalesce(new.athlete_id::text, ''),
        coalesce(new.cbf_registry, ''),
        coalesce(new.athlete_name_raw, ''),
        coalesce(new.source, 'DERIVED')
      )
    );
  end if;

  return new;
end;
$$;
