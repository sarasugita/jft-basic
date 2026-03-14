-- Phase 13: keep test session school scope tied to the active school
-- Apply after phase12_student_warnings.sql

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
      new.school_id := coalesce(public.effective_school_scope_id(), public.current_user_school_id());
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
    new.school_id := coalesce(public.effective_school_scope_id(), public.current_user_school_id());
  end if;

  return new;
end;
$$;
