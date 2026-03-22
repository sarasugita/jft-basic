alter table public.profiles
  add column if not exists is_test_account boolean not null default false;
