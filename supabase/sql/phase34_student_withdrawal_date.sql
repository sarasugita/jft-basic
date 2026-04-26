alter table public.profiles
  add column if not exists withdrawal_date date;

create or replace function public.guard_profile_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.role is null then
      raise exception 'role is required';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if public.current_user_role() = 'student' then
    if auth.uid() <> new.id then
      raise exception 'students can only update their own profile';
    end if;
    if new.role is distinct from old.role
      or new.school_id is distinct from old.school_id
      or new.is_withdrawn is distinct from old.is_withdrawn
      or new.withdrawal_date is distinct from old.withdrawal_date
      or new.student_code is distinct from old.student_code then
      raise exception 'students cannot modify protected profile fields';
    end if;
  elsif public.current_user_role() = 'admin' then
    if new.role is distinct from old.role
      or new.school_id is distinct from old.school_id then
      raise exception 'school admins cannot modify role or school assignment';
    end if;
  end if;

  return new;
end;
$$;
