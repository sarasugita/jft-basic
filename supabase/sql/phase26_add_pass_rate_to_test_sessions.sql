-- Add pass_rate column to test_sessions table so each session can have its own pass rate
alter table if exists public.test_sessions
add column if not exists pass_rate numeric default 0.8;

-- Create a comment explaining the column
comment on column public.test_sessions.pass_rate is 'Pass rate requirement for this test session (0 to 1, where 0.8 = 80%)';
