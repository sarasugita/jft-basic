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
3. `supabase/sql/storage.sql`

`phase1_multi_school_rbac.sql` is idempotent and backfills the current single-school data model into one school record named `Default School` when needed.

## One-Time Promotion to `super_admin`

Pick the existing global admin user and promote that profile in the SQL editor.

```sql
update public.profiles
set role = 'super_admin',
    school_id = null
where email = 'existing-admin@example.com';
```

If you want the current school data to keep having a school-level admin after that promotion, assign another user to the backfilled school:

```sql
update public.profiles
set role = 'admin',
    school_id = (
      select id
      from public.schools
      where lower(name) = lower('Default School')
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

## Known Phase 1 Boundary

- `/super/*` UI routes are not implemented yet in this pass.
- The existing admin UI continues to work for school admins under DB-enforced school scope.
