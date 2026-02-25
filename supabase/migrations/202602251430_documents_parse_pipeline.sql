alter table public.documents
  add column if not exists status text,
  add column if not exists raw_text text,
  add column if not exists canonical_json jsonb,
  add column if not exists parse_error text,
  add column if not exists parsed_at timestamptz,
  add column if not exists canonical_at timestamptz;

update public.documents
set status = 'UPLOADED'
where status is null;

alter table public.documents
  drop constraint if exists documents_status_check;

alter table public.documents
  add constraint documents_status_check
  check (status in ('UPLOADED', 'PARSED_RAW', 'CANONICAL', 'ERROR'));

alter table public.documents
  alter column status set default 'UPLOADED',
  alter column status set not null;
