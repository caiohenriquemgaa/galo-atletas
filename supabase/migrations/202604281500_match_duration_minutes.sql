alter table public.matches
add column if not exists match_duration_minutes integer;

update public.matches
set match_duration_minutes = case
  when competition_name ilike '%sub-15%' then 70
  else 90
end
where match_duration_minutes is null;
