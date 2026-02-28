-- Phase 7: multi-school admin assignments + selected school scope
-- Apply after phase6_super_admin_completion_pack.sql

create table if not exists public.admin_school_assignments (
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (admin_user_id, school_id)
);

create index if not exists admin_school_assignments_school_idx
  on public.admin_school_assignments (school_id, admin_user_id);

create unique index if not exists admin_school_assignments_primary_idx
  on public.admin_school_assignments (admin_user_id)
  where is_primary;

insert into public.admin_school_assignments (admin_user_id, school_id, is_primary, created_at)
select p.id, p.school_id, true, coalesce(p.created_at, now())
from public.profiles p
where p.role = 'admin'
  and p.school_id is not null
on conflict (admin_user_id, school_id) do update
set is_primary = excluded.is_primary;

create or replace function public.user_has_school_assignment(
  p_user_id uuid,
  p_school_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        p.role = 'super_admin'
        or (
          p.role = 'admin'
          and (
            p.school_id = p_school_id
            or exists (
              select 1
              from public.admin_school_assignments asa
              where asa.admin_user_id = p_user_id
                and asa.school_id = p_school_id
            )
          )
        )
        or (
          p.role = 'student'
          and p.school_id = p_school_id
        )
      )
  );
$$;

create or replace function public.sync_admin_primary_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' and new.school_id is not null then
    update public.admin_school_assignments
    set is_primary = false
    where admin_user_id = new.id
      and school_id is distinct from new.school_id
      and is_primary = true;

    insert into public.admin_school_assignments (
      admin_user_id,
      school_id,
      is_primary,
      created_by
    )
    values (
      new.id,
      new.school_id,
      true,
      auth.uid()
    )
    on conflict (admin_user_id, school_id) do update
    set is_primary = true;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_admin_primary_assignment on public.profiles;
create trigger profiles_sync_admin_primary_assignment
after insert or update of role, school_id on public.profiles
for each row execute function public.sync_admin_primary_assignment();

create or replace function public.effective_school_scope_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_super_admin() then public.requested_school_scope_id()
    when public.current_user_role() = 'admin' then coalesce(
      (
        select public.requested_school_scope_id()
        where public.requested_school_scope_id() is not null
          and public.user_has_school_assignment(auth.uid(), public.requested_school_scope_id())
      ),
      public.current_user_school_id()
    )
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
    when public.current_user_role() = 'admin' then
      target_school_id is not null
      and target_school_id = public.effective_school_scope_id()
      and public.user_has_school_assignment(auth.uid(), target_school_id)
    else target_school_id is not null and target_school_id = public.current_user_school_id()
  end
$$;

create or replace function public.can_access_question_set(
  p_question_set_id uuid,
  p_school_id uuid default public.effective_school_scope_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() = 'super_admin' then true
    when public.current_user_role() in ('admin', 'student') then
      p_school_id is not null
      and public.can_access_school(p_school_id)
      and public.question_set_is_available_to_school(p_question_set_id, p_school_id)
    else false
  end
$$;

create or replace function public.prepare_test_instance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_question_set public.question_sets%rowtype;
begin
  if new.school_id is null then
    new.school_id := coalesce(public.effective_school_scope_id(), public.current_user_school_id());
  end if;

  if new.created_by is null then
    new.created_by := auth.uid();
  end if;

  select *
  into v_question_set
  from public.question_sets
  where id = new.question_set_id;

  if not found then
    raise exception 'question_set_id % does not exist', new.question_set_id;
  end if;

  if not public.question_set_is_available_to_school(new.question_set_id, new.school_id) then
    raise exception 'question set % is not available to school %', new.question_set_id, new.school_id;
  end if;

  if auth.role() <> 'service_role'
     and public.current_user_role() = 'admin'
     and (
       new.school_id is distinct from public.effective_school_scope_id()
       or not public.user_has_school_assignment(auth.uid(), new.school_id)
     ) then
    raise exception 'school admins can only manage test instances in their selected school scope';
  end if;

  new.test_type := v_question_set.test_type;

  return new;
end;
$$;

alter table public.admin_school_assignments enable row level security;

drop policy if exists "admin school assignments select" on public.admin_school_assignments;
create policy "admin school assignments select"
on public.admin_school_assignments for select
using (
  public.current_user_role() = 'super_admin'
  or admin_user_id = auth.uid()
);

drop policy if exists "admin school assignments manage" on public.admin_school_assignments;
create policy "admin school assignments manage"
on public.admin_school_assignments for all
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists "question sets select" on public.question_sets;
create policy "question sets select"
on public.question_sets for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and public.can_access_question_set(id, public.effective_school_scope_id())
  )
);

drop policy if exists "question set school access select" on public.question_set_school_access;
create policy "question set school access select"
on public.question_set_school_access for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and school_id = public.effective_school_scope_id()
    and public.can_access_question_set(question_set_id, school_id)
  )
);

drop policy if exists "question set questions select" on public.question_set_questions;
create policy "question set questions select"
on public.question_set_questions for select
using (
  public.current_user_role() = 'super_admin'
  or (
    public.current_user_role() = 'admin'
    and public.can_access_question_set(question_set_id, public.effective_school_scope_id())
  )
);
