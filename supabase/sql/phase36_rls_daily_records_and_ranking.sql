-- Phase 36: enable RLS for daily record and ranking tables
-- Apply after the base school-scoped RLS helpers and policies already exist.
-- Policies are created first, then RLS is enabled at the end so current access
-- does not get interrupted during the migration.

begin;

drop policy if exists "daily records select" on public.daily_records;
create policy "daily records select"
on public.daily_records for select
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "daily records manage" on public.daily_records;
create policy "daily records manage"
on public.daily_records for all
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "daily record comments select" on public.daily_record_student_comments;
create policy "daily record comments select"
on public.daily_record_student_comments for select
to authenticated
using (
  exists (
    select 1
    from public.daily_records dr
    where dr.id = record_id
      and public.current_user_role() in ('super_admin', 'admin')
      and public.can_access_school(dr.school_id)
  )
);

drop policy if exists "daily record comments manage" on public.daily_record_student_comments;
create policy "daily record comments manage"
on public.daily_record_student_comments for all
to authenticated
using (
  exists (
    select 1
    from public.daily_records dr
    where dr.id = record_id
      and public.current_user_role() in ('super_admin', 'admin')
      and public.can_access_school(dr.school_id)
  )
)
with check (
  exists (
    select 1
    from public.daily_records dr
    where dr.id = record_id
      and public.current_user_role() in ('super_admin', 'admin')
      and public.can_access_school(dr.school_id)
  )
);

drop policy if exists "ranking periods select" on public.ranking_periods;
create policy "ranking periods select"
on public.ranking_periods for select
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin', 'student')
  and public.can_access_school(school_id)
);

drop policy if exists "ranking periods manage" on public.ranking_periods;
create policy "ranking periods manage"
on public.ranking_periods for all
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "ranking entries select" on public.ranking_entries;
create policy "ranking entries select"
on public.ranking_entries for select
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin', 'student')
  and public.can_access_school(school_id)
);

drop policy if exists "ranking entries manage" on public.ranking_entries;
create policy "ranking entries manage"
on public.ranking_entries for all
to authenticated
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

alter table public.daily_records enable row level security;
alter table public.daily_record_student_comments enable row level security;
alter table public.ranking_periods enable row level security;
alter table public.ranking_entries enable row level security;

commit;
