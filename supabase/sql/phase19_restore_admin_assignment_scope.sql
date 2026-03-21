-- Phase 19: restore assignment-aware school scope checks for multi-school admins
-- Phase 2 overwrote these helpers with versions that only respected the admin's
-- primary school. Shared admins then fail RLS checks on assigned schools.

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
