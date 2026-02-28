-- Phase 1: multi-school foundation + RBAC
-- Apply after supabase/sql/schema.sql

create extension if not exists pgcrypto;

create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  academic_year text,
  term text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists schools_name_key on public.schools (lower(name));
create index if not exists schools_status_idx on public.schools (status);

alter table public.profiles
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.tests
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.questions
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.test_assets
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.test_sessions
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.announcements
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.absence_applications
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.attempts
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.attendance_days
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.attendance_entries
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

alter table public.exam_links
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

create index if not exists profiles_school_idx on public.profiles (school_id);
create index if not exists tests_school_idx on public.tests (school_id);
create index if not exists questions_school_idx on public.questions (school_id);
create index if not exists test_assets_school_idx on public.test_assets (school_id);
create index if not exists test_sessions_school_idx on public.test_sessions (school_id);
create index if not exists announcements_school_idx on public.announcements (school_id);
create index if not exists absence_applications_school_idx on public.absence_applications (school_id);
create index if not exists attempts_school_idx on public.attempts (school_id);
create index if not exists attendance_days_school_idx on public.attendance_days (school_id);
create index if not exists attendance_entries_school_idx on public.attendance_entries (school_id);
create index if not exists exam_links_school_idx on public.exam_links (school_id);

do $$
declare
  v_default_school_id uuid;
begin
  if not exists (select 1 from public.schools)
    and exists (
      select 1 from public.profiles
      union all
      select 1 from public.tests
      union all
      select 1 from public.test_sessions
      union all
      select 1 from public.announcements
      union all
      select 1 from public.attempts
      union all
      select 1 from public.attendance_days
      union all
      select 1 from public.exam_links
      limit 1
    ) then
    insert into public.schools (name, status)
    select 'Default School', 'active'
    where not exists (
      select 1
      from public.schools
      where lower(name) = lower('Default School')
    );
  end if;

  if exists (
    select 1
    from (
      select school_id from public.profiles where role in ('admin', 'student')
      union all
      select school_id from public.tests
      union all
      select school_id from public.questions
      union all
      select school_id from public.test_assets
      union all
      select school_id from public.test_sessions
      union all
      select school_id from public.announcements
      union all
      select school_id from public.absence_applications
      union all
      select school_id from public.attempts
      union all
      select school_id from public.attendance_days
      union all
      select school_id from public.attendance_entries
      union all
      select school_id from public.exam_links
    ) scoped_rows
    where school_id is null
  ) then
    select id
    into v_default_school_id
    from public.schools
    order by created_at, id
    limit 1;

    update public.profiles
    set school_id = v_default_school_id
    where role in ('admin', 'student')
      and school_id is null;

    update public.tests
    set school_id = v_default_school_id
    where school_id is null;

    update public.questions q
    set school_id = coalesce(t.school_id, v_default_school_id)
    from public.tests t
    where q.test_version = t.version
      and q.school_id is null;

    update public.questions
    set school_id = v_default_school_id
    where school_id is null;

    update public.test_assets ta
    set school_id = coalesce(t.school_id, v_default_school_id)
    from public.tests t
    where ta.test_version = t.version
      and ta.school_id is null;

    update public.test_assets
    set school_id = v_default_school_id
    where school_id is null;

    update public.test_sessions ts
    set school_id = coalesce(t.school_id, v_default_school_id)
    from public.tests t
    where ts.problem_set_id = t.version
      and ts.school_id is null;

    update public.test_sessions
    set school_id = v_default_school_id
    where school_id is null;

    update public.announcements a
    set school_id = coalesce(p.school_id, v_default_school_id)
    from public.profiles p
    where a.created_by = p.id
      and a.school_id is null;

    update public.announcements
    set school_id = v_default_school_id
    where school_id is null;

    update public.absence_applications aa
    set school_id = coalesce(p.school_id, v_default_school_id)
    from public.profiles p
    where aa.student_id = p.id
      and aa.school_id is null;

    update public.absence_applications
    set school_id = v_default_school_id
    where school_id is null;

    update public.attempts at
    set school_id = coalesce(p.school_id, v_default_school_id)
    from public.profiles p
    where at.student_id = p.id
      and at.school_id is null;

    update public.attempts
    set school_id = v_default_school_id
    where school_id is null;

    update public.attendance_days
    set school_id = v_default_school_id
    where school_id is null;

    update public.attendance_entries ae
    set school_id = ad.school_id
    from public.attendance_days ad
    where ae.day_id = ad.id
      and ae.school_id is null;

    update public.attendance_entries ae
    set school_id = p.school_id
    from public.profiles p
    where ae.student_id = p.id
      and ae.school_id is null;

    update public.attendance_entries
    set school_id = v_default_school_id
    where school_id is null;

    update public.exam_links el
    set school_id = ts.school_id
    from public.test_sessions ts
    where el.test_session_id = ts.id
      and el.school_id is null;

    update public.exam_links el
    set school_id = t.school_id
    from public.tests t
    where el.test_version = t.version
      and el.school_id is null;

    update public.exam_links
    set school_id = v_default_school_id
    where school_id is null;
  end if;
end $$;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('super_admin', 'admin', 'student'));

alter table public.profiles
  drop constraint if exists profiles_role_school_check;

alter table public.profiles
  add constraint profiles_role_school_check
  check (
    role is null
    or (role = 'super_admin' and school_id is null)
    or (role in ('admin', 'student') and school_id is not null)
  );

alter table public.tests alter column school_id set not null;
alter table public.questions alter column school_id set not null;
alter table public.test_assets alter column school_id set not null;
alter table public.test_sessions alter column school_id set not null;
alter table public.announcements alter column school_id set not null;
alter table public.absence_applications alter column school_id set not null;
alter table public.attempts alter column school_id set not null;
alter table public.attendance_days alter column school_id set not null;
alter table public.attendance_entries alter column school_id set not null;
alter table public.exam_links alter column school_id set not null;

alter table public.attendance_days
  drop constraint if exists attendance_days_day_date_key;

create unique index if not exists attendance_days_school_day_date_key
  on public.attendance_days (school_id, day_date);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.current_user_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.school_id
  from public.profiles p
  where p.id = auth.uid()
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;

create or replace function public.can_access_school(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_super_admin()
    or (
      target_school_id is not null
      and target_school_id = public.current_user_school_id()
    )
$$;

create or replace function public.is_same_school_profile(target_profile_id uuid, target_school_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_profile_id
      and public.can_access_school(coalesce(target_school_id, p.school_id))
  )
$$;

alter table public.tests
  alter column school_id set default public.current_user_school_id();

alter table public.questions
  alter column school_id set default public.current_user_school_id();

alter table public.test_assets
  alter column school_id set default public.current_user_school_id();

alter table public.test_sessions
  alter column school_id set default public.current_user_school_id();

alter table public.announcements
  alter column school_id set default public.current_user_school_id();

alter table public.absence_applications
  alter column school_id set default public.current_user_school_id();

alter table public.attempts
  alter column school_id set default public.current_user_school_id();

alter table public.attendance_days
  alter column school_id set default public.current_user_school_id();

alter table public.attendance_entries
  alter column school_id set default public.current_user_school_id();

alter table public.exam_links
  alter column school_id set default public.current_user_school_id();

create or replace function public.sync_school_scoped_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'questions' then
    if new.school_id is null then
      select t.school_id into new.school_id
      from public.tests t
      where t.version = new.test_version;
    end if;
  elsif tg_table_name = 'test_assets' then
    if new.school_id is null then
      select t.school_id into new.school_id
      from public.tests t
      where t.version = new.test_version;
    end if;
  elsif tg_table_name = 'test_sessions' then
    if new.school_id is null then
      select t.school_id into new.school_id
      from public.tests t
      where t.version = new.problem_set_id;
    end if;
  elsif tg_table_name = 'announcements' then
    if new.school_id is null and new.created_by is not null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.created_by;
    end if;
  elsif tg_table_name = 'absence_applications' then
    if new.school_id is null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.student_id;
    end if;
  elsif tg_table_name = 'attempts' then
    if new.school_id is null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.student_id;
    end if;
  elsif tg_table_name = 'attendance_entries' then
    if new.school_id is null then
      select ad.school_id into new.school_id
      from public.attendance_days ad
      where ad.id = new.day_id;
    end if;
    if new.school_id is null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.student_id;
    end if;
  elsif tg_table_name = 'exam_links' then
    if new.school_id is null and new.test_session_id is not null then
      select ts.school_id into new.school_id
      from public.test_sessions ts
      where ts.id = new.test_session_id;
    end if;
    if new.school_id is null and new.test_version is not null then
      select t.school_id into new.school_id
      from public.tests t
      where t.version = new.test_version;
    end if;
  end if;

  if new.school_id is null then
    new.school_id := public.current_user_school_id();
  end if;

  return new;
end;
$$;

drop trigger if exists questions_sync_school_id on public.questions;
create trigger questions_sync_school_id
before insert or update on public.questions
for each row execute function public.sync_school_scoped_row();

drop trigger if exists test_assets_sync_school_id on public.test_assets;
create trigger test_assets_sync_school_id
before insert or update on public.test_assets
for each row execute function public.sync_school_scoped_row();

drop trigger if exists test_sessions_sync_school_id on public.test_sessions;
create trigger test_sessions_sync_school_id
before insert or update on public.test_sessions
for each row execute function public.sync_school_scoped_row();

drop trigger if exists announcements_sync_school_id on public.announcements;
create trigger announcements_sync_school_id
before insert or update on public.announcements
for each row execute function public.sync_school_scoped_row();

drop trigger if exists absence_applications_sync_school_id on public.absence_applications;
create trigger absence_applications_sync_school_id
before insert or update on public.absence_applications
for each row execute function public.sync_school_scoped_row();

drop trigger if exists attempts_sync_school_id on public.attempts;
create trigger attempts_sync_school_id
before insert or update on public.attempts
for each row execute function public.sync_school_scoped_row();

drop trigger if exists attendance_entries_sync_school_id on public.attendance_entries;
create trigger attendance_entries_sync_school_id
before insert or update on public.attendance_entries
for each row execute function public.sync_school_scoped_row();

drop trigger if exists exam_links_sync_school_id on public.exam_links;
create trigger exam_links_sync_school_id
before insert or update on public.exam_links
for each row execute function public.sync_school_scoped_row();

create or replace function public.guard_profile_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is null then
      raise exception 'role is required';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.current_user_role() = 'student' then
    if auth.uid() <> new.id then
      raise exception 'students can only update their own profile';
    end if;
    if new.role is distinct from old.role
      or new.school_id is distinct from old.school_id
      or new.is_withdrawn is distinct from old.is_withdrawn
      or new.student_code is distinct from old.student_code then
      raise exception 'students cannot modify protected profile fields';
    end if;
  elsif public.current_user_role() = 'admin' then
    if new.role is distinct from old.role
      or new.school_id is distinct from old.school_id then
      raise exception 'school admins cannot modify role or school assignment';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_profile_mutation on public.profiles;
create trigger profiles_guard_profile_mutation
before insert or update on public.profiles
for each row execute function public.guard_profile_mutation();

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.tests enable row level security;
alter table public.questions enable row level security;
alter table public.choices enable row level security;
alter table public.test_assets enable row level security;
alter table public.test_sessions enable row level security;
alter table public.announcements enable row level security;
alter table public.absence_applications enable row level security;
alter table public.attempts enable row level security;
alter table public.attendance_days enable row level security;
alter table public.attendance_entries enable row level security;
alter table public.exam_links enable row level security;

drop policy if exists "schools select" on public.schools;
create policy "schools select"
on public.schools for select
using (public.can_access_school(id));

drop policy if exists "schools manage super admin" on public.schools;
create policy "schools manage super admin"
on public.schools for all
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select"
on public.profiles for select
using (
  public.is_super_admin()
  or auth.uid() = id
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
    and role <> 'super_admin'
  )
);

drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert"
on public.profiles for insert
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and role = 'student'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update"
on public.profiles for update
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and role = 'student'
    and school_id = public.current_user_school_id()
  )
  or auth.uid() = id
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and role = 'student'
    and school_id = public.current_user_school_id()
  )
  or (
    auth.uid() = id
    and role = public.current_user_role()
    and school_id is not distinct from public.current_user_school_id()
  )
);

drop policy if exists "profiles delete" on public.profiles;
create policy "profiles delete"
on public.profiles for delete
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and role = 'student'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "tests select" on public.tests;
create policy "tests select"
on public.tests for select
using (
  public.can_access_school(school_id)
  and (
    public.current_user_role() in ('super_admin', 'admin', 'student')
  )
);

drop policy if exists "tests admin manage" on public.tests;
create policy "tests admin manage"
on public.tests for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "questions select" on public.questions;
create policy "questions select"
on public.questions for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin', 'student')
);

drop policy if exists "questions admin manage" on public.questions;
create policy "questions admin manage"
on public.questions for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "choices select" on public.choices;
create policy "choices select"
on public.choices for select
using (
  exists (
    select 1
    from public.questions q
    where q.id = choices.question_id
      and public.can_access_school(q.school_id)
      and public.current_user_role() in ('super_admin', 'admin', 'student')
  )
);

drop policy if exists "choices admin manage" on public.choices;
create policy "choices admin manage"
on public.choices for all
using (
  exists (
    select 1
    from public.questions q
    where q.id = choices.question_id
      and (
        public.is_super_admin()
        or (
          public.current_user_role() = 'admin'
          and q.school_id = public.current_user_school_id()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.questions q
    where q.id = choices.question_id
      and (
        public.is_super_admin()
        or (
          public.current_user_role() = 'admin'
          and q.school_id = public.current_user_school_id()
        )
      )
  )
);

drop policy if exists "test assets select" on public.test_assets;
create policy "test assets select"
on public.test_assets for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin')
);

drop policy if exists "test assets admin manage" on public.test_assets;
create policy "test assets admin manage"
on public.test_assets for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "test sessions select" on public.test_sessions;
create policy "test sessions select"
on public.test_sessions for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin', 'student')
);

drop policy if exists "test sessions admin manage" on public.test_sessions;
create policy "test sessions admin manage"
on public.test_sessions for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "announcements select" on public.announcements;
create policy "announcements select"
on public.announcements for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin', 'student')
);

drop policy if exists "announcements admin manage" on public.announcements;
create policy "announcements admin manage"
on public.announcements for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "absence applications select" on public.absence_applications;
create policy "absence applications select"
on public.absence_applications for select
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "absence applications insert" on public.absence_applications;
create policy "absence applications insert"
on public.absence_applications for insert
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "absence applications update" on public.absence_applications;
create policy "absence applications update"
on public.absence_applications for update
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attempts select" on public.attempts;
create policy "attempts select"
on public.attempts for select
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attempts insert" on public.attempts;
create policy "attempts insert"
on public.attempts for insert
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attempts admin delete" on public.attempts;
create policy "attempts admin delete"
on public.attempts for delete
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attendance days select" on public.attendance_days;
create policy "attendance days select"
on public.attendance_days for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin', 'student')
);

drop policy if exists "attendance days admin manage" on public.attendance_days;
create policy "attendance days admin manage"
on public.attendance_days for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attendance entries select" on public.attendance_entries;
create policy "attendance entries select"
on public.attendance_entries for select
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "attendance entries admin manage" on public.attendance_entries;
create policy "attendance entries admin manage"
on public.attendance_entries for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "exam links select" on public.exam_links;
create policy "exam links select"
on public.exam_links for select
using (
  public.can_access_school(school_id)
  and public.current_user_role() in ('super_admin', 'admin', 'student')
);

drop policy if exists "exam links admin manage" on public.exam_links;
create policy "exam links admin manage"
on public.exam_links for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);
