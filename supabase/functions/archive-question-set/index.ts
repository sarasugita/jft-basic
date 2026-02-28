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

  const questionSetId = normalizeText(body.question_set_id);
  if (!questionSetId) return bad("question_set_id is required");

  const { data: questionSet, error: questionSetError } = await context.adminClient
    .from("question_sets")
    .select("id, title")
    .eq("id", questionSetId)
    .single();
  if (questionSetError || !questionSet) return bad(questionSetError?.message ?? "Question set not found");

  const { error } = await context.adminClient
    .from("question_sets")
    .update({ status: "archived" })
    .eq("id", questionSetId);
  if (error) return bad(error.message);

  const { error: legacyError } = await context.adminClient
    .from("tests")
    .update({ is_public: false, updated_at: new Date().toISOString() })
    .eq("version", questionSet.title);
  if (legacyError) return bad(legacyError.message);

  await logAuditEvent(context.adminClient, context, {
    actionType: "archive",
    entityType: "question_set",
    entityId: questionSetId,
    metadata: { status: "archived" },
  });

  return ok({ ok: true, question_set_id: questionSetId, status: "archived" });
});
