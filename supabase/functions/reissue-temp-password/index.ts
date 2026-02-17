// Supabase Edge Function: reissue-temp-password
// - Requires an authenticated admin user (checked via public.profiles.role)
// - Resets a user's password to a temporary password and forces password change

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

function generateTempPassword() {
  return Math.random().toString(36).slice(2, 10) + "A1!";
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
    .select("id, role")
    .eq("id", callerUserData.user.id)
    .single();
  if (profileError || !callerProfile) return unauthorized("Profile not found");
  if (callerProfile.role !== "admin") return unauthorized("Admin only");

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const userId = String(body?.user_id ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const tempPassword = String(body?.temp_password ?? "").trim() || generateTempPassword();
  if (!userId) return bad("user_id is required");

  const { data: updateData, error: updateError } = await adminClient.auth.admin.updateUserById(
    userId,
    {
      password: tempPassword,
      user_metadata: { force_password_change: true },
    },
  );
  if (updateError || !updateData?.user) {
    return bad(updateError?.message ?? "Update failed");
  }

  const profileUpdate: Record<string, unknown> = { force_password_change: true };
  if (email) profileUpdate.email = email;
  const { error: profileErr } = await adminClient
    .from("profiles")
    .update(profileUpdate)
    .eq("id", userId);
  if (profileErr) {
    return bad("Profile update failed", { detail: profileErr.message });
  }

  return ok({ ok: true, user_id: userId, email, temp_password: tempPassword });
});
