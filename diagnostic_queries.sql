-- Diagnostic queries for student #50 test visibility issue
-- Run these in Supabase SQL Editor to diagnose the problem

-- Step 1: Check if student #50 exists and their school assignment
SELECT
  p.id,
  p.display_name,
  p.student_code,
  p.school_id,
  s.name as school_name,
  p.role
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
WHERE p.student_code = '50'
  OR p.student_code LIKE '%50%'
ORDER BY p.student_code;

-- Step 2: Check what school "Grameen Caledonian College of Nursing" has
SELECT id, name, status FROM public.schools
WHERE LOWER(name) LIKE '%grameen%' OR LOWER(name) LIKE '%caledonian%';

-- Step 3: Check all test sessions and their school assignments
SELECT
  ts.id,
  ts.title,
  ts.is_published,
  ts.school_id,
  s.name as school_name,
  t.version,
  t.title as test_title
FROM public.test_sessions ts
LEFT JOIN public.schools s ON ts.school_id = s.id
LEFT JOIN public.tests t ON ts.problem_set_id = t.version
ORDER BY ts.created_at DESC
LIMIT 20;

-- Step 4: Check for any NULL school_ids in test_sessions (which would cause RLS to block access)
SELECT COUNT(*) as sessions_with_null_school
FROM public.test_sessions
WHERE school_id IS NULL;

-- Step 5: For student #50 specifically - simulate the RLS check
-- This shows what test_sessions they SHOULD be able to see
SELECT
  ts.id,
  ts.title,
  ts.is_published,
  ts.school_id,
  s.name as school_name,
  (
    -- This is the RLS check from "test sessions select" policy
    (
      -- can_access_school logic
      p.school_id IS NOT NULL AND p.school_id = ts.school_id
    )
    AND p.role IN ('super_admin', 'admin', 'student')
  ) as can_access
FROM public.test_sessions ts
LEFT JOIN public.schools s ON ts.school_id = s.id
CROSS JOIN (
  SELECT id, school_id, role FROM public.profiles
  WHERE student_code = '50'
) p
ORDER BY ts.created_at DESC;

-- Step 6: Check if student code "50" is unique per school (per phase17 constraints)
SELECT
  student_code,
  school_id,
  COUNT(*) as count,
  STRING_AGG(p.display_name, ', ') as student_names
FROM public.profiles p
WHERE student_code = '50'
GROUP BY student_code, school_id;

-- Step 7: Compare student 50 with other students in their school
SELECT
  p.student_code,
  p.display_name,
  p.school_id,
  s.name as school_name,
  COUNT(DISTINCT ts.id) as visible_test_sessions
FROM public.profiles p
LEFT JOIN public.schools s ON p.school_id = s.id
LEFT JOIN public.test_sessions ts ON (
  p.school_id IS NOT NULL
  AND p.school_id = ts.school_id
  AND ts.is_published = true
)
WHERE (p.school_id = (
  SELECT school_id FROM public.profiles WHERE student_code = '50' LIMIT 1
))
AND p.role = 'student'
GROUP BY p.id, p.student_code, p.display_name, p.school_id, s.name
ORDER BY CAST(p.student_code AS INTEGER) DESC
LIMIT 10;
