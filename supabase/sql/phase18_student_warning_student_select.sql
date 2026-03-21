drop policy if exists "student warnings select" on public.student_warnings;
create policy "student warnings select"
on public.student_warnings for select
using (
  public.current_user_role() in ('super_admin', 'admin', 'student')
  and public.can_access_school(school_id)
);
