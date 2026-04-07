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
    .select("id, title, library_key, version")
    .eq("id", questionSetId)
    .single();
  if (questionSetError || !questionSet) return bad(questionSetError?.message ?? "Question set not found");

  const { data: familyRows, error: familyError } = await context.adminClient
    .from("question_sets")
    .select("id, title, version")
    .eq("library_key", questionSet.library_key);
  if (familyError) return bad(familyError.message);
  const familyIds = (familyRows ?? []).map((row) => row.id).filter(Boolean);
  if (!familyIds.length) return bad("Question set family not found");

  const [{ data: instanceRows, error: instancesError }, { data: attemptRows, error: attemptsError }] = await Promise.all([
    context.adminClient
      .from("test_instances")
      .select("id")
      .in("question_set_id", familyIds),
    context.adminClient
      .from("attempts")
      .select("id")
      .in("question_set_id", familyIds),
  ]);
  if (instancesError) return bad(instancesError.message);
  if (attemptsError) return bad(attemptsError.message);
  if ((instanceRows ?? []).length || (attemptRows ?? []).length) {
    return bad(
      "This SetID is still used by historical test instances or attempts, so it cannot be hard-deleted yet.",
    );
  }

  const { error: deleteError } = await context.adminClient
    .from("question_sets")
    .delete()
    .eq("library_key", questionSet.library_key);
  if (deleteError) return bad(deleteError.message);

  await logAuditEvent(context.adminClient, context, {
    actionType: "delete",
    entityType: "question_set",
    entityId: questionSetId,
    metadata: {
      deleted_family: true,
      library_key: questionSet.library_key,
      version: questionSet.version,
    },
  });

  return ok({ ok: true, question_set_id: questionSetId, deleted_family: true });
});
