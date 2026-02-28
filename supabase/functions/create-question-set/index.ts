import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  bad,
  ensureVisibleSchools,
  logAuditEvent,
  ok,
  parseUploadForm,
  replaceVisibility,
  requireSuperAdmin,
  syncLegacyTestCatalog,
  uploadAssets,
  validateQuestionSetCsv,
} from "../_shared/questionSet.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return ok({ ok: true });
  if (req.method !== "POST") return bad("Use POST");

  const context = await requireSuperAdmin(req);
  if (context instanceof Response) return context;

  const parsed = await parseUploadForm(req);
  if (parsed instanceof Response) return parsed;

  if (parsed.metadata.source_question_set_id) {
    return bad("Use upload-question-set-version for version uploads");
  }

  const visibleSchools = await ensureVisibleSchools(context.adminClient, parsed.metadata.school_ids);
  if (!visibleSchools.ok) return bad(visibleSchools.error ?? "Invalid schools");

  let legacySchoolId = parsed.metadata.school_ids[0] ?? null;
  if (!legacySchoolId) {
    const { data: fallbackSchool, error: fallbackSchoolError } = await context.adminClient
      .from("schools")
      .select("id")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallbackSchoolError) return bad(fallbackSchoolError.message);
    legacySchoolId = fallbackSchool?.id ?? null;
  }
  if (!legacySchoolId) return bad("No active school found for legacy test sync");

  const { data: existingSet, error: existingSetError } = await context.adminClient
    .from("question_sets")
    .select("id, title, test_type, version_label")
    .eq("title", parsed.metadata.title)
    .eq("test_type", parsed.metadata.test_type)
    .limit(1)
    .maybeSingle();
  if (existingSetError) return bad(existingSetError.message);
  if (existingSet) {
    return bad("That SetID already exists for this test type. Use Upload on the existing set to add a new version.", {
      existing_question_set_id: existingSet.id,
      existing_version_label: existingSet.version_label,
    });
  }

  const validation = await validateQuestionSetCsv(parsed.csvFile, parsed.assetFiles, parsed.metadata.test_type);
  if (!validation.valid) {
    return bad("Validation failed", { validation });
  }

  const { data: inserted, error: insertError } = await context.adminClient
    .from("question_sets")
    .insert({
      title: parsed.metadata.title,
      description: parsed.metadata.description,
      test_type: parsed.metadata.test_type,
      version: 1,
      version_label: parsed.metadata.version_label,
      status: parsed.metadata.status,
      visibility_scope: parsed.metadata.visibility_scope,
      created_by: context.callerUserId,
    })
    .select("id, library_key, version, version_label")
    .single();

  if (insertError || !inserted) {
    return bad(insertError?.message ?? "Failed to create question set");
  }

  try {
    const uploadedAssets = await uploadAssets(
      context.adminClient,
      inserted.library_key,
      inserted.version_label,
      parsed.assetFiles,
    );

    const questionRows = validation.questions.map((question) => ({
      question_set_id: inserted.id,
      qid: question.qid,
      question_text: question.question_text,
      question_type: question.question_type,
      correct_answer: question.correct_answer,
      options: question.options,
      media_type: question.media_type,
      media_path: question.media_file ? uploadedAssets.get(question.media_file) ?? null : null,
      media_url: question.media_file ? uploadedAssets.get(question.media_file) ?? null : null,
      order_index: question.order_index,
      metadata: question.metadata,
    }));

    const { error: questionError } = await context.adminClient
      .from("question_set_questions")
      .insert(questionRows);
    if (questionError) throw new Error(questionError.message);

    await replaceVisibility(
      context.adminClient,
      inserted.id,
      parsed.metadata.visibility_scope === "restricted" ? parsed.metadata.school_ids : [],
    );

    await syncLegacyTestCatalog(context.adminClient, {
      setId: parsed.metadata.title,
      testType: parsed.metadata.test_type,
      category: parsed.metadata.category,
      schoolId: legacySchoolId,
      questions: validation.questions,
      uploadedAssets,
    });

    await logAuditEvent(context.adminClient, context, {
      actionType: "upload",
      entityType: "question_set",
      entityId: inserted.id,
      metadata: {
        title: parsed.metadata.title,
        category: parsed.metadata.category,
        version_label: parsed.metadata.version_label,
        test_type: parsed.metadata.test_type,
        status: parsed.metadata.status,
        visibility_scope: parsed.metadata.visibility_scope,
        school_ids: parsed.metadata.school_ids,
      },
    });

    return ok({
      ok: true,
      question_set: inserted,
      validation,
    });
  } catch (error) {
    await context.adminClient.from("question_set_questions").delete().eq("question_set_id", inserted.id);
    await context.adminClient.from("question_set_school_access").delete().eq("question_set_id", inserted.id);
    await context.adminClient.from("question_sets").delete().eq("id", inserted.id);
    return bad(String(error instanceof Error ? error.message : error));
  }
});
