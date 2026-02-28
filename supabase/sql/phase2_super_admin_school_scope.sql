-- Phase 2: allow super_admin school-scoped admin reuse via request header
-- The admin app sends x-school-scope when a super_admin enters a school context.

create or replace function public.requested_school_scope_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  headers jsonb;
  scope_text text;
begin
  begin
    headers := current_setting('request.headers', true)::jsonb;
  exception
    when others then
      headers := null;
  end;

  scope_text := nullif(coalesce(headers ->> 'x-school-scope', headers ->> 'X-School-Scope'), '');
  if scope_text is null then
    return null;
  end if;

  begin
    return scope_text::uuid;
  exception
    when others then
      return null;
  end;
end;
$$;

create or replace function public.effective_school_scope_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_super_admin() then public.requested_school_scope_id()
    else public.current_user_school_id()
  end
$$;

create or replace function public.can_access_school(target_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_super_admin() and public.requested_school_scope_id() is null then true
    when public.is_super_admin() then target_school_id = public.requested_school_scope_id()
    else target_school_id is not null and target_school_id = public.current_user_school_id()
  end
$$;

alter table public.tests
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.questions
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.test_assets
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.test_sessions
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.announcements
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.absence_applications
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.attempts
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.attendance_days
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.attendance_entries
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.exam_links
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

drop policy if exists "profiles select" on public.profiles;
create policy "profiles select"
on public.profiles for select
using (
  auth.uid() = id
  or (
    role <> 'super_admin'
    and public.can_access_school(school_id)
    and public.current_user_role() in ('super_admin', 'admin')
  )
);

drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert"
on public.profiles for insert
with check (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and role = 'student'
    and public.can_access_school(school_id)
  )
  or (
    public.is_super_admin()
    and public.requested_school_scope_id() is null
    and role = 'super_admin'
    and school_id is null
  )
);

drop policy if exists "profiles update" on public.profiles;
create policy "profiles update"
on public.profiles for update
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and role = 'student'
    and public.can_access_school(school_id)
  )
  or auth.uid() = id
)
with check (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and role = 'student'
    and public.can_access_school(school_id)
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
  public.current_user_role() in ('super_admin', 'admin')
  and role = 'student'
  and public.can_access_school(school_id)
);

drop policy if exists "tests admin manage" on public.tests;
create policy "tests admin manage"
on public.tests for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "questions admin manage" on public.questions;
create policy "questions admin manage"
on public.questions for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "choices admin manage" on public.choices;
create policy "choices admin manage"
on public.choices for all
using (
  exists (
    select 1
    from public.questions q
    where q.id = choices.question_id
      and public.current_user_role() in ('super_admin', 'admin')
      and public.can_access_school(q.school_id)
  )
)
with check (
  exists (
    select 1
    from public.questions q
    where q.id = choices.question_id
      and public.current_user_role() in ('super_admin', 'admin')
      and public.can_access_school(q.school_id)
  )
);

drop policy if exists "test assets admin manage" on public.test_assets;
create policy "test assets admin manage"
on public.test_assets for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "test sessions admin manage" on public.test_sessions;
create policy "test sessions admin manage"
on public.test_sessions for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "announcements admin manage" on public.announcements;
create policy "announcements admin manage"
on public.announcements for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "absence applications select" on public.absence_applications;
create policy "absence applications select"
on public.absence_applications for select
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
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
  (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
  )
);

drop policy if exists "absence applications update" on public.absence_applications;
create policy "absence applications update"
on public.absence_applications for update
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "attempts select" on public.attempts;
create policy "attempts select"
on public.attempts for select
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
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
  (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
  )
);

drop policy if exists "attempts admin delete" on public.attempts;
create policy "attempts admin delete"
on public.attempts for delete
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "attendance days admin manage" on public.attendance_days;
create policy "attendance days admin manage"
on public.attendance_days for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "attendance entries select" on public.attendance_entries;
create policy "attendance entries select"
on public.attendance_entries for select
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
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
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "exam links admin manage" on public.exam_links;
create policy "exam links admin manage"
on public.exam_links for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);
