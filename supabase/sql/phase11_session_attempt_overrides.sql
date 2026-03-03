create table if not exists public.test_session_attempt_overrides (
  id uuid primary key default gen_random_uuid(),
  test_session_id uuid not null references public.test_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  extra_attempts integer not null default 0 check (extra_attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (test_session_id, student_id)
);

alter table public.test_session_attempt_overrides
  add column if not exists school_id uuid references public.schools(id) on delete restrict;

create index if not exists test_session_attempt_overrides_school_idx
  on public.test_session_attempt_overrides (school_id);
create index if not exists test_session_attempt_overrides_session_idx
  on public.test_session_attempt_overrides (test_session_id);
create index if not exists test_session_attempt_overrides_student_idx
  on public.test_session_attempt_overrides (student_id);

alter table public.test_session_attempt_overrides
  alter column school_id set default public.current_user_school_id();

create or replace function public.sync_test_session_attempt_override_school_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.school_id is null and new.test_session_id is not null then
    select ts.school_id into new.school_id
    from public.test_sessions ts
    where ts.id = new.test_session_id;
  end if;

  if new.school_id is null and new.student_id is not null then
    select p.school_id into new.school_id
    from public.profiles p
    where p.id = new.student_id;
  end if;

  if new.school_id is null then
    new.school_id := public.current_user_school_id();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists test_session_attempt_overrides_sync_school_id on public.test_session_attempt_overrides;
create trigger test_session_attempt_overrides_sync_school_id
before insert or update on public.test_session_attempt_overrides
for each row execute function public.sync_test_session_attempt_override_school_id();

alter table public.test_session_attempt_overrides enable row level security;

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
    and school_id = public.current_user_school_id()
  )
);

drop policy if exists "test session attempt overrides admin manage" on public.test_session_attempt_overrides;
create policy "test session attempt overrides admin manage"
on public.test_session_attempt_overrides for all
using (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
)
with check (
  public.is_super_admin()
  or (
    public.current_user_role() = 'admin'
    and school_id = public.current_user_school_id()
  )
);
