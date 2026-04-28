alter table public.match_cards
  add column if not exists shirt_number int,
  add column if not exists raw_phase text;

update public.match_cards
set raw_phase = case
  when half = 1 then '1T'
  when half = 2 then '2T'
  else raw_phase
end
where raw_phase is null;

alter table public.match_substitutions
  add column if not exists raw_phase text,
  add column if not exists athlete_out_shirt_number int,
  add column if not exists athlete_in_shirt_number int;

update public.match_substitutions
set raw_phase = case
  when half = 1 and minute = 45 then 'INT'
  when half = 1 then '1T'
  when half = 2 then '2T'
  else raw_phase
end
where raw_phase is null;
