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
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-school-scope",
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
  category: string | null;
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
      category: normalizeText(parsed.category),
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

function normalizeCsvCellValue(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toUpperCase() === "N/A") return "";
  return raw;
}

function hashSeed(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shuffleWithSeed<T>(items: T[], seedStr: string) {
  const out = [...items];
  let seed = hashSeed(seedStr);
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const rand = seed / 233280;
    const j = Math.floor(rand * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function splitAssetValues(value: unknown) {
  return String(value ?? "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinAssetValues(...values: unknown[]) {
  const unique: string[] = [];
  for (const value of values.flatMap((item) => splitAssetValues(item))) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.join("|");
}

function parseModelQuestionId(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  const match = value.match(/^([A-Za-z]+)-(\d+)(?:-(\d+))?$/);
  if (!match) {
    return {
      questionId: value,
      groupQid: value,
      subId: null,
      sectionPrefix: "",
      mainNumber: null,
      subNumber: null,
    };
  }
  return {
    questionId: value,
    groupQid: match[3] ? `${match[1]}-${match[2]}` : value,
    subId: match[3] ?? null,
    sectionPrefix: match[1].toUpperCase(),
    mainNumber: Number(match[2]),
    subNumber: match[3] ? Number(match[3]) : null,
  };
}

const MODEL_SUB_SECTION_TO_SECTION_KEY: Record<string, string> = {
  "word meaning": "SV",
  "word usage": "SV",
  "kanji reading": "SV",
  "kanji meaning and usage": "SV",
  grammar: "SV",
  expression: "CE",
  "comprehending content (conversation)": "CE",
  "comprehending content (communicating at shops and public places)": "CE",
  "comprehending content (listening to announcements and instructions)": "LC",
  "comprehending content": "LC",
  "information search": "RC",
};

function resolveModelSectionKey(qid: string, subSection: string) {
  const parsed = parseModelQuestionId(qid);
  if (["SV", "CE", "LC", "RC"].includes(parsed.sectionPrefix)) {
    return parsed.sectionPrefix;
  }
  return MODEL_SUB_SECTION_TO_SECTION_KEY[String(subSection ?? "").trim().toLowerCase()] || "SV";
}

const MODEL_SECTION_ORDER: Record<string, number> = {
  SV: 1,
  CE: 2,
  LC: 3,
  RC: 4,
};

function computeModelOrderIndex(qid: string, fallbackIndex: number, sectionKey = "SV") {
  const parsed = parseModelQuestionId(qid);
  const sectionOffset = (MODEL_SECTION_ORDER[String(sectionKey ?? "").trim().toUpperCase()] ?? 9) * 100000;
  if (Number.isFinite(parsed.mainNumber)) {
    return sectionOffset + parsed.mainNumber * 100 + (Number.isFinite(parsed.subNumber) ? parsed.subNumber : 0);
  }
  return sectionOffset + fallbackIndex;
}

function inferModelQuestionType(
  {
    sectionKey,
    stemKind,
    stemText,
    stemImage,
    stemAudio,
    subQuestion,
    optionType,
  }: {
    sectionKey: string;
    stemKind: string | null;
    stemText: string | null;
    stemImage: string | null;
    stemAudio: string | null;
    subQuestion: string | null;
    optionType: string | null;
  },
) {
  const normalizedStemKind = String(stemKind ?? "").trim().toLowerCase();
  const normalizedOptionType = String(optionType ?? "").trim().toLowerCase();
  const hasImageStem = Boolean(stemImage);
  const hasAudioStem = Boolean(stemAudio);
  const hasSubQuestion = Boolean(subQuestion);
  const hasImageChoices = normalizedOptionType === "image";

  if (hasAudioStem || normalizedStemKind === "audio") {
    if (hasImageChoices) return "mcq_listening_image_choices";
    if (hasSubQuestion) return "mcq_listening_two_part";
    return "mcq_audio";
  }
  if (normalizedStemKind === "dialog") {
    return hasImageStem ? "mcq_dialog_with_image" : "mcq_dialog";
  }
  if (hasImageStem || normalizedStemKind === "image" || normalizedStemKind === "passage_image" || normalizedStemKind === "table_image") {
    return hasSubQuestion ? "mcq_grouped_image" : "mcq_image";
  }
  if (sectionKey === "SV" && /【.+?】/.test(String(stemText ?? ""))) {
    return "mcq_kanji_reading";
  }
  if (hasSubQuestion) return "mcq_grouped_text";
  return "mcq_text";
}

function normalizeModelStemKind(value: string | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/+]+/g, "_");
}

function resolveModelStemAssets(
  stemKindInput: string | null,
  stemImageInput: string | null,
  stemAudioInput: string | null,
) {
  const stemImage = normalizeCsvCellValue(stemImageInput) || null;
  const stemAudio = normalizeCsvCellValue(stemAudioInput) || null;
  const normalizedStemKind = normalizeModelStemKind(stemKindInput);

  const includeImage = (() => {
    if (!normalizedStemKind) return Boolean(stemImage);
    return ["image", "audio_image", "image_audio", "dialog", "passage_image", "table_image"].includes(normalizedStemKind);
  })();
  const includeAudio = (() => {
    if (!normalizedStemKind) return Boolean(stemAudio);
    return ["audio", "audio_image", "image_audio"].includes(normalizedStemKind);
  })();

  return {
    stemKind: normalizedStemKind || (stemAudio ? "audio" : stemImage ? "image" : null),
    stemImage: includeImage ? stemImage : null,
    stemAudio: includeAudio ? stemAudio : null,
  };
}

function isModelOptionAsset(optionType: string | null) {
  return normalizeModelStemKind(optionType) === "image";
}

function inferMediaType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|ogg)$/.test(lower)) return "audio";
  return null;
}

function normalizeAssetName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase() ?? "";
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

function validateDailyQuestionSetCsv(rows: string[][], assetFiles: File[]): ValidationResult {
  const header = rows[0].map(normalizeHeader);
  const findIdx = (names: string[]) => {
    for (const name of names) {
      const idx = header.indexOf(normalizeHeader(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idxNo = findIdx(["qid", "q_id", "q id", "no", "no.", "number"]);
  const idxQuestion = findIdx(["question"]);
  const idxCorrect = findIdx(["correct_option", "correct option", "correct_answer", "correct answer", "correct"]);
  const idxWrong1 = findIdx(["wrong_option_1", "wrong option 1", "wrong1", "wrong option1"]);
  const idxWrong2 = findIdx(["wrong_option_2", "wrong option 2", "wrong2", "wrong option2"]);
  const idxWrong3 = findIdx(["wrong_option_3", "wrong option 3", "wrong3", "wrong option3"]);
  const idxIllustration = findIdx(["illustration"]);
  const idxDescription = findIdx(["description"]);

  const errors: string[] = [];
  const warnings: string[] = [];
  const assetNames = new Set(assetFiles.map((file) => normalizeAssetName(file.name)));
  const questions: ValidationResult["questions"] = [];
  let assetReferenceCount = 0;

  if (idxQuestion === -1 || idxCorrect === -1) {
    errors.push("Daily CSV must include question and correct_option columns.");
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const cell = (idx: number) => (idx === -1 ? "" : String(row[idx] ?? "").trim());
    const noValue = cell(idxNo);
    const questionText = cell(idxQuestion);
    const correct = cell(idxCorrect);
    const wrongs = [cell(idxWrong1), cell(idxWrong2), cell(idxWrong3)].filter(Boolean);
    const illustration = cell(idxIllustration) || null;
    const description = cell(idxDescription) || null;

    if (!noValue && !questionText && !correct && !illustration && !description) continue;
    if (!questionText) {
      errors.push(`Row ${rowIndex + 1}: question is required.`);
      continue;
    }
    if (!correct) {
      errors.push(`Row ${rowIndex + 1}: correct_option is required.`);
      continue;
    }

    const qid = noValue || `daily-${rowIndex}`;
    const items = [
      ...wrongs.map((text) => ({ text, correct: false })),
      { text: correct, correct: true },
    ].filter((item) => item.text);

    if (!items.length) {
      errors.push(`Row ${rowIndex + 1} (${qid}): choices are required.`);
      continue;
    }

    const shuffled = shuffleWithSeed(items, `daily-${qid}`);
    const options = shuffled.map((item) => item.text);
    const answerIndex = shuffled.findIndex((item) => item.correct);
    if (answerIndex < 0) {
      errors.push(`Row ${rowIndex + 1} (${qid}): correct answer not found in choices.`);
      continue;
    }

    const mediaType = illustration ? inferMediaType(illustration) : null;
    if (illustration) {
      assetReferenceCount += 1;
      if (!assetNames.has(normalizeAssetName(illustration))) {
        errors.push(`Row ${rowIndex + 1} (${qid}): referenced asset "${illustration}" was not uploaded.`);
      }
      if (!mediaType) {
        warnings.push(`Row ${rowIndex + 1} (${qid}): could not infer media type from "${illustration}".`);
      }
    }

    questions.push({
      qid,
      question_text: questionText,
      question_type: "daily",
      correct_answer: answerIndex,
      options,
      media_type: mediaType,
      media_file: illustration,
      order_index: Number.isFinite(Number(noValue)) ? Number(noValue) : questions.length + 1,
      metadata: description ? { description } : {},
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

function validateFlatModelQuestionSetCsv(rows: string[][], assetFiles: File[]): ValidationResult {
  const header = rows[0].map(normalizeHeader);
  const findIdx = (names: string[]) => {
    for (const name of names) {
      const idx = header.indexOf(normalizeHeader(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxQid = findIdx(["qid"]);
  const idxSubSection = findIdx(["sub_section", "sub section"]);
  const idxPromptEn = findIdx(["prompt_en", "prompt en"]);
  const idxPromptBn = findIdx(["prompt_bn", "prompt bn"]);
  const idxStemKind = findIdx(["stem_kind", "stem kind"]);
  const idxStemText = findIdx(["stem_text", "stem text"]);
  const idxStemImage = findIdx(["stem_image", "stem image"]);
  const idxStemAudio = findIdx(["stem_audio", "stem audio"]);
  const idxSubQuestion = findIdx(["sub_question", "sub question"]);
  const idxOptionType = findIdx(["option_type", "option type"]);
  const idxCorrect = findIdx(["correct_option", "correct option"]);
  const idxWrong1 = findIdx(["wrong_option_1", "wrong option 1"]);
  const idxWrong2 = findIdx(["wrong_option_2", "wrong option 2"]);
  const idxWrong3 = findIdx(["wrong_option_3", "wrong option 3"]);

  const errors: string[] = [];
  const warnings: string[] = [];
  const assetNames = new Set(assetFiles.map((file) => normalizeAssetName(file.name)));
  const seenQids = new Set<string>();
  const questions: ValidationResult["questions"] = [];
  let assetReferenceCount = 0;

  if (idxQid === -1 || idxSubSection === -1 || idxCorrect === -1) {
    const missing = [
      idxQid === -1 ? "qid" : null,
      idxSubSection === -1 ? "sub_section" : null,
      idxCorrect === -1 ? "correct_option" : null,
    ].filter(Boolean);
    errors.push(`Missing required columns: ${missing.join(", ")}`);
  }

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const cell = (idx: number) => (idx === -1 ? "" : normalizeCsvCellValue(row[idx]));

    const rawQid = cell(idxQid);
    const subSection = cell(idxSubSection);
    const promptEn = cell(idxPromptEn);
    const promptBn = cell(idxPromptBn);
    const stemKindInput = cell(idxStemKind);
    const stemText = cell(idxStemText);
    const { stemKind, stemImage, stemAudio } = resolveModelStemAssets(
      stemKindInput,
      cell(idxStemImage) || null,
      cell(idxStemAudio) || null,
    );
    const subQuestion = cell(idxSubQuestion) || null;
    const optionType = cell(idxOptionType) || null;
    const correct = cell(idxCorrect);
    const wrongs = [cell(idxWrong1), cell(idxWrong2), cell(idxWrong3)].filter(Boolean);

    if (!rawQid && !subSection && !promptEn && !promptBn && !stemText && !stemImage && !stemAudio && !subQuestion && !correct) {
      continue;
    }

    if (!rawQid) {
      errors.push(`Row ${rowIndex + 1}: qid is required.`);
      continue;
    }
    if (seenQids.has(rawQid)) {
      errors.push(`Row ${rowIndex + 1}: duplicate qid "${rawQid}".`);
      continue;
    }
    seenQids.add(rawQid);

    if (!subSection) {
      errors.push(`Row ${rowIndex + 1} (${rawQid}): sub_section is required.`);
      continue;
    }
    if (!correct) {
      errors.push(`Row ${rowIndex + 1} (${rawQid}): correct_option is required.`);
      continue;
    }

    const options = [correct, ...wrongs].filter(Boolean);
    if (!options.length) {
      errors.push(`Row ${rowIndex + 1} (${rawQid}): choices are required.`);
      continue;
    }

    const parsedId = parseModelQuestionId(rawQid);
    const sectionKey = resolveModelSectionKey(rawQid, subSection);
    const mediaFile = stemAudio || stemImage || null;
    const mediaType = stemAudio ? "audio" : stemImage ? "image" : null;
    const stemAsset = joinAssetValues(
      stemAudio,
      stemImage,
    ) || null;

    for (const asset of [stemImage, stemAudio].filter(Boolean)) {
      assetReferenceCount += 1;
      if (!assetNames.has(normalizeAssetName(asset))) {
        errors.push(`Row ${rowIndex + 1} (${rawQid}): referenced asset "${asset}" was not uploaded.`);
      }
    }
    if (isModelOptionAsset(optionType)) {
      for (const asset of options) {
        assetReferenceCount += 1;
        if (!assetNames.has(normalizeAssetName(asset))) {
          errors.push(`Row ${rowIndex + 1} (${rawQid}): referenced asset "${asset}" was not uploaded.`);
        }
      }
    }

    questions.push({
      qid: rawQid,
      question_text: promptEn || subQuestion || stemText || rawQid,
      question_type: inferModelQuestionType({
        sectionKey,
        stemKind,
        stemText: stemText || null,
        stemImage,
        stemAudio,
        subQuestion,
        optionType,
      }),
      correct_answer: correct,
      options,
      media_type: mediaType,
      media_file: mediaFile,
      order_index: computeModelOrderIndex(rawQid, rowIndex, sectionKey),
      metadata: {
        source_format: "flat_model_csv",
        section_key: sectionKey,
        section_label: subSection,
        prompt_bn: promptBn || null,
        stem_kind: stemKind,
        stem_text: stemText || null,
        stem_image: stemImage,
        stem_audio: stemAudio,
        stem_asset: stemAsset,
        box_text: subQuestion,
        option_type: optionType,
        sub_id: parsedId.subId,
        group_qid: parsedId.groupQid,
      },
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

export async function validateQuestionSetCsv(csvFile: File, assetFiles: File[], testType?: string | null): Promise<ValidationResult> {
  const text = await csvFile.text();
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return {
      valid: false,
      errors: ["CSV is empty."],
      warnings: [],
      summary: { question_count: 0, asset_reference_count: 0 },
      questions: [],
    };
  }

  if (testType === "daily") {
    return validateDailyQuestionSetCsv(rows, assetFiles);
  }

  const normalizedHeader = rows[0].map(normalizeHeader);
  const hasFlatModelColumns = (() => {
    const findIdx = (names: string[]) => {
      for (const name of names) {
        const idx = normalizedHeader.indexOf(normalizeHeader(name));
        if (idx !== -1) return idx;
      }
      return -1;
    };
    return (
      findIdx(["qid"]) !== -1
      && findIdx(["sub_section", "sub section"]) !== -1
      && findIdx(["correct_option", "correct option"]) !== -1
    );
  })();

  if (hasFlatModelColumns) {
    return validateFlatModelQuestionSetCsv(rows, assetFiles);
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const header = rows[0].map(normalizeHeader);
  const indexOf = (name: string) => header.indexOf(name);
  const required = ["qid", "question_text", "question_type", "correct_answer"];
  const missingColumns = required.filter((name) => indexOf(name) === -1);
  if (missingColumns.length) {
    errors.push(`Missing required columns: ${missingColumns.join(", ")}`);
  }

  const assetNames = new Set(assetFiles.map((file) => normalizeAssetName(file.name)));
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
      if (!assetNames.has(normalizeAssetName(mediaFile))) {
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

function buildPublicAssetUrl(objectPath: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/test-assets/${objectPath}`;
}

function normalizeLegacyOptionValue(
  value: unknown,
  uploadedAssets: Map<string, string>,
) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const normalized = normalizeAssetName(text);
  const matchedPath = normalized
    ? Array.from(uploadedAssets.entries()).find(([fileName]) => normalizeAssetName(fileName) === normalized)?.[1]
    : null;
  return matchedPath ? buildPublicAssetUrl(matchedPath) : text;
}

function resolveLegacyAnswerIndex(
  options: unknown[],
  correctAnswer: unknown,
  uploadedAssets: Map<string, string>,
) {
  if (typeof correctAnswer === "number" && Number.isFinite(correctAnswer)) {
    return Number(correctAnswer);
  }

  const correctText = normalizeLegacyOptionValue(correctAnswer, uploadedAssets);
  if (!correctText) return null;

  const exactIndex = options.findIndex((option) => String(option ?? "").trim() === correctText);
  if (exactIndex !== -1) return exactIndex;

  const normalizedIndex = options.findIndex(
    (option) => String(option ?? "").trim().toLowerCase() === correctText.toLowerCase(),
  );
  return normalizedIndex !== -1 ? normalizedIndex : null;
}

export async function syncLegacyTestCatalog(
  adminClient: ReturnType<typeof createClient>,
  {
    setId,
    testType,
    category,
    schoolId,
    questions,
    uploadedAssets,
  }: {
    setId: string;
    testType: "daily" | "model";
    category: string | null;
    schoolId: string;
    questions: ValidationResult["questions"];
    uploadedAssets: Map<string, string>;
  },
) {
  const legacyType = testType === "model" ? "mock" : "daily";
  const categoryLabel = category
    || (testType === "model" ? "Book Review" : testType === "daily" ? "Vocabulary" : setId);
  const now = new Date().toISOString();

  const { data: existingTest, error: testLookupError } = await adminClient
    .from("tests")
    .select("id, school_id")
    .eq("version", setId)
    .maybeSingle();
  if (testLookupError) throw new Error(`Legacy test lookup failed: ${testLookupError.message}`);
  const legacySchoolId = existingTest?.school_id || schoolId;
  if (!legacySchoolId) {
    throw new Error("Legacy test sync requires a school scope");
  }

  if (existingTest?.id) {
    const { error } = await adminClient
      .from("tests")
      .update({
        school_id: legacySchoolId,
        title: categoryLabel,
        type: legacyType,
        is_public: true,
        updated_at: now,
      })
      .eq("id", existingTest.id);
    if (error) throw new Error(`Legacy test update failed: ${error.message}`);
  } else {
    const { error } = await adminClient.from("tests").insert({
      school_id: legacySchoolId,
      version: setId,
      title: categoryLabel,
      type: legacyType,
      is_public: true,
      updated_at: now,
    });
    if (error) throw new Error(`Legacy test create failed: ${error.message}`);
  }

  const legacyQuestions = questions.map((question, index) => {
    const resolvedOptions = Array.isArray(question.options)
      ? question.options.map((option) => normalizeLegacyOptionValue(option, uploadedAssets)).filter(Boolean)
      : [];
    const stemImage = normalizeLegacyOptionValue(question.metadata?.stem_image, uploadedAssets);
    const stemAudio = normalizeLegacyOptionValue(question.metadata?.stem_audio, uploadedAssets);
    const mediaUrl = question.media_file
      ? normalizeLegacyOptionValue(question.media_file, uploadedAssets)
      : null;
    const stemKind = String(question.metadata?.stem_kind ?? "").trim()
      || (stemAudio ? "audio" : stemImage ? "image" : question.media_type ?? "");
    const normalizedStemKind = normalizeModelStemKind(stemKind);
    const mediaType = mediaUrl ? inferMediaType(mediaUrl) : null;
    const resolvedStemAudio = stemAudio || (
      mediaType === "audio"
      && ["audio", "audio_image", "image_audio"].includes(normalizedStemKind)
        ? mediaUrl
        : null
    );
    const resolvedStemImage = stemImage || (
      mediaType === "image"
      && ["image", "audio_image", "image_audio", "dialog", "passage_image", "table_image"].includes(normalizedStemKind)
        ? mediaUrl
        : null
    );
    const stemAsset = joinAssetValues(
      resolvedStemAudio,
      resolvedStemImage,
    ) || null;
    const promptEn = String(question.question_text ?? "").trim() || null;
    const promptBn = String(question.metadata?.prompt_bn ?? "").trim() || null;
    const stemText = String(question.metadata?.stem_text ?? "").trim()
      || (testType === "daily" ? "" : (!question.metadata?.source_format ? String(question.question_text ?? "").trim() : ""));
    const answerIndex = resolveLegacyAnswerIndex(resolvedOptions, question.correct_answer, uploadedAssets);
    if (answerIndex == null) {
      throw new Error(`Legacy answer mapping failed for question "${question.qid}"`);
    }

    return {
      school_id: legacySchoolId,
      test_version: setId,
      question_id: question.qid,
      section_key: testType === "daily"
        ? "DAILY"
        : String(question.metadata?.section_key ?? question.metadata?.section ?? "SUPER").trim() || "SUPER",
      type: testType === "daily" ? "daily" : String(question.question_type ?? "super_question"),
      prompt_en: promptEn,
      prompt_bn: promptBn,
      answer_index: answerIndex,
      order_index: Number.isFinite(Number(question.order_index)) ? Number(question.order_index) : index + 1,
      data: {
        qid: String(question.metadata?.group_qid ?? question.qid).trim() || question.qid,
        subId: String(question.metadata?.sub_id ?? "").trim() || null,
        itemId: question.qid,
        stemKind: stemKind || null,
        stemText: stemText || null,
        stemImage: resolvedStemImage || null,
        stemAudio: resolvedStemAudio || null,
        stemAsset: stemAsset || null,
        stemExtra: String(question.metadata?.description ?? "").trim() || null,
        boxText: String(question.metadata?.box_text ?? "").trim() || null,
        choices: resolvedOptions,
        target: String(question.metadata?.target ?? "").trim() || null,
        canDo: String(question.metadata?.canDo ?? question.metadata?.can_do ?? "").trim() || null,
        sectionLabel: String(question.metadata?.section_label ?? "").trim() || null,
        optionType: String(question.metadata?.option_type ?? "").trim() || null,
      },
    };
  });

  const keepIds = legacyQuestions.map((question) => question.question_id);
  if (keepIds.length) {
    const notIn = `(${keepIds.map((questionId) => `"${String(questionId).replaceAll("\"", "\\\"")}"`).join(",")})`;
    const { error } = await adminClient
      .from("questions")
      .delete()
      .eq("test_version", setId)
      .not("question_id", "in", notIn);
    if (error) throw new Error(`Legacy question cleanup failed: ${error.message}`);
  } else {
    const { error } = await adminClient.from("questions").delete().eq("test_version", setId);
    if (error) throw new Error(`Legacy question cleanup failed: ${error.message}`);
  }

  if (legacyQuestions.length) {
    const { error } = await adminClient.from("questions").upsert(legacyQuestions, {
      onConflict: "test_version,question_id",
    });
    if (error) throw new Error(`Legacy question upsert failed: ${error.message}`);
  }

  const { data: questionRows, error: questionFetchError } = await adminClient
    .from("questions")
    .select("id, question_id")
    .eq("test_version", setId)
    .in("question_id", keepIds);
  if (questionFetchError) throw new Error(`Legacy question fetch failed: ${questionFetchError.message}`);

  const questionIdMap = new Map<string, string>();
  (questionRows ?? []).forEach((row) => {
    if (row?.question_id && row?.id) questionIdMap.set(row.question_id, row.id);
  });

  const questionUuidList = Array.from(questionIdMap.values());
  if (questionUuidList.length) {
    const { error } = await adminClient.from("choices").delete().in("question_id", questionUuidList);
    if (error) throw new Error(`Legacy choice cleanup failed: ${error.message}`);
  }

  const choiceRows = legacyQuestions.flatMap((question) => {
    const questionUuid = questionIdMap.get(question.question_id);
    const choiceValues = Array.isArray(question.data?.choices) ? question.data.choices : [];
    const useImageChoices = isModelOptionAsset(String(question.data?.optionType ?? question.data?.option_type ?? "").trim() || null);
    if (!questionUuid) return [];
    return choiceValues.map((value, choiceIndex) => {
      const textValue = String(value ?? "").trim();
      const isImage = useImageChoices || /\.(png|jpe?g|webp|gif|svg)$/i.test(textValue) || textValue.includes("/storage/v1/object/public/");
      return {
        question_id: questionUuid,
        part_index: null,
        choice_index: choiceIndex,
        label: isImage ? null : textValue,
        choice_image: isImage ? textValue : null,
      };
    });
  });

  if (choiceRows.length) {
    const { error } = await adminClient.from("choices").insert(choiceRows);
    if (error) throw new Error(`Legacy choice insert failed: ${error.message}`);
  }
}
