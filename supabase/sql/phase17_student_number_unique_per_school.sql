-- Phase 17: keep student numbers unique within each school

create unique index if not exists profiles_student_number_per_school_unique
  on public.profiles (school_id, student_code)
  where role = 'student' and student_code is not null;
