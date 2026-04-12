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
const TWELVE_HOUR_TIME_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const FIVE_MINUTE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const MERIDIEM_OPTIONS = ["AM", "PM"];
const QUESTION_SELECT_BASE = "id, test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data";
const QUESTION_SELECT_WITH_MEDIA = QUESTION_SELECT_BASE;
const SET_ID_COLLATOR = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const SUPABASE_SAFE_PAGE_SIZE = 500;
const IMPORTED_ATTEMPT_BATCH_SIZE = 250;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function isMissingColumnError(error, columnName) {
  const message = String(error?.message ?? "");
  return message.includes(columnName) && message.toLowerCase().includes("does not exist");
}

async function fetchQuestionsForVersionWithFallback(supabaseClient, version) {
  let result = await supabaseClient
    .from("questions")
    .select(QUESTION_SELECT_WITH_MEDIA)
    .eq("test_version", version)
    .order("order_index", { ascending: true });
  if (result.error && (isMissingColumnError(result.error, "media_file") || isMissingColumnError(result.error, "media_type"))) {
    result = await supabaseClient
      .from("questions")
      .select(QUESTION_SELECT_BASE)
      .eq("test_version", version)
      .order("order_index", { ascending: true });
  }
  return result;
}

async function fetchQuestionsForVersionsWithFallback(supabaseClient, versions) {
  let result = await supabaseClient
    .from("questions")
    .select(QUESTION_SELECT_WITH_MEDIA)
    .in("test_version", versions)
    .order("test_version", { ascending: true })
    .order("order_index", { ascending: true });
  if (result.error && (isMissingColumnError(result.error, "media_file") || isMissingColumnError(result.error, "media_type"))) {
    result = await supabaseClient
      .from("questions")
      .select(QUESTION_SELECT_BASE)
      .in("test_version", versions)
      .order("test_version", { ascending: true })
      .order("order_index", { ascending: true });
  }
  return result;
}

async function fetchAllPages(buildPageQuery, pageSize = SUPABASE_SAFE_PAGE_SIZE) {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await buildPageQuery(offset, pageSize);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      return { data: rows, error: null };
    }

    offset += pageSize;
  }
}

function normalizePassRate(value, fallback = 0.8) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : fallback;
}

function compareSetIds(left, right) {
  return SET_ID_COLLATOR.compare(String(left ?? "").trim(), String(right ?? "").trim());
}

function getSessionSortTime(session) {
  return new Date(session?.starts_at || session?.created_at || 0).getTime();
}

function getQuestionSetVersionRank(item) {
  const label = String(item?.version_label ?? "").trim().toLowerCase();
  const match = label.match(/^v(\d+)$/i);
  if (match) return Number(match[1]);
  const version = Number(item?.version ?? 0);
  return Number.isFinite(version) ? version : 0;
}

function normalizeLegacyTestErrorMessage(error, action = "update") {
  const text = String(error?.message ?? "").trim();
  if (
    error?.code === "23505"
    && /tests_version_key|duplicate key value/i.test(text)
  ) {
    return "This SetID already exists. Use a different SetID.";
  }
  return `Test ${action} failed: ${text || "Unknown error"}`;
}

function isImportedResultsSummaryAttempt(attempt) {
  const source = String(attempt?.answers_json?.__meta?.imported_source ?? "");
  return Boolean(attempt?.answers_json?.__meta?.imported_summary)
    && (source === "daily_results_csv" || source === "model_results_csv");
}

function isGeneratedDailySessionVersion(version) {
  return String(version ?? "").startsWith("daily_session_");
}

function isImportedModelResultsTestVersion(version) {
  return String(version ?? "").startsWith("imported-");
}

function shuffleCopy(items) {
  const next = [...(items ?? [])];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

// Alias for readability in daily tests filtering
const isDaily = isGeneratedDailySessionVersion;

function mapQuestion(row) {
  // Transform database question row to UI format
  const data = row.data ?? {};
  const stemAsset = joinAssetValues(
    null,
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
    answerIndices: Array.isArray(data.answer_indices) ? data.answer_indices : null,
    orderIndex: row.order_index ?? 0,
    rawData: data,
    data,
    sourceVersion: data.sourceVersion ?? null,
    sourceQuestionId: data.sourceQuestionId ?? null,
    ...data,
    stemKind: normalizeModelCsvKind(data.stemKind ?? data.stem_kind ?? row.media_type ?? null) || null,
    stemAsset,
  };
}

function formatBooleanCsv(value) {
  return value ? "TRUE" : "FALSE";
}

function toCsv(rows) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[,"\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };
  return (rows ?? []).map((row) => (row ?? []).map(escapeCell).join(",")).join("\n");
}

function padCsvRow(row, length) {
  const next = [...(row ?? [])];
  while (next.length < length) next.push("");
  return next;
}

function formatSlashDateShortYear(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[2]}/${match[3]}/${match[1].slice(-2)}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function getStudentSectionValue(student) {
  return String(
    student?.section
      ?? student?.class_section
      ?? student?.group
      ?? student?.batch
      ?? ""
  ).trim();
}

function getStudentDisplayName(student) {
  return student?.display_name ?? student?.email ?? student?.id ?? "";
}

function formatNumberForCsv(value, digits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (digits > 0) return number.toFixed(digits);
  return Number.isInteger(number) ? `${number}` : number.toFixed(2);
}

function formatScoreFraction(correct, total, digits = 0) {
  const totalNumber = Number(total);
  const correctNumber = Number(correct);
  if (!Number.isFinite(correctNumber) || !Number.isFinite(totalNumber) || totalNumber <= 0) return "-";
  return `${formatNumberForCsv(correctNumber, digits)} / ${formatNumberForCsv(totalNumber, 0)}`;
}

function formatOrdinalRank(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  const mod10 = number % 10;
  if (mod10 === 1) return `${number}st`;
  if (mod10 === 2) return `${number}nd`;
  if (mod10 === 3) return `${number}rd`;
  return `${number}th`;
}

const BLANK_ANSWER_INDEX = -1;

function parseAnswerIndex(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlankAnswerChoice(choiceIndex) {
  return choiceIndex == null
    || choiceIndex === ""
    || Number(choiceIndex) === BLANK_ANSWER_INDEX;
}

function getEffectiveAnswerIndices(question) {
  const fromArray = Array.isArray(question?.answerIndices)
    ? question.answerIndices
    : Array.isArray(question?.data?.answer_indices)
      ? question.data.answer_indices
      : [];
  const normalized = fromArray
    .map((value) => parseAnswerIndex(value))
    .filter((value) => value != null);
  if (normalized.length) return Array.from(new Set(normalized));
  const single = parseAnswerIndex(question?.answerIndex);
  return single != null ? [single] : [];
}

function isChoiceCorrect(choiceIndex, answerIndices) {
  const normalizedAnswers = Array.isArray(answerIndices)
    ? answerIndices.map((value) => parseAnswerIndex(value)).filter((value) => value != null)
    : [];
  if (isBlankAnswerChoice(choiceIndex)) {
    return normalizedAnswers.includes(BLANK_ANSWER_INDEX);
  }
  const chosen = parseAnswerIndex(choiceIndex);
  if (chosen == null) return false;
  return normalizedAnswers.includes(chosen);
}

function normalizeImportedModelSectionTitle(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalizedRaw = raw.toLowerCase();
  const matchedSection = sections.find((section) => {
    const sectionTitle = String(section?.title ?? "").trim().toLowerCase();
    const sectionKey = String(section?.key ?? "").trim().toLowerCase();
    return section.key !== "DAILY" && (sectionTitle === normalizedRaw || sectionKey === normalizedRaw);
  });
  return matchedSection?.title || raw;
}

function isImportedModelResultsSummaryAttempt(attempt) {
  return Boolean(attempt?.answers_json?.__meta?.imported_summary)
    && String(attempt?.answers_json?.__meta?.imported_source ?? "") === "model_results_csv";
}

function getImportedModelSectionSummaries(attempt) {
  const rows = Array.isArray(attempt?.answers_json?.__meta?.main_section_summary)
    ? attempt.answers_json.__meta.main_section_summary
    : [];
  const orderMap = new Map(
    sections
      .filter((section) => section.key !== "DAILY")
      .map((section, index) => [section.title, index])
  );
  return rows
    .map((row) => {
      const section = normalizeImportedModelSectionTitle(row?.section);
      const correct = Number(row?.correct ?? 0);
      const total = Number(row?.total ?? 0);
      const rawRate = Number(row?.rate);
      const rate = Number.isFinite(rawRate) ? rawRate : (total > 0 ? correct / total : 0);
      return {
        section,
        correct: Number.isFinite(correct) ? correct : 0,
        total: Number.isFinite(total) ? total : 0,
        rate: Number.isFinite(rate) ? rate : 0,
      };
    })
    .filter((row) => row.section)
    .sort((left, right) => {
      const leftOrder = orderMap.has(left.section) ? orderMap.get(left.section) : 999;
      const rightOrder = orderMap.has(right.section) ? orderMap.get(right.section) : 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.section.localeCompare(right.section);
    });
}

function buildAttemptDetailRowsFromListForExport(answersJson, questionsList) {
  const answers = answersJson ?? {};
  const rows = [];
  for (const question of questionsList ?? []) {
    const answerKey = question.questionId ?? question.id;
    const section = getQuestionSectionLabel(question);
    if (Array.isArray(question.parts) && question.parts.length) {
      const answer = answers[answerKey];
      question.parts.forEach((part, index) => {
        const chosenIdx = answer?.partAnswers?.[index];
        const correctIndices = getEffectiveAnswerIndices(part);
        rows.push({
          qid: `${answerKey}-${index + 1}`,
          sectionKey: question.sectionKey || "",
          section,
          isCorrect: isChoiceCorrect(chosenIdx, correctIndices),
        });
      });
      continue;
    }
    const chosenIdx = answers[answerKey];
    const correctIndices = getEffectiveAnswerIndices(question);
    rows.push({
      qid: String(answerKey),
      sectionKey: question.sectionKey || "",
      section,
      isCorrect: isChoiceCorrect(chosenIdx, correctIndices),
    });
  }
  return rows;
}

function buildMainSectionSummaryForExport(rows) {
  const summaryMap = new Map();
  for (const row of rows ?? []) {
    const key = row.sectionKey ? getSectionTitle(row.sectionKey) : (row.section || "Unknown");
    const current = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    summaryMap.set(key, current);
  }
  return sections
    .filter((section) => section.key !== "DAILY")
    .map((section) => getSectionTitle(section.key))
    .map((label) => summaryMap.get(label))
    .filter(Boolean)
    .map((row) => ({
      ...row,
      rate: row.total ? row.correct / row.total : 0,
    }));
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function isMissingTabLeftCountError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /tab_left_count/i.test(text) && /does not exist/i.test(text);
}

function isMissingSessionAttemptOverrideTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /test_session_attempt_overrides/i.test(text) && /does not exist/i.test(text);
}

function parsePercentCell(value) {
  const raw = String(value ?? "").trim().replace(/%$/u, "");
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rate = parsed > 1 ? parsed / 100 : parsed;
  if (!Number.isFinite(rate)) return null;
  return Math.max(0, Math.min(1, rate));
}

function formatPercentInputValue(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return "";
  return String(Number((Math.max(0, Math.min(1, value)) * 100).toFixed(1)));
}

function buildImportedSummaryAnswersJson(source, extraMeta = {}) {
  return {
    __meta: {
      imported_summary: true,
      imported_source: source,
      tab_left_count: 0,
      ...extraMeta,
    },
  };
}

function extractIsoDatePart(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function toManualSessionIso(dateValue) {
  const raw = String(dateValue ?? "").trim();
  if (!raw) return "";
  if (/T/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const date = new Date(`${raw}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function isGeneratedScoreRateInsertError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /score_rate/i.test(text) && /(cannot insert a non-default value|generated|does not exist)/i.test(text);
}

function getImportedDailyAttemptRate(attempt) {
  const importedMetaRate = Number(attempt?.answers_json?.__meta?.imported_rate);
  if (Number.isFinite(importedMetaRate)) return importedMetaRate;
  const scoreRate = Number(attempt?.score_rate);
  if (Number.isFinite(scoreRate)) return scoreRate;
  const correct = Number(attempt?.correct ?? 0);
  const total = Number(attempt?.total ?? 0);
  if (Number.isFinite(correct) && Number.isFinite(total) && total > 0) {
    return correct / total;
  }
  return 0;
}

function getImportedCsvOrderIndex(attempt) {
  const orderIndex = Number(attempt?.answers_json?.__meta?.imported_csv_index);
  return Number.isFinite(orderIndex) ? orderIndex : null;
}

async function removeImportedSummaryAttemptsForPair(supabaseClient, studentId, sessionId) {
  if (!supabaseClient || !studentId || !sessionId) {
    return { ok: true, deleted: 0 };
  }
  const { data, error } = await supabaseClient
    .from("attempts")
    .select("id, answers_json")
    .eq("student_id", studentId)
    .eq("test_session_id", sessionId);
  if (error) {
    return { ok: false, message: error.message };
  }
  const deleteIds = (data ?? [])
    .filter((attempt) => isImportedSummaryAttempt(attempt))
    .map((attempt) => attempt.id)
    .filter(Boolean);
  if (!deleteIds.length) {
    return { ok: true, deleted: 0 };
  }
  const { error: deleteError } = await supabaseClient.from("attempts").delete().in("id", deleteIds);
  if (deleteError) {
    return { ok: false, message: deleteError.message };
  }
  return { ok: true, deleted: deleteIds.length };
}

async function deleteSessionResultsAndLinks(supabaseClient, sessionId) {
  if (!supabaseClient || !sessionId) {
    return { ok: true };
  }
  const [{ error: attemptsError }, { error: linksError }] = await Promise.all([
    supabaseClient.from("attempts").delete().eq("test_session_id", sessionId),
    supabaseClient.from("exam_links").delete().eq("test_session_id", sessionId),
  ]);
  if (attemptsError) {
    return { ok: false, message: attemptsError.message };
  }
  if (linksError) {
    return { ok: false, message: linksError.message };
  }
  return { ok: true };
}

async function insertImportedSummaryAttempts(supabaseClient, payloads) {
  const entries = Array.isArray(payloads) ? payloads.filter(Boolean) : [];
  if (!entries.length) {
    return { ok: true, inserted: 0 };
  }

  for (let index = 0; index < entries.length; index += IMPORTED_ATTEMPT_BATCH_SIZE) {
    let payloadChunk = entries.slice(index, index + IMPORTED_ATTEMPT_BATCH_SIZE);
    let { error } = await supabaseClient.from("attempts").insert(payloadChunk);
    if (error && isMissingTabLeftCountError(error)) {
      payloadChunk = payloadChunk.map(({ tab_left_count, ...payload }) => payload);
      ({ error } = await supabaseClient.from("attempts").insert(payloadChunk));
    }
    if (error && isGeneratedScoreRateInsertError(error)) {
      payloadChunk = payloadChunk.map(({ score_rate, ...payload }) => payload);
      ({ error } = await supabaseClient.from("attempts").insert(payloadChunk));
    }
    if (error) {
      return { ok: false, message: error.message };
    }
  }

  return { ok: true, inserted: entries.length };
}

function getAssetTypeByExt(filename) {
  const ext = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (ext === "csv") return "csv";
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
  return "file";
}

function getAssetProbeTarget(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function isImageAsset(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(probe)
    || probe.includes("/images/")
    || probe.includes("/image/");
}

function isAudioAsset(value) {
  const probe = getAssetProbeTarget(value);
  return /\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(probe)
    || probe.includes("/audio/")
    || probe.includes("/audios/");
}

function formatSubSectionLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const labelMap = {
    word_meaning: "Word Meaning",
    word_usage: "Word Usage",
    kanji_reading: "Kanji Reading",
    kanji_meaning_and_usage: "Kanji Usage",
    kanji_usage: "Kanji Usage",
    grammar: "Grammar",
    expression: "Expression",
    comprehending_content_conversation: "Conversation",
    conversation: "Conversation",
    comprehending_content_communicating_at_shops_and_public_places: "Shops and Public Places",
    public_place: "Shops and Public Places",
    shops_and_public_places: "Shops and Public Places",
    comprehending_content_listening_to_announcements_and_instructions: "Announcements and Instructions",
    announcement: "Announcements and Instructions",
    announcements_and_instructions: "Announcements and Instructions",
    comprehending_content: "Comprehension",
    comprehension: "Comprehension",
    info_search: "Information Search",
    information_search: "Information Search",
  };
  return labelMap[normalized] || raw;
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

function normalizeTimeToFiveMinuteStep(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) return text;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return text;
  const totalMinutes = Math.max(0, Math.min((hours * 60) + minutes, (23 * 60) + 59));
  const roundedMinutes = Math.round(totalMinutes / 5) * 5;
  const normalizedTotal = Math.min(roundedMinutes, 23 * 60 + 55);
  const nextHours = Math.floor(normalizedTotal / 60);
  const nextMinutes = normalizedTotal % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function getTwelveHourTimeParts(value) {
  const normalized = normalizeTimeToFiveMinuteStep(value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
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

function addMinutesToTimeInput(value, minutesToAdd) {
  const normalized = normalizeTimeToFiveMinuteStep(value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const totalMinutes = (Number(match[1]) * 60) + Number(match[2]) + Number(minutesToAdd || 0);
  const wrappedMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const nextHours = Math.floor(wrappedMinutes / 60);
  const nextMinutes = wrappedMinutes % 60;
  return `${String(nextHours).padStart(2, "0")}:${String(nextMinutes).padStart(2, "0")}`;
}

function formatTwelveHourTimeDisplay(value) {
  const parts = getTwelveHourTimeParts(value);
  if (!parts.hour) return "--:-- --";
  return `${parts.hour}:${parts.minute} ${parts.period}`;
}

function getProblemSetTitle(problemSetId, testsList) {
  const item = (testsList ?? []).find((t) => t.version === problemSetId);
  return item?.title || problemSetId || "";
}

function getProblemSetDisplayId(problemSetId, testsList) {
  const item = (testsList ?? []).find((t) => t.version === problemSetId);
  if (Array.isArray(item?.source_set_ids) && item.source_set_ids.length) {
    return item.source_set_ids.join(", ");
  }
  return problemSetId || "";
}

function parseDailySessionSetId(setId) {
  const raw = String(setId ?? "").trim();
  if (!raw) return null;
  let match = raw.match(/^G-Book(\d+)-(\d+)$/i);
  if (match) {
    return {
      kind: "grammar",
      bookNumber: Number(match[1]),
      chapterNumber: Number(match[2]),
      raw,
    };
  }
  match = raw.match(/^Book(\d+)-(\d+)$/i);
  if (match) {
    return {
      kind: "book",
      bookNumber: Number(match[1]),
      chapterNumber: Number(match[2]),
      raw,
    };
  }
  match = raw.match(/^(\d+)-Noun(\d+)$/i);
  if (match) {
    return {
      kind: "vocab",
      setNumber: Number(match[1]),
      nounNumber: Number(match[2]),
      raw,
    };
  }
  return { kind: "raw", raw };
}

function formatDailySessionNumberRanges(values) {
  const uniqueValues = Array.from(new Set((values ?? []).filter((value) => Number.isFinite(value)))).sort((left, right) => left - right);
  if (!uniqueValues.length) return "";
  const ranges = [];
  let start = uniqueValues[0];
  let prev = uniqueValues[0];

  for (let index = 1; index < uniqueValues.length; index += 1) {
    const current = uniqueValues[index];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}~${prev}`);
    start = current;
    prev = current;
  }
  ranges.push(start === prev ? `${start}` : `${start}~${prev}`);
  return ranges.join(", ");
}

function buildDailySessionTitleLabel(setIds) {
  const normalizedSetIds = Array.from(new Set((setIds ?? []).map((setId) => String(setId ?? "").trim()).filter(Boolean)))
    .sort((left, right) => compareSetIds(left, right));
  if (!normalizedSetIds.length) return "";

  const grouped = new Map();
  const rawLabels = [];

  normalizedSetIds.forEach((setId) => {
    const parsed = parseDailySessionSetId(setId);
    if (!parsed || parsed.kind === "raw") {
      rawLabels.push(setId);
      return;
    }
    const key = parsed.kind === "grammar"
      ? `grammar:${parsed.bookNumber}`
      : parsed.kind === "book"
        ? `book:${parsed.bookNumber}`
        : `vocab:${parsed.setNumber}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        kind: parsed.kind,
        bookNumber: parsed.bookNumber ?? null,
        setNumber: parsed.setNumber ?? null,
        numbers: [],
      });
    }
    grouped.get(key).numbers.push(parsed.kind === "vocab" ? parsed.nounNumber : parsed.chapterNumber);
  });

  const groupedLabels = Array.from(grouped.values())
    .sort((left, right) => {
      const leftLabel = left.kind === "grammar"
        ? `Grammar Book ${left.bookNumber}`
        : left.kind === "book"
          ? `Book ${left.bookNumber}`
          : `Vocabulary Set ${left.setNumber}`;
      const rightLabel = right.kind === "grammar"
        ? `Grammar Book ${right.bookNumber}`
        : right.kind === "book"
          ? `Book ${right.bookNumber}`
          : `Vocabulary Set ${right.setNumber}`;
      return leftLabel.localeCompare(rightLabel, "en", { numeric: true, sensitivity: "base" });
    })
    .map((group) => {
      const numberRange = formatDailySessionNumberRanges(group.numbers);
      if (!numberRange) return "";
      if (group.kind === "vocab") {
        return `Vocabulary Set ${group.setNumber} (Noun ${numberRange})`;
      }
      if (group.kind === "grammar") {
        return `Grammar Book ${group.bookNumber} Chapter ${numberRange}`;
      }
      return `Book ${group.bookNumber} Chapter ${numberRange}`;
    })
    .filter(Boolean);

  return [...groupedLabels, ...rawLabels].join(", ");
}

function buildDailySessionTitle({ category, setIds }) {
  const normalizedCategory = String(category ?? "").trim() || "Daily Test";
  const normalizedSetIds = Array.from(new Set((setIds ?? []).map((setId) => String(setId ?? "").trim()).filter(Boolean)))
    .sort((left, right) => compareSetIds(left, right));
  if (!normalizedSetIds.length) return normalizedCategory;

  if (normalizedSetIds.length === 1) {
    const parsed = parseDailySessionSetId(normalizedSetIds[0]);
    if (!parsed || parsed.kind === "raw") {
      return `${normalizedCategory} ${normalizedSetIds[0]}`.trim();
    }
    if (parsed.kind === "vocab") {
      return `Vocabulary Set ${parsed.setNumber} (Noun ${parsed.nounNumber})`;
    }
    if (parsed.kind === "grammar") {
      return `Grammar Book ${parsed.bookNumber} Chapter ${parsed.chapterNumber}`;
    }
    return `Book ${parsed.bookNumber} Chapter ${parsed.chapterNumber} Review`;
  }

  const summary = buildDailySessionTitleLabel(normalizedSetIds);
  if (!summary) return normalizedCategory;
  if (/^weekly review$/i.test(normalizedCategory)) {
    return `Week Review (${summary})`;
  }
  return `${normalizedCategory} (${summary})`;
}

function isRetakeSessionTitle(title) {
  return String(title ?? "").trim().startsWith("[Retake]");
}

function getRetakeBaseTitle(title) {
  return String(title ?? "").trim().replace(/^\[Retake\]\s*/i, "").trim();
}

function isImportedSummaryAttempt(attempt) {
  return Boolean(attempt?.answers_json?.__meta?.imported_summary);
}

function attemptHasDetailData(attempt) {
  if (!attempt || isImportedSummaryAttempt(attempt)) return false;
  if (!attempt.answers_json || typeof attempt.answers_json !== "object") return false;
  return Object.keys(attempt.answers_json).some((key) => key !== "__meta");
}

function attemptCanOpenDetail(attempt) {
  return attemptHasDetailData(attempt) || isImportedSummaryAttempt(attempt);
}

function buildSessionDetailAvailability(matrix) {
  const availability = {};
  const sessions = matrix?.sessions ?? [];
  const rows = matrix?.rows ?? [];
  sessions.forEach((session, sessionIndex) => {
    availability[session.id] = rows.some((row) =>
      (row?.cells?.[sessionIndex] ?? []).some((attempt) =>
        attemptHasDetailData(attempt) || isImportedResultsSummaryAttempt(attempt)
      )
    );
  });
  return availability;
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

function getBangladeshDateFromFormatted(formatted) {
  if (!formatted) return "";
  return formatted.slice(0, 10); // YYYY-MM-DD
}

function getBangladeshTimeFromFormatted(formatted) {
  if (!formatted) return "";
  return formatted.slice(11, 16); // HH:MM
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
    mediaFile: null,
    mediaType: null,
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
  parseQuestionCsv: externalParseQuestionCsv,
  parseDailyCsv: externalParseDailyCsv,
  recordAuditEvent: externalRecordAuditEvent = recordAdminAuditEvent,
  // Optional parameters with sensible defaults
  getAccessToken: externalGetAccessToken = async () => "",
  externalTests = [],
  externalTestsLoaded = false,
  externalTestSessions = [],
  externalTestSessionsLoaded = false,
  externalAttempts = [],
  externalAttemptsLoaded = false,
  setExternalAttempts = () => {},
  externalAssets = [],
  externalAssetsLoaded = false,
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
  const recordAuditEvent = externalRecordAuditEvent
    ? externalRecordAuditEvent
    : (eventObj) => recordAdminAuditEvent(supabase, eventObj);
  const getAccessToken = externalGetAccessToken;
  const parseQuestionCsv = externalParseQuestionCsv || ((text, version) => ({ questions: [], choices: [], errors: ["parseQuestionCsv not provided"] }));
  const parseDailyCsv = externalParseDailyCsv || ((text, version) => ({ questions: [], choices: [], errors: ["parseDailyCsv not provided"] }));
  const runSearch = externalRunSearch;
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

  const getQuestionSectionLabel = (question) => {
    return formatSubSectionLabel(question?.sectionLabel) || getSectionTitle(question?.sectionKey);
  };

  // ========================================================================
  // useState declarations (55+ variables)
  // ========================================================================

  const [tests, setTests] = useState(externalTests ?? []);
  const [testsLoaded, setTestsLoaded] = useState(Boolean(externalTestsLoaded));
  const [testsMsg, setTestsMsg] = useState("");
  const [testSessions, setTestSessions] = useState(externalTestSessions ?? []);
  const [testSessionsLoaded, setTestSessionsLoaded] = useState(Boolean(externalTestSessionsLoaded));
  const [testSessionsMsg, setTestSessionsMsg] = useState("");
  const [attempts, setAttempts] = useState(externalAttempts ?? []);
  const [attemptsLoaded, setAttemptsLoaded] = useState(Boolean(externalAttemptsLoaded));
  const [attemptsMsg, setAttemptsMsg] = useState("");
  const [examLinks, setExamLinks] = useState([]);
  const [examLinksLoaded, setExamLinksLoaded] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");

  // Model test session modal
  const [modelConductOpen, setModelConductOpen] = useState(false);
  const [modelUploadOpen, setModelUploadOpen] = useState(false);
  const [modelConductMode, setModelConductMode] = useState("normal");
  const [modelRetakeSourceId, setModelRetakeSourceId] = useState("");
  const [activeModelTimePicker, setActiveModelTimePicker] = useState("");
  const [modelConductError, setModelConductError] = useState("");

  // Daily test session modal
  const [dailyConductOpen, setDailyConductOpen] = useState(false);
  const [dailyUploadOpen, setDailyUploadOpen] = useState(false);
  const [dailyConductMode, setDailyConductMode] = useState("normal");
  const [dailyRetakeCategory, setDailyRetakeCategory] = useState("");
  const [dailyRetakeSourceId, setDailyRetakeSourceId] = useState("");
  const [dailySourceCategoryDropdownOpen, setDailySourceCategoryDropdownOpen] = useState(false);
  const [dailyConductError, setDailyConductError] = useState("");
  const [dailySetDropdownOpen, setDailySetDropdownOpen] = useState(false);
  const [activeDailyTimePicker, setActiveDailyTimePicker] = useState("");

  // Session editing
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSessionMsg, setEditingSessionMsg] = useState("");
  const [editingSessionForm, setEditingSessionForm] = useState({
    id: "",
    problem_set_id: "",
    title: "",
    session_category: "",
    starts_at_date: "",
    starts_at_time: "",
    ends_at_date: "",
    ends_at_time: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: true,
    pass_rate: ""
  });
  const [editingTestId, setEditingTestId] = useState("");
  const [editingTestMsg, setEditingTestMsg] = useState("");
  const [editingCategorySelect, setEditingCategorySelect] = useState(CUSTOM_CATEGORY_OPTION);
  const [editingTestForm, setEditingTestForm] = useState({
    id: "",
    originalVersion: "",
    version: "",
    title: "",
    pass_rate: "",
    is_public: true,
    type: ""
  });

  // Model test session form
  const [testSessionForm, setTestSessionForm] = useState({
    problem_set_id: "",
    title: "",
    session_date: "",
    start_time: "",
    close_time: "",
    close_time_auto_filled: false,
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
    title_auto_generated: true,
    session_date: "",
    start_time: "",
    close_time: "",
    close_time_auto_filled: false,
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
  const [assets, setAssets] = useState(externalAssets ?? []);
  const [assetsLoaded, setAssetsLoaded] = useState(Boolean(externalAssetsLoaded));
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
  const [dailyCategorySelect, setDailyCategorySelect] = useState(CUSTOM_CATEGORY_OPTION);

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
  const [modelSessionCategory, setModelSessionCategory] = useState("");
  const [dailySessionCategory, setDailySessionCategory] = useState("");
  const [dailyResultsCategory, setDailyResultsCategory] = useState("");
  const [modelResultsCategory, setModelResultsCategory] = useState("");

  // Results display state
  const [expandedResultCells, setExpandedResultCells] = useState({});
  const [dailyManualEntryMode, setDailyManualEntryMode] = useState(false);
  const [dailyManualEntryModal, setDailyManualEntryModal] = useState({
    open: false,
    studentId: "",
    sessionId: "",
    rateInput: "",
    hasImportedAttempt: false,
    importedAttemptId: "",
    saving: false,
    msg: "",
  });
  const [dailyManualColumnModal, setDailyManualColumnModal] = useState({
    open: false,
    testVersion: "",
    title: "",
    sessionDate: "",
    rows: [],
    saving: false,
    msg: "",
  });

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

  // ============================================================================
  // Data enrichment & processing callbacks
  // ============================================================================

  const fetchQuestionCounts = useCallback(async (versions) => {
    if (!Array.isArray(versions) || versions.length === 0) return {};
    const { data, error } = await supabase
      .from("questions")
      .select("test_version")
      .in("test_version", versions);
    if (error) {
      console.error("question count fetch error:", error);
      return {};
    }
    const counts = {};
    for (const row of data ?? []) {
      if (!row?.test_version) continue;
      counts[row.test_version] = (counts[row.test_version] ?? 0) + 1;
    }
    return counts;
  }, [supabase]);

  const mergeRegisteredTestsIntoState = useCallback((versions, { title, type, questionCountsByVersion = {} }) => {
    const normalizedVersions = Array.from(new Set((versions ?? []).map((value) => String(value ?? "").trim()).filter(Boolean)));
    if (!normalizedVersions.length) return;
    const normalizedTitle = String(title ?? "").trim();
    const normalizedType = String(type ?? "").trim();
    const nowIso = new Date().toISOString();

    setTests((current) => {
      const existingList = Array.isArray(current) ? current : [];
      const byVersion = new Map(existingList.map((test) => [String(test.version ?? "").trim(), test]));

      normalizedVersions.forEach((version) => {
        const existing = byVersion.get(version);
        byVersion.set(version, {
          ...(existing ?? {}),
          id: existing?.id ?? `local-${normalizedType || "test"}-${version}`,
          version,
          title: normalizedTitle || existing?.title || version,
          type: normalizedType || existing?.type || "mock",
          is_public: true,
          school_id: existing?.school_id ?? activeSchoolId ?? null,
          question_count: Number.isFinite(questionCountsByVersion?.[version])
            ? questionCountsByVersion[version]
            : (existing?.question_count ?? 0),
          created_at: existing?.created_at ?? nowIso,
          updated_at: nowIso,
        });
      });

      return Array.from(byVersion.values()).sort((left, right) => {
        const leftUpdated = String(left?.updated_at ?? "");
        const rightUpdated = String(right?.updated_at ?? "");
        if (leftUpdated !== rightUpdated) return rightUpdated.localeCompare(leftUpdated);
        return String(right?.created_at ?? "").localeCompare(String(left?.created_at ?? ""));
      });
    });
  }, [activeSchoolId]);

  const seedModelCategory = useCallback(async (list) => {
    if (modelCategorySeededRef.current) return list;
    const mockTests = (list ?? []).filter((t) => t.type === "mock");
    if (!mockTests.length) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const shouldSeed = mockTests.every((t) => !String(t.title ?? "").trim());
    if (!shouldSeed) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const ids = mockTests.map((t) => t.id).filter(Boolean);
    if (!ids.length) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const { error } = await supabase
      .from("tests")
      .update({ title: DEFAULT_MODEL_CATEGORY, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      console.error("model category seed error:", error);
      modelCategorySeededRef.current = true;
      return list;
    }
    modelCategorySeededRef.current = true;
    return list.map((t) => (t.type === "mock" ? { ...t, title: DEFAULT_MODEL_CATEGORY } : t));
  }, [supabase]);

  const attachGeneratedDailySourceSetIds = useCallback(async (list) => {
    const generatedVersions = (list ?? [])
      .filter((test) => test.type === "daily" && isGeneratedDailySessionVersion(test.version))
      .map((test) => test.version)
      .filter(Boolean);
    if (!generatedVersions.length) return list;

    const { data, error } = await supabase
      .from("questions")
      .select("test_version, order_index, data")
      .in("test_version", generatedVersions)
      .order("test_version", { ascending: true })
      .order("order_index", { ascending: true });

    if (error) {
      console.error("generated daily source lookup error:", error);
      return list;
    }

    const sourceMap = {};
    (data ?? []).forEach((row) => {
      const sourceVersion = String(row.data?.sourceVersion ?? "").trim();
      if (!sourceVersion) return;
      if (!Array.isArray(sourceMap[row.test_version])) {
        sourceMap[row.test_version] = [];
      }
      if (!sourceMap[row.test_version].includes(sourceVersion)) {
        sourceMap[row.test_version].push(sourceVersion);
      }
    });

    return (list ?? []).map((test) => (
      sourceMap[test.version]?.length
        ? { ...test, source_set_ids: sourceMap[test.version] }
        : test
    ));
  }, [supabase]);

  // ========================================================================
  // useMemo declarations (25+ memos)
  // ========================================================================

  const buildCategories = (list, fallbackLabel = "Uncategorized", sortMode = "created_at") => {
    const map = new Map();
    (list ?? []).forEach((t) => {
      const name = String(t.title ?? "").trim() || fallbackLabel;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(t);
    });
    const categories = Array.from(map.entries()).map(([name, items]) => {
      const ordered = [...items].sort((a, b) => {
        if (sortMode === "version") {
          const versionCompare = compareSetIds(a.version, b.version);
          if (versionCompare !== 0) return versionCompare;
        }
        const createdAtCompare = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
        if (createdAtCompare !== 0) return createdAtCompare;
        return compareSetIds(a.version, b.version);
      });
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

  // All sessions (including imported result sessions) - for results view
  const allModelSessions = useMemo(
    () => testSessions.filter((s) => modelTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, modelTests]
  );

  const allDailySessions = useMemo(
    () => testSessions.filter((s) => dailyTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, dailyTests]
  );

  // Admin-created sessions only (is_published = true) - for session management table
  const modelSessions = useMemo(
    () => allModelSessions.filter((s) => s.is_published !== false),
    [allModelSessions]
  );

  const dailySessions = useMemo(
    () => allDailySessions.filter((s) => s.is_published !== false),
    [allDailySessions]
  );

  // Tests used in at least one session (exclude bare imported tests from session creation UI)
  const modelTestsInSessions = useMemo(() => {
    const usedVersions = new Set(modelSessions.map((s) => s.problem_set_id).filter(Boolean));
    return modelTests.filter((t) => usedVersions.has(t.version));
  }, [modelTests, modelSessions]);

  const dailyQuestionSetsInSessions = useMemo(() => {
    const usedVersions = new Set(dailySessions.map((s) => s.problem_set_id).filter(Boolean));
    return dailyQuestionSets.filter((t) => usedVersions.has(t.version));
  }, [dailyQuestionSets, dailySessions]
  );

  const linkBySession = useMemo(() => {
    const map = {};
    for (const link of examLinks) {
      const sid = link.test_session_id;
      if (!sid) continue;
      const prev = map[sid];
      if (!prev) {
        map[sid] = link;
        continue;
      }
      const prevTime = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const curTime = link.created_at ? new Date(link.created_at).getTime() : 0;
      if (curTime >= prevTime) map[sid] = link;
    }
    return map;
  }, [examLinks]);

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
    const grouped = new Map();
    dailyRetakeSessions.forEach((session) => {
      const category = String(session.session_category ?? "").trim()
        || String(dailyTests.find((test) => test.version === session.problem_set_id)?.title ?? "").trim()
        || "Uncategorized";
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

  const previewSectionBreaks = useMemo(() => {
    if (!isModelPreview) return [];
    let previousSectionTitle = "";
    return previewDisplayQuestions.map((question, index) => {
      const sectionTitle = getSectionTitle(question.sectionKey) || "Unknown";
      const showHeader = index === 0 || sectionTitle !== previousSectionTitle;
      previousSectionTitle = sectionTitle;
      return {
        question,
        index,
        sectionTitle,
        showHeader,
      };
    });
  }, [isModelPreview, previewDisplayQuestions]);

  const previewSectionTitles = useMemo(
    () => previewSectionBreaks.filter((item) => item.showHeader).map((item) => item.sectionTitle),
    [previewSectionBreaks]
  );

  const testMetaByVersion = useMemo(() => {
    const map = {};
    tests.forEach((test) => {
      map[test.version] = {
        title: test.title || test.version,
        category: String(test.title ?? "").trim() || DEFAULT_MODEL_CATEGORY,
        type: test.type,
        pass_rate: normalizePassRate(test.pass_rate),
      };
    });
    return map;
  }, [tests]);

  const getDailySessionCategoryName = useCallback((session) => {
    const explicit = String(session?.session_category ?? "").trim();
    if (explicit) return explicit;
    const fallback = String(testMetaByVersion[session?.problem_set_id]?.category ?? "").trim();
    return fallback || "Uncategorized";
  }, [testMetaByVersion]);

  const buildDailySessionCategoryGroups = useCallback((sessions) => {
    const grouped = new Map();
    (sessions ?? []).forEach((session) => {
      if (!session?.id) return;
      const category = getDailySessionCategoryName(session);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(session);
    });
    return Array.from(grouped.entries())
      .map(([name, sessionList]) => ({
        name,
        sessions: [...sessionList].sort((left, right) => {
          const timeCompare = getSessionSortTime(right) - getSessionSortTime(left);
          if (timeCompare !== 0) return timeCompare;
          return compareSetIds(left.problem_set_id, right.problem_set_id);
        }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [getDailySessionCategoryName]);

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
    if (!selectedDailySourceCategoryNames.length) return [];
    const selectedSet = new Set(selectedDailySourceCategoryNames);
    const byCategory = new Map();
    dailyQuestionSets.forEach((test) => {
      const testCategory = String(test.title ?? "").trim() || "Uncategorized";
      if (!selectedSet.has(testCategory)) return;
      if (!byCategory.has(testCategory)) byCategory.set(testCategory, []);
      byCategory.get(testCategory).push(test);
    });
    return selectedDailySourceCategoryNames.flatMap((categoryName) => (
      [...(byCategory.get(categoryName) ?? [])].sort((left, right) => compareSetIds(left.version, right.version))
    ));
  }, [dailyQuestionSets, selectedDailySourceCategoryNames]);

  // For single mode, get tests for the currently selected category
  const dailySingleModeTests = useMemo(() => {
    if (dailySessionForm.selection_mode !== "single" || !dailyConductCategory) {
      return [];
    }
    return dailyQuestionSets
      .filter((test) => (String(test.title ?? "").trim() || "Uncategorized") === dailyConductCategory)
      .sort((left, right) => compareSetIds(left.version, right.version));
  }, [dailyQuestionSets, dailyConductCategory, dailySessionForm.selection_mode]);

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

  const generatedDailySessionTitle = useMemo(() => {
    if (dailyConductMode === "retake" || !selectedDailyProblemSetIds.length) return "";
    const category = String(dailySessionForm.session_category ?? "").trim()
      || dailyConductCategory
      || selectedDailySourceCategoryNames[0]
      || "Daily Test";
    return buildDailySessionTitle({
      category,
      setIds: selectedDailyProblemSetIds,
    });
  }, [
    dailyConductMode,
    dailyConductCategory,
    dailySessionForm.session_category,
    selectedDailyProblemSetIds,
    selectedDailySourceCategoryNames,
  ]);

  const selectLatestQuestionSetVersions = useCallback((list, getKey) => {
    const latestByKey = new Map();
    (list ?? []).forEach((item) => {
      const key = String(getKey?.(item) ?? "").trim();
      if (!key) return;
      const current = latestByKey.get(key);
      if (!current) {
        latestByKey.set(key, item);
        return;
      }

      const currentRank = getQuestionSetVersionRank(current);
      const nextRank = getQuestionSetVersionRank(item);
      if (nextRank !== currentRank) {
        if (nextRank > currentRank) latestByKey.set(key, item);
        return;
      }

      const currentTime = new Date(current.updated_at || current.created_at || 0).getTime();
      const nextTime = new Date(item.updated_at || item.created_at || 0).getTime();
      if (nextTime > currentTime) {
        latestByKey.set(key, item);
      }
    });
    return Array.from(latestByKey.values());
  }, []);

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

  const modelConductCategories = useMemo(() => {
    return buildCategories(modelTestsInSessions, DEFAULT_MODEL_CATEGORY, "version");
  }, [modelTestsInSessions]);

  const dailyConductCategories = useMemo(() => {
    const publishedSessionVersions = new Set(
      dailySessions.map((s) => s.problem_set_id).filter(Boolean)
    );
    // Include tests that either have a published session OR are regular test uploads
    const testsToShow = dailyQuestionSets.filter(
      (t) => publishedSessionVersions.has(t.version) || !t.version.startsWith("daily_session_")
    );
    return buildCategories(testsToShow, "Uncategorized", "version");
  }, [dailyQuestionSets, dailySessions]);

  const filteredModelUploadTests = useMemo(() => {
    const latestTests = selectLatestQuestionSetVersions(modelTests, (item) => item.version)
      .filter((test) => !isImportedModelResultsTestVersion(test.version));
    if (!modelUploadCategory) return latestTests;
    return latestTests.filter((t) => String(t.title ?? "").trim() === modelUploadCategory);
  }, [modelTests, modelUploadCategory, selectLatestQuestionSetVersions]);

  const groupedModelUploadTests = useMemo(
    () => buildCategories(filteredModelUploadTests, DEFAULT_MODEL_CATEGORY, "version"),
    [filteredModelUploadTests],
  );

  const filteredDailyUploadTests = useMemo(() => {
    if (!dailyUploadCategory) return dailyQuestionSets;
    return dailyQuestionSets.filter((t) => String(t.title ?? "").trim() === dailyUploadCategory);
  }, [dailyQuestionSets, dailyUploadCategory]);

  const groupedDailyUploadTests = useMemo(
    () => buildCategories(filteredDailyUploadTests, "Uncategorized", "version"),
    [filteredDailyUploadTests],
  );

  const dailyResultCategories = useMemo(() => buildDailySessionCategoryGroups(allDailySessions), [buildDailySessionCategoryGroups, allDailySessions]);

  const modelResultCategories = useMemo(() => {
    const resultVersions = new Set(
      (attempts ?? [])
        .filter((attempt) => {
          const meta = testMetaByVersion[attempt?.test_version];
          return meta?.type === "mock";
        })
        .map((attempt) => attempt?.test_version)
        .filter(Boolean)
    );
    return buildCategories((modelTests ?? []).filter((test) => resultVersions.has(test.version)), DEFAULT_MODEL_CATEGORY);
  }, [attempts, modelTests, testMetaByVersion]);

  const modelTestsWithResults = useMemo(() => {
    const resultVersions = new Set(
      (attempts ?? [])
        .filter((attempt) => testMetaByVersion[attempt?.test_version]?.type === "mock")
        .map((attempt) => attempt?.test_version)
        .filter(Boolean)
    );
    return modelTests.filter((test) => resultVersions.has(test.version));
  }, [attempts, modelTests, testMetaByVersion]);

  const dailySessionCategories = useMemo(() => buildDailySessionCategoryGroups(dailySessions), [buildDailySessionCategoryGroups, dailySessions]);

  const dailySessionCategorySelectValue = useMemo(() => {
    if (!dailySessionCategories.length) return CUSTOM_CATEGORY_OPTION;
    return dailySessionCategories.some((category) => category.name === dailySessionForm.session_category)
      ? dailySessionForm.session_category
      : CUSTOM_CATEGORY_OPTION;
  }, [dailySessionCategories, dailySessionForm.session_category]);

  const selectedModelSessionCategory = useMemo(() => {
    if (!modelConductCategories.length) return null;
    return modelConductCategories.find((category) => category.name === modelSessionCategory) ?? modelConductCategories[0];
  }, [modelConductCategories, modelSessionCategory]);

  const filteredModelSessions = useMemo(() => {
    const list = !selectedModelSessionCategory
      ? modelSessions
      : modelSessions.filter((session) => {
      const category = String(testMetaByVersion[session.problem_set_id]?.category ?? "").trim() || DEFAULT_MODEL_CATEGORY;
      return category === selectedModelSessionCategory.name;
    });
    return [...list].sort((left, right) => {
      const timeCompare = getSessionSortTime(right) - getSessionSortTime(left);
      if (timeCompare !== 0) return timeCompare;
      return compareSetIds(left.problem_set_id, right.problem_set_id);
    });
  }, [modelSessions, selectedModelSessionCategory, testMetaByVersion]);

  const selectedDailySessionCategory = useMemo(() => {
    if (!dailySessionCategories.length) return null;
    return dailySessionCategories.find((category) => category.name === dailySessionCategory) ?? dailySessionCategories[0];
  }, [dailySessionCategories, dailySessionCategory]);

  const filteredDailySessions = useMemo(() => {
    const list = !selectedDailySessionCategory
      ? dailySessions
      : dailySessions.filter((session) => {
      const category = getDailySessionCategoryName(session);
      return category === selectedDailySessionCategory.name;
    });
    return [...list].sort((left, right) => {
      const timeCompare = getSessionSortTime(right) - getSessionSortTime(left);
      if (timeCompare !== 0) return timeCompare;
      return compareSetIds(left.problem_set_id, right.problem_set_id);
    });
  }, [dailySessions, selectedDailySessionCategory, getDailySessionCategoryName]);

  useEffect(() => {
    if (!modelConductCategories.length) {
      if (modelSessionCategory) setModelSessionCategory("");
      return;
    }
    if (!modelSessionCategory || !modelConductCategories.some((category) => category.name === modelSessionCategory)) {
      setModelSessionCategory(modelConductCategories[0].name);
    }
  }, [modelConductCategories, modelSessionCategory]);

  useEffect(() => {
    if (!dailySessionCategories.length) {
      if (dailySessionCategory) setDailySessionCategory("");
      return;
    }
    if (!dailySessionCategory || !dailySessionCategories.some((category) => category.name === dailySessionCategory)) {
      setDailySessionCategory(dailySessionCategories[0].name);
    }
  }, [dailySessionCategories, dailySessionCategory]);

  const selectedDailyCategory = useMemo(() => {
    if (!dailyResultCategories.length) return null;
    return dailyResultCategories.find((c) => c.name === dailyResultsCategory) ?? dailyResultCategories[0];
  }, [dailyResultCategories, dailyResultsCategory]);

  const selectedModelCategory = useMemo(() => {
    if (!modelResultCategories.length || !modelResultsCategory) return null;
    return modelResultCategories.find((c) => c.name === modelResultsCategory) ?? null;
  }, [modelResultCategories, modelResultsCategory]);

  const selectedModelConductCategory = useMemo(() => {
    if (!modelConductCategories.length || !modelConductCategory) return null;
    return modelConductCategories.find((c) => c.name === modelConductCategory) ?? null;
  }, [modelConductCategories, modelConductCategory]);

  const modelConductTests = selectedModelConductCategory?.tests ?? [];

  const buildSessionResultsMatrix = useCallback((selectedCategory) => {
    const testsForCategory = selectedCategory?.tests ?? [];
    const sessionsForCategory = selectedCategory?.sessions ?? [];
    if (!testsForCategory.length && !sessionsForCategory.length) return { sessions: [], rows: [] };

    const testByVersion = new Map(testsForCategory.map((test) => [test.version, test]));
    const categorySessions = sessionsForCategory.length
      ? sessionsForCategory.map((session) => ({
        ...session,
        linkedTest: testByVersion.get(session.problem_set_id) ?? testMetaByVersion[session.problem_set_id] ?? null,
      }))
      : (testSessions ?? [])
        .filter((session) => testByVersion.has(session.problem_set_id))
        .map((session) => ({
          ...session,
          linkedTest: testByVersion.get(session.problem_set_id) ?? null,
        }));

    if (!categorySessions.length) return { sessions: [], rows: [] };

    const sessionById = new Map(categorySessions.map((session) => [session.id, session]));
    const originalSessionById = new Map(
      categorySessions
        .filter((session) => !isRetakeSessionTitle(session.title))
        .map((session) => [session.id, session])
    );
    const originalSessionByKey = new Map(
      categorySessions
        .filter((session) => !isRetakeSessionTitle(session.title))
        .map((session) => [`${session.problem_set_id}::${String(session.title ?? "").trim()}`, session])
    );

    const getCanonicalSession = (session) => {
      if (!session || !isRetakeSessionTitle(session.title)) return session;
      if (session.retake_source_session_id && originalSessionById.has(session.retake_source_session_id)) {
        return originalSessionById.get(session.retake_source_session_id);
      }
      return originalSessionByKey.get(`${session.problem_set_id}::${getRetakeBaseTitle(session.title)}`) ?? session;
    };

    const byStudent = new Map();
    const canonicalSessionIdsWithAttempts = new Set();
    const importedSessionOrderById = new Map();
    (attempts ?? []).forEach((attempt) => {
      if (!attempt?.student_id || !attempt?.test_session_id) return;
      const sourceSession = sessionById.get(attempt.test_session_id);
      if (!sourceSession) return;
      const canonicalSession = getCanonicalSession(sourceSession);
      if (!canonicalSession?.id) return;
      const importedCsvOrderIndex = getImportedCsvOrderIndex(attempt);
      if (importedCsvOrderIndex != null && !importedSessionOrderById.has(canonicalSession.id)) {
        importedSessionOrderById.set(canonicalSession.id, importedCsvOrderIndex);
      }
      canonicalSessionIdsWithAttempts.add(canonicalSession.id);
      const perStudent = byStudent.get(attempt.student_id) ?? new Map();
      const perSession = perStudent.get(canonicalSession.id) ?? [];
      perSession.push({
        ...attempt,
        __isRetake: isRetakeSessionTitle(sourceSession.title),
        __sourceSessionId: sourceSession.id,
      });
      perStudent.set(canonicalSession.id, perSession);
      byStudent.set(attempt.student_id, perStudent);
    });

    const sessionList = categorySessions
      .map((session) => getCanonicalSession(session))
      .filter((session, idx, list) => session?.id && list.findIndex((item) => item?.id === session.id) === idx)
      .filter((session) => canonicalSessionIdsWithAttempts.has(session.id))
      .sort((left, right) => {
        const leftTime = new Date(left.starts_at || left.created_at || 0).getTime();
        const rightTime = new Date(right.starts_at || right.created_at || 0).getTime();
        if (leftTime !== rightTime) return rightTime - leftTime;
        const leftImportedOrder = importedSessionOrderById.get(left.id);
        const rightImportedOrder = importedSessionOrderById.get(right.id);
        if (Number.isFinite(leftImportedOrder) && Number.isFinite(rightImportedOrder) && leftImportedOrder !== rightImportedOrder) {
          return rightImportedOrder - leftImportedOrder;
        }
        return String(left.title ?? left.problem_set_id ?? "").localeCompare(
          String(right.title ?? right.problem_set_id ?? "")
        );
      });

    if (!sessionList.length) return { sessions: [], rows: [] };

    byStudent.forEach((perStudent) => {
      perStudent.forEach((perSession, sessionId) => {
        perStudent.set(
          sessionId,
          perSession.slice().sort((a, b) => {
            if (Boolean(a.__isRetake) !== Boolean(b.__isRetake)) return a.__isRetake ? -1 : 1;
            const aTime = new Date(a.ended_at || a.created_at || 0).getTime();
            const bTime = new Date(b.ended_at || b.created_at || 0).getTime();
            return bTime - aTime;
          })
        );
      });
    });

    const studentList = (Array.isArray(students) ? [...students] : []).sort((a, b) => {
      const getStudentCodeNumber = (student) => {
        const match = String(student?.student_code ?? "").match(/(\d+)/);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
      };
      const leftNumber = getStudentCodeNumber(a);
      const rightNumber = getStudentCodeNumber(b);
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;

      const leftCode = String(a?.student_code ?? "");
      const rightCode = String(b?.student_code ?? "");
      if (leftCode !== rightCode) return leftCode.localeCompare(rightCode);

      const leftName = String(a?.display_name ?? "");
      const rightName = String(b?.display_name ?? "");
      if (leftName !== rightName) return leftName.localeCompare(rightName);

      return String(a?.email ?? "").localeCompare(String(b?.email ?? ""));
    });
    const rows = studentList.map((student, idx) => {
      const perStudent = byStudent.get(student.id) ?? new Map();
      const cells = sessionList.map((session) => perStudent.get(session.id) ?? []);
      return { index: idx + 1, student, cells };
    });

    return { sessions: sessionList, rows };
  }, [attempts, students, testSessions, testMetaByVersion]);

  const dailyResultsMatrix = useMemo(
    () => buildSessionResultsMatrix(selectedDailyCategory),
    [buildSessionResultsMatrix, selectedDailyCategory]
  );

  const modelResultsMatrix = useMemo(
    () => buildSessionResultsMatrix(selectedModelCategory ?? { tests: modelTestsWithResults }),
    [buildSessionResultsMatrix, modelTestsWithResults, selectedModelCategory]
  );

  const buildSessionHeaderAverageMap = useCallback((matrix) => {
    const sessions = Array.isArray(matrix?.sessions) ? matrix.sessions : [];
    const rows = Array.isArray(matrix?.rows) ? matrix.rows : [];
    return Object.fromEntries(
      sessions.map((session, index) => {
        const visibleAttempts = rows
          .filter((row) => !isAnalyticsExcludedStudent(row?.student))
          .map((row) => row?.cells?.[index]?.[0] ?? null)
          .filter(Boolean);
        const averageRate = visibleAttempts.length
          ? visibleAttempts.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / visibleAttempts.length
          : 0;
        return [session.id, { averageRate }];
      })
    );
  }, [isAnalyticsExcludedStudent, getScoreRate]);

  const dailyResultsSessionHeaderAverages = useMemo(
    () => buildSessionHeaderAverageMap(dailyResultsMatrix),
    [buildSessionHeaderAverageMap, dailyResultsMatrix]
  );

  const modelResultsSessionHeaderAverages = useMemo(
    () => buildSessionHeaderAverageMap(modelResultsMatrix),
    [buildSessionHeaderAverageMap, modelResultsMatrix]
  );

  const dailyResultsSessionDetailAvailability = useMemo(
    () => buildSessionDetailAvailability(dailyResultsMatrix),
    [dailyResultsMatrix]
  );

  const modelResultsSessionDetailAvailability = useMemo(
    () => buildSessionDetailAvailability(modelResultsMatrix),
    [modelResultsMatrix]
  );

  const dailyManualEntryStudent = useMemo(
    () => students.find((student) => student.id === dailyManualEntryModal.studentId) ?? null,
    [dailyManualEntryModal.studentId, students]
  );

  const dailyManualEntrySession = useMemo(
    () => dailyResultsMatrix.sessions.find((session) => session.id === dailyManualEntryModal.sessionId) ?? null,
    [dailyManualEntryModal.sessionId, dailyResultsMatrix.sessions]
  );

  const closeDailyManualEntryModal = useCallback((force = false) => {
    setDailyManualEntryModal((current) => (current?.saving && !force ? current : {
      open: false,
      studentId: "",
      sessionId: "",
      rateInput: "",
      hasImportedAttempt: false,
      importedAttemptId: "",
      saving: false,
      msg: "",
    }));
  }, []);

  const openDailyManualEntryModal = useCallback((student, session, attemptList = []) => {
    if (!student?.id || !session?.id) return;
    const importedAttempt = (attemptList ?? []).find((attempt) => isImportedSummaryAttempt(attempt)) ?? null;
    setDailyManualEntryModal({
      open: true,
      studentId: student.id,
      sessionId: session.id,
      rateInput: importedAttempt ? formatPercentInputValue(getScoreRate(importedAttempt)) : "",
      hasImportedAttempt: Boolean(importedAttempt?.id),
      importedAttemptId: importedAttempt?.id ?? "",
      saving: false,
      msg: "",
    });
  }, [getScoreRate]);

  const saveDailyManualEntry = useCallback(async () => {
    if (!supabase) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Supabase not initialized." }));
      return;
    }
    const student = students.find((item) => item.id === dailyManualEntryModal.studentId) ?? null;
    const session = dailyResultsMatrix.sessions.find((item) => item.id === dailyManualEntryModal.sessionId) ?? null;
    if (!student || !session) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Student or test session was not found." }));
      return;
    }

    const rate = parsePercentCell(dailyManualEntryModal.rateInput);
    if (rate == null || rate < 0 || rate > 1) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Enter a score between 0 and 100." }));
      return;
    }

    const payload = {
      student_id: student.id,
      display_name: student.display_name ?? null,
      student_code: student.student_code ?? null,
      test_version: session.problem_set_id,
      test_session_id: session.id,
      correct: 0,
      total: 0,
      score_rate: rate,
      started_at: session.starts_at ?? null,
      ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
      answers_json: buildImportedSummaryAnswersJson("daily_results_csv", {
        imported_test_title: session.title ?? session.problem_set_id ?? "",
        imported_test_date: extractIsoDatePart(session.starts_at || session.created_at) || null,
        imported_rate: rate,
        imported_entry_mode: "manual",
      }),
      tab_left_count: 0,
    };

    setDailyManualEntryModal((current) => ({ ...current, saving: true, msg: "" }));
    const removeResult = await removeImportedSummaryAttemptsForPair(supabase, student.id, session.id);
    if (!removeResult.ok) {
      setDailyManualEntryModal((current) => ({
        ...current,
        saving: false,
        msg: removeResult.message || "Failed to clear the existing manual result.",
      }));
      return;
    }

    const insertResult = await insertImportedSummaryAttempts(supabase, [payload]);
    if (!insertResult.ok) {
      setDailyManualEntryModal((current) => ({
        ...current,
        saving: false,
        msg: insertResult.message || "Failed to save manual result.",
      }));
      return;
    }

    await fetchAttempts();
    await fetchTestSessions();
    await recordAuditEvent({
      actionType: dailyManualEntryModal.hasImportedAttempt ? "update" : "create",
      entityType: "daily_results",
      entityId: `${session.id}:${student.id}`,
      summary: `${dailyManualEntryModal.hasImportedAttempt ? "Updated" : "Saved"} manual daily result for ${student.display_name ?? student.id}.`,
      metadata: {
        source: "manual",
        session_id: session.id,
        student_id: student.id,
        rate,
      },
    });
    closeDailyManualEntryModal(true);
    setQuizMsg(`Saved manual result for ${student.display_name ?? student.id} in ${session.title ?? session.problem_set_id}.`);
  }, [closeDailyManualEntryModal, dailyManualEntryModal, dailyResultsMatrix.sessions, recordAuditEvent, setQuizMsg, students, supabase]);

  const clearDailyManualEntry = useCallback(async () => {
    if (!supabase) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Supabase not initialized." }));
      return;
    }
    const student = students.find((item) => item.id === dailyManualEntryModal.studentId) ?? null;
    const session = dailyResultsMatrix.sessions.find((item) => item.id === dailyManualEntryModal.sessionId) ?? null;
    if (!student || !session) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Student or test session was not found." }));
      return;
    }
    setDailyManualEntryModal((current) => ({ ...current, saving: true, msg: "" }));
    const result = await removeImportedSummaryAttemptsForPair(supabase, student.id, session.id);
    if (!result.ok) {
      setDailyManualEntryModal((current) => ({
        ...current,
        saving: false,
        msg: result.message || "Failed to clear manual result.",
      }));
      return;
    }
    await fetchAttempts();
    await fetchTestSessions();
    await recordAuditEvent({
      actionType: "delete",
      entityType: "daily_results",
      entityId: `${session.id}:${student.id}`,
      summary: `Cleared manual daily result for ${student.display_name ?? student.id}.`,
      metadata: {
        source: "manual",
        session_id: session.id,
        student_id: student.id,
      },
    });
    closeDailyManualEntryModal(true);
    setQuizMsg(`Cleared manual result for ${student.display_name ?? student.id} in ${session.title ?? session.problem_set_id}.`);
  }, [closeDailyManualEntryModal, dailyManualEntryModal, dailyResultsMatrix.sessions, recordAuditEvent, setQuizMsg, students, supabase]);

  const closeDailyManualColumnModal = useCallback((force = false) => {
    setDailyManualColumnModal((current) => (current?.saving && !force ? current : {
      open: false,
      testVersion: "",
      title: "",
      sessionDate: "",
      rows: [],
      saving: false,
      msg: "",
    }));
  }, []);

  const openDailyManualColumnModal = useCallback(() => {
    const defaultTestVersion = String(selectedDailyCategory?.sessions?.[0]?.problem_set_id ?? "").trim();
    const rows = (dailyResultsMatrix.rows ?? [])
      .filter((row) => !row?.student?.is_withdrawn)
      .map((row) => ({
        studentId: row.student.id,
        displayName: row.student.display_name ?? row.student.email ?? row.student.id,
        studentCode: row.student.student_code ?? "",
        rateInput: "",
      }));
    setDailyManualColumnModal({
      open: true,
      testVersion: defaultTestVersion,
      title: "",
      sessionDate: new Date().toISOString().slice(0, 10),
      rows,
      saving: false,
      msg: "",
    });
  }, [dailyResultsMatrix.rows, selectedDailyCategory]);

  const updateDailyManualColumnRateInput = useCallback((studentId, value) => {
    setDailyManualColumnModal((current) => ({
      ...current,
      rows: (current.rows ?? []).map((row) => (
        row.studentId === studentId
          ? { ...row, rateInput: value, msg: "" }
          : row
      )),
      msg: "",
    }));
  }, []);

  const saveDailyManualColumn = useCallback(async () => {
    if (!supabase) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "Supabase not initialized." }));
      return;
    }
    if (!activeSchoolId) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "School context is required." }));
      return;
    }
    const testVersion = String(dailyManualColumnModal.testVersion ?? "").trim();
    const title = String(dailyManualColumnModal.title ?? "").trim();
    const sessionDate = String(dailyManualColumnModal.sessionDate ?? "").trim();
    if (!testVersion) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "SetID is required." }));
      return;
    }
    if (!title) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "Test Title is required." }));
      return;
    }
    if (!sessionDate) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "Date is required." }));
      return;
    }
    const startedAt = toManualSessionIso(sessionDate);
    if (!startedAt) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "Enter a valid date." }));
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title)) {
        setDailyManualColumnModal((current) => ({ ...current, msg: "That Test Title already exists." }));
        return;
      }
    } catch (error) {
      setDailyManualColumnModal((current) => ({ ...current, msg: `Check failed: ${error.message}` }));
      return;
    }

    const validRows = (dailyManualColumnModal.rows ?? [])
      .map((row) => ({
        ...row,
        rate: parsePercentCell(row.rateInput),
      }))
      .filter((row) => row.rate != null);
    if (!validRows.length) {
      setDailyManualColumnModal((current) => ({ ...current, msg: "Enter at least one score to save the column." }));
      return;
    }

    const firstSession = selectedDailyCategory?.sessions?.[0] ?? null;
    const passRate = Number(testMetaByVersion[firstSession?.problem_set_id]?.pass_rate ?? firstSession?.pass_rate ?? 0.8);
    const sessionPayload = {
      school_id: activeSchoolId,
      problem_set_id: testVersion,
      title,
      session_category: String(selectedDailyCategory?.name ?? "").trim() || "Uncategorized",
      starts_at: startedAt,
      ends_at: startedAt,
      time_limit_min: null,
      is_published: true,
      show_answers: false,
      allow_multiple_attempts: false,
      pass_rate: Number.isFinite(passRate) && passRate > 0 && passRate <= 1 ? passRate : 0.8,
      retake_source_session_id: null,
      retake_release_scope: "all",
    };

    setDailyManualColumnModal((current) => ({ ...current, saving: true, msg: "" }));
    const { data: created, error } = await supabase.from("test_sessions").insert(sessionPayload).select().single();
    if (error || !created?.id) {
      setDailyManualColumnModal((current) => ({
        ...current,
        saving: false,
        msg: error?.message || "Failed to create test session.",
      }));
      return;
    }

    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: testVersion,
      expires_at: startedAt,
    });
    if (linkError) {
      await supabase.from("test_sessions").delete().eq("id", created.id);
      setDailyManualColumnModal((current) => ({
        ...current,
        saving: false,
        msg: `Session created but link failed: ${linkError.message}`,
      }));
      return;
    }

    const payloads = validRows.map((row) => ({
      student_id: row.studentId,
      display_name: row.displayName ?? null,
      student_code: row.studentCode ?? null,
      test_version: testVersion,
      test_session_id: created.id,
      correct: 0,
      total: 0,
      score_rate: row.rate,
      started_at: startedAt,
      ended_at: startedAt,
      answers_json: buildImportedSummaryAnswersJson("daily_results_csv", {
        imported_test_title: title,
        imported_test_date: sessionDate,
        imported_rate: row.rate,
        imported_entry_mode: "manual_column",
      }),
      tab_left_count: 0,
    }));
    const insertResult = await insertImportedSummaryAttempts(supabase, payloads);
    if (!insertResult.ok) {
      await supabase.from("attempts").delete().eq("test_session_id", created.id);
      await supabase.from("exam_links").delete().eq("test_session_id", created.id);
      await supabase.from("test_sessions").delete().eq("id", created.id);
      setDailyManualColumnModal((current) => ({
        ...current,
        saving: false,
        msg: insertResult.message || "Failed to save the manual column.",
      }));
      return;
    }

    await fetchTestSessions();
    await fetchAttempts();
    setDailyResultsCategory(selectedDailyCategory?.name ?? dailyResultsCategory);
    await recordAuditEvent({
      actionType: "create_session",
      entityType: "test_session",
      entityId: created.id,
      summary: `Created manual daily results column "${title}".`,
      metadata: {
        test_type: "daily",
        title,
        problem_set_id: testVersion,
        session_category: sessionPayload.session_category,
        starts_at: startedAt,
        manual_entry: true,
      },
    });
    closeDailyManualColumnModal(true);
    setQuizMsg(`Saved manual daily results column "${title}".`);
  }, [
    activeSchoolId,
    closeDailyManualColumnModal,
    dailyManualColumnModal.rows,
    dailyManualColumnModal.sessionDate,
    dailyManualColumnModal.testVersion,
    dailyManualColumnModal.title,
    dailyResultsCategory,
    recordAuditEvent,
    selectedDailyCategory,
    setDailyResultsCategory,
    setQuizMsg,
    testMetaByVersion,
    supabase,
  ]);

  const exportDailyGoogleSheetsCsv = useCallback(() => {
    try {
      setQuizMsg("");
      const sessions = dailyResultsMatrix.sessions ?? [];
      const exportSessions = sessions.map((session, sessionIndex) => ({ session, sessionIndex })).reverse();
      const matrixRows = dailyResultsMatrix.rows ?? [];
      if (!exportSessions.length) {
        setQuizMsg("No daily test sessions to export.");
        return;
      }

      const totalColumns = 5 + exportSessions.length;
      const visibleAttemptAt = (row, index) => row?.cells?.[index]?.[0] ?? null;
      const exportRows = [
        padCsvRow(
          ["", "No.", "Student Name", "Section", "Withdrawn", ...exportSessions.map(({ session }) => session.title ?? session.problem_set_id ?? "")],
          totalColumns
        ),
        padCsvRow(
          ["", "", "", "", "", ...exportSessions.map(({ session }) => formatSlashDateShortYear(session.starts_at || session.created_at))],
          totalColumns
        ),
        padCsvRow(
          [
            "",
            "",
            "",
            "",
            "",
            ...exportSessions.map(({ session, sessionIndex }) => {
              const attemptsForSession = matrixRows
                .filter((row) => row?.student && !isAnalyticsExcludedStudent(row.student))
                .map((row) => visibleAttemptAt(row, sessionIndex))
                .filter(Boolean);
              if (!attemptsForSession.length) return "-";
              const averageRate = attemptsForSession.reduce((sum, attempt) => sum + getImportedDailyAttemptRate(attempt), 0) / attemptsForSession.length;
              return formatRatePercent(averageRate);
            }),
          ],
          totalColumns
        ),
      ];

      matrixRows.forEach((row, index) => {
        exportRows.push(
          padCsvRow(
            [
              "",
              index + 1,
              getStudentDisplayName(row.student),
              getStudentSectionValue(row.student),
              formatBooleanCsv(row.student?.is_withdrawn),
              ...exportSessions.map(({ session, sessionIndex }) => {
                const attempt = visibleAttemptAt(row, sessionIndex);
                return attempt ? formatRatePercent(getImportedDailyAttemptRate(attempt)) : "-";
              }),
            ],
            totalColumns
          )
        );
      });

      downloadText(`daily_results_google_sheets_${Date.now()}.csv`, toCsv(exportRows), "text/csv");
    } catch (error) {
      console.error("daily export failed:", error);
      setQuizMsg(`Export failed: ${error?.message || error}`);
    }
  }, [dailyResultsMatrix, formatRatePercent, getScoreRate, isAnalyticsExcludedStudent, setQuizMsg]);

  const exportModelGoogleSheetsCsv = useCallback(async () => {
    try {
      setQuizMsg("");
      const sessions = modelResultsMatrix.sessions ?? [];
      const exportSessions = sessions.map((session, sessionIndex) => ({ session, sessionIndex })).reverse();
      const matrixRows = modelResultsMatrix.rows ?? [];
      if (!exportSessions.length) {
        setQuizMsg("No model test sessions to export.");
        return;
      }

      const versions = Array.from(new Set(exportSessions.map(({ session }) => session.problem_set_id).filter(Boolean)));
      const questionsByVersion = {};
      if (versions.length) {
        const { data, error } = await fetchQuestionsForVersionsWithFallback(supabase, versions);
        if (error) {
          console.error("model export questions fetch error:", error);
          setQuizMsg(`Export failed: ${error.message}`);
          return;
        }
        for (const row of data ?? []) {
          const version = row.test_version;
          if (!version) continue;
          if (!questionsByVersion[version]) questionsByVersion[version] = [];
          questionsByVersion[version].push(mapQuestion(row));
        }
      }

      const visibleAttemptAt = (row, index) => row?.cells?.[index]?.[0] ?? null;
      const activeMatrixRows = matrixRows.filter((row) => row?.student && !isAnalyticsExcludedStudent(row.student));
      const resolveMainSectionSummary = (attempt, questionsList) => {
        if (!attempt) return [];
        if (isImportedModelResultsSummaryAttempt(attempt)) {
          return getImportedModelSectionSummaries(attempt);
        }
        return buildMainSectionSummaryForExport(buildAttemptDetailRowsFromListForExport(attempt.answers_json, questionsList));
      };

      const sessionBlocks = exportSessions.map(({ session, sessionIndex }) => {
        const title = String(session?.title ?? session?.problem_set_id ?? "").trim() || session?.problem_set_id || "";
        const questionsList = questionsByVersion[session.problem_set_id] ?? [];
        const baseRows = buildAttemptDetailRowsFromListForExport({}, questionsList);
        const baseSummary = buildMainSectionSummaryForExport(baseRows);
        const importedSectionRows = activeMatrixRows
          .map((row) => visibleAttemptAt(row, sessionIndex))
          .filter((attempt) => isImportedModelResultsSummaryAttempt(attempt))
          .flatMap((attempt) => getImportedModelSectionSummaries(attempt));
        const blockSectionTitles = Array.from(new Set([
          ...sections
            .filter((section) => section.key !== "DAILY")
            .map((section) => getSectionTitle(section.key))
            .filter((sectionTitle) => baseSummary.some((row) => row.section === sectionTitle)),
          ...importedSectionRows.map((row) => row.section).filter(Boolean),
        ]));
        const sectionTotals = Object.fromEntries(
          blockSectionTitles.map((sectionTitle) => [
            sectionTitle,
            Math.max(
              Number(baseSummary.find((row) => row.section === sectionTitle)?.total ?? 0),
              ...importedSectionRows
                .filter((row) => row.section === sectionTitle)
                .map((row) => Number(row.total ?? 0)),
              0
            ),
          ])
        );
        const rankingRows = activeMatrixRows
          .map((row) => {
            const attempt = visibleAttemptAt(row, sessionIndex);
            if (!attempt) return null;
            return {
              studentId: row.student.id,
              displayName: getStudentDisplayName(row.student),
              studentCode: row.student.student_code ?? "",
              rate: getScoreRate(attempt),
              correct: Number(attempt.correct ?? 0),
            };
          })
          .filter(Boolean)
          .sort((left, right) => {
            if (right.rate !== left.rate) return right.rate - left.rate;
            if (right.correct !== left.correct) return right.correct - left.correct;
            const nameCompare = left.displayName.localeCompare(right.displayName);
            if (nameCompare !== 0) return nameCompare;
            return String(left.studentCode).localeCompare(String(right.studentCode));
          });
        const rankingByStudentId = Object.fromEntries(
          rankingRows.map((row, index) => [row.studentId, { rank: index + 1, total: rankingRows.length }])
        );
        return {
          title,
          session,
          sessionIndex,
          questionsList,
          sectionTitles: blockSectionTitles,
          sectionTotals,
          rankingByStudentId,
        };
      });

      const totalColumns = 5 + sessionBlocks.reduce(
        (sum, block) => sum + (block.sectionTitles.length * 2) + 3,
        0
      );
      const row1 = ["", "No.", "Student Name", "Section", "Withdrawn"];
      const row2 = ["", "", "", "", ""];
      const row3 = ["", "", "", "", ""];
      const row4 = ["", "", "", "", ""];

      sessionBlocks.forEach((block) => {
        const attemptsForBlock = activeMatrixRows
          .map((row) => visibleAttemptAt(row, block.sessionIndex))
          .filter(Boolean);
        const span = (block.sectionTitles.length * 2) + 3;
        row1.push(block.title, ...Array.from({ length: span - 1 }, () => ""));
        block.sectionTitles.forEach((sectionTitle) => {
          const sectionSummaries = attemptsForBlock
            .map((attempt) => resolveMainSectionSummary(attempt, block.questionsList).find((item) => item.section === sectionTitle) ?? null)
            .filter(Boolean);
          const averageRate = sectionSummaries.length
            ? sectionSummaries.reduce((sum, item) => sum + Number(item.rate ?? 0), 0) / sectionSummaries.length
            : null;
          const averageCorrect = sectionSummaries.length
            ? sectionSummaries.reduce((sum, item) => sum + Number(item.correct ?? 0), 0) / sectionSummaries.length
            : null;
          const sectionTotal = Number(block.sectionTotals[sectionTitle] ?? 0);
          row2.push(sectionTitle, "");
          row3.push(formatSlashDateShortYear(block.session.starts_at || block.session.created_at), "");
          row4.push(
            averageRate == null ? "-" : formatRatePercent(averageRate),
            averageCorrect == null || sectionTotal <= 0 ? "-" : formatScoreFraction(averageCorrect, sectionTotal, 2)
          );
        });
        const averageTotalRate = attemptsForBlock.length
          ? attemptsForBlock.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / attemptsForBlock.length
          : null;
        const averageTotalCorrect = attemptsForBlock.length
          ? attemptsForBlock.reduce((sum, attempt) => sum + Number(attempt.correct ?? 0), 0) / attemptsForBlock.length
          : null;
        const totalQuestionCount = Math.max(
          Number(block.questionsList?.length ?? 0),
          ...attemptsForBlock.map((attempt) => Number(attempt?.total ?? 0)),
          0
        );
        row2.push("Total", "", "Ranking");
        row3.push(formatSlashDateShortYear(block.session.starts_at || block.session.created_at), "", "");
        row4.push(
          averageTotalRate == null ? "-" : formatRatePercent(averageTotalRate),
          averageTotalCorrect == null || totalQuestionCount <= 0 ? "-" : formatScoreFraction(averageTotalCorrect, totalQuestionCount, 2),
          ""
        );
      });

      const exportRows = [
        padCsvRow(row1, totalColumns),
        padCsvRow(row2, totalColumns),
        padCsvRow(row3, totalColumns),
        padCsvRow(row4, totalColumns),
      ];

      matrixRows.forEach((row, index) => {
        const dataRow = [
          "",
          index + 1,
          getStudentDisplayName(row.student),
          getStudentSectionValue(row.student),
          formatBooleanCsv(row.student?.is_withdrawn),
        ];

        sessionBlocks.forEach((block) => {
          const attempt = visibleAttemptAt(row, block.sessionIndex);
          const sectionSummary = attempt ? resolveMainSectionSummary(attempt, block.questionsList) : [];
          block.sectionTitles.forEach((sectionTitle) => {
            const summaryRow = sectionSummary.find((item) => item.section === sectionTitle);
            const sectionTotal = Number(block.sectionTotals[sectionTitle] ?? 0);
            dataRow.push(
              summaryRow ? formatRatePercent(summaryRow.rate) : "-",
              summaryRow && sectionTotal > 0 ? formatScoreFraction(summaryRow.correct, sectionTotal, 0) : "-"
            );
          });
          const ranking = block.rankingByStudentId[row.student.id] ?? null;
          dataRow.push(
            attempt ? formatRatePercent(getScoreRate(attempt)) : "-",
            attempt && Number(attempt.total ?? 0) > 0 ? formatScoreFraction(Number(attempt.correct ?? 0), Number(attempt.total ?? 0), 0) : "-",
            attempt && ranking ? `${formatOrdinalRank(ranking.rank)} / ${ranking.total}` : "-"
          );
        });

        exportRows.push(padCsvRow(dataRow, totalColumns));
      });

      downloadText(`model_results_google_sheets_${Date.now()}.csv`, toCsv(exportRows), "text/csv");
    } catch (error) {
      console.error("model export failed:", error);
      setQuizMsg(`Export failed: ${error?.message || error}`);
    }
  }, [attemptQuestionsByVersion, dailyResultsMatrix, formatRatePercent, getScoreRate, getSectionTitle, isAnalyticsExcludedStudent, modelResultsMatrix, sections, setQuizMsg, supabase]);

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
      .select("id, version, title, type, is_public, pass_rate, created_at, updated_at, questions(count)")
      .eq("is_public", true)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("relationship") || msg.includes("questions")) {
        // Fallback: try without relationship query
        const fallback = await supabase
          .from("tests")
          .select("id, version, title, type, pass_rate, is_public, created_at, updated_at")
          .eq("is_public", true)
          .order("updated_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(200);
        if (fallback.error) {
          console.error("tests fetch error:", fallback.error);
          setTests([]);
          setTestsMsg(`Load failed: ${fallback.error.message}`);
          setTestsLoaded(false);
          return;
        }
        const list = fallback.data ?? [];
        const counts = await fetchQuestionCounts(list.map((t) => t.version));
        const withCounts = list.map((t) => ({
          ...t,
          question_count: counts[t.version] ?? 0
        }));
        const seeded = await seedModelCategory(withCounts);
        const hydrated = await attachGeneratedDailySourceSetIds(seeded);
        setTests(hydrated);
        setTestsLoaded(true);
        setTestsMsg(list.length ? "" : "No tests.");
        return;
      }
      console.error("tests fetch error:", error);
      setTests([]);
      setTestsMsg(`Load failed: ${error.message}`);
      setTestsLoaded(false);
      return;
    }
    const list = data ?? [];
    const hasRelation = list.some((t) => Array.isArray(t.questions));
    if (!hasRelation) {
      // No relationship data, fetch counts separately
      const counts = await fetchQuestionCounts(list.map((t) => t.version));
      const withCounts = list.map((t) => ({
        ...t,
        question_count: counts[t.version] ?? 0
      }));
      const seeded = await seedModelCategory(withCounts);
      const hydrated = await attachGeneratedDailySourceSetIds(seeded);
      setTests(hydrated);
      setTestsLoaded(true);
      setTestsMsg(list.length ? "" : "No tests.");
      return;
    }
    // Relationship data is available, use it
    const withCounts = list.map((t) => ({
      ...t,
      question_count: t.questions?.[0]?.count ?? 0
    }));
    const seeded = await seedModelCategory(withCounts);
    const hydrated = await attachGeneratedDailySourceSetIds(seeded);
    setTests(hydrated);
    setTestsLoaded(true);
    setTestsMsg(list.length ? "" : "No tests.");
  }, [supabase, fetchQuestionCounts, seedModelCategory, attachGeneratedDailySourceSetIds]);

  const fetchTestSessions = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await fetchAllPages((offset, pageSize) => (
      supabase
        .from("test_sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1)
    ));
    if (error) {
      console.error("test_sessions fetch error:", error);
      setTestSessionsLoaded(false);
      return;
    }
    setTestSessions(data ?? []);
    setTestSessionsLoaded(true);
  }, [supabase]);

  const fetchAssets = useCallback(async () => {
    setAssetsMsg("Loading...");
    if (!supabase) {
      setAssetsMsg("Supabase not initialized.");
      setAssetsLoaded(false);
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
      setAssetsLoaded(false);
      return;
    }
    setAssets(data ?? []);
    setAssetsMsg("");
    setAssetsLoaded(true);
  }, [supabase]);

  const fetchExamLinks = useCallback(async () => {
    setLinkMsg("Loading...");
    const { data, error } = await supabase
      .from("exam_links")
      .select("id, test_version, test_session_id, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("exam_links fetch error:", error);
      setExamLinks([]);
      setLinkMsg(`Load failed: ${error.message}`);
      setExamLinksLoaded(false);
      return;
    }
    setExamLinks(data ?? []);
    setLinkMsg(data?.length ? "" : "No links.");
    setExamLinksLoaded(true);
  }, [supabase]);

  const fetchAttempts = useCallback(async () => {
    if (!supabase || !activeSchoolId) return;
    setAttemptsMsg("Loading results...");

    const { data, error } = await fetchAllPages((offset, pageSize) => (
      supabase
        .from("attempts")
        .select("id, student_id, test_session_id, test_version, correct, total, score_rate, started_at, ended_at, created_at, answers_json")
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + pageSize - 1)
    ));

    if (error) {
      console.error("attempts fetch error:", error);
      setAttempts([]);
      setAttemptsMsg(`Load failed: ${error.message}`);
      setAttemptsLoaded(false);
      return;
    }

    setAttempts(data ?? []);
    setAttemptsMsg("");
    setAttemptsLoaded(true);
  }, [supabase, activeSchoolId]);

  const buildGeneratedDailySessionTitle = useCallback(({ category, setIds }) => (
    buildDailySessionTitle({ category, setIds })
  ), []);

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
      normalizedSetIds,
      activeSchoolId
    );
    if (sourceQuestionsError) {
      throw new Error(`Question lookup failed: ${sourceQuestionsError.message}`);
    }

    const orderedQuestions = normalizedSetIds.flatMap((version) =>
      (sourceQuestions ?? []).filter((row) => row.test_version === version)
    );
    if (!orderedQuestions.length) {
      throw new Error("No questions found for the selected SetID values.");
    }

    const requestedQuestionCount =
      questionCountMode === "specify"
        ? Number(questionCount)
        : orderedQuestions.length;
    if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
      throw new Error("Specify a valid number of questions.");
    }
    if (requestedQuestionCount > orderedQuestions.length) {
      throw new Error(`Only ${orderedQuestions.length} questions are available for the selected SetID values.`);
    }

    const selectedQuestions = shuffleCopy(orderedQuestions).slice(0, requestedQuestionCount);
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
        is_public: true,
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
    setModelConductError("");
    setTestSessionsMsg("");
    if (!activeSchoolId) {
      setModelConductError("School scope is required.");
      return;
    }
    if (modelConductMode === "retake" && !modelRetakeSourceId) {
      setModelConductError("Please choose a past session to retake.");
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
    const startsAtIso = startsAtInput ? fromBangladeshInput(startsAtInput) : "";
    const endsAtIso = endsAt ? fromBangladeshInput(endsAt) : "";
    const passRate = Number(testSessionForm.pass_rate);
    if (!problemSetId) {
      setModelConductError("SetID is required.");
      return;
    }
    if (!title) {
      setModelConductError("Test Title is required.");
      return;
    }
    if (!sessionDate) {
      setModelConductError("Date is required.");
      return;
    }
    if (!startTime) {
      setModelConductError("Start time is required.");
      return;
    }
    if (!closeTime) {
      setModelConductError("Close time is required.");
      return;
    }
    if (!endsAt) {
      setModelConductError("End time is required.");
      return;
    }
    if (startsAtIso && endsAtIso && new Date(endsAtIso).getTime() <= new Date(startsAtIso).getTime()) {
      setModelConductError("Close time must be after start time.");
      return;
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setModelConductError("Pass rate must be between 0 and 1.");
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title)) {
        setModelConductError("That Test Title already exists.");
        return;
      }
    } catch (error) {
      setModelConductError(`Check failed: ${error.message}`);
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
      pass_rate: passRate,
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
      close_time_auto_filled: false,
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
    setDailyConductError("");
    setDailySessionsMsg("");
    if (!activeSchoolId) {
      setDailyConductError("School scope is required.");
      return;
    }
    if (dailyConductMode === "retake" && !dailyRetakeSourceId) {
      setDailyConductError("Please choose a past session to retake.");
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
    const startsAtIso = startsAtInput ? fromBangladeshInput(startsAtInput) : "";
    const endsAtIso = endsAtInput ? fromBangladeshInput(endsAtInput) : "";
    const sessionCategory = String(dailySessionForm.session_category ?? "").trim()
      || dailyConductCategory
      || selectedDailySourceCategoryNames[0]
      || "Daily Test";
    const generatedTitle = buildGeneratedDailySessionTitle({
      category: sessionCategory,
      setIds: selectedSetIds,
    });
    const title = String(dailySessionForm.title ?? "").trim() || generatedTitle;
    const endsAt = endsAtInput;
    const passRate = Number(dailySessionForm.pass_rate);
    if (!selectedSetIds.length) {
      setDailyConductError(isMultipleSelection ? "Choose one or more SetID values." : "SetID is required.");
      return;
    }
    if (!sessionDate) {
      setDailyConductError("Date is required.");
      return;
    }
    if (!startTime) {
      setDailyConductError("Start time is required.");
      return;
    }
    if (!endsAt) {
      setDailyConductError("End time is required.");
      return;
    }
    if (!closeTime) {
      setDailyConductError("Close time is required.");
      return;
    }
    if (startsAtIso && endsAtIso && new Date(endsAtIso).getTime() <= new Date(startsAtIso).getTime()) {
      setDailyConductError("Close time must be after start time.");
      return;
    }
    if (dailySessionForm.question_count_mode === "specify") {
      const requestedQuestionCount = Number(dailySessionForm.question_count);
      if (!Number.isFinite(requestedQuestionCount) || requestedQuestionCount <= 0) {
        setDailyConductError("Specify a valid number of questions.");
        return;
      }
      if (requestedQuestionCount > selectedDailyQuestionCount) {
        setDailyConductError(`Only ${selectedDailyQuestionCount} questions are available for the selected SetID.`);
        return;
      }
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setDailyConductError("Pass rate must be between 0 and 1.");
      return;
    }
    try {
      if (await hasDuplicateSessionTitle(title)) {
        setDailyConductError("That Test Title already exists.");
        return;
      }
    } catch (error) {
      setDailyConductError(`Check failed: ${error.message}`);
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
      session_category: sessionCategory,
      starts_at: startsAtInput ? fromBangladeshInput(startsAtInput) : null,
      ends_at: endsAt ? fromBangladeshInput(endsAt) : null,
      time_limit_min: dailySessionForm.time_limit_min ? Number(dailySessionForm.time_limit_min) : null,
      is_published: true,
      show_answers: Boolean(dailySessionForm.show_answers),
      allow_multiple_attempts: Boolean(dailySessionForm.allow_multiple_attempts),
      pass_rate: passRate,
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
      title_auto_generated: true,
      session_date: "",
      start_time: "",
      close_time: "",
      close_time_auto_filled: false,
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
    const passRate = normalizePassRate(session.pass_rate ?? testMetaByVersion[session.problem_set_id]?.pass_rate);
    const startsAtFormatted = formatDateTimeInput(session.starts_at);
    const endsAtFormatted = formatDateTimeInput(session.ends_at);
    setEditingSessionId(session.id);
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: session.id,
      problem_set_id: session.problem_set_id ?? "",
      title: session.title ?? "",
      session_category: getDailySessionCategoryName(session),
      starts_at_date: getBangladeshDateFromFormatted(startsAtFormatted),
      starts_at_time: getBangladeshTimeFromFormatted(startsAtFormatted),
      ends_at_date: getBangladeshDateFromFormatted(endsAtFormatted),
      ends_at_time: getBangladeshTimeFromFormatted(endsAtFormatted),
      time_limit_min: session.time_limit_min ?? "",
      show_answers: Boolean(session.show_answers),
      allow_multiple_attempts: session.allow_multiple_attempts !== false,
      pass_rate: String(passRate)
    });
  }, [getDailySessionCategoryName, testMetaByVersion]);

  const cancelEditSession = useCallback(() => {
    setEditingSessionId("");
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: "",
      problem_set_id: "",
      title: "",
      session_category: "",
      starts_at_date: "",
      starts_at_time: "",
      ends_at_date: "",
      ends_at_time: "",
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
      starts_at_date,
      starts_at_time,
      ends_at_date,
      ends_at_time,
      time_limit_min,
      show_answers,
      pass_rate,
      problem_set_id,
      allow_multiple_attempts,
      session_category,
    } = editingSessionForm;
    if (!title.trim()) {
      setEditingSessionMsg("Test Title is required.");
      return;
    }
    const startsAtInput = combineBangladeshDateTime(starts_at_date, starts_at_time);
    const endsAtInput = combineBangladeshDateTime(ends_at_date, ends_at_time);
    if (!endsAtInput) {
      setEditingSessionMsg("End time is required.");
      return;
    }
    if (startsAtInput) {
      const startsAtIso = fromBangladeshInput(startsAtInput);
      const endsAtIso = fromBangladeshInput(endsAtInput);
      if (startsAtIso && endsAtIso && new Date(endsAtIso).getTime() <= new Date(startsAtIso).getTime()) {
        setEditingSessionMsg("End time must be after start time.");
        return;
      }
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
      ...(testMetaByVersion[problem_set_id]?.type === "daily"
        ? {
          session_category: String(session_category ?? "").trim() || getDailySessionCategoryName({ problem_set_id }),
        }
        : {}),
      starts_at: startsAtInput ? fromBangladeshInput(startsAtInput) : null,
      ends_at: endsAtInput ? fromBangladeshInput(endsAtInput) : null,
      time_limit_min: time_limit_min ? Number(time_limit_min) : null,
      show_answers: Boolean(show_answers),
      allow_multiple_attempts: Boolean(allow_multiple_attempts),
      pass_rate: passRateValue
    };
    const { error } = await supabase.from("test_sessions").update(payload).eq("id", editingSessionId);
    if (error) {
      console.error("session update error:", error);
      setEditingSessionMsg(`Save failed: ${error.message}`);
      return;
    }
    const { error: linkError } = await supabase
      .from("exam_links")
      .update({ expires_at: fromBangladeshInput(endsAtInput) })
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
  }, [editingSessionId, editingSessionForm, supabase, hasDuplicateSessionTitle, cancelEditSession, fetchTestSessions, getDailySessionCategoryName, testMetaByVersion]);

  const deleteTestSession = useCallback(async (id, options = {}) => {
    if (!id || !supabase) return;
    const label = String(options?.title ?? id).trim() || id;
    const ok = window.confirm(`Delete test session "${label}"?\n\nThis removes the session and its saved results.`);
    if (!ok) return;
    const cleanupResult = await deleteSessionResultsAndLinks(supabase, id);
    if (!cleanupResult.ok) {
      console.error("session cleanup error:", cleanupResult.message);
      setTestSessionsMsg(`Delete failed: ${cleanupResult.message}`);
      if (options?.surface === "results") setQuizMsg(`Delete failed: ${cleanupResult.message}`);
      return;
    }
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
    if (options?.refreshResults && options?.type && typeof runSearch === "function") {
      await runSearch(options.type);
    }
  }, [supabase, sessionDetail.sessionId, recordAuditEvent, fetchTestSessions, runSearch]);

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
    if (isImportedResultsSummaryAttempt(attempt)) {
      if (importedTitle) return importedTitle;
      if (attempt.test_session_id) {
        const session = testSessionsById.get(attempt.test_session_id);
        if (session?.title) return session.title;
      }
      return "Imported Result";
    }
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
      fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id, activeSchoolId),
      (async () => {
        const buildAttemptsQuery = (fields) =>
          fetchAllPages((offset, pageSize) => (
            supabase
              .from("attempts")
              .select(fields)
              .eq("test_session_id", session.id)
              .order("created_at", { ascending: true })
              .order("id", { ascending: true })
              .range(offset, offset + pageSize - 1)
          ));
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
    setAttemptQuestionsByVersion((current) => ({
      ...(current ?? {}),
      [String(session.problem_set_id ?? "").trim()]: questionsList,
    }));
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

  const startEditTest = useCallback((test, categoryOptions) => {
    if (!test?.id) return;
    const normalizedTitle = String(test.title ?? "").trim() || "Uncategorized";
    const hasCategory = (categoryOptions ?? []).some((category) => category.name === normalizedTitle);
    setEditingTestId(test.id);
    setEditingTestMsg("");
    setEditingCategorySelect(hasCategory ? normalizedTitle : CUSTOM_CATEGORY_OPTION);
    setEditingTestForm({
      id: test.id,
      originalVersion: test.version ?? "",
      version: test.version ?? "",
      title: normalizedTitle,
      pass_rate: test.pass_rate != null ? String(test.pass_rate) : "",
      is_public: Boolean(test.is_public),
      type: test.type ?? ""
    });
  }, []);

  const cancelEditTest = useCallback(() => {
    setEditingTestId("");
    setEditingTestMsg("");
    setEditingCategorySelect(CUSTOM_CATEGORY_OPTION);
  }, []);

  const updateVersionInTable = useCallback(async (table, column, oldVersion, newVersion) => {
    const { error } = await supabase
      .from(table)
      .update({ [column]: newVersion })
      .eq(column, oldVersion);
    if (error) throw new Error(`${table}: ${error.message}`);
  }, [supabase]);

  const saveTestEdits = useCallback(async (categoryOptions) => {
    if (!editingTestForm.id || !supabase) return;
    setEditingTestMsg("Saving...");
    const nextVersion = editingTestForm.version.trim();
    if (!nextVersion) {
      setEditingTestMsg("SetID is required.");
      return;
    }
    const passRate = Number(editingTestForm.pass_rate);
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setEditingTestMsg("Pass Rate must be between 0 and 1.");
      return;
    }
    const nextTitleRaw = editingCategorySelect === CUSTOM_CATEGORY_OPTION
      ? editingTestForm.title
      : editingCategorySelect;
    const nextTitle = String(nextTitleRaw ?? "").trim() || "Uncategorized";

    if (nextVersion !== editingTestForm.originalVersion) {
      const { data: existingRows, error: existsErr } = await supabase
        .from("tests")
        .select("id")
        .eq("version", nextVersion)
        .limit(1);
      if (existsErr) {
        setEditingTestMsg(`Check failed: ${existsErr.message}`);
        return;
      }
      if (existingRows?.length && existingRows[0].id !== editingTestForm.id) {
        setEditingTestMsg("That SetID already exists.");
        return;
      }
      const ok = window.confirm(
        `Rename SetID from ${editingTestForm.originalVersion} to ${nextVersion}? This updates sessions, attempts, links, questions, assets.`
      );
      if (!ok) {
        setEditingTestMsg("Rename cancelled.");
        return;
      }
    }

    const updatePayload = {
      title: nextTitle,
      pass_rate: passRate,
      is_public: editingTestForm.is_public,
      updated_at: new Date().toISOString()
    };
    if (nextVersion !== editingTestForm.originalVersion) {
      updatePayload.version = nextVersion;
    }

    const { error: updateErr } = await supabase
      .from("tests")
      .update(updatePayload)
      .eq("id", editingTestForm.id);
    if (updateErr) {
      setEditingTestMsg(normalizeLegacyTestErrorMessage(updateErr, "update"));
      return;
    }

    if (nextVersion !== editingTestForm.originalVersion) {
      try {
        await updateVersionInTable("questions", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("attempts", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("test_sessions", "problem_set_id", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("exam_links", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("test_assets", "test_version", editingTestForm.originalVersion, nextVersion);
      } catch (err) {
        console.error("rename error:", err);
        setEditingTestMsg(`Saved, but rename failed: ${err.message}`);
      }
    }

    setEditingTestMsg("Saved.");
    setEditingTestId("");
    fetchTests();
    fetchTestSessions();
    fetchExamLinks();
    if (activeTab === "daily" && dailySubTab === "results") runSearch("daily");
    if (activeTab === "model" && modelSubTab === "results") runSearch("mock");
  }, [
    activeTab,
    dailySubTab,
    editingCategorySelect,
    editingTestForm,
    fetchExamLinks,
    fetchTestSessions,
    fetchTests,
    modelSubTab,
    runSearch,
    supabase,
    updateVersionInTable,
  ]);

  const openPreview = useCallback(async (testVersion) => {
    if (!testVersion) return;
    setPreviewOpen(true);
    setPreviewTest(testVersion);
    setPreviewSession(null);
    setPreviewReplacementPool([]);
    setPreviewReplacementDrafts({});
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("");
    setPreviewAnswers({});
    setPreviewMsg("Loading...");
    try {
      const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, testVersion);
      if (error) {
        setPreviewQuestions([]);
        setPreviewMsg(`Load failed: ${error.message}`);
        return;
      }
      const list = (data ?? []).map(mapQuestion);
      setPreviewQuestions(list);
      setPreviewMsg(list.length ? "" : "No questions.");
    } catch (error) {
      console.error("preview load error:", error);
      setPreviewMsg(error.message);
    }
  }, [supabase, fetchQuestionsForVersionWithFallback, mapQuestion]);

  const openSessionPreview = useCallback(async (session) => {
    if (!session?.id || !session?.problem_set_id) return;
    setPreviewOpen(true);
    setPreviewSession(session);
    setPreviewTest(session.title || session.problem_set_id);
    setPreviewReplacementPool([]);
    setPreviewReplacementDrafts({});
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("");
    setPreviewAnswers({});
    setPreviewMsg("Loading...");
    try {
      const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id);
      if (error) {
        setPreviewQuestions([]);
        setPreviewMsg(`Load failed: ${error.message}`);
        return;
      }
      const list = (data ?? []).map(mapQuestion);
      setPreviewQuestions(list);
      setPreviewMsg(list.length ? "" : "No questions.");

      if (!isDaily(session.problem_set_id)) return;

      const sourceSetIds = Array.from(
        new Set(list.map((question) => question.sourceVersion).filter(Boolean))
      );
      if (!sourceSetIds.length) return;

      const { data: sourceData, error: sourceError } = await fetchQuestionsForVersionsWithFallback(
        supabase,
        sourceSetIds
      );
      if (sourceError) {
        console.error("session preview source questions error:", sourceError);
        setPreviewReplacementMsg(`Replacement load failed: ${sourceError.message}`);
        return;
      }

      const replacementPool = (sourceData ?? []).map((row) => {
        const mapped = mapQuestion(row);
        return {
          ...mapped,
          sourceVersion: row.test_version,
          sourceQuestionId: row.question_id,
        };
      });
      setPreviewReplacementPool(replacementPool);
    } catch (error) {
      console.error("session preview load error:", error);
      setPreviewMsg(error.message);
    }
  }, [supabase, fetchQuestionsForVersionWithFallback, fetchQuestionsForVersionsWithFallback, mapQuestion, isDaily]);

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
    const questionCountsByVersion = questions.reduce((accumulator, question) => {
      const version = String(question?.test_version ?? "").trim();
      if (!version) return accumulator;
      accumulator[version] = (accumulator[version] ?? 0) + 1;
      return accumulator;
    }, {});
    const existingVersions = new Set((tests ?? []).map((test) => String(test?.version ?? "").trim()).filter(Boolean));
    const duplicateVersions = versionSet.filter((version) => existingVersions.has(version));
    if (duplicateVersions.length) {
      return {
        ok: false,
        summary: `Upload stopped: ${duplicateVersions.length === 1 ? "this set_id already exists" : "these set_id values already exist"}.`,
        detail: `Change the CSV set_id before uploading.\nExisting set_id${duplicateVersions.length === 1 ? "" : "s"}:\n${duplicateVersions.join("\n")}`,
      };
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

    return { ok: true, resolvedVersion, versions: versionSet, questionCountsByVersion };
  }, [supabase, validateAssetRefs, buildLocalAssetNameMap, tests]);

  const uploadAssets = useCallback(async () => {
    console.log("uploadAssets called");
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

    setAssetUploadMsg(`Uploaded files: ${ok} ok / ${ng} failed. Importing questions...`);
    console.log("Starting import with csvFile:", csvFile?.name, "category:", category);
    const importResult = await importModelQuestionsFromCsvFile(csvFile, category);
    console.log("Import result:", importResult);
    if (!importResult.ok) {
      setAssetUploadMsg(`Uploaded files: ${ok} ok / ${ng} failed. Question import failed.`);
      return;
    }

    mergeRegisteredTestsIntoState(importResult.versions, {
      title: category || DEFAULT_MODEL_CATEGORY,
      type,
      questionCountsByVersion: importResult.questionCountsByVersion,
    });
    setModelUploadCategory(category || "");
    setAssetUploadMsg(`Uploaded files: ${ok} ok / ${ng} failed. Refreshing list...`);
    await fetchTests();
    await fetchAssets();
    setAssetUploadMsg(`Uploaded files: ${ok} ok / ${ng} failed. Imported ${importResult.totalQuestions} questions.`);
    setAssetCsvFile(null);
  }, [activeSchoolId, assetFile, assetFiles, assetForm, assetCsvFile, validateCsvAssetsBeforeUpload, ensureTestRecord, uploadSingleAsset, fetchTests, fetchAssets, mergeRegisteredTestsIntoState, DEFAULT_MODEL_CATEGORY, importModelQuestionsFromCsvFile]);

  async function importModelQuestionsFromCsvFile(file, category) {
    console.log("importModelQuestionsFromCsvFile called with file:", file?.name, "category:", category);
    setAssetImportMsg("");
    if (!activeSchoolId) {
      setAssetImportMsg("School scope is required.");
      return { ok: false };
    }
    const normalizedCategory = String(category ?? "").trim();
    const csvFile = file ?? null;
    const type = "mock";

    if (!normalizedCategory) {
      setAssetImportMsg("Category is required.");
      return { ok: false };
    }

    if (!csvFile) {
      setAssetImportMsg("CSV file is required.");
      return { ok: false };
    }
    if (!csvFile.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("CSV file is required.");
      return { ok: false };
    }
    setAssetImportMsg("Parsing...");
    const text = await csvFile.text();
    const { questions, choices, errors } = parseQuestionCsv(text, "");
    console.log("CSV parsed. Questions:", questions.length, "Choices:", choices.length, "Errors:", errors);
    if (errors.length) {
      setAssetImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return { ok: false };
    }
    if (questions.length === 0) {
      setAssetImportMsg("No questions found.");
      return { ok: false };
    }
    console.log("Grouped by version:", questions.map(q => ({ test_version: q.test_version, question_id: q.question_id })).slice(0, 3));
    const groupedByVersion = groupParsedCsvByVersion(questions, choices);
    const versions = Array.from(groupedByVersion.keys());
    if (!versions.length) {
      setAssetImportMsg("set_id is required in the CSV.");
      return { ok: false };
    }

    setAssetImportMsg("Resolving assets...");
    let totalQuestions = 0;
    let totalChoiceRows = 0;
    const questionCountsByVersion = {};

    if (!supabase) {
      setAssetImportMsg("Supabase not initialized.");
      return { ok: false };
    }

    for (const version of versions) {
      const group = groupedByVersion.get(version);
      if (!group) continue;
      const groupQuestions = group.questions.map((question) => ({ ...question }));
      const groupChoices = group.choices.map((choice) => ({ ...choice }));
      questionCountsByVersion[version] = groupQuestions.length;

      const { data: assetRows, error: assetErr } = await supabase
        .from("test_assets")
        .select("path, original_name")
        .eq("test_version", version);
      if (assetErr) {
        console.error("assets fetch error:", assetErr);
        setAssetImportMsg(`Asset lookup failed: ${assetErr.message}`);
        return { ok: false };
      }
      const assetMap = {};
      for (const row of assetRows ?? []) {
        const name = row.original_name || row.path?.split("/").pop();
        if (name) assetMap[name] = resolveAdminAssetUrl(row.path);
      }
      const { missing, invalid } = validateAssetRefs(groupQuestions, groupChoices, assetMap);
      if (invalid.length) {
        setAssetImportMsg(`Invalid asset paths for ${version} (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
        return { ok: false };
      }
      if (missing.length) {
        setAssetImportMsg(`Missing assets for ${version} (upload first):\n${missing.slice(0, 5).join("\n")}`);
        return { ok: false };
      }
      applyAssetMap(groupQuestions, groupChoices, assetMap);

      const ensure = await ensureTestRecord(version, normalizedCategory || DEFAULT_MODEL_CATEGORY, type, null, activeSchoolId);
      if (!ensure.ok) {
        setAssetImportMsg(ensure.message);
        return { ok: false };
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
          return { ok: false };
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
        return { ok: false };
      }
      const { data: qRows, error: qFetchErr } = await supabase
        .from("questions")
        .select("id, question_id")
        .eq("test_version", version)
        .in("question_id", questionIds);
      if (qFetchErr) {
        console.error("questions fetch error:", qFetchErr);
        setAssetImportMsg(`Question fetch failed: ${qFetchErr.message}`);
        return { ok: false };
      }

      console.log(`Fetched ${(qRows ?? []).length} questions for version ${version}, expected ${questionIds.length}`);
      if ((qRows ?? []).length === 0 && questionIds.length > 0) {
        console.warn(`No questions found after upsert for version ${version}. Checking database directly...`);
        const { data: allQuestions, error: checkErr } = await supabase
          .from("questions")
          .select("test_version, question_id, school_id")
          .eq("test_version", version)
          .limit(5);
        console.log("All questions with this version:", allQuestions, checkErr);
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
          return { ok: false };
        }
      }

      if (choiceRows.length) {
        const { error: cErr } = await supabase.from("choices").insert(choiceRows);
        if (cErr) {
          console.error("choices insert error:", cErr);
          setAssetImportMsg(`Choice insert failed: ${cErr.message}`);
          return { ok: false };
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
      summary: `Imported ${versions.length} model set${versions.length === 1 ? "" : "s"} in ${normalizedCategory}.`,
      metadata: {
        category: normalizedCategory,
        set_ids: versions,
        question_count: totalQuestions,
        choice_count: totalChoiceRows,
      },
    });

    return { ok: true, versions, totalQuestions, totalChoiceRows, questionCountsByVersion };
  }

  async function importDailyQuestionsFromCsvFile(file, category) {
    console.log("importDailyQuestionsFromCsvFile called with file:", file?.name, "category:", category);
    setDailyImportMsg("");
    if (!activeSchoolId) {
      setDailyImportMsg("School scope is required.");
      return { ok: false };
    }
    const normalizedCategory = String(category ?? "").trim() || "Daily Test";
    const csvFile = file ?? null;
    const type = "daily";

    if (!csvFile) {
      setDailyImportMsg("CSV file is required.");
      return { ok: false };
    }
    const isCsvLike = (name) => {
      const lower = String(name ?? "").toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".tsv");
    };
    if (!isCsvLike(csvFile.name)) {
      setDailyImportMsg("CSV file is required.");
      return { ok: false };
    }
    setDailyImportMsg("Parsing...");
    const text = await csvFile.text();
    const { questions, choices, errors } = parseDailyCsv(text, "");
    console.log("Daily CSV parsed. Questions:", questions.length, "Choices:", choices.length, "Errors:", errors);
    if (errors.length) {
      setDailyImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return { ok: false };
    }
    if (questions.length === 0) {
      setDailyImportMsg("No questions found.");
      return { ok: false };
    }
    const groupedByVersion = groupParsedCsvByVersion(questions, choices);
    const versions = Array.from(groupedByVersion.keys());
    if (!versions.length) {
      setDailyImportMsg("set_id is required in the CSV.");
      return { ok: false };
    }

    setDailyImportMsg("Resolving assets...");
    let totalQuestions = 0;
    let totalChoiceRows = 0;
    const questionCountsByVersion = {};

    if (!supabase) {
      setDailyImportMsg("Supabase not initialized.");
      return { ok: false };
    }

    for (const version of versions) {
      const group = groupedByVersion.get(version);
      if (!group) continue;
      const groupQuestions = group.questions.map((question) => ({ ...question }));
      const groupChoices = group.choices.map((choice) => ({ ...choice }));
      questionCountsByVersion[version] = groupQuestions.length;

      const { data: assetRows, error: assetErr } = await supabase
        .from("test_assets")
        .select("path, original_name")
        .eq("test_version", version);
      if (assetErr) {
        console.error("daily assets fetch error:", assetErr);
        setDailyImportMsg(`Asset lookup failed: ${assetErr.message}`);
        return { ok: false };
      }
      const assetMap = {};
      for (const row of assetRows ?? []) {
        const name = row.original_name || row.path?.split("/").pop();
        if (name) assetMap[name] = resolveAdminAssetUrl(row.path);
      }
      const { missing, invalid } = validateAssetRefs(groupQuestions, groupChoices, assetMap);
      if (invalid.length) {
        setDailyImportMsg(`Invalid asset paths for ${version} (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
        return { ok: false };
      }
      if (missing.length) {
        setDailyImportMsg(`Missing assets for ${version} (upload first):\n${missing.slice(0, 5).join("\n")}`);
        return { ok: false };
      }
      applyAssetMap(groupQuestions, groupChoices, assetMap);

      const ensure = await ensureTestRecord(version, normalizedCategory, type, null, activeSchoolId);
      if (!ensure.ok) {
        setDailyImportMsg(ensure.message);
        return { ok: false };
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
          console.error("daily questions cleanup error:", cleanupErr);
          setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
          return { ok: false };
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
        console.error("daily questions upsert error:", qError);
        setDailyImportMsg(`Question upsert failed: ${qError.message}`);
        return { ok: false };
      }
      const { data: qRows, error: qFetchErr } = await supabase
        .from("questions")
        .select("id, question_id")
        .eq("test_version", version)
        .in("question_id", questionIds);
      if (qFetchErr) {
        console.error("daily questions fetch error:", qFetchErr);
        setDailyImportMsg(`Question fetch failed: ${qFetchErr.message}`);
        return { ok: false };
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
          console.error("daily choices delete error:", delErr);
          setDailyImportMsg(`Choice cleanup failed: ${delErr.message}`);
          return { ok: false };
        }
      }

      if (choiceRows.length) {
        const { error: cErr } = await supabase.from("choices").insert(choiceRows);
        if (cErr) {
          console.error("daily choices insert error:", cErr);
          setDailyImportMsg(`Choice insert failed: ${cErr.message}`);
          return { ok: false };
        }
      }

      totalQuestions += groupQuestions.length;
      totalChoiceRows += choiceRows.length;
    }

    setDailyImportMsg(`Imported ${totalQuestions} questions / ${totalChoiceRows} choices across ${versions.length} set${versions.length === 1 ? "" : "s"}.`);
    await recordAuditEvent({
      actionType: "import",
      entityType: "question_import",
      entityId: versions[0] || `daily-import-${Date.now()}`,
      summary: `Imported ${versions.length} daily set${versions.length === 1 ? "" : "s"} in ${normalizedCategory}.`,
      metadata: {
        category: normalizedCategory,
        set_ids: versions,
        question_count: totalQuestions,
        choice_count: totalChoiceRows,
      },
    });

    return { ok: true, versions, totalQuestions, totalChoiceRows, questionCountsByVersion };
  }

  const importQuestionsFromCsv = useCallback(async () => {
    const file = assetCsvFile || assetFile;
    const category = assetForm.category.trim();
    const result = await importModelQuestionsFromCsvFile(file, category);
    if (!result.ok) return;
    await fetchTests();
    setAssetCsvFile(null);
  }, [assetCsvFile, assetFile, assetForm, importModelQuestionsFromCsvFile, fetchTests]);

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
    const questionCountsByVersion = preflight.questionCountsByVersion ?? {};

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

    setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed. Importing questions...`);
    const importResult = await importDailyQuestionsFromCsvFile(csvFile, category);
    if (!importResult.ok) {
      setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed. Question import failed.`);
      return;
    }

    mergeRegisteredTestsIntoState(importResult.versions, {
      title: category || versions[0] || "",
      type,
      questionCountsByVersion: importResult.questionCountsByVersion,
    });
    setDailyUploadCategory(category || "");
    setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed. Refreshing list...`);
    await fetchTests();
    await fetchAssets();
    setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed. Imported ${importResult.totalQuestions} questions.`);
  }, [activeSchoolId, dailyFile, dailyFiles, dailyForm, dailyCsvFile, validateCsvAssetsBeforeUpload, parseDailyCsv, ensureTestRecord, uploadSingleAsset, fetchTests, fetchAssets, mergeRegisteredTestsIntoState]);

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
      close_time_auto_filled: false,
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
    const sourceCategory = getDailySessionCategoryName(session);
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
      title_auto_generated: false,
      session_date: session.ends_at
        ? getBangladeshDateInput(session.ends_at)
        : session.starts_at
          ? getBangladeshDateInput(session.starts_at)
          : current.session_date,
      start_time: session.starts_at ? getBangladeshTimeInput(session.starts_at) : current.start_time,
      close_time: session.ends_at ? getBangladeshTimeInput(session.ends_at) : current.close_time,
      close_time_auto_filled: false,
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
  }, [getDailySessionCategoryName, tests]);

  const selectModelRetakeSource = useCallback((sessionId) => {
    setModelRetakeSourceId(sessionId);
    const source = pastModelSessions.find((session) => session.id === sessionId);
    if (source) applySourceSessionToForm(source, setTestSessionForm);
  }, [pastModelSessions, applySourceSessionToForm]);

  const selectDailyRetakeSource = useCallback((sessionId) => {
    setDailySourceCategoryDropdownOpen(false);
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    setDailyRetakeSourceId(sessionId);
    const source = dailyRetakeSessions.find((session) => session.id === sessionId);
    if (source) applyDailyRetakeSourceSession(source);
  }, [dailyRetakeSessions, applyDailyRetakeSourceSession]);

  const updateModelSessionTimePart = useCallback((field, part, value) => {
    setTestSessionForm((current) => {
      const nextParts = {
        ...getTwelveHourTimeParts(current[field]),
        [part]: value,
      };
      const nextValue = buildTwentyFourHourTime(nextParts);
      if (field === "close_time") {
        return {
          ...current,
          close_time_auto_filled: false,
          [field]: nextValue,
        };
      }
      if (field === "start_time") {
        const shouldAutoFillCloseTime = current.close_time_auto_filled || !String(current.close_time ?? "").trim();
        return {
          ...current,
          [field]: nextValue,
          close_time: shouldAutoFillCloseTime ? addMinutesToTimeInput(nextValue, 30) : current.close_time,
          close_time_auto_filled: shouldAutoFillCloseTime,
        };
      }
      return {
        ...current,
        [field]: nextValue,
      };
    });
  }, []);

  const updateDailySessionTimePart = useCallback((field, part, value) => {
    setDailySessionForm((current) => {
      const nextParts = {
        ...getTwelveHourTimeParts(current[field]),
        [part]: value,
      };
      const nextValue = buildTwentyFourHourTime(nextParts);
      if (field === "close_time") {
        return {
          ...current,
          close_time_auto_filled: false,
          [field]: nextValue,
        };
      }
      if (field === "start_time") {
        const shouldAutoFillCloseTime = current.close_time_auto_filled || !String(current.close_time ?? "").trim();
        return {
          ...current,
          [field]: nextValue,
          close_time: shouldAutoFillCloseTime ? addMinutesToTimeInput(nextValue, 30) : current.close_time,
          close_time_auto_filled: shouldAutoFillCloseTime,
        };
      }
      return {
        ...current,
        [field]: nextValue,
      };
    });
  }, []);

  const toggleDailySourceCategorySelection = useCallback((categoryName) => {
    const normalizedName = String(categoryName ?? "").trim();
    if (!normalizedName) return;
    const currentlySelected = selectedDailySourceCategoryNames;
    const isSelected = currentlySelected.includes(normalizedName);

    if (isSelected) {
      if (currentlySelected.length <= 1) {
        setDailyConductCategory("");
        setDailySessionForm((current) => ({
          ...current,
          source_categories: [],
          problem_set_ids: [],
        }));
        return;
      }
      const remainingNames = currentlySelected.filter((name) => name !== normalizedName);
      const nextPrimary = dailyConductCategory === normalizedName
        ? remainingNames[0] ?? ""
        : dailyConductCategory;
      setDailyConductCategory(nextPrimary);
      setDailySessionForm((current) => ({
        ...current,
        source_categories: remainingNames.filter((name) => name !== nextPrimary),
      }));
      return;
    }

    if (!dailyConductCategory) {
      setDailyConductCategory(normalizedName);
      return;
    }

    setDailySessionForm((current) => ({
      ...current,
      source_categories: Array.from(new Set([...(current.source_categories ?? []), normalizedName])),
    }));
  }, [selectedDailySourceCategoryNames, dailyConductCategory]);

  const toggleDailyProblemSetSelection = useCallback((problemSetId) => {
    setDailySessionForm((current) => {
      const nextIds = new Set(current.problem_set_ids ?? []);
      if (nextIds.has(problemSetId)) {
        nextIds.delete(problemSetId);
      } else {
        nextIds.add(problemSetId);
      }
      return {
        ...current,
        problem_set_ids: Array.from(nextIds),
      };
    });
  }, []);

  useEffect(() => {
    if (dailyConductMode === "retake") return;
    if (!generatedDailySessionTitle) return;
    setDailySessionForm((current) => {
      const shouldAutoGenerate = Boolean(current.title_auto_generated) || !String(current.title ?? "").trim();
      if (!shouldAutoGenerate) return current;
      if (current.title === generatedDailySessionTitle && current.title_auto_generated) return current;
      if (current.title === generatedDailySessionTitle) {
        return {
          ...current,
          title_auto_generated: true,
        };
      }
      return {
        ...current,
        title: generatedDailySessionTitle,
        title_auto_generated: true,
      };
    });
  }, [dailyConductMode, generatedDailySessionTitle]);

  useEffect(() => {
    if (dailyConductMode === "retake") return;
    if (dailySessionForm.selection_mode !== "single") return;
    const selectedSetId = selectedDailyProblemSetIds[0] ?? "";
    if (!selectedSetId) return;
    const sourceCategory = String(testMetaByVersion[selectedSetId]?.category ?? "").trim();
    if (!sourceCategory) return;
    setDailySessionForm((current) => (
      current.session_category === sourceCategory
        ? current
        : { ...current, session_category: sourceCategory }
    ));
    if (dailyConductCategory !== sourceCategory) {
      setDailyConductCategory(sourceCategory);
    }
  }, [
    dailyConductMode,
    dailyConductCategory,
    dailySessionForm.selection_mode,
    selectedDailyProblemSetIds,
    testMetaByVersion,
  ]);

  const openModelConductModal = useCallback((mode = "normal") => {
    setModelConductMode(mode);
    setModelConductOpen(true);
    setTestSessionsMsg("");
    setActiveModelTimePicker("");
    if (mode !== "retake") {
      setModelRetakeSourceId("");
      setTestSessionForm((current) => ({
        problem_set_id: "",
        title: "",
        session_date: "",
        start_time: "",
        close_time: "",
        close_time_auto_filled: false,
        show_answers: false,
        allow_multiple_attempts: false,
        time_limit_min: "",
        pass_rate: "0.8",
        retake_release_scope: "all",
      }));
      setModelConductCategory("");
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

      setDailySessionForm({
        selection_mode: "single",
        problem_set_id: "",
        problem_set_ids: [],
        source_categories: [],
        session_category: "",
        title: "",
        title_auto_generated: true,
        session_date: "",
        start_time: "",
        close_time: "",
        close_time_auto_filled: false,
        question_count_mode: "all",
        question_count: "",
        time_limit_min: "",
        show_answers: false,
        allow_multiple_attempts: false,
        pass_rate: "0.8",
        retake_release_scope: "all",
      });
      setDailyConductCategory("");
      return;
    }
    const firstCategory = pastDailySessionCategories[0]?.name ?? "";
    if (firstCategory) setDailyRetakeCategory(firstCategory);
    const source = pastDailySessionCategories[0]?.sessions?.[0] ?? null;
    setDailyRetakeSourceId(source?.id ?? "");
    if (source) applyDailyRetakeSourceSession(source);
  }, [pastDailySessionCategories, applyDailyRetakeSourceSession]);

  const openModelUploadModal = useCallback(() => {
    // Clear previous file selections and messages
    setAssetFile(null);
    setAssetFiles([]);
    setAssetCsvFile(null);
    setAssetUploadMsg("");
    setAssetImportMsg("");

    const availableCategories = modelCategories.length
      ? modelCategories
      : [{ name: DEFAULT_MODEL_CATEGORY }];
    const fallbackCategory = availableCategories[0]?.name ?? DEFAULT_MODEL_CATEGORY;
    setAssetCategorySelect(fallbackCategory);
    setAssetForm((current) => ({ ...current, category: fallbackCategory }));
    setModelUploadOpen(true);
  }, [modelCategories]);

  const getSessionEffectivePassRate = useCallback((session) => {
    if (!session) return 0.8;
    // First check if session has its own pass_rate (from test_sessions table)
    if (Number.isFinite(session.pass_rate) && session.pass_rate > 0 && session.pass_rate <= 1) {
      return session.pass_rate;
    }
    // Fall back to test version's pass_rate
    const testMeta = testMetaByVersion[session.problem_set_id];
    if (testMeta && Number.isFinite(testMeta.pass_rate)) {
      return testMeta.pass_rate;
    }
    return 0.8;
  }, [testMetaByVersion]);

  // ========================================================================
  // useEffect hooks (15+ effects)
  // ========================================================================

  // Initialize data on mount
  useEffect(() => {
    if (!supabase || !activeSchoolId || testsLoaded) return;
    if (!tests.length) {
      const initializeData = async () => {
        await fetchTests();
        // fetchTestSessions and fetchAssets will run after fetchTests completes
      };
      void initializeData();
    }
  }, [supabase, activeSchoolId, fetchTests, tests.length, testsLoaded]);

  useEffect(() => {
    if (!supabase || !activeSchoolId || !testsLoaded || testSessionsLoaded) return;
    void fetchTestSessions();
  }, [supabase, activeSchoolId, fetchTestSessions, testSessionsLoaded, testsLoaded]);

  useEffect(() => {
    if (!supabase || !activeSchoolId || assetsLoaded) return;
    void fetchAssets();
  }, [supabase, activeSchoolId, assetsLoaded, fetchAssets]);

  useEffect(() => {
    if (!supabase || examLinksLoaded) return;
    void fetchExamLinks();
  }, [examLinksLoaded, fetchExamLinks, supabase]);

  // Validate selected category against available categories
  // but don't auto-select - user must explicitly choose
  useEffect(() => {
    if (!modelConductCategory || !modelConductCategories.some((c) => c.name === modelConductCategory)) {
      // If selected category is no longer valid, clear it
      if (modelConductCategory) {
        setModelConductCategory("");
      }
    }
  }, [modelConductCategories, modelConductCategory]);

  useEffect(() => {
    if (!dailyConductCategory || !dailyCategories.some((c) => c.name === dailyConductCategory)) {
      // If selected category is no longer valid, clear it
      if (dailyConductCategory) {
        setDailyConductCategory("");
      }
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
    if (!dailyCategories.length) return;
    if (dailyForm.category && dailyCategories.some((category) => category.name === dailyForm.category)) {
      setDailyCategorySelect(dailyForm.category);
      return;
    }
    if (!dailyForm.category && dailyCategories.length) {
      const fallbackCategory = dailyCategories[0].name;
      setDailyCategorySelect(fallbackCategory);
      setDailyForm((current) => ({ ...current, category: fallbackCategory }));
      return;
    }
    setDailyCategorySelect(CUSTOM_CATEGORY_OPTION);
  }, [dailyCategories, dailyForm.category]);

  useEffect(() => {
    if (!groupedModelUploadTests.length) {
      setAssetCategorySelect(DEFAULT_MODEL_CATEGORY);
      if (!assetForm.category) {
        setAssetForm((current) => ({ ...current, category: DEFAULT_MODEL_CATEGORY }));
      }
      return;
    }
    if (assetForm.category && groupedModelUploadTests.some((category) => category.name === assetForm.category)) {
      setAssetCategorySelect(assetForm.category);
      return;
    }
    if (assetCategorySelect === CUSTOM_CATEGORY_OPTION) {
      setAssetCategorySelect(CUSTOM_CATEGORY_OPTION);
      return;
    }
    const fallbackCategory = groupedModelUploadTests[0]?.name ?? DEFAULT_MODEL_CATEGORY;
    setAssetCategorySelect(fallbackCategory);
    if (assetForm.category !== fallbackCategory) {
      setAssetForm((current) => ({ ...current, category: fallbackCategory }));
    }
  }, [assetCategorySelect, assetForm.category, groupedModelUploadTests]);

  // Cleanup effect for preview section refs
  useEffect(() => {
    return () => {
      previewSectionRefs.current = {};
    };
  }, []);

  // Load attempts when the results tab is active
  useEffect(() => {
    if (activeTab !== "model" && activeTab !== "daily") return;
    if (attemptsLoaded) return;
    if (!supabase || !activeSchoolId) return;
    void fetchAttempts();
  }, [activeTab, attemptsLoaded, supabase, activeSchoolId, fetchAttempts]);

  useEffect(() => {
    const isDailyResults = activeTab === "daily" && dailySubTab === "results";
    const isModelResults = activeTab === "model" && modelSubTab === "results";
    if (!isDailyResults && !isModelResults) return;
    if (!supabase) return;
    const matrix = isDailyResults ? dailyResultsMatrix : modelResultsMatrix;
    const versions = Array.from(
      new Set(
        (matrix?.rows ?? [])
          .flatMap((row) => row?.cells ?? [])
          .flatMap((attemptList) => attemptList ?? [])
          .filter((attempt) => attempt && !isImportedResultsSummaryAttempt(attempt))
          .map((attempt) => String(attempt?.test_version ?? "").trim())
          .filter(Boolean)
      )
    );
    const missing = versions.filter((version) => !attemptQuestionsByVersion[version]);
    if (!missing.length) return;

    let cancelled = false;
    void (async () => {
      const { data, error } = await fetchQuestionsForVersionsWithFallback(supabase, missing);
      if (cancelled || error) {
        if (error) console.error("results matrix question preload error:", error);
        return;
      }
      const grouped = {};
      (data ?? []).forEach((row) => {
        const version = String(row?.test_version ?? "").trim();
        if (!version) return;
        if (!grouped[version]) grouped[version] = [];
        const mapped = mapQuestion(row);
        if (mapped) grouped[version].push(mapped);
      });
      if (!cancelled && Object.keys(grouped).length) {
        setAttemptQuestionsByVersion((current) => ({ ...(current ?? {}), ...grouped }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    dailySubTab,
    modelSubTab,
    dailyResultsMatrix,
    modelResultsMatrix,
    attemptQuestionsByVersion,
    supabase,
    fetchQuestionsForVersionsWithFallback,
  ]);

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
    attempts,
    setAttempts,
    attemptsMsg,
    setAttemptsMsg,
    examLinks,
    setExamLinks,
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
    modelConductError,
    setModelConductError,
    dailyConductError,
    setDailyConductError,

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
    editingTestId,
    setEditingTestId,
    editingTestMsg,
    setEditingTestMsg,
    editingCategorySelect,
    setEditingCategorySelect,
    editingTestForm,
    setEditingTestForm,

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
    dailyCategorySelect,
    setDailyCategorySelect,

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
    modelSessionCategory,
    setModelSessionCategory,
    dailySessionCategory,
    setDailySessionCategory,

    // Computed/Memos
    modelTests,
    dailyTests,
    dailyQuestionSets,
    modelSessions,
    dailySessions,
    filteredModelSessions,
    filteredDailySessions,
    linkBySession,
    selectedSessionDetail,
    pastModelSessions,
    dailyRetakeSessions,
    pastDailySessionCategories,
    selectedPastDailyRetakeCategory,
    filteredPastDailySessions,
    isModelPreview,
    previewDisplayQuestions,
    previewReplacementOrderMap,
    previewSectionBreaks,
    previewSectionTitles,
    testPassRateByVersion: testMetaByVersion,
    testMetaByVersion,
    testSessionsById,
    sessionDetailStudentOptions,
    selectedDailySourceCategoryNames,
    dailyConductTests,
    dailySingleModeTests,
    selectedDailyProblemSetIds,
    selectedDailyQuestionCount,
    dailyCategories,
    modelCategories,
    dailyConductCategories,
    modelConductCategories,
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
    expandedResultCells,
    setExpandedResultCells,
    dailyManualEntryMode,
    setDailyManualEntryMode,
    dailyManualEntryModal,
    setDailyManualEntryModal,
    dailyManualEntryStudent,
    dailyManualEntrySession,
    dailyManualColumnModal,
    setDailyManualColumnModal,
    filteredModelUploadTests,
    groupedModelUploadTests,
    filteredDailyUploadTests,
    groupedDailyUploadTests,
    dailyResultsMatrix,
    modelResultsMatrix,
    dailyResultsSessionHeaderAverages,
    modelResultsSessionHeaderAverages,
    dailyResultsSessionDetailAvailability,
    modelResultsSessionDetailAvailability,
    isImportedSummaryAttempt,

    // Callback functions
    fetchTests,
    fetchTestSessions,
    fetchAssets,
    fetchExamLinks,
    fetchAttempts,
    buildGeneratedDailySessionTitle,
    materializeDailyProblemSet,
    ensureTestRecord,
    createTestSession,
    createDailySession,
    startEditSession,
    cancelEditSession,
    saveSessionEdits,
    startEditTest,
    cancelEditTest,
    saveTestEdits,
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
    getTwelveHourTimeParts,
    buildTwentyFourHourTime,
    formatTwelveHourTimeDisplay,
    selectModelRetakeSource,
    selectDailyRetakeSource,
    updateModelSessionTimePart,
    updateDailySessionTimePart,
    toggleDailySourceCategorySelection,
    toggleDailyProblemSetSelection,

    // Helper functions
    formatDateTime,
    formatDateShort,
    getStudentBaseUrl,
    copyLink,
    formatRatePercent,
    getTabLeftCount,
    attemptCanOpenDetail,
    runSearch,
    exportDailyGoogleSheetsCsv,
    exportModelGoogleSheetsCsv,
    openDailyManualEntryModal,
    closeDailyManualEntryModal,
    saveDailyManualEntry,
    clearDailyManualEntry,
    openDailyManualColumnModal,
    closeDailyManualColumnModal,
    updateDailyManualColumnRateInput,
    saveDailyManualColumn,
    getSectionTitle,
    getQuestionSectionLabel,
    getProblemSetDisplayId,
    normalizeModelCsvKind,
    splitAssetValues,
    isImageAsset,
    isAudioAsset,

    // Constants
    DEFAULT_MODEL_CATEGORY,
    CUSTOM_CATEGORY_OPTION,
    TWELVE_HOUR_TIME_OPTIONS,
    FIVE_MINUTE_MINUTE_OPTIONS,
    MERIDIEM_OPTIONS,

    // Refs
    dailySourceCategoryDropdownRef,
    dailySetDropdownRef,
    assetFolderInputRef,
    dailyFolderInputRef,
    resultsImportInputRef,
    previewSectionRefs,
  };
}
