# Super Admin UI

## Route Flow

- `/super` redirects to `/super/schools`
- `/super/schools` is the Super Admin hub
- `/super/schools/:schoolId` redirects to `/super/schools/:schoolId/admin`
- `/super/schools/:schoolId/admin/*` reuses the existing admin console in a forced school scope

## How To Use

1. Sign in with a `super_admin` account.
2. Open `/super/schools`.
3. Search or filter the school list if needed.
4. Review the Schools List columns:
   `School Name`, `Attendance`, `Daily Test`, `Model Test`, `Student No.`, `Start Date`, `End Date`, `Status`.
5. Use `Create School`, `Edit`, or `Disable/Enable` for school management.
6. Click `Enter` to open the existing admin UI for that school.
7. Click `Admin List` to manage school-level admin accounts.
8. Use `Change school` in the scoped admin banner to return to `/super/schools`.

## Scope Enforcement

- Middleware protects `/super/*` using the signed-in access token mirrored into a cookie.
- The scoped admin view sends `x-school-scope: <schoolId>` with Supabase requests.
- `supabase/sql/phase2_super_admin_school_scope.sql` makes that header the effective school scope for `super_admin` on school-scoped tables.
- `supabase/sql/phase3_initial_school_and_admins.sql` adds `start_date` / `end_date` and disables school admins server-side via `profiles.account_status`.
- The existing admin console is reused as-is, but it now runs against a scoped Supabase client when opened through `/super/schools/:schoolId/admin`.

## Config

No new environment variables are required.

Required existing vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## New Backend Piece

- SQL migration: `supabase/sql/phase2_super_admin_school_scope.sql`
- SQL migration: `supabase/sql/phase3_initial_school_and_admins.sql`
- Edge Function: `supabase/functions/manage-school-admins`

## Aggregation Rules

- Attendance: `present / total attendance entries` where `status = 'P'` counts as present.
- Daily Test: average attempt score for tests where `tests.type = 'daily'`.
- Model Test: average attempt score for tests where `tests.type = 'mock'`.
- Aggregation window: `school.start_date -> school.end_date`, or `school.start_date -> today` when `end_date` is empty.
- If data is missing for a metric, the UI shows `N/A`.

## School Admin Onboarding

Implemented option: temporary password + forced password change on first login.

- `Create Admin` creates an auth user and a `profiles` row with:
  `role = admin`
  `school_id = :schoolId`
  `account_status = active`
  `force_password_change = true`
- `Disable` sets `profiles.account_status = disabled`.
- Disabled admins are blocked from backend access because RLS helpers stop treating them as active admins.
