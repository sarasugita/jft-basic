// Supabase Edge Function: invite-students
// - Requires an authenticated super_admin or school admin.
// - School admins are restricted to their own school.
// - Creates student users with a temporary password and upserts public.profiles.

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

function generateTempPassword() {
  return Math.random().toString(36).slice(2, 10) + "A1!";
}

async function adminHasSchoolAccess(adminClient: ReturnType<typeof createClient>, userId: string, schoolId: string) {
  const { data, error } = await adminClient
    .from("admin_school_assignments")
    .select("admin_user_id")
    .eq("admin_user_id", userId)
    .eq("school_id", schoolId)
    .maybeSingle();
  if (error) {
    console.error("admin school access lookup failed:", error.message);
    return false;
  }
  return Boolean(data);
}

function normalizeStudent(input: any) {
  const email = String(input?.email ?? "").trim().toLowerCase();
  const displayName = String(input?.display_name ?? input?.displayName ?? "").trim();
  const studentCode = String(input?.student_code ?? input?.studentCode ?? "").trim();
  const tempPassword = String(input?.temp_password ?? input?.tempPassword ?? "").trim();
  const schoolId = String(input?.school_id ?? input?.schoolId ?? "").trim();
  return {
    email,
    display_name: displayName || null,
    student_code: studentCode || null,
    temp_password: tempPassword || null,
    school_id: schoolId || null,
  };
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

  // 1) Validate caller session with anon client
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerUserData, error: callerUserError } = await callerClient.auth.getUser();
  if (callerUserError || !callerUserData?.user) return unauthorized("Invalid session");

  // 2) Use service role for admin checks + admin operations
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, school_id")
    .eq("id", callerUserData.user.id)
    .single();
  if (profileError || !callerProfile) return unauthorized("Profile not found");
  if (!["super_admin", "admin"].includes(callerProfile.role)) {
    return unauthorized("Super admin or school admin only");
  }
  if (callerProfile.role === "admin" && !callerProfile.school_id) {
    return unauthorized("Admin is missing school assignment");
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const requestedSchoolId = String(body?.school_id ?? body?.schoolId ?? "").trim() || null;
  const list = Array.isArray(body?.students) ? body.students : [body];
  const students = list.map(normalizeStudent).filter((s) => s.email);
  if (students.length == 0) return bad("No students provided");

  const results: Array<Record<string, unknown>> = [];

  for (const s of students) {
    try {
      const targetSchoolId =
        callerProfile.role === "super_admin"
          ? (s.school_id ?? requestedSchoolId)
          : (s.school_id ?? requestedSchoolId ?? callerProfile.school_id);
      if (!targetSchoolId) {
        results.push({ email: s.email, ok: false, error: "school_id is required for student creation" });
        continue;
      }

      if (
        callerProfile.role === "admin"
        && targetSchoolId !== callerProfile.school_id
        && !(await adminHasSchoolAccess(adminClient, callerProfile.id, targetSchoolId))
      ) {
        results.push({ email: s.email, ok: false, error: "Admin cannot create students for this school" });
        continue;
      }

      const { data: school, error: schoolError } = await adminClient
        .from("schools")
        .select("id, status")
        .eq("id", targetSchoolId)
        .single();
      if (schoolError || !school) {
        results.push({ email: s.email, ok: false, error: "School not found" });
        continue;
      }
      if (school.status !== "active") {
        results.push({ email: s.email, ok: false, error: "School is inactive" });
        continue;
      }

      const tempPassword = s.temp_password || generateTempPassword();
      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email: s.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          display_name: s.display_name,
          student_code: s.student_code,
          force_password_change: true,
        },
      });

      if (createError) {
        results.push({ email: s.email, ok: false, error: createError.message });
        continue;
      }

      const userId = createData.user?.id ?? null;

      if (userId) {
        const { error: upsertError } = await adminClient.from("profiles").upsert(
          {
            id: userId,
            role: "student",
            school_id: targetSchoolId,
            email: s.email,
            display_name: s.display_name,
            student_code: s.student_code,
            force_password_change: true,
          },
          { onConflict: "id" },
        );
        if (upsertError) {
          results.push({ email: s.email, ok: true, user_id: userId, temp_password: tempPassword, warning: upsertError.message });
          continue;
        }
      }

      results.push({ email: s.email, ok: true, user_id: userId, temp_password: tempPassword });
    } catch (e) {
      results.push({ email: s.email, ok: false, error: String(e?.message ?? e) });
    }
  }

  return ok({ ok: true, results });
});
