-- Phase 33: expand retake release scope so absent students can be included

alter table public.test_sessions
  drop constraint if exists test_sessions_retake_release_scope_check;

alter table public.test_sessions
  add constraint test_sessions_retake_release_scope_check
  check (retake_release_scope in ('all', 'failed_only', 'failed_and_absent', 'absent_only'));

create or replace function public.can_access_test_session(p_test_session_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session public.test_sessions%rowtype;
  v_role text;
  v_student_id uuid := auth.uid();
  v_attempt_count integer;
  v_best_score numeric;
  v_pass_rate numeric;
  v_audience_mode text;
  v_audience_student_ids jsonb;
begin
  select *
  into v_session
  from public.test_sessions
  where id = p_test_session_id;

  if not found or not v_session.is_published then
    return false;
  end if;

  v_role := public.current_user_role();

  if v_role in ('super_admin', 'admin') then
    return public.can_access_school(v_session.school_id);
  end if;

  if v_role <> 'student' then
    return false;
  end if;

  if not public.can_access_school(v_session.school_id) then
    return false;
  end if;

  v_audience_mode := coalesce(v_session.audience_mode, 'all');
  v_audience_student_ids := coalesce(v_session.audience_student_ids, '[]'::jsonb);

  if v_audience_mode = 'include' then
    if v_student_id is null then
      return false;
    end if;
    if not exists (
      select 1
      from jsonb_array_elements_text(v_audience_student_ids) as audience_student_id(student_id)
      where audience_student_id.student_id = v_student_id::text
    ) then
      return false;
    end if;
  elsif v_audience_mode = 'exclude' then
    if v_student_id is null then
      return false;
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(v_audience_student_ids) as audience_student_id(student_id)
      where audience_student_id.student_id = v_student_id::text
    ) then
      return false;
    end if;
  end if;

  if v_session.retake_source_session_id is null then
    return true;
  end if;

  if v_session.retake_release_scope = 'all' then
    return true;
  end if;

  if v_student_id is null then
    return false;
  end if;

  select count(*), max(score_rate)
  into v_attempt_count, v_best_score
  from public.attempts
  where test_session_id = v_session.retake_source_session_id
    and student_id = v_student_id;

  select pass_rate
  into v_pass_rate
  from public.tests
  where version = v_session.problem_set_id;

  if v_pass_rate is null then
    v_pass_rate := 0.8;
  end if;

  if v_attempt_count = 0 then
    return v_session.retake_release_scope in ('failed_only', 'failed_and_absent', 'absent_only');
  end if;

  if v_session.retake_release_scope = 'absent_only' then
    return false;
  end if;

  if v_best_score is null then
    return false;
  end if;

  return v_best_score < v_pass_rate;
end;
$$;

drop policy if exists "test sessions select" on public.test_sessions;
create policy "test sessions select"
on public.test_sessions for select
using (
  public.can_access_test_session(id)
);
