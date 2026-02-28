-- Phase 4: global tests management architecture
-- Apply after phase3_initial_school_and_admins.sql

create extension if not exists pgcrypto;

do $$
begin
  create type public.test_type as enum ('daily', 'model');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.question_set_visibility_scope as enum ('global', 'restricted');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.question_sets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  test_type public.test_type not null,
  version integer not null default 1 check (version >= 1),
  visibility_scope public.question_set_visibility_scope not null default 'global',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title, test_type, version)
);

create index if not exists question_sets_test_type_idx
  on public.question_sets (test_type);
create index if not exists question_sets_visibility_scope_idx
  on public.question_sets (visibility_scope);
create index if not exists question_sets_created_by_idx
  on public.question_sets (created_by);

create table if not exists public.question_set_school_access (
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (question_set_id, school_id)
);

create index if not exists question_set_school_access_school_idx
  on public.question_set_school_access (school_id, question_set_id);

create table if not exists public.question_set_questions (
  id uuid primary key default gen_random_uuid(),
  question_set_id uuid not null references public.question_sets(id) on delete cascade,
  question_text text not null,
  question_type text not null,
  media_url text,
  correct_answer jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  order_index integer not null check (order_index >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_set_id, order_index)
);

create index if not exists question_set_questions_set_idx
  on public.question_set_questions (question_set_id, order_index);

create table if not exists public.test_instances (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete restrict,
  question_set_id uuid not null references public.question_sets(id) on delete restrict,
  test_type public.test_type not null,
  start_date date not null,
  end_date date,
  published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index if not exists test_instances_school_idx
  on public.test_instances (school_id, published, start_date);
create index if not exists test_instances_question_set_idx
  on public.test_instances (question_set_id);
create index if not exists test_instances_test_type_idx
  on public.test_instances (test_type, school_id);
create index if not exists test_instances_created_by_idx
  on public.test_instances (created_by);

alter table public.attempts
  add column if not exists question_set_id uuid references public.question_sets(id) on delete set null,
  add column if not exists test_instance_id uuid references public.test_instances(id) on delete set null,
  add column if not exists test_type public.test_type;

create index if not exists attempts_question_set_idx
  on public.attempts (question_set_id);
create index if not exists attempts_test_instance_idx
  on public.attempts (test_instance_id);
create index if not exists attempts_test_type_idx
  on public.attempts (test_type, school_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.question_set_is_available_to_school(
  p_question_set_id uuid,
  p_school_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.question_sets qs
    where qs.id = p_question_set_id
      and (
        qs.visibility_scope = 'global'
        or exists (
          select 1
          from public.question_set_school_access qssa
          where qssa.question_set_id = qs.id
            and qssa.school_id = p_school_id
        )
      )
  )
$$;

create or replace function public.can_access_question_set(
  p_question_set_id uuid,
  p_school_id uuid default public.current_user_school_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() = 'super_admin' then true
    when public.current_user_role() in ('admin', 'student') then
      p_school_id is not null
      and p_school_id = public.current_user_school_id()
      and public.question_set_is_available_to_school(p_question_set_id, p_school_id)
    else false
  end
$$;

create or replace function public.prepare_question_set()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  if public.current_user_role() is distinct from 'super_admin'
     and auth.role() <> 'service_role' then
    raise exception 'only super_admin can manage question sets';
  end if;

  return new;
end;
$$;

create or replace function public.prepare_test_instance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_set public.question_sets%rowtype;
begin
  if new.school_id is null then
    new.school_id := coalesce(public.effective_school_scope_id(), public.current_user_school_id());
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  select *
  into v_question_set
  from public.question_sets
  where id = new.question_set_id;

  if not found then
    raise exception 'question_set_id % does not exist', new.question_set_id;
  end if;

  if not public.question_set_is_available_to_school(new.question_set_id, new.school_id) then
    raise exception 'question set % is not available to school %', new.question_set_id, new.school_id;
  end if;

  if auth.role() <> 'service_role'
     and public.current_user_role() = 'admin'
     and new.school_id is distinct from public.current_user_school_id() then
    raise exception 'school admins can only manage test instances in their own school';
  end if;

  new.test_type := v_question_set.test_type;

  return new;
end;
$$;

create or replace function public.prepare_attempt_test_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_test_instance public.test_instances%rowtype;
  v_question_set_type public.test_type;
begin
  if new.test_instance_id is not null then
    select *
    into v_test_instance
    from public.test_instances
    where id = new.test_instance_id;

    if not found then
      raise exception 'test_instance_id % does not exist', new.test_instance_id;
    end if;

    new.school_id := v_test_instance.school_id;
    new.question_set_id := v_test_instance.question_set_id;
    new.test_type := v_test_instance.test_type;
  elsif new.question_set_id is not null and new.test_type is null then
    select qs.test_type
    into v_question_set_type
    from public.question_sets qs
    where qs.id = new.question_set_id;

    new.test_type := v_question_set_type;
  end if;

  return new;
end;
$$;

drop trigger if exists question_sets_prepare on public.question_sets;
create trigger question_sets_prepare
before insert or update on public.question_sets
for each row execute function public.prepare_question_set();

drop trigger if exists question_sets_set_updated_at on public.question_sets;
create trigger question_sets_set_updated_at
before update on public.question_sets
for each row execute function public.set_updated_at();

drop trigger if exists question_set_questions_set_updated_at on public.question_set_questions;
create trigger question_set_questions_set_updated_at
before update on public.question_set_questions
for each row execute function public.set_updated_at();

drop trigger if exists test_instances_prepare on public.test_instances;
create trigger test_instances_prepare
before insert or update on public.test_instances
for each row execute function public.prepare_test_instance();

drop trigger if exists test_instances_set_updated_at on public.test_instances;
create trigger test_instances_set_updated_at
before update on public.test_instances
for each row execute function public.set_updated_at();

drop trigger if exists attempts_sync_test_assignment on public.attempts;
create trigger attempts_sync_test_assignment
before insert or update on public.attempts
for each row execute function public.prepare_attempt_test_assignment();

alter table public.question_sets enable row level security;
alter table public.question_set_school_access enable row level security;
alter table public.question_set_questions enable row level security;
alter table public.test_instances enable row level security;

drop policy if exists "question sets select" on public.question_sets;
create policy "question sets select"
on public.question_sets for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and public.can_access_question_set(id, public.current_user_school_id())
  )
);

drop policy if exists "question sets manage super admin" on public.question_sets;
create policy "question sets manage super admin"
on public.question_sets for all
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "question set school access select" on public.question_set_school_access;
create policy "question set school access select"
on public.question_set_school_access for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
    and public.can_access_question_set(question_set_id, school_id)
  )
);

drop policy if exists "question set school access manage super admin" on public.question_set_school_access;
create policy "question set school access manage super admin"
on public.question_set_school_access for all
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "question set questions select" on public.question_set_questions;
create policy "question set questions select"
on public.question_set_questions for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and public.can_access_question_set(question_set_id, public.current_user_school_id())
  )
);

drop policy if exists "question set questions manage super admin" on public.question_set_questions;
create policy "question set questions manage super admin"
on public.question_set_questions for all
using (public.current_user_role() = 'super_admin')
with check (
  public.current_user_role() = 'super_admin'
  and exists (
    select 1
    from public.question_sets qs
    where qs.id = question_set_id
  )
);

drop policy if exists "test instances select" on public.test_instances;
create policy "test instances select"
on public.test_instances for select
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
  )
  or (
    public.current_user_role() = 'student'
    and school_id = public.current_user_school_id()
    and published = true
  )
);

drop policy if exists "test instances manage" on public.test_instances;
create policy "test instances manage"
on public.test_instances for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
  and public.question_set_is_available_to_school(question_set_id, school_id)
);

create or replace view public.school_test_metrics
with (security_invoker = true) as
with scored_attempts as (
  select
    ti.school_id,
    ti.test_type,
    a.created_at,
    case
      when a.score_rate is not null then a.score_rate
      when a.total is not null and a.total <> 0 then a.correct::numeric / a.total::numeric
      else null
    end as score
  from public.attempts a
  join public.test_instances ti
    on ti.id = a.test_instance_id
)
select
  s.id as school_id,
  avg(sa.score) filter (
    where sa.test_type = 'daily'
      and (s.start_date is null or sa.created_at::date >= s.start_date)
      and (s.end_date is null or sa.created_at::date <= s.end_date)
  ) as daily_test_average,
  avg(sa.score) filter (
    where sa.test_type = 'model'
      and (s.start_date is null or sa.created_at::date >= s.start_date)
      and (s.end_date is null or sa.created_at::date <= s.end_date)
  ) as model_test_average,
  count(sa.score) filter (
    where sa.test_type = 'daily'
      and (s.start_date is null or sa.created_at::date >= s.start_date)
      and (s.end_date is null or sa.created_at::date <= s.end_date)
  ) as daily_result_count,
  count(sa.score) filter (
    where sa.test_type = 'model'
      and (s.start_date is null or sa.created_at::date >= s.start_date)
      and (s.end_date is null or sa.created_at::date <= s.end_date)
  ) as model_result_count
from public.schools s
left join scored_attempts sa
  on sa.school_id = s.id
group by s.id;
