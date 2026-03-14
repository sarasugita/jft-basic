# Supabase (functions + SQL)

## Edge Functions

### `invite-students`

Creates students with a temporary password (single or bulk) and upserts `public.profiles`.

**Required secrets (Supabase Dashboard → Functions → Secrets):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

**Request body**

Single:
```json
{ "email": "s1@example.com", "display_name": "Taro", "student_code": "ID001", "temp_password": "TempPass1!" }
```

### `delete-student`

Deletes an auth user and profile (admin-only).
Bulk:
```json
{
  "students": [
    { "email": "s1@example.com", "display_name": "Taro", "student_code": "ID001", "temp_password": "TempPass1!" },
    { "email": "s2@example.com", "display_name": "Hanako", "student_code": "ID002" }
  ]
}
```

## SQL (run once)

See `supabase/sql/schema.sql` for required tables/columns:
- `profiles` additions (`email`, `force_password_change`)
- `tests` / `questions` / `choices`
- `test_assets`
- `supabase/sql/phase1_multi_school_rbac.sql` for schools, RBAC, school scoping, and RLS
- `supabase/sql/phase2_super_admin_school_scope.sql` for scoped super-admin admin-console reuse
- `supabase/sql/phase3_initial_school_and_admins.sql` for the named initial school, school dates, and school-admin account status
- `supabase/sql/phase4_tests_management_architecture.sql` for the shared question-set library, school test instances, linked attempt analytics, and test metrics view
- `supabase/sql/phase5_question_set_upload_support.sql` for question-set status/version labels, upload-ready question fields, and library version grouping
- `supabase/sql/phase6_super_admin_completion_pack.sql` for audit logs plus dashboard/analytics aggregate RPCs
- `supabase/sql/phase7_admin_multi_school_access.sql` for multi-school admin assignments, admin school switching, and scoped admin access helpers
- `supabase/sql/phase8_legacy_global_test_visibility.sql` for legacy test/question visibility to follow question-set access
- `supabase/sql/phase9_attempt_tab_left_count.sql` for persisted tab-switch warning counts on attempts
- `supabase/sql/phase10_retake_session_release_scope.sql` for retake-session source/release scoping
- `supabase/sql/phase11_session_attempt_overrides.sql` for per-student extra attempt allowances
- `supabase/sql/phase12_student_warnings.sql` for student warning tracking
- `supabase/sql/phase13_fix_test_session_school_scope.sql` to keep created test sessions scoped to the active school instead of inheriting a legacy test row's school
- `supabase/sql/phase14_student_session_based_legacy_access.sql` so students can load legacy tests/questions/choices whenever a published session exists in their own school

Multi-school setup and promotion steps:
- `docs/multi-school-rbac.md`
- `docs/super-admin-ui.md`
- `docs/tests-management-architecture.md`
- `docs/question-set-upload.md`

Question CSV format: `docs/question_csv.md`

Sample CSV (from current Questions.js):
- `docs/test_exam_questions.csv`
- `docs/question_csv_template.csv` (separate columns, filename-based)
Sample assets:
- `docs/sample_test_assets/` (placeholders)

Seed:
- `supabase/sql/seed.sql` (creates Test Exam)

## Storage

Create a bucket named `test-assets` (private or public) and add policies for admin upload.
SQL helper:
- `supabase/sql/storage.sql`
