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

  const validation = await validateQuestionSetCsv(parsed.csvFile, parsed.assetFiles, {
    testType: parsed.metadata.test_type,
  });
  if (!validation.valid) {
    return bad("Validation failed", { validation });
  }

  const requestedSetIds = validation.question_sets.map((group) => group.set_id);
  const { data: existingSets, error: existingSetsError } = await context.adminClient
    .from("question_sets")
    .select("id, library_key, title, description, test_type, version, status, version_label, visibility_scope")
    .eq("test_type", parsed.metadata.test_type)
    .in("title", requestedSetIds);
  if (existingSetsError) return bad(existingSetsError.message);

  const duplicateStrategy = parsed.metadata.duplicate_strategy ?? null;
  const activeDuplicateSets = (existingSets ?? []).filter((item) => item.status !== "archived" && requestedSetIds.includes(item.title));
  const activeDuplicateSetIds = Array.from(new Set(activeDuplicateSets.map((item) => item.title)));
  const activeDuplicateSetMap = new Map<string, (typeof activeDuplicateSets)[number]>();
  for (const item of activeDuplicateSets) {
    const current = activeDuplicateSetMap.get(item.title);
    if (!current || Number(item.version ?? 0) > Number(current.version ?? 0)) {
      activeDuplicateSetMap.set(item.title, item);
    }
  }
  if (activeDuplicateSets.length && !["all", "new_only"].includes(String(duplicateStrategy ?? ""))) {
    return bad("One or more SetIDs already exist for this test type. Choose how to handle the duplicates and try again.", {
      existing_set_ids: activeDuplicateSetIds,
    });
  }

  const archivedVersionOneIds = (existingSets ?? [])
    .filter((item) => item.status === "archived" && requestedSetIds.includes(item.title) && Number(item.version) === 1)
    .map((item) => item.id);
  if (archivedVersionOneIds.length) {
    const { error: deleteArchivedError } = await context.adminClient
      .from("question_sets")
      .delete()
      .in("id", archivedVersionOneIds);
    if (deleteArchivedError) {
      return bad(`Deleted question set cleanup failed: ${deleteArchivedError.message}`);
    }
  }

  const createdSetIds: string[] = [];
  const createdQuestionSets: Array<{ id: string; library_key: string; version: number; version_label: string; title: string }> = [];
  const skippedSetIds: string[] = [];
  const updatedSetIds: string[] = [];

  try {
    for (const questionSetGroup of validation.question_sets) {
      const existingSet = activeDuplicateSetMap.get(questionSetGroup.set_id) ?? null;
      if (existingSet && duplicateStrategy === "new_only") {
        skippedSetIds.push(questionSetGroup.set_id);
        continue;
      }

      const isVersionUpload = Boolean(existingSet);
      const nextVersion = isVersionUpload
        ? Number(
            (existingSets ?? [])
              .filter((item) => item.title === questionSetGroup.set_id && item.status !== "archived")
              .reduce((max, item) => Math.max(max, Number(item.version ?? 0)), 0)
          ) + 1
        : 1;
      const questionSetPayload: Record<string, unknown> = {
        title: questionSetGroup.set_id,
        description: isVersionUpload ? parsed.metadata.description ?? existingSet?.description ?? null : parsed.metadata.description,
        test_type: parsed.metadata.test_type,
        version: nextVersion,
        version_label: parsed.metadata.version_label,
        status: parsed.metadata.status,
        visibility_scope: parsed.metadata.visibility_scope,
        created_by: context.callerUserId,
      };
      if (isVersionUpload) {
        const { data: rootSet, error: rootSetError } = await context.adminClient
          .from("question_sets")
          .select("id, version, visibility_scope")
          .eq("library_key", existingSet?.library_key)
          .order("version", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (rootSetError) return bad(rootSetError.message);

        const rootVisibilityScope = rootSet?.visibility_scope ?? existingSet?.visibility_scope ?? parsed.metadata.visibility_scope;
        if (rootVisibilityScope === "global" && parsed.metadata.visibility_scope === "restricted") {
          return bad(
            "This SetID started as global, so future versions must stay global. Upload the new version with global visibility.",
          );
        }

        questionSetPayload.library_key = existingSet?.library_key ?? null;
        questionSetPayload.source_question_set_id = existingSet?.id ?? null;
      }
      const { data: inserted, error: insertError } = await context.adminClient
        .from("question_sets")
        .insert(questionSetPayload)
        .select("id, library_key, version, version_label, title")
        .single();

      if (insertError || !inserted) {
        throw new Error(insertError?.message ?? `Failed to create question set "${questionSetGroup.set_id}"`);
      }
      createdSetIds.push(inserted.id);
      if (isVersionUpload) {
        updatedSetIds.push(questionSetGroup.set_id);
      }

      const uploadedAssets = await uploadAssets(
        context.adminClient,
        inserted.library_key,
        inserted.version_label,
        parsed.assetFiles,
      );

      const questionRows = questionSetGroup.questions.map((question) => ({
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
        setId: questionSetGroup.set_id,
        testType: parsed.metadata.test_type,
        category: parsed.metadata.category,
        schoolId: legacySchoolId,
        questions: questionSetGroup.questions,
        uploadedAssets,
      });

      await logAuditEvent(context.adminClient, context, {
        actionType: "upload",
        entityType: "question_set",
        entityId: inserted.id,
        metadata: {
          title: questionSetGroup.set_id,
          category: parsed.metadata.category,
          version_label: parsed.metadata.version_label,
          test_type: parsed.metadata.test_type,
          status: parsed.metadata.status,
          visibility_scope: parsed.metadata.visibility_scope,
          school_ids: parsed.metadata.school_ids,
        },
      });

      createdQuestionSets.push(inserted);
    }

    return ok({
      ok: true,
      question_sets: createdQuestionSets,
      skipped_set_ids: skippedSetIds,
      updated_set_ids: updatedSetIds,
      validation,
    });
  } catch (error) {
    if (createdSetIds.length) {
      await context.adminClient.from("question_set_questions").delete().in("question_set_id", createdSetIds);
      await context.adminClient.from("question_set_school_access").delete().in("question_set_id", createdSetIds);
      await context.adminClient.from("question_sets").delete().in("id", createdSetIds);
    }
    return bad(String(error instanceof Error ? error.message : error));
  }
});
