import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bad, logAuditEvent, normalizeText, ok, requireSuperAdmin } from "../_shared/questionSet.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return ok({ ok: true });
  if (req.method !== "POST") return bad("Use POST");

  const context = await requireSuperAdmin(req);
  if (context instanceof Response) return context;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const action = normalizeText(body.action);
  if (!["create", "update", "set_status"].includes(action ?? "")) {
    return bad("Unsupported action");
  }

  const schoolId = normalizeText(body.school_id);
  const name = normalizeText(body.name);
  const status = normalizeText(body.status);
  const academicYear = normalizeText(body.academic_year);
  const term = normalizeText(body.term);
  const startDate = normalizeText(body.start_date);
  const endDate = normalizeText(body.end_date);

  if (action === "create") {
    if (!name) return bad("name is required");
    if (!["active", "inactive"].includes(status ?? "")) return bad("status must be active or inactive");

    const { data, error } = await context.adminClient
      .from("schools")
      .insert({
        name,
        status,
        academic_year: academicYear,
        term,
        start_date: startDate,
        end_date: endDate,
      })
      .select("id, name, status, start_date, end_date")
      .single();
    if (error || !data) return bad(error?.message ?? "Failed to create school");

    await logAuditEvent(context.adminClient, context, {
      actionType: "create",
      entityType: "school",
      entityId: data.id,
      schoolId: data.id,
      metadata: {
        name: data.name,
        status: data.status,
        start_date: data.start_date,
        end_date: data.end_date,
      },
    });

    return ok({ ok: true, school: data });
  }

  if (!schoolId) return bad("school_id is required");

  if (action === "update") {
    if (!name) return bad("name is required");
    if (!["active", "inactive"].includes(status ?? "")) return bad("status must be active or inactive");

    const { data, error } = await context.adminClient
      .from("schools")
      .update({
        name,
        status,
        academic_year: academicYear,
        term,
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schoolId)
      .select("id, name, status, start_date, end_date")
      .single();
    if (error || !data) return bad(error?.message ?? "Failed to update school");

    await logAuditEvent(context.adminClient, context, {
      actionType: "update",
      entityType: "school",
      entityId: data.id,
      schoolId: data.id,
      metadata: {
        name: data.name,
        status: data.status,
        start_date: data.start_date,
        end_date: data.end_date,
      },
    });

    return ok({ ok: true, school: data });
  }

  if (!["active", "inactive"].includes(status ?? "")) return bad("status must be active or inactive");

  const { data, error } = await context.adminClient
    .from("schools")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", schoolId)
    .select("id, name, status")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to update school status");

  await logAuditEvent(context.adminClient, context, {
    actionType: status === "active" ? "enable" : "disable",
    entityType: "school",
    entityId: data.id,
    schoolId: data.id,
    metadata: { status: data.status, name: data.name },
  });

  return ok({ ok: true, school: data });
});
