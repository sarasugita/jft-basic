create table if not exists public.student_warnings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  criteria jsonb not null default '{}'::jsonb,
  student_count integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists student_warnings_school_idx
  on public.student_warnings (school_id, created_at desc);

create table if not exists public.student_warning_recipients (
  id uuid primary key default gen_random_uuid(),
  warning_id uuid not null references public.student_warnings(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (warning_id, student_id)
);

create index if not exists student_warning_recipients_warning_idx
  on public.student_warning_recipients (warning_id);

create index if not exists student_warning_recipients_student_idx
  on public.student_warning_recipients (student_id);

alter table public.student_warnings
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

alter table public.student_warning_recipients
  alter column school_id set default coalesce(public.effective_school_scope_id(), public.current_user_school_id());

create or replace function public.sync_student_warning_school_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'student_warnings' then
    if new.school_id is null and new.created_by is not null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.created_by;
    end if;
  elsif tg_table_name = 'student_warning_recipients' then
    if new.school_id is null then
      select sw.school_id into new.school_id
      from public.student_warnings sw
      where sw.id = new.warning_id;
    end if;
    if new.school_id is null then
      select p.school_id into new.school_id
      from public.profiles p
      where p.id = new.student_id;
    end if;
  end if;

  if new.school_id is null then
    new.school_id := coalesce(public.effective_school_scope_id(), public.current_user_school_id());
  end if;

  return new;
end;
$$;

drop trigger if exists student_warnings_sync_school_id on public.student_warnings;
create trigger student_warnings_sync_school_id
before insert or update on public.student_warnings
for each row execute function public.sync_student_warning_school_id();

drop trigger if exists student_warning_recipients_sync_school_id on public.student_warning_recipients;
create trigger student_warning_recipients_sync_school_id
before insert or update on public.student_warning_recipients
for each row execute function public.sync_student_warning_school_id();

alter table public.student_warnings enable row level security;
alter table public.student_warning_recipients enable row level security;

drop policy if exists "student warnings select" on public.student_warnings;
create policy "student warnings select"
on public.student_warnings for select
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "student warnings manage" on public.student_warnings;
create policy "student warnings manage"
on public.student_warnings for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "student warning recipients select" on public.student_warning_recipients;
create policy "student warning recipients select"
on public.student_warning_recipients for select
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);

drop policy if exists "student warning recipients manage" on public.student_warning_recipients;
create policy "student warning recipients manage"
on public.student_warning_recipients for all
using (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
)
with check (
  public.current_user_role() in ('super_admin', 'admin')
  and public.can_access_school(school_id)
);
