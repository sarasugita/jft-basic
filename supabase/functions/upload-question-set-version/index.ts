import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  bad,
  ensureVisibleSchools,
  ok,
  parseUploadForm,
  replaceVisibility,
  requireSuperAdmin,
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

  const sourceId = parsed.metadata.source_question_set_id;
  if (!sourceId) return bad("source_question_set_id is required");

  const { data: sourceSet, error: sourceError } = await context.adminClient
    .from("question_sets")
    .select("id, library_key, title, description, test_type, visibility_scope")
    .eq("id", sourceId)
    .single();
  if (sourceError || !sourceSet) {
    return bad("Source question set not found");
  }

  const visibleSchools = await ensureVisibleSchools(context.adminClient, parsed.metadata.school_ids);
  if (!visibleSchools.ok) return bad(visibleSchools.error ?? "Invalid schools");

  const validation = await validateQuestionSetCsv(parsed.csvFile, parsed.assetFiles);
  if (!validation.valid) {
    return bad("Validation failed", { validation });
  }

  const { data: maxVersionRow } = await context.adminClient
    .from("question_sets")
    .select("version")
    .eq("library_key", sourceSet.library_key)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = Number(maxVersionRow?.version ?? 0) + 1;

  const { data: inserted, error: insertError } = await context.adminClient
    .from("question_sets")
    .insert({
      library_key: sourceSet.library_key,
      source_question_set_id: sourceSet.id,
      title: parsed.metadata.title || sourceSet.title,
      description: parsed.metadata.description ?? sourceSet.description,
      test_type: parsed.metadata.test_type || sourceSet.test_type,
      version: nextVersion,
      version_label: parsed.metadata.version_label,
      status: parsed.metadata.status,
      visibility_scope: parsed.metadata.visibility_scope,
      created_by: context.callerUserId,
    })
    .select("id, library_key, version, version_label")
    .single();

  if (insertError || !inserted) {
    return bad(insertError?.message ?? "Failed to create question set version");
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
