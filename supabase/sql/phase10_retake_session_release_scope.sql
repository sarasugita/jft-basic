alter table public.test_sessions
  add column if not exists retake_source_session_id uuid references public.test_sessions(id) on delete set null,
  add column if not exists retake_release_scope text not null default 'all';

alter table public.test_sessions
  drop constraint if exists test_sessions_retake_release_scope_check;

alter table public.test_sessions
  add constraint test_sessions_retake_release_scope_check
  check (retake_release_scope in ('all', 'failed_only', 'failed_and_absent', 'absent_only'));
