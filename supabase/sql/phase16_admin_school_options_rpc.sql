-- Phase 16: resolve school admin school-option labels server-side

create or replace function public.get_admin_school_options()
returns table (
  school_id uuid,
  school_name text,
  school_status text,
  is_primary boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with caller as (
    select id, role, school_id, account_status
    from public.profiles
    where id = auth.uid()
  ),
  admin_schools as (
    select
      s.id as school_id,
      s.name as school_name,
      s.status as school_status,
      (
        s.id = c.school_id
        or exists (
          select 1
          from public.admin_school_assignments asa
          where asa.admin_user_id = c.id
            and asa.school_id = s.id
            and asa.is_primary = true
        )
      ) as is_primary
    from caller c
    join public.schools s
      on c.role = 'admin'
     and c.account_status = 'active'
     and public.user_has_school_assignment(c.id, s.id)
  ),
  super_admin_schools as (
    select
      s.id as school_id,
      s.name as school_name,
      s.status as school_status,
      false as is_primary
    from caller c
    join public.schools s
      on c.role = 'super_admin'
     and c.account_status = 'active'
  )
  select *
  from (
    select * from admin_schools
    union all
    select * from super_admin_schools
  ) school_options
  order by is_primary desc, school_name asc, school_id asc;
$$;
