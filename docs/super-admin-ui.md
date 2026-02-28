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
4. Use `Create School`, `Edit`, or `Disable/Enable` for school management.
5. Click `Enter` to open the existing admin UI for that school.
6. Use `Change school` in the scoped admin banner to return to `/super/schools`.

## Scope Enforcement

- Middleware protects `/super/*` using the signed-in access token mirrored into a cookie.
- The scoped admin view sends `x-school-scope: <schoolId>` with Supabase requests.
- `supabase/sql/phase2_super_admin_school_scope.sql` makes that header the effective school scope for `super_admin` on school-scoped tables.
- The existing admin console is reused as-is, but it now runs against a scoped Supabase client when opened through `/super/schools/:schoolId/admin`.

## Config

No new environment variables are required.

Required existing vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## New Backend Piece

- SQL migration: `supabase/sql/phase2_super_admin_school_scope.sql`

No new HTTP API endpoints were added for Task 2. Existing Supabase table access and existing Edge Functions are reused.
