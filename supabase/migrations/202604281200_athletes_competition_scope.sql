alter table public.athletes
  add column if not exists competition_name text,
  add column if not exists category_name text,
  add column if not exists season_year int,
  add column if not exists competition_registry_id uuid references public.competitions_registry(id) on delete set null;

update public.athletes a
set
  competition_name = coalesce(a.competition_name, c.name),
  category_name = coalesce(a.category_name, c.category),
  season_year = coalesce(a.season_year, c.season_year),
  competition_registry_id = coalesce(a.competition_registry_id, c.id)
from public.competitions_registry c
where a.source = 'FPF'
  and a.fpf_competition_id is not null
  and substring(c.url_base from 'competicao=([0-9]+)') = a.fpf_competition_id;

drop index if exists public.athletes_source_cbf_registry_key;

create unique index if not exists athletes_source_cbf_registry_competition_key
  on public.athletes (source, cbf_registry, competition_registry_id)
  where cbf_registry is not null and competition_registry_id is not null;

create unique index if not exists athletes_source_cbf_registry_no_competition_key
  on public.athletes (source, cbf_registry)
  where cbf_registry is not null and competition_registry_id is null;

create index if not exists athletes_competition_scope_idx
  on public.athletes (competition_name, season_year);

create index if not exists athletes_competition_registry_id_idx
  on public.athletes (competition_registry_id);
