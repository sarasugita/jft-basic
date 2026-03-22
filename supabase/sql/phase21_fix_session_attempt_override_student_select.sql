drop policy if exists "test session attempt overrides select" on public.test_session_attempt_overrides;
create policy "test session attempt overrides select"
on public.test_session_attempt_overrides for select
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
  )
);
