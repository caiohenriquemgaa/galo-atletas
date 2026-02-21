alter table public.athletes
  add column if not exists is_active_fpf boolean not null default true;

alter table public.athletes
  add column if not exists last_seen_at timestamptz;
