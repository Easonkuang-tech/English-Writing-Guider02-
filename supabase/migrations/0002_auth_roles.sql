alter table public.profiles
  add column if not exists role text not null default 'user'
    check (role in ('user', 'admin'));

alter table public.profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'disabled'));

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create or replace function public.is_admin(check_user uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = check_user
      and role = 'admin'
      and status = 'active'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select
  id,
  coalesce(raw_user_meta_data ->> 'display_name', '')
from auth.users
on conflict (id) do nothing;

drop policy if exists profiles_own_rows on public.profiles;
create policy profiles_own_rows on public.profiles
for select using (auth.uid() = id or public.is_admin(auth.uid()));

create policy profiles_update_own on public.profiles
for update using (auth.uid() = id or public.is_admin(auth.uid()))
with check (auth.uid() = id or public.is_admin(auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_settings',
    'prompts',
    'daily_sessions',
    'writing_attempts',
    'evaluations',
    'learning_extensions',
    'revision_sessions',
    'corpus_items',
    'corpus_attempts',
    'corpus_usage_records',
    'retrieval_sessions',
    'sync_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select using (public.is_admin(auth.uid()))',
      table_name || '_admin_read',
      table_name
    );
  end loop;
end
$$;

-- After registering the intended administrator, replace the email and run:
-- update public.profiles p
-- set role = 'admin'
-- from auth.users u
-- where p.id = u.id
--   and u.email = 'admin@example.com';
