import { createClient } from "https://esm.sh/@supabase/supabase-js@2.94.1";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      ...(init.headers ?? {}),
    },
  });
}

export function ok(body: unknown) {
  return json(body, { status: 200 });
}

export function bad(message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return json({ error: message }, { status: 401 });
}

export function serverError(message = "Internal Server Error", extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, { status: 500 });
}

export function normalizeText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

export type CallerContext = {
  adminClient: ReturnType<typeof createClient>;
  callerUserId: string;
  callerProfile: {
    id: string;
    role: string | null;
    account_status?: string | null;
    display_name?: string | null;
    email?: string | null;
    school_id?: string | null;
  };
};

export async function requireSuperAdmin(req: Request): Promise<CallerContext | Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return serverError("Missing env vars (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)");
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) return unauthorized("Missing Authorization header");

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: callerUserData, error: callerUserError } = await callerClient.auth.getUser();
  if (callerUserError || !callerUserData?.user) return unauthorized("Invalid session");

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const { data: callerProfile, error: profileError } = await adminClient
    .from("profiles")
    .select("id, role, account_status, display_name, email, school_id")
    .eq("id", callerUserData.user.id)
    .single();

  if (profileError || !callerProfile) return unauthorized("Profile not found");
  if (callerProfile.role !== "super_admin" || callerProfile.account_status !== "active") {
    return unauthorized("Active super admin only");
  }

  return {
    adminClient,
    callerUserId: callerUserData.user.id,
    callerProfile,
  };
}

export async function logAuditEvent(
  adminClient: ReturnType<typeof createClient>,
  context: CallerContext,
  {
    actionType,
    entityType,
    entityId,
    schoolId = null,
    metadata = {},
  }: {
    actionType: string;
    entityType: string;
    entityId: string;
    schoolId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await adminClient.from("audit_logs").insert({
    actor_user_id: context.callerUserId,
    actor_role: context.callerProfile.role,
    actor_email: context.callerProfile.email ?? null,
    action_type: actionType,
    entity_type: entityType,
    entity_id: entityId,
    school_id: schoolId,
    metadata,
  });

  if (error) {
    console.error("audit log insert failed:", error.message);
  }
}

export type UploadMetadata = {
  title: string;
  description: string | null;
  test_type: "daily" | "model";
  version_label: string;
  status: "draft" | "published" | "archived";
  visibility_scope: "global" | "restricted";
  school_ids: string[];
  source_question_set_id: string | null;
};

export async function parseUploadForm(req: Request): Promise<{ metadata: UploadMetadata; csvFile: File; assetFiles: File[] } | Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Invalid multipart form data");
  }

  const metadataRaw = form.get("metadata");
  const csvFile = form.get("csv");
  const assetFiles = form.getAll("assets").filter((item) => item instanceof File) as File[];

  if (!(csvFile instanceof File) || !csvFile.name) {
    return bad("csv file is required");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(metadataRaw ?? "{}"));
  } catch {
    return bad("metadata must be valid JSON");
  }

  const testType = normalizeText(parsed.test_type);
  const visibilityScope = normalizeText(parsed.visibility_scope);
  const status = normalizeText(parsed.status) ?? "draft";
  const schoolIds = Array.isArray(parsed.school_ids)
    ? parsed.school_ids.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  if (!["daily", "model"].includes(testType ?? "")) {
    return bad("test_type must be daily or model");
  }
  if (!["global", "restricted"].includes(visibilityScope ?? "")) {
    return bad("visibility_scope must be global or restricted");
  }
  if (!["draft", "published", "archived"].includes(status)) {
    return bad("status must be draft, published, or archived");
  }
  if (visibilityScope === "restricted" && schoolIds.length === 0) {
    return bad("Restricted visibility requires at least one school");
  }

  const title = normalizeText(parsed.title);
  const versionLabel = normalizeText(parsed.version_label);
  if (!title) return bad("title is required");
  if (!versionLabel) return bad("version_label is required");

  return {
    metadata: {
      title,
      description: normalizeText(parsed.description),
      test_type: testType as "daily" | "model",
      version_label: versionLabel,
      status: status as "draft" | "published" | "archived",
      visibility_scope: visibilityScope as "global" | "restricted",
      school_ids: schoolIds,
      source_question_set_id: normalizeText(parsed.source_question_set_id),
    },
    csvFile,
    assetFiles,
  };
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      current += char;
      if (inQuotes && next === '"') {
        current += next;
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      if (current.trim().length > 0) {
        rows.push(splitCsvLine(current).map((value) => value.trim().replace(/^\uFEFF/, "")));
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    rows.push(splitCsvLine(current).map((value) => value.trim().replace(/^\uFEFF/, "")));
  }

  return rows;
}

function normalizeHeader(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/^\uFEFF/, "");
}

function inferMediaType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|ogg)$/.test(lower)) return "audio";
  return null;
}

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    question_count: number;
    asset_reference_count: number;
  };
  questions: Array<{
    qid: string;
    question_text: string;
    question_type: string;
    correct_answer: unknown;
    options: unknown[];
    media_type: "image" | "audio" | null;
    media_file: string | null;
    order_index: number;
    metadata: Record<string, unknown>;
  }>;
};

export async function validateQuestionSetCsv(csvFile: File, assetFiles: File[]): Promise<ValidationResult> {
  const text = await csvFile.text();
  const rows = parseCsvRows(text);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    return {
      valid: false,
      errors: ["CSV is empty."],
      warnings,
      summary: { question_count: 0, asset_reference_count: 0 },
      questions: [],
    };
  }

  const header = rows[0].map(normalizeHeader);
  const indexOf = (name: string) => header.indexOf(name);
  const required = ["qid", "question_text", "question_type", "correct_answer"];
  const missingColumns = required.filter((name) => indexOf(name) === -1);
  if (missingColumns.length) {
    errors.push(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const assetNames = new Set(assetFiles.map((file) => file.name));
  const seenQids = new Set<string>();
  const questions: ValidationResult["questions"] = [];
  let assetReferenceCount = 0;

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const cell = (name: string) => {
      const idx = indexOf(name);
      return idx === -1 ? "" : String(row[idx] ?? "").trim();
    };

    const qid = cell("qid");
    const questionText = cell("question_text");
    const questionType = cell("question_type");
    const correctAnswerRaw = cell("correct_answer");
    const optionsRaw = cell("options");
    const mediaFile = cell("media_file") || null;
    const mediaTypeRaw = cell("media_type") || null;
    const orderIndexRaw = cell("order_index");
    const metadataRaw = cell("metadata");

    if (!qid && !questionText && !questionType && !correctAnswerRaw) continue;

    if (!qid) {
      errors.push(`Row ${rowIndex + 1}: qid is required.`);
      continue;
    }
    if (seenQids.has(qid)) {
      errors.push(`Row ${rowIndex + 1}: duplicate qid "${qid}".`);
      continue;
    }
    seenQids.add(qid);

    if (!questionText) errors.push(`Row ${rowIndex + 1} (${qid}): question_text is required.`);
    if (!questionType) errors.push(`Row ${rowIndex + 1} (${qid}): question_type is required.`);
    if (!correctAnswerRaw) errors.push(`Row ${rowIndex + 1} (${qid}): correct_answer is required.`);

    let options: unknown[] = [];
    if (optionsRaw) {
      try {
        if (optionsRaw.trim().startsWith("[")) {
          const parsed = JSON.parse(optionsRaw);
          if (!Array.isArray(parsed)) {
            errors.push(`Row ${rowIndex + 1} (${qid}): options JSON must be an array.`);
          } else {
            options = parsed;
          }
        } else {
          options = optionsRaw.split("|").map((value) => value.trim()).filter(Boolean);
        }
      } catch {
        errors.push(`Row ${rowIndex + 1} (${qid}): options must be valid JSON or pipe-separated text.`);
      }
    }

    let correctAnswer: unknown = correctAnswerRaw;
    try {
      if (correctAnswerRaw.startsWith("{") || correctAnswerRaw.startsWith("[")) {
        correctAnswer = JSON.parse(correctAnswerRaw);
      }
    } catch {
      warnings.push(`Row ${rowIndex + 1} (${qid}): correct_answer kept as plain text because JSON parsing failed.`);
    }

    let metadata: Record<string, unknown> = {};
    if (metadataRaw) {
      try {
        const parsedMetadata = JSON.parse(metadataRaw);
        if (!parsedMetadata || Array.isArray(parsedMetadata) || typeof parsedMetadata !== "object") {
          errors.push(`Row ${rowIndex + 1} (${qid}): metadata must be a JSON object.`);
        } else {
          metadata = parsedMetadata as Record<string, unknown>;
        }
      } catch {
        errors.push(`Row ${rowIndex + 1} (${qid}): metadata must be valid JSON.`);
      }
    }

    const inferredMediaType = mediaFile ? inferMediaType(mediaFile) : null;
    const mediaType = (mediaTypeRaw || inferredMediaType) as "image" | "audio" | null;
    if (mediaTypeRaw && !["image", "audio"].includes(mediaTypeRaw)) {
      errors.push(`Row ${rowIndex + 1} (${qid}): media_type must be image or audio.`);
    }

    if (mediaFile) {
      assetReferenceCount += 1;
      if (!assetNames.has(mediaFile)) {
        errors.push(`Row ${rowIndex + 1} (${qid}): referenced asset "${mediaFile}" was not uploaded.`);
      }
      if (!mediaType) {
        warnings.push(`Row ${rowIndex + 1} (${qid}): could not infer media_type from "${mediaFile}".`);
      }
    }

    const orderIndex = Number(orderIndexRaw);
    questions.push({
      qid,
      question_text: questionText,
      question_type: questionType,
      correct_answer: correctAnswer,
      options,
      media_type: mediaType,
      media_file: mediaFile,
      order_index: Number.isFinite(orderIndex) ? orderIndex : questions.length + 1,
      metadata,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      question_count: questions.length,
      asset_reference_count: assetReferenceCount,
    },
    questions,
  };
}

export async function ensureVisibleSchools(adminClient: ReturnType<typeof createClient>, schoolIds: string[]) {
  if (schoolIds.length === 0) return { ok: true, schools: [] as Array<{ id: string; name: string }> };
  const { data, error } = await adminClient
    .from("schools")
    .select("id, name")
    .in("id", schoolIds);
  if (error) {
    return { ok: false, error: error.message };
  }
  if ((data ?? []).length !== schoolIds.length) {
    return { ok: false, error: "One or more selected schools do not exist." };
  }
  return { ok: true, schools: data ?? [] };
}

export async function uploadAssets(
  adminClient: ReturnType<typeof createClient>,
  libraryKey: string,
  versionLabel: string,
  assetFiles: File[],
) {
  const uploaded = new Map<string, string>();

  for (const file of assetFiles) {
    const objectPath = `question-sets/${libraryKey}/${versionLabel}/${file.name}`;
    const { error } = await adminClient.storage.from("test-assets").upload(objectPath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || undefined,
    });
    if (error) {
      throw new Error(`Failed to upload asset "${file.name}": ${error.message}`);
    }
    uploaded.set(file.name, objectPath);
  }

  return uploaded;
}

export async function replaceVisibility(
  adminClient: ReturnType<typeof createClient>,
  questionSetId: string,
  schoolIds: string[],
) {
  const { error: deleteError } = await adminClient
    .from("question_set_school_access")
    .delete()
    .eq("question_set_id", questionSetId);
  if (deleteError) throw new Error(deleteError.message);

  if (schoolIds.length === 0) return;

  const rows = schoolIds.map((schoolId) => ({
    question_set_id: questionSetId,
    school_id: schoolId,
  }));
  const { error: insertError } = await adminClient
    .from("question_set_school_access")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);
}
