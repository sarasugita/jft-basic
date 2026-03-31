-- Check if student #50 has force_password_change flag set
SELECT
  id,
  display_name,
  student_code,
  email,
  force_password_change,
  created_at
FROM public.profiles
WHERE student_code = '50'
AND role = 'student'
AND school_id = 'fc22f0f7-ba8e-4abc-b297-8619a3a42c6b';
