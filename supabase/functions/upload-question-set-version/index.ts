import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import {
  bad,
  ensureVisibleSchools,
  logAuditEvent,
  ok,
  parseUploadForm,
  resolveUniqueVersionLabel,
  replaceVisibility,
  requireSuperAdmin,
  syncLegacyTestCatalog,
  uploadAssets,
  validateQuestionSetCsv,
} from "../_shared/questionSet.ts";

function findDuplicateOptionErrors(validation: Awaited<ReturnType<typeof validateQuestionSetCsv>>) {
  const errors: string[] = [];
  for (const questionSet of validation.question_sets ?? []) {
    for (const question of questionSet.questions ?? []) {
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const option of question.options ?? []) {
        const label = String(option ?? "").trim();
        if (!label) continue;
        const normalized = label.normalize("NFKC");
        if (seen.has(normalized)) {
          if (!duplicates.includes(label)) duplicates.push(label);
          continue;
        }
        seen.add(normalized);
      }
      if (duplicates.length) {
        errors.push(
          `[${questionSet.set_id}] Row ${question.qid}: duplicate answer option(s) found: ${duplicates.join(", ")}. Each question must have unique choices.`,
        );
      }
    }
  }
  return errors;
}

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

  const validation = await validateQuestionSetCsv(parsed.csvFile, parsed.assetFiles, {
    testType: parsed.metadata.test_type,
    defaultSetId: sourceSet.title,
  });
  if (!validation.valid) {
    return bad("Validation failed", { validation });
  }
  const duplicateOptionErrors = findDuplicateOptionErrors(validation);
  if (duplicateOptionErrors.length) {
    return bad("Validation failed", { validation: { ...validation, valid: false, errors: [...validation.errors, ...duplicateOptionErrors] } });
  }
  if (validation.question_sets.length !== 1) {
    return bad("Version uploads must contain exactly one set_id.", { validation });
  }
  const uploadedSet = validation.question_sets[0];
  if (uploadedSet.set_id !== sourceSet.title) {
    return bad(`Uploaded set_id "${uploadedSet.set_id}" must match "${sourceSet.title}".`, { validation });
  }

  const { data: rootSet, error: rootSetError } = await context.adminClient
    .from("question_sets")
    .select("id, version, visibility_scope")
    .eq("library_key", sourceSet.library_key)
    .order("version", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (rootSetError) return bad(rootSetError.message);

  const rootVisibilityScope = rootSet?.visibility_scope ?? sourceSet.visibility_scope;
  if (rootVisibilityScope === "global" && parsed.metadata.visibility_scope === "restricted") {
    return bad(
      "This SetID started as global, so future versions must stay global. Upload the new version with global visibility.",
    );
  }
  const scopeNotice = rootVisibilityScope === "restricted" && parsed.metadata.visibility_scope === "global"
    ? "Previous version was school-scoped. This new version will be available to all schools."
    : "";

  const { data: maxVersionRow } = await context.adminClient
    .from("question_sets")
    .select("version")
    .eq("library_key", sourceSet.library_key)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = Number(maxVersionRow?.version ?? 0) + 1;
  const { data: versionLabelRows, error: versionLabelError } = await context.adminClient
    .from("question_sets")
    .select("version_label")
    .eq("library_key", sourceSet.library_key);
  if (versionLabelError) return bad(versionLabelError.message);
  const resolvedVersionLabel = resolveUniqueVersionLabel(
    (versionLabelRows ?? []).map((item) => item.version_label),
    parsed.metadata.version_label,
    nextVersion,
  );

  const { data: inserted, error: insertError } = await context.adminClient
    .from("question_sets")
    .insert({
      library_key: sourceSet.library_key,
      source_question_set_id: sourceSet.id,
      title: sourceSet.title,
      description: parsed.metadata.description ?? sourceSet.description,
      test_type: parsed.metadata.test_type || sourceSet.test_type,
      version: nextVersion,
      version_label: resolvedVersionLabel,
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

    const questionRows = uploadedSet.questions.map((question) => ({
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

    // Check for duplicate order_index values
    const orderIndexCounts = new Map<number, number>();
    for (const row of questionRows) {
      const count = (orderIndexCounts.get(row.order_index) ?? 0) + 1;
      orderIndexCounts.set(row.order_index, count);
    }
    const duplicateIndices = Array.from(orderIndexCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([index]) => index);
    if (duplicateIndices.length > 0) {
      throw new Error(
        `Duplicate order_index values found: ${duplicateIndices.join(", ")}. ` +
        `Each question must have a unique order_index within the same SetID.`
      );
    }

    // Batch insert questions (250 per request to avoid payload size limits)
    const QUESTION_BATCH_SIZE = 250;
    for (let i = 0; i < questionRows.length; i += QUESTION_BATCH_SIZE) {
      const batch = questionRows.slice(i, i + QUESTION_BATCH_SIZE);
      const { error: questionError } = await context.adminClient
        .from("question_set_questions")
        .insert(batch);
      if (questionError) throw new Error(questionError.message);
    }

    await replaceVisibility(
      context.adminClient,
      inserted.id,
      parsed.metadata.visibility_scope === "restricted" ? parsed.metadata.school_ids : [],
    );

    await syncLegacyTestCatalog(context.adminClient, {
      setId: sourceSet.title,
      testType: parsed.metadata.test_type || sourceSet.test_type,
      category: parsed.metadata.category,
      schoolId: legacySchoolId,
      questions: uploadedSet.questions,
      uploadedAssets,
    });

      await logAuditEvent(context.adminClient, context, {
      actionType: "upload",
      entityType: "question_set_version",
      entityId: inserted.id,
      metadata: {
        source_question_set_id: sourceSet.id,
        library_key: sourceSet.library_key,
        root_visibility_scope: rootVisibilityScope,
        category: parsed.metadata.category,
        version_label: inserted.version_label,
        status: parsed.metadata.status,
        visibility_scope: parsed.metadata.visibility_scope,
        school_ids: parsed.metadata.school_ids,
      },
    });

    return ok({
      ok: true,
      question_set: inserted,
      validation,
      scope_notice: scopeNotice || undefined,
    });
  } catch (error) {
    await context.adminClient.from("question_set_questions").delete().eq("question_set_id", inserted.id);
    await context.adminClient.from("question_set_school_access").delete().eq("question_set_id", inserted.id);
    await context.adminClient.from("question_sets").delete().eq("id", inserted.id);
    return bad(String(error instanceof Error ? error.message : error));
  }
});
