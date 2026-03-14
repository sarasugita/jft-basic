-- Phase 14: allow students to access legacy tests/questions/choices via published sessions
-- Apply after phase13_fix_test_session_school_scope.sql

drop policy if exists "tests select" on public.tests;
create policy "tests select"
on public.tests for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and (
      public.can_access_school(school_id)
      or (
        is_public = true
        and public.can_access_legacy_set_version(version, public.effective_school_scope_id())
      )
    )
  )
  or (
    public.current_user_role() = 'student'
    and (
      public.can_access_school(school_id)
      or (
        is_public = true
        and exists (
          select 1
          from public.test_sessions ts
          where ts.problem_set_id = tests.version
            and ts.school_id = public.current_user_school_id()
            and ts.is_published = true
        )
      )
    )
  )
);

drop policy if exists "questions select" on public.questions;
create policy "questions select"
on public.questions for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and (
      public.can_access_school(school_id)
      or public.can_access_legacy_set_version(test_version, public.effective_school_scope_id())
    )
  )
  or (
    public.current_user_role() = 'student'
    and (
      public.can_access_school(school_id)
      or exists (
        select 1
        from public.test_sessions ts
        where ts.problem_set_id = questions.test_version
          and ts.school_id = public.current_user_school_id()
          and ts.is_published = true
      )
    )
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
      and (
        public.current_user_role() = 'super_admin'
        or (
          public.current_user_role() = 'admin'
          and (
            public.can_access_school(q.school_id)
            or public.can_access_legacy_set_version(q.test_version, public.effective_school_scope_id())
          )
        )
        or (
          public.current_user_role() = 'student'
          and (
            public.can_access_school(q.school_id)
            or exists (
              select 1
              from public.test_sessions ts
              where ts.problem_set_id = q.test_version
                and ts.school_id = public.current_user_school_id()
                and ts.is_published = true
            )
          )
        )
      )
  )
);
