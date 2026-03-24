create index if not exists attempts_student_created_idx
  on public.attempts (student_id, created_at desc);

create index if not exists attempts_test_session_created_idx
  on public.attempts (test_session_id, created_at desc);

create index if not exists absence_applications_student_created_idx
  on public.absence_applications (student_id, created_at desc);
