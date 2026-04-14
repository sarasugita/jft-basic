-- Persist the source SetIDs selected when creating a daily session.
-- This makes the admin SetID column stable even before question metadata is hydrated.
alter table if exists public.test_sessions
add column if not exists source_set_ids jsonb not null default '[]'::jsonb;

comment on column public.test_sessions.source_set_ids
  is 'SetIDs selected when the session was created. Used for admin display and session provenance.';
