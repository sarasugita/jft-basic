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

## Storage

Create a bucket named `test-assets` (private or public) and add policies for admin upload.
