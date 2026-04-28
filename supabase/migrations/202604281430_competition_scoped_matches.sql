alter table public.competitions_registry
add column if not exists fpf_competition_id text,
add column if not exists external_competition_id text;

update public.competitions_registry
set
  fpf_competition_id = coalesce(fpf_competition_id, substring(url_base from '/([0-9]+)/?$')),
  external_competition_id = coalesce(external_competition_id, substring(url_base from '/([0-9]+)/?$'))
where url_base is not null;

update public.competitions_registry
set
  url_base = 'https://federacaopr.com.br/campeonato/base/2026/45/',
  fpf_competition_id = '45',
  external_competition_id = '45'
where season_year = 2026
  and upper(name) like '%SUB-15%';

update public.competitions_registry
set
  url_base = 'https://federacaopr.com.br/campeonato/base/2026/47/',
  fpf_competition_id = '47',
  external_competition_id = '47'
where season_year = 2026
  and upper(name) like '%SUB-20%'
  and upper(name) like '%1%DIVIS%';

alter table public.matches
add column if not exists competition_registry_id uuid references public.competitions_registry(id) on delete set null;

update public.matches m
set competition_registry_id = c.id
from public.competitions_registry c
where m.competition_registry_id is null
  and m.competition_name = c.name
  and m.season_year = c.season_year;

update public.matches
set external_match_id = substring(source_url from '/jogo/([0-9]+)/?$')
where source = 'FPF'
  and external_match_id is null
  and source_url is not null
  and source_url !~ '^FPF:';

create unique index if not exists matches_source_competition_external_match_key
on public.matches (source, competition_registry_id, season_year, external_match_id)
where external_match_id is not null and competition_registry_id is not null;

create index if not exists matches_external_match_id_idx
on public.matches (source, external_match_id);

create index if not exists matches_competition_registry_id_idx
on public.matches (competition_registry_id);
