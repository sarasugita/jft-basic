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
  console.log("[archive-question-set] request", { questionSetId });

  const { data: questionSet, error: questionSetError } = await context.adminClient
    .from("question_sets")
    .select("id, title, library_key, version, status")
    .eq("id", questionSetId)
    .single();
  if (questionSetError || !questionSet) return bad(questionSetError?.message ?? "Question set not found");
  console.log("[archive-question-set] loaded question set", {
    id: questionSet.id,
    title: questionSet.title,
    library_key: questionSet.library_key,
    version: questionSet.version,
    status: questionSet.status,
  });

  const { data: familyRows, error: familyError } = await context.adminClient
    .from("question_sets")
    .select("id, title, version")
    .eq("library_key", questionSet.library_key);
  if (familyError) return bad(familyError.message);
  const familyIds = (familyRows ?? []).map((row) => row.id).filter(Boolean);
  if (!familyIds.length) return bad("Question set family not found");
  console.log("[archive-question-set] family rows", {
    familyCount: familyIds.length,
    familyIds,
    familyStatuses: (familyRows ?? []).map((row) => ({ id: row.id, version: row.version, title: row.title })),
  });

  if (questionSet.status !== "archived") {
    console.log("[archive-question-set] entering archive branch");
    const { error: archiveError } = await context.adminClient
      .from("question_sets")
      .update({ status: "archived" })
      .in("id", familyIds);
    if (archiveError) return bad(archiveError.message);
    console.log("[archive-question-set] archive branch completed");

    await logAuditEvent(context.adminClient, context, {
      actionType: "update",
      entityType: "question_set",
      entityId: questionSetId,
      metadata: {
        archived_family: true,
        library_key: questionSet.library_key,
        version: questionSet.version,
      },
    });

    return ok({
      ok: true,
      phase: "archive",
      question_set_id: questionSetId,
      archived_family: true,
      family_count: familyIds.length,
    });
  }

  console.log("[archive-question-set] entering hard-delete branch");
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
  console.log("[archive-question-set] dependency counts", {
    instanceCount: (instanceRows ?? []).length,
    attemptCount: (attemptRows ?? []).length,
  });
  if ((instanceRows ?? []).length || (attemptRows ?? []).length) {
    console.log("[archive-question-set] hard delete blocked by dependencies");
    return bad(
      "This SetID is still used by historical test instances or attempts, so it cannot be hard-deleted yet.",
    );
  }

  const { data: deletedRows, error: deleteError } = await context.adminClient
    .from("question_sets")
    .delete()
    .eq("library_key", questionSet.library_key)
    .select("id");
  if (deleteError) return bad(deleteError.message);
  console.log("[archive-question-set] delete completed", {
    deletedCount: (deletedRows ?? []).length,
    deletedIds: (deletedRows ?? []).map((row) => row.id),
  });

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

  return ok({
    ok: true,
    phase: "hard_delete",
    question_set_id: questionSetId,
    deleted_family: true,
    deleted_count: (deletedRows ?? []).length,
    family_count: familyIds.length,
  });
});
