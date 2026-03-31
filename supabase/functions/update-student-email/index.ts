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

  const { data: callerProfile, error: callerProfileError } = await adminClient
    .from("profiles")
    .select("id, role, school_id")
    .eq("id", callerUserData.user.id)
    .single();
  if (callerProfileError || !callerProfile) return unauthorized("Profile not found");
  if (!["super_admin", "admin"].includes(callerProfile.role)) {
    return unauthorized("Super admin or school admin only");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const userId = String(body?.user_id ?? "").trim();
  const nextEmail = String(body?.email ?? "").trim().toLowerCase();
  const requestedSchoolId = String(body?.school_id ?? body?.schoolId ?? "").trim() || null;
  if (!userId) return bad("user_id is required");
  if (!nextEmail) return bad("email is required");

  const { data: targetProfile, error: targetProfileError } = await adminClient
    .from("profiles")
    .select("id, role, school_id, email")
    .eq("id", userId)
    .single();
  if (targetProfileError || !targetProfile) return bad("Target profile not found");
  if (targetProfile.role !== "student") return unauthorized("Only student accounts can be updated here");

  if (callerProfile.role === "admin") {
    const effectiveSchoolId = requestedSchoolId ?? callerProfile.school_id;
    if (!effectiveSchoolId) return unauthorized("Admin is missing school scope");
    if (
      effectiveSchoolId !== callerProfile.school_id
      && !(await adminHasSchoolAccess(adminClient, callerProfile.id, effectiveSchoolId))
    ) {
      return unauthorized("Cannot update a student from an unauthorized school");
    }
    if (targetProfile.school_id !== effectiveSchoolId) {
      return unauthorized("Cannot update a student from another school");
    }
  }

  const { data: authUpdateData, error: authUpdateError } = await adminClient.auth.admin.updateUserById(
    userId,
    {
      email: nextEmail,
    },
  );
  if (authUpdateError || !authUpdateData?.user) {
    return bad(authUpdateError?.message ?? "Failed to update auth user email");
  }

  const { error: profileUpdateError } = await adminClient
    .from("profiles")
    .update({ email: nextEmail })
    .eq("id", userId);
  if (profileUpdateError) {
    return bad("Profile email update failed", { detail: profileUpdateError.message });
  }

  return ok({
    ok: true,
    user_id: userId,
    email: nextEmail,
  });
});
