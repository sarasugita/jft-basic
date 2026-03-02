alter table public.attempts
  add column if not exists tab_left_count integer not null default 0;
