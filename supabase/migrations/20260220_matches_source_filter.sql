-- Add source segregation for matches
alter table public.matches
  add column if not exists source text not null default 'MOCK';

alter table public.matches
  add column if not exists source_url text;

-- Prevent duplicate imports from the same source URL
create unique index if not exists matches_source_source_url_key
  on public.matches (source, source_url)
  where source_url is not null;
