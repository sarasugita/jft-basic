import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bad, ensureVisibleSchools, logAuditEvent, normalizeText, ok, replaceVisibility, requireSuperAdmin } from "../_shared/questionSet.ts";

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

  const questionSetId = normalizeText(body.question_set_id);
  const title = normalizeText(body.title);
  const description = normalizeText(body.description);
  const versionLabel = normalizeText(body.version_label);
  const visibilityScope = normalizeText(body.visibility_scope);
  const status = normalizeText(body.status);
  const schoolIds = Array.isArray(body.school_ids)
    ? body.school_ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!questionSetId) return bad("question_set_id is required");
  if (!title) return bad("title is required");
  if (!versionLabel) return bad("version_label is required");
  if (!["global", "restricted"].includes(visibilityScope ?? "")) {
    return bad("visibility_scope must be global or restricted");
  }
  if (!["draft", "published", "archived"].includes(status ?? "")) {
    return bad("status must be draft, published, or archived");
  }
  if (visibilityScope === "restricted" && schoolIds.length === 0) {
    return bad("Restricted visibility requires at least one school");
  }

  const visibleSchools = await ensureVisibleSchools(context.adminClient, schoolIds);
  if (!visibleSchools.ok) return bad(visibleSchools.error ?? "Invalid schools");

  const { error } = await context.adminClient
    .from("question_sets")
    .update({
      title,
      description,
      version_label: versionLabel,
      visibility_scope: visibilityScope,
      status,
    })
    .eq("id", questionSetId);
  if (error) return bad(error.message);

  await replaceVisibility(
    context.adminClient,
    questionSetId,
    visibilityScope === "restricted" ? schoolIds : [],
  );

  await logAuditEvent(context.adminClient, context, {
    actionType: "update",
    entityType: "question_set",
    entityId: questionSetId,
    metadata: {
      title,
      version_label: versionLabel,
      status,
      visibility_scope: visibilityScope,
      school_ids: schoolIds,
    },
  });

  return ok({ ok: true, question_set_id: questionSetId });
});
