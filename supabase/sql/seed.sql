-- Seed basic test data
insert into public.tests (version, title, type, pass_rate, is_public)
values ('test_exam', 'Test Exam', 'mock', 0.8, true)
on conflict (version) do update
set title = excluded.title,
    type = excluded.type,
    pass_rate = excluded.pass_rate,
    is_public = excluded.is_public;

-- Seed a test session for the problem set
insert into public.test_sessions (problem_set_id, title, is_published)
values ('test_exam', 'Test Exam', true)
on conflict do nothing;
