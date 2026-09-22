alter table public.evaluations
  add column if not exists status text not null default 'completed'
    check (status in ('completed', 'failed'));

alter table public.evaluations
  add column if not exists error_message text not null default '';

create index if not exists evaluations_status_idx
  on public.evaluations(status, created_at desc);
