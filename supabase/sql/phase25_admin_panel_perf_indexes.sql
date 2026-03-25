create index if not exists profiles_school_role_created_idx
  on public.profiles (school_id, role, created_at desc);

create index if not exists attempts_school_created_idx
  on public.attempts (school_id, created_at desc);
