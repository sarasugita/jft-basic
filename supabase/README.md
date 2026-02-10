# Supabase (functions + SQL)

## Edge Functions

### `invite-students`

Invites students by email (single or bulk) and upserts `public.profiles`.

**Required secrets (Supabase Dashboard → Functions → Secrets):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INVITE_REDIRECT_TO` (recommended) e.g. `https://jft-basic.vercel.app/`

**Request body**

Single:
```json
{ "email": "s1@example.com", "display_name": "Taro", "student_code": "ID001" }
```

Bulk:
```json
{
  "students": [
    { "email": "s1@example.com", "display_name": "Taro", "student_code": "ID001" },
    { "email": "s2@example.com", "display_name": "Hanako", "student_code": "ID002" }
  ]
}
```

