# Super Admin UI

## Route Flow

- `/super` redirects to `/super/dashboard`
- `/super/dashboard` is the Super Admin landing page
- `/super/dashboard` shows real aggregate totals with a date range filter
- `/super/schools` is the school management hub
- `/super/tests/import` is the global question-set management shell
- `/super/tests/import` supports CSV validation, asset upload, versioning, metadata edits, and visibility management
- `/super/tests/analytics` is the cross-school analytics shell
- `/super/tests/analytics` shows real school comparison and question-set performance aggregates
- `/super/audit` is the audit/logs placeholder
- `/super/audit` shows basic audit events for school, admin, and question-set mutations
- `/super/schools/:schoolId` redirects to `/super/schools/:schoolId/admin`
- `/super/schools/:schoolId/admin/*` reuses the existing admin console in a forced school scope

## How To Use

1. Sign in with a `super_admin` account.
2. Open `/super/dashboard` or `/super`.
3. Use the shared Super Admin sidebar to move between `Dashboard`, `Schools`, `Tests Management`, and `Audit / Logs`.
4. Open `/super/schools` to search or filter the school list if needed.
5. Review the Schools List columns:
   `School Name`, `Attendance`, `Daily Test`, `Model Test`, `Student No.`, `Start Date`, `End Date`, `Status`.
6. Use `Create School`, `Edit`, or `Disable/Enable` for school management.
7. Click `Enter` to open the existing admin UI for that school.
8. Click `Admin List` to manage school-level admin accounts.
9. Use `Change school` in the scoped admin banner to return to `/super/schools`.

## Scope Enforcement

- Middleware protects `/super/*` using the signed-in access token mirrored into a cookie.
- The `/super` layout also validates the client session/profile and redirects inactive or non-super users back to `/`.
- The scoped admin view sends `x-school-scope: <schoolId>` with Supabase requests.
- `supabase/sql/phase2_super_admin_school_scope.sql` makes that header the effective school scope for `super_admin` on school-scoped tables.
- `supabase/sql/phase3_initial_school_and_admins.sql` adds `start_date` / `end_date` and disables school admins server-side via `profiles.account_status`.
- The existing admin console is reused as-is, but it now runs against a scoped Supabase client when opened through `/super/schools/:schoolId/admin`.

## File Map

- Super layout: `apps/admin/src/app/super/layout.jsx`
- Shared shell and nav: `apps/admin/src/components/super/SuperAdminShell.jsx`
- Dashboard page: `apps/admin/src/app/super/dashboard/page.jsx`
- Schools page: `apps/admin/src/app/super/schools/page.jsx`
- Tests import page: `apps/admin/src/app/super/tests/import/page.jsx`
- Tests analytics page: `apps/admin/src/app/super/tests/analytics/page.jsx`
- Audit page: `apps/admin/src/app/super/audit/page.jsx`
- Upload guide: `docs/question-set-upload.md`

## Adding A New Super Page

1. Add a route under `apps/admin/src/app/super/.../page.jsx`.
2. Add the nav entry in `apps/admin/src/components/super/SuperAdminShell.jsx`.
3. If needed, extend the title/description mapping in the same shell file so the shared header stays accurate.
4. Keep the page body focused on content panels only; the `/super` layout provides the shared frame and role guard behavior.

## Config

No new environment variables are required.

Required existing vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## New Backend Piece

- SQL migration: `supabase/sql/phase2_super_admin_school_scope.sql`
- SQL migration: `supabase/sql/phase3_initial_school_and_admins.sql`
- SQL migration: `supabase/sql/phase4_tests_management_architecture.sql`
- SQL migration: `supabase/sql/phase5_question_set_upload_support.sql`
- SQL migration: `supabase/sql/phase6_super_admin_completion_pack.sql`
- Edge Function: `supabase/functions/manage-school-admins`
- Edge Function: `supabase/functions/manage-schools`
- Edge Functions:
  `supabase/functions/validate-question-set-upload`
  `supabase/functions/create-question-set`
  `supabase/functions/upload-question-set-version`
  `supabase/functions/update-question-set-metadata`
  `supabase/functions/set-question-set-visibility`
  `supabase/functions/archive-question-set`

## Aggregation Rules

- Attendance: `present / total attendance entries` where `status = 'P'` counts as present.
- Daily Test: average attempt score for tests where `tests.type = 'daily'`.
- Model Test: average attempt score for tests where `tests.type = 'mock'`.
- Aggregation window: `school.start_date -> school.end_date`, or `school.start_date -> today` when `end_date` is empty.
- If data is missing for a metric, the UI shows `N/A`.

## Implemented Now

- Global dashboard cards use backend aggregate RPCs with a date range filter.
- Tests analytics uses backend aggregate RPCs for school comparison and question-set performance.
- Audit logs are written server-side from school, school-admin, and question-set mutation endpoints.
- Schools create/update/status changes now go through a server endpoint instead of direct client mutations.

## Remaining TODO

- Question-level accuracy for the new question-set runtime still needs dedicated result-fact storage.
- Analytics charting is intentionally kept table-first for now.

## School Admin Onboarding

Implemented option: temporary password + forced password change on first login.

- `Create Admin` creates an auth user and a `profiles` row with:
  `role = admin`
  `school_id = :schoolId`
  `account_status = active`
  `force_password_change = true`
- `Disable` sets `profiles.account_status = disabled`.
- Disabled admins are blocked from backend access because RLS helpers stop treating them as active admins.
