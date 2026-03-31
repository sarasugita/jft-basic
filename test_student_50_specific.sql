-- Get student #50's exact UUID and school
SELECT
  id,
  display_name,
  student_code,
  school_id,
  role,
  created_at,
  email
FROM public.profiles
WHERE student_code = '50'
AND role = 'student';

-- Check what test_sessions are in Grameen school
SELECT
  ts.id,
  ts.title,
  ts.is_published,
  ts.school_id,
  s.name as school_name,
  COUNT(*) OVER (PARTITION BY ts.title) as title_count
FROM public.test_sessions ts
LEFT JOIN public.schools s ON ts.school_id = s.id
WHERE ts.school_id = 'fc22f0f7-ba8e-4abc-b297-8619a3a42c6b'
ORDER BY ts.created_at DESC;

-- Simulate exactly what student #50 would fetch
-- Using their exact auth.uid as the context
SELECT
  ts.id,
  ts.title,
  ts.is_published,
  ts.school_id,
  s.name
FROM public.test_sessions ts
LEFT JOIN public.schools s ON ts.school_id = s.id
WHERE ts.school_id = 'fc22f0f7-ba8e-4abc-b297-8619a3a42c6b'
  AND ts.is_published = true
ORDER BY ts.created_at DESC;
