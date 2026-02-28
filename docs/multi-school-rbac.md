# Multi-School RBAC Foundation

This project now has three application roles:

- `super_admin`: global access across all schools
- `admin`: restricted to one `school_id`
- `student`: restricted to one `school_id`

Phase 1 keeps the existing admin UI and moves access control into the database and backend functions.

## Apply Order

Run these SQL files in order:

1. `supabase/sql/schema.sql`
2. `supabase/sql/phase1_multi_school_rbac.sql`
3. `supabase/sql/phase2_super_admin_school_scope.sql`
4. `supabase/sql/phase3_initial_school_and_admins.sql`
5. `supabase/sql/phase4_tests_management_architecture.sql`
6. `supabase/sql/phase5_question_set_upload_support.sql`
7. `supabase/sql/phase6_super_admin_completion_pack.sql`
8. `supabase/sql/storage.sql`

`phase1_multi_school_rbac.sql` creates the school-scoping/RBAC foundation.
`phase3_initial_school_and_admins.sql` performs the named initial-school migration for the legacy single-school dataset and adds school-admin account status support.
`phase4_tests_management_architecture.sql` adds the global question-set library and school-level test assignment architecture.
`phase5_question_set_upload_support.sql` finalizes the question-set upload/versioning schema used by the Super Admin import flow.
`phase6_super_admin_completion_pack.sql` adds audit logs and the aggregate RPCs used by the Super Admin dashboard and analytics pages.

## One-Time Promotion to `super_admin`

Pick the existing global admin user and promote that profile in the SQL editor.

```sql
update public.profiles
set role = 'super_admin',
    school_id = null
where email = 'existing-admin@example.com';
```

If you want the current school data to keep having a school-level admin after that promotion, assign another user to the migrated school:

```sql
update public.profiles
set role = 'admin',
    school_id = (
      select id
      from public.schools
      where lower(name) = lower('Grameen Caledonian College of Nursing')
      limit 1
    )
where email = 'school-admin@example.com';
```

## Create a School

```sql
insert into public.schools (name, status, academic_year, term)
values ('Dhaka Campus', 'active', '2026', 'Spring')
returning id, name, status;
```

## Create a School Admin

1. Create the auth user in Supabase Auth.
2. Attach the profile to a school with `role = 'admin'`.

```sql
update public.profiles
set role = 'admin',
    school_id = 'REPLACE_WITH_SCHOOL_UUID'
where email = 'new-admin@example.com';
```

The database constraint rejects `admin` and `student` rows without `school_id`, and school admins cannot promote users to admin through normal app credentials.

## Create a Student

Use the `invite-students` Edge Function.

- `super_admin` must provide `school_id`.
- `admin` is forced to their own `school_id`.

Single-user payload:

```json
{
  "email": "student@example.com",
  "display_name": "Student Name",
  "student_code": "S-1001",
  "temp_password": "TempPass1!",
  "school_id": "REPLACE_WITH_SCHOOL_UUID"
}
```

## Enforcement Summary

- RLS is enabled on `schools`, `profiles`, and the school-scoped runtime tables used by the admin/student apps.
- `super_admin` has global access.
- `admin` can only read and write rows for their own `school_id`.
- `student` can only read and write their own records where applicable.
- Edge Functions for inviting students, deleting students, and resetting passwords now enforce role and school scope server-side.
- Disabled school admins are blocked server-side because `current_user_role()` resolves to `null` when `profiles.account_status = 'disabled'`.

## Initial School Migration

`phase3_initial_school_and_admins.sql` migrates the legacy single-school dataset into:

- `name = 'Grameen Caledonian College of Nursing'`
- `status = active`
- `start_date = earliest attendance day, or current date if none exists`
- `end_date = null`

Backfill rules:

- If the database has zero or one legacy school record, all school-scoped data is pointed to this initial school.
- `super_admin` users are left with `school_id = null`.
- Remaining `admin` and `student` users are assigned the initial school.
- Existing tests, sessions, attempts, attendance rows, announcements, assets, and links are updated to the initial `school_id`.

## Known Phase 1 Boundary

- `/super/*` UI routes are not implemented yet in this pass.
- The existing admin UI continues to work for school admins under DB-enforced school scope.
