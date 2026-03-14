import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { bad, logAuditEvent, normalizeText, ok, requireSuperAdmin } from "../_shared/questionSet.ts";

function isMissingRelationError(message: string | null | undefined, relationName: string) {
  const text = String(message ?? "").toLowerCase();
  return text.includes(`relation "${relationName.toLowerCase()}" does not exist`);
}

function isMissingUserError(message: string | null | undefined) {
  const text = String(message ?? "").toLowerCase();
  return text.includes("user not found");
}

async function deleteBySchoolId(
  adminClient: ReturnType<(typeof import("https://esm.sh/@supabase/supabase-js@2.94.1"))["createClient"]>,
  table: string,
  schoolId: string,
  { ignoreMissingRelation = false }: { ignoreMissingRelation?: boolean } = {},
) {
  const { error } = await adminClient
    .from(table)
    .delete()
    .eq("school_id", schoolId);

  if (!error) return;
  if (ignoreMissingRelation && isMissingRelationError(error.message, table)) return;
  throw new Error(`Failed to delete ${table}: ${error.message}`);
}

async function getOtherAdminAssignments(
  adminClient: ReturnType<(typeof import("https://esm.sh/@supabase/supabase-js@2.94.1"))["createClient"]>,
  userId: string,
  schoolId: string,
) {
  const { data, error } = await adminClient
    .from("admin_school_assignments")
    .select("school_id, is_primary, created_at")
    .eq("admin_user_id", userId)
    .neq("school_id", schoolId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingRelationError(error.message, "admin_school_assignments")) {
      return [];
    }
    throw new Error(`Failed to inspect admin assignments: ${error.message}`);
  }

  return data ?? [];
}

async function grantSuperAdminQuestionSetsToNewSchool(
  adminClient: ReturnType<(typeof import("https://esm.sh/@supabase/supabase-js@2.94.1"))["createClient"]>,
  schoolId: string,
) {
  const { data: restrictedSets, error: restrictedSetsError } = await adminClient
    .from("question_sets")
    .select("id, created_by, status, visibility_scope")
    .eq("visibility_scope", "restricted")
    .neq("status", "archived");

  if (restrictedSetsError) {
    if (isMissingRelationError(restrictedSetsError.message, "question_sets")) {
      return { linkedCount: 0 };
    }
    throw new Error(`Failed to load question sets: ${restrictedSetsError.message}`);
  }

  const creatorIds = Array.from(new Set(
    (restrictedSets ?? [])
      .map((row) => row.created_by)
      .filter(Boolean),
  ));

  if (!creatorIds.length) {
    return { linkedCount: 0 };
  }

  const { data: creators, error: creatorsError } = await adminClient
    .from("profiles")
    .select("id, role")
    .in("id", creatorIds);

  if (creatorsError) {
    throw new Error(`Failed to load question-set creators: ${creatorsError.message}`);
  }

  const superAdminIds = new Set(
    (creators ?? [])
      .filter((row) => row.role === "super_admin")
      .map((row) => row.id),
  );

  const accessRows = (restrictedSets ?? [])
    .filter((row) => row.created_by && superAdminIds.has(row.created_by))
    .map((row) => ({
      question_set_id: row.id,
      school_id: schoolId,
    }));

  if (!accessRows.length) {
    return { linkedCount: 0 };
  }

  const { error: accessError } = await adminClient
    .from("question_set_school_access")
    .upsert(accessRows, { onConflict: "question_set_id,school_id" });

  if (accessError) {
    if (isMissingRelationError(accessError.message, "question_set_school_access")) {
      return { linkedCount: 0 };
    }
    throw new Error(`Failed to grant question-set access: ${accessError.message}`);
  }

  return {
    linkedCount: accessRows.length,
  };
}

async function permanentlyDeleteSchool(
  adminClient: ReturnType<(typeof import("https://esm.sh/@supabase/supabase-js@2.94.1"))["createClient"]>,
  schoolId: string,
) {
  const { data: profiles, error: profilesError } = await adminClient
    .from("profiles")
    .select("id, role, school_id")
    .eq("school_id", schoolId);
  if (profilesError) {
    throw new Error(`Failed to load school profiles: ${profilesError.message}`);
  }

  const deleteUserIds: string[] = [];
  let preservedAdminCount = 0;

  for (const profile of profiles ?? []) {
    if (profile.role === "super_admin") {
      throw new Error("Cannot delete a school while a super admin is assigned to it.");
    }

    if (profile.role === "admin") {
      const otherAssignments = await getOtherAdminAssignments(adminClient, profile.id, schoolId);
      if (otherAssignments.length > 0) {
        const nextSchoolId = otherAssignments.find((item) => item.is_primary)?.school_id ?? otherAssignments[0]?.school_id;
        const { error: updateError } = await adminClient
          .from("profiles")
          .update({ school_id: nextSchoolId })
          .eq("id", profile.id);
        if (updateError) {
          throw new Error(`Failed to reassign admin profile: ${updateError.message}`);
        }
        preservedAdminCount += 1;
        continue;
      }
    }

    deleteUserIds.push(profile.id);
  }

  await deleteBySchoolId(adminClient, "test_session_attempt_overrides", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "test_instances", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "exam_links", schoolId);
  await deleteBySchoolId(adminClient, "attempts", schoolId);
  await deleteBySchoolId(adminClient, "attendance_entries", schoolId);
  await deleteBySchoolId(adminClient, "absence_applications", schoolId);
  await deleteBySchoolId(adminClient, "announcements", schoolId);
  await deleteBySchoolId(adminClient, "daily_records", schoolId);
  await deleteBySchoolId(adminClient, "ranking_entries", schoolId);
  await deleteBySchoolId(adminClient, "ranking_periods", schoolId);
  await deleteBySchoolId(adminClient, "student_warning_recipients", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "student_warnings", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "attendance_days", schoolId);
  await deleteBySchoolId(adminClient, "question_set_school_access", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "admin_school_assignments", schoolId, { ignoreMissingRelation: true });
  await deleteBySchoolId(adminClient, "test_sessions", schoolId);
  await deleteBySchoolId(adminClient, "test_assets", schoolId);
  await deleteBySchoolId(adminClient, "questions", schoolId);
  await deleteBySchoolId(adminClient, "tests", schoolId);

  for (const userId of deleteUserIds) {
    const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (authDeleteError && !isMissingUserError(authDeleteError.message)) {
      throw new Error(`Failed to delete user ${userId}: ${authDeleteError.message}`);
    }
  }

  if (deleteUserIds.length > 0) {
    const { error: profileDeleteError } = await adminClient
      .from("profiles")
      .delete()
      .in("id", deleteUserIds);
    if (profileDeleteError) {
      throw new Error(`Failed to delete school profiles: ${profileDeleteError.message}`);
    }
  }

  const { error: schoolDeleteError } = await adminClient
    .from("schools")
    .delete()
    .eq("id", schoolId);
  if (schoolDeleteError) {
    throw new Error(`Failed to delete school: ${schoolDeleteError.message}`);
  }

  return {
    deletedUserCount: deleteUserIds.length,
    preservedAdminCount,
  };
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

  const action = normalizeText(body.action);
  if (!["create", "update", "set_status", "delete"].includes(action ?? "")) {
    return bad("Unsupported action");
  }

  const schoolId = normalizeText(body.school_id);
  const name = normalizeText(body.name);
  const status = normalizeText(body.status);
  const confirmText = normalizeText(body.confirm_text);
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

    let questionSetAccessSummary = { linkedCount: 0 };
    try {
      questionSetAccessSummary = await grantSuperAdminQuestionSetsToNewSchool(context.adminClient, data.id);
    } catch (grantError) {
      return bad("Failed to initialize school question-set access", {
        detail: String(grantError?.message ?? grantError),
      });
    }

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
        linked_question_set_count: questionSetAccessSummary.linkedCount,
      },
    });

    return ok({
      ok: true,
      school: data,
      question_set_access: questionSetAccessSummary,
    });
  }

  if (!schoolId) return bad("school_id is required");

  if (action === "delete") {
    if (confirmText !== "DELETE") {
      return bad("confirm_text must be DELETE");
    }

    const { data: school, error: schoolError } = await context.adminClient
      .from("schools")
      .select("id, name, status, start_date, end_date")
      .eq("id", schoolId)
      .single();
    if (schoolError || !school) return bad("School not found");

    let summary;
    try {
      summary = await permanentlyDeleteSchool(context.adminClient, schoolId);
    } catch (deleteError) {
      return bad("Failed to delete school", {
        detail: String(deleteError?.message ?? deleteError),
      });
    }

    await logAuditEvent(context.adminClient, context, {
      actionType: "delete",
      entityType: "school",
      entityId: school.id,
      schoolId: null,
      metadata: {
        name: school.name,
        deleted_user_count: summary.deletedUserCount,
        preserved_admin_count: summary.preservedAdminCount,
        start_date: school.start_date,
        end_date: school.end_date,
      },
    });

    return ok({
      ok: true,
      deleted: true,
      school: {
        id: school.id,
        name: school.name,
      },
      summary,
    });
  }

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
