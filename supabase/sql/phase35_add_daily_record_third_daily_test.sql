-- Phase 35: add a third daily test slot to daily_records

alter table public.daily_records
  add column if not exists mini_test_3 text;
