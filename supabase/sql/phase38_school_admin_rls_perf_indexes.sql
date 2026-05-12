-- Phase 38: indexes for school-admin RLS visibility checks
-- These support the school-scoped helper paths used by tests/questions visibility
-- so school-admin requests stay fast under RLS.

begin;

create index if not exists test_sessions_problem_set_school_idx
  on public.test_sessions (problem_set_id, school_id);

create index if not exists attempts_test_version_school_idx
  on public.attempts (test_version, school_id);

create index if not exists tests_public_updated_created_idx
  on public.tests (is_public, updated_at desc, created_at desc);

commit;
