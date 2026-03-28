"use client";

/**
 * Shared audit helpers for admin workspace state hooks.
 * Extracted from AdminConsoleCore.jsx during the per-workspace refactor.
 */

export async function getSupabaseAccessToken(supabase) {
  const { data: sessionData } = await supabase.auth.getSession();
  let accessToken = sessionData?.session?.access_token ?? null;
  const expiresAt = sessionData?.session?.expires_at ?? 0;
  if (!accessToken || expiresAt * 1000 < Date.now() + 60_000) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) {
      accessToken = refreshed?.session?.access_token ?? null;
    }
  }
  return accessToken;
}

export async function recordAdminAuditEvent(supabase, {
  actionType,
  entityType,
  entityId,
  summary,
  metadata = {},
  schoolId,
}) {
  if (!supabase || !actionType || !entityType || !entityId || !summary) return;
  const accessToken = await getSupabaseAccessToken(supabase);
  if (!accessToken) return;
  const { error } = await supabase.functions.invoke("record-audit-log", {
    body: {
      action_type: actionType,
      entity_type: entityType,
      entity_id: entityId,
      school_id: schoolId,
      metadata: { summary, ...metadata },
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) {
    console.error("record-audit-log error:", error);
  }
}
