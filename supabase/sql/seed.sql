-- Seed basic test data
insert into public.tests (version, title, type, pass_rate, is_public)
values ('test_exam', 'Test Exam', 'mock', 0.8, true)
on conflict (version) do update
set title = excluded.title,
    type = excluded.type,
    pass_rate = excluded.pass_rate,
    is_public = excluded.is_public;
