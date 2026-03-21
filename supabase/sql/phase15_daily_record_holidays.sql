-- Phase 15: add holiday overrides for schedule and record rows

alter table public.daily_records
  add column if not exists is_holiday boolean;
