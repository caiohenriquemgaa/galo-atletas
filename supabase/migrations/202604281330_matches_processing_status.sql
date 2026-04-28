alter table public.matches
add column if not exists processed boolean default false,
add column if not exists processed_at timestamp with time zone,
add column if not exists processing_error text,
add column if not exists parser_used text;

create index if not exists idx_matches_processing
on public.matches (competition_name, season_year, processed);
