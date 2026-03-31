-- Find ALL students with code "50" across all schools
SELECT
  p.id,
  p.display_name,
  p.student_code,
  p.school_id,
  s.name as school_name,
  p.role,
  p.created_at
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
WHERE p.student_code = '50'
ORDER BY s.name, p.created_at;

-- Count duplicates
SELECT
  student_code,
  COUNT(*) as profile_count,
  COUNT(DISTINCT school_id) as school_count
FROM public.profiles
WHERE student_code = '50'
GROUP BY student_code;

-- Check which auth.uid() is mapped to each student #50
SELECT
  p.id as profile_id,
  p.display_name,
  p.student_code,
  s.name as school_name,
  p.created_at,
  u.email,
  u.email_confirmed_at
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
LEFT JOIN auth.users u ON p.id = u.id
WHERE p.student_code = '50'
ORDER BY s.name;
