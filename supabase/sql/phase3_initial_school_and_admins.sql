-- Phase 3: named initial-school migration + school-admin account status
-- Apply after phase2_super_admin_school_scope.sql

alter table public.schools
  add column if not exists start_date date,
  add column if not exists end_date date;

alter table public.profiles
  add column if not exists account_status text not null default 'active',
  add column if not exists disabled_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'disabled'));

create index if not exists schools_start_date_idx on public.schools (start_date);
create index if not exists profiles_account_status_idx on public.profiles (account_status);

update public.profiles
set account_status = 'active'
where account_status is null;

create or replace function public.current_user_account_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.account_status
  from public.profiles p
  where p.id = auth.uid()
$$;

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
    and p.account_status = 'active'
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
    and p.account_status = 'active'
$$;

do $$
declare
  v_legacy_school_count integer;
  v_initial_school_id uuid;
  v_start_date date;
begin
  select count(*) into v_legacy_school_count from public.schools;
  select coalesce(min(day_date), current_date) into v_start_date from public.attendance_days;

  select id
  into v_initial_school_id
  from public.schools
  where lower(name) = lower('Grameen Caledonian College of Nursing')
  limit 1;

  if v_initial_school_id is null and v_legacy_school_count = 1 then
    update public.schools
    set name = 'Grameen Caledonian College of Nursing',
        status = 'active',
        start_date = coalesce(start_date, v_start_date),
        end_date = end_date,
        updated_at = now()
    where id = (select id from public.schools order by created_at, id limit 1)
    returning id into v_initial_school_id;
  end if;

  if v_initial_school_id is null then
    insert into public.schools (name, status, start_date, end_date)
    values ('Grameen Caledonian College of Nursing', 'active', v_start_date, null)
    returning id into v_initial_school_id;
  end if;

  update public.schools
  set status = 'active',
      start_date = coalesce(start_date, v_start_date),
      end_date = end_date,
      updated_at = now()
  where id = v_initial_school_id;

  if v_legacy_school_count <= 1 then
    update public.profiles
    set school_id = v_initial_school_id
    where role in ('admin', 'student');

    update public.profiles
    set school_id = null
    where role = 'super_admin';

    update public.tests
    set school_id = v_initial_school_id;

    update public.questions
    set school_id = v_initial_school_id;

    update public.test_assets
    set school_id = v_initial_school_id;

    update public.test_sessions
    set school_id = v_initial_school_id;

    update public.announcements
    set school_id = v_initial_school_id;

    update public.absence_applications
    set school_id = v_initial_school_id;

    update public.attempts
    set school_id = v_initial_school_id;

    update public.attendance_days
    set school_id = v_initial_school_id;

    update public.attendance_entries
    set school_id = v_initial_school_id;

    update public.exam_links
    set school_id = v_initial_school_id;
  else
    update public.profiles
    set school_id = v_initial_school_id
    where role in ('admin', 'student')
      and school_id is null;

    update public.tests
    set school_id = v_initial_school_id
    where school_id is null;

    update public.questions
    set school_id = v_initial_school_id
    where school_id is null;

    update public.test_assets
    set school_id = v_initial_school_id
    where school_id is null;

    update public.test_sessions
    set school_id = v_initial_school_id
    where school_id is null;

    update public.announcements
    set school_id = v_initial_school_id
    where school_id is null;

    update public.absence_applications
    set school_id = v_initial_school_id
    where school_id is null;

    update public.attempts
    set school_id = v_initial_school_id
    where school_id is null;

    update public.attendance_days
    set school_id = v_initial_school_id
    where school_id is null;

    update public.attendance_entries
    set school_id = v_initial_school_id
    where school_id is null;

    update public.exam_links
    set school_id = v_initial_school_id
    where school_id is null;
  end if;
end $$;
