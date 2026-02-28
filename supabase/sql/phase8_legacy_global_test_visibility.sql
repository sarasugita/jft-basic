-- Phase 8: allow legacy test bridge rows to follow question-set visibility
-- Apply after phase7_admin_multi_school_access.sql

create or replace function public.can_access_legacy_set_version(
  p_test_version text,
  p_school_id uuid default public.effective_school_scope_id()
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
    where qs.title = p_test_version
      and qs.status <> 'archived'
      and (
        qs.visibility_scope = 'global'
        or (
          p_school_id is not null
          and exists (
            select 1
            from public.question_set_school_access qssa
            where qssa.question_set_id = qs.id
              and qssa.school_id = p_school_id
          )
        )
      )
  );
$$;

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
        and public.can_access_legacy_set_version(version, public.current_user_school_id())
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
      or (
        exists (
          select 1
          from public.test_sessions ts
          where ts.problem_set_id = questions.test_version
            and ts.school_id = public.current_user_school_id()
            and ts.is_published = true
        )
        and public.can_access_legacy_set_version(test_version, public.current_user_school_id())
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
            or (
              exists (
                select 1
                from public.test_sessions ts
                where ts.problem_set_id = q.test_version
                  and ts.school_id = public.current_user_school_id()
                  and ts.is_published = true
              )
              and public.can_access_legacy_set_version(q.test_version, public.current_user_school_id())
            )
          )
        )
      )
  )
);

drop policy if exists "test assets select" on public.test_assets;
create policy "test assets select"
on public.test_assets for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and (
      public.can_access_school(school_id)
      or public.can_access_legacy_set_version(test_version, public.effective_school_scope_id())
    )
  )
);
