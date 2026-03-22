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

function bad(message: string) {
  return json({ error: message }, { status: 400 });
}

function unauthorized(message = "Unauthorized") {
  return json({ error: message }, { status: 401 });
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
  if (!["admin", "super_admin"].includes(String(callerProfile.role ?? ""))) {
    return unauthorized("Admin or super admin only");
  }
  if (String(callerProfile.account_status ?? "active") !== "active") {
    return unauthorized("Active account required");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const actionType = normalizeText(body.action_type);
  const entityType = normalizeText(body.entity_type);
  const entityId = normalizeText(body.entity_id);
  const schoolId = normalizeText(body.school_id);
  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};

  if (!actionType) return bad("action_type is required");
  if (!entityType) return bad("entity_type is required");
  if (!entityId) return bad("entity_id is required");

  const { error: insertError } = await adminClient.from("audit_logs").insert({
    actor_user_id: callerUserData.user.id,
    actor_role: callerProfile.role,
    actor_email: callerProfile.email ?? null,
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId,
    school_id: schoolId,
    metadata,
  });

  if (insertError) {
    console.error("audit log insert failed:", insertError.message);
    return json({ error: insertError.message }, { status: 500 });
  }

  return ok({ ok: true });
});
