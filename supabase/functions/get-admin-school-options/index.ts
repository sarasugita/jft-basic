// Supabase Edge Function: get-admin-school-options
// - Requires an authenticated active school admin or super_admin.
// - Returns school options with canonical names/status for the caller's accessible schools.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.94.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-school-scope",
      "access-control-allow-methods": "POST, OPTIONS",
      ...(init.headers ?? {}),
    },
  });
}

function ok(body: unknown) {
  return json(body, { status: 200 });
}

function bad(message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status: 400 });
}

function unauthorized(message = "Unauthorized") {
  return json({ error: message }, { status: 401 });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return ok({ ok: true });
  if (req.method !== "POST") return bad("Use POST");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { error: "Missing env vars (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return unauthorized("Missing Authorization header");

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerUserData, error: callerUserError } = await callerClient.auth.getUser();
  if (callerUserError || !callerUserData?.user) return unauthorized("Invalid session");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, school_id, account_status")
    .eq("id", callerUserData.user.id)
    .single();
  if (profileError || !callerProfile) return unauthorized("Profile not found");
  if (!["super_admin", "admin"].includes(callerProfile.role)) {
    return unauthorized("Super admin or school admin only");
  }
  if (callerProfile.account_status !== "active") {
    return unauthorized("Active account required");
  }

  let schoolIds: string[] = [];
  let primarySchoolId: string | null = callerProfile.school_id ?? null;

  if (callerProfile.role === "super_admin") {
    const { data: schools, error: schoolsError } = await adminClient
      .from("schools")
      .select("id, name, status")
      .order("created_at", { ascending: true });
    if (schoolsError) return bad("Failed to load schools", { detail: schoolsError.message });
    return ok({
      ok: true,
      schools: (schools ?? []).map((school) => ({
        school_id: school.id,
        school_name: school.name ?? school.id,
        school_status: school.status ?? null,
        is_primary: school.id === primarySchoolId,
      })),
    });
  }

  const { data: assignments, error: assignmentsError } = await adminClient
    .from("admin_school_assignments")
    .select("school_id, is_primary")
    .eq("admin_user_id", callerProfile.id)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });
  if (assignmentsError) {
    return bad("Failed to load admin school assignments", { detail: assignmentsError.message });
  }

  schoolIds = Array.from(
    new Set([primarySchoolId, ...(assignments ?? []).map((row) => row.school_id)].filter(Boolean)),
  );
  if (schoolIds.length === 0) {
    return ok({ ok: true, schools: [] });
  }

  const { data: schools, error: schoolsError } = await adminClient
    .from("schools")
    .select("id, name, status")
    .in("id", schoolIds);
  if (schoolsError) return bad("Failed to load schools", { detail: schoolsError.message });

  const schoolMap = Object.fromEntries((schools ?? []).map((school) => [school.id, school]));
  const normalized = schoolIds.map((schoolId) => ({
    school_id: schoolId,
    school_name: schoolMap[schoolId]?.name ?? schoolId,
    school_status: schoolMap[schoolId]?.status ?? null,
    is_primary:
      schoolId === primarySchoolId
      || (assignments ?? []).some((row) => row.school_id === schoolId && row.is_primary),
  }));

  return ok({ ok: true, schools: normalized });
});
