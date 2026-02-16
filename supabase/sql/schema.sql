-- Run in Supabase SQL Editor

-- profiles additions (if not already applied)
alter table public.profiles
  add column if not exists email text,
  add column if not exists force_password_change boolean not null default false;

-- tests master
create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  version text not null unique, -- Problem Set ID
  title text not null, -- Default title
  type text not null check (type in ('mock', 'quiz')),
  pass_rate numeric not null default 0.8,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tests
  add column if not exists updated_at timestamptz not null default now();

create index if not exists tests_type_idx on public.tests (type);
create index if not exists tests_public_idx on public.tests (is_public);

-- questions (optional, for future CSV ingestion)
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  test_version text not null references public.tests(version) on delete cascade,
  question_id text not null,
  section_key text,
  type text not null,
  prompt_en text,
  prompt_bn text,
  answer_index int,
  order_index int,
  data jsonb,
  created_at timestamptz not null default now(),
  unique (test_version, question_id)
);

create index if not exists questions_test_idx on public.questions (test_version);

-- choices (optional)
create table if not exists public.choices (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  part_index int,
  choice_index int not null,
  label text,
  choice_image text,
  created_at timestamptz not null default now(),
  unique (question_id, part_index, choice_index)
);

-- If choices already existed with a different unique constraint, migrate safely:
alter table public.choices
  add column if not exists part_index int,
  add column if not exists choice_image text;

alter table public.choices
  drop constraint if exists choices_question_id_choice_index_key;

create unique index if not exists choices_unique_idx
  on public.choices (question_id, part_index, choice_index);

-- uploaded assets (CSV/PNG/MP3)
create table if not exists public.test_assets (
  id uuid primary key default gen_random_uuid(),
  test_version text not null references public.tests(version) on delete cascade,
  test_type text not null check (test_type in ('mock', 'quiz')),
  asset_type text not null,
  path text not null,
  mime_type text,
  original_name text,
  created_at timestamptz not null default now()
);

create index if not exists test_assets_version_idx on public.test_assets (test_version);
create index if not exists test_assets_type_idx on public.test_assets (test_type);

-- test sessions (runtime / schedules)
create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  problem_set_id text not null references public.tests(version) on delete restrict,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  time_limit_min int,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists test_sessions_problem_set_idx on public.test_sessions (problem_set_id);
create index if not exists test_sessions_published_idx on public.test_sessions (is_published);

-- attempts relation (optional)
create index if not exists attempts_test_version_idx on public.attempts (test_version);
alter table public.attempts
  add column if not exists test_session_id uuid;

-- exam links may reference test_session_id
alter table public.exam_links
  add column if not exists test_session_id uuid references public.test_sessions(id) on delete set null;
-- If all existing attempts.test_version values are registered in tests, you can add an FK:
-- alter table public.attempts
--   add constraint attempts_test_version_fkey foreign key (test_version)
--   references public.tests(version) on delete set null;

