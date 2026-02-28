// Supabase Edge Function: manage-school-admins
// - Requires an authenticated active super_admin user.
// - Supports create, update, and enable/disable for school-level admins.
// - Onboarding method: temporary password + forced password change.

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
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
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

async function logAuditEvent(adminClient: ReturnType<typeof createClient>, payload: Record<string, unknown>) {
  const { error } = await adminClient.from("audit_logs").insert(payload);
  if (error) console.error("audit log insert failed:", error.message);
}

function generateTempPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
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
    .select("id, role, account_status, email")
    .eq("id", callerUserData.user.id)
    .single();
  if (profileError || !callerProfile) return unauthorized("Profile not found");
  if (callerProfile.role !== "super_admin" || callerProfile.account_status !== "active") {
    return unauthorized("Active super admin only");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const action = String(body?.action ?? "").trim();
  const schoolId = normalizeText(body?.school_id);

  if (!["create", "update", "set_status"].includes(action)) {
    return bad("Unsupported action");
  }
  if (!schoolId) return bad("school_id is required");

  const { data: school, error: schoolError } = await adminClient
    .from("schools")
    .select("id, name, status")
    .eq("id", schoolId)
    .single();
  if (schoolError || !school) return bad("School not found");

  if (action === "create") {
    const email = normalizeText(body?.email)?.toLowerCase() ?? null;
    const displayName = normalizeText(body?.display_name ?? body?.displayName);
    const tempPassword = normalizeText(body?.temp_password ?? body?.tempPassword) ?? generateTempPassword();
    if (!email) return bad("email is required");

    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
        force_password_change: true,
      },
    });
    if (createError || !createData.user?.id) {
      return bad(createError?.message ?? "Failed to create admin user");
    }

    const { error: upsertError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: createData.user.id,
          role: "admin",
          school_id: schoolId,
          account_status: "active",
          email,
          display_name: displayName,
          force_password_change: true,
          disabled_at: null,
        },
        { onConflict: "id" },
      );
    if (upsertError) {
      return bad("Failed to create admin profile", { detail: upsertError.message });
    }

    await logAuditEvent(adminClient, {
      actor_user_id: callerUserData.user.id,
      actor_role: callerProfile.role,
      actor_email: callerProfile.email ?? null,
      action_type: "create",
      entity_type: "admin",
      entity_id: createData.user.id,
      school_id: schoolId,
      metadata: {
        email,
        display_name: displayName,
      },
    });

    return ok({
      ok: true,
      action,
      school: { id: school.id, name: school.name },
      admin: {
        id: createData.user.id,
        email,
        display_name: displayName,
        role: "admin",
        account_status: "active",
      },
      temp_password: tempPassword,
    });
  }

  const userId = normalizeText(body?.user_id);
  if (!userId) return bad("user_id is required");

  const { data: targetProfile, error: targetError } = await adminClient
    .from("profiles")
    .select("id, role, school_id, email, display_name, account_status")
    .eq("id", userId)
    .single();
  if (targetError || !targetProfile) return bad("Admin profile not found");
  if (targetProfile.role !== "admin") return bad("Target user is not a school admin");
  if (targetProfile.school_id !== schoolId) return bad("Admin does not belong to this school");

  if (action === "update") {
    const email = normalizeText(body?.email)?.toLowerCase() ?? targetProfile.email ?? null;
    const displayName = normalizeText(body?.display_name ?? body?.displayName);

    const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
      email: email ?? undefined,
      user_metadata: {
        display_name: displayName,
      },
    });
    if (authError) return bad(authError.message);

    const updatePayload: Record<string, unknown> = {
      email,
      display_name: displayName,
    };
    const { error: updateError } = await adminClient
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId);
    if (updateError) {
      return bad("Failed to update admin profile", { detail: updateError.message });
    }

    await logAuditEvent(adminClient, {
      actor_user_id: callerUserData.user.id,
      actor_role: callerProfile.role,
      actor_email: callerProfile.email ?? null,
      action_type: "update",
      entity_type: "admin",
      entity_id: userId,
      school_id: schoolId,
      metadata: {
        email,
        display_name: displayName,
      },
    });

    return ok({ ok: true, action, user_id: userId });
  }

  const accountStatus = normalizeText(body?.account_status);
  if (!["active", "disabled"].includes(accountStatus ?? "")) {
    return bad("account_status must be active or disabled");
  }

  const { error: statusError } = await adminClient
    .from("profiles")
    .update({
      account_status: accountStatus,
      disabled_at: accountStatus === "disabled" ? new Date().toISOString() : null,
    })
    .eq("id", userId);
  if (statusError) {
    return bad("Failed to update admin status", { detail: statusError.message });
  }

  await logAuditEvent(adminClient, {
    actor_user_id: callerUserData.user.id,
    actor_role: callerProfile.role,
    actor_email: callerProfile.email ?? null,
    action_type: accountStatus === "active" ? "enable" : "disable",
    entity_type: "admin",
    entity_id: userId,
    school_id: schoolId,
    metadata: {
      account_status: accountStatus,
      email: targetProfile.email ?? null,
    },
  });

  return ok({ ok: true, action, user_id: userId, account_status: accountStatus });
});
