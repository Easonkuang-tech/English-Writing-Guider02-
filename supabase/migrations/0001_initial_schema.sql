create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.prompts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_type text not null check (task_type in ('task1', 'task2')),
  title text not null,
  prompt_text text not null,
  topic text not null default 'General',
  task_kind text not null default 'Practice',
  tags text[] not null default '{}',
  source text not null default '',
  instructions text not null default '',
  archived_at timestamptz,
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  vocabulary_raw text not null default '',
  patterns_raw text not null default '',
  notes text not null default '',
  recommended_prompt_id uuid references public.prompts(id) on delete set null,
  selected_prompt_id uuid references public.prompts(id) on delete set null,
  match_reason text not null default '',
  match_confidence numeric(5, 4) not null default 0,
  match_method text not null default '',
  payload jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, local_date)
);

create table if not exists public.writing_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_session_id uuid references public.daily_sessions(id) on delete set null,
  mode text not null check (mode in ('simple', 'formal')),
  status text not null default 'completed',
  task_type text not null check (task_type in ('task1', 'task2')),
  prompt_snapshot jsonb not null default '{}'::jsonb,
  materials_snapshot jsonb not null default '[]'::jsonb,
  response_text text not null default '',
  word_count integer not null default 0,
  duration_seconds integer not null default 0,
  submitted_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.writing_attempts(id) on delete cascade,
  provider text not null default 'deepseek',
  model text not null default '',
  type text not null default 'simple',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_extensions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.writing_attempts(id) on delete cascade,
  status text not null default 'ready',
  content jsonb not null default '{}'::jsonb,
  progress jsonb not null default '{}'::jsonb,
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.revision_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.writing_attempts(id) on delete cascade,
  current_text text not null default '',
  sentence_answers jsonb not null default '{}'::jsonb,
  rounds jsonb not null default '[]'::jsonb,
  status text not null default 'editing',
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.corpus_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  custom_name text not null default '',
  chinese_intent text not null,
  target_expression text not null default '',
  target_type text not null default 'meaning',
  topic_tags text[] not null default '{}',
  source_material_id text not null default '',
  source_date date,
  first_attempt text not null default '',
  first_evaluation jsonb,
  standard_expression text not null default '',
  base_chunks text[] not null default '{}',
  abstract_framework text not null default '',
  framework_metadata jsonb not null default '{}'::jsonb,
  controlled_attempt text not null default '',
  controlled_evaluation jsonb,
  reused_chinese_prompt text not null default '',
  reused_framework_revealed boolean not null default false,
  reused_attempt text not null default '',
  reused_evaluation jsonb,
  stage text not null default 'new' check (stage in ('new', 'controlled', 'reused', 'spontaneous')),
  stage_history jsonb not null default '[]'::jsonb,
  usage_summary jsonb not null default '{}'::jsonb,
  learning_plan jsonb not null default '{}'::jsonb,
  test_profile jsonb not null default '{}'::jsonb,
  next_review_at timestamptz,
  last_practiced_at timestamptz,
  last_used_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.corpus_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  corpus_item_id uuid not null references public.corpus_items(id) on delete cascade,
  phase text not null,
  answer text not null default '',
  framework_revealed boolean not null default false,
  duration_seconds integer not null default 0,
  evaluation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.corpus_usage_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  corpus_item_id uuid not null references public.corpus_items(id) on delete cascade,
  real_text text not null default '',
  context text not null default 'other',
  notes_used boolean not null default false,
  qualifies_as_real_use boolean not null default false,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.retrieval_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  corpus_item_id uuid not null references public.corpus_items(id) on delete cascade,
  kind text not null,
  interval_days integer,
  status text not null default 'pending',
  due_at timestamptz,
  started_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer not null default 0,
  timed_out boolean not null default false,
  question jsonb not null default '{}'::jsonb,
  answer text not null default '',
  result jsonb not null default '{}'::jsonb,
  client_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_events (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  operation text not null,
  client_mutation_id text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists prompts_user_id_idx on public.prompts(user_id, updated_at);
create index if not exists daily_sessions_user_date_idx on public.daily_sessions(user_id, local_date desc);
create index if not exists writing_attempts_user_created_idx on public.writing_attempts(user_id, created_at desc);
create index if not exists corpus_items_user_stage_idx on public.corpus_items(user_id, stage, updated_at desc);
create index if not exists corpus_attempts_item_idx on public.corpus_attempts(corpus_item_id, created_at desc);
create index if not exists retrieval_sessions_due_idx on public.retrieval_sessions(user_id, status, due_at);
create index if not exists sync_events_user_idx on public.sync_events(user_id, id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.prompts enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.writing_attempts enable row level security;
alter table public.evaluations enable row level security;
alter table public.learning_extensions enable row level security;
alter table public.revision_sessions enable row level security;
alter table public.corpus_items enable row level security;
alter table public.corpus_attempts enable row level security;
alter table public.corpus_usage_records enable row level security;
alter table public.retrieval_sessions enable row level security;
alter table public.sync_events enable row level security;

create policy "profiles_own_rows" on public.profiles
for all using (auth.uid() = id) with check (auth.uid() = id);

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
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      table_name || '_own_rows',
      table_name
    );
  end loop;
end
$$;
