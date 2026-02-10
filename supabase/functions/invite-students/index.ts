// Supabase Edge Function: invite-students
// - Requires an authenticated admin user (checked via public.profiles.role)
// - Invites users by email and upserts public.profiles with metadata

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.94.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INVITE_REDIRECT_TO = Deno.env.get("INVITE_REDIRECT_TO") ?? "";

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

function normalizeStudent(input: any) {
  const email = String(input?.email ?? "").trim().toLowerCase();
  const displayName = String(input?.display_name ?? input?.displayName ?? "").trim();
  const studentCode = String(input?.student_code ?? input?.studentCode ?? "").trim();
  return {
    email,
    display_name: displayName || null,
    student_code: studentCode || null,
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

  const list = Array.isArray(body?.students) ? body.students : [body];
  const students = list.map(normalizeStudent).filter((s) => s.email);
  if (students.length === 0) return bad("No students provided");

  const results: Array<Record<string, unknown>> = [];

  for (const s of students) {
    try {
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(s.email, {
        redirectTo: INVITE_REDIRECT_TO || undefined,
        data: {
          display_name: s.display_name,
          student_code: s.student_code,
        },
      });

      if (inviteError) {
        results.push({ email: s.email, ok: false, error: inviteError.message });
        continue;
      }

      const userId = inviteData.user?.id ?? null;

      if (userId) {
        const { error: upsertError } = await adminClient.from("profiles").upsert(
          {
            id: userId,
            role: "student",
            email: s.email,
            display_name: s.display_name,
            student_code: s.student_code,
          },
          { onConflict: "id" },
        );
        if (upsertError) {
          results.push({ email: s.email, ok: true, user_id: userId, warning: upsertError.message });
          continue;
        }
      }

      results.push({ email: s.email, ok: true, user_id: userId });
    } catch (e) {
      results.push({ email: s.email, ok: false, error: String(e?.message ?? e) });
    }
  }

  return ok({ ok: true, results });
});

