drop policy if exists "student warning recipients select" on public.student_warning_recipients;
create policy "student warning recipients select"
on public.student_warning_recipients for select
using (
  (
    public.current_user_role() in ('super_admin', 'admin')
    and public.can_access_school(school_id)
  )
  or (
    public.current_user_role() = 'student'
    and student_id = auth.uid()
    and public.can_access_school(school_id)
  )
);
