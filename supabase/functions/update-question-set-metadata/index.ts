import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bad, ensureVisibleSchools, logAuditEvent, normalizeText, ok, replaceVisibility, requireSuperAdmin } from "../_shared/questionSet.ts";

function toLegacyTestType(testType: string | null) {
  return testType === "model" ? "mock" : "daily";
}

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
  const testType = normalizeText(body.test_type);
  const category = normalizeText(body.category);
  const visibilityScope = normalizeText(body.visibility_scope);
  const status = normalizeText(body.status);
  const schoolIds = Array.isArray(body.school_ids)
    ? body.school_ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!questionSetId) return bad("question_set_id is required");
  if (!title) return bad("title is required");
  if (!["daily", "model"].includes(testType ?? "")) {
    return bad("test_type must be daily or model");
  }
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

  const { data: existingQuestionSet, error: existingQuestionSetError } = await context.adminClient
    .from("question_sets")
    .select("id, title, test_type, status")
    .eq("id", questionSetId)
    .maybeSingle();
  if (existingQuestionSetError) return bad(existingQuestionSetError.message);
  if (!existingQuestionSet) return bad("Question set not found");

  const oldTitle = normalizeText(existingQuestionSet.title);
  const nextLegacyType = toLegacyTestType(testType);
  const nextCategory = category || (testType === "model" ? "Book Review" : "Vocabulary");

  const { data: existingLegacyTest, error: existingLegacyTestError } = await context.adminClient
    .from("tests")
    .select("id, version, school_id, pass_rate, is_public")
    .eq("version", oldTitle)
    .maybeSingle();
  if (existingLegacyTestError) return bad(existingLegacyTestError.message);

  if (oldTitle && oldTitle !== title) {
    const { data: duplicateLegacyTest, error: duplicateLegacyTestError } = await context.adminClient
      .from("tests")
      .select("id")
      .eq("version", title)
      .maybeSingle();
    if (duplicateLegacyTestError) return bad(duplicateLegacyTestError.message);
    if (duplicateLegacyTest?.id) return bad("That SetID already exists.");
  }

  if (existingLegacyTest?.id) {
    if (oldTitle !== title) {
      const { error: createNewLegacyError } = await context.adminClient
        .from("tests")
        .insert({
          school_id: existingLegacyTest.school_id,
          version: title,
          title: nextCategory,
          type: nextLegacyType,
          pass_rate: existingLegacyTest.pass_rate,
          is_public: existingLegacyTest.is_public,
        });
      if (createNewLegacyError) return bad(createNewLegacyError.message);

      const { error: questionRenameError } = await context.adminClient
        .from("questions")
        .update({ test_version: title })
        .eq("test_version", oldTitle);
      if (questionRenameError) return bad(questionRenameError.message);

      const { error: assetRenameError } = await context.adminClient
        .from("test_assets")
        .update({ test_version: title, test_type: nextLegacyType })
        .eq("test_version", oldTitle);
      if (assetRenameError) return bad(assetRenameError.message);

      const { error: sessionRenameError } = await context.adminClient
        .from("test_sessions")
        .update({ problem_set_id: title })
        .eq("problem_set_id", oldTitle);
      if (sessionRenameError) return bad(sessionRenameError.message);

      const { error: attemptsRenameError } = await context.adminClient
        .from("attempts")
        .update({ test_version: title })
        .eq("test_version", oldTitle);
      if (attemptsRenameError) return bad(attemptsRenameError.message);

      const { error: deleteOldLegacyError } = await context.adminClient
        .from("tests")
        .delete()
        .eq("version", oldTitle);
      if (deleteOldLegacyError) return bad(deleteOldLegacyError.message);
    } else {
      const { error: updateLegacyError } = await context.adminClient
        .from("tests")
        .update({
          title: nextCategory,
          type: nextLegacyType,
        })
        .eq("version", oldTitle);
      if (updateLegacyError) return bad(updateLegacyError.message);

      const { error: updateLegacyAssetsError } = await context.adminClient
        .from("test_assets")
        .update({ test_type: nextLegacyType })
        .eq("test_version", oldTitle);
      if (updateLegacyAssetsError) return bad(updateLegacyAssetsError.message);
    }
  }

  const { error } = await context.adminClient
    .from("question_sets")
    .update({
      title,
      test_type: testType,
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
      category: nextCategory,
      test_type: testType,
      status,
      visibility_scope: visibilityScope,
      school_ids: schoolIds,
    },
  });

  return ok({ ok: true, question_set_id: questionSetId });
});
