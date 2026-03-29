/**
 * AdminConsoleTestingWorkspaceState.jsx
 * Custom hook for testing workspace state management in AdminConsole
 *
 * Extracted from AdminConsoleCore.jsx and organized for maintainability
 * Contains all useState, useRef, useMemo, useCallback, and useEffect hooks
 * for the testing (model + daily) functionality
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questions, sections } from "../../../../packages/shared/questions.js";
import { recordAdminAuditEvent } from "../lib/adminAudit";

// ============================================================================
// IMPORTS & CONSTANTS
// ============================================================================

const DEFAULT_MODEL_CATEGORY = "Book Review";
const CUSTOM_CATEGORY_OPTION = "__custom__";
const ADMIN_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizePassRate(value, fallback = 0.8) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : fallback;
}

function isImportedResultsSummaryAttempt(attempt) {
  const source = String(attempt?.answers_json?.__meta?.imported_source ?? "");
  return Boolean(attempt?.answers_json?.__meta?.imported_summary)
    && (source === "daily_results_csv" || source === "model_results_csv");
}

function isGeneratedDailySessionVersion(version) {
  return String(version ?? "").startsWith("daily_session_");
}

// Alias for readability in daily tests filtering
const isDaily = isGeneratedDailySessionVersion;

function mapQuestion(row) {
  // Transform database question row to UI format
  const data = row.data ?? {};
  const stemAsset = joinAssetValues(
    row.media_file,
    data.stemAsset,
    data.stem_asset,
    data.stemAudio,
    data.stem_audio,
    data.stemImage,
    data.stem_image
  ) || null;
  return {
    dbId: row.id ?? null,
    id: row.question_id,
    questionId: row.question_id,
    testVersion: row.test_version ?? "",
    sectionKey: row.section_key,
    sectionLabel: data.sectionLabel ?? data.section_label ?? null,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    orderIndex: row.order_index ?? 0,
    rawData: data,
    sourceVersion: data.sourceVersion ?? null,
    sourceQuestionId: data.sourceQuestionId ?? null,
    ...data,
    stemKind: normalizeModelCsvKind(data.stemKind ?? data.stem_kind ?? row.media_type ?? null) || null,
    stemAsset,
  };
}

function isMissingTabLeftCountError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /tab_left_count/i.test(text) && /does not exist/i.test(text);
}

function isMissingSessionAttemptOverrideTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /test_session_attempt_overrides/i.test(text) && /does not exist/i.test(text);
}

function getAssetTypeByExt(filename) {
  const ext = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  return "file";
}

function sanitizeStoragePathSegment(value, fallback = "file") {
  const normalized = String(value ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  const sanitized = normalized
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || fallback;
}

function buildStorageObjectPath(testType, testVersion, assetType, relativePath) {
  const baseSegments = [
    sanitizeStoragePathSegment(testType, "test"),
    sanitizeStoragePathSegment(testVersion, "set"),
    sanitizeStoragePathSegment(assetType, "file"),
  ];
  const relativeSegments = String(relativePath ?? "")
    .split("/")
    .map((segment) => sanitizeStoragePathSegment(segment))
    .filter(Boolean);
  return [...baseSegments, ...(relativeSegments.length ? relativeSegments : ["file"])].join("/");
}

function splitAssetValues(value) {
  return String(value ?? "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinAssetValues(...values) {
  const unique = [];
  for (const value of values.flatMap((item) => splitAssetValues(item))) {
    if (!unique.includes(value)) unique.push(value);
  }
  return unique.join("|");
}

function resolveAssetValue(value, assetMap) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.includes("/")) return raw;
  return assetMap[raw] ?? raw;
}

function groupParsedCsvByVersion(questions, choices) {
  const groups = new Map();
  for (const question of questions) {
    const version = String(question?.test_version ?? "").trim();
    if (!version) continue;
    if (!groups.has(version)) groups.set(version, { questions: [], choices: [] });
    groups.get(version).questions.push(question);
  }
  for (const choice of choices) {
    const version = String(choice?.test_version ?? "").trim();
    if (!version) continue;
    if (!groups.has(version)) groups.set(version, { questions: [], choices: [] });
    groups.get(version).choices.push(choice);
  }
  return groups;
}

function applyAssetMap(questions, choices, assetMap) {
  for (const q of questions) {
    const data = q.data ?? {};
    if (data.stemAsset) {
      data.stemAsset = splitAssetValues(data.stemAsset)
        .map((value) => resolveAssetValue(value, assetMap))
        .join("|");
    }
    if (Array.isArray(data.choices)) {
      data.choices = data.choices.map((v) => {
        const raw = String(v ?? "").trim();
        if (!raw) return v;
        if (!/\.(png|jpe?g|webp|mp3|wav|m4a|ogg)$/i.test(raw)) return v;
        return resolveAssetValue(raw, assetMap);
      });
    }
    q.data = data;
  }
  for (const c of choices) {
    c.choice_image = resolveAssetValue(c.choice_image, assetMap);
  }
}

function validateAssetRefs(questions, choices, assetMap) {
  const missing = new Set();
  const invalid = new Set();
  const checkValue = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    if (!/\.(png|jpe?g|webp|mp3|wav|m4a|ogg)$/i.test(raw)) return;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return;
    if (raw.startsWith("/")) {
      invalid.add(raw);
      return;
    }
    if (raw.includes("/")) return;
    if (!assetMap[raw]) missing.add(raw);
  };
  for (const q of questions) {
    const data = q.data ?? {};
    splitAssetValues(data.stemAsset).forEach(checkValue);
    if (Array.isArray(data.choices)) data.choices.forEach(checkValue);
  }
  for (const c of choices) checkValue(c.choice_image);
  return { missing: Array.from(missing), invalid: Array.from(invalid) };
}

function buildLocalAssetNameMap(files, isCsvLike) {
  const assetMap = {};
  for (const file of Array.isArray(files) ? files : []) {
    const name = String(file?.name ?? "").trim();
    if (!name) continue;
    if (typeof isCsvLike === "function" && isCsvLike(name)) continue;
    assetMap[name] = name;
  }
  return assetMap;
}

function resolveAdminAssetUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const baseUrl = ADMIN_SUPABASE_URL;
  if (!baseUrl) return raw;
  const encodedPath = raw
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/test-assets/${encodedPath}`;
}

function normalizeModelCsvKind(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/+]+/g, "_");
}

function normalizeLookupValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getProblemSetTitle(problemSetId, testsList) {
  const item = (testsList ?? []).find((t) => t.version === problemSetId);
  return item?.title || problemSetId || "";
}

function isRetakeSessionTitle(title) {
  return String(title ?? "").trim().startsWith("[Retake]");
}

function isPastSession(session) {
  if (!session) return false;
  const now = Date.now();
  const endTime = session.ends_at ? new Date(session.ends_at).getTime() : NaN;
  const startTime = session.starts_at ? new Date(session.starts_at).getTime() : NaN;
  const createdTime = session.created_at ? new Date(session.created_at).getTime() : NaN;
  if (Number.isFinite(endTime)) return endTime <= now;
  if (Number.isFinite(startTime)) return startTime <= now;
  if (Number.isFinite(createdTime)) return createdTime <= now;
  return false;
}

function buildRetakeTitle(title) {
  const baseTitle = String(title ?? "").trim();
  if (!baseTitle) return "[Retake]";
  return isRetakeSessionTitle(baseTitle) ? baseTitle : `[Retake] ${baseTitle}`;
}

function getTwelveHourTimeParts(value) {
  const match = String(value ?? "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return {
      hour: "",
      minute: "00",
      period: "AM",
    };
  }
  const hours = Number(match[1]);
  const period = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return {
    hour: String(hour12).padStart(2, "0"),
    minute: match[2],
    period,
  };
}

function buildTwentyFourHourTime(parts) {
  const hourText = String(parts?.hour ?? "").trim();
  if (!hourText) return "";
  const minuteText = String(parts?.minute ?? "00").padStart(2, "0");
  const period = parts?.period === "PM" ? "PM" : "AM";
  const hourNumber = Number(hourText);
  if (!Number.isFinite(hourNumber)) return "";
  let normalizedHour = hourNumber % 12;
  if (period === "PM") normalizedHour += 12;
  return `${String(normalizedHour).padStart(2, "0")}:${minuteText}`;
}

function combineBangladeshDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return "";
  return `${dateValue}T${timeValue}`;
}

function formatDateTimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours() + 6).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getBangladeshDateInput(value) {
  if (!value) return "";
  const input = formatDateTimeInput(value);
  return input ? input.slice(0, 10) : "";
}

function fromBangladeshInput(value) {
  if (!value) return null;
  const parts = value.split("T");
  if (parts.length !== 2) return null;
  const [year, month, day] = parts[0].split("-").map((v) => Number(v));
  const [hour, minute] = parts[1].split(":").map((v) => Number(v));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 6, minute));
  return utc.toISOString();
}

function buildSourceQuestionKey(sourceVersion, sourceQuestionId) {
  return `${String(sourceVersion ?? "").trim()}::${String(sourceQuestionId ?? "").trim()}`;
}

function getRowTimestamp(attempt) {
  if (!attempt) return 0;
  const createdTime = attempt.created_at ? new Date(attempt.created_at).getTime() : NaN;
  return Number.isFinite(createdTime) ? createdTime : 0;
}

function mapDbQuestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    testVersion: row.test_version,
    questionId: row.question_id,
    sectionKey: row.section_key,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    orderIndex: row.order_index,
    data: row.data ?? {},
    mediaFile: row.media_file,
    mediaType: row.media_type,
    sourceVersion: row.data?.sourceVersion || null,
    sourceQuestionId: row.data?.sourceQuestionId || null,
  };
}

// ============================================================================
// MAIN HOOK
// ============================================================================

export function useTestingWorkspaceState({
  supabase,
  activeSchoolId,
  session,
  students = [],
  activeTab,
  modelSubTab,
  dailySubTab,
  fetchQuestionsForVersionWithFallback,
  fetchQuestionsForVersionsWithFallback,
  parseQuestionCsv: externalParseQuestionCsv,
  parseDailyCsv: externalParseDailyCsv,
  recordAuditEvent: externalRecordAuditEvent = recordAdminAuditEvent,
  // Optional parameters with sensible defaults
  getAccessToken: externalGetAccessToken = async () => "",
  externalTests = [],
  externalTestSessions = [],
  externalAttempts = [],
  setExternalAttempts = () => {},
  externalRunSearch = async () => {},
  externalExportDailyGoogleSheetsCsv = async () => {},
  externalExportModelGoogleSheetsCsv = async () => {},
  externalFetchStudents = async () => {},
  externalIsAnalyticsExcludedStudent = () => false,
  externalGetScoreRate = () => 0.8,
  externalGetTabLeftCount = () => 0,
  externalFormatDateTime = (iso) => iso,
  externalFormatDateShort = (iso) => iso?.slice(0, 10),
  externalGetStudentBaseUrl = () => "",
  externalCopyLink = () => {},
  externalFormatRatePercent = (rate) => `${(rate * 100).toFixed(1)}%`,
} = {}) {
  // Derived functions with fallbacks
  const getAuditEvent = externalRecordAuditEvent || recordAdminAuditEvent;
  const recordAuditEvent = getAuditEvent; // Alias for consistency
  const getAccessToken = externalGetAccessToken;
  const parseQuestionCsv = externalParseQuestionCsv || ((text, version) => ({ questions: [], choices: [], errors: ["parseQuestionCsv not provided"] }));
  const parseDailyCsv = externalParseDailyCsv || ((text, version) => ({ questions: [], choices: [], errors: ["parseDailyCsv not provided"] }));
  const runSearch = externalRunSearch;
  const exportDailyGoogleSheetsCsv = externalExportDailyGoogleSheetsCsv;
  const exportModelGoogleSheetsCsv = externalExportModelGoogleSheetsCsv;
  const fetchStudents = externalFetchStudents;
  const isAnalyticsExcludedStudent = externalIsAnalyticsExcludedStudent;
  const getScoreRate = externalGetScoreRate;
  const getTabLeftCount = externalGetTabLeftCount;
  const formatDateTime = externalFormatDateTime;
  const formatDateShort = externalFormatDateShort;
  const getStudentBaseUrl = externalGetStudentBaseUrl;
  const copyLink = externalCopyLink;
  const formatRatePercent = externalFormatRatePercent;
  const getSectionTitle = (sectionKey) => {
    const section = sections.find((s) => s.key === sectionKey);
    return section?.title ?? sectionKey ?? "";
  };

  // ========================================================================
  // useState declarations (55+ variables)
  // ========================================================================

  const [tests, setTests] = useState(externalTests ?? []);
  const [testsMsg, setTestsMsg] = useState("");
  const [testSessions, setTestSessions] = useState(externalTestSessions ?? []);
  const [testSessionsMsg, setTestSessionsMsg] = useState("");
  const [linkMsg, setLinkMsg] = useState("");

  // Model test session modal
  const [modelConductOpen, setModelConductOpen] = useState(false);
  const [modelUploadOpen, setModelUploadOpen] = useState(false);
  const [modelConductMode, setModelConductMode] = useState("normal");
  const [modelRetakeSourceId, setModelRetakeSourceId] = useState("");
  const [activeModelTimePicker, setActiveModelTimePicker] = useState("");

  // Daily test session modal
  const [dailyConductOpen, setDailyConductOpen] = useState(false);
  const [dailyUploadOpen, setDailyUploadOpen] = useState(false);
  const [dailyConductMode, setDailyConductMode] = useState("normal");
  const [dailyRetakeCategory, setDailyRetakeCategory] = useState("");
  const [dailyRetakeSourceId, setDailyRetakeSourceId] = useState("");
  const [dailySourceCategoryDropdownOpen, setDailySourceCategoryDropdownOpen] = useState(false);
  const [dailySetDropdownOpen, setDailySetDropdownOpen] = useState(false);
  const [activeDailyTimePicker, setActiveDailyTimePicker] = useState("");

  // Session editing
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSessionMsg, setEditingSessionMsg] = useState("");
  const [editingSessionForm, setEditingSessionForm] = useState({
    id: "",
    problem_set_id: "",
    title: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: true,
    pass_rate: ""
  });

  // Model test session form
  const [testSessionForm, setTestSessionForm] = useState({
    problem_set_id: "",
    title: "",
    session_date: "",
    start_time: "",
    close_time: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: false,
    pass_rate: "0.8",
    retake_release_scope: "all"
  });

  // Daily test session form
  const [dailySessionForm, setDailySessionForm] = useState({
    selection_mode: "single",
    problem_set_id: "",
    problem_set_ids: [],
    source_categories: [],
    session_category: "",
    title: "",
    session_date: "",
    start_time: "",
    close_time: "",
    question_count_mode: "all",
    question_count: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: false,
    pass_rate: "0.8",
    retake_release_scope: "all"
  });

  const [dailySessionsMsg, setDailySessionsMsg] = useState("");

  // Assets
  const [assets, setAssets] = useState([]);
  const [assetsMsg, setAssetsMsg] = useState("");
  const [quizMsg, setQuizMsg] = useState("");
  const [assetForm, setAssetForm] = useState({ category: DEFAULT_MODEL_CATEGORY });
  const [assetCategorySelect, setAssetCategorySelect] = useState(DEFAULT_MODEL_CATEGORY);
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");

  // Daily assets
  const [dailyForm, setDailyForm] = useState({ category: "" });
  const [dailyFile, setDailyFile] = useState(null);
  const [dailyFiles, setDailyFiles] = useState([]);
  const [dailyCsvFile, setDailyCsvFile] = useState(null);
  const [dailyUploadMsg, setDailyUploadMsg] = useState("");
  const [dailyImportMsg, setDailyImportMsg] = useState("");

  // Preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTest, setPreviewTest] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [previewMsg, setPreviewMsg] = useState("");
  const [previewSession, setPreviewSession] = useState(null);
  const [previewReplacementPool, setPreviewReplacementPool] = useState([]);
  const [previewReplacementDrafts, setPreviewReplacementDrafts] = useState({});
  const [previewReplacementSavingId, setPreviewReplacementSavingId] = useState("");
  const [previewReplacementMsg, setPreviewReplacementMsg] = useState("");

  // Attempt details
  const [attemptQuestionsByVersion, setAttemptQuestionsByVersion] = useState({});
  const [attemptQuestionsLoading, setAttemptQuestionsLoading] = useState(false);
  const [attemptQuestionsError, setAttemptQuestionsError] = useState("");

  // Session details
  const [sessionDetail, setSessionDetail] = useState({ type: "", sessionId: "" });
  const [sessionDetailTab, setSessionDetailTab] = useState("questions");
  const [sessionDetailQuestions, setSessionDetailQuestions] = useState([]);
  const [sessionDetailAttempts, setSessionDetailAttempts] = useState([]);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailMsg, setSessionDetailMsg] = useState("");
  const [sessionDetailAllowStudentId, setSessionDetailAllowStudentId] = useState("");
  const [sessionDetailAllowMsg, setSessionDetailAllowMsg] = useState("");
  const [sessionDetailAllowances, setSessionDetailAllowances] = useState({});
  const [sessionDetailShowAllAnalysis, setSessionDetailShowAllAnalysis] = useState(false);
  const [sessionDetailAnalysisPopup, setSessionDetailAnalysisPopup] = useState({
    open: false,
    title: "",
    questions: [],
  });

  // Upload categories
  const [dailyConductCategory, setDailyConductCategory] = useState("");
  const [modelConductCategory, setModelConductCategory] = useState("");
  const [modelUploadCategory, setModelUploadCategory] = useState("");
  const [dailyUploadCategory, setDailyUploadCategory] = useState("");
  const [dailyResultsCategory, setDailyResultsCategory] = useState("");
  const [modelResultsCategory, setModelResultsCategory] = useState("");

  // ========================================================================
  // useRef declarations (9 refs)
  // ========================================================================

  const dailySourceCategoryDropdownRef = useRef(null);
  const dailySetDropdownRef = useRef(null);
  const assetFolderInputRef = useRef(null);
  const dailyFolderInputRef = useRef(null);
  const resultsImportInputRef = useRef(null);
  const modelCategorySeededRef = useRef(false);
  const previewSectionRefs = useRef({});

  // ========================================================================
  // useMemo declarations (25+ memos)
  // ========================================================================

  const buildCategories = (list, fallbackLabel = "Uncategorized") => {
    const map = new Map();
    (list ?? []).forEach((t) => {
      const name = String(t.title ?? "").trim() || fallbackLabel;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(t);
    });
    const categories = Array.from(map.entries()).map(([name, items]) => {
      const ordered = [...items].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
      return { name, tests: ordered };
    });
    categories.sort((a, b) => a.name.localeCompare(b.name));
    return categories;
  };

  const modelTests = useMemo(() => tests.filter((t) => t.type === "mock"), [tests]);
  const dailyTests = useMemo(() => tests.filter((t) => t.type === "daily"), [tests]);
  const dailyQuestionSets = useMemo(
    () => dailyTests.filter((t) => !isDaily(t.version)),
    [dailyTests, isDaily]
  );

  const modelSessions = useMemo(
    () => testSessions.filter((s) => modelTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, modelTests]
  );

  const dailySessions = useMemo(
    () => testSessions.filter((s) => dailyTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, dailyTests]
  );

  const selectedSessionDetail = useMemo(() => {
    if (!sessionDetail?.sessionId) return null;
    return testSessions.find((session) => session.id === sessionDetail.sessionId) ?? null;
  }, [sessionDetail, testSessions]);

  const pastModelSessions = useMemo(
    () => modelSessions.filter((session) => !isRetakeSessionTitle(session.title) && isPastSession(session)),
    [modelSessions]
  );

  const dailyRetakeSessions = useMemo(() => {
    const nonRetakeSessions = dailySessions.filter((session) => !isRetakeSessionTitle(session.title));
    const pastSessions = nonRetakeSessions.filter((session) => isPastSession(session));
    const sourceSessions = pastSessions.length ? pastSessions : nonRetakeSessions;
    return sourceSessions.slice().sort((left, right) => {
      const leftTime = new Date(left.ends_at || left.starts_at || left.created_at || 0).getTime();
      const rightTime = new Date(right.ends_at || right.starts_at || right.created_at || 0).getTime();
      return rightTime - leftTime;
    });
  }, [dailySessions]);

  const pastDailySessionCategories = useMemo(() => {
    const dailyCategoryByVersion = new Map(
      (dailyTests ?? []).map((test) => [test.version, String(test.title ?? "").trim() || "Uncategorized"])
    );
    const grouped = new Map();
    dailyRetakeSessions.forEach((session) => {
      const category = dailyCategoryByVersion.get(session.problem_set_id) || "Uncategorized";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(session);
    });
    return Array.from(grouped.entries())
      .map(([name, sessions]) => ({
        name,
        sessions,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [dailyRetakeSessions, dailyTests]);

  const selectedPastDailyRetakeCategory = useMemo(() => {
    if (!pastDailySessionCategories.length) return null;
    return pastDailySessionCategories.find((category) => category.name === dailyRetakeCategory) ?? pastDailySessionCategories[0];
  }, [dailyRetakeCategory, pastDailySessionCategories]);

  const filteredPastDailySessions = selectedPastDailyRetakeCategory?.sessions ?? [];

  const isModelPreview = useMemo(() => {
    if (previewSession?.problem_set_id) {
      return modelTests.some((test) => test.version === previewSession.problem_set_id);
    }
    if (previewTest) {
      return modelTests.some((test) => test.version === previewTest);
    }
    return false;
  }, [modelTests, previewSession, previewTest]);

  const previewReplacementOrderMap = useMemo(() => {
    const map = new Map();
    previewReplacementPool.forEach((question, index) => {
      const key = buildSourceQuestionKey(
        question.sourceVersion || question.testVersion,
        question.sourceQuestionId || question.questionId
      );
      map.set(key, Number.isFinite(question.orderIndex) ? question.orderIndex : index);
    });
    return map;
  }, [previewReplacementPool]);

  const previewDisplayQuestions = useMemo(() => {
    const list = [...previewQuestions];
    const shouldUseSingleSetSourceOrder = Boolean(
      previewSession
      && isDaily(previewSession.problem_set_id)
      && new Set(list.map((question) => question.sourceVersion).filter(Boolean)).size === 1
      && previewReplacementOrderMap.size
    );
    if (!shouldUseSingleSetSourceOrder) return list;
    return list.sort((left, right) => {
      const leftKey = buildSourceQuestionKey(left.sourceVersion, left.sourceQuestionId);
      const rightKey = buildSourceQuestionKey(right.sourceVersion, right.sourceQuestionId);
      const leftOrder = previewReplacementOrderMap.get(leftKey);
      const rightOrder = previewReplacementOrderMap.get(rightKey);
      if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return (left.orderIndex ?? 0) - (right.orderIndex ?? 0);
    });
  }, [previewQuestions, previewReplacementOrderMap, previewSession, isDaily]);

  const testMetaByVersion = useMemo(() => {
    const map = {};
    tests.forEach((test) => {
      map[test.version] = {
        title: test.title || test.version,
        category: String(test.title ?? "").trim() || DEFAULT_MODEL_CATEGORY,
        type: test.type,
      };
    });
    return map;
  }, [tests]);

  const testSessionsById = useMemo(() => new Map(testSessions.map((s) => [s.id, s])), [testSessions]);

  const sessionDetailStudentOptions = useMemo(() => {
    return (sessionDetailAttempts ?? [])
      .map((attempt) => ({
        id: attempt.student_id,
        display_name: attempt.display_name,
        student_code: attempt.student_code,
      }))
      .filter((item, index, array) => array.findIndex((a) => a.id === item.id) === index);
  }, [sessionDetailAttempts]);

  const selectedDailySourceCategoryNames = useMemo(() => {
    const primaryCategory = dailyConductCategory ? [dailyConductCategory] : [];
    const additionalCategories = dailySessionForm.source_categories ?? [];
    return Array.from(new Set([...primaryCategory, ...additionalCategories]));
  }, [dailyConductCategory, dailySessionForm.source_categories]);

  const dailyConductTests = useMemo(() => {
    const allSelected = selectedDailySourceCategoryNames;
    return dailyQuestionSets.filter((test) => {
      const testCategory = String(test.title ?? "").trim() || "Uncategorized";
      return allSelected.includes(testCategory);
    });
  }, [dailyQuestionSets, selectedDailySourceCategoryNames]);

  const selectedDailyProblemSetIds = useMemo(() => {
    if (dailySessionForm.selection_mode === "multiple") {
      return dailySessionForm.problem_set_ids ?? [];
    }
    return dailySessionForm.problem_set_id ? [dailySessionForm.problem_set_id] : [];
  }, [dailySessionForm.selection_mode, dailySessionForm.problem_set_id, dailySessionForm.problem_set_ids]);

  const selectedDailyQuestionCount = useMemo(() => {
    const selectedIds = selectedDailyProblemSetIds;
    const questions = dailyQuestionSets.filter((t) => selectedIds.includes(t.version));
    return questions.reduce((sum, test) => sum + (Number(test.question_count) || 0), 0);
  }, [selectedDailyProblemSetIds, dailyQuestionSets]);

  const dailyCategories = useMemo(() => {
    const categorySet = new Set(
      dailyQuestionSets
        .map((test) => String(test.title ?? "").trim() || "Uncategorized")
        .filter(Boolean)
    );
    return Array.from(categorySet)
      .map((name) => ({ name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [dailyQuestionSets]);

  const modelCategories = useMemo(() => {
    const categorySet = new Set(
      modelTests
        .map((test) => String(test.title ?? "").trim() || DEFAULT_MODEL_CATEGORY)
        .filter(Boolean)
    );
    return Array.from(categorySet)
      .map((name) => ({ name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [modelTests]);

  const filteredModelUploadTests = useMemo(() => {
    if (!modelUploadCategory) return modelTests;
    return modelTests.filter((t) => String(t.title ?? "").trim() === modelUploadCategory);
  }, [modelTests, modelUploadCategory]);

  const groupedModelUploadTests = useMemo(
    () => buildCategories(filteredModelUploadTests, DEFAULT_MODEL_CATEGORY),
    [filteredModelUploadTests],
  );

  const filteredDailyUploadTests = useMemo(() => {
    if (!dailyUploadCategory) return dailyQuestionSets;
    return dailyQuestionSets.filter((t) => String(t.title ?? "").trim() === dailyUploadCategory);
  }, [dailyQuestionSets, dailyUploadCategory]);

  const groupedDailyUploadTests = useMemo(
    () => buildCategories(filteredDailyUploadTests),
    [filteredDailyUploadTests],
  );

  const dailyResultCategories = useMemo(() => {
    const sessionVersions = new Set((dailySessions ?? []).map((session) => session.problem_set_id).filter(Boolean));
    return buildCategories((dailyTests ?? []).filter((test) => sessionVersions.has(test.version)));
  }, [dailySessions, dailyTests]);

  const modelResultCategories = useMemo(() => {
    const sessionVersions = new Set(
      (testSessions ?? [])
        .filter((session) => !isRetakeSessionTitle(session.title))
        .map((session) => session.problem_set_id)
        .filter(Boolean)
    );
    return buildCategories((modelTests ?? []).filter((test) => sessionVersions.has(test.version)), DEFAULT_MODEL_CATEGORY);
  }, [modelTests, testSessions]);

  const dailySessionCategories = useMemo(() => buildCategories(dailyTests), [dailyTests]);

  const dailySessionCategorySelectValue = useMemo(() => {
    if (!dailySessionCategories.length) return CUSTOM_CATEGORY_OPTION;
    return dailySessionCategories.some((category) => category.name === dailySessionForm.session_category)
      ? dailySessionForm.session_category
      : CUSTOM_CATEGORY_OPTION;
  }, [dailySessionCategories, dailySessionForm.session_category]);

  const selectedDailyCategory = useMemo(() => {
    if (!dailyResultCategories.length) return null;
    return dailyResultCategories.find((c) => c.name === dailyResultsCategory) ?? dailyResultCategories[0];
  }, [dailyResultCategories, dailyResultsCategory]);

  const selectedModelCategory = useMemo(() => {
    if (!modelResultCategories.length || !modelResultsCategory) return null;
    return modelResultCategories.find((c) => c.name === modelResultsCategory) ?? null;
  }, [modelResultCategories, modelResultsCategory]);

  const selectedModelConductCategory = useMemo(() => {
    if (!modelCategories.length || !modelConductCategory) return null;
    return modelCategories.find((c) => c.name === modelConductCategory) ?? null;
  }, [modelCategories, modelConductCategory]);

  const modelConductTests = selectedModelConductCategory?.tests ?? [];

  // ========================================================================
  // useCallback functions (39+ callbacks)
  // ========================================================================

  const fetchTests = useCallback(async () => {
    setTestsMsg("Loading...");
    if (!supabase) {
      setTestsMsg("Supabase not initialized.");
      return;
    }
    const { data, error } = await supabase
      .from("tests")
      .select("id, version, title, type, is_public, pass_rate, school_id, created_at, question_count, updated_at, data")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("tests fetch error:", error);
      setTests([]);
      setTestsMsg(`Load failed: ${error.message}`);
      return;
    }
    setTests(data ?? []);
    setTestsMsg("");
  }, [supabase]);

  const fetchTestSessions = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("test_sessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("test_sessions fetch error:", error);
      return;
    }
    setTestSessions(data ?? []);
  }, [supabase]);

  const fetchAssets = useCallback(async () => {
    setAssetsMsg("Loading...");
    if (!supabase) {
      setAssetsMsg("Supabase not initialized.");
      return;
    }
    const { data, error } = await supabase
      .from("test_assets")
      .select("id")
      .limit(1);
    if (error) {
      console.error("assets fetch error:", error);
      setAssets([]);
      setAssetsMsg(`Load failed: ${error.message}`);
      return;
    }
    setAssets(data ?? []);
    setAssetsMsg("");
  }, [supabase]);

  const buildGeneratedDailySessionTitle = useCallback(({ category, setIds, sessionDate, startTime }) => {
    const normalizedCategory = String(category ?? "").trim() || "Daily Test";
    const normalizedDate = String(sessionDate ?? "").trim() || new Date().toISOString().slice(0, 10);
    const normalizedTime = String(startTime ?? "").trim() || "00:00";
    if ((setIds ?? []).length <= 1) {
      return `${normalizedCategory} ${setIds[0] ?? "Session"} ${normalizedDate} ${normalizedTime}`;
    }
    return `${normalizedCategory} ${setIds.length} Sets ${normalizedDate} ${normalizedTime}`;
  }, []);

  const materializeDailyProblemSet = useCallback(async ({
    sourceSetIds,
    category,
    questionCountMode,
    questionCount,
    passRate,
  }) => {
    if (!supabase) throw new Error("Supabase not initialized.");

    const normalizedSetIds = Array.from(new Set((sourceSetIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)));
    if (!normalizedSetIds.length) {
      throw new Error("Choose at least one SetID.");
    }

    const shouldCreateDerivedSet =
      normalizedSetIds.length > 1
      || questionCountMode === "specify";

    if (!shouldCreateDerivedSet) {
      return normalizedSetIds[0];
    }

    const { data: sourceQuestions, error: sourceQuestionsError } = await fetchQuestionsForVersionsWithFallback(
      supabase,
      normalizedSetIds
    );
    if (sourceQuestionsError) {
      throw new Error(`Question lookup failed: ${sourceQuestionsError.message}`);
    }

    const orderedQuestions = normalizedSetIds.flatMap((version) =>
      (sourceQuestions ?? []).filter((row) => row.test_version === version)
    );
    if (!orderedQuestions.length) {
      throw new Error("No questions found for the selected SetID.");
    }

    const requestedQuestionCount =
      questionCountMode === "specify"
        ? Number(questionCount)
        : orderedQuestions.length;
    if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
      throw new Error("Specify a valid number of questions.");
    }
    if (requestedQuestionCount > orderedQuestions.length) {
      throw new Error(`Only ${orderedQuestions.length} questions are available for the selected SetID.`);
    }

    const selectedQuestions = orderedQuestions.slice(0, requestedQuestionCount);
    const sourceQuestionIds = selectedQuestions.map((row) => row.id).filter(Boolean);
    const { data: sourceChoices, error: sourceChoicesError } = sourceQuestionIds.length
      ? await supabase
          .from("choices")
          .select("question_id, part_index, choice_index, label, choice_image")
          .in("question_id", sourceQuestionIds)
      : { data: [], error: null };
    if (sourceChoicesError) {
      throw new Error(`Choice lookup failed: ${sourceChoicesError.message}`);
    }

    const generatedVersion = `daily_session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ensure = await ensureTestRecord(
      generatedVersion,
      category || generatedVersion,
      "daily",
      passRate,
      activeSchoolId,
    );
    if (!ensure.ok) {
      throw new Error(ensure.message);
    }

    const questionKeyBySourceId = new Map();
    const nextQuestions = selectedQuestions.map((row, index) => {
      const nextQuestionId = `${row.test_version || "daily"}__${row.question_id || index + 1}__${index + 1}`;
      questionKeyBySourceId.set(row.id, nextQuestionId);
      return {
        school_id: activeSchoolId,
        test_version: generatedVersion,
        question_id: nextQuestionId,
        section_key: row.section_key,
        type: row.type,
        prompt_en: row.prompt_en,
        prompt_bn: row.prompt_bn,
        answer_index: row.answer_index,
        order_index: index + 1,
        data: {
          ...(row.data ?? {}),
          itemId: nextQuestionId,
          sourceVersion: row.test_version ?? null,
          sourceQuestionId: row.question_id ?? null,
        },
      };
    });

    const { error: insertQuestionsError } = await supabase.from("questions").insert(nextQuestions);
    if (insertQuestionsError) {
      throw new Error(`Question clone failed: ${insertQuestionsError.message}`);
    }

    const insertedQuestionIds = nextQuestions.map((row) => row.question_id);
    const { data: insertedRows, error: insertedRowsError } = await supabase
      .from("questions")
      .select("id, question_id")
      .eq("test_version", generatedVersion)
      .in("question_id", insertedQuestionIds);
    if (insertedRowsError) {
      throw new Error(`Question verification failed: ${insertedRowsError.message}`);
    }

    const insertedIdByQuestionKey = new Map((insertedRows ?? []).map((row) => [row.question_id, row.id]));
    const nextChoices = (sourceChoices ?? [])
      .map((row) => {
        const questionKey = questionKeyBySourceId.get(row.question_id);
        const nextQuestionId = questionKey ? insertedIdByQuestionKey.get(questionKey) : null;
        if (!nextQuestionId) return null;
        return {
          question_id: nextQuestionId,
          part_index: row.part_index ?? null,
          choice_index: row.choice_index,
          label: row.label,
          choice_image: row.choice_image,
        };
      })
      .filter(Boolean);

    if (nextChoices.length) {
      const { error: insertChoicesError } = await supabase.from("choices").insert(nextChoices);
      if (insertChoicesError) {
        throw new Error(`Choice clone failed: ${insertChoicesError.message}`);
      }
    }

    return generatedVersion;
  }, [supabase, activeSchoolId, fetchQuestionsForVersionsWithFallback]);

  const ensureTestRecord = useCallback(async (testVersion, title, type, passRate, schoolId = activeSchoolId) => {
    if (!schoolId || !supabase) {
      return { ok: false, message: "School scope is required." };
    }
    const { data, error } = await supabase
      .from("tests")
      .select("id, title")
      .eq("version", testVersion)
      .limit(1);
    if (error) {
      console.error("tests lookup error:", error);
      return { ok: false, message: `Test lookup failed: ${error.message}` };
    }
    const existing = (data ?? [])[0] ?? null;
    if (existing) {
      const updatePayload = {
        school_id: schoolId,
        type,
        updated_at: new Date().toISOString()
      };
      if (Number.isFinite(passRate)) updatePayload.pass_rate = passRate;
      if (title) updatePayload.title = title;
      const { error: updateError } = await supabase
        .from("tests")
        .update(updatePayload)
        .eq("version", testVersion);
      if (updateError) {
        console.error("tests update error:", updateError);
        return { ok: false, message: `Update failed: ${updateError.message}` };
      }
      return { ok: true, existing: true };
    }

    const effectiveTitle = title || testVersion;
    const insertPayload = {
      school_id: schoolId,
      version: testVersion,
      title: effectiveTitle,
      type,
      is_public: true,
      updated_at: new Date().toISOString()
    };
    if (Number.isFinite(passRate)) insertPayload.pass_rate = passRate;
    const { error: insertError } = await supabase.from("tests").insert(insertPayload);
    if (insertError) {
      console.error("tests insert error:", insertError);
      return { ok: false, message: `Create failed: ${insertError.message}` };
    }
    return { ok: true, existing: false };
  }, [supabase, activeSchoolId]);

  const hasDuplicateSessionTitle = useCallback(async (title, excludeId = "") => {
    if (!supabase) return false;
    const normalizedTitle = String(title ?? "").trim();
    if (!normalizedTitle) return false;
    let query = supabase
      .from("test_sessions")
      .select("id")
      .eq("title", normalizedTitle)
      .limit(1);
    if (excludeId) query = query.neq("id", excludeId);
    const { data, error } = await query;
    if (error) {
      console.error("test_sessions duplicate title check error:", error);
      throw new Error(error.message);
    }
    return Boolean((data ?? []).length);
  }, [supabase]);

  const createTestSession = useCallback(async () => {
    setTestSessionsMsg("");
    if (!activeSchoolId) {
      setTestSessionsMsg("School scope is required.");
      return;
    }
    if (modelConductMode === "retake" && !modelRetakeSourceId) {
      setTestSessionsMsg("Please choose a past session to retake.");
      return;
    }
    const problemSetId = testSessionForm.problem_set_id.trim();
    const title = testSessionForm.title.trim();
    const sessionDate = testSessionForm.session_date;
    const startTime = testSessionForm.start_time;
    const closeTime = testSessionForm.close_time;
    const startsAtInput = combineBangladeshDateTime(sessionDate, startTime)
      || (modelConductMode === "retake" ? testSessionForm.starts_at : "");
    const endsAt = combineBangladeshDateTime(sessionDate, closeTime)
      || (modelConductMode === "retake" ? testSessionForm.ends_at : "");
    const passRate = Number(testSessionForm.pass_rate);
    if (!problemSetId) {
      setTestSessionsMsg("SetID is required.");
      return;
    }
    if (!title) {
      setTestSessionsMsg("Test Title is required.");
      return;
    }
    if (!sessionDate) {
      setTestSessionsMsg("Date is required.");
      return;
    }
    if (!startTime) {
      setTestSessionsMsg("Start time is required.");
      return;
    }
    if (!closeTime) {
      setTestSessionsMsg("Close time is required.");
      return;
    }
    if (!endsAt) {
      setTestSessionsMsg("End time is required.");
      return;
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setTestSessionsMsg("Pass rate must be between 0 and 1.");
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title)) {
        setTestSessionsMsg("That Test Title already exists.");
        return;
      }
    } catch (error) {
      setTestSessionsMsg(`Check failed: ${error.message}`);
      return;
    }
    const payload = {
      school_id: activeSchoolId,
      problem_set_id: problemSetId,
      title,
      starts_at: startsAtInput ? fromBangladeshInput(startsAtInput) : null,
      ends_at: endsAt ? fromBangladeshInput(endsAt) : null,
      time_limit_min: testSessionForm.time_limit_min ? Number(testSessionForm.time_limit_min) : null,
      is_published: true,
      show_answers: Boolean(testSessionForm.show_answers),
      allow_multiple_attempts: Boolean(testSessionForm.allow_multiple_attempts),
      retake_source_session_id: modelConductMode === "retake" ? modelRetakeSourceId : null,
      retake_release_scope: modelConductMode === "retake"
        ? (testSessionForm.retake_release_scope || "all")
        : "all"
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("test_sessions insert error:", error);
      setTestSessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: passRateError } = await supabase
      .from("tests")
      .update({ pass_rate: passRate, updated_at: new Date().toISOString() })
      .eq("version", problemSetId);
    if (passRateError) {
      console.error("test pass_rate update error:", passRateError);
      setTestSessionsMsg(`Session created but pass rate update failed: ${passRateError.message}`);
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: fromBangladeshInput(endsAt)
    });
    if (linkError) {
      console.error("exam_links insert error:", linkError);
      setTestSessionsMsg(`Session created but link failed: ${linkError.message}`);
      fetchTestSessions();
      return;
    }
    setTestSessionsMsg("Created (session + link).");
    setTestSessionForm((s) => ({
      ...s,
      title: "",
      session_date: "",
      start_time: "",
      close_time: "",
      show_answers: false,
      allow_multiple_attempts: false,
      pass_rate: "0.8",
      retake_release_scope: "all"
    }));
    setModelConductMode("normal");
    setModelRetakeSourceId("");
    setModelConductOpen(false);
    setActiveModelTimePicker("");
    await recordAuditEvent({
      actionType: modelConductMode === "retake" ? "create_retake_session" : "create_session",
      entityType: "test_session",
      entityId: created.id,
      summary: `${modelConductMode === "retake" ? "Created model retake session" : "Created model test session"} "${title}" for ${problemSetId}.`,
      metadata: {
        test_type: "mock",
        title,
        problem_set_id: problemSetId,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
      },
    });
    fetchTestSessions();
  }, [supabase, activeSchoolId, modelConductMode, modelRetakeSourceId, testSessionForm, fetchTestSessions, hasDuplicateSessionTitle, recordAuditEvent]);

  const createDailySession = useCallback(async () => {
    setDailySessionsMsg("");
    if (!activeSchoolId) {
      setDailySessionsMsg("School scope is required.");
      return;
    }
    if (dailyConductMode === "retake" && !dailyRetakeSourceId) {
      setDailySessionsMsg("Please choose a past session to retake.");
      return;
    }
    const isMultipleSelection = dailySessionForm.selection_mode === "multiple";
    const selectedSetIds = dailyConductMode === "retake"
      ? [dailySessionForm.problem_set_id].filter(Boolean)
      : selectedDailyProblemSetIds;
    const sessionDate = dailySessionForm.session_date;
    const startTime = dailySessionForm.start_time;
    const closeTime = dailySessionForm.close_time;
    const startsAtInput = combineBangladeshDateTime(sessionDate, startTime)
      || (dailyConductMode === "retake" ? dailySessionForm.starts_at : "");
    const endsAtInput = combineBangladeshDateTime(sessionDate, closeTime)
      || (dailyConductMode === "retake" ? dailySessionForm.ends_at : "");
    const title = dailySessionForm.title.trim();
    const sessionCategory = String(dailySessionForm.session_category ?? "").trim()
      || dailyConductCategory
      || selectedDailySourceCategoryNames[0]
      || "Daily Test";
    const endsAt = endsAtInput;
    const passRate = Number(dailySessionForm.pass_rate);
    if (!selectedSetIds.length) {
      setDailySessionsMsg(isMultipleSelection ? "Choose one or more SetID values." : "SetID is required.");
      return;
    }
    if (!title) {
      setDailySessionsMsg("Test Title is required.");
      return;
    }
    if (!sessionDate) {
      setDailySessionsMsg("Date is required.");
      return;
    }
    if (!startTime) {
      setDailySessionsMsg("Start time is required.");
      return;
    }
    if (!endsAt) {
      setDailySessionsMsg("End time is required.");
      return;
    }
    if (!closeTime) {
      setDailySessionsMsg("Close time is required.");
      return;
    }
    if (dailySessionForm.question_count_mode === "specify") {
      const requestedQuestionCount = Number(dailySessionForm.question_count);
      if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
        setDailySessionsMsg("Specify a valid number of questions.");
        return;
      }
      if (requestedQuestionCount > selectedDailyQuestionCount) {
        setDailySessionsMsg(`Only ${selectedDailyQuestionCount} questions are available for the selected SetID.`);
        return;
      }
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setDailySessionsMsg("Pass rate must be between 0 and 1.");
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title)) {
        setDailySessionsMsg("That Test Title already exists.");
        return;
      }
    } catch (error) {
      setDailySessionsMsg(`Check failed: ${error.message}`);
      return;
    }
    let problemSetId = selectedSetIds[0] ?? "";
    if (dailyConductMode !== "retake") {
      try {
        problemSetId = await materializeDailyProblemSet({
          sourceSetIds: selectedSetIds,
          category: sessionCategory,
          questionCountMode: dailySessionForm.question_count_mode,
          questionCount: dailySessionForm.question_count,
          passRate,
        });
      } catch (error) {
        setDailySessionsMsg(error.message);
        return;
      }
    }
    const payload = {
      school_id: activeSchoolId,
      problem_set_id: problemSetId,
      title,
      starts_at: startsAtInput ? fromBangladeshInput(startsAtInput) : null,
      ends_at: endsAt ? fromBangladeshInput(endsAt) : null,
      time_limit_min: dailySessionForm.time_limit_min ? Number(dailySessionForm.time_limit_min) : null,
      is_published: true,
      show_answers: Boolean(dailySessionForm.show_answers),
      allow_multiple_attempts: Boolean(dailySessionForm.allow_multiple_attempts),
      retake_source_session_id: dailyConductMode === "retake" ? dailyRetakeSourceId : null,
      retake_release_scope: dailyConductMode === "retake"
        ? (dailySessionForm.retake_release_scope || "all")
        : "all"
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("daily test_sessions insert error:", error);
      setDailySessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: passRateError } = await supabase
      .from("tests")
      .update({ pass_rate: passRate, updated_at: new Date().toISOString() })
      .eq("version", problemSetId);
    if (passRateError) {
      console.error("daily pass_rate update error:", passRateError);
      setDailySessionsMsg(`Session created but pass rate update failed: ${passRateError.message}`);
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: fromBangladeshInput(endsAt)
    });
    if (linkError) {
      console.error("daily exam_links insert error:", linkError);
      setDailySessionsMsg(`Session created but link failed: ${linkError.message}`);
      fetchTests();
      fetchTestSessions();
      return;
    }
    setDailySessionsMsg("Created (session + link).");
    setDailySessionForm((s) => ({
      ...s,
      source_categories: [],
      session_category: dailyConductCategory || "",
      title: "",
      question_count_mode: "all",
      question_count: "",
      problem_set_ids: s.problem_set_id ? [s.problem_set_id] : [],
      show_answers: false,
      allow_multiple_attempts: false,
      pass_rate: "0.8",
      retake_release_scope: "all",
    }));
    setDailyConductMode("normal");
    setDailyRetakeSourceId("");
    setDailyConductOpen(false);
    setDailySourceCategoryDropdownOpen(false);
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    await recordAuditEvent({
      actionType: dailyConductMode === "retake" ? "create_retake_session" : "create_session",
      entityType: "test_session",
      entityId: created.id,
      summary: `${dailyConductMode === "retake" ? "Created daily retake session" : "Created daily test session"} "${title}" in ${sessionCategory}.`,
      metadata: {
        test_type: "daily",
        title,
        category: sessionCategory,
        problem_set_id: problemSetId,
        source_set_ids: selectedSetIds,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
      },
    });
    fetchTests();
    fetchTestSessions();
  }, [supabase, activeSchoolId, dailyConductMode, dailyRetakeSourceId, dailySessionForm, selectedDailyProblemSetIds, selectedDailySourceCategoryNames, selectedDailyQuestionCount, dailyConductCategory, materializeDailyProblemSet, hasDuplicateSessionTitle, fetchTests, fetchTestSessions, recordAuditEvent]);

  const startEditSession = useCallback((session) => {
    if (!session?.id) return;
    const passRate = getSessionEffectivePassRate(session);
    setEditingSessionId(session.id);
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: session.id,
      problem_set_id: session.problem_set_id ?? "",
      title: session.title ?? "",
      starts_at: formatDateTimeInput(session.starts_at),
      ends_at: formatDateTimeInput(session.ends_at),
      time_limit_min: session.time_limit_min ?? "",
      show_answers: Boolean(session.show_answers),
      allow_multiple_attempts: session.allow_multiple_attempts !== false,
      pass_rate: String(passRate)
    });
  }, []);

  const cancelEditSession = useCallback(() => {
    setEditingSessionId("");
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: "",
      problem_set_id: "",
      title: "",
      starts_at: "",
      ends_at: "",
      time_limit_min: "",
      show_answers: false,
      allow_multiple_attempts: true,
      pass_rate: ""
    });
  }, []);

  const saveSessionEdits = useCallback(async () => {
    if (!editingSessionId || !supabase) return;
    const {
      title,
      starts_at,
      ends_at,
      time_limit_min,
      show_answers,
      pass_rate,
      problem_set_id,
      allow_multiple_attempts
    } = editingSessionForm;
    if (!title.trim()) {
      setEditingSessionMsg("Test Title is required.");
      return;
    }
    if (!ends_at) {
      setEditingSessionMsg("End time is required.");
      return;
    }
    const passRateValue = Number(pass_rate);
    if (!Number.isFinite(passRateValue) || passRateValue <= 0 || passRateValue > 1) {
      setEditingSessionMsg("Pass rate must be between 0 and 1.");
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title, editingSessionId)) {
        setEditingSessionMsg("That Test Title already exists.");
        return;
      }
    } catch (error) {
      setEditingSessionMsg(`Check failed: ${error.message}`);
      return;
    }
    setEditingSessionMsg("Saving...");
    const payload = {
      title: title.trim(),
      starts_at: starts_at ? fromBangladeshInput(starts_at) : null,
      ends_at: ends_at ? fromBangladeshInput(ends_at) : null,
      time_limit_min: time_limit_min ? Number(time_limit_min) : null,
      show_answers: Boolean(show_answers),
      allow_multiple_attempts: Boolean(allow_multiple_attempts)
    };
    const { error } = await supabase.from("test_sessions").update(payload).eq("id", editingSessionId);
    if (error) {
      console.error("session update error:", error);
      setEditingSessionMsg(`Save failed: ${error.message}`);
      return;
    }
    const { error: linkError } = await supabase
      .from("exam_links")
      .update({ expires_at: fromBangladeshInput(ends_at) })
      .eq("test_session_id", editingSessionId);
    if (linkError) {
      console.error("session link update error:", linkError);
      setEditingSessionMsg(`Saved, but link update failed: ${linkError.message}`);
    }
    if (problem_set_id) {
      const { error: passRateError } = await supabase
        .from("tests")
        .update({ pass_rate: passRateValue, updated_at: new Date().toISOString() })
        .eq("version", problem_set_id);
      if (passRateError) {
        console.error("session pass_rate update error:", passRateError);
        setEditingSessionMsg(`Saved, but pass rate update failed: ${passRateError.message}`);
      }
    }
    cancelEditSession();
    fetchTestSessions();
  }, [editingSessionId, editingSessionForm, supabase, hasDuplicateSessionTitle, cancelEditSession, fetchTestSessions]);

  const deleteTestSession = useCallback(async (id, options = {}) => {
    if (!id || !supabase) return;
    const label = String(options?.title ?? id).trim() || id;
    const ok = window.confirm(`Delete test session "${label}"?\n\nThis removes the test session record overall.`);
    if (!ok) return;
    const { error } = await supabase.from("test_sessions").delete().eq("id", id);
    if (error) {
      console.error("test_sessions delete error:", error);
      setTestSessionsMsg(`Delete failed: ${error.message}`);
      if (options?.surface === "results") setQuizMsg(`Delete failed: ${error.message}`);
      return;
    }
    setTestSessionsMsg(`Deleted: ${label}`);
    if (options?.surface === "results") setQuizMsg(`Deleted: ${label}`);
    await recordAuditEvent({
      actionType: "delete",
      entityType: "test_session",
      entityId: id,
      summary: `Deleted test session "${label}".`,
      metadata: {
        title: label,
        test_type: options?.type || null,
      },
    });
    if (sessionDetail.sessionId === id) {
      closeSessionDetail();
    }
    await fetchTestSessions();
  }, [supabase, sessionDetail.sessionId, recordAuditEvent, fetchTestSessions]);

  const deleteTest = useCallback(async (testVersion) => {
    if (!testVersion || !supabase) return;
    const ok = window.confirm(`Delete test "${testVersion}"? This will remove questions/choices/assets.`);
    if (!ok) return;
    const { error } = await supabase.from("tests").delete().eq("version", testVersion);
    if (error) {
      console.error("delete test error:", error);
      setTestsMsg(`Delete failed: ${error.message}`);
      return;
    }
    setTestsMsg(`Deleted: ${testVersion}`);
    closePreview();
    fetchTests();
  }, [supabase, fetchTests]);

  const deleteAttempt = useCallback(async (attemptId) => {
    if (!attemptId || !supabase) return;
    const ok = window.confirm(`Delete attempt ${attemptId}?`);
    if (!ok) return;
    const { error } = await supabase.from("attempts").delete().eq("id", attemptId);
    if (error) {
      console.error("delete attempt error:", error);
      setQuizMsg(`Delete failed: ${error.message}`);
      return;
    }
    setQuizMsg(`Deleted: ${attemptId}`);
  }, [supabase]);

  const getAttemptTitle = useCallback((attempt) => {
    if (!attempt) return "";
    const importedTitle = String(attempt?.answers_json?.__meta?.imported_test_title ?? "").trim();
    if (isImportedResultsSummaryAttempt(attempt) && importedTitle) return importedTitle;
    if (attempt.test_session_id) {
      const session = testSessionsById.get(attempt.test_session_id);
      if (session?.title) return session.title;
    }
    return getProblemSetTitle(attempt.test_version, tests);
  }, [testSessionsById, tests]);

  const getAttemptDisplayDateValue = useCallback((attempt) => {
    if (!attempt) return "";
    const importedDate = String(
      attempt?.answers_json?.__meta?.imported_test_date
      ?? attempt?.answers_json?.__meta?.imported_date_iso
      ?? ""
    ).trim();
    if (importedDate) return importedDate;
    const session = attempt?.test_session_id ? testSessionsById.get(attempt.test_session_id) : null;
    return session?.starts_at || session?.ends_at || attempt?.ended_at || attempt?.started_at || attempt?.created_at || "";
  }, [testSessionsById]);

  const getAttemptDisplayTimestamp = useCallback((attempt) => {
    const value = getAttemptDisplayDateValue(attempt);
    if (!value) return getRowTimestamp(attempt);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const time = new Date(`${value}T00:00:00`).getTime();
      return Number.isFinite(time) ? time : getRowTimestamp(attempt);
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : getRowTimestamp(attempt);
  }, [getAttemptDisplayDateValue]);

  const isAttemptUsingCategoryTitle = useCallback((attempt) => {
    const category = normalizeLookupValue(testMetaByVersion[attempt?.test_version]?.category || DEFAULT_MODEL_CATEGORY);
    const title = normalizeLookupValue(getAttemptTitle(attempt));
    return Boolean(category && title && category === title);
  }, [testMetaByVersion, getAttemptTitle]);

  const setPreviewAnswer = useCallback((questionId, choiceIndex) => {
    setPreviewAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  }, []);

  const setPreviewPartAnswer = useCallback((questionId, partIndex, choiceIndex) => {
    setPreviewAnswers((prev) => {
      const cur = prev[questionId] ?? {};
      const next = Array.isArray(cur.partAnswers) ? [...cur.partAnswers] : [];
      next[partIndex] = choiceIndex;
      return { ...prev, [questionId]: { partAnswers: next } };
    });
  }, []);

  const closeSessionDetail = useCallback(() => {
    setSessionDetail({ type: "", sessionId: "" });
    setSessionDetailTab("questions");
    setSessionDetailQuestions([]);
    setSessionDetailAttempts([]);
    setSessionDetailMsg("");
    setSessionDetailAllowStudentId("");
    setSessionDetailAllowMsg("");
    setSessionDetailAllowances({});
    setSessionDetailShowAllAnalysis(false);
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }, []);

  const openSessionDetailView = useCallback((session, type) => {
    if (!session?.id) return;
    setEditingSessionId("");
    setEditingSessionMsg("");
    setSessionDetail({ type, sessionId: session.id });
    setSessionDetailTab("analysis");
    setSessionDetailAllowStudentId("");
    setSessionDetailAllowMsg("");
    setSessionDetailShowAllAnalysis(false);
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }, []);

  const fetchSessionDetail = useCallback(async (session) => {
    if (!session?.id || !session?.problem_set_id || !supabase) return;
    setSessionDetailLoading(true);
    setSessionDetailMsg("Loading...");
    setSessionDetailAllowMsg("");
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });

    const [{ data: questionsData, error: questionsError }, attemptsResult, allowancesResult] = await Promise.all([
      fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id),
      (async () => {
        const buildAttemptsQuery = (fields) =>
          supabase
            .from("attempts")
            .select(fields)
            .eq("test_session_id", session.id)
            .order("created_at", { ascending: true });
        let result = await buildAttemptsQuery(
          "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json, tab_left_count"
        );
        if (result.error && isMissingTabLeftCountError(result.error)) {
          result = await buildAttemptsQuery(
            "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
          );
        }
        return result;
      })(),
      supabase
        .from("test_session_attempt_overrides")
        .select("student_id, extra_attempts")
        .eq("test_session_id", session.id),
    ]);

    if (questionsError) {
      console.error("session detail questions fetch error:", questionsError);
      setSessionDetailQuestions([]);
      setSessionDetailAttempts([]);
      setSessionDetailAllowances({});
      setSessionDetailMsg(`Load failed: ${questionsError.message}`);
      setSessionDetailLoading(false);
      return;
    }
    if (attemptsResult.error) {
      console.error("session detail attempts fetch error:", attemptsResult.error);
      setSessionDetailQuestions([]);
      setSessionDetailAttempts([]);
      setSessionDetailAllowances({});
      setSessionDetailMsg(`Load failed: ${attemptsResult.error.message}`);
      setSessionDetailLoading(false);
      return;
    }

    const questionsList = (questionsData ?? []).map(mapQuestion);
    const attemptsList = attemptsResult.data ?? [];
    const actualAttemptsList = attemptsList.filter((attempt) => !isImportedResultsSummaryAttempt(attempt));
    const detailAttemptsList = actualAttemptsList.length ? actualAttemptsList : attemptsList;
    const allowancesMap = {};
    if (allowancesResult.error) {
      if (!isMissingSessionAttemptOverrideTableError(allowancesResult.error)) {
        console.error("session detail overrides fetch error:", allowancesResult.error);
      }
    } else {
      (allowancesResult.data ?? []).forEach((row) => {
        if (!row?.student_id) return;
        allowancesMap[row.student_id] = Number(row.extra_attempts ?? 0);
      });
    }

    setSessionDetailQuestions(questionsList);
    setSessionDetailAttempts(attemptsList);
    setSessionDetailAllowances(allowancesMap);
    setSessionDetailAllowStudentId((current) => {
      if (current && detailAttemptsList.some((attempt) => attempt.student_id === current)) return current;
      return detailAttemptsList[0]?.student_id ?? "";
    });
    setSessionDetailMsg("");
    setSessionDetailLoading(false);
  }, [supabase, fetchQuestionsForVersionWithFallback, mapQuestion, isMissingTabLeftCountError, isMissingSessionAttemptOverrideTableError]);

  const allowSessionAnotherAttempt = useCallback(async () => {
    if (!selectedSessionDetail?.id || !sessionDetailAllowStudentId || !supabase) return;
    if (selectedSessionDetail.allow_multiple_attempts !== false) {
      setSessionDetailAllowMsg("This session already allows multiple attempts.");
      return;
    }
    setSessionDetailAllowMsg("Saving...");
    const nextCount = Number(sessionDetailAllowances[sessionDetailAllowStudentId] ?? 0) + 1;
    const { error } = await supabase
      .from("test_session_attempt_overrides")
      .upsert({
        school_id: activeSchoolId,
        test_session_id: selectedSessionDetail.id,
        student_id: sessionDetailAllowStudentId,
        extra_attempts: nextCount,
      }, { onConflict: "test_session_id,student_id" });
    if (error) {
      console.error("allow another attempt error:", error);
      if (isMissingSessionAttemptOverrideTableError(error)) {
        setSessionDetailAllowMsg("Allow another attempt requires the new Supabase migration.");
        return;
      }
      setSessionDetailAllowMsg(`Save failed: ${error.message}`);
      return;
    }
    setSessionDetailAllowances((prev) => ({ ...prev, [sessionDetailAllowStudentId]: nextCount }));
    const student = sessionDetailStudentOptions.find((item) => item.id === sessionDetailAllowStudentId);
    setSessionDetailAllowMsg(`Allowed one more attempt for ${student?.display_name ?? sessionDetailAllowStudentId}.`);
  }, [supabase, activeSchoolId, selectedSessionDetail, sessionDetailAllowStudentId, sessionDetailAllowances, sessionDetailStudentOptions, isMissingSessionAttemptOverrideTableError]);

  const openPreview = useCallback(async (testVersion) => {
    if (!testVersion) return;
    setPreviewOpen(true);
    setPreviewTest(testVersion);
    try {
      const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, testVersion);
      if (error) {
        setPreviewMsg(`Load failed: ${error.message}`);
        return;
      }
      setPreviewQuestions((data ?? []).map(mapQuestion));
    } catch (error) {
      console.error("preview load error:", error);
      setPreviewMsg(error.message);
    }
  }, [supabase, fetchQuestionsForVersionWithFallback, mapQuestion]);

  const openSessionPreview = useCallback(async (session) => {
    if (!session?.id || !session?.problem_set_id) return;
    setPreviewOpen(true);
    setPreviewSession(session);
    try {
      if (isDaily(session.problem_set_id)) {
        const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id);
        if (error) {
          setPreviewMsg(`Load failed: ${error.message}`);
          return;
        }
        setPreviewQuestions((data ?? []).map(mapQuestion));
      } else {
        const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id);
        if (error) {
          setPreviewMsg(`Load failed: ${error.message}`);
          return;
        }
        setPreviewQuestions((data ?? []).map(mapQuestion));
      }
    } catch (error) {
      console.error("session preview load error:", error);
      setPreviewMsg(error.message);
    }
  }, [supabase, fetchQuestionsForVersionWithFallback, mapQuestion, isDaily]);

  const closePreview = useCallback(() => {
    setPreviewOpen(false);
    setPreviewTest("");
    setPreviewSession(null);
    setPreviewQuestions([]);
    setPreviewAnswers({});
    setPreviewMsg("");
    setPreviewReplacementPool([]);
    setPreviewReplacementDrafts({});
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("");
  }, []);

  const uploadSingleAsset = useCallback(async (file, testVersion, type, schoolId = activeSchoolId) => {
    if (!schoolId || !supabase) {
      return { error: new Error("School scope is required.") };
    }
    const assetType = getAssetTypeByExt(file.name);
    const relPath = file.webkitRelativePath || file.name;
    const filePath = buildStorageObjectPath(type, testVersion, assetType, relPath);
    const { error: uploadError } = await supabase.storage
      .from("test-assets")
      .upload(filePath, file, { upsert: true, contentType: file.type || undefined });
    if (uploadError) return { error: uploadError };

    const { error: assetError } = await supabase.from("test_assets").insert({
      school_id: schoolId,
      test_version: testVersion,
      test_type: type,
      asset_type: assetType,
      path: filePath,
      mime_type: file.type || null,
      original_name: file.name
    });
    if (assetError) return { error: assetError };
    return { error: null };
  }, [supabase, activeSchoolId, getAssetTypeByExt, buildStorageObjectPath]);

  const validateCsvAssetsBeforeUpload = useCallback(async ({
    csvFile,
    uploadFiles,
    testVersion,
    parseCsv,
    missingVersionMessage,
    isCsvLike,
    onResolvedVersion,
    allowMultipleVersions = false,
  }) => {
    if (!csvFile || !supabase) {
      return { ok: false, summary: "CSV file is required." };
    }

    const text = await csvFile.text();
    const { questions, choices, errors } = parseCsv(text, testVersion);
    if (errors.length) {
      return {
        ok: false,
        summary: "Upload stopped due to CSV errors.",
        detail: `CSV errors:\n${errors.slice(0, 5).join("\n")}`,
      };
    }
    if (questions.length === 0) {
      return { ok: false, summary: "Upload stopped: no questions found in CSV." };
    }

    const versionSet = Array.from(new Set(questions.map((q) => q.test_version).filter(Boolean)));
    if (!versionSet.length) {
      return { ok: false, summary: missingVersionMessage };
    }
    const resolvedVersion = versionSet.length === 1 ? versionSet[0] : "";
    if (resolvedVersion && resolvedVersion !== testVersion && typeof onResolvedVersion === "function") {
      onResolvedVersion(resolvedVersion);
    }
    const existingAssetMap = {};
    for (const version of versionSet) {
      const { data: assetRows, error: assetErr } = await supabase
        .from("test_assets")
        .select("path, original_name")
        .eq("test_version", version);
      if (assetErr) {
        console.error("upload asset preflight lookup error:", assetErr);
        return {
          ok: false,
          summary: "Upload stopped: asset lookup failed.",
          detail: `Asset lookup failed: ${assetErr.message}`,
        };
      }
      for (const row of assetRows ?? []) {
        const name = row.original_name || row.path?.split("/").pop();
        if (name) existingAssetMap[name] = true;
      }
    }
    const localAssetMap = buildLocalAssetNameMap(uploadFiles, isCsvLike);
    const { missing, invalid } = validateAssetRefs(questions, choices, {
      ...existingAssetMap,
      ...localAssetMap,
    });

    if (invalid.length) {
      return {
        ok: false,
        summary: "Upload stopped: invalid asset path in CSV.",
        detail: `Invalid asset paths (use filename only):\n${invalid.slice(0, 10).join("\n")}`,
      };
    }
    if (missing.length) {
      return {
        ok: false,
        summary: `Upload stopped: ${missing.length} asset${missing.length === 1 ? "" : "s"} missing.`,
        detail: `Missing assets referenced by CSV:\n${missing.slice(0, 10).join("\n")}`,
      };
    }

    if (!allowMultipleVersions && versionSet.length > 1) {
      return { ok: false, summary: missingVersionMessage };
    }

    return { ok: true, resolvedVersion, versions: versionSet };
  }, [supabase, validateAssetRefs, buildLocalAssetNameMap]);

  const uploadAssets = useCallback(async () => {
    setAssetUploadMsg("");
    setAssetImportMsg("");
    if (!activeSchoolId) {
      setAssetUploadMsg("School scope is required.");
      return;
    }
    const singleFile = assetFile;
    const folderFiles = assetFiles || [];
    const type = "mock";
    const category = assetForm.category.trim();
    if (!category) {
      setAssetUploadMsg("Category is required.");
      return;
    }

    if (!singleFile && folderFiles.length === 0) {
      setAssetUploadMsg("File or folder is required.");
      return;
    }
    const files = [];
    if (singleFile) files.push(singleFile);
    files.push(...folderFiles);
    if (assetCsvFile && !files.includes(assetCsvFile)) files.unshift(assetCsvFile);
    if (singleFile && singleFile.name.toLowerCase().endsWith(".csv")) {
      setAssetCsvFile(singleFile);
    }
    const hasCsv =
      (assetCsvFile && assetCsvFile.name.toLowerCase().endsWith(".csv")) ||
      (singleFile && singleFile.name.toLowerCase().endsWith(".csv")) ||
      files.some((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!hasCsv) {
      setAssetUploadMsg("CSV file is required for Upload & Register Set.");
      return;
    }

    const csvFile = (assetCsvFile && assetCsvFile.name.toLowerCase().endsWith(".csv"))
      ? assetCsvFile
      : files.find((f) => f.name.toLowerCase().endsWith(".csv")) || null;
    const preflight = await validateCsvAssetsBeforeUpload({
      csvFile,
      uploadFiles: files,
      testVersion: "",
      parseCsv: parseQuestionCsv,
      missingVersionMessage: "Upload stopped: set_id is required in the CSV.",
      isCsvLike: (name) => String(name ?? "").toLowerCase().endsWith(".csv"),
      allowMultipleVersions: true,
    });
    if (!preflight.ok) {
      setAssetUploadMsg(preflight.summary);
      if (preflight.detail) setAssetImportMsg(preflight.detail);
      return;
    }
    const versions = preflight.versions ?? [];

    setAssetUploadMsg("Uploading...");
    for (const version of versions) {
      const ensure = await ensureTestRecord(version, category || DEFAULT_MODEL_CATEGORY, type, null, activeSchoolId);
      if (!ensure.ok) {
        setAssetUploadMsg(ensure.message);
        return;
      }
    }

    let ok = 0;
    let ng = 0;
    const totalUploads = files.length * Math.max(versions.length, 1);
    for (const version of versions) {
      for (const file of files) {
        const { error } = await uploadSingleAsset(file, version, type, activeSchoolId);
        if (error) {
          ng += 1;
          console.error("asset upload error:", error);
        } else {
          ok += 1;
        }
        setAssetUploadMsg(`Uploading... ${ok + ng}/${totalUploads}`);
      }
    }

    setAssetUploadMsg(`Uploaded: ${ok} ok / ${ng} failed`);
    fetchTests();
    fetchAssets();
  }, [activeSchoolId, assetFile, assetFiles, assetForm, assetCsvFile, validateCsvAssetsBeforeUpload, parseQuestionCsv, ensureTestRecord, uploadSingleAsset, fetchTests, fetchAssets]);

  const importQuestionsFromCsv = useCallback(async () => {
    setAssetImportMsg("");
    if (!activeSchoolId) {
      setAssetImportMsg("School scope is required.");
      return;
    }
    const file = assetCsvFile || assetFile;
    const type = "mock";
    const category = assetForm.category.trim();
    if (!category) {
      setAssetImportMsg("Category is required.");
      return;
    }

    if (!file) {
      setAssetImportMsg("CSV file is required.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("CSV file is required.");
      return;
    }
    setAssetImportMsg("Parsing...");
    const text = await file.text();
    const { questions, choices, errors } = parseQuestionCsv(text, "");
    if (errors.length) {
      setAssetImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setAssetImportMsg("No questions found.");
      return;
    }
    const groupedByVersion = groupParsedCsvByVersion(questions, choices);
    const versions = Array.from(groupedByVersion.keys());
    if (!versions.length) {
      setAssetImportMsg("set_id is required in the CSV.");
      return;
    }

    setAssetImportMsg("Resolving assets...");
    let totalQuestions = 0;
    let totalChoiceRows = 0;

    if (!supabase) {
      setAssetImportMsg("Supabase not initialized.");
      return;
    }

    for (const version of versions) {
      const group = groupedByVersion.get(version);
      if (!group) continue;
      const groupQuestions = group.questions.map((question) => ({ ...question }));
      const groupChoices = group.choices.map((choice) => ({ ...choice }));

      const { data: assetRows, error: assetErr } = await supabase
        .from("test_assets")
        .select("path, original_name")
        .eq("test_version", version);
      if (assetErr) {
        console.error("assets fetch error:", assetErr);
        setAssetImportMsg(`Asset lookup failed: ${assetErr.message}`);
        return;
      }
      const assetMap = {};
      for (const row of assetRows ?? []) {
        const name = row.original_name || row.path?.split("/").pop();
        if (name) assetMap[name] = resolveAdminAssetUrl(row.path);
      }
      const { missing, invalid } = validateAssetRefs(groupQuestions, groupChoices, assetMap);
      if (invalid.length) {
        setAssetImportMsg(`Invalid asset paths for ${version} (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
        return;
      }
      if (missing.length) {
        setAssetImportMsg(`Missing assets for ${version} (upload first):\n${missing.slice(0, 5).join("\n")}`);
        return;
      }
      applyAssetMap(groupQuestions, groupChoices, assetMap);

      const ensure = await ensureTestRecord(version, category || DEFAULT_MODEL_CATEGORY, type, null, activeSchoolId);
      if (!ensure.ok) {
        setAssetImportMsg(ensure.message);
        return;
      }

      const questionIds = groupQuestions.map((q) => q.question_id);
      if (questionIds.length) {
        const notIn = `(${questionIds.map((id) => `"${id}"`).join(",")})`;
        const { error: cleanupErr } = await supabase
          .from("questions")
          .delete()
          .eq("test_version", version)
          .not("question_id", "in", notIn);
        if (cleanupErr) {
          console.error("questions cleanup error:", cleanupErr);
          setAssetImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
          return;
        }
      }

      const scopedQuestions = groupQuestions.map((question) => ({
        ...question,
        school_id: activeSchoolId,
      }));

      const { error: qError } = await supabase.from("questions").upsert(scopedQuestions, {
        onConflict: "test_version,question_id"
      });
      if (qError) {
        console.error("questions upsert error:", qError);
        setAssetImportMsg(`Question upsert failed: ${qError.message}`);
        return;
      }
      const { data: qRows, error: qFetchErr } = await supabase
        .from("questions")
        .select("id, question_id")
        .eq("test_version", version)
        .in("question_id", questionIds);
      if (qFetchErr) {
        console.error("questions fetch error:", qFetchErr);
        setAssetImportMsg(`Question fetch failed: ${qFetchErr.message}`);
        return;
      }

      const idMap = {};
      for (const row of qRows ?? []) {
        idMap[row.question_id] = row.id;
      }

      const choiceRows = groupChoices
        .map((c) => ({
          question_id: idMap[c.question_key],
          part_index: c.part_index,
          choice_index: c.choice_index,
          label: c.label,
          choice_image: c.choice_image
        }))
        .filter((c) => c.question_id);

      const qUuidList = Object.values(idMap);
      if (qUuidList.length) {
        const { error: delErr } = await supabase.from("choices").delete().in("question_id", qUuidList);
        if (delErr) {
          console.error("choices delete error:", delErr);
          setAssetImportMsg(`Choice cleanup failed: ${delErr.message}`);
          return;
        }
      }

      if (choiceRows.length) {
        const { error: cErr } = await supabase.from("choices").insert(choiceRows);
        if (cErr) {
          console.error("choices insert error:", cErr);
          setAssetImportMsg(`Choice insert failed: ${cErr.message}`);
          return;
        }
      }

      totalQuestions += groupQuestions.length;
      totalChoiceRows += choiceRows.length;
    }

    setAssetImportMsg(`Imported ${totalQuestions} questions / ${totalChoiceRows} choices across ${versions.length} set${versions.length === 1 ? "" : "s"}.`);
    await recordAuditEvent({
      actionType: "import",
      entityType: "question_import",
      entityId: versions[0] || `mock-import-${Date.now()}`,
      summary: `Imported ${versions.length} model set${versions.length === 1 ? "" : "s"} in ${category}.`,
      metadata: {
        category,
        set_ids: versions,
        question_count: totalQuestions,
        choice_count: totalChoiceRows,
      },
    });
    fetchTests();
    setAssetCsvFile(null);
  }, [activeSchoolId, assetCsvFile, assetFile, assetForm, supabase, parseQuestionCsv, groupParsedCsvByVersion, validateAssetRefs, applyAssetMap, resolveAdminAssetUrl, ensureTestRecord, recordAuditEvent, fetchTests]);

  const uploadDailyAssets = useCallback(async () => {
    setDailyUploadMsg("");
    setDailyImportMsg("");
    if (!activeSchoolId) {
      setDailyUploadMsg("School scope is required.");
      return;
    }
    const singleFile = dailyFile;
    const folderFiles = dailyFiles || [];
    const category = dailyForm.category.trim();
    const type = "daily";

    if (!singleFile && folderFiles.length === 0) {
      setDailyUploadMsg("File or folder is required.");
      return;
    }

    const files = [];
    if (singleFile) files.push(singleFile);
    files.push(...folderFiles);
    if (dailyCsvFile && !files.includes(dailyCsvFile)) files.unshift(dailyCsvFile);
    const isCsvLike = (name) => {
      const lower = String(name ?? "").toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".tsv");
    };
    if (singleFile && isCsvLike(singleFile.name)) {
      setDailyCsvFile(singleFile);
    }
    const hasCsv =
      (dailyCsvFile && isCsvLike(dailyCsvFile.name)) ||
      (singleFile && isCsvLike(singleFile.name)) ||
      files.some((f) => isCsvLike(f.name));
    if (!hasCsv) {
      setDailyUploadMsg("CSV file is required for Upload & Register Daily Test.");
      return;
    }

    const csvFile = (dailyCsvFile && isCsvLike(dailyCsvFile.name))
      ? dailyCsvFile
      : files.find((f) => isCsvLike(f.name)) || null;
    const preflight = await validateCsvAssetsBeforeUpload({
      csvFile,
      uploadFiles: files,
      testVersion: "",
      parseCsv: parseDailyCsv,
      missingVersionMessage: "Upload stopped: set_id is required in the CSV.",
      isCsvLike,
      allowMultipleVersions: true,
    });
    if (!preflight.ok) {
      setDailyUploadMsg(preflight.summary);
      if (preflight.detail) setDailyImportMsg(preflight.detail);
      return;
    }
    const versions = preflight.versions ?? [];

    setDailyUploadMsg("Uploading...");
    for (const version of versions) {
      const ensure = await ensureTestRecord(version, category || version, type, null, activeSchoolId);
      if (!ensure.ok) {
        setDailyUploadMsg(ensure.message);
        return;
      }
    }

    let ok = 0;
    let ng = 0;
    const totalUploads = files.length * Math.max(versions.length, 1);
    for (const version of versions) {
      for (const file of files) {
        const { error } = await uploadSingleAsset(file, version, type, activeSchoolId);
        if (error) {
          ng += 1;
          console.error("daily asset upload error:", error);
        } else {
          ok += 1;
        }
        setDailyUploadMsg(`Uploading... ${ok + ng}/${totalUploads}`);
      }
    }

    setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed`);
    fetchTests();
    fetchAssets();
  }, [activeSchoolId, dailyFile, dailyFiles, dailyForm, dailyCsvFile, validateCsvAssetsBeforeUpload, parseDailyCsv, ensureTestRecord, uploadSingleAsset, fetchTests, fetchAssets]);

  const applySourceSessionToForm = useCallback((session, setForm) => {
    if (!session) return;
    setForm((current) => ({
      ...current,
      problem_set_id: session.problem_set_id ?? current.problem_set_id,
      title: buildRetakeTitle(session.title || getProblemSetTitle(session.problem_set_id, tests)),
      session_date: session.ends_at
        ? getBangladeshDateInput(session.ends_at)
        : session.starts_at
          ? getBangladeshDateInput(session.starts_at)
          : current.session_date,
      start_time: "",
      close_time: "",
      starts_at: "",
      ends_at: "",
      time_limit_min: session.time_limit_min != null ? String(session.time_limit_min) : current.time_limit_min,
      show_answers: false,
      allow_multiple_attempts: false,
      retake_release_scope: current.retake_release_scope || "all",
      pass_rate: "0.8",
    }));
  }, [tests]);

  const applyDailyRetakeSourceSession = useCallback((session) => {
    if (!session) return;
    const sourceCategory = testMetaByVersion[session.problem_set_id]?.category || "";
    if (sourceCategory) {
      setDailyRetakeCategory(sourceCategory);
      setDailyConductCategory(sourceCategory);
    }
    setDailySessionForm((current) => ({
      ...current,
      selection_mode: "single",
      problem_set_id: session.problem_set_id ?? current.problem_set_id,
      problem_set_ids: session.problem_set_id ? [session.problem_set_id] : [],
      source_categories: [],
      session_category: sourceCategory || current.session_category || "",
      title: buildRetakeTitle(session.title || getProblemSetTitle(session.problem_set_id, tests)),
      session_date: session.ends_at
        ? getBangladeshDateInput(session.ends_at)
        : session.starts_at
          ? getBangladeshDateInput(session.starts_at)
          : current.session_date,
      start_time: session.starts_at ? getBangladeshTimeInput(session.starts_at) : current.start_time,
      close_time: session.ends_at ? getBangladeshTimeInput(session.ends_at) : current.close_time,
      starts_at: "",
      ends_at: "",
      question_count_mode: "all",
      question_count: "",
      time_limit_min: session.time_limit_min != null ? String(session.time_limit_min) : current.time_limit_min,
      show_answers: false,
      allow_multiple_attempts: false,
      retake_release_scope: current.retake_release_scope || "all",
      pass_rate: "0.8",
    }));
  }, [testMetaByVersion, tests]);

  const openModelConductModal = useCallback((mode = "normal") => {
    setModelConductMode(mode);
    setModelConductOpen(true);
    setTestSessionsMsg("");
    setActiveModelTimePicker("");
    if (mode !== "retake") {
      setModelRetakeSourceId("");
      setTestSessionForm((current) => ({
        ...current,
        title: "",
        session_date: current.ends_at ? getBangladeshDateInput(current.ends_at) : "",
        start_time: current.starts_at ? getBangladeshTimeInput(current.starts_at) : "",
        close_time: current.ends_at ? getBangladeshTimeInput(current.ends_at) : "",
        show_answers: false,
        allow_multiple_attempts: false,
        pass_rate: "0.8",
        retake_release_scope: "all",
      }));
      return;
    }
    const source = pastModelSessions[0] ?? null;
    setModelRetakeSourceId(source?.id ?? "");
    if (source) applySourceSessionToForm(source, setTestSessionForm);
  }, [pastModelSessions, applySourceSessionToForm]);

  const openDailyConductModal = useCallback((mode = "normal") => {
    setDailyConductMode(mode);
    setDailyConductOpen(true);
    setDailySessionsMsg("");
    setDailySourceCategoryDropdownOpen(false);
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    if (mode !== "retake") {
      setDailyRetakeCategory("");
      setDailyRetakeSourceId("");
      setDailySessionForm((current) => ({
        ...current,
        selection_mode: "single",
        problem_set_ids: current.problem_set_id ? [current.problem_set_id] : [],
        source_categories: [],
        session_category: dailyConductCategory || current.session_category || "",
        title: "",
        session_date: current.ends_at ? getBangladeshDateInput(current.ends_at) : "",
        start_time: current.starts_at ? getBangladeshTimeInput(current.starts_at) : "",
        close_time: current.ends_at ? getBangladeshTimeInput(current.ends_at) : "",
        question_count_mode: "all",
        question_count: "",
        show_answers: false,
        allow_multiple_attempts: false,
        pass_rate: "0.8",
        retake_release_scope: "all",
      }));
      return;
    }
    const firstCategory = pastDailySessionCategories[0]?.name ?? "";
    if (firstCategory) setDailyRetakeCategory(firstCategory);
    const source = pastDailySessionCategories[0]?.sessions?.[0] ?? null;
    setDailyRetakeSourceId(source?.id ?? "");
    if (source) applyDailyRetakeSourceSession(source);
  }, [pastDailySessionCategories, dailyConductCategory, applyDailyRetakeSourceSession]);

  const openModelUploadModal = useCallback(() => {
    const normalizedCategory = String(assetForm.category ?? "").trim();
    const availableCategories = modelCategories.length
      ? modelCategories
      : [{ name: DEFAULT_MODEL_CATEGORY }];
    if (normalizedCategory && availableCategories.some((category) => category.name === normalizedCategory)) {
      setAssetCategorySelect(normalizedCategory);
    } else {
      const fallbackCategory = availableCategories[0]?.name ?? DEFAULT_MODEL_CATEGORY;
      setAssetCategorySelect(fallbackCategory);
      setAssetForm((current) => ({ ...current, category: fallbackCategory }));
    }
    setModelUploadOpen(true);
  }, [assetForm, modelCategories]);

  const getSessionEffectivePassRate = useCallback((session) => {
    if (!session) return 0.8;
    if (Number.isFinite(session.pass_rate) && session.pass_rate > 0 && session.pass_rate <= 1) {
      return session.pass_rate;
    }
    const testMeta = testMetaByVersion[session.problem_set_id];
    if (testMeta && Number.isFinite(testMeta.pass_rate)) {
      return testMeta.pass_rate;
    }
    return 0.8;
  }, [testMetaByVersion]);

  // ========================================================================
  // useEffect hooks (15+ effects)
  // ========================================================================

  useEffect(() => {
    if (modelCategorySeededRef.current) return;
    modelCategorySeededRef.current = true;
    if (modelCategories.length && !dailyConductCategory) {
      setDailyConductCategory(modelCategories[0].name);
    }
  }, [modelCategories, dailyConductCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!dailyConductCategory || !dailyCategories.some((c) => c.name === dailyConductCategory)) {
      setDailyConductCategory(dailyCategories[0].name);
    }
  }, [dailyCategories, dailyConductCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    const validNames = new Set(dailyCategories.map((category) => category.name));
    setDailySessionForm((current) => {
      const nextSourceCategories = Array.from(
        new Set((current.source_categories ?? []).filter((name) => validNames.has(name) && name !== dailyConductCategory))
      );
      if (JSON.stringify(nextSourceCategories) !== JSON.stringify(current.source_categories ?? [])) {
        return { ...current, source_categories: nextSourceCategories };
      }
      return current;
    });
  }, [dailyCategories, dailyConductCategory]);

  useEffect(() => {
    if (pastDailySessionCategories.length) {
      if (!dailyRetakeCategory || !pastDailySessionCategories.some((category) => category.name === dailyRetakeCategory)) {
        setDailyRetakeCategory(pastDailySessionCategories[0].name);
      }
    } else if (dailyRetakeCategory) {
      setDailyRetakeCategory("");
    }
  }, [dailyRetakeCategory, pastDailySessionCategories]);

  useEffect(() => {
    if (dailyConductMode !== "retake") return;
    if (!filteredPastDailySessions.length) {
      if (dailyRetakeSourceId) setDailyRetakeSourceId("");
      return;
    }
    if (filteredPastDailySessions.some((session) => session.id === dailyRetakeSourceId)) return;
    const source = filteredPastDailySessions[0];
    setDailyRetakeSourceId(source?.id ?? "");
  }, [dailyConductMode, filteredPastDailySessions, dailyRetakeSourceId]);

  useEffect(() => {
    if (!selectedSessionDetail?.id) return;
    fetchSessionDetail(selectedSessionDetail);
  }, [selectedSessionDetail?.id, selectedSessionDetail?.problem_set_id, fetchSessionDetail]);

  useEffect(() => {
    setAssetForm((current) => ({ ...current, category: assetCategorySelect }));
  }, [assetCategorySelect]);

  useEffect(() => {
    setDailyForm((current) => ({ ...current, category: dailyUploadCategory }));
  }, [dailyUploadCategory]);

  // Cleanup effect for preview section refs
  useEffect(() => {
    return () => {
      previewSectionRefs.current = {};
    };
  }, []);

  // ========================================================================
  // Return statement
  // ========================================================================

  return {
    // Tests data
    tests,
    setTests,
    testsMsg,
    setTestsMsg,
    testSessions,
    setTestSessions,
    testSessionsMsg,
    setTestSessionsMsg,
    linkMsg,
    setLinkMsg,

    // Modal states
    modelConductOpen,
    setModelConductOpen,
    modelUploadOpen,
    setModelUploadOpen,
    dailyConductOpen,
    setDailyConductOpen,
    dailyUploadOpen,
    setDailyUploadOpen,

    // Conduct modes
    modelConductMode,
    setModelConductMode,
    dailyConductMode,
    setDailyConductMode,

    // Retake sources
    modelRetakeSourceId,
    setModelRetakeSourceId,
    dailyRetakeCategory,
    setDailyRetakeCategory,
    dailyRetakeSourceId,
    setDailyRetakeSourceId,

    // Time pickers
    activeModelTimePicker,
    setActiveModelTimePicker,
    activeDailyTimePicker,
    setActiveDailyTimePicker,

    // Dropdown states
    dailySourceCategoryDropdownOpen,
    setDailySourceCategoryDropdownOpen,
    dailySetDropdownOpen,
    setDailySetDropdownOpen,

    // Session editing
    editingSessionId,
    setEditingSessionId,
    editingSessionMsg,
    setEditingSessionMsg,
    editingSessionForm,
    setEditingSessionForm,

    // Session forms
    testSessionForm,
    setTestSessionForm,
    dailySessionForm,
    setDailySessionForm,
    dailySessionsMsg,
    setDailySessionsMsg,

    // Assets
    assets,
    setAssets,
    assetsMsg,
    setAssetsMsg,
    quizMsg,
    setQuizMsg,
    assetForm,
    setAssetForm,
    assetCategorySelect,
    setAssetCategorySelect,
    assetFile,
    setAssetFile,
    assetFiles,
    setAssetFiles,
    assetCsvFile,
    setAssetCsvFile,
    assetUploadMsg,
    setAssetUploadMsg,
    assetImportMsg,
    setAssetImportMsg,

    // Daily assets
    dailyForm,
    setDailyForm,
    dailyFile,
    setDailyFile,
    dailyFiles,
    setDailyFiles,
    dailyCsvFile,
    setDailyCsvFile,
    dailyUploadMsg,
    setDailyUploadMsg,
    dailyImportMsg,
    setDailyImportMsg,

    // Preview
    previewOpen,
    setPreviewOpen,
    previewTest,
    setPreviewTest,
    previewQuestions,
    setPreviewQuestions,
    previewAnswers,
    setPreviewAnswers,
    previewMsg,
    setPreviewMsg,
    previewSession,
    setPreviewSession,
    previewReplacementPool,
    setPreviewReplacementPool,
    previewReplacementDrafts,
    setPreviewReplacementDrafts,
    previewReplacementSavingId,
    setPreviewReplacementSavingId,
    previewReplacementMsg,
    setPreviewReplacementMsg,

    // Attempt details
    attemptQuestionsByVersion,
    setAttemptQuestionsByVersion,
    attemptQuestionsLoading,
    setAttemptQuestionsLoading,
    attemptQuestionsError,
    setAttemptQuestionsError,

    // Session details
    sessionDetail,
    setSessionDetail,
    sessionDetailTab,
    setSessionDetailTab,
    sessionDetailQuestions,
    setSessionDetailQuestions,
    sessionDetailAttempts,
    setSessionDetailAttempts,
    sessionDetailLoading,
    setSessionDetailLoading,
    sessionDetailMsg,
    setSessionDetailMsg,
    sessionDetailAllowStudentId,
    setSessionDetailAllowStudentId,
    sessionDetailAllowMsg,
    setSessionDetailAllowMsg,
    sessionDetailAllowances,
    setSessionDetailAllowances,
    sessionDetailShowAllAnalysis,
    setSessionDetailShowAllAnalysis,
    sessionDetailAnalysisPopup,
    setSessionDetailAnalysisPopup,

    // Upload categories
    dailyConductCategory,
    setDailyConductCategory,
    modelConductCategory,
    setModelConductCategory,
    modelUploadCategory,
    setModelUploadCategory,
    dailyUploadCategory,
    setDailyUploadCategory,

    // Computed/Memos
    modelTests,
    dailyTests,
    dailyQuestionSets,
    modelSessions,
    dailySessions,
    selectedSessionDetail,
    pastModelSessions,
    dailyRetakeSessions,
    pastDailySessionCategories,
    selectedPastDailyRetakeCategory,
    filteredPastDailySessions,
    isModelPreview,
    previewDisplayQuestions,
    previewReplacementOrderMap,
    testPassRateByVersion: testMetaByVersion,
    testMetaByVersion,
    testSessionsById,
    sessionDetailStudentOptions,
    selectedDailySourceCategoryNames,
    dailyConductTests,
    selectedDailyProblemSetIds,
    selectedDailyQuestionCount,
    dailyCategories,
    modelCategories,
    dailySessionCategories,
    dailySessionCategorySelectValue,
    dailyResultCategories,
    modelResultCategories,
    selectedDailyCategory,
    selectedModelCategory,
    selectedModelConductCategory,
    modelConductTests,
    dailyResultsCategory,
    setDailyResultsCategory,
    modelResultsCategory,
    setModelResultsCategory,
    filteredModelUploadTests,
    groupedModelUploadTests,
    filteredDailyUploadTests,
    groupedDailyUploadTests,

    // Callback functions
    fetchTests,
    fetchTestSessions,
    fetchAssets,
    buildGeneratedDailySessionTitle,
    materializeDailyProblemSet,
    ensureTestRecord,
    createTestSession,
    createDailySession,
    startEditSession,
    cancelEditSession,
    saveSessionEdits,
    deleteTestSession,
    deleteTest,
    deleteAttempt,
    getAttemptTitle,
    getAttemptDisplayDateValue,
    getAttemptDisplayTimestamp,
    isAttemptUsingCategoryTitle,
    setPreviewAnswer,
    setPreviewPartAnswer,
    closeSessionDetail,
    openSessionDetailView,
    fetchSessionDetail,
    allowSessionAnotherAttempt,
    openPreview,
    openSessionPreview,
    closePreview,
    uploadSingleAsset,
    validateCsvAssetsBeforeUpload,
    uploadAssets,
    importQuestionsFromCsv,
    uploadDailyAssets,
    hasDuplicateSessionTitle,
    openModelConductModal,
    openDailyConductModal,
    openModelUploadModal,
    getSessionEffectivePassRate,

    // Refs
    dailySourceCategoryDropdownRef,
    dailySetDropdownRef,
    assetFolderInputRef,
    dailyFolderInputRef,
    resultsImportInputRef,
    previewSectionRefs,
  };
}
