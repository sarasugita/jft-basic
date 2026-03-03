-- Run in Supabase SQL Editor

-- profiles additions (if not already applied)
alter table public.profiles
  add column if not exists email text,
  add column if not exists force_password_change boolean not null default false,
  add column if not exists is_withdrawn boolean not null default false,
  add column if not exists phone_number text,
  add column if not exists date_of_birth date,
  add column if not exists sex text,
  add column if not exists current_working_facility text,
  add column if not exists years_of_experience numeric,
  add column if not exists nursing_certificate text,
  add column if not exists nursing_certificate_status text,
  add column if not exists bnmc_registration_number text,
  add column if not exists bnmc_registration_expiry_date date,
  add column if not exists passport_number text,
  add column if not exists profile_uploads jsonb not null default '{}'::jsonb;

-- tests master
create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  version text not null unique, -- Problem Set ID
  title text not null, -- Default title
  type text not null check (type in ('mock', 'quiz', 'daily')),
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
  test_type text not null check (test_type in ('mock', 'quiz', 'daily')),
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
  show_answers boolean not null default true,
  allow_multiple_attempts boolean not null default true,
  retake_source_session_id uuid references public.test_sessions(id) on delete set null,
  retake_release_scope text not null default 'all' check (retake_release_scope in ('all', 'failed_only')),
  created_at timestamptz not null default now()
);

create index if not exists test_sessions_problem_set_idx on public.test_sessions (problem_set_id);
create index if not exists test_sessions_published_idx on public.test_sessions (is_published);

create table if not exists public.test_session_attempt_overrides (
  id uuid primary key default gen_random_uuid(),
  test_session_id uuid not null references public.test_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  extra_attempts integer not null default 0 check (extra_attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_session_id, student_id)
);

create index if not exists test_session_attempt_overrides_session_idx
  on public.test_session_attempt_overrides (test_session_id);
create index if not exists test_session_attempt_overrides_student_idx
  on public.test_session_attempt_overrides (student_id);

-- announcements
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  publish_at timestamptz not null default now(),
  end_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.announcements
  add column if not exists publish_at timestamptz not null default now(),
  add column if not exists end_at timestamptz;

-- absence applications
create table if not exists public.absence_applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('excused', 'late')),
  day_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  reason text,
  catch_up text,
  late_type text, -- 'late' or 'leave_early'
  time_value text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);

-- attempts relation (optional)
create index if not exists attempts_test_version_idx on public.attempts (test_version);
alter table public.attempts
  add column if not exists test_session_id uuid,
  add column if not exists tab_left_count integer not null default 0;

-- exam links may reference test_session_id
alter table public.exam_links
  add column if not exists test_session_id uuid references public.test_sessions(id) on delete set null;
-- If all existing attempts.test_version values are registered in tests, you can add an FK:
-- alter table public.attempts
--   add constraint attempts_test_version_fkey foreign key (test_version)
--   references public.tests(version) on delete set null;

-- attendance
create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  day_date date not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.attendance_days(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('P','L','E','A')),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, student_id)
);

create index if not exists attendance_entries_day_idx on public.attendance_entries (day_id);
create index if not exists attendance_entries_student_idx on public.attendance_entries (student_id);

-- daily records
create table if not exists public.daily_records (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  record_date date not null,
  todays_content text,
  mini_test_1 text,
  mini_test_2 text,
  special_test_1 text,
  special_test_2 text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists daily_records_school_date_key
  on public.daily_records (school_id, record_date);

create index if not exists daily_records_school_idx on public.daily_records (school_id);

create table if not exists public.daily_record_student_comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.daily_records(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists daily_record_student_comments_record_idx
  on public.daily_record_student_comments (record_id);

create index if not exists daily_record_student_comments_student_idx
  on public.daily_record_student_comments (student_id);

-- ranking periods and snapshots
create table if not exists public.ranking_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  label text not null,
  start_date date,
  end_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ranking_periods_school_sort_order_key
  on public.ranking_periods (school_id, sort_order);

create index if not exists ranking_periods_school_idx
  on public.ranking_periods (school_id);

create table if not exists public.ranking_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.ranking_periods(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_name text,
  average_rate numeric not null,
  rank_position int not null,
  created_at timestamptz not null default now()
);

create unique index if not exists ranking_entries_period_student_key
  on public.ranking_entries (period_id, student_id);

create index if not exists ranking_entries_period_rank_idx
  on public.ranking_entries (period_id, rank_position);

-- student warnings
create table if not exists public.student_warnings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  criteria jsonb not null default '{}'::jsonb,
  student_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_warnings_school_idx
  on public.student_warnings (school_id, created_at desc);

create table if not exists public.student_warning_recipients (
  id uuid primary key default gen_random_uuid(),
  warning_id uuid not null references public.student_warnings(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (warning_id, student_id)
);

create index if not exists student_warning_recipients_warning_idx
  on public.student_warning_recipients (warning_id);

create index if not exists student_warning_recipients_student_idx
  on public.student_warning_recipients (student_id);
