"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { questions, sections } from "../../../../packages/shared/questions.js";
import { createAdminSupabaseClient, getAdminSupabaseConfig, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";
import { createAdminTrace, isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

const DEFAULT_MODEL_CATEGORY = "Book Review";
const ADMIN_SCHOOL_SCOPE_STORAGE_KEY = "jft_admin_school_scope";
const STUDENT_LIST_SELECT_FIELDS = [
  "id",
  "email",
  "display_name",
  "student_code",
  "phone_number",
  "created_at",
  "is_withdrawn",
  "is_test_account"
].join(", ");
const STUDENT_DETAIL_SELECT_FIELDS = [
  "id",
  "email",
  "role",
  "display_name",
  "student_code",
  "phone_number",
  "date_of_birth",
  "sex",
  "current_working_facility",
  "years_of_experience",
  "nursing_certificate",
  "nursing_certificate_status",
  "bnmc_registration_number",
  "bnmc_registration_expiry_date",
  "passport_number",
  "profile_uploads",
  "created_at",
  "is_withdrawn",
  "is_test_account"
].join(", ");
const CERTIFICATE_STATUS_OPTIONS = [
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" }
];
const SEX_OPTIONS = ["Male", "Female", "Other"];
const PROFILE_UPLOAD_BUCKET = "test-assets";
const PERSONAL_UPLOAD_FIELDS = [
  { key: "passport_bio_page", label: "Bio Page Image", accept: "image/*" }
];
const QUESTION_SELECT_BASE = "id, test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data";
const QUESTION_SELECT_WITH_MEDIA = `${QUESTION_SELECT_BASE}, media_file, media_type`;
const DAILY_RECORD_COMMENT_FIELDS =
  "id, student_id, comment, profiles:student_id(display_name, student_code)";
const ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY = "jft_admin_sidebar_collapsed_v1";

function PasswordVisibilityIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4.3 4.3 3 21 19.7 19.7 21l-2.4-2.4c-1.6.8-3.4 1.4-5.3 1.4-5.5 0-9.6-4.1-10.7-6.6-.2-.4-.2-.8 0-1.1.7-1.7 2.3-3.6 4.6-4.9L3 4.3zm5 5 1.7 1.7a3.9 3.9 0 0 0 4.6 4.6l1.7 1.7c-1 .5-2.1.7-3.4.7a3.9 3.9 0 0 1-3.9-3.9c0-1.3.3-2.4.8-3.4zM12 7.2c1.2 0 2.3.3 3.2.8l-1.7 1.7a3.9 3.9 0 0 0-4.6 4.6L6.2 10c1.5-1.7 3.7-2.8 5.8-2.8zm9.2 4.8c-.5 1.1-1.4 2.4-2.8 3.5l-1.4-1.4c1-.8 1.7-1.7 2.1-2.1-.8-1.6-3.1-4.1-6.1-4.6l-1.8-1.8c4.2.4 7.5 3.2 8.5 4.7.2.4.2.8 0 1.1z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c5.5 0 9.6 4.1 10.7 6.6.2.4.2.8 0 1.1C21.6 15.9 17.5 20 12 20S2.4 15.9 1.3 12.7c-.2-.4-.2-.8 0-1.1C2.4 9.1 6.5 5 12 5zm0 2.2c-4.1 0-7.4 2.9-8.4 4.9 1 2 4.3 4.9 8.4 4.9s7.4-2.9 8.4-4.9c-1-2-4.3-4.9-8.4-4.9zm0 1.8a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z" />
    </svg>
  );
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;
  const match = String(dateOfBirth).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;
  const dayDiff = today.getDate() - day;
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : null;
}

function formatYearsOfExperience(value) {
  if (value == null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return Number.isInteger(num) ? `${num}` : `${num.toFixed(1)}`;
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

function resolveAdminAssetUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const { supabaseUrl: baseUrl } = getAdminSupabaseConfig();
  if (!baseUrl) return raw;
  const encodedPath = raw
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${baseUrl}/storage/v1/object/public/test-assets/${encodedPath}`;
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message ?? "");
  return message.includes(columnName) && message.toLowerCase().includes("does not exist");
}

function isUniqueViolationError(error) {
  return String(error?.code ?? "") === "23505";
}

function normalizeStudentNumberInput(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

async function fetchQuestionsForVersionWithFallback(client, version) {
  let result = await client
    .from("questions")
    .select(QUESTION_SELECT_WITH_MEDIA)
    .eq("test_version", version)
    .order("order_index", { ascending: true });
  if (result.error && (isMissingColumnError(result.error, "media_file") || isMissingColumnError(result.error, "media_type"))) {
    result = await client
      .from("questions")
      .select(QUESTION_SELECT_BASE)
      .eq("test_version", version)
      .order("order_index", { ascending: true });
  }
  return result;
}

async function fetchQuestionsForVersionsWithFallback(client, versions) {
  let result = await client
    .from("questions")
    .select(QUESTION_SELECT_WITH_MEDIA)
    .in("test_version", versions)
    .order("test_version", { ascending: true })
    .order("order_index", { ascending: true });
  if (result.error && (isMissingColumnError(result.error, "media_file") || isMissingColumnError(result.error, "media_type"))) {
    result = await client
      .from("questions")
      .select(QUESTION_SELECT_BASE)
      .in("test_version", versions)
      .order("test_version", { ascending: true })
      .order("order_index", { ascending: true });
  }
  return result;
}

function getProfileUploads(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function buildPersonalInfoPayload(values) {
  const yearsRaw = String(values.years_of_experience ?? "").trim();
  const years = yearsRaw === "" ? null : Number(yearsRaw);
  const normalizedStudentCode = normalizeStudentNumberInput(values.student_code).trim();
  return {
    display_name: String(values.display_name ?? "").trim() || null,
    email: String(values.email ?? "").trim() || null,
    phone_number: String(values.phone_number ?? "").trim() || null,
    date_of_birth: String(values.date_of_birth ?? "").trim() || null,
    sex: String(values.sex ?? "").trim() || null,
    student_code: normalizedStudentCode || null,
    current_working_facility: String(values.current_working_facility ?? "").trim() || null,
    years_of_experience: Number.isFinite(years) ? years : null,
    nursing_certificate: String(values.nursing_certificate ?? "").trim() || null,
    nursing_certificate_status: String(values.nursing_certificate_status ?? "").trim() || null,
    bnmc_registration_number: String(values.bnmc_registration_number ?? "").trim() || null,
    bnmc_registration_expiry_date: String(values.bnmc_registration_expiry_date ?? "").trim() || null,
    passport_number: String(values.passport_number ?? "").trim() || null,
    profile_uploads: getProfileUploads(values.profile_uploads)
  };
}

function getPersonalInfoForm(student) {
  return {
    display_name: student?.display_name ?? "",
    email: student?.email ?? "",
    phone_number: student?.phone_number ?? "",
    date_of_birth: student?.date_of_birth ?? "",
    sex: student?.sex ?? "",
    student_code: student?.student_code ?? "",
    current_working_facility: student?.current_working_facility ?? "",
    years_of_experience: formatYearsOfExperience(student?.years_of_experience),
    nursing_certificate: student?.nursing_certificate ?? "",
    nursing_certificate_status: student?.nursing_certificate_status ?? "",
    bnmc_registration_number: student?.bnmc_registration_number ?? "",
    bnmc_registration_expiry_date: student?.bnmc_registration_expiry_date ?? "",
    passport_number: student?.passport_number ?? "",
    profile_uploads: getProfileUploads(student?.profile_uploads)
  };
}

function hasStudentDetailFields(student) {
  return Boolean(
    student
    && (
      Object.prototype.hasOwnProperty.call(student, "date_of_birth")
      || Object.prototype.hasOwnProperty.call(student, "profile_uploads")
      || Object.prototype.hasOwnProperty.call(student, "nursing_certificate")
      || Object.prototype.hasOwnProperty.call(student, "passport_number")
    )
  );
}

function getFileExtension(filename) {
  const ext = String(filename ?? "").trim().split(".").pop() ?? "";
  return ext.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

async function uploadProfileDocument(supabase, file, userId, uploadKey) {
  if (!supabase || !file || !userId || !uploadKey) return { asset: null, error: null };
  const ext = getFileExtension(file.name) || "jpg";
  const filePath = `profile-documents/${userId}/${uploadKey}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(PROFILE_UPLOAD_BUCKET)
    .upload(filePath, file, { upsert: true, contentType: file.type || undefined });
  if (uploadError) return { asset: null, error: uploadError };
  const { data } = supabase.storage.from(PROFILE_UPLOAD_BUCKET).getPublicUrl(filePath);
  return {
    asset: {
      url: data?.publicUrl ?? "",
      name: file.name,
      mime_type: file.type || null,
      uploaded_at: new Date().toISOString()
    },
    error: null
  };
}

function isImageUpload(asset) {
  const mime = String(asset?.mime_type ?? "").toLowerCase();
  const url = String(asset?.url ?? "").toLowerCase();
  return mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) => url.endsWith(ext));
}

function renderProfileUpload(asset, label) {
  const url = String(asset?.url ?? "").trim();
  if (!url) return "-";
  const name = String(asset?.name ?? label ?? "View file").trim() || "View file";
  return (
    <div className="student-info-image-block">
      <a className="student-info-image-link" href={url} target="_blank" rel="noreferrer">
        {name}
      </a>
      {isImageUpload(asset) ? <img className="student-info-image-preview" src={url} alt={name} /> : null}
    </div>
  );
}

function getTodayDateInput() {
  const today = new Date();
  if (Number.isNaN(today.getTime())) return "";
  return today.toISOString().slice(0, 10);
}

function addDays(dateString, offsetDays) {
  const base = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateString;
  base.setDate(base.getDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function addMonths(dateString, offsetMonths) {
  const match = String(dateString ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateString;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const base = new Date(year, monthIndex, day);
  if (Number.isNaN(base.getTime())) return dateString;
  base.setMonth(base.getMonth() + offsetMonths);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function getWeekdayNumber(dateString) {
  if (!dateString) return null;
  const match = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return date.getDay();
}

function isDefaultDailyRecordHoliday(dateString) {
  const weekday = getWeekdayNumber(dateString);
  return weekday === 5 || weekday === 6;
}

function resolveDailyRecordHoliday(dateString, explicitValue) {
  if (typeof explicitValue === "boolean") return explicitValue;
  return isDefaultDailyRecordHoliday(dateString);
}

function getEmptyDailyRecordPlanDraft() {
  return {
    mini_test_1: "",
    mini_test_2: "",
    special_test_1: "",
  };
}

const DAILY_RECORD_CONTENT_FORMAT = "daily_record_content_v1";
const IRODORI_TEXTBOOK_VALUE = "irodori";
const IRODORI_BOOK_OPTIONS = [
  { value: "starter", label: "Starter" },
  { value: "beginner_1", label: "Beginner 1" },
  { value: "beginner_2", label: "Beginner 2" },
];
const IRODORI_BOOK_LABELS = Object.fromEntries(IRODORI_BOOK_OPTIONS.map((option) => [option.value, option.label]));
const IRODORI_BOOK_ORDER = Object.fromEntries(IRODORI_BOOK_OPTIONS.map((option, index) => [option.value, index]));
const IRODORI_LESSON_OPTIONS = Array.from({ length: 18 }, (_, index) => String(index + 1));

function expandSequentialRange(start, end) {
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => String(start + index));
}

function buildIrodoriCanDoMap(chapterRanges) {
  return Object.fromEntries(
    Object.entries(chapterRanges).map(([lesson, ranges]) => [
      String(lesson),
      ranges.flatMap(([start, end]) => expandSequentialRange(start, end)),
    ])
  );
}

const IRODORI_CANDO_BY_BOOK = {
  starter: buildIrodoriCanDoMap({
    1: [[1, 4]],
    2: [[5, 7]],
    3: [[8, 11]],
    4: [[12, 15]],
    5: [[16, 20]],
    6: [[21, 25]],
    7: [[26, 30]],
    8: [[31, 34]],
    9: [[35, 38]],
    10: [[39, 43]],
    11: [[44, 47]],
    12: [[48, 51]],
    13: [[52, 56]],
    14: [[57, 60]],
    15: [[61, 65]],
    16: [[66, 70]],
    17: [[71, 75]],
    18: [[76, 79]],
  }),
  beginner_1: buildIrodoriCanDoMap({
    1: [[1, 3]],
    2: [[4, 7]],
    3: [[8, 10]],
    4: [[11, 13]],
    5: [[14, 16]],
    6: [[17, 19]],
    7: [[20, 23]],
    8: [[24, 26]],
    9: [[27, 30]],
    10: [[31, 34]],
    11: [[35, 38]],
    12: [[39, 42]],
    13: [[43, 47]],
    14: [[48, 51]],
    15: [[51, 56]],
    16: [[57, 60]],
    17: [[61, 64]],
    18: [[65, 69]],
  }),
  beginner_2: buildIrodoriCanDoMap({
    1: [[1, 4]],
    2: [[5, 8]],
    3: [[9, 13]],
    4: [[14, 18]],
    5: [[19, 22]],
    6: [[23, 27]],
    7: [[28, 31]],
    8: [[33, 37]],
    9: [[38, 42]],
    10: [[43, 46]],
    11: [[47, 50]],
    12: [[51, 54]],
    13: [[55, 59]],
    14: [[60, 63]],
    15: [[64, 67]],
    16: [[68, 72]],
    17: [[73, 75]],
    18: [[76, 78]],
  }),
};

function createDailyRecordCommentRow(studentId = "") {
  return {
    tempId: `comment-${Math.random().toString(36).slice(2, 10)}`,
    student_id: studentId,
    comment: "",
  };
}

function createDailyRecordTextbookRow(book = "starter", lesson = "1") {
  return {
    tempId: `textbook-${Math.random().toString(36).slice(2, 10)}`,
    textbook: IRODORI_TEXTBOOK_VALUE,
    book,
    lesson,
    cando_ids: [],
  };
}

function getIrodoriCanDoOptions(book, lesson) {
  return IRODORI_CANDO_BY_BOOK?.[book]?.[String(lesson)] ?? [];
}

function sanitizeDailyRecordTextbookRow(value) {
  const book = IRODORI_BOOK_LABELS[value?.book] ? value.book : "starter";
  const lesson = IRODORI_LESSON_OPTIONS.includes(String(value?.lesson ?? "")) ? String(value.lesson) : "1";
  const options = new Set(getIrodoriCanDoOptions(book, lesson));
  const candoIds = Array.from(
    new Set((value?.cando_ids ?? value?.candoIds ?? []).map((item) => String(item)).filter((item) => options.has(item)))
  );
  return {
    tempId: value?.tempId || `textbook-${Math.random().toString(36).slice(2, 10)}`,
    textbook: IRODORI_TEXTBOOK_VALUE,
    book,
    lesson,
    cando_ids: candoIds,
  };
}

function parseDailyRecordContent(value) {
  const empty = {
    textbook_entries: [createDailyRecordTextbookRow()],
    free_writing: "",
  };
  const raw = String(value ?? "").trim();
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.format !== DAILY_RECORD_CONTENT_FORMAT) {
      return {
        textbook_entries: [createDailyRecordTextbookRow()],
        free_writing: String(value ?? ""),
      };
    }
    const textbookEntries = Array.isArray(parsed.textbook_entries)
      ? parsed.textbook_entries.map((entry) => sanitizeDailyRecordTextbookRow(entry))
      : [];
    return {
      textbook_entries: textbookEntries.length ? textbookEntries : [createDailyRecordTextbookRow()],
      free_writing: String(parsed.free_writing ?? ""),
    };
  } catch {
    return {
      textbook_entries: [createDailyRecordTextbookRow()],
      free_writing: String(value ?? ""),
    };
  }
}

function serializeDailyRecordContent(form) {
  const textbookEntries = (form?.textbook_entries ?? [])
    .map((entry) => sanitizeDailyRecordTextbookRow(entry))
    .map(({ textbook, book, lesson, cando_ids }) => ({ textbook, book, lesson, cando_ids }))
    .filter((entry) => entry.cando_ids.length);
  const freeWriting = String(form?.free_writing ?? "").trim();
  if (!textbookEntries.length && !freeWriting) return null;
  return JSON.stringify({
    format: DAILY_RECORD_CONTENT_FORMAT,
    textbook_entries: textbookEntries,
    free_writing: freeWriting,
  });
}

function summarizeDailyRecordContent(value) {
  const content = parseDailyRecordContent(value);
  const textbookSummary = (content.textbook_entries ?? [])
    .filter((entry) => entry.cando_ids.length)
    .map((entry) => `${IRODORI_BOOK_LABELS[entry.book] || entry.book} Lesson ${entry.lesson}: Can-do ${entry.cando_ids.join(", ")}`);
  const parts = [];
  if (textbookSummary.length) parts.push(`Irodori - ${textbookSummary.join(" | ")}`);
  if (content.free_writing.trim()) parts.push(content.free_writing.trim());
  return parts.join(" | ");
}

function getLargestDailyRecordTextbookEntry(value) {
  const entries = parseDailyRecordContent(value).textbook_entries ?? [];
  return entries.reduce((largest, entry) => {
    if (!largest) return entry;
    const largestBookOrder = IRODORI_BOOK_ORDER[largest.book] ?? -1;
    const entryBookOrder = IRODORI_BOOK_ORDER[entry.book] ?? -1;
    if (entryBookOrder !== largestBookOrder) {
      return entryBookOrder > largestBookOrder ? entry : largest;
    }
    return Number(entry.lesson) > Number(largest.lesson) ? entry : largest;
  }, null);
}

function getEmptyDailyRecordForm(recordDate = "") {
  return {
    id: "",
    record_date: recordDate,
    textbook_entries: [createDailyRecordTextbookRow()],
    free_writing: "",
    comments: [createDailyRecordCommentRow("")]
  };
}

function getDailyRecordForm(record) {
  if (!record) return getEmptyDailyRecordForm("");
  const content = parseDailyRecordContent(record?.todays_content);
  const comments = (record.daily_record_student_comments ?? []).length
    ? record.daily_record_student_comments.map((item) => ({
        tempId: item.id ?? `comment-${Math.random().toString(36).slice(2, 10)}`,
        id: item.id ?? "",
        student_id: item.student_id ?? "",
        comment: item.comment ?? "",
      }))
    : [createDailyRecordCommentRow("")];
  return {
    id: record.id ?? "",
    record_date: record.record_date ?? "",
    textbook_entries: content.textbook_entries,
    free_writing: content.free_writing,
    comments,
  };
}

function buildDailyRecordPlanDrafts(records) {
  const drafts = {};
  (records ?? []).forEach((record) => {
    if (!record?.record_date) return;
    drafts[record.record_date] = {
      mini_test_1: record.mini_test_1 ?? "",
      mini_test_2: record.mini_test_2 ?? "",
      special_test_1: record.special_test_1 ?? "",
    };
  });
  return drafts;
}

function summarizeDailyRecordComments(record) {
  const comments = record?.daily_record_student_comments ?? [];
  if (!comments.length) return "-";
  const names = comments
    .map((item) => item?.profiles?.display_name || item?.profiles?.student_code || "")
    .filter(Boolean)
    .slice(0, 3);
  const suffix = comments.length > names.length ? ` +${comments.length - names.length}` : "";
  return `${comments.length} comment${comments.length > 1 ? "s" : ""}${names.length ? `: ${names.join(", ")}${suffix}` : ""}`;
}

function getRankingDrafts(periods) {
  const drafts = {};
  (periods ?? []).forEach((period) => {
    if (!period?.id) return;
    drafts[period.id] = {
      label: period.label ?? "",
      start_date: period.start_date ?? "",
      end_date: period.end_date ?? "",
    };
  });
  return drafts;
}

function getDefaultStudentWarningForm(filters = {}) {
  return {
    title: "",
    from: filters.from ?? "",
    to: filters.to ?? "",
    maxAttendance: "",
    minUnexcused: "",
    maxModelAvg: "",
    maxDailyAvg: "",
  };
}

function normalizeStudentWarningCriteria(criteria = {}) {
  const normalizeNumber = (value) => {
    if (value === "" || value == null) return "";
    const number = Number(value);
    return Number.isFinite(number) ? number : "";
  };

  return {
    title: String(criteria.title ?? "").trim(),
    from: String(criteria.from ?? "").trim(),
    to: String(criteria.to ?? "").trim(),
    maxAttendance: normalizeNumber(criteria.maxAttendance),
    minUnexcused: normalizeNumber(criteria.minUnexcused),
    maxModelAvg: normalizeNumber(criteria.maxModelAvg),
    maxDailyAvg: normalizeNumber(criteria.maxDailyAvg),
  };
}

function getStudentWarningMetricRangeKey(criteria = {}) {
  return `${String(criteria.from ?? "").trim()}::${String(criteria.to ?? "").trim()}`;
}

function normalizeWarningIssueList(list) {
  return (Array.isArray(list) ? list : []).map((item) => String(item ?? "").trim()).filter(Boolean);
}

function warningRecipientsMatch(leftList = [], rightList = []) {
  if (leftList.length !== rightList.length) return false;
  const leftMap = new Map(
    leftList.map((item) => [
      String(item?.student_id ?? ""),
      JSON.stringify(normalizeWarningIssueList(item?.issues).sort()),
    ])
  );
  return rightList.every((item) => {
    const studentId = String(item?.student_id ?? "");
    return leftMap.get(studentId) === JSON.stringify(normalizeWarningIssueList(item?.issues).sort());
  });
}

function buildAttendancePieData(stats) {
  const presentCount = Math.max(0, Number(stats?.present ?? 0) - Number(stats?.late ?? 0));
  const lateCount = Math.max(0, Number(stats?.late ?? 0));
  const excusedCount = Math.max(0, Number(stats?.excused ?? 0));
  const unexcusedCount = Math.max(0, Number(stats?.unexcused ?? 0));
  const totalCount = presentCount + lateCount + excusedCount + unexcusedCount;
  const rateValue = totalCount ? ((presentCount + lateCount) / totalCount) * 100 : 0;
  const segments = [
    { key: "present", label: "P", name: "Present", value: presentCount, color: "#22c55e" },
    { key: "late", label: "L", name: "Late/Leave Early", value: lateCount, color: "#2563eb" },
    { key: "excused", label: "E", name: "Excused Absence", value: excusedCount, color: "#f59e0b" },
    { key: "unexcused", label: "A", name: "Unexcused Absence", value: unexcusedCount, color: "#ef4444" },
  ];

  let stopAcc = 0;
  const pieStops = totalCount
    ? segments
        .map((segment) => {
          const start = stopAcc;
          const portion = (segment.value / totalCount) * 100;
          stopAcc += portion;
          return `${segment.color} ${start.toFixed(2)}% ${stopAcc.toFixed(2)}%`;
        })
        .join(", ")
    : "#e5e7eb 0% 100%";

  let angleAcc = 0;
  const pieLabels = totalCount
    ? segments
        .filter((segment) => segment.value > 0)
        .map((segment) => {
          const portion = (segment.value / totalCount) * 360;
          const mid = angleAcc + portion / 2;
          angleAcc += portion;
          const rad = (mid - 90) * (Math.PI / 180);
          return {
            key: segment.key,
            label: segment.label,
            x: Math.cos(rad) * 78,
            y: Math.sin(rad) * 78,
          };
        })
    : [];

  return {
    rateValue,
    segments,
    pieStops,
    pieLabels,
  };
}

function buildAttendanceSummary(list) {
  const rows = list ?? [];
  const monthKeys = Array.from(
    new Set(
      rows
        .map((row) => String(row.day_date || ""))
        .filter(Boolean)
        .map((date) => date.slice(0, 7))
    )
  ).sort();

  const calc = (items) => {
    const total = items.length;
    const present = items.filter((item) => item.status === "P" || item.status === "L").length;
    const late = items.filter((item) => item.status === "L").length;
    const excused = items.filter((item) => item.status === "E").length;
    const unexcused = items.filter((item) => item.status === "A").length;
    const rate = total ? (present / total) * 100 : null;
    return { total, present, late, excused, unexcused, rate };
  };

  const overall = calc(rows);
  const months = monthKeys.map((key, idx) => {
    const monthRows = rows.filter((item) => String(item.day_date || "").startsWith(key));
    const stats = calc(monthRows);
    const parts = key.split("-");
    const labelMonth = parts.length === 2
      ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString(undefined, { month: "short" })
      : key;
    return {
      key,
      label: `Month ${idx + 1} (${labelMonth})`,
      stats,
    };
  });

  return { overall, months };
}

function isMissingStudentWarningsTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /(student_warnings|student_warning_recipients)/i.test(text) && /does not exist/i.test(text);
}

function summarizeWarningCriteria(criteria) {
  const items = [];
  if (criteria?.maxAttendance !== "" && criteria?.maxAttendance != null) {
    items.push(`Attendance <= ${criteria.maxAttendance}%`);
  }
  if (criteria?.minUnexcused !== "" && criteria?.minUnexcused != null) {
    items.push(`Unexcused >= ${criteria.minUnexcused}`);
  }
  if (criteria?.maxModelAvg !== "" && criteria?.maxModelAvg != null) {
    items.push(`Model Avg <= ${criteria.maxModelAvg}%`);
  }
  if (criteria?.maxDailyAvg !== "" && criteria?.maxDailyAvg != null) {
    items.push(`Daily Avg <= ${criteria.maxDailyAvg}%`);
  }
  if (criteria?.from || criteria?.to) {
    items.push(`Range: ${criteria.from || "Any"} to ${criteria.to || "Any"}`);
  }
  return items;
}

function getStudentWarningIssues(row, criteria) {
  const issues = [];
  const maxAttendance = criteria.maxAttendance === "" ? null : Number(criteria.maxAttendance);
  const minUnexcused = criteria.minUnexcused === "" ? null : Number(criteria.minUnexcused);
  const maxModelAvg = criteria.maxModelAvg === "" ? null : Number(criteria.maxModelAvg);
  const maxDailyAvg = criteria.maxDailyAvg === "" ? null : Number(criteria.maxDailyAvg);

  if (maxAttendance != null) {
    const rate = row.attendanceRate ?? 0;
    if (rate <= maxAttendance) issues.push(`Attendance ${rate.toFixed(1)}% <= ${maxAttendance}%`);
  }
  if (minUnexcused != null && (row.unexcused ?? 0) >= minUnexcused) {
    issues.push(`Unexcused ${row.unexcused ?? 0} >= ${minUnexcused}`);
  }
  if (maxModelAvg != null) {
    const value = row.modelAvg ?? 0;
    if (value <= maxModelAvg) issues.push(`Model Avg ${value.toFixed(1)}% <= ${maxModelAvg}%`);
  }
  if (maxDailyAvg != null) {
    const value = row.dailyAvg ?? 0;
    if (value <= maxDailyAvg) issues.push(`Daily Avg ${value.toFixed(1)}% <= ${maxDailyAvg}%`);
  }
  return issues;
}

function buildStudentMetricRows(sortedStudents, attendanceMap, attemptsList, testMetaByVersion) {
  const byStudent = new Map();
  Array.from(buildLatestAttemptMapByStudentAndScope(attemptsList).values()).forEach((attempt) => {
    if (!attempt?.student_id) return;
    const list = byStudent.get(attempt.student_id) || [];
    list.push(attempt);
    byStudent.set(attempt.student_id, list);
  });

  return (sortedStudents ?? []).map((student) => {
    const attendance = attendanceMap?.[student.id] || { total: 0, present: 0, unexcused: 0, rate: null };
    const studentAttempts = byStudent.get(student.id) || [];
    const modelScores = [];
    const dailyScores = [];
    studentAttempts.forEach((attempt) => {
      const meta = testMetaByVersion?.[attempt.test_version];
      if (!meta?.type) return;
      const rate = getScoreRate(attempt) * 100;
      if (meta.type === "mock") modelScores.push(rate);
      if (meta.type === "daily") dailyScores.push(rate);
    });
    return {
      student,
      attendanceRate: attendance.rate,
      unexcused: attendance.unexcused ?? 0,
      modelAvg: modelScores.length ? modelScores.reduce((acc, rate) => acc + rate, 0) / modelScores.length : null,
      dailyAvg: dailyScores.length ? dailyScores.reduce((acc, rate) => acc + rate, 0) / dailyScores.length : null,
    };
  });
}

function toCsv(rows) {
  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(escapeCell).join(",")).join("\n");
}

const ATTENDANCE_EXPORT_RULES = [
  "1. If you skip the class without any notification for 3 times, you will be eliminated.",
  "2. If you skip classes, please practice that part by yourself. We don't conduct the same class again for you.",
  "3. If your attendance rate is less than 75%, we will ask you if you would like to continue or quit. If you don't have a strong will to continue, you will be eliminated.",
  "4. We will call you one by one if you are absent without any reason.",
];
const ATTENDANCE_COUNTED_STATUSES = ["P", "L", "E", "A"];
const ATTENDANCE_SUPPORTED_STATUSES = [...ATTENDANCE_COUNTED_STATUSES, "N/A", "W"];
const IMPORTED_ATTEMPT_BATCH_SIZE = 250;
const IMPORTED_ATTEMPT_QUERY_BATCH_SIZE = 50;

function padCsvRow(row, length) {
  const next = [...(row ?? [])];
  while (next.length < length) next.push("");
  return next;
}

function chunkItems(items, size) {
  const list = Array.isArray(items) ? items : [];
  const chunkSize = Math.max(1, Number(size) || 1);
  const chunks = [];
  for (let index = 0; index < list.length; index += chunkSize) {
    chunks.push(list.slice(index, index + chunkSize));
  }
  return chunks;
}

function formatPercentNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(digits)}%`;
}

function formatRatePercent(rate, digits = 2) {
  const number = Number(rate);
  if (!Number.isFinite(number)) return "-";
  return formatPercentNumber(number * 100, digits);
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

function formatMonthDayCompact(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${Number(match[2])}/${Number(match[3])}`;
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatBooleanCsv(value) {
  return value ? "TRUE" : "FALSE";
}

function normalizeLookupValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function rowHasCsvValues(row) {
  return Array.isArray(row) && row.some((cell) => String(cell ?? "").trim());
}

function normalizeAttendanceStatusToken(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  if (compact === "NA" || compact === "N/A") return "N/A";
  return compact;
}

function normalizeAttendanceImportStatus(value) {
  const token = normalizeAttendanceStatusToken(value);
  if (!token) return "N/A";
  return ATTENDANCE_SUPPORTED_STATUSES.includes(token) ? token : "";
}

function isCountedAttendanceStatus(value) {
  return ATTENDANCE_COUNTED_STATUSES.includes(normalizeAttendanceStatusToken(value));
}

function getAttendanceStatusClassName(value, prefix = "att") {
  const token = normalizeAttendanceStatusToken(value);
  if (!token) return "";
  const suffixMap = {
    P: "P",
    L: "L",
    E: "E",
    A: "A",
    "N/A": "NA",
    W: "W",
  };
  const suffix = suffixMap[token];
  return suffix ? `${prefix}-${suffix}` : "";
}

function detectAttendanceImportLayout(rows) {
  const headerRow = Array.isArray(rows?.[0]) ? rows[0] : [];
  if (!headerRow.length) return null;

  const normalizedHeader = headerRow.map((cell) => normalizeLookupValue(cell));
  const findHeaderIndex = (...labels) => normalizedHeader.findIndex((cell) => labels.includes(cell));

  const rowNumberIndex = findHeaderIndex("vb/w");
  const nameIndex = findHeaderIndex("student name");
  const sectionIndex = findHeaderIndex("section");
  const emailIndex = findHeaderIndex("email address", "email");
  const withdrawnIndex = findHeaderIndex("withdrawn");
  const ruleIndex = rowNumberIndex >= 0 ? rowNumberIndex : 0;
  let dayStartIndex = withdrawnIndex >= 0 ? withdrawnIndex + 1 : -1;

  if (dayStartIndex === -1) {
    dayStartIndex = headerRow.findIndex((cell, index) => {
      if (index <= Math.max(rowNumberIndex, nameIndex, sectionIndex, emailIndex)) return false;
      return Boolean(parseSlashDateShortYearToIso(cell));
    });
  }

  const dayColumns = [];
  if (dayStartIndex >= 0) {
    for (let col = dayStartIndex; col < headerRow.length; col += 1) {
      const dayDate = parseSlashDateShortYearToIso(headerRow[col]);
      if (dayDate) {
        dayColumns.push({ colIndex: col, dayDate });
      }
    }
  }

  return {
    rowNumberIndex,
    nameIndex,
    sectionIndex,
    emailIndex,
    ruleIndex,
    dayColumns,
  };
}

function parsePercentCell(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || /^n\/a$/i.test(text)) return null;
  const normalized = text.replace(/,/g, "").replace(/%/g, "").trim();
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  return number > 1 ? number / 100 : number;
}

function parseScoreFractionCell(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || /^n\/a$/i.test(text)) return null;
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const correct = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0) return null;
  return { correct, total };
}

function parseSlashDateShortYearToIso(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i, "");
  let match = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const rawYear = Number(match[3]);
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(rawYear)) return "";
    const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  match = compact.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!match) return "";
  const rawYear = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(rawYear)) return "";
  const year = rawYear;
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractIsoDatePart(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function hasDailyResultValues(rows, colIndex, startRowIndex = 0) {
  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    if (parsePercentCell(rows[rowIndex]?.[colIndex]) != null) return true;
  }
  return false;
}

function hasModelResultValues(rows, block, startRowIndex = 0) {
  if (!block?.total) return false;
  for (let rowIndex = startRowIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    if (
      parsePercentCell(row[block.total.rateColumnIndex]) != null
      || parseScoreFractionCell(row[block.total.scoreColumnIndex])
    ) {
      return true;
    }
  }
  return false;
}

function normalizePassRate(value, fallback = 0.8) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : fallback;
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

function isImportedSummaryAttempt(attempt) {
  return Boolean(attempt?.answers_json?.__meta?.imported_summary);
}

function isImportedModelResultsSummaryAttempt(attempt) {
  return isImportedSummaryAttempt(attempt)
    && String(attempt?.answers_json?.__meta?.imported_source ?? "") === "model_results_csv";
}

function isImportedResultsSummaryAttempt(attempt) {
  const source = String(attempt?.answers_json?.__meta?.imported_source ?? "");
  return isImportedSummaryAttempt(attempt)
    && (source === "daily_results_csv" || source === "model_results_csv");
}

function getImportedModelSectionSummaries(attempt) {
  const rows = Array.isArray(attempt?.answers_json?.__meta?.main_section_summary)
    ? attempt.answers_json.__meta.main_section_summary
    : [];
  const orderMap = new Map(
    sections
      .filter((section) => section.key !== "DAILY")
      .map((section, index) => [getSectionTitle(section.key), index])
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

function attemptHasDetailData(attempt) {
  if (!attempt || isImportedSummaryAttempt(attempt)) return false;
  if (!attempt.answers_json || typeof attempt.answers_json !== "object") return false;
  return Object.keys(attempt.answers_json).some((key) => key !== "__meta");
}

function attemptCanOpenDetail(attempt) {
  return attemptHasDetailData(attempt) || isImportedSummaryAttempt(attempt);
}

function createImportedStudentMatcher(studentsList) {
  const students = Array.isArray(studentsList) ? studentsList : [];
  const emailMap = new Map();
  const nameSectionMap = new Map();

  students.forEach((student) => {
    const emailKey = normalizeLookupValue(student?.email);
    if (emailKey) emailMap.set(emailKey, student);
    const nameSectionKey = `${normalizeLookupValue(student?.display_name)}::${normalizeLookupValue(getStudentSectionValue(student))}`;
    if (!nameSectionMap.has(nameSectionKey)) {
      nameSectionMap.set(nameSectionKey, []);
    }
    nameSectionMap.get(nameSectionKey).push(student);
  });

  return ({ rowNumber, name, section, email }) => {
    const emailKey = normalizeLookupValue(email);
    if (emailKey && emailMap.has(emailKey)) return emailMap.get(emailKey);

    const normalizedName = normalizeLookupValue(name);
    const normalizedSection = normalizeLookupValue(section);
    const indexedStudent = Number.isFinite(rowNumber) && rowNumber > 0 ? students[rowNumber - 1] ?? null : null;
    if (indexedStudent) {
      const indexedName = normalizeLookupValue(indexedStudent.display_name);
      const indexedSection = normalizeLookupValue(getStudentSectionValue(indexedStudent));
      const nameMatches = !normalizedName || indexedName === normalizedName;
      const sectionMatches = !normalizedSection || indexedSection === normalizedSection;
      if (nameMatches && sectionMatches) return indexedStudent;
    }

    const byNameSection = nameSectionMap.get(`${normalizedName}::${normalizedSection}`) ?? [];
    if (byNameSection.length === 1) return byNameSection[0];
    if (byNameSection.length > 1 && indexedStudent) return indexedStudent;

    if (normalizedName) {
      const byNameOnly = students.filter((student) => normalizeLookupValue(student?.display_name) === normalizedName);
      if (byNameOnly.length === 1) return byNameOnly[0];
      if (byNameOnly.length > 1 && indexedStudent) return indexedStudent;
    }

    return indexedStudent;
  };
}

function createAttendanceImportedStudentMatcher(studentsList) {
  const fallbackMatch = createImportedStudentMatcher(studentsList);
  const students = Array.isArray(studentsList) ? studentsList : [];
  const nameSectionMap = new Map();
  const nameMap = new Map();
  const emailMap = new Map();

  students.forEach((student) => {
    const normalizedName = normalizeLookupValue(student?.display_name);
    const normalizedSection = normalizeLookupValue(getStudentSectionValue(student));
    const normalizedEmail = normalizeLookupValue(student?.email);
    const nameSectionKey = `${normalizedName}::${normalizedSection}`;
    if (!nameSectionMap.has(nameSectionKey)) nameSectionMap.set(nameSectionKey, []);
    nameSectionMap.get(nameSectionKey).push(student);
    if (!nameMap.has(normalizedName)) nameMap.set(normalizedName, []);
    nameMap.get(normalizedName).push(student);
    if (normalizedEmail && !emailMap.has(normalizedEmail)) emailMap.set(normalizedEmail, student);
  });

  return ({ rowNumber, name, section, email }) => {
    const normalizedName = normalizeLookupValue(name);
    const normalizedSection = normalizeLookupValue(section);
    const normalizedEmail = normalizeLookupValue(email);

    if (normalizedName) {
      const byNameSection = nameSectionMap.get(`${normalizedName}::${normalizedSection}`) ?? [];
      if (byNameSection.length === 1) return byNameSection[0];

      const byName = nameMap.get(normalizedName) ?? [];
      if (byName.length === 1) return byName[0];

      if (normalizedEmail && emailMap.has(normalizedEmail)) {
        const emailMatch = emailMap.get(normalizedEmail);
        if (byName.includes(emailMatch)) return emailMatch;
      }
    }

    if (normalizedEmail && emailMap.has(normalizedEmail)) {
      return emailMap.get(normalizedEmail);
    }

    return fallbackMatch({ rowNumber, name, section, email });
  };
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

function dedupeImportedAttemptPayloads(payloads) {
  const payloadMap = new Map();
  (payloads ?? []).forEach((payload) => {
    const key = `${payload.student_id}::${payload.test_session_id}`;
    payloadMap.set(key, payload);
  });
  return Array.from(payloadMap.values());
}

function formatPercentInputValue(rate) {
  const number = Number(rate);
  if (!Number.isFinite(number)) return "";
  const percent = number * 100;
  return Number.isInteger(percent) ? `${percent}` : percent.toFixed(1).replace(/\.0$/, "");
}

function sanitizeImportedCategorySlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "category";
}

function buildImportedResultTestVersion(type, categoryName, index = 0) {
  return `imported-${type}-${sanitizeImportedCategorySlug(categoryName)}-${Date.now()}-${index + 1}`;
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

function parseModelExportLabel(label) {
  const raw = String(label ?? "").trim();
  if (!raw) return { groupLabel: "", partLabel: "", partCode: "" };
  const match = raw.match(/^(.*?)(?:[\s_-]*|\s*\()((?:CE|SV|LC|RC))\)?$/i);
  if (!match) {
    return { groupLabel: raw, partLabel: raw, partCode: "" };
  }
  return {
    groupLabel: String(match[1] ?? "").trim() || raw,
    partLabel: raw,
    partCode: String(match[2] ?? "").toUpperCase(),
  };
}

function normalizeImportedModelSectionTitle(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  const matchedSection = sections.find((section) => {
    return section.key !== "DAILY"
      && (
        normalizeLookupValue(section.key) === normalizeLookupValue(raw)
        || normalizeLookupValue(section.title) === normalizeLookupValue(raw)
      );
  });
  if (matchedSection) return matchedSection.title;

  const parsed = parseModelExportLabel(raw);
  if (parsed.partCode) return getSectionTitle(parsed.partCode);

  return raw;
}

function buildAttendanceStats(statuses) {
  const marked = (statuses ?? []).map(normalizeAttendanceStatusToken).filter(isCountedAttendanceStatus);
  const total = marked.length;
  const present = marked.filter((status) => status === "P" || status === "L").length;
  const unexcused = marked.filter((status) => status === "A").length;
  return {
    total,
    present,
    unexcused,
    rate: total ? present / total : null,
  };
}

function getSectionTitle(sectionKey) {
  return sections.find((s) => s.key === sectionKey)?.title ?? sectionKey ?? "";
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

function getQuestionSectionLabel(question) {
  return formatSubSectionLabel(question?.sectionLabel) || getSectionTitle(question?.sectionKey);
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

function buildSourceQuestionKey(sourceVersion, sourceQuestionId) {
  return `${String(sourceVersion ?? "").trim()}::${String(sourceQuestionId ?? "").trim()}`;
}

function isRetakeSessionTitle(title) {
  return String(title ?? "").trim().startsWith("[Retake]");
}

function buildRetakeTitle(title) {
  const baseTitle = String(title ?? "").trim();
  if (!baseTitle) return "[Retake]";
  return isRetakeSessionTitle(baseTitle) ? baseTitle : `[Retake] ${baseTitle}`;
}

function getRetakeBaseTitle(title) {
  return String(title ?? "").trim().replace(/^\[Retake\]\s*/i, "").trim();
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

function isAnalyticsExcludedStudent(student) {
  return Boolean(student?.is_withdrawn || student?.is_test_account);
}

function renderTwoLineHeader(title) {
  const text = String(title ?? "");
  const idx = text.lastIndexOf(" ");
  if (idx <= 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <br />
      {text.slice(idx + 1)}
    </>
  );
}

function getChoiceText(q, idx) {
  if (idx == null) return "";
  if (Array.isArray(q.choices) && q.choices[idx] != null) return q.choices[idx];
  if (Array.isArray(q.choicesJa) && q.choicesJa[idx] != null) return q.choicesJa[idx];
  if (Array.isArray(q.choicesEn) && q.choicesEn[idx] != null) return q.choicesEn[idx];
  return `#${Number(idx) + 1}`;
}

function getChoiceImage(q, idx) {
  if (idx == null) return "";
  if (Array.isArray(q.choiceImages) && q.choiceImages[idx]) return q.choiceImages[idx];
  const value =
    (Array.isArray(q.choices) && q.choices[idx] != null ? q.choices[idx] : null)
    ?? (Array.isArray(q.choicesJa) && q.choicesJa[idx] != null ? q.choicesJa[idx] : null)
    ?? (Array.isArray(q.choicesEn) && q.choicesEn[idx] != null ? q.choicesEn[idx] : null)
    ?? "";
  return isImageAsset(value) ? value : "";
}

function getPartChoiceText(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choicesJa) && part.choicesJa[idx] != null) return part.choicesJa[idx];
  return `#${Number(idx) + 1}`;
}

function getPartChoiceImage(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choiceImages) && part.choiceImages[idx]) return part.choiceImages[idx];
  const value =
    (Array.isArray(part.choices) && part.choices[idx] != null ? part.choices[idx] : null)
    ?? (Array.isArray(part.choicesJa) && part.choicesJa[idx] != null ? part.choicesJa[idx] : null)
    ?? "";
  return isImageAsset(value) ? value : "";
}

function getPromptText(q) {
  if (q.boxText) return q.boxText;
  if (q.stemText) return q.stemText;
  if (q.stemExtra) return q.stemExtra;
  if (q.type === "mcq_sentence_blank") return q.sentenceJa ?? q.promptEn ?? "";
  if (q.type === "mcq_kanji_reading") return q.sentencePartsJa?.map((p) => p.text).join("") ?? q.promptEn ?? "";
  if (q.type === "mcq_dialog_with_image") return q.dialogJa?.join(" / ") ?? q.promptEn ?? "";
  return q.promptEn ?? "";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderUnderlinesHtml(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : '<span class="blank-red"></span>'))
    .replace(/［[\s\u3000]*］|\[[\s\u3000]*\]/g, '<span class="blank-red"></span>');
}

function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitStemLinesPreserveIndent(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.replace(/\s+$/g, ""))
    .filter((s) => s.trim().length);
}

function splitTextBoxStemLines(text) {
  const baseLines = splitStemLinesPreserveIndent(text);
  const expanded = [];
  for (const line of baseLines) {
    const speakerMatches = Array.from(
      String(line).matchAll(/(?:^|\s+)([^:：\s]{1,20}[：:].*?)(?=(?:\s+[^:：\s]{1,20}[：:])|$)/g)
    )
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean);
    if (speakerMatches.length >= 2) {
      expanded.push(...speakerMatches);
      continue;
    }
    expanded.push(line);
  }
  return expanded;
}

function parseSpeakerStemLine(line) {
  const match = String(line ?? "").match(/^\s*([^:：]+?)([:：])(.*)$/);
  if (!match) return null;
  return {
    speaker: String(match[1] ?? "").trim(),
    delimiter: match[2] ?? "：",
    body: String(match[3] ?? "").replace(/^\s+/g, ""),
  };
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

function parseModelQuestionId(rawValue) {
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

const MODEL_SUB_SECTION_TO_SECTION_KEY = {
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

function resolveModelSectionKey(qid, subSection) {
  const parsed = parseModelQuestionId(qid);
  if (sections.some((section) => section.key === parsed.sectionPrefix)) {
    return parsed.sectionPrefix;
  }
  return MODEL_SUB_SECTION_TO_SECTION_KEY[String(subSection ?? "").trim().toLowerCase()] || "SV";
}

const MODEL_SECTION_ORDER = {
  SV: 1,
  CE: 2,
  LC: 3,
  RC: 4,
};

function computeModelOrderIndex(qid, fallbackIndex, sectionKey = "SV") {
  const parsed = parseModelQuestionId(qid);
  const sectionOffset = (MODEL_SECTION_ORDER[String(sectionKey ?? "").trim().toUpperCase()] ?? 9) * 100000;
  if (Number.isFinite(parsed.mainNumber)) {
    return sectionOffset + parsed.mainNumber * 100 + (Number.isFinite(parsed.subNumber) ? parsed.subNumber : 0);
  }
  return sectionOffset + fallbackIndex;
}

function inferModelQuestionType({ sectionKey, stemKind, stemText, stemImage, stemAudio, subQuestion, optionType }) {
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

function normalizeModelCsvKind(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s/+]+/g, "_");
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

function resolveModelStemAssets(stemKindInput, stemImageInput, stemAudioInput) {
  const stemImage = normalizeCsvValue(stemImageInput) || null;
  const stemAudio = normalizeCsvValue(stemAudioInput) || null;
  const normalizedStemKind = normalizeModelCsvKind(stemKindInput);

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

function isModelOptionImageType(optionType) {
  return normalizeModelCsvKind(optionType) === "image";
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

function getQuestionIllustration(question) {
  if (!question) return null;
  const stemAsset =
    question.stemAsset ||
    question.image ||
    question.stemImage ||
    question.passageImage ||
    question.tableImage ||
    question.stem_image ||
    question.stem_image_url ||
    null;
  const imageAsset = splitAssetValues(stemAsset).find((value) => isImageAsset(value));
  if (imageAsset) return imageAsset;
  return null;
}

function getQuestionStemMedia(question) {
  const stemValues = joinAssetValues(
    question?.stemAsset,
    question?.image,
    question?.stemImage,
    question?.stemAudio,
    question?.passageImage,
    question?.tableImage,
    question?.stem_image,
    question?.stem_image_url
  );
  const assets = splitAssetValues(stemValues);
  return {
    images: assets.filter((value) => isImageAsset(value)),
    audios: assets.filter((value) => isAudioAsset(value)),
  };
}

function mapDbQuestion(row) {
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

function buildAttemptDetailRows(answersJson) {
  const answers = answersJson ?? {};
  const rows = [];

  for (const q of questions) {
    const stemMedia = getQuestionStemMedia(q);
    if (q.parts?.length) {
      const ans = answers[q.id];
      q.parts.forEach((part, i) => {
        const chosenIdx = ans?.partAnswers?.[i];
        const correctIdx = part.answerIndex;
        rows.push({
          qid: `${q.id}-${i + 1}`,
          sectionKey: q.sectionKey || "",
          section: getQuestionSectionLabel(q),
          prompt: `${q.promptEn ?? ""} ${part.partLabel ?? ""} ${part.questionJa ?? ""}`.trim(),
          image: getQuestionIllustration(q),
          stemImages: stemMedia.images,
          stemAudios: stemMedia.audios,
          chosen: getPartChoiceText(part, chosenIdx),
          chosenImage: getPartChoiceImage(part, chosenIdx),
          correct: getPartChoiceText(part, correctIdx),
          correctImage: getPartChoiceImage(part, correctIdx),
          isCorrect: chosenIdx === correctIdx
        });
      });
      continue;
    }

    const chosenIdx = answers[q.id];
    const correctIdx = q.answerIndex;
    rows.push({
      qid: String(q.id),
      sectionKey: q.sectionKey || "",
      section: getQuestionSectionLabel(q),
      prompt: getPromptText(q),
      image: getQuestionIllustration(q),
      stemImages: stemMedia.images,
      stemAudios: stemMedia.audios,
      chosen: getChoiceText(q, chosenIdx),
      chosenImage: getChoiceImage(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),
      correctImage: getChoiceImage(q, correctIdx),
      isCorrect: chosenIdx === correctIdx
    });
  }

  return rows;
}

function buildAttemptDetailRowsFromList(answersJson, questionsList) {
  const answers = answersJson ?? {};
  const rows = [];
  for (const q of questionsList ?? []) {
    const stemMedia = getQuestionStemMedia(q);
    if (q.parts?.length) {
      const ans = answers[q.id];
      q.parts.forEach((part, i) => {
        const chosenIdx = ans?.partAnswers?.[i];
        const correctIdx = part.answerIndex;
      rows.push({
        qid: `${q.id}-${i + 1}`,
        sectionKey: q.sectionKey || "",
        section: getQuestionSectionLabel(q),
        prompt: `${q.promptEn ?? ""} ${part.partLabel ?? ""} ${part.questionJa ?? ""}`.trim(),
        image: getQuestionIllustration(q),
        stemImages: stemMedia.images,
        stemAudios: stemMedia.audios,
        chosen: getPartChoiceText(part, chosenIdx),
        chosenImage: getPartChoiceImage(part, chosenIdx),
        correct: getPartChoiceText(part, correctIdx),
        correctImage: getPartChoiceImage(part, correctIdx),
        isCorrect: chosenIdx === correctIdx
      });
      });
      continue;
    }

    const chosenIdx = answers[q.id];
    const correctIdx = q.answerIndex;
    rows.push({
      qid: String(q.id),
      sectionKey: q.sectionKey || "",
      section: getQuestionSectionLabel(q),
      prompt: getPromptText(q),
      image: getQuestionIllustration(q),
      stemImages: stemMedia.images,
      stemAudios: stemMedia.audios,
      chosen: getChoiceText(q, chosenIdx),
      chosenImage: getChoiceImage(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),
      correctImage: getChoiceImage(q, correctIdx),
      isCorrect: chosenIdx === correctIdx
    });
  }
  return rows;
}

function buildSectionSummary(rows) {
  const summaryMap = new Map();
  for (const row of rows) {
    const key = row.section || "Unknown";
    const cur = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    cur.total += 1;
    if (row.isCorrect) cur.correct += 1;
    summaryMap.set(key, cur);
  }
  return Array.from(summaryMap.values()).map((s) => ({
    ...s,
    rate: s.total ? s.correct / s.total : 0
  }));
}

function buildMainSectionSummary(rows) {
  const summaryMap = new Map();
  for (const row of rows ?? []) {
    const key = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
    const current = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    summaryMap.set(key, current);
  }
  return sections
    .map((section) => getSectionTitle(section.key))
    .filter(Boolean)
    .map((label) => summaryMap.get(label))
    .filter(Boolean)
    .map((row) => ({
      ...row,
      rate: row.total ? row.correct / row.total : 0,
    }));
}

function buildNestedSectionSummary(rows) {
  const mainSectionMap = new Map();
  for (const row of rows ?? []) {
    const mainSection = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
    const current = mainSectionMap.get(mainSection) || {
      mainSection,
      total: 0,
      correct: 0,
      subSections: new Map(),
    };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    const subKey = row.section || "Unknown";
    const currentSub = current.subSections.get(subKey) || { section: subKey, total: 0, correct: 0 };
    currentSub.total += 1;
    if (row.isCorrect) currentSub.correct += 1;
    current.subSections.set(subKey, currentSub);
    mainSectionMap.set(mainSection, current);
  }
  const ordered = sections
    .map((section) => getSectionTitle(section.key))
    .filter((title) => mainSectionMap.has(title))
    .map((title) => mainSectionMap.get(title));
  for (const [title, group] of mainSectionMap.entries()) {
    if (!ordered.some((item) => item.mainSection === title)) ordered.push(group);
  }
  return ordered.map((group) => ({
    mainSection: group.mainSection,
    total: group.total,
    correct: group.correct,
    rate: group.total ? group.correct / group.total : 0,
    subSections: Array.from(group.subSections.values()).map((subSection) => ({
      ...subSection,
      rate: subSection.total ? subSection.correct / subSection.total : 0,
    })),
  }));
}

function getSectionLabelLines(label) {
  if (label === "Script and Vocabulary") return ["Script and", "Vocabulary"];
  if (label === "Reading Comprehension") return ["Reading", "Comprehension"];
  if (label === "Listening Comprehension") return ["Listening", "Comprehension"];
  if (label === "Conversation and Expression") return ["Conversation and", "Expression"];
  return String(label ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function getOrderedSectionTitles(questionsList, extraTitles = []) {
  const ordered = [];
  for (const title of [
    ...(questionsList ?? []).map((q) => getQuestionSectionLabel(q)).filter(Boolean),
    ...(extraTitles ?? []).filter(Boolean),
  ]) {
    if (!ordered.includes(title)) ordered.push(title);
  }
  return ordered;
}

function buildSectionAverageRows(attemptsList, questionsList) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList);
  const baseSummary = buildSectionSummary(baseRows);
  const sectionTitles = getOrderedSectionTitles(
    questionsList,
    baseSummary.map((row) => row.section)
  );
  return sectionTitles
    .map((sectionTitle) => {
      const baseRow = baseSummary.find((row) => row.section === sectionTitle);
      const totalQuestions = Number(baseRow?.total ?? 0);
      const stats = attemptsList.reduce(
        (acc, attempt) => {
          const summary = buildSectionSummary(buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList));
          const row = summary.find((item) => item.section === sectionTitle);
          acc.rateSum += Number(row?.rate ?? 0);
          acc.correctSum += Number(row?.correct ?? 0);
          return acc;
        },
        { rateSum: 0, correctSum: 0 }
      );
      return {
        section: sectionTitle,
        averageRate: stats.rateSum / attemptsList.length,
        averageCorrect: stats.correctSum / attemptsList.length,
        totalQuestions,
      };
    })
    .filter((row) => row.totalQuestions > 0);
}

function buildMainSectionAverageRows(attemptsList, questionsList) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList);
  const baseSummary = buildMainSectionSummary(baseRows);
  const sectionTitles = sections
    .map((section) => getSectionTitle(section.key))
    .filter((title) => baseSummary.some((row) => row.section === title));
  return sectionTitles
    .map((sectionTitle) => {
      const baseRow = baseSummary.find((row) => row.section === sectionTitle);
      const stats = attemptsList.reduce(
        (acc, attempt) => {
          const summary = buildMainSectionSummary(buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList));
          const row = summary.find((item) => item.section === sectionTitle);
          acc.rateSum += Number(row?.rate ?? 0);
          acc.correctSum += Number(row?.correct ?? 0);
          return acc;
        },
        { rateSum: 0, correctSum: 0 }
      );
      return {
        section: sectionTitle,
        total: Number(baseRow?.total ?? 0),
        averageCorrect: stats.correctSum / attemptsList.length,
        averageRate: stats.rateSum / attemptsList.length,
      };
    })
    .filter((row) => row.total > 0);
}

function buildNestedSectionAverageRows(attemptsList, questionsList) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList);
  const baseSummary = buildNestedSectionSummary(baseRows);
  return baseSummary.map((baseGroup) => {
    const groupStats = attemptsList.reduce(
      (acc, attempt) => {
        const summary = buildNestedSectionSummary(buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList));
        const group = summary.find((item) => item.mainSection === baseGroup.mainSection);
        acc.rateSum += Number(group?.rate ?? 0);
        acc.correctSum += Number(group?.correct ?? 0);
        return acc;
      },
      { rateSum: 0, correctSum: 0 }
    );
    return {
      mainSection: baseGroup.mainSection,
      total: Number(baseGroup.total ?? 0),
      averageCorrect: groupStats.correctSum / attemptsList.length,
      averageRate: groupStats.rateSum / attemptsList.length,
      subSections: baseGroup.subSections.map((baseSubSection) => {
        const subStats = attemptsList.reduce(
          (acc, attempt) => {
            const summary = buildNestedSectionSummary(buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList));
            const group = summary.find((item) => item.mainSection === baseGroup.mainSection);
            const subSection = group?.subSections?.find((item) => item.section === baseSubSection.section);
            acc.rateSum += Number(subSection?.rate ?? 0);
            acc.correctSum += Number(subSection?.correct ?? 0);
            return acc;
          },
          { rateSum: 0, correctSum: 0 }
        );
        return {
          section: baseSubSection.section,
          total: Number(baseSubSection.total ?? 0),
          averageCorrect: subStats.correctSum / attemptsList.length,
          averageRate: subStats.rateSum / attemptsList.length,
        };
      }),
    };
  });
}

function buildImportedMainSectionAverageRows(attemptsList) {
  if (!attemptsList?.length) return [];
  const sectionTitles = sections
    .filter((section) => section.key !== "DAILY")
    .map((section) => getSectionTitle(section.key))
    .filter(Boolean);
  return sectionTitles
    .map((sectionTitle) => {
      const matchingRows = attemptsList
        .map((attempt) => getImportedModelSectionSummaries(attempt).find((row) => row.section === sectionTitle))
        .filter(Boolean);
      if (!matchingRows.length) return null;
      return {
        section: sectionTitle,
        total: Math.max(...matchingRows.map((row) => Number(row.total ?? 0)), 0),
        averageCorrect: matchingRows.reduce((sum, row) => sum + Number(row.correct ?? 0), 0) / matchingRows.length,
        averageRate: matchingRows.reduce((sum, row) => sum + Number(row.rate ?? 0), 0) / matchingRows.length,
      };
    })
    .filter(Boolean);
}

function buildSessionStudentRankingRows(attemptsList, questionsList, studentsList) {
  if (!attemptsList?.length) return [];
  const sectionAverageRows = buildSectionAverageRows(attemptsList, questionsList);
  const sectionTitles = sectionAverageRows.map((row) => row.section);
  const rows = attemptsList.map((attempt) => {
    const student = (studentsList ?? []).find((item) => item.id === attempt.student_id) ?? null;
    const detailRows = buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList);
    const sectionSummary = buildSectionSummary(detailRows);
    const sectionRates = Object.fromEntries(
      sectionTitles.map((title) => [title, Number(sectionSummary.find((row) => row.section === title)?.rate ?? 0)])
    );
    return {
      attempt,
      student_id: attempt.student_id,
      display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
      student_code: attempt.student_code || student?.student_code || "",
      totalCorrect: Number(attempt?.correct ?? 0),
      totalQuestions: Number(attempt?.total ?? 0),
      totalRate: getScoreRate(attempt),
      sectionRates,
    };
  });
  rows.sort((a, b) => {
    if (b.totalRate !== a.totalRate) return b.totalRate - a.totalRate;
    if (b.totalCorrect !== a.totalCorrect) return b.totalCorrect - a.totalCorrect;
    const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildImportedSessionStudentRankingRows(attemptsList, studentsList) {
  if (!attemptsList?.length) return [];
  const sectionTitles = sections
    .filter((section) => section.key !== "DAILY")
    .map((section) => getSectionTitle(section.key))
    .filter(Boolean);
  const rows = attemptsList.map((attempt) => {
    const student = (studentsList ?? []).find((item) => item.id === attempt.student_id) ?? null;
    const sectionSummary = getImportedModelSectionSummaries(attempt);
    const sectionRates = Object.fromEntries(
      sectionTitles.map((title) => [title, Number(sectionSummary.find((row) => row.section === title)?.rate ?? 0)])
    );
    return {
      attempt,
      student_id: attempt.student_id,
      display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
      student_code: attempt.student_code || student?.student_code || "",
      totalCorrect: Number(attempt?.correct ?? 0),
      totalQuestions: Number(attempt?.total ?? 0),
      totalRate: getScoreRate(attempt),
      sectionRates,
    };
  });
  rows.sort((a, b) => {
    if (b.totalRate !== a.totalRate) return b.totalRate - a.totalRate;
    if (b.totalCorrect !== a.totalCorrect) return b.totalCorrect - a.totalCorrect;
    const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildSectionRadarSvg(data) {
  if (!data?.length) return null;
  const size = 300;
  const center = size / 2;
  const maxR = 96;
  const steps = 4;
  const points = data
    .map((item, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
      const r = maxR * Math.max(0, Math.min(1, Number(item?.value ?? 0)));
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const grid = Array.from({ length: steps }, (_, index) => {
    const r = (maxR * (index + 1)) / steps;
    return <circle key={`grid-${r}`} cx={center} cy={center} r={r} className="session-radar-grid" />;
  });
  const axes = data.map((_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    const x = center + Math.cos(angle) * maxR;
    const y = center + Math.sin(angle) * maxR;
    return <line key={`axis-${index}`} x1={center} y1={center} x2={x} y2={y} className="session-radar-axis" />;
  });
  const labels = data.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    let radius = maxR + 24;
    let xOffset = 0;
    if (item.label === "Reading Comprehension") {
      radius = maxR + 10;
      xOffset = 24;
    } else if (item.label === "Conversation and Expression") {
      radius = maxR + 10;
      xOffset = -24;
    }
    const x = center + Math.cos(angle) * radius + xOffset;
    const y = center + Math.sin(angle) * radius;
    const lines = getSectionLabelLines(item.label);
    return (
      <text key={`label-${item.label}`} x={x} y={y} className="session-radar-label">
        {lines.map((line, lineIndex) => (
          <tspan key={`label-line-${item.label}-${lineIndex}`} x={x} dy={lineIndex === 0 ? "0" : "1.15em"}>
            {line}
          </tspan>
        ))}
      </text>
    );
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="session-radar-chart" role="img" aria-label="Average section performance radar chart">
      {grid}
      {axes}
      <polygon points={points} className="session-radar-shape" />
      {labels}
    </svg>
  );
}

function getRowTimestamp(row) {
  const value = row?.ended_at || row?.created_at || row?.started_at || null;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getAttemptScopeKey(attempt) {
  if (attempt?.test_session_id) return `session:${attempt.test_session_id}`;
  if (attempt?.test_version) return `version:${attempt.test_version}`;
  return `attempt:${attempt?.id ?? getRowTimestamp(attempt)}`;
}

function buildLatestAttemptMapByStudent(attemptsList) {
  const map = new Map();
  for (const attempt of attemptsList ?? []) {
    if (!attempt?.student_id) continue;
    const existing = map.get(attempt.student_id);
    if (!existing || getRowTimestamp(attempt) >= getRowTimestamp(existing)) {
      map.set(attempt.student_id, attempt);
    }
  }
  return map;
}

function buildLatestAttemptMapByStudentAndScope(attemptsList, getScopeKey = getAttemptScopeKey) {
  const map = new Map();
  for (const attempt of attemptsList ?? []) {
    if (!attempt?.student_id) continue;
    const scopeKey = getScopeKey(attempt);
    const key = `${attempt.student_id}::${scopeKey}`;
    const existing = map.get(key);
    if (!existing || getRowTimestamp(attempt) >= getRowTimestamp(existing)) {
      map.set(key, attempt);
    }
  }
  return map;
}

function buildQuestionAnalysisRows(attemptsList, questionsList) {
  const stats = new Map();
  for (const attempt of attemptsList ?? []) {
    const rows = buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList);
    for (const row of rows) {
      const current = stats.get(row.qid) || {
        qid: row.qid,
        section: row.section,
        prompt: row.prompt,
        image: row.image,
        correct: 0,
        total: 0,
        byStudent: {},
      };
      current.total += 1;
      if (row.isCorrect) current.correct += 1;
      if (attempt?.student_id) {
        current.byStudent[attempt.student_id] = row.isCorrect;
      }
      stats.set(row.qid, current);
    }
  }
  return Array.from(stats.values()).map((row) => ({
    ...row,
    rate: row.total ? row.correct / row.total : 0,
  }));
}

function formatOrdinal(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");
  const mod10 = num % 10;
  const mod100 = num % 100;
  let suffix = "th";
  if (mod10 === 1 && mod100 !== 11) suffix = "st";
  else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
  else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
  return `${num}${suffix}`;
}

function QuestionPreviewCard({ question, index, children }) {
  const prompt = question.promptEn || question.promptBn || "";
  const choices = question.choices ?? question.choicesJa ?? [];
  const stemKind = normalizeModelCsvKind(question.stemKind || "");
  const stemText = question.stemText;
  const stemExtra = question.stemExtra;
  const stemAsset = question.stemAsset;
  const stemAssets = splitAssetValues(stemAsset);
  const imageAssets = stemAssets.filter((value) => isImageAsset(value));
  const audioAssets = stemAssets.filter((value) => isAudioAsset(value));
  const boxText = question.boxText;
  const isImageStem = ["image", "passage_image", "table_image"].includes(stemKind);
  const isAudioStem = stemKind === "audio";
  const shouldShowImage = imageAssets.length > 0 || (isImageStem && stemAsset);
  const shouldShowAudio = audioAssets.length > 0 || (isAudioStem && stemAsset);
  const stemLines = splitStemLines(stemExtra);
  const textBoxLines = splitTextBoxStemLines(stemExtra || stemText);
  const sectionLabel = getQuestionSectionLabel(question) || question.sectionKey;
  const displayQuestionId = String(question.sourceQuestionId ?? "").trim()
    || String(question.id ?? "").split("__").filter(Boolean)[1]
    || String(question.id ?? "").trim();

  const renderChoices = () => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
      {choices.map((choice, choiceIndex) => {
        const isCorrect = question.answerIndex === choiceIndex;
        const isImage = isImageAsset(choice);
        return (
          <div
            key={`choice-${question.id}-${choiceIndex}`}
            className="btn"
            style={{
              border: isCorrect ? "2px solid #1a7f37" : "1px solid #ddd",
              background: isCorrect ? "#e7f7ee" : "#fff",
              padding: 8,
            }}
          >
            {isImage ? (
              <img src={choice} alt="choice" style={{ maxWidth: "100%" }} />
            ) : (
              choice
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700 }}>
          {displayQuestionId} {sectionLabel ? `(${sectionLabel})` : ""} {index != null ? `#${index + 1}` : ""}
        </div>
        {children ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div> : null}
      </div>
      {prompt ? <div style={{ marginTop: 6, whiteSpace: question.type === "daily" ? "pre-wrap" : "normal" }}>{prompt}</div> : null}
      {question.type === "daily" && stemExtra ? (
        <div style={{ marginTop: 6, fontSize: 13, color: "#333333", whiteSpace: "pre-wrap" }}>
          {stemExtra}
        </div>
      ) : null}
      {stemText && stemKind !== "text_box" ? (
        <div
          style={{ marginTop: 6 }}
          dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
        />
      ) : null}
      {stemKind === "text_box" && textBoxLines.length ? (
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          {textBoxLines.map((line, lineIndex) => {
            const parsed = parseSpeakerStemLine(line);
            if (!parsed || !parsed.speaker) {
              return (
                <div
                  key={`textbox-line-${question.id}-${lineIndex}`}
                  dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
                />
              );
            }
            return (
              <div
                key={`textbox-line-${question.id}-${lineIndex}`}
                style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "0.45em", alignItems: "start" }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{parsed.speaker}{parsed.delimiter}</span>
                <span dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(parsed.body) }} />
              </div>
            );
          })}
        </div>
      ) : null}
      {stemLines.length && question.type !== "daily" && stemKind !== "text_box" ? (
        <div style={{ marginTop: 6 }}>
          {stemLines.map((line, lineIndex) => (
            <div
              key={`line-${question.id}-${lineIndex}`}
              dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
            />
          ))}
        </div>
      ) : null}
      {boxText ? (
        <div
          className="boxed"
          style={{ marginTop: 8 }}
          dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(boxText) }}
        />
      ) : null}
      {shouldShowImage ? (
        imageAssets.map((asset, assetIndex) => (
          <img key={`preview-image-${question.id}-${assetIndex}`} src={asset} alt="stem" style={{ marginTop: 8, maxWidth: "100%" }} />
        ))
      ) : null}
      {shouldShowAudio ? (
        audioAssets.map((asset, assetIndex) => (
          <audio key={`preview-audio-${question.id}-${assetIndex}`} controls src={asset} style={{ marginTop: 8, width: "100%" }} />
        ))
      ) : null}

      <div style={{ marginTop: 10 }}>
        {choices.length ? renderChoices() : null}
      </div>
    </div>
  );
}

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

function toBangladeshInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bd = new Date(d.getTime() + BD_OFFSET_MS);
  return bd.toISOString().slice(0, 16);
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

function formatDateTimeInput(iso) {
  return toBangladeshInput(iso);
}

function getBangladeshDateInput(value) {
  if (!value) return "";
  const input = toBangladeshInput(value);
  return input ? input.slice(0, 10) : "";
}

function getBangladeshTimeInput(value) {
  if (!value) return "";
  const input = toBangladeshInput(value);
  return input ? input.slice(11, 16) : "";
}

function combineBangladeshDateTime(dateValue, timeValue) {
  if (!dateValue || !timeValue) return "";
  return `${dateValue}T${timeValue}`;
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

function formatTwelveHourTimeDisplay(value) {
  const parts = getTwelveHourTimeParts(value);
  if (!parts.hour) return "--:-- --";
  return `${parts.hour}:${parts.minute} ${parts.period}`;
}

function shuffleList(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function isGeneratedDailySessionVersion(version) {
  return String(version ?? "").startsWith("daily_session_");
}

const TWELVE_HOUR_TIME_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
const FIVE_MINUTE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const MERIDIEM_OPTIONS = ["AM", "PM"];

function formatDateShort(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", month: "2-digit", day: "2-digit" });
}

function normalizeAdminLoginErrorMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "Login failed.";
  if (
    /cannot coerce the result to a single json object/i.test(text)
    || /json object requested.*multiple \(or no\) rows/i.test(text)
  ) {
    return "This account is missing an admin profile. Please contact the system administrator.";
  }
  return text;
}

function isAllowedAdminProfile(profile) {
  return Boolean(
    profile
      && profile.account_status === "active"
      && ["admin", "super_admin"].includes(profile.role)
  );
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

function formatDateFull(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatMonthYear(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})/);
  if (!match) return String(value);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
  });
}

function formatDateDots(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).replace(/\//g, ".");
}

function parseDateDotsToIso(value) {
  const match = String(value ?? "").trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseSyllabusAnnouncementDate(title) {
  const match = String(title ?? "").match(/Exam Syllabus\s*\((\d{2}\.\d{2}\.\d{4})\)/i);
  return match ? parseDateDotsToIso(match[1]) : "";
}

function normalizeAnnouncementDraftText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function formatAnnouncementScheduleTime(value) {
  const input = toBangladeshInput(value);
  if (!input) return "";
  const timeText = input.slice(11, 16);
  const [rawHour, rawMinute] = timeText.split(":").map((part) => Number(part));
  if (!Number.isFinite(rawHour) || !Number.isFinite(rawMinute)) return "";
  const period = rawHour >= 12 ? "PM" : "AM";
  const hour = rawHour % 12 || 12;
  return `${hour}.${String(rawMinute).padStart(2, "0")}${period}`;
}

function getSessionScheduleSource(session) {
  return session?.starts_at || session?.ends_at || session?.created_at || "";
}

function formatWeekday(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString(undefined, { weekday: "short" });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function getScoreRate(attempt) {
  const rate = Number(attempt?.score_rate);
  if (Number.isFinite(rate)) return rate;
  const correct = Number(attempt?.correct ?? 0);
  const total = Number(attempt?.total ?? 0);
  if (!total) return 0;
  return correct / total;
}

function getTabLeftCount(attempt) {
  const directCount = Number(attempt?.tab_left_count);
  const metaCount = Number(attempt?.answers_json?.__meta?.tab_left_count);
  const normalizedDirect = Number.isFinite(directCount) && directCount >= 0 ? Math.floor(directCount) : 0;
  const normalizedMeta = Number.isFinite(metaCount) && metaCount >= 0 ? Math.floor(metaCount) : 0;
  return Math.max(normalizedDirect, normalizedMeta);
}

function isMissingTabLeftCountError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /tab_left_count/i.test(text) && /does not exist/i.test(text);
}

function isGeneratedScoreRateInsertError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /score_rate/i.test(text)
    && /(cannot insert a non-default value|generated)/i.test(text);
}

function isMissingRetakeSessionFieldsError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /(retake_source_session_id|retake_release_scope)/i.test(text) && /does not exist/i.test(text);
}

function isMissingSessionAttemptOverrideTableError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /test_session_attempt_overrides/i.test(text) && /does not exist/i.test(text);
}

function parseSeparatedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => String(c ?? "").trim().length));
}

function parseCsvRows(text) {
  return parseSeparatedRows(text, ",");
}

function detectDelimiter(text) {
  const firstLine = String(text ?? "").split(/\r?\n/)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function normalizeHeaderName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase();
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shuffleWithSeed(items, seedStr) {
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

function parseListCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return raw.split("|").map((v) => v.trim()).filter(Boolean);
}

function parseJsonCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeCsvValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toUpperCase() === "N/A") return "";
  return raw;
}

function parseAnswerIndex(value) {
  const raw = normalizeCsvValue(value).toUpperCase();
  const map = { A: 0, B: 1, C: 2, D: 3 };
  return raw in map ? map[raw] : null;
}

function parseQuestionCsv(text, defaultTestVersion = "") {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length === 0) return { questions: [], choices: [], errors: ["CSV is empty."] };
  const header = rows[0].map((h) => String(h ?? "").trim().replace(/^\uFEFF/, ""));
  const normalizedHeader = header.map(normalizeHeaderName);
  const idx = (name) => header.indexOf(name);
  const getCell = (row, name) => {
    const i = idx(name);
    return i === -1 ? "" : normalizeCsvValue(row[i]);
  };
  const getInt = (row, name) => {
    const v = getCell(row, name);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  if (
    normalizedHeader.includes("qid")
    && normalizedHeader.includes("sub_section")
    && normalizedHeader.includes("correct_option")
  ) {
    const findIdx = (names) => {
      for (const name of names) {
        const found = normalizedHeader.indexOf(normalizeHeaderName(name));
        if (found !== -1) return found;
      }
      return -1;
    };
    const cell = (row, index) => (index === -1 ? "" : normalizeCsvValue(row[index]));
    const idxSetId = findIdx(["set_id", "set id", "test_version"]);
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

    if (idxQid === -1 || idxSubSection === -1 || idxCorrect === -1) {
      return { questions: [], choices: [], errors: ["CSV must include qid, sub_section, and correct_option."] };
    }

    const questions = [];
    const choices = [];
    const errors = [];
    const seenQuestionIds = new Set();

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      const testVersion = defaultTestVersion || cell(row, idxSetId);
      const rawQid = cell(row, idxQid);
      const subSection = cell(row, idxSubSection);
      const promptEn = cell(row, idxPromptEn) || null;
      const promptBn = cell(row, idxPromptBn) || null;
      const stemKindInput = cell(row, idxStemKind);
      const stemText = cell(row, idxStemText) || null;
      const { stemKind, stemImage, stemAudio } = resolveModelStemAssets(
        stemKindInput,
        cell(row, idxStemImage) || null,
        cell(row, idxStemAudio) || null
      );
      const subQuestion = cell(row, idxSubQuestion) || null;
      const optionType = cell(row, idxOptionType) || null;
      const correct = cell(row, idxCorrect);
      const wrongs = [cell(row, idxWrong1), cell(row, idxWrong2), cell(row, idxWrong3)].filter(Boolean);

      if (!rawQid && !subSection && !promptEn && !promptBn && !stemText && !stemImage && !stemAudio && !subQuestion && !correct) {
        continue;
      }
      if (!testVersion) {
        errors.push(`Row ${r + 1}: set_id is required.`);
        continue;
      }
      if (!rawQid) {
        errors.push(`Row ${r + 1}: qid is required.`);
        continue;
      }
      if (seenQuestionIds.has(rawQid)) {
        errors.push(`Row ${r + 1}: duplicate qid "${rawQid}".`);
        continue;
      }
      seenQuestionIds.add(rawQid);
      if (!subSection) {
        errors.push(`Row ${r + 1} (${rawQid}): sub_section is required.`);
        continue;
      }
      if (!correct) {
        errors.push(`Row ${r + 1} (${rawQid}): correct_option is required.`);
        continue;
      }

      const parsedId = parseModelQuestionId(rawQid);
      const sectionKey = resolveModelSectionKey(rawQid, subSection);
      const stemAsset = joinAssetValues(
        stemAudio,
        stemImage
      ) || null;
      const choicesList = [correct, ...wrongs].filter(Boolean);
      if (!choicesList.length) {
        errors.push(`Row ${r + 1} (${rawQid}): choices are required.`);
        continue;
      }

      const type = inferModelQuestionType({
        sectionKey,
        stemKind,
        stemText,
        stemImage,
        stemAudio,
        subQuestion,
        optionType,
      });
      const orderIndex = computeModelOrderIndex(rawQid, r, sectionKey);
      const data = {
        qid: parsedId.groupQid,
        subId: parsedId.subId,
        itemId: rawQid,
        stemKind,
        stemText,
        stemAsset,
        stemExtra: null,
        boxText: subQuestion,
        choices: choicesList,
        sectionLabel: subSection,
        optionType,
      };

      questions.push({
        test_version: testVersion,
        question_id: rawQid,
        section_key: sectionKey,
        type,
        prompt_en: promptEn,
        prompt_bn: promptBn,
        answer_index: 0,
        order_index: orderIndex,
        data,
      });
      const useImageChoices = isModelOptionImageType(optionType);
      choicesList.forEach((value, choiceIndex) => {
        choices.push({
          test_version: testVersion,
          question_key: rawQid,
          part_index: null,
          choice_index: choiceIndex,
          label: useImageChoices ? null : value,
          choice_image: useImageChoices ? value : null,
        });
      });
    }

    return { questions, choices, errors };
  }

  if (idx("item_id") === -1 || idx("section_key") === -1 || idx("type") === -1) {
    return { questions: [], choices: [], errors: ["CSV must include item_id, section_key, type."] };
  }

  const questions = [];
  const choices = [];
  const errors = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const questionId = getCell(row, "item_id");
    if (!questionId) continue;
    const testVersion = defaultTestVersion || getCell(row, "test_version");
    if (!testVersion) {
      errors.push(`Row ${r + 1}: test_version is required.`);
      continue;
    }
    const sectionKey = getCell(row, "section_key");
    const type = getCell(row, "type");
    const promptEn = getCell(row, "prompt_en") || null;
    const promptBn = getCell(row, "prompt_bn") || null;
    const orderIndex = getInt(row, "order_index");
    const answerIndex = parseAnswerIndex(getCell(row, "answer"));
    const choicesList = ["choiceA", "choiceB", "choiceC", "choiceD"]
      .map((key) => getCell(row, key))
      .filter(Boolean);
    if (!sectionKey || !type) {
      errors.push(`Row ${r + 1} (${questionId}): section_key and type are required.`);
      continue;
    }
    if (answerIndex == null) {
      errors.push(`Row ${r + 1} (${questionId}): answer must be A/B/C/D.`);
      continue;
    }
    if (choicesList.length === 0) {
      errors.push(`Row ${r + 1} (${questionId}): choices are required.`);
      continue;
    }
    if (answerIndex >= choicesList.length) {
      errors.push(`Row ${r + 1} (${questionId}): answer is out of range for choices.`);
      continue;
    }

    const data = {
      qid: getCell(row, "qid") || null,
      subId: getCell(row, "sub_id") || null,
      itemId: questionId,
      stemKind: normalizeModelCsvKind(getCell(row, "stem_kind")) || null,
      stemText: getCell(row, "stem_text") || null,
      stemAsset: getCell(row, "stem_asset") || null,
      stemExtra: getCell(row, "stem_extra") || null,
      boxText: getCell(row, "box_text") || null,
      choices: choicesList,
      target: getCell(row, "target") || null,
      blankStyle: getCell(row, "meta_blank_style") || null,
    };

    questions.push({
      test_version: testVersion,
      question_id: questionId,
      section_key: sectionKey || null,
      type,
      prompt_en: promptEn,
      prompt_bn: promptBn,
      answer_index: answerIndex != null ? answerIndex : null,
      order_index: orderIndex != null ? orderIndex : r,
      data,
    });
    choicesList.forEach((value, i) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(value);
      choices.push({
        test_version: testVersion,
        question_key: questionId,
        part_index: null,
        choice_index: i,
        label: isImage ? null : value,
        choice_image: isImage ? value : null,
      });
    });
  }

  return { questions, choices, errors };
}

function parseDailyCsv(text, defaultTestVersion = "") {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length === 0) return { questions: [], choices: [], errors: ["CSV is empty."] };
  const header = rows[0].map(normalizeHeaderName);
  const findIdx = (names) => {
    for (const name of names) {
      const idx = header.indexOf(normalizeHeaderName(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idxTest = findIdx(["set_id", "set id", "testid", "test_id", "test id"]);
  const idxNo = findIdx(["qid", "q_id", "q id", "no", "no.", "number"]);
  const idxQuestion = findIdx(["question"]);
  const idxCorrect = findIdx(["correct_option", "correct option", "correct_answer", "correct answer", "correct"]);
  const idxWrong1 = findIdx(["wrong_option_1", "wrong option 1", "wrong1", "wrong option1"]);
  const idxWrong2 = findIdx(["wrong_option_2", "wrong option 2", "wrong2", "wrong option2"]);
  const idxWrong3 = findIdx(["wrong_option_3", "wrong option 3", "wrong3", "wrong option3"]);
  const idxTarget = findIdx(["target"]);
  const idxCanDo = findIdx(["can-do", "cando", "can do"]);
  const idxIllustration = findIdx(["illustration"]);
  const idxDescription = findIdx(["description"]);

  if (idxQuestion === -1 || idxCorrect === -1) {
    return { questions: [], choices: [], errors: ["CSV must include question and correct_option."] };
  }

  const questions = [];
  const choices = [];
  const errors = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const cell = (idx) => (idx === -1 ? "" : normalizeCsvValue(row[idx]));
    const testVersion = defaultTestVersion || cell(idxTest);
    const noValue = cell(idxNo);
    const questionText = cell(idxQuestion);
    const correct = cell(idxCorrect);
    const wrongs = [cell(idxWrong1), cell(idxWrong2), cell(idxWrong3)].filter(Boolean);
    const target = cell(idxTarget);
    const canDo = cell(idxCanDo);
    const illustration = cell(idxIllustration);
    const description = cell(idxDescription);

    if (!testVersion) {
      errors.push(`Row ${r + 1}: SetID is required.`);
      continue;
    }
    if (!questionText) {
      errors.push(`Row ${r + 1}: Question is required.`);
      continue;
    }
    if (!correct) {
      errors.push(`Row ${r + 1}: Correct Answer is required.`);
      continue;
    }

    const orderIndex = Number(noValue);
    const questionId = `${testVersion}-${noValue || r}`;
    const items = [
      ...wrongs.map((text) => ({ text, correct: false })),
      { text: correct, correct: true }
    ].filter((i) => i.text);
    if (items.length === 0) {
      errors.push(`Row ${r + 1} (${questionId}): choices are required.`);
      continue;
    }

    const shuffled = shuffleWithSeed(items, `${testVersion}-${questionId}`);
    const choicesList = shuffled.map((i) => i.text);
    const answerIndex = shuffled.findIndex((i) => i.correct);

    if (answerIndex < 0) {
      errors.push(`Row ${r + 1} (${questionId}): correct answer not found in choices.`);
      continue;
    }

    const data = {
      itemId: questionId,
      stemKind: illustration ? "image" : null,
      stemText: null,
      stemAsset: illustration || null,
      stemExtra: description || null,
      boxText: null,
      choices: choicesList,
      target: target || null,
      canDo: canDo || null
    };

    questions.push({
      test_version: testVersion,
      question_id: questionId,
      section_key: "DAILY",
      type: "daily",
      prompt_en: questionText || null,
      prompt_bn: null,
      answer_index: answerIndex,
      order_index: Number.isFinite(orderIndex) ? orderIndex : r,
      data
    });

    choicesList.forEach((value, i) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(value);
      choices.push({
        test_version: testVersion,
        question_key: questionId,
        part_index: null,
        choice_index: i,
        label: isImage ? null : value,
        choice_image: isImage ? value : null
      });
    });
  }

  return { questions, choices, errors };
}

function detectTestVersionFromCsvText(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length < 2) return "";
  const header = rows[0].map(normalizeHeaderName);
  const idx = (() => {
    const testVersionIdx = header.indexOf("test_version");
    if (testVersionIdx !== -1) return testVersionIdx;
    return header.indexOf("set_id");
  })();
  if (idx === -1) return "";
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[idx] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function detectDailyTestIdFromCsvText(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length < 2) return "";
  const header = rows[0].map(normalizeHeaderName);
  const idx = (() => {
    const setIdIdx = header.indexOf("set_id");
    if (setIdIdx !== -1) return setIdIdx;
    return header.indexOf("testid");
  })();
  if (idx === -1) return "";
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[idx] ?? "").trim();
    if (value) return value;
  }
  return "";
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

function resolveAssetValue(value, assetMap) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.includes("/")) return raw;
  return assetMap[raw] ?? raw;
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

async function buildProfileEmailMap(supabase, attemptsList) {
  const ids = Array.from(new Set((attemptsList ?? []).map((a) => a.student_id).filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("profiles").select("id, email").in("id", ids);
  if (error) {
    console.error("profiles lookup error:", error);
    return {};
  }
  const map = {};
  for (const row of data ?? []) {
    map[row.id] = row.email ?? "";
  }
  return map;
}

async function fetchQuestionCounts(supabase, versions) {
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
}

export default function AdminConsole({
  forcedSchoolScope = null,
  changeSchoolHref = null,
  homeHref = "/",
  homeLabel = "Admin Home",
  forcedSchoolOptions = [],
  forceLoginOnEntry = false,
  managedSession = undefined,
  managedProfile = undefined,
}) {
  const router = useRouter();
  const forcedSchoolId = forcedSchoolScope?.id ?? null;
  const forcedSchoolName = forcedSchoolScope?.name ?? forcedSchoolId ?? "";
  const isManagedAuth = managedSession !== undefined || managedProfile !== undefined;
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const loginValidationInFlightRef = useRef(false);
  const [authReady, setAuthReady] = useState(isManagedAuth);
  const [profileLoading, setProfileLoading] = useState(false);
  const [schoolAssignments, setSchoolAssignments] = useState([]);
  const [schoolScopeId, setSchoolScopeId] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [examLinks, setExamLinks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAttemptObj, setSelectedAttemptObj] = useState(null);
  const [attemptDetailOpen, setAttemptDetailOpen] = useState(false);
  const [attemptDetailSource, setAttemptDetailSource] = useState("default");
  const [attemptDetailTab, setAttemptDetailTab] = useState("overview");
  const [attemptDetailWrongOnly, setAttemptDetailWrongOnly] = useState(false);
  const attemptDetailSectionRefs = useRef({});
  const [expandedResultCells, setExpandedResultCells] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [filters, setFilters] = useState({
    code: "",
    name: "",
    from: "",
    to: "",
    limit: 200,
    testVersion: ""
  });
  const [activeTab, setActiveTab] = useState("students");
  const [modelSubTab, setModelSubTab] = useState("results");
  const [dailySubTab, setDailySubTab] = useState("results");
  const [attendanceSubTab, setAttendanceSubTab] = useState("sheet");
  const [dailyResultsCategory, setDailyResultsCategory] = useState("");
  const [modelResultsCategory, setModelResultsCategory] = useState("");
  const [dailyCategorySelect, setDailyCategorySelect] = useState("__custom__");
  const CUSTOM_CATEGORY_OPTION = "__custom__";
  const RESULTS_IMPORT_NEW_CATEGORY_OPTION = "__new_category__";
  const [editingTestId, setEditingTestId] = useState("");
  const [editingTestMsg, setEditingTestMsg] = useState("");
  const [editingCategorySelect, setEditingCategorySelect] = useState("__custom__");
  const [editingTestForm, setEditingTestForm] = useState({
    id: "",
    originalVersion: "",
    version: "",
    title: "",
    pass_rate: "",
    is_public: true,
    type: ""
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showPasswordChangePassword, setShowPasswordChangePassword] = useState(false);
  const [showPasswordChangeConfirmPassword, setShowPasswordChangeConfirmPassword] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [passwordChangeForm, setPasswordChangeForm] = useState({
    password: "",
    confirmPassword: "",
  });
  const [passwordChangeMsg, setPasswordChangeMsg] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentMsg, setStudentMsg] = useState("");
  const [studentTempMap, setStudentTempMap] = useState({});
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueStudent, setReissueStudent] = useState(null);
  const [reissuePassword, setReissuePassword] = useState("");
  const [reissueIssuedPassword, setReissueIssuedPassword] = useState("");
  const [reissueLoading, setReissueLoading] = useState(false);
  const [reissueMsg, setReissueMsg] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [selectedStudentTab, setSelectedStudentTab] = useState("information");
  const [studentAttempts, setStudentAttempts] = useState([]);
  const [studentAttemptsMsg, setStudentAttemptsMsg] = useState("");
  const [studentAttemptRanks, setStudentAttemptRanks] = useState({});
  const [studentAttendance, setStudentAttendance] = useState([]);
  const [studentAttendanceMsg, setStudentAttendanceMsg] = useState("");
  const [studentAttendanceRange, setStudentAttendanceRange] = useState({ from: "", to: "" });
  const [studentInfoOpen, setStudentInfoOpen] = useState(false);
  const [studentInfoSaving, setStudentInfoSaving] = useState(false);
  const [studentInfoMsg, setStudentInfoMsg] = useState("");
  const [studentInfoForm, setStudentInfoForm] = useState(() => getPersonalInfoForm(null));
  const [studentInfoUploadFiles, setStudentInfoUploadFiles] = useState({});
  const [dailyRecords, setDailyRecords] = useState([]);
  const [dailyRecordsMsg, setDailyRecordsMsg] = useState("");
  const [dailyRecordDate, setDailyRecordDate] = useState(() => getTodayDateInput());
  const [dailyRecordDatePickerOpen, setDailyRecordDatePickerOpen] = useState(false);
  const [dailyRecordCalendarMonth, setDailyRecordCalendarMonth] = useState(() => getTodayDateInput().slice(0, 7));
  const [dailyRecordModalOpen, setDailyRecordModalOpen] = useState(false);
  const [dailyRecordSaving, setDailyRecordSaving] = useState(false);
  const [dailyRecordForm, setDailyRecordForm] = useState(() => getEmptyDailyRecordForm(getTodayDateInput()));
  const [dailyRecordAnnouncementTitleDraft, setDailyRecordAnnouncementTitleDraft] = useState("");
  const [dailyRecordAnnouncementDraft, setDailyRecordAnnouncementDraft] = useState("");
  const [dailyRecordSyllabusAnnouncements, setDailyRecordSyllabusAnnouncements] = useState([]);
  const [dailyRecordPlanDrafts, setDailyRecordPlanDrafts] = useState({});
  const [dailyRecordConfirmedDates, setDailyRecordConfirmedDates] = useState([]);
  const [dailyRecordPlanSavingDate, setDailyRecordPlanSavingDate] = useState("");
  const [dailyRecordHolidaySavingDate, setDailyRecordHolidaySavingDate] = useState("");
  const dailyRecordTableWrapRef = useRef(null);
  const dailyRecordDatePickerRef = useRef(null);
  const [rankingPeriods, setRankingPeriods] = useState([]);
  const [rankingMsg, setRankingMsg] = useState("");
  const [rankingDrafts, setRankingDrafts] = useState({});
  const [rankingRefreshingId, setRankingRefreshingId] = useState("");
  const [studentListFilters, setStudentListFilters] = useState({
    from: "",
    to: "",
    maxAttendance: "",
    minUnexcused: "",
    minModelAvg: "",
    minDailyAvg: ""
  });
  const [studentWarnings, setStudentWarnings] = useState([]);
  const [studentWarningsLoading, setStudentWarningsLoading] = useState(false);
  const [studentWarningsLoaded, setStudentWarningsLoaded] = useState(false);
  const [studentWarningsMsg, setStudentWarningsMsg] = useState("");
  const [studentWarningIssueOpen, setStudentWarningIssueOpen] = useState(false);
  const [studentWarningIssueSaving, setStudentWarningIssueSaving] = useState(false);
  const [studentWarningIssueMsg, setStudentWarningIssueMsg] = useState("");
  const [studentWarningDeletingId, setStudentWarningDeletingId] = useState("");
  const [studentWarningForm, setStudentWarningForm] = useState(() => getDefaultStudentWarningForm());
  const [selectedStudentWarning, setSelectedStudentWarning] = useState(null);
  const [studentWarningPreviewStudentId, setStudentWarningPreviewStudentId] = useState("");
  const [studentListAttendanceMap, setStudentListAttendanceMap] = useState({});
  const [studentListAttempts, setStudentListAttempts] = useState([]);
  const [studentListLoading, setStudentListLoading] = useState(false);
  const [studentListMetricsLoaded, setStudentListMetricsLoaded] = useState(false);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [studentDetailMsg, setStudentDetailMsg] = useState("");
  const [studentReportExporting, setStudentReportExporting] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [studentAttendanceMonthKey, setStudentAttendanceMonthKey] = useState("__all__");
  const [inviteForm, setInviteForm] = useState({
    email: "",
    display_name: "",
    student_code: "",
    temp_password: ""
  });
  const [csvMsg, setCsvMsg] = useState("");
  const [inviteResults, setInviteResults] = useState([]);
  const [tests, setTests] = useState([]);
  const [testsMsg, setTestsMsg] = useState("");
  const [testSessions, setTestSessions] = useState([]);
  const [testSessionsMsg, setTestSessionsMsg] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [modelConductOpen, setModelConductOpen] = useState(false);
  const [modelUploadOpen, setModelUploadOpen] = useState(false);
  const [dailyConductOpen, setDailyConductOpen] = useState(false);
  const [dailyUploadOpen, setDailyUploadOpen] = useState(false);
  const [modelConductMode, setModelConductMode] = useState("normal");
  const [dailyConductMode, setDailyConductMode] = useState("normal");
  const [modelRetakeSourceId, setModelRetakeSourceId] = useState("");
  const [dailyRetakeCategory, setDailyRetakeCategory] = useState("");
  const [dailyRetakeSourceId, setDailyRetakeSourceId] = useState("");
  const [activeModelTimePicker, setActiveModelTimePicker] = useState("");
  const [dailySourceCategoryDropdownOpen, setDailySourceCategoryDropdownOpen] = useState(false);
  const [dailySetDropdownOpen, setDailySetDropdownOpen] = useState(false);
  const [activeDailyTimePicker, setActiveDailyTimePicker] = useState("");
  const dailySourceCategoryDropdownRef = useRef(null);
  const dailySetDropdownRef = useRef(null);
  const assetFolderInputRef = useRef(null);
  const dailyFolderInputRef = useRef(null);
  const attendanceImportInputRef = useRef(null);
  const resultsImportInputRef = useRef(null);
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
  const [assets, setAssets] = useState([]);
  const [assetsMsg, setAssetsMsg] = useState("");
  const [quizMsg, setQuizMsg] = useState("");
  const [resultsImportStatus, setResultsImportStatus] = useState(null);
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
  const [attemptQuestionsByVersion, setAttemptQuestionsByVersion] = useState({});
  const [attemptQuestionsLoading, setAttemptQuestionsLoading] = useState(false);
  const [attemptQuestionsError, setAttemptQuestionsError] = useState("");
  const [assetForm, setAssetForm] = useState({
    category: DEFAULT_MODEL_CATEGORY
  });
  const [assetCategorySelect, setAssetCategorySelect] = useState(DEFAULT_MODEL_CATEGORY);
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");
  const [dailyForm, setDailyForm] = useState({
    category: ""
  });
  const modelCategorySeededRef = useRef(false);
  const [dailyFile, setDailyFile] = useState(null);
  const [dailyFiles, setDailyFiles] = useState([]);
  const [dailyCsvFile, setDailyCsvFile] = useState(null);
  const [dailyUploadMsg, setDailyUploadMsg] = useState("");
  const [dailyImportMsg, setDailyImportMsg] = useState("");
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
  const [attendanceDays, setAttendanceDays] = useState([]);
  const [attendanceEntries, setAttendanceEntries] = useState({});
  const [attendanceMsg, setAttendanceMsg] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => {
    const today = new Date();
    if (Number.isNaN(today.getTime())) return "";
    return today.toISOString().slice(0, 10);
  });
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [attendanceModalDay, setAttendanceModalDay] = useState(null);
  const [attendanceDraft, setAttendanceDraft] = useState({});
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceClearing, setAttendanceClearing] = useState(false);
  const attendanceImportChoiceResolverRef = useRef(null);
  const [attendanceImportConflict, setAttendanceImportConflict] = useState(null);
  const [attendanceImportStatus, setAttendanceImportStatus] = useState(null);
  const dailyResultsImportChoiceResolverRef = useRef(null);
  const [dailyResultsImportConflict, setDailyResultsImportConflict] = useState(null);
  const modelResultsImportChoiceResolverRef = useRef(null);
  const [modelResultsImportConflict, setModelResultsImportConflict] = useState(null);
  const [approvedAbsenceByStudent, setApprovedAbsenceByStudent] = useState({});
  const [attendanceFilter, setAttendanceFilter] = useState({
    minRate: "",
    minAbsences: "",
    startDate: "",
    endDate: ""
  });
  const [absenceApplications, setAbsenceApplications] = useState([]);
  const [absenceApplicationsMsg, setAbsenceApplicationsMsg] = useState("");
  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: formatDateTimeInput(new Date()),
    end_at: ""
  });
  const [announcementCreateOpen, setAnnouncementCreateOpen] = useState(false);
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [editingAnnouncementForm, setEditingAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: "",
    end_at: ""
  });
  const activeSchoolId = forcedSchoolId ?? schoolScopeId ?? profile?.school_id ?? null;
  const canUseAdminConsole = Boolean(isAllowedAdminProfile(profile) && activeSchoolId);
  const activeSchoolName = forcedSchoolName
    || schoolAssignments.find((assignment) => assignment.school_id === activeSchoolId)?.school_name
    || activeSchoolId
    || "";
  const activeSchoolIdRef = useRef(activeSchoolId);
  const supabaseConfigError = getAdminSupabaseConfigError();
  const supabase = useMemo(
    () => (supabaseConfigError ? null : createAdminSupabaseClient({ schoolScopeId: activeSchoolId })),
    [activeSchoolId, supabaseConfigError]
  );

  function generateTempPassword(length = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += chars[bytes[i] % chars.length];
    }
    return out;
  }

  const selectedAttempt = useMemo(() => {
    if (selectedAttemptObj) return selectedAttemptObj;
    return attempts.find((a) => a.id === selectedId) ?? null;
  }, [attempts, selectedAttemptObj, selectedId]);

  const selectedStudentSummary = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );
  const selectedStudent = useMemo(
    () => {
      if (selectedStudentDetail?.id === selectedStudentId) {
        return { ...(selectedStudentSummary ?? {}), ...selectedStudentDetail };
      }
      return selectedStudentSummary;
    },
    [selectedStudentDetail, selectedStudentId, selectedStudentSummary]
  );

  const studentWarningCounts = useMemo(() => {
    const map = {};
    (studentWarnings ?? []).forEach((warning) => {
      (warning.recipients ?? []).forEach((recipient) => {
        if (!recipient?.student_id) return;
        map[recipient.student_id] = (map[recipient.student_id] ?? 0) + 1;
      });
    });
    return map;
  }, [studentWarnings]);

  const studentWarningsByStudentId = useMemo(() => {
    const map = {};
    (studentWarnings ?? []).forEach((warning) => {
      (warning.recipients ?? []).forEach((recipient) => {
        if (!recipient?.student_id) return;
        if (!map[recipient.student_id]) map[recipient.student_id] = [];
        map[recipient.student_id].push({
          warning,
          recipient,
        });
      });
    });
    Object.values(map).forEach((list) => {
      list.sort((left, right) => String(right.warning?.created_at ?? "").localeCompare(String(left.warning?.created_at ?? "")));
    });
    return map;
  }, [studentWarnings]);

  const studentWarningPreviewEntries = useMemo(
    () => studentWarningsByStudentId[studentWarningPreviewStudentId] ?? [],
    [studentWarningsByStudentId, studentWarningPreviewStudentId]
  );

  const studentWarningPreviewStudent = useMemo(
    () => students.find((student) => student.id === studentWarningPreviewStudentId) ?? null,
    [students, studentWarningPreviewStudentId]
  );

  useEffect(() => {
    if (!studentInfoOpen) {
      setStudentInfoForm(getPersonalInfoForm(selectedStudent));
      setStudentInfoUploadFiles({});
      setStudentInfoMsg("");
    }
  }, [selectedStudent, studentInfoOpen]);

  const modelTests = useMemo(() => tests.filter((t) => t.type === "mock"), [tests]);
  const dailyTests = useMemo(() => tests.filter((t) => t.type === "daily"), [tests]);
  const dailyQuestionSets = useMemo(
    () => dailyTests.filter((t) => !isGeneratedDailySessionVersion(t.version)),
    [dailyTests]
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
      && isGeneratedDailySessionVersion(previewSession.problem_set_id)
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
  }, [previewQuestions, previewReplacementOrderMap, previewSession]);
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
  const previewSectionRefs = useRef({});

  const testPassRateByVersion = useMemo(() => {
    const map = {};
    (tests ?? []).forEach((t) => {
      if (t?.version) map[t.version] = normalizePassRate(t.pass_rate);
    });
    return map;
  }, [tests]);

  const importedResultsSessionIds = useMemo(() => {
    return new Set(
      (attempts ?? [])
        .filter((attempt) => isImportedResultsSummaryAttempt(attempt))
        .map((attempt) => attempt?.test_session_id)
        .filter(Boolean)
    );
  }, [attempts]);

  const getAttemptEffectivePassRate = useCallback((attempt) => {
    if (isImportedResultsSummaryAttempt(attempt)) return 0.8;
    return normalizePassRate(testPassRateByVersion[attempt?.test_version]);
  }, [testPassRateByVersion]);

  const getSessionEffectivePassRate = useCallback((session, attemptsList = []) => {
    if ((attemptsList ?? []).some((attempt) => isImportedResultsSummaryAttempt(attempt))) return 0.8;
    if (session?.id && importedResultsSessionIds.has(session.id)) return 0.8;
    return normalizePassRate(session?.linkedTest?.pass_rate ?? testPassRateByVersion[session?.problem_set_id]);
  }, [importedResultsSessionIds, testPassRateByVersion]);

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

  const dailyCategories = useMemo(() => buildCategories(dailyQuestionSets), [dailyQuestionSets]);
  const dailySessionCategories = useMemo(() => buildCategories(dailyTests), [dailyTests]);
  const modelCategories = useMemo(() => buildCategories(modelTests, DEFAULT_MODEL_CATEGORY), [modelTests]);

  const testMetaByVersion = useMemo(() => {
    const map = {};
    (tests ?? []).forEach((t) => {
      if (!t?.version) return;
      map[t.version] = {
        type: t.type,
        category: String(t.title ?? "").trim()
      };
    });
    return map;
  }, [tests]);

  const testSessionsById = useMemo(
    () => new Map((testSessions ?? []).map((session) => [session.id, session])),
    [testSessions]
  );

  const sessionDetailDisplayAttempts = useMemo(() => {
    const attemptsList = Array.isArray(sessionDetailAttempts) ? sessionDetailAttempts : [];
    const actualAttempts = attemptsList.filter((attempt) => !isImportedResultsSummaryAttempt(attempt));
    return actualAttempts.length ? actualAttempts : attemptsList;
  }, [sessionDetailAttempts]);

  const sessionDetailStudentOptions = useMemo(() => {
    const unique = new Map();
    (sessionDetailDisplayAttempts ?? []).forEach((attempt) => {
      if (!attempt?.student_id || unique.has(attempt.student_id)) return;
      const student = students.find((item) => item.id === attempt.student_id) ?? null;
      unique.set(attempt.student_id, {
        id: attempt.student_id,
        display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
        student_code: attempt.student_code || student?.student_code || "",
      });
    });
    return Array.from(unique.values()).sort((a, b) => {
      const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
      if (nameCompare !== 0) return nameCompare;
      return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
    });
  }, [sessionDetailDisplayAttempts, students]);

  const studentsById = useMemo(
    () => new Map((students ?? []).map((student) => [student.id, student])),
    [students]
  );

  const sessionDetailLatestAttempts = useMemo(() => {
    const latestMap = buildLatestAttemptMapByStudent(sessionDetailDisplayAttempts);
    return Array.from(latestMap.values())
      .filter((attempt) => !isAnalyticsExcludedStudent(studentsById.get(attempt.student_id)))
      .sort((a, b) => getRowTimestamp(a) - getRowTimestamp(b));
  }, [sessionDetailDisplayAttempts, studentsById]);

  const sessionDetailPassRate = useMemo(() => {
    if (
      sessionDetailDisplayAttempts.length
      && sessionDetailDisplayAttempts.every((attempt) => isImportedResultsSummaryAttempt(attempt))
    ) {
      return 0.8;
    }
    return normalizePassRate(testPassRateByVersion[selectedSessionDetail?.problem_set_id]);
  }, [selectedSessionDetail, sessionDetailDisplayAttempts, testPassRateByVersion]);

  const sessionDetailOverview = useMemo(() => {
    const count = sessionDetailLatestAttempts.length;
    const passCount = sessionDetailLatestAttempts.filter((attempt) => getScoreRate(attempt) >= sessionDetailPassRate).length;
    const averageScore = count
      ? sessionDetailLatestAttempts.reduce((total, attempt) => total + getScoreRate(attempt), 0) / count
      : 0;
    return {
      count,
      averageScore,
      passCount,
      passRate: count ? passCount / count : 0,
    };
  }, [sessionDetailLatestAttempts, sessionDetailPassRate]);

  const sessionDetailUsesImportedResultsSummary = useMemo(() => {
    return sessionDetailDisplayAttempts.length > 0
      && sessionDetailDisplayAttempts.every((attempt) => isImportedResultsSummaryAttempt(attempt));
  }, [sessionDetailDisplayAttempts]);

  const sessionDetailUsesImportedModelSummary = useMemo(() => {
    return sessionDetail.type === "mock"
      && sessionDetailUsesImportedResultsSummary
      && sessionDetailLatestAttempts.every((attempt) => isImportedModelResultsSummaryAttempt(attempt));
  }, [sessionDetail.type, sessionDetailLatestAttempts, sessionDetailUsesImportedResultsSummary]);

  const sessionDetailAnalysisSummary = useMemo(() => {
    const attendedCount = sessionDetailLatestAttempts.length;
    const activeStudentCount = (students ?? []).filter((student) => !isAnalyticsExcludedStudent(student)).length;
    const absentCount = Math.max(0, activeStudentCount - attendedCount);
    const passCount = sessionDetailLatestAttempts.filter((attempt) => getScoreRate(attempt) >= sessionDetailPassRate).length;
    const failCount = Math.max(0, attendedCount - passCount);
    const totalQuestions = sessionDetailUsesImportedResultsSummary
      ? Math.max(0, ...sessionDetailLatestAttempts.map((attempt) => Number(attempt.total ?? 0)))
      : sessionDetailQuestions.length;
    const averageCorrect = attendedCount
      ? sessionDetailLatestAttempts.reduce((total, attempt) => {
        return total + Number(attempt.correct ?? (attempt.total ? getScoreRate(attempt) * attempt.total : 0));
      }, 0) / attendedCount
      : 0;
    const bucketLabels = Array.from({ length: 10 }, (_, index) => {
      const start = index * 10;
      const end = index === 9 ? 100 : start + 9;
      return `${start}-${end}%`;
    });
    const bucketCounts = Array.from({ length: 10 }, () => 0);
    sessionDetailLatestAttempts.forEach((attempt) => {
      const ratePercent = Math.max(0, Math.min(100, getScoreRate(attempt) * 100));
      const bucketIndex = ratePercent >= 100 ? 9 : Math.floor(ratePercent / 10);
      bucketCounts[bucketIndex] += 1;
    });
    return {
      attendedCount,
      absentCount,
      passCount,
      failCount,
      totalQuestions,
      averageCorrect,
      averageRate: sessionDetailOverview.averageScore,
      bucketLabels,
      bucketCounts,
      maxBucketCount: Math.max(0, ...bucketCounts),
    };
  }, [
    sessionDetailLatestAttempts,
    sessionDetailOverview.averageScore,
    sessionDetailPassRate,
    sessionDetailQuestions.length,
    sessionDetailUsesImportedResultsSummary,
    students,
  ]);

  const sessionDetailQuestionAnalysis = useMemo(() => {
    if (sessionDetailUsesImportedResultsSummary) return [];
    if (!sessionDetailQuestions.length || !sessionDetailLatestAttempts.length) return [];
    return buildQuestionAnalysisRows(sessionDetailLatestAttempts, sessionDetailQuestions)
      .sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        return String(a.qid).localeCompare(String(b.qid));
      });
  }, [sessionDetailLatestAttempts, sessionDetailQuestions, sessionDetailUsesImportedResultsSummary]);

  const sessionDetailQuestionStudents = useMemo(() => {
    return sessionDetailLatestAttempts
      .map((attempt) => {
        const student = students.find((item) => item.id === attempt.student_id) ?? null;
        return {
          id: attempt.student_id,
          display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
          student_code: attempt.student_code || student?.student_code || "",
        };
      })
      .sort((a, b) => {
        const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
        if (nameCompare !== 0) return nameCompare;
        return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
      });
  }, [sessionDetailLatestAttempts, students]);

  const sessionDetailSectionAverages = useMemo(() => {
    if (sessionDetailUsesImportedResultsSummary) return [];
    return buildSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions);
  }, [sessionDetailLatestAttempts, sessionDetailQuestions, sessionDetailUsesImportedResultsSummary]);

  const sessionDetailMainSectionAverages = useMemo(() => {
    if (sessionDetailUsesImportedModelSummary) {
      return buildImportedMainSectionAverageRows(sessionDetailLatestAttempts);
    }
    if (sessionDetailUsesImportedResultsSummary) return [];
    return buildMainSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions);
  }, [sessionDetailLatestAttempts, sessionDetailQuestions, sessionDetailUsesImportedModelSummary, sessionDetailUsesImportedResultsSummary]);

  const sessionDetailNestedSectionAverages = useMemo(() => {
    if (sessionDetailUsesImportedResultsSummary) return [];
    return buildNestedSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions);
  }, [sessionDetailLatestAttempts, sessionDetailQuestions, sessionDetailUsesImportedResultsSummary]);

  const sessionDetailStudentRankingRows = useMemo(() => {
    if (sessionDetailUsesImportedResultsSummary) {
      return buildImportedSessionStudentRankingRows(sessionDetailLatestAttempts, students);
    }
    return buildSessionStudentRankingRows(sessionDetailLatestAttempts, sessionDetailQuestions, students);
  }, [sessionDetailLatestAttempts, sessionDetailQuestions, sessionDetailUsesImportedResultsSummary, students]);

  const sessionDetailRankingSections = useMemo(() => {
    if (sessionDetailUsesImportedModelSummary) return sessionDetailMainSectionAverages;
    if (sessionDetailUsesImportedResultsSummary) return [];
    return sessionDetailSectionAverages;
  }, [
    sessionDetailMainSectionAverages,
    sessionDetailSectionAverages,
    sessionDetailUsesImportedModelSummary,
    sessionDetailUsesImportedResultsSummary,
  ]);

  useEffect(() => {
    if (!sessionDetailUsesImportedResultsSummary) return;
    if (sessionDetailTab === "analysis" || sessionDetailTab === "studentRanking") return;
    setSessionDetailTab("analysis");
  }, [sessionDetailTab, sessionDetailUsesImportedResultsSummary]);

  const studentModelAttempts = useMemo(() => {
    const modelAttempts = (studentAttempts ?? []).filter((attempt) => testMetaByVersion[attempt.test_version]?.type === "mock");
    const actualSessionIds = new Set(
      modelAttempts
        .filter((attempt) => !isImportedResultsSummaryAttempt(attempt))
        .map((attempt) => attempt.test_session_id)
        .filter(Boolean)
    );

    const choosePreferredImportedAttempt = (left, right) => {
      const buildScore = (attempt) => {
        const category = normalizeLookupValue(testMetaByVersion[attempt?.test_version]?.category || DEFAULT_MODEL_CATEGORY);
        const title = normalizeLookupValue(getAttemptTitle(attempt));
        let score = 0;
        if (attempt?.test_session_id && testSessionsById.has(attempt.test_session_id)) score += 4;
        if (title && title !== category) score += 8;
        if (String(attempt?.answers_json?.__meta?.imported_test_title ?? "").trim()) score += 2;
        return score;
      };
      const leftScore = buildScore(left);
      const rightScore = buildScore(right);
      if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
      return getRowTimestamp(left) >= getRowTimestamp(right) ? left : right;
    };

    const visibleActualAttempts = [];
    const importedBySessionId = new Map();
    const importedWithoutSession = [];

    modelAttempts.forEach((attempt) => {
      if (!isImportedResultsSummaryAttempt(attempt)) {
        visibleActualAttempts.push(attempt);
        return;
      }
      if (attempt.test_session_id && actualSessionIds.has(attempt.test_session_id)) return;
      if (attempt.test_session_id) {
        const existing = importedBySessionId.get(attempt.test_session_id);
        importedBySessionId.set(
          attempt.test_session_id,
          existing ? choosePreferredImportedAttempt(existing, attempt) : attempt
        );
        return;
      }
      importedWithoutSession.push(attempt);
    });

    const importedCandidates = [...importedBySessionId.values(), ...importedWithoutSession];
    const importedBySummaryKey = new Map();

    importedCandidates.forEach((attempt) => {
      const category = normalizeLookupValue(testMetaByVersion[attempt?.test_version]?.category || DEFAULT_MODEL_CATEGORY);
      const dateLabel = formatDateFull(getAttemptDisplayDateValue(attempt));
      const key = `${category}::${dateLabel}::${Number(attempt?.correct ?? 0)}::${Number(attempt?.total ?? 0)}::${getScoreRate(attempt).toFixed(6)}`;
      if (!importedBySummaryKey.has(key)) importedBySummaryKey.set(key, []);
      importedBySummaryKey.get(key).push(attempt);
    });

    const visibleImportedAttempts = [];
    importedBySummaryKey.forEach((group) => {
      const genericRows = group.filter((attempt) => isAttemptUsingCategoryTitle(attempt));
      const specificRows = group.filter((attempt) => !isAttemptUsingCategoryTitle(attempt));
      if (genericRows.length && specificRows.length) {
        visibleImportedAttempts.push(...specificRows);
        return;
      }
      visibleImportedAttempts.push(...group);
    });

    return [...visibleActualAttempts, ...visibleImportedAttempts].sort((left, right) => {
      const timeDiff = getAttemptDisplayTimestamp(right) - getAttemptDisplayTimestamp(left);
      if (timeDiff !== 0) return timeDiff;
      return getRowTimestamp(right) - getRowTimestamp(left);
    });
  }, [studentAttempts, testMetaByVersion, testSessionsById]);

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

  const dailyResultsImportCategories = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    [
      ...(dailyResultCategories ?? []).map((category) => category.name),
      ...(dailySessionCategories ?? []).map((category) => category.name),
      ...(dailyCategories ?? []).map((category) => category.name),
    ].forEach((name) => {
      const normalized = String(name ?? "").trim();
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      ordered.push(normalized);
    });
    return ordered.sort((left, right) => left.localeCompare(right));
  }, [dailyCategories, dailyResultCategories, dailySessionCategories]);

  const modelResultsImportCategories = useMemo(() => {
    return Array.from(new Set((modelCategories ?? []).map((category) => String(category.name ?? "").trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right));
  }, [modelCategories]);

  const studentModelAttemptsByCategory = useMemo(() => {
    const grouped = new Map();
    (studentModelAttempts ?? []).forEach((attempt) => {
      const category = testMetaByVersion[attempt.test_version]?.category || DEFAULT_MODEL_CATEGORY;
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(attempt);
    });
    const ordered = [];
    modelCategories.forEach((category) => {
      if (grouped.has(category.name)) ordered.push([category.name, grouped.get(category.name)]);
    });
    for (const entry of grouped.entries()) {
      if (!ordered.some((item) => item[0] === entry[0])) ordered.push(entry);
    }
    return ordered;
  }, [studentModelAttempts, testMetaByVersion, modelCategories]);

  const studentDailyAttempts = useMemo(() => {
    return (studentAttempts ?? []).filter((a) => testMetaByVersion[a.test_version]?.type !== "mock");
  }, [studentAttempts, testMetaByVersion]);

  const studentDailyAttemptsByCategory = useMemo(() => {
    const grouped = new Map();
    (studentDailyAttempts ?? []).forEach((a) => {
      const category = testMetaByVersion[a.test_version]?.category || "Uncategorized";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(a);
    });
    const ordered = [];
    dailyResultCategories.forEach((c) => {
      if (grouped.has(c.name)) ordered.push([c.name, grouped.get(c.name)]);
    });
    for (const entry of grouped.entries()) {
      if (!ordered.some((o) => o[0] === entry[0])) ordered.push(entry);
    }
    return ordered;
  }, [studentDailyAttempts, testMetaByVersion, dailyResultCategories]);

  const studentAttemptSummaryById = useMemo(() => {
    const summaryMap = {};
    (studentModelAttempts ?? []).forEach((a) => {
      const list = attemptQuestionsByVersion[a.test_version];
      if (!list) return;
      const rows = buildAttemptDetailRowsFromList(a.answers_json, list);
      const summary = buildMainSectionSummary(rows);
      const bySection = {};
      summary.forEach((s) => {
        bySection[s.section ?? s.mainSection] = s;
      });
      summaryMap[a.id] = bySection;
    });
    return summaryMap;
  }, [studentModelAttempts, attemptQuestionsByVersion]);

  const sectionTitles = useMemo(
    () => sections.filter((s) => s.key !== "DAILY").map((s) => s.title),
    []
  );

  const buildCategorySummaryRows = useCallback((groups) => {
    return (groups ?? []).map(([category, attemptsList]) => {
      const attempts = attemptsList ?? [];
      const count = attempts.length;
      const passCount = attempts.filter((attempt) => {
        const passRate = getAttemptEffectivePassRate(attempt);
        return getScoreRate(attempt) >= passRate;
      }).length;
      const failCount = Math.max(0, count - passCount);
      const totalCorrect = attempts.reduce((sum, attempt) => sum + Number(attempt.correct ?? 0), 0);
      const totalQuestions = attempts.reduce((sum, attempt) => sum + Number(attempt.total ?? 0), 0);
      const avgCorrect = count ? totalCorrect / count : 0;
      const avgTotal = count ? totalQuestions / count : 0;
      const avgRate = count
        ? attempts.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / count
        : 0;
      return {
        category,
        averageScoreLabel: count ? `${avgCorrect.toFixed(1)}/${avgTotal.toFixed(1)}` : "-",
        averageRateLabel: count ? `${(avgRate * 100).toFixed(1)}%` : "-",
        passCount,
        failCount,
      };
    });
  }, [getAttemptEffectivePassRate]);

  const studentModelCategorySummaryRows = useMemo(
    () => buildCategorySummaryRows(studentModelAttemptsByCategory),
    [buildCategorySummaryRows, studentModelAttemptsByCategory]
  );

  const studentDailyCategorySummaryRows = useMemo(
    () => buildCategorySummaryRows(studentDailyAttemptsByCategory),
    [buildCategorySummaryRows, studentDailyAttemptsByCategory]
  );

  const filteredStudentAttendance = useMemo(() => {
    if (!studentAttendanceRange.from && !studentAttendanceRange.to) return studentAttendance;
    return (studentAttendance ?? []).filter((row) => {
      if (studentAttendanceRange.from && row.day_date < studentAttendanceRange.from) return false;
      if (studentAttendanceRange.to && row.day_date > studentAttendanceRange.to) return false;
      return true;
    });
  }, [studentAttendance, studentAttendanceRange]);

  const [modelConductCategory, setModelConductCategory] = useState("");
  const [dailyConductCategory, setDailyConductCategory] = useState("");
  const [modelUploadCategory, setModelUploadCategory] = useState("");
  const [dailyUploadCategory, setDailyUploadCategory] = useState("");

  const selectedModelConductCategory = useMemo(() => {
    if (!modelCategories.length || !modelConductCategory) return null;
    return modelCategories.find((c) => c.name === modelConductCategory) ?? null;
  }, [modelCategories, modelConductCategory]);

  const modelConductTests = selectedModelConductCategory?.tests ?? [];
  const selectedDailySourceCategoryNames = useMemo(() => {
    if (!dailyCategories.length) return [];
    const validNames = new Set(dailyCategories.map((category) => category.name));
    const requestedNames = [dailyConductCategory, ...(dailySessionForm.source_categories ?? [])];
    return Array.from(new Set(requestedNames.filter((name) => validNames.has(name))));
  }, [dailyCategories, dailyConductCategory, dailySessionForm.selection_mode, dailySessionForm.source_categories]);

  const dailyConductTests = useMemo(() => {
    if (!selectedDailySourceCategoryNames.length) return [];
    const categorySet = new Set(selectedDailySourceCategoryNames);
    const byVersion = new Map();
    dailyCategories.forEach((category) => {
      if (!categorySet.has(category.name)) return;
      category.tests.forEach((test) => {
        if (!test?.version || byVersion.has(test.version)) return;
        byVersion.set(test.version, test);
      });
    });
    return Array.from(byVersion.values());
  }, [dailyCategories, selectedDailySourceCategoryNames]);

  const dailySessionCategorySelectValue = useMemo(() => {
    if (!dailySessionCategories.length) return CUSTOM_CATEGORY_OPTION;
    return dailySessionCategories.some((category) => category.name === dailySessionForm.session_category)
      ? dailySessionForm.session_category
      : CUSTOM_CATEGORY_OPTION;
  }, [dailySessionCategories, dailySessionForm.session_category]);

  const selectedDailyProblemSetIds = useMemo(() => {
    const availableIds = new Set(dailyConductTests.map((test) => test.version).filter(Boolean));
    const selectedIds = dailySessionForm.selection_mode === "multiple"
      ? (dailySessionForm.problem_set_ids ?? []).filter((id) => availableIds.has(id))
      : [dailySessionForm.problem_set_id].filter((id) => availableIds.has(id));
    return Array.from(new Set(selectedIds));
  }, [dailyConductTests, dailySessionForm.problem_set_id, dailySessionForm.problem_set_ids, dailySessionForm.selection_mode]);
  const selectedDailyQuestionCount = useMemo(
    () => selectedDailyProblemSetIds.reduce((total, version) => {
      const test = dailyConductTests.find((item) => item.version === version);
      return total + Number(test?.question_count ?? 0);
    }, 0),
    [dailyConductTests, selectedDailyProblemSetIds]
  );

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

  const selectedDailyCategory = useMemo(() => {
    if (!dailyResultCategories.length) return null;
    return dailyResultCategories.find((c) => c.name === dailyResultsCategory) ?? dailyResultCategories[0];
  }, [dailyResultCategories, dailyResultsCategory]);

  const selectedModelCategory = useMemo(() => {
    if (!modelResultCategories.length || !modelResultsCategory) return null;
    return modelResultCategories.find((c) => c.name === modelResultsCategory) ?? null;
  }, [modelResultCategories, modelResultsCategory]);

  useEffect(() => {
    if (!dailyResultCategories.length) return;
    if (!dailyResultsCategory || !dailyResultCategories.some((c) => c.name === dailyResultsCategory)) {
      setDailyResultsCategory(dailyResultCategories[0].name);
    }
  }, [dailyResultCategories, dailyResultsCategory]);

  useEffect(() => {
    if (!pastDailySessionCategories.length) {
      if (dailyRetakeCategory) setDailyRetakeCategory("");
      return;
    }
    if (!dailyRetakeCategory || !pastDailySessionCategories.some((category) => category.name === dailyRetakeCategory)) {
      setDailyRetakeCategory(pastDailySessionCategories[0].name);
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
    if (source) applyDailyRetakeSourceSession(source);
  }, [dailyConductMode, dailyRetakeSourceId, filteredPastDailySessions]);

  useEffect(() => {
    if (!modelResultCategories.length) {
      if (modelResultsCategory) setModelResultsCategory("");
      return;
    }
    if (modelResultsCategory && !modelResultCategories.some((c) => c.name === modelResultsCategory)) {
      setModelResultsCategory("");
    }
  }, [modelResultCategories, modelResultsCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (dailyForm.category && dailyCategories.some((c) => c.name === dailyForm.category)) {
      setDailyCategorySelect(dailyForm.category);
      return;
    }
    if (!dailyForm.category && dailyCategories.length) {
      setDailyCategorySelect(dailyCategories[0].name);
      setDailyForm((s) => ({ ...s, category: dailyCategories[0].name }));
    } else {
      setDailyCategorySelect("__custom__");
    }
  }, [dailyCategories, dailyForm.category]);

  useEffect(() => {
    if (!modelCategories.length) {
      setAssetCategorySelect(DEFAULT_MODEL_CATEGORY);
      if (!assetForm.category) {
        setAssetForm((s) => ({ ...s, category: DEFAULT_MODEL_CATEGORY }));
      }
      return;
    }
    if (assetForm.category && modelCategories.some((c) => c.name === assetForm.category)) {
      setAssetCategorySelect(assetForm.category);
      return;
    }
    if (assetCategorySelect === "__custom__") {
      setAssetCategorySelect("__custom__");
      return;
    }
    const fallbackCategory = modelCategories[0]?.name ?? DEFAULT_MODEL_CATEGORY;
    setAssetCategorySelect(fallbackCategory);
    if (assetForm.category !== fallbackCategory) {
      setAssetForm((s) => ({ ...s, category: fallbackCategory }));
    }
  }, [modelCategories, assetForm.category, assetCategorySelect]);

  useEffect(() => {
    if (!modelCategories.length) {
      if (modelConductCategory) setModelConductCategory("");
      return;
    }
    if (modelConductCategory && !modelCategories.some((c) => c.name === modelConductCategory)) {
      setModelConductCategory("");
    }
  }, [modelCategories, modelConductCategory]);

  function openModelUploadModal() {
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
  }

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
      if (
        nextSourceCategories.length === (current.source_categories ?? []).length
        && nextSourceCategories.every((name, index) => name === (current.source_categories ?? [])[index])
      ) {
        return current;
      }
      return {
        ...current,
        source_categories: nextSourceCategories,
      };
    });
  }, [dailyCategories, dailyConductCategory]);

  useEffect(() => {
    if (!activeModelTimePicker) return;
    function handlePointerDown(event) {
      if (event.target.closest("[data-model-time-picker]")) return;
      setActiveModelTimePicker("");
    }
    function handleEscape(event) {
      if (event.key === "Escape") {
        setActiveModelTimePicker("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeModelTimePicker]);

  useEffect(() => {
    if (!dailySetDropdownOpen) return;
    function handleClickOutside(event) {
      const root = dailySetDropdownRef.current;
      if (!root) return;
      if (!root.contains(event.target)) {
        setDailySetDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dailySetDropdownOpen]);

  useEffect(() => {
    if (!dailySourceCategoryDropdownOpen) return;
    function handleClickOutside(event) {
      const root = dailySourceCategoryDropdownRef.current;
      if (!root) return;
      if (!root.contains(event.target)) {
        setDailySourceCategoryDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dailySourceCategoryDropdownOpen]);

  useEffect(() => {
    if (!activeDailyTimePicker) return;
    function handlePointerDown(event) {
      if (event.target.closest("[data-daily-time-picker]")) return;
      setActiveDailyTimePicker("");
    }
    function handleEscape(event) {
      if (event.key === "Escape") {
        setActiveDailyTimePicker("");
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [activeDailyTimePicker]);

  useEffect(() => {
    if (!modelConductTests.length) return;
    if (!modelConductTests.some((t) => t.version === testSessionForm.problem_set_id)) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: modelConductTests[0].version }));
    }
  }, [modelConductTests, testSessionForm.problem_set_id]);

  useEffect(() => {
    if (dailyConductMode === "retake") return;
    if (!dailyConductTests.length) return;
    const availableIds = dailyConductTests.map((t) => t.version).filter(Boolean);
    const firstVersion = availableIds[0] ?? "";
    setDailySessionForm((current) => {
      const nextIds = (current.problem_set_ids ?? []).filter((id) => availableIds.includes(id));
      const nextProblemSetId = availableIds.includes(current.problem_set_id) ? current.problem_set_id : firstVersion;
      const normalizedIds = current.selection_mode === "multiple"
        ? (nextIds.length ? nextIds : (nextProblemSetId ? [nextProblemSetId] : []))
        : nextIds;
      if (
        nextProblemSetId === current.problem_set_id
        && normalizedIds.length === (current.problem_set_ids ?? []).length
        && normalizedIds.every((id, index) => id === (current.problem_set_ids ?? [])[index])
      ) {
        return current;
      }
      return {
        ...current,
        problem_set_id: nextProblemSetId,
        problem_set_ids: normalizedIds,
      };
    });
  }, [dailyConductMode, dailyConductTests, dailySessionForm.problem_set_id, dailySessionForm.problem_set_ids, dailySessionForm.selection_mode]);

  const resultContext = useMemo(() => {
    if (activeTab === "model" && modelSubTab === "results") {
      return { type: "mock", title: "Model Test Results", tests: modelTests };
    }
    if (activeTab === "daily" && dailySubTab === "results") {
      return { type: "daily", title: "Daily Test Results", tests: dailyTests };
    }
    return null;
  }, [activeTab, modelSubTab, dailySubTab, modelTests, dailyTests]);

  const selectedAttemptQuestions = useMemo(() => {
    const version = selectedAttempt?.test_version;
    return version ? attemptQuestionsByVersion[version] : null;
  }, [selectedAttempt, attemptQuestionsByVersion]);

  const selectedAttemptUsesImportedSummary = useMemo(
    () => isImportedSummaryAttempt(selectedAttempt),
    [selectedAttempt]
  );

  const selectedAttemptUsesImportedModelSummary = useMemo(
    () => isImportedModelResultsSummaryAttempt(selectedAttempt),
    [selectedAttempt]
  );

  const selectedAttemptRows = useMemo(() => {
    if (!selectedAttempt) return [];
    if (selectedAttemptUsesImportedSummary) return [];
    if (selectedAttemptQuestions && selectedAttemptQuestions.length) {
      return buildAttemptDetailRowsFromList(selectedAttempt.answers_json, selectedAttemptQuestions);
    }
    return buildAttemptDetailRows(selectedAttempt.answers_json);
  }, [selectedAttempt, selectedAttemptQuestions, selectedAttemptUsesImportedSummary]);

  const selectedAttemptSectionSummary = useMemo(
    () => (selectedAttemptUsesImportedModelSummary ? getImportedModelSectionSummaries(selectedAttempt) : buildSectionSummary(selectedAttemptRows)),
    [selectedAttempt, selectedAttemptRows, selectedAttemptUsesImportedModelSummary]
  );

  const selectedAttemptIsModel = useMemo(
    () => testMetaByVersion[selectedAttempt?.test_version]?.type === "mock",
    [selectedAttempt, testMetaByVersion]
  );

  const selectedAttemptMainSectionSummary = useMemo(
    () => (selectedAttemptUsesImportedModelSummary ? getImportedModelSectionSummaries(selectedAttempt) : buildMainSectionSummary(selectedAttemptRows)),
    [selectedAttempt, selectedAttemptRows, selectedAttemptUsesImportedModelSummary]
  );

  const selectedAttemptNestedSectionSummary = useMemo(
    () => (selectedAttemptUsesImportedModelSummary ? [] : buildNestedSectionSummary(selectedAttemptRows)),
    [selectedAttemptRows, selectedAttemptUsesImportedModelSummary]
  );

  const selectedAttemptPassRate = useMemo(() => {
    if (isImportedResultsSummaryAttempt(selectedAttempt)) return 0.8;
    return normalizePassRate(testPassRateByVersion[selectedAttempt?.test_version]);
  }, [selectedAttempt, testPassRateByVersion]);

  const selectedAttemptQuestionSections = useMemo(() => {
    const groups = new Map();
    (selectedAttemptRows ?? []).forEach((row) => {
      const key = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const ordered = sections
      .filter((section) => section.key !== "DAILY")
      .map((section) => getSectionTitle(section.key))
      .filter((title) => groups.has(title))
      .map((title) => ({ title, rows: groups.get(title) ?? [] }));
    for (const [title, rows] of groups.entries()) {
      if (!ordered.some((section) => section.title === title)) {
        ordered.push({ title, rows });
      }
    }
    return ordered;
  }, [selectedAttemptRows]);

  const selectedAttemptQuestionSectionsFiltered = useMemo(() => {
    return selectedAttemptQuestionSections
      .map((section) => ({
        ...section,
        rows: attemptDetailWrongOnly ? section.rows.filter((row) => !row.isCorrect) : section.rows,
      }))
      .filter((section) => section.rows.length > 0);
  }, [selectedAttemptQuestionSections, attemptDetailWrongOnly]);

  const selectedAttemptScoreRate = selectedAttempt ? getScoreRate(selectedAttempt) : 0;
  const selectedAttemptIsPass = selectedAttemptScoreRate >= selectedAttemptPassRate;

  const attendanceSummary = useMemo(() => buildAttendanceSummary(studentAttendance), [studentAttendance]);

  const studentAttendanceMonthOptions = useMemo(() => {
    const months = attendanceSummary.months.map((month) => {
      const parts = month.key.split("-");
      const label = parts.length === 2
        ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
          })
        : month.label;
      return {
        key: month.key,
        label,
        stats: month.stats,
      };
    });
    return [{ key: "__all__", label: "All period", stats: attendanceSummary.overall }, ...months];
  }, [attendanceSummary]);

  const selectedStudentAttendanceMonth = useMemo(() => {
    return studentAttendanceMonthOptions.find((option) => option.key === studentAttendanceMonthKey) ?? studentAttendanceMonthOptions[0] ?? {
      key: "__all__",
      label: "All period",
      stats: attendanceSummary.overall,
    };
  }, [attendanceSummary, studentAttendanceMonthKey, studentAttendanceMonthOptions]);

  const studentAttendanceMonthIndex = Math.max(
    0,
    studentAttendanceMonthOptions.findIndex((option) => option.key === selectedStudentAttendanceMonth.key)
  );
  const studentAttendancePrevMonthKey = studentAttendanceMonthOptions[studentAttendanceMonthIndex - 1]?.key ?? "";
  const studentAttendanceNextMonthKey = studentAttendanceMonthOptions[studentAttendanceMonthIndex + 1]?.key ?? "";

  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);
  const studentAttendancePie = useMemo(
    () => buildAttendancePieData(selectedStudentAttendanceMonth.stats),
    [selectedStudentAttendanceMonth]
  );

  useEffect(() => {
    if (!studentAttendanceMonthOptions.some((option) => option.key === studentAttendanceMonthKey)) {
      setStudentAttendanceMonthKey(studentAttendanceMonthOptions[0]?.key ?? "__all__");
    }
  }, [studentAttendanceMonthKey, studentAttendanceMonthOptions]);

  useEffect(() => {
    setStudentAttendanceMonthKey("__all__");
  }, [selectedStudent?.id]);

  const sortedStudents = useMemo(() => {
    const list = [...(students ?? [])];
    const codeNum = (code) => {
      const m = String(code ?? "").match(/(\d+)/);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    list.sort((a, b) => {
      const aNum = codeNum(a.student_code);
      const bNum = codeNum(b.student_code);
      if (aNum !== bNum) return aNum - bNum;
      const aCode = String(a.student_code ?? "");
      const bCode = String(b.student_code ?? "");
      if (aCode !== bCode) return aCode.localeCompare(bCode);
      const aName = String(a.display_name ?? "");
      const bName = String(b.display_name ?? "");
      if (aName !== bName) return aName.localeCompare(bName);
      return String(a.email ?? "").localeCompare(String(b.email ?? ""));
    });
    return list;
  }, [students]);

  const buildSessionResultsMatrix = useCallback((selectedCategory) => {
    const testsForCategory = selectedCategory?.tests ?? [];
    if (!testsForCategory.length) return { sessions: [], rows: [] };

    const testByVersion = new Map(testsForCategory.map((test) => [test.version, test]));
    const categorySessions = (testSessions ?? [])
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
    (attempts ?? []).forEach((attempt) => {
      if (!attempt?.student_id || !attempt?.test_session_id) return;
      const sourceSession = sessionById.get(attempt.test_session_id);
      if (!sourceSession) return;
      const canonicalSession = getCanonicalSession(sourceSession);
      if (!canonicalSession?.id) return;
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
        if (leftTime !== rightTime) return leftTime - rightTime;
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

    const rows = (sortedStudents ?? []).map((student, idx) => {
      const perStudent = byStudent.get(student.id) ?? new Map();
      const cells = sessionList.map((session) => perStudent.get(session.id) ?? []);
      return { index: idx + 1, student, cells };
    });

    return { sessions: sessionList, rows };
  }, [attempts, sortedStudents, testSessions]);

  const dailyResultsMatrix = useMemo(
    () => buildSessionResultsMatrix(selectedDailyCategory),
    [buildSessionResultsMatrix, selectedDailyCategory]
  );

  const modelResultsMatrix = useMemo(
    () => buildSessionResultsMatrix(selectedModelCategory ?? { tests: modelTests }),
    [buildSessionResultsMatrix, selectedModelCategory, modelTests]
  );

  const dailyManualEntryStudent = useMemo(
    () => sortedStudents.find((student) => student.id === dailyManualEntryModal.studentId) ?? null,
    [dailyManualEntryModal.studentId, sortedStudents]
  );

  const dailyManualEntrySession = useMemo(
    () => dailyResultsMatrix.sessions.find((session) => session.id === dailyManualEntryModal.sessionId) ?? null,
    [dailyManualEntryModal.sessionId, dailyResultsMatrix.sessions]
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
  }, []);

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

  const attendanceDayColumns = useMemo(() => {
    return attendanceDays.map((d) => ({
      ...d,
      label: `${formatDateShort(d.day_date)} (${formatWeekday(d.day_date)})`,
    }));
  }, [attendanceDays]);

  const attendanceRangeColumns = useMemo(() => {
    const start = attendanceFilter.startDate;
    const end = attendanceFilter.endDate;
    if (!start && !end) return attendanceDayColumns;
    return attendanceDayColumns.filter((d) => {
      const day = d.day_date;
      if (start && day < start) return false;
      if (end && day > end) return false;
      return true;
    });
  }, [attendanceDayColumns, attendanceFilter.startDate, attendanceFilter.endDate]);

  const activeStudents = useMemo(
    () => (sortedStudents ?? []).filter((s) => !s.is_withdrawn),
    [sortedStudents]
  );

  const analyticsStudents = useMemo(
    () => (sortedStudents ?? []).filter((student) => !isAnalyticsExcludedStudent(student)),
    [sortedStudents]
  );

  const scheduleRecordRows = useMemo(() => {
    const today = getTodayDateInput();
    const planningEnd = addMonths(today, 2);
    const dateSet = new Set();
    for (let date = today; date && date <= planningEnd; date = addDays(date, 1)) {
      dateSet.add(date);
    }
    (dailyRecords ?? []).forEach((record) => {
      if (record?.record_date) dateSet.add(record.record_date);
    });
    return Array.from(dateSet)
      .sort((a, b) => a.localeCompare(b))
      .map((recordDate) => {
        const record = (dailyRecords ?? []).find((item) => item.record_date === recordDate) ?? null;
        const draft = {
          ...getEmptyDailyRecordPlanDraft(),
          ...(record ? {
            mini_test_1: record.mini_test_1 ?? "",
            mini_test_2: record.mini_test_2 ?? "",
            special_test_1: record.special_test_1 ?? "",
          } : {}),
          ...(dailyRecordPlanDrafts[recordDate] ?? {}),
        };
        return { recordDate, record, draft };
      });
  }, [dailyRecords, dailyRecordPlanDrafts]);

  const scheduleRecordActualTestsByDate = useMemo(() => {
    const byDate = {};
    (testSessions ?? []).forEach((session) => {
      const scheduleDate = getBangladeshDateInput(getSessionScheduleSource(session));
      if (!scheduleDate) return;
      if (session.retake_source_session_id || isRetakeSessionTitle(session.title)) return;
      const item = {
        id: session.id,
        title: String(session.title ?? "").trim() || getProblemSetTitle(session.problem_set_id, tests) || session.problem_set_id || "-",
        sortValue: new Date(getSessionScheduleSource(session)).getTime(),
      };
      if (!byDate[scheduleDate]) byDate[scheduleDate] = [];
      byDate[scheduleDate].push(item);
    });

    Object.values(byDate).forEach((group) => {
      group.sort((a, b) => a.sortValue - b.sortValue);
    });

    return byDate;
  }, [testSessions, tests]);

  const scheduleRecordDisplayByDate = useMemo(() => {
    const confirmedSet = new Set(dailyRecordConfirmedDates);
    const recordByDate = Object.fromEntries((dailyRecords ?? []).filter((record) => record?.record_date).map((record) => [record.record_date, record]));
    const displayMap = {};
    scheduleRecordRows.forEach(({ recordDate, draft }) => {
      const record = recordByDate[recordDate] ?? null;
      const previousRecord = recordByDate[addDays(recordDate, -1)] ?? null;
      const isConfirmed = Boolean(previousRecord?.id) && confirmedSet.has(recordDate);
      const actualTests = scheduleRecordActualTestsByDate[recordDate] ?? [];
      const isHoliday = resolveDailyRecordHoliday(recordDate, record?.is_holiday);
      displayMap[recordDate] = {
        isConfirmed,
        isHoliday,
        mini_test_1: isConfirmed ? (actualTests[0]?.title ?? "-") : draft.mini_test_1,
        mini_test_2: isConfirmed ? (actualTests[1]?.title ?? "-") : draft.mini_test_2,
        special_test_1: isConfirmed ? (actualTests[2]?.title ?? "-") : draft.special_test_1,
      };
    });
    return displayMap;
  }, [dailyRecordConfirmedDates, dailyRecords, scheduleRecordActualTestsByDate, scheduleRecordRows]);

  const dailyRecordSelectableDates = useMemo(() => {
    const today = getTodayDateInput();
    return scheduleRecordRows
      .map(({ recordDate, record }) => ({
        recordDate,
        isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
      }))
      .filter((item) => item.recordDate >= today && !item.isHoliday)
      .map((item) => item.recordDate);
  }, [scheduleRecordRows]);

  const dailyRecordSelectableDateSet = useMemo(
    () => new Set(dailyRecordSelectableDates),
    [dailyRecordSelectableDates]
  );

  const dailyRecordCalendarMonths = useMemo(() => {
    const today = getTodayDateInput();
    const optionMap = new Map(
      scheduleRecordRows
        .map(({ recordDate, record }) => [
          recordDate,
          {
            isVisible: recordDate >= today,
            isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
          },
        ])
    );
    const monthKeys = Array.from(
      new Set(
        Array.from(optionMap.entries())
          .filter(([, value]) => value.isVisible)
          .map(([recordDate]) => recordDate.slice(0, 7))
      )
    ).sort();

    return monthKeys.map((monthKey) => {
      const monthStart = `${monthKey}-01`;
      const leadingBlankCount = getWeekdayNumber(monthStart) ?? 0;
      const monthDates = [];
      for (let date = monthStart; date.slice(0, 7) === monthKey; date = addDays(date, 1)) {
        const option = optionMap.get(date);
        monthDates.push({
          recordDate: date,
          dayNumber: Number(date.slice(-2)),
          isVisible: Boolean(option?.isVisible),
          isHoliday: Boolean(option?.isHoliday),
          isSelectable: Boolean(option?.isVisible) && !option?.isHoliday,
        });
      }

      const cells = [
        ...Array.from({ length: leadingBlankCount }, () => null),
        ...monthDates,
      ];
      while (cells.length % 7 !== 0) {
        cells.push(null);
      }

      return {
        monthKey,
        label: formatMonthYear(monthStart),
        weeks: Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7)),
      };
    });
  }, [scheduleRecordRows]);

  const dailyRecordCalendarMonthKeys = useMemo(
    () => dailyRecordCalendarMonths.map((month) => month.monthKey),
    [dailyRecordCalendarMonths]
  );

  const dailyRecordActiveCalendarMonth = useMemo(() => {
    return dailyRecordCalendarMonths.find((month) => month.monthKey === dailyRecordCalendarMonth)
      ?? dailyRecordCalendarMonths[0]
      ?? null;
  }, [dailyRecordCalendarMonth, dailyRecordCalendarMonths]);

  const dailyRecordTomorrowSessions = useMemo(() => {
    const targetDate = addDays(dailyRecordForm.record_date || getTodayDateInput(), 1);
    const rows = (testSessions ?? [])
      .map((session) => {
        const scheduleSource = getSessionScheduleSource(session);
        if (!scheduleSource || getBangladeshDateInput(scheduleSource) !== targetDate) return null;
        const fallbackTitle = getProblemSetTitle(session.problem_set_id, tests) || session.problem_set_id || "Untitled test";
        const rawTitle = String(session.title ?? "").trim() || fallbackTitle;
        const isRetake = Boolean(session.retake_source_session_id) || isRetakeSessionTitle(rawTitle);
        return {
          id: session.id,
          isRetake,
          title: isRetake ? (getRetakeBaseTitle(rawTitle) || fallbackTitle) : rawTitle,
          timeLabel: formatAnnouncementScheduleTime(scheduleSource),
          sortValue: new Date(scheduleSource).getTime(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = Number.isFinite(a.sortValue) ? a.sortValue : Number.MAX_SAFE_INTEGER;
        const bTime = Number.isFinite(b.sortValue) ? b.sortValue : Number.MAX_SAFE_INTEGER;
        if (aTime !== bTime) return aTime - bTime;
        return a.title.localeCompare(b.title);
      });

    return {
      targetDate,
      regular: rows.filter((row) => !row.isRetake),
      retake: rows.filter((row) => row.isRetake),
    };
  }, [dailyRecordForm.record_date, testSessions, tests]);

  useEffect(() => {
    if (!dailyRecordSelectableDates.length) return;
    if (dailyRecordSelectableDateSet.has(dailyRecordDate)) return;
    setDailyRecordDate(dailyRecordSelectableDates[0]);
  }, [dailyRecordDate, dailyRecordSelectableDates, dailyRecordSelectableDateSet]);

  useEffect(() => {
    if (!dailyRecordCalendarMonthKeys.length) return;
    if (dailyRecordCalendarMonthKeys.includes(dailyRecordCalendarMonth)) return;
    const selectedMonth = dailyRecordDate.slice(0, 7);
    setDailyRecordCalendarMonth(
      dailyRecordCalendarMonthKeys.includes(selectedMonth)
        ? selectedMonth
        : dailyRecordCalendarMonthKeys[0]
    );
  }, [dailyRecordCalendarMonth, dailyRecordCalendarMonthKeys, dailyRecordDate]);

  useEffect(() => {
    if (!dailyRecordDatePickerOpen || !dailyRecordCalendarMonthKeys.length) return;
    const selectedMonth = dailyRecordDate.slice(0, 7);
    setDailyRecordCalendarMonth(
      dailyRecordCalendarMonthKeys.includes(selectedMonth)
        ? selectedMonth
        : dailyRecordCalendarMonthKeys[0]
    );
  }, [dailyRecordDate, dailyRecordDatePickerOpen, dailyRecordCalendarMonthKeys]);

  useEffect(() => {
    if (!dailyRecordDatePickerOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!dailyRecordDatePickerRef.current?.contains(event.target)) {
        setDailyRecordDatePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [dailyRecordDatePickerOpen]);

  const dailyRecordAnnouncementTitle = useMemo(
    () => `Exam Syllabus (${formatDateDots(dailyRecordTomorrowSessions.targetDate)})`,
    [dailyRecordTomorrowSessions.targetDate]
  );

  const dailyRecordAutoAnnouncementDraft = useMemo(() => {
    const lines = [];
    if (dailyRecordTomorrowSessions.regular.length) {
      dailyRecordTomorrowSessions.regular.forEach((session, index) => {
        lines.push(`${index + 1}. ${session.title}${session.timeLabel ? ` (${session.timeLabel})` : ""}`);
      });
    } else {
      lines.push("No tests scheduled.");
    }
    if (dailyRecordTomorrowSessions.retake.length) {
      lines.push("");
      lines.push("Retake syllabus:");
      dailyRecordTomorrowSessions.retake.forEach((session, index) => {
        lines.push(`${index + 1}. ${session.title}${session.timeLabel ? ` (${session.timeLabel})` : ""}`);
      });
    }
    return lines.join("\n");
  }, [dailyRecordTomorrowSessions]);

  const dailyRecordSyllabusAnnouncementByDate = useMemo(() => {
    const map = {};
    (dailyRecordSyllabusAnnouncements ?? []).forEach((announcement) => {
      const dateKey = parseSyllabusAnnouncementDate(announcement.title);
      if (!dateKey) return;
      const current = map[dateKey];
      const announcementTime = new Date(announcement.publish_at || announcement.created_at || 0).getTime();
      const currentTime = current ? new Date(current.publish_at || current.created_at || 0).getTime() : -Infinity;
      if (!current || announcementTime >= currentTime) {
        map[dateKey] = announcement;
      }
    });
    return map;
  }, [dailyRecordSyllabusAnnouncements]);

  const dailyRecordExistingAnnouncement = useMemo(
    () => dailyRecordSyllabusAnnouncementByDate[dailyRecordTomorrowSessions.targetDate] ?? null,
    [dailyRecordSyllabusAnnouncementByDate, dailyRecordTomorrowSessions.targetDate]
  );

  const dailyRecordAnnouncementNeedsEdit = useMemo(() => {
    if (!dailyRecordExistingAnnouncement) return false;
    return (
      normalizeAnnouncementDraftText(dailyRecordExistingAnnouncement.title) !== normalizeAnnouncementDraftText(dailyRecordAnnouncementTitle)
      || normalizeAnnouncementDraftText(dailyRecordExistingAnnouncement.body) !== normalizeAnnouncementDraftText(dailyRecordAutoAnnouncementDraft)
    );
  }, [dailyRecordAnnouncementTitle, dailyRecordAutoAnnouncementDraft, dailyRecordExistingAnnouncement]);

  const rankingRowCount = useMemo(
    () => Math.max(0, ...rankingPeriods.map((period) => period.ranking_entries?.length ?? 0)),
    [rankingPeriods]
  );

  useEffect(() => {
    if (activeTab !== "dailyRecord") return;
    const wrap = dailyRecordTableWrapRef.current;
    if (!(wrap instanceof HTMLElement)) return;
    const today = getTodayDateInput();
    const targetRow = wrap.querySelector(`[data-daily-record-date="${today}"]`);
    if (!(targetRow instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      const wrapRect = wrap.getBoundingClientRect();
      const rowRect = targetRow.getBoundingClientRect();
      wrap.scrollTop += rowRect.top - wrapRect.top;
    });
  }, [activeTab, scheduleRecordRows.length]);

  useEffect(() => {
    if (!dailyRecordModalOpen) return;
    if (dailyRecordExistingAnnouncement && !dailyRecordAnnouncementNeedsEdit) {
      setDailyRecordAnnouncementTitleDraft(dailyRecordExistingAnnouncement.title ?? "");
      setDailyRecordAnnouncementDraft(dailyRecordExistingAnnouncement.body ?? "");
      return;
    }
    setDailyRecordAnnouncementTitleDraft(dailyRecordAnnouncementTitle);
    setDailyRecordAnnouncementDraft(dailyRecordAutoAnnouncementDraft);
  }, [
    dailyRecordAnnouncementNeedsEdit,
    dailyRecordAnnouncementTitle,
    dailyRecordAutoAnnouncementDraft,
    dailyRecordExistingAnnouncement,
    dailyRecordModalOpen,
  ]);

  const attendanceFilteredStudents = useMemo(() => {
    const minRate = attendanceFilter.minRate === "" ? null : Number(attendanceFilter.minRate);
    const minAbsences = attendanceFilter.minAbsences === "" ? null : Number(attendanceFilter.minAbsences);
    return activeStudents.filter((s) => {
      const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
      const stats = buildAttendanceStats(perDay);
      const rate = stats.total ? (stats.present / stats.total) * 100 : 0;
      const absences = stats.unexcused;
      if (minRate != null && rate >= minRate) return false;
      if (minAbsences != null && absences < minAbsences) return false;
      return true;
    });
  }, [activeStudents, attendanceFilter, attendanceRangeColumns, attendanceEntriesByDay]);

  const attendanceAnalyticsStudents = useMemo(
    () => attendanceFilteredStudents.filter((student) => !isAnalyticsExcludedStudent(student)),
    [attendanceFilteredStudents]
  );

  const attendanceDayRates = useMemo(() => {
    const rates = {};
    attendanceDayColumns.forEach((day) => {
      const statuses = attendanceAnalyticsStudents.map((student) => attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "");
      rates[day.id] = buildAttendanceStats(statuses).rate;
    });
    return rates;
  }, [attendanceAnalyticsStudents, attendanceDayColumns, attendanceEntriesByDay]);

  const resolveAttendanceImportConflict = useCallback((choice) => {
    const resolve = attendanceImportChoiceResolverRef.current;
    attendanceImportChoiceResolverRef.current = null;
    setAttendanceImportConflict(null);
    if (resolve) resolve(choice);
  }, []);

  const promptAttendanceImportConflict = useCallback((dayDates) => {
    return new Promise((resolve) => {
      if (attendanceImportChoiceResolverRef.current) {
        attendanceImportChoiceResolverRef.current("cancel");
      }
      attendanceImportChoiceResolverRef.current = resolve;
      setAttendanceImportConflict({
        dayDates,
        previewDates: dayDates.slice(0, 8),
      });
    });
  }, []);

  const resolveModelResultsImportConflict = useCallback((choice) => {
    const resolve = modelResultsImportChoiceResolverRef.current;
    modelResultsImportChoiceResolverRef.current = null;
    setModelResultsImportConflict(null);
    if (resolve) resolve(choice);
  }, []);

  const resolveDailyResultsImportConflict = useCallback((choice) => {
    const resolve = dailyResultsImportChoiceResolverRef.current;
    dailyResultsImportChoiceResolverRef.current = null;
    setDailyResultsImportConflict(null);
    if (resolve) resolve(choice);
  }, []);

  const promptDailyResultsImportConflict = useCallback((testTitles) => {
    return new Promise((resolve) => {
      if (dailyResultsImportChoiceResolverRef.current) {
        dailyResultsImportChoiceResolverRef.current("cancel");
      }
      dailyResultsImportChoiceResolverRef.current = resolve;
      setDailyResultsImportConflict({
        testTitles,
        previewTitles: testTitles.slice(0, 8),
      });
    });
  }, []);

  const promptModelResultsImportConflict = useCallback((testTitles) => {
    return new Promise((resolve) => {
      if (modelResultsImportChoiceResolverRef.current) {
        modelResultsImportChoiceResolverRef.current("cancel");
      }
      modelResultsImportChoiceResolverRef.current = resolve;
      setModelResultsImportConflict({
        testTitles,
        previewTitles: testTitles.slice(0, 8),
      });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (attendanceImportChoiceResolverRef.current) {
        attendanceImportChoiceResolverRef.current("cancel");
        attendanceImportChoiceResolverRef.current = null;
      }
      if (dailyResultsImportChoiceResolverRef.current) {
        dailyResultsImportChoiceResolverRef.current("cancel");
        dailyResultsImportChoiceResolverRef.current = null;
      }
      if (modelResultsImportChoiceResolverRef.current) {
        modelResultsImportChoiceResolverRef.current("cancel");
        modelResultsImportChoiceResolverRef.current = null;
      }
    };
  }, []);

  const closeAttendanceImportStatus = useCallback(() => {
    setAttendanceImportStatus((current) => (current?.loading ? current : null));
  }, []);

  const getResultsImportTargetCategoryName = useCallback((status = resultsImportStatus) => {
    const categorySelect = String(status?.categorySelect ?? "").trim();
    if (!categorySelect) return "";
    if (categorySelect === RESULTS_IMPORT_NEW_CATEGORY_OPTION) {
      return String(status?.categoryDraft ?? "").trim();
    }
    return categorySelect;
  }, [RESULTS_IMPORT_NEW_CATEGORY_OPTION, resultsImportStatus]);

  const openResultsImportStatus = useCallback((type) => {
    setResultsImportStatus({
      open: true,
      type,
      loading: false,
      tone: "info",
      title: type === "daily" ? "Import Daily Results CSV" : "Import Model Results CSV",
      message: "Select a category and CSV file to import.",
      categorySelect: "",
      categoryDraft: "",
    });
    if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
  }, []);

  const showResultsImportLoadingStatus = useCallback((type, message) => {
    setResultsImportStatus({
      open: true,
      type,
      loading: true,
      tone: "info",
      title: type === "daily" ? "Importing Daily Results CSV" : "Importing Model Results CSV",
      message,
    });
  }, []);

  const showResultsImportResultStatus = useCallback((type, message, tone = "info", title = "") => {
    setResultsImportStatus({
      open: true,
      type,
      loading: false,
      tone,
      title: title || (type === "daily"
        ? tone === "success"
          ? "Daily Results Import Complete"
          : tone === "error"
            ? "Daily Results Import Failed"
            : "Daily Results Import Status"
        : tone === "success"
          ? "Model Results Import Complete"
          : tone === "error"
            ? "Model Results Import Failed"
            : "Model Results Import Status"),
      message,
    });
  }, []);

  const closeDailyManualEntryModal = useCallback(() => {
    setDailyManualEntryModal((current) => (current?.saving ? current : {
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
  }, []);

  const saveDailyManualEntry = useCallback(async () => {
    const student = sortedStudents.find((item) => item.id === dailyManualEntryModal.studentId) ?? null;
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

    const total = Math.max(0, Number(session?.linkedTest?.question_count ?? 0));
    const correct = total > 0 ? Math.round(rate * total) : 0;
    const payload = {
      student_id: student.id,
      display_name: student.display_name ?? null,
      student_code: student.student_code ?? null,
      test_version: session.problem_set_id,
      test_session_id: session.id,
      correct,
      total,
      score_rate: rate,
      started_at: session.starts_at ?? null,
      ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
      answers_json: buildImportedSummaryAnswersJson("daily_results_csv", {
        imported_test_title: session.title ?? session.problem_set_id ?? "",
        imported_test_date: extractIsoDatePart(session.starts_at || session.created_at) || null,
        imported_entry_mode: "manual",
      }),
      tab_left_count: 0,
    };

    setDailyManualEntryModal((current) => ({ ...current, saving: true, msg: "" }));
    const result = await replaceImportedSummaryAttempts([payload]);
    if (!result.ok) {
      setDailyManualEntryModal((current) => ({
        ...current,
        saving: false,
        msg: result.message || "Failed to save manual result.",
      }));
      return;
    }

    await runSearch("daily");
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
    closeDailyManualEntryModal();
    setQuizMsg(`Saved manual result for ${student.display_name ?? student.id} in ${session.title ?? session.problem_set_id}.`);
  }, [closeDailyManualEntryModal, dailyManualEntryModal, dailyResultsMatrix.sessions, sortedStudents]);

  const clearDailyManualEntry = useCallback(async () => {
    const student = sortedStudents.find((item) => item.id === dailyManualEntryModal.studentId) ?? null;
    const session = dailyResultsMatrix.sessions.find((item) => item.id === dailyManualEntryModal.sessionId) ?? null;
    if (!student || !session) {
      setDailyManualEntryModal((current) => ({ ...current, msg: "Student or test session was not found." }));
      return;
    }
    setDailyManualEntryModal((current) => ({ ...current, saving: true, msg: "" }));
    const result = await removeImportedSummaryAttemptsForPairs([
      { student_id: student.id, test_session_id: session.id },
    ]);
    if (!result.ok) {
      setDailyManualEntryModal((current) => ({
        ...current,
        saving: false,
        msg: result.message || "Failed to clear manual result.",
      }));
      return;
    }
    await runSearch("daily");
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
    closeDailyManualEntryModal();
    setQuizMsg(`Cleared manual result for ${student.display_name ?? student.id} in ${session.title ?? session.problem_set_id}.`);
  }, [closeDailyManualEntryModal, dailyManualEntryModal, dailyResultsMatrix.sessions, sortedStudents]);

  useEffect(() => {
    if (!dailyManualEntryModal.open) return;
    const sessionStillVisible = dailyResultsMatrix.sessions.some((session) => session.id === dailyManualEntryModal.sessionId);
    const studentStillVisible = sortedStudents.some((student) => student.id === dailyManualEntryModal.studentId);
    if (!sessionStillVisible || !studentStillVisible) {
      closeDailyManualEntryModal();
    }
  }, [closeDailyManualEntryModal, dailyManualEntryModal.open, dailyManualEntryModal.sessionId, dailyManualEntryModal.studentId, dailyResultsMatrix.sessions, sortedStudents]);

  const closeResultsImportStatus = useCallback(() => {
    setResultsImportStatus((current) => (current?.loading ? current : null));
    if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
  }, []);

  const studentListRows = useMemo(() => {
    const rows = buildStudentMetricRows(sortedStudents, studentListAttendanceMap, studentListAttempts, testMetaByVersion);

    const maxAttendance =
      studentListFilters.maxAttendance === "" ? null : Number(studentListFilters.maxAttendance);
    const minUnexcused =
      studentListFilters.minUnexcused === "" ? null : Number(studentListFilters.minUnexcused);
    const minModelAvg =
      studentListFilters.minModelAvg === "" ? null : Number(studentListFilters.minModelAvg);
    const minDailyAvg =
      studentListFilters.minDailyAvg === "" ? null : Number(studentListFilters.minDailyAvg);

    return rows.filter((row) => {
      if (maxAttendance != null) {
        const rate = row.attendanceRate ?? 0;
        if (rate > maxAttendance) return false;
      }
      if (minUnexcused != null && row.unexcused < minUnexcused) return false;
      if (minModelAvg != null) {
        const value = row.modelAvg ?? 0;
        if (value < minModelAvg) return false;
      }
      if (minDailyAvg != null) {
        const value = row.dailyAvg ?? 0;
        if (value < minDailyAvg) return false;
      }
      return true;
    });
  }, [
    sortedStudents,
    studentListAttendanceMap,
    studentListAttempts,
    studentListFilters,
    testMetaByVersion
  ]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY);
    setSidebarCollapsed(stored === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!isManagedAuth) return;
    setSession(managedSession ?? null);
    setProfile(managedProfile ?? null);
    setAuthReady(true);
    setProfileLoading(false);
    setLoginMsg("");
  }, [isManagedAuth, managedProfile, managedSession]);

  useEffect(() => {
    if (isManagedAuth) {
      return;
    }
    if (!supabase) return;
    let mounted = true;

    async function bootstrapSession() {
      setAuthReady(false);

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          logAdminRequestFailure("Admin console getSession failed", error, {
            forceLoginOnEntry,
          });
        }

        if (forceLoginOnEntry) {
          if (data?.session) {
            const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
            if (signOutError) {
              logAdminRequestFailure("Admin console forced signout failed", signOutError, {
                forceLoginOnEntry,
              });
            }
          }
          syncAdminAuthCookie(null);
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoginMsg("");
          }
          return;
        }

        syncAdminAuthCookie(data?.session ?? null);
        if (mounted) {
          setSession(data?.session ?? null);
        }
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("Admin console session bootstrap aborted", error, {
            forceLoginOnEntry,
          });
          setLoginMsg("Session restore was interrupted. Please try again.");
          return;
        }
        logAdminRequestFailure("Admin console session bootstrap failed", error, {
          forceLoginOnEntry,
        });
        setLoginMsg(error instanceof Error ? error.message : "Failed to restore admin session.");
      } finally {
        if (mounted) {
          setAuthReady(true);
        }
      }
    }

    bootstrapSession();

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logAdminEvent("Admin console auth event", {
        event,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id ?? null,
        forceLoginOnEntry,
      });
      syncAdminAuthCookie(nextSession ?? null);
      if (!mounted || event === "INITIAL_SESSION") {
        return;
      }
      if (loginValidationInFlightRef.current && nextSession) {
        return;
      }
      setSession(nextSession ?? null);
      setAuthReady(true);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [forceLoginOnEntry, isManagedAuth, supabase]);

  useEffect(() => {
    if (isManagedAuth) {
      return;
    }

    let cancelled = false;
    const profileAbortController = new AbortController();

    if (supabaseConfigError) {
      setSession(null);
      setProfile(null);
      setAuthReady(true);
      setProfileLoading(false);
      setLoginMsg(supabaseConfigError);
      return () => {
        cancelled = true;
        profileAbortController.abort();
      };
    }
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      setLoginMsg("");
      setAttempts([]);
      setSelectedId(null);
      setSelectedAttemptObj(null);
      setSelectedStudentId("");
      setStudentAttempts([]);
      setStudentAttemptsMsg("");
      return () => {
        cancelled = true;
        profileAbortController.abort();
      };
    }
    if (!supabase) {
      return () => {
        cancelled = true;
        profileAbortController.abort();
      };
    }
    if (profile?.id === session.user.id) {
      setProfileLoading(false);
      setLoginMsg("");
      return () => {
        cancelled = true;
        profileAbortController.abort();
      };
    }

    async function loadProfile() {
      setProfileLoading(true);
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, role, display_name, school_id, account_status, force_password_change")
          .eq("id", session.user.id)
          .maybeSingle()
          .abortSignal(profileAbortController.signal);

        if (cancelled) return;
        if (error) {
          logAdminRequestFailure("Admin console profile lookup failed", error, {
            userId: session.user.id,
          });
          setProfile(null);
          setLoginMsg(normalizeAdminLoginErrorMessage(error.message));
          return;
        }
        if (!data) {
          logAdminEvent("Admin console profile missing", {
            userId: session.user.id,
          });
          await supabase.auth.signOut({ scope: "local" });
          syncAdminAuthCookie(null);
          setSession(null);
          setProfile(null);
          setLoginMsg("Invalid login credentials");
          return;
        }
        if (!isAllowedAdminProfile(data)) {
          logAdminEvent("Admin console login rejected for non-admin profile", {
            userId: session.user.id,
            role: data.role ?? null,
            accountStatus: data.account_status ?? null,
          });
          await supabase.auth.signOut({ scope: "local" });
          syncAdminAuthCookie(null);
          setSession(null);
          setProfile(null);
          setLoginMsg("Invalid login credentials");
          return;
        }
        setLoginMsg("");
        setProfile(data);
      } catch (error) {
        if (cancelled) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("Admin console profile lookup aborted", error, {
            userId: session.user.id,
          });
          setProfile(null);
          setLoginMsg("Profile loading was interrupted. Please try again.");
          return;
        }
        logAdminRequestFailure("Admin console profile lookup threw", error, {
          userId: session.user.id,
        });
        setProfile(null);
        setLoginMsg(error instanceof Error ? error.message : "Failed to load admin profile.");
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      cancelled = true;
      profileAbortController.abort();
    };
  }, [isManagedAuth, session, supabase, supabaseConfigError]);

  useEffect(() => {
    if (!supabase) return;
    if (!session || !profile || profile.role !== "admin") {
      setSchoolAssignments([]);
      if (!forcedSchoolId) setSchoolScopeId(null);
      return;
    }

    let mounted = true;

    async function loadSchoolAssignments() {
      const normalizeSchoolAssignments = (rows) => (
        Array.isArray(rows)
          ? rows
              .filter((row) => row?.school_id)
              .map((row) => ({
                school_id: row.school_id,
                school_name: row.school_name ?? row.school_id,
                school_status: row.school_status ?? null,
                is_primary: Boolean(row.is_primary),
              }))
          : []
      );

      const { data: rpcSchoolOptionsData, error: rpcSchoolOptionsError } = await supabase.rpc(
        "get_admin_school_options",
      );

      const rpcAssignments = normalizeSchoolAssignments(rpcSchoolOptionsData);
      if (!rpcSchoolOptionsError && rpcAssignments.length > 0) {
        if (!mounted) return;
        setSchoolAssignments(rpcAssignments);

        if (!forcedSchoolId) {
          const storedScope =
            typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY) : null;
          const validStoredScope = rpcAssignments.some((assignment) => assignment.school_id === storedScope);
          const nextScopeId = validStoredScope
            ? storedScope
            : profile.school_id ?? rpcAssignments[0]?.school_id ?? null;
          setSchoolScopeId(nextScopeId);
        }
        return;
      }

      const { data: schoolOptionsData, error: schoolOptionsError } = await supabase.functions.invoke(
        "get-admin-school-options",
        {
          body: {},
        },
      );

      const functionAssignments = normalizeSchoolAssignments(schoolOptionsData?.schools);

      if (!schoolOptionsError && functionAssignments.length > 0) {
        if (!mounted) return;
        setSchoolAssignments(functionAssignments);

        if (!forcedSchoolId) {
          const storedScope =
            typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY) : null;
          const validStoredScope = functionAssignments.some((assignment) => assignment.school_id === storedScope);
          const nextScopeId = validStoredScope
            ? storedScope
            : profile.school_id ?? functionAssignments[0]?.school_id ?? null;
          setSchoolScopeId(nextScopeId);
        }
        return;
      }

      const { data: assignments, error: assignmentsError } = await supabase
        .from("admin_school_assignments")
        .select("school_id, is_primary")
        .eq("admin_user_id", session.user.id)
        .order("is_primary", { ascending: false });

      if (assignmentsError) {
        console.error("admin school assignments error:", assignmentsError);
        if (rpcSchoolOptionsError) {
          console.error("get_admin_school_options rpc error:", rpcSchoolOptionsError);
        }
        if (schoolOptionsError) {
          console.error("get-admin-school-options error:", schoolOptionsError);
        }
        if (mounted) {
          setSchoolAssignments(
            profile.school_id
              ? [{ school_id: profile.school_id, school_name: "Current School", is_primary: true }]
              : []
          );
          if (!forcedSchoolId) setSchoolScopeId(profile.school_id ?? null);
        }
        return;
      }

      const schoolIds = Array.from(
        new Set([profile.school_id, ...(assignments ?? []).map((row) => row.school_id)].filter(Boolean))
      );
      if (!mounted) return;
      const schoolRows = await Promise.all(
        schoolIds.map(async (id) => {
          const schoolClient = createAdminSupabaseClient({ schoolScopeId: id });
          const { data: schoolData, error: schoolError } = await schoolClient
            .from("schools")
            .select("id, name, status")
            .eq("id", id)
            .maybeSingle();
          if (schoolError) {
            console.error("admin school lookup error:", id, schoolError);
          }
          return schoolData ?? null;
        })
      );

      if (!mounted) return;
      const schoolMap = Object.fromEntries(
        schoolRows.filter(Boolean).map((row) => [row.id, row])
      );
      const normalizedAssignments = schoolIds.map((id) => ({
        school_id: id,
        school_name: schoolMap[id]?.name ?? id,
        school_status: schoolMap[id]?.status ?? null,
        is_primary: id === profile.school_id || (assignments ?? []).some((row) => row.school_id === id && row.is_primary),
      }));
      setSchoolAssignments(normalizedAssignments);

      if (forcedSchoolId) return;

      const storedScope =
        typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY) : null;
      const validStoredScope = normalizedAssignments.some((assignment) => assignment.school_id === storedScope);
      const nextScopeId = validStoredScope
        ? storedScope
        : profile.school_id ?? normalizedAssignments[0]?.school_id ?? null;
      setSchoolScopeId(nextScopeId);
    }

    loadSchoolAssignments();
    return () => {
      mounted = false;
    };
  }, [forcedSchoolId, profile, session, supabase]);

  useEffect(() => {
    if (forcedSchoolId || !profile || profile.role !== "admin" || !schoolScopeId || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY, schoolScopeId);
  }, [forcedSchoolId, profile, schoolScopeId]);

  useEffect(() => {
    activeSchoolIdRef.current = activeSchoolId;
  }, [activeSchoolId]);

  useEffect(() => {
    if (!isManagedAuth || !session || !profile || !activeSchoolId) return;
    logAdminEvent("Admin console managed auth ready", {
      role: profile.role,
      activeSchoolId,
      forcedSchoolId,
      schoolScopeId,
    });
  }, [activeSchoolId, forcedSchoolId, isManagedAuth, profile, schoolScopeId, session]);

  useEffect(() => {
    if (!session || !canUseAdminConsole || activeTab !== "students") return;
    logAdminEvent("Admin console student tab bootstrap", {
      role: profile?.role ?? null,
      activeSchoolId,
      forcedSchoolId,
      schoolScopeId,
      isManagedAuth,
    });
  }, [
    activeSchoolId,
    activeTab,
    canUseAdminConsole,
    forcedSchoolId,
    isManagedAuth,
    profile?.role,
    schoolScopeId,
    session,
  ]);

  useEffect(() => {
    if (selectedStudentId) return;
    setSelectedStudentDetail(null);
    setStudentDetailLoading(false);
    setStudentDetailMsg("");
  }, [selectedStudentId]);

  useEffect(() => {
    if (!session || !canUseAdminConsole) return;
    if (activeTab === "students") {
      fetchStudents();
      return;
    }

    if (activeTab === "attendance") {
      if (attendanceSubTab === "sheet") {
        fetchStudents();
      }
      return;
    }

    if (activeTab === "dailyRecord" || activeTab === "ranking") {
      fetchStudents();
      fetchTests();
      return;
    }

    if (activeTab === "model" || activeTab === "daily") {
      fetchTests();
      fetchTestSessions();
      fetchExamLinks();
      const isUploadTab =
        (activeTab === "model" && modelSubTab === "upload")
        || (activeTab === "daily" && dailySubTab === "upload");
      if (isUploadTab) {
        fetchAssets();
      }
    }
  }, [activeSchoolId, session, canUseAdminConsole, activeTab, attendanceSubTab, modelSubTab, dailySubTab]);

  useEffect(() => {
    if (activeTab !== "students") return;
    setStudentListMetricsLoaded(false);
    setStudentListAttendanceMap({});
    setStudentListAttempts([]);
  }, [activeSchoolId, activeTab, studentListFilters.from, studentListFilters.to]);

  useEffect(() => {
    if (activeTab !== "students") return;
    setStudentWarningsLoaded(false);
    setStudentWarnings([]);
    setStudentWarningsLoaded(false);
    setStudentWarningsMsg("");
    setSelectedStudentWarning(null);
    setStudentWarningPreviewStudentId("");
  }, [activeSchoolId, activeTab]);

  useEffect(() => {
    if (activeTab !== "dailyRecord") return;
    fetchDailyRecords();
    if (!students.length) fetchStudents();
  }, [activeSchoolId, activeTab]);

  useEffect(() => {
    if (activeTab !== "ranking") return;
    fetchRankingPeriods();
    if (!students.length) fetchStudents();
  }, [activeSchoolId, activeTab]);

  useEffect(() => {
    if (!session || !canUseAdminConsole) return;
    if (activeTab === "daily" && dailySubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("daily");
    }
    if (activeTab === "model" && modelSubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("mock");
    }
  }, [activeSchoolId, session, canUseAdminConsole, activeTab, modelSubTab, dailySubTab, tests]);

  useEffect(() => {
    if (
      !(
        (activeTab === "daily" && dailySubTab === "results") ||
        (activeTab === "model" && modelSubTab === "results")
      )
    ) {
      return;
    }
    setFilters((s) => {
      if (!s.code && !s.name && !s.from && !s.to && !s.testVersion) return s;
      return {
        ...s,
        code: "",
        name: "",
        from: "",
        to: "",
        testVersion: ""
      };
    });
  }, [activeTab, dailySubTab, modelSubTab]);

  useEffect(() => {
    if (!session || !profile) return;
    if (
      !forcedSchoolId &&
      profile.role === "super_admin" &&
      profile.account_status === "active" &&
      !profile.force_password_change
    ) {
      router.replace("/super/schools");
    }
  }, [forcedSchoolId, profile, router, session]);

  useEffect(() => {
    setAttempts([]);
    setExamLinks([]);
    setStudents([]);
    setTests([]);
    setTestSessions([]);
    setAssets([]);
    setSelectedId(null);
    setSelectedAttemptObj(null);
    setSelectedStudentId("");
    setSelectedStudentDetail(null);
    setStudentAttempts([]);
    setStudentAttendance([]);
    setStudentDetailLoading(false);
    setStudentDetailMsg("");
    setAbsenceApplications([]);
    setAnnouncements([]);
    setAnnouncementCreateOpen(false);
    setAnnouncementMsg("");
    setEditingAnnouncementId("");
    setEditingAnnouncementForm({
      title: "",
      body: "",
      publish_at: "",
      end_at: ""
    });
    setStudentWarnings([]);
    setStudentWarningsMsg("");
    setSelectedStudentWarning(null);
    setAttendanceDays([]);
    setAttendanceEntries({});
    setAttendanceMsg("");
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    setAttendanceSaving(false);
    setAttendanceFilter({ minRate: "", minAbsences: "", startDate: "", endDate: "" });
    setApprovedAbsenceByStudent({});
    setDailyRecordAnnouncementTitleDraft("");
    setDailyRecordAnnouncementDraft("");
    setDailyRecordSyllabusAnnouncements([]);
    setDailyRecordConfirmedDates([]);
  }, [activeSchoolId]);

  useEffect(() => {
    if (!selectedSessionDetail?.id) return;
    fetchSessionDetail(selectedSessionDetail);
  }, [selectedSessionDetail?.id, selectedSessionDetail?.problem_set_id]);

  useEffect(() => {
    if (sessionDetail.type === "mock" && !(activeTab === "model" && ["conduct", "results"].includes(modelSubTab))) {
      closeSessionDetail();
      return;
    }
    if (sessionDetail.type === "daily" && !(activeTab === "daily" && ["conduct", "results"].includes(dailySubTab))) {
      closeSessionDetail();
    }
  }, [activeTab, modelSubTab, dailySubTab, sessionDetail.type]);

  useEffect(() => {
    const version = selectedAttempt?.test_version;
    if (!attemptDetailOpen || !version) return;
    if (attemptQuestionsByVersion[version]) return;
    let mounted = true;
    setAttemptQuestionsLoading(true);
    setAttemptQuestionsError("");
    fetchQuestionsForVersionWithFallback(supabase, version).then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("attempt questions fetch error:", error);
          setAttemptQuestionsError(error.message);
          setAttemptQuestionsLoading(false);
          return;
        }
        const list = (data ?? []).map(mapDbQuestion);
        setAttemptQuestionsByVersion((prev) => ({ ...prev, [version]: list }));
        setAttemptQuestionsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [attemptDetailOpen, selectedAttempt, attemptQuestionsByVersion]);

  useEffect(() => {
    if (!attemptDetailOpen) return;
    setAttemptDetailTab("overview");
    setAttemptDetailWrongOnly(false);
    attemptDetailSectionRefs.current = {};
  }, [attemptDetailOpen, selectedAttempt?.id]);

  useEffect(() => {
    if (!attemptDetailOpen || !selectedAttempt?.id || !selectedAttempt?.test_session_id) return;
    if (studentAttemptRanks[selectedAttempt.id]) return;
    fetchAttemptRanksForSessions([selectedAttempt]);
  }, [attemptDetailOpen, selectedAttempt, studentAttemptRanks]);

  async function runSearch(testType = "") {
    setLoading(true);
    setMsg("Loading...");
    const { code, name, from, to, limit, testVersion } = filters;
    const isResultsMatrixSearch =
      (testType === "daily" && activeTab === "daily" && dailySubTab === "results")
      || (testType === "mock" && activeTab === "model" && modelSubTab === "results");
    const effectiveLimit = isResultsMatrixSearch ? Math.max(Number(limit || 200), 5000) : Number(limit || 200);

    let allowedVersions = [];
    if (testType) {
      allowedVersions = tests.filter((t) => t.type === testType).map((t) => t.version);
      if (testVersion && allowedVersions.length && !allowedVersions.includes(testVersion)) {
        setFilters((s) => ({ ...s, testVersion: "" }));
      }
      if (!allowedVersions.length) {
        setAttempts([]);
        setSelectedId(null);
        setMsg("No tests.");
        setLoading(false);
        return;
      }
    }

    const buildAttemptsQuery = (fields) => {
      let query = supabase
        .from("attempts")
        .select(fields)
        .order("created_at", { ascending: false })
        .limit(effectiveLimit);
      if (testType) query = query.in("test_version", allowedVersions);
      if (code) query = query.ilike("student_code", `%${code}%`);
      if (name) query = query.ilike("display_name", `%${name}%`);
      if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
      if (testVersion && (!testType || allowedVersions.includes(testVersion))) {
        query = query.eq("test_version", testVersion);
      }
      return query;
    };

    let { data, error } = await buildAttemptsQuery(
      "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json, tab_left_count"
    );
    if (error && isMissingTabLeftCountError(error)) {
      ({ data, error } = await buildAttemptsQuery(
        "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
      ));
    }
    if (error) {
      console.error("attempts fetch error:", error);
      setAttempts([]);
      setMsg(`Load failed: ${error.message}`);
      setLoading(false);
      return;
    }
    setAttempts(data ?? []);
    setSelectedId(null);
    setMsg(data?.length ? "" : "No results.");
    setLoading(false);
  }

  async function clearDailyResultsForCategory(category) {
    const categoryName = String(category?.name ?? "").trim();
    if (!categoryName) {
      setQuizMsg("Select a daily results category first.");
      return;
    }
    const testVersions = (category?.tests ?? []).map((test) => test?.version).filter(Boolean);
    const sessionIds = (dailySessions ?? [])
      .filter((session) => testVersions.includes(session.problem_set_id))
      .map((session) => session.id)
      .filter(Boolean);
    if (!sessionIds.length) {
      setQuizMsg(`No daily result sessions found in ${categoryName}.`);
      return;
    }

    const { count: attemptCount, error: countError } = await supabase
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .in("test_session_id", sessionIds);
    if (countError) {
      console.error("clear daily results count error:", countError);
      setQuizMsg(`Clear failed: ${countError.message}`);
      return;
    }

    if (!attemptCount) {
      setQuizMsg(`No daily results found in ${categoryName}.`);
      return;
    }

    const confirmed = window.confirm(
      `Clear all daily test results in "${categoryName}"?\n\nThis will delete ${attemptCount} result record${attemptCount === 1 ? "" : "s"} from the current category.`
    );
    if (!confirmed) return;

    setQuizMsg("Clearing daily results...");
    for (let index = 0; index < sessionIds.length; index += 100) {
      const deleteSessionIds = sessionIds.slice(index, index + 100);
      const { error } = await supabase.from("attempts").delete().in("test_session_id", deleteSessionIds);
      if (error) {
        console.error("clear daily results error:", error);
        setQuizMsg(`Clear failed: ${error.message}`);
        return;
      }
    }

    if (sessionDetail.type === "daily" && sessionDetail.sessionId && sessionIds.includes(sessionDetail.sessionId)) {
      closeSessionDetail();
    }
    await runSearch("daily");
    await recordAuditEvent({
      actionType: "delete",
      entityType: "daily_results",
      entityId: `daily-results:${categoryName}:${Date.now()}`,
      summary: `Cleared daily results in ${categoryName} (${attemptCount} records).`,
      metadata: {
        category: categoryName,
        deleted_result_count: attemptCount,
        session_count: sessionIds.length,
      },
    });
    setQuizMsg(`Cleared ${attemptCount} daily result record${attemptCount === 1 ? "" : "s"} from ${categoryName}.`);
  }

  function applyTestFilter(version, testType = "") {
    setFilters((s) => ({ ...s, testVersion: version || "" }));
    setSelectedId(null);
    setTimeout(() => runSearch(testType), 0);
  }

  function openAttemptDetail(attempt, source = "default") {
    if (!attempt?.id) return;
    if (!attemptCanOpenDetail(attempt)) return;
    setSelectedId(attempt.id);
    setSelectedAttemptObj(attempt);
    setAttemptDetailSource(source);
    setAttemptDetailOpen(true);
  }

  function closeSessionDetail() {
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
  }

  function openSessionDetailView(session, type) {
    if (!session?.id) return;
    setEditingSessionId("");
    setEditingSessionMsg("");
    setSessionDetail({ type, sessionId: session.id });
    setSessionDetailTab("analysis");
    setSessionDetailAllowStudentId("");
    setSessionDetailAllowMsg("");
    setSessionDetailShowAllAnalysis(false);
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }

  function closeSessionDetailAnalysisPopup() {
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }

  function openSessionDetailAnalysisPopupFor(kind, value) {
    const label = String(value ?? "").trim();
    if (!label) return;
    const filteredQuestions = (sessionDetailQuestions ?? []).filter((question) => {
      const mainSection = getSectionTitle(question?.sectionKey) || question?.sectionKey || "Unknown";
      const subSection = getQuestionSectionLabel(question) || question?.sectionKey || "Unknown";
      if (kind === "section") return mainSection === label;
      if (kind === "subSection") return subSection === label;
      return false;
    });
    setSessionDetailAnalysisPopup({
      open: true,
      title: `${label} Questions`,
      questions: filteredQuestions,
    });
  }

  function handleSessionDetailAnalysisRowKeyDown(event, kind, value) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSessionDetailAnalysisPopupFor(kind, value);
  }

  async function fetchSessionDetail(session) {
    if (!session?.id || !session?.problem_set_id) return;
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

    const questionsList = (questionsData ?? []).map(mapDbQuestion);
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
  }

  async function allowSessionAnotherAttempt() {
    if (!selectedSessionDetail?.id || !sessionDetailAllowStudentId) return;
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
  }

  function startEditTest(test, categoryOptions) {
    if (!test?.id) return;
    const normalizedTitle = String(test.title ?? "").trim() || "Uncategorized";
    const hasCategory = (categoryOptions ?? []).some((c) => c.name === normalizedTitle);
    setEditingTestId(test.id);
    setEditingTestMsg("");
    setEditingCategorySelect(hasCategory ? normalizedTitle : "__custom__");
    setEditingTestForm({
      id: test.id,
      originalVersion: test.version ?? "",
      version: test.version ?? "",
      title: normalizedTitle,
      pass_rate: test.pass_rate != null ? String(test.pass_rate) : "",
      is_public: Boolean(test.is_public),
      type: test.type ?? ""
    });
  }

  function cancelEditTest() {
    setEditingTestId("");
    setEditingTestMsg("");
    setEditingCategorySelect("__custom__");
  }

  async function updateVersionInTable(table, column, oldVersion, newVersion) {
    const { error } = await supabase
      .from(table)
      .update({ [column]: newVersion })
      .eq(column, oldVersion);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async function saveTestEdits(categoryOptions) {
    if (!editingTestForm.id) return;
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
    const nextTitleRaw = editingCategorySelect === "__custom__"
      ? editingTestForm.title
      : editingCategorySelect;
    const nextTitle = String(nextTitleRaw ?? "").trim() || "Uncategorized";

    if (nextVersion !== editingTestForm.originalVersion) {
      const { data: exists, error: existsErr } = await supabase
        .from("tests")
        .select("id")
        .eq("version", nextVersion)
        .limit(1);
      if (existsErr) {
        setEditingTestMsg(`Check failed: ${existsErr.message}`);
        return;
      }
      if (exists?.length && exists[0].id !== editingTestForm.id) {
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

    const { error: updateErr } = await supabase.from("tests").update(updatePayload).eq("id", editingTestForm.id);
    if (updateErr) {
      setEditingTestMsg(`Save failed: ${updateErr.message}`);
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
  }

  async function fetchExamLinks() {
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
      return;
    }
    setExamLinks(data ?? []);
    setLinkMsg(data?.length ? "" : "No links.");
  }

  function getStudentBaseUrl() {
    return process.env.NEXT_PUBLIC_STUDENT_BASE_URL || "";
  }

  function mergeStudentIntoState(studentRecord) {
    if (!studentRecord?.id) return;
    setStudents((prev) => prev.map((student) => (
      student.id === studentRecord.id ? { ...student, ...studentRecord } : student
    )));
    setSelectedStudentDetail((prev) => {
      if (prev?.id !== studentRecord.id && selectedStudentId !== studentRecord.id) return prev;
      return { ...(prev?.id === studentRecord.id ? prev : {}), ...studentRecord };
    });
  }

  async function fetchStudentDetail(studentId, options = {}) {
    if (!studentId || !activeSchoolId) return null;
    const { silent = false, force = false } = options;
    if (!force) {
      const existingDetail = selectedStudentDetail?.id === studentId
        ? selectedStudentDetail
        : students.find((student) => student.id === studentId);
      if (hasStudentDetailFields(existingDetail)) {
        if (selectedStudentDetail?.id !== studentId) {
          setSelectedStudentDetail(existingDetail);
        }
        return existingDetail;
      }
    }

    if (!silent) {
      setStudentDetailLoading(true);
      setStudentDetailMsg("");
    }
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(STUDENT_DETAIL_SELECT_FIELDS)
        .eq("id", studentId)
        .eq("role", "student")
        .eq("school_id", activeSchoolId)
        .single();
      if (error) {
        console.error("student detail fetch error:", error);
        if (!silent) {
          setStudentDetailMsg(`Student details failed to load: ${error.message}`);
        }
        return null;
      }
      mergeStudentIntoState(data);
      if (!silent) {
        setStudentDetailMsg("");
      }
      return data;
    } finally {
      if (!silent) {
        setStudentDetailLoading(false);
      }
    }
  }

  async function openStudentDetail(studentId) {
    if (!studentId) return;
    setSelectedStudentId(studentId);
    setSelectedStudentTab("information");
    setStudentAttendance([]);
    setStudentAttendanceMsg("");
    setStudentAttendanceRange({ from: "", to: "" });
    setStudentDetailOpen(true);
    if (selectedStudentDetail?.id !== studentId) {
      setSelectedStudentDetail(null);
    }
    await fetchStudentDetail(studentId);
  }

  async function copyLink(id) {
    const base = getStudentBaseUrl();
    const url = base ? `${base}/test?link=${id}` : `/test?link=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMsg("Copied.");
    } catch (e) {
      console.warn("clipboard error:", e);
      setLinkMsg(url);
    }
  }

  async function fetchStudents() {
    const finishTrace = createAdminTrace("Admin console fetchStudents", {
      activeSchoolId,
      role: profile?.role ?? null,
      isManagedAuth,
      forcedSchoolId,
      schoolScopeId,
    });
    if (!activeSchoolId) {
      finishTrace("skipped", {
        reason: "missing-active-school-id",
      });
      setStudents([]);
      setStudentMsg("Select a school.");
      setSelectedStudentId("");
      setSelectedStudentDetail(null);
      setStudentAttempts([]);
      setStudentAttendance([]);
      setStudentAttemptsMsg("");
      setStudentAttendanceMsg("");
      return;
    }
    setStudentMsg("Loading...");
    let query = supabase
      .from("profiles")
      .select(STUDENT_LIST_SELECT_FIELDS)
      .eq("role", "student")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false })
      .limit(500);
    const { data, error } = await query;
    if (error) {
      finishTrace("failed", {
        message: error.message || "",
        code: error.code || "",
        status: error.status ?? null,
      });
      console.error("profiles fetch error:", error);
      setStudents([]);
      setStudentMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    finishTrace("success", {
      count: list.length,
      firstStudentId: list[0]?.id ?? null,
    });
    setStudents(list);
    setStudentMsg(list.length ? "" : "No students.");
    if (!list.length) {
      setSelectedStudentId("");
      setSelectedStudentDetail(null);
      setStudentAttempts([]);
      setStudentAttendance([]);
      setStudentAttemptsMsg("");
      setStudentAttendanceMsg("");
      return;
    }
    const exists = selectedStudentId && list.some((s) => s.id === selectedStudentId);
    if (!exists) {
      setSelectedStudentDetail(null);
    }
    if (!exists) {
      const first = list[0];
      setSelectedStudentId(first.id);
      setSelectedStudentTab("information");
      setStudentAttendanceRange({ from: "", to: "" });
    }
  }

  async function fetchStudentListMetrics() {
    if (!activeSchoolId) {
      setStudentListAttendanceMap({});
      setStudentListAttempts([]);
      setStudentListMetricsLoaded(false);
      setStudentListLoading(false);
      return;
    }
    setStudentListLoading(true);
    const { from, to } = studentListFilters;
    let daysQuery = supabase
      .from("attendance_days")
      .select("id, day_date")
      .eq("school_id", activeSchoolId);
    if (from) daysQuery = daysQuery.gte("day_date", from);
    if (to) daysQuery = daysQuery.lte("day_date", to);
    const { data: daysData, error: daysError } = await daysQuery;
    if (daysError) {
      console.error("student list attendance days error:", daysError);
      setStudentListAttendanceMap({});
    } else {
      const dayIds = (daysData ?? []).map((d) => d.id);
      if (!dayIds.length) {
        setStudentListAttendanceMap({});
      } else {
        const { data: entriesData, error: entriesError } = await supabase
          .from("attendance_entries")
          .select("day_id, student_id, status")
          .in("day_id", dayIds);
        if (entriesError) {
          console.error("student list attendance entries error:", entriesError);
          setStudentListAttendanceMap({});
        } else {
          const map = {};
          (entriesData ?? []).forEach((row) => {
            if (!row?.student_id) return;
            const stats = map[row.student_id] || { total: 0, present: 0, unexcused: 0 };
            if (row.status) stats.total += 1;
            if (row.status === "P" || row.status === "L") stats.present += 1;
            if (row.status === "A") stats.unexcused += 1;
            map[row.student_id] = stats;
          });
          Object.keys(map).forEach((id) => {
            const stats = map[id];
            stats.rate = stats.total ? (stats.present / stats.total) * 100 : null;
          });
          setStudentListAttendanceMap(map);
        }
      }
    }

    const buildStudentListAttemptsQuery = (fields) => {
      let attemptsQuery = supabase
        .from("attempts")
        .select(fields)
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (from) attemptsQuery = attemptsQuery.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) attemptsQuery = attemptsQuery.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
      return attemptsQuery;
    };
    let { data: attemptsData, error: attemptsError } = await buildStudentListAttemptsQuery(
      "id, student_id, test_version, correct, total, score_rate, created_at, ended_at, tab_left_count"
    );
    if (attemptsError && isMissingTabLeftCountError(attemptsError)) {
      ({ data: attemptsData, error: attemptsError } = await buildStudentListAttemptsQuery(
        "id, student_id, test_version, correct, total, score_rate, created_at, ended_at"
      ));
    }
    if (attemptsError) {
      console.error("student list attempts error:", attemptsError);
      setStudentListAttempts([]);
    } else {
      setStudentListAttempts(attemptsData ?? []);
    }
    setStudentListMetricsLoaded(true);
    setStudentListLoading(false);
  }

  async function fetchStudentWarnings() {
    if (!activeSchoolId) {
      setStudentWarnings([]);
      setStudentWarningsLoading(false);
      setStudentWarningsMsg("");
      return;
    }
    setStudentWarningsLoading(true);
    setStudentWarningsMsg("");
    const { data: warningRows, error: warningError } = await supabase
      .from("student_warnings")
      .select("id, school_id, title, criteria, student_count, created_by, created_at")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (warningError) {
      if (!isMissingStudentWarningsTableError(warningError)) {
        console.error("student warnings fetch error:", warningError);
        setStudentWarningsMsg(`Warnings load failed: ${warningError.message}`);
      }
      setStudentWarnings([]);
      setStudentWarningsLoading(false);
      return;
    }
    const warningsList = warningRows ?? [];
    if (!warningsList.length) {
      setStudentWarnings([]);
      setStudentWarningsLoaded(true);
      setStudentWarningsLoading(false);
      return;
    }
    const warningIds = warningsList.map((warning) => warning.id);
    const { data: recipientRows, error: recipientError } = await supabase
      .from("student_warning_recipients")
      .select("id, warning_id, student_id, issues, created_at")
      .in("warning_id", warningIds);
    if (recipientError) {
      if (!isMissingStudentWarningsTableError(recipientError)) {
        console.error("student warning recipients fetch error:", recipientError);
        setStudentWarningsMsg(`Warnings load failed: ${recipientError.message}`);
      }
      setStudentWarnings([]);
      setStudentWarningsLoading(false);
      return;
    }
    try {
      const recipientsByWarning = new Map();
      (recipientRows ?? []).forEach((recipient) => {
        const list = recipientsByWarning.get(recipient.warning_id) || [];
        list.push({
          ...recipient,
          issues: normalizeWarningIssueList(recipient.issues),
        });
        recipientsByWarning.set(recipient.warning_id, list);
      });

      // Treat warnings as stored records on read. Recomputing recipients for every
      // warning during startup creates a heavy client-side load and can also turn a
      // page view into a write storm against Supabase.
      const storedWarnings = warningsList.map((warning) => {
        const recipients = recipientsByWarning.get(warning.id) || [];
        return {
          ...warning,
          criteria: normalizeStudentWarningCriteria(
            warning.criteria && typeof warning.criteria === "object" ? warning.criteria : {}
          ),
          student_count: Number(warning.student_count ?? recipients.length ?? 0),
          recipients,
        };
      });

      setStudentWarnings(storedWarnings);
      setStudentWarningsLoaded(true);
      setStudentWarningsLoading(false);
    } catch (error) {
      console.error("student warnings hydrate error:", error);
      setStudentWarnings([]);
      setStudentWarningsLoading(false);
      setStudentWarningsMsg(`Warnings load failed: ${error.message || error}`);
    }
  }

  async function handleLoadStudentMetrics() {
    if (studentListLoading) return;
    if (!tests.length) {
      setStudentListLoading(true);
      try {
        await fetchTests();
      } finally {
        setStudentListLoading(false);
      }
    }
    await fetchStudentListMetrics();
  }

  async function handleLoadStudentWarnings() {
    await fetchStudentWarnings();
  }

  function openStudentWarningsModal() {
    setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters));
    setStudentWarningIssueMsg("");
    setStudentWarningIssueOpen(true);
    if (!studentWarningsLoaded && !studentWarningsLoading) {
      void fetchStudentWarnings();
    }
  }

  async function loadStudentWarningMetrics(criteria) {
    const { from, to } = criteria;
    let daysQuery = supabase
      .from("attendance_days")
      .select("id, day_date")
      .eq("school_id", activeSchoolId);
    if (from) daysQuery = daysQuery.gte("day_date", from);
    if (to) daysQuery = daysQuery.lte("day_date", to);
    const { data: daysData, error: daysError } = await daysQuery;
    if (daysError) throw daysError;

    let attendanceMap = {};
    const dayIds = (daysData ?? []).map((day) => day.id);
    if (dayIds.length) {
      const { data: entriesData, error: entriesError } = await supabase
        .from("attendance_entries")
        .select("day_id, student_id, status")
        .in("day_id", dayIds);
      if (entriesError) throw entriesError;
      attendanceMap = {};
      (entriesData ?? []).forEach((row) => {
        if (!row?.student_id) return;
        const stats = attendanceMap[row.student_id] || { total: 0, present: 0, unexcused: 0 };
        if (row.status) stats.total += 1;
        if (row.status === "P" || row.status === "L") stats.present += 1;
        if (row.status === "A") stats.unexcused += 1;
        attendanceMap[row.student_id] = stats;
      });
      Object.keys(attendanceMap).forEach((id) => {
        const stats = attendanceMap[id];
        stats.rate = stats.total ? (stats.present / stats.total) * 100 : null;
      });
    }

    const buildAttemptsQuery = (fields) => {
      let query = supabase
        .from("attempts")
        .select(fields)
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
      return query;
    };
    let { data: attemptsData, error: attemptsError } = await buildAttemptsQuery(
      "id, student_id, test_version, correct, total, score_rate, created_at, ended_at, tab_left_count"
    );
    if (attemptsError && isMissingTabLeftCountError(attemptsError)) {
      ({ data: attemptsData, error: attemptsError } = await buildAttemptsQuery(
        "id, student_id, test_version, correct, total, score_rate, created_at, ended_at"
      ));
    }
    if (attemptsError) throw attemptsError;

    return buildStudentMetricRows(sortedStudents, attendanceMap, attemptsData ?? [], testMetaByVersion);
  }

  async function issueStudentWarning() {
    if (!activeSchoolId) {
      setStudentWarningIssueMsg("Select a school.");
      return;
    }
    setStudentWarningIssueSaving(true);
    setStudentWarningIssueMsg("");
    try {
      const criteria = normalizeStudentWarningCriteria(studentWarningForm);
      const rows = await loadStudentWarningMetrics(criteria);
      const matched = rows
        .filter((row) => !isAnalyticsExcludedStudent(row.student))
        .map((row) => ({ row, issues: getStudentWarningIssues(row, criteria) }))
        .filter((item) => item.issues.length > 0);
      if (!matched.length) {
        setStudentWarningIssueMsg("No students matched the selected warning criteria.");
        setStudentWarningIssueSaving(false);
        return;
      }
      const criteriaSummary = summarizeWarningCriteria(criteria);
      const title =
        criteria.title ||
        (criteriaSummary.length
          ? `Warning: ${criteriaSummary[0]}`
          : `Warning issued on ${new Date().toLocaleDateString()}`);
      const { data: warningRow, error: warningError } = await supabase
        .from("student_warnings")
        .insert({
          school_id: activeSchoolId,
          title,
          criteria: {
            ...criteria,
            title: undefined,
            summary: criteriaSummary,
          },
          student_count: matched.length,
          created_by: session?.user?.id ?? null,
        })
        .select("id")
        .single();
      if (warningError) throw warningError;

      const recipientsPayload = matched.map(({ row, issues }) => ({
        warning_id: warningRow.id,
        school_id: activeSchoolId,
        student_id: row.student.id,
        issues,
      }));
      const { error: recipientsError } = await supabase
        .from("student_warning_recipients")
        .insert(recipientsPayload);
      if (recipientsError) throw recipientsError;

      setStudentWarningIssueOpen(false);
      setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters));
      setStudentWarningIssueMsg("");
      setStudentMsg(`Issued warning to ${matched.length} student${matched.length > 1 ? "s" : ""}.`);
      await fetchStudentWarnings();
    } catch (error) {
      if (!isMissingStudentWarningsTableError(error)) {
        console.error("issue student warning error:", error);
      }
      setStudentWarningIssueMsg(
        isMissingStudentWarningsTableError(error)
          ? "Warning tables are not available yet. Apply the latest Supabase migration first."
          : `Issue warning failed: ${error.message || error}`
      );
    } finally {
      setStudentWarningIssueSaving(false);
    }
  }

  async function deleteStudentWarning(warning) {
    if (!warning?.id) return;
    const ok = window.confirm(`Delete warning "${warning.title || "Warning"}"?`);
    if (!ok) return;
    setStudentWarningDeletingId(warning.id);
    setStudentWarningsMsg("");
    try {
      const { error: recipientError } = await supabase
        .from("student_warning_recipients")
        .delete()
        .eq("warning_id", warning.id);
      if (recipientError) throw recipientError;

      const { error: warningError } = await supabase
        .from("student_warnings")
        .delete()
        .eq("id", warning.id);
      if (warningError) throw warningError;

      if (selectedStudentWarning?.id === warning.id) {
        setSelectedStudentWarning(null);
      }
      setStudentMsg(`Deleted warning: ${warning.title || "Warning"}`);
      await fetchStudentWarnings();
    } catch (error) {
      if (!isMissingStudentWarningsTableError(error)) {
        console.error("delete student warning error:", error);
      }
      setStudentWarningsMsg(
        isMissingStudentWarningsTableError(error)
          ? "Warning tables are not available yet. Apply the latest Supabase migration first."
          : `Delete warning failed: ${error.message || error}`
      );
    } finally {
      setStudentWarningDeletingId("");
    }
  }

  async function toggleWithdrawn(student, nextValue) {
    if (!student?.id) return;
    setStudentMsg("");
    const { error } = await supabase
      .from("profiles")
      .update({ is_withdrawn: Boolean(nextValue) })
      .eq("id", student.id);
    if (error) {
      console.error("withdrawn update error:", error);
      setStudentMsg(`Update failed: ${error.message}`);
      return;
    }
    mergeStudentIntoState({ id: student.id, is_withdrawn: Boolean(nextValue) });
    fetchStudents();
  }

  async function toggleTestAccount(student, nextValue) {
    if (!student?.id) return;
    setStudentMsg("");
    const isTestAccount = Boolean(nextValue);
    const { error } = await supabase
      .from("profiles")
      .update({ is_test_account: isTestAccount })
      .eq("id", student.id);
    if (error) {
      console.error("test account update error:", error);
      setStudentMsg(`Update failed: ${error.message}`);
      return;
    }
    setStudentMsg(
      `${student.display_name || student.email || "Student"} ${isTestAccount ? "is now" : "is no longer"} a test account.`
    );
    await recordAuditEvent({
      actionType: "update",
      entityType: "student",
      entityId: student.id,
      summary: `${isTestAccount ? "Marked test account" : "Removed test account"}: ${student.display_name || student.email || student.id}`,
      metadata: {
        student_id: student.id,
        email: student.email || null,
        is_test_account: isTestAccount,
      },
    });
    mergeStudentIntoState({ id: student.id, is_test_account: isTestAccount });
    fetchStudents();
  }

  async function saveStudentInformation() {
    if (!selectedStudentId) return;
    setStudentInfoMsg("");
    const normalizedStudentCode = normalizeStudentNumberInput(studentInfoForm.student_code).trim();
    if (studentInfoForm.student_code.trim() && !normalizedStudentCode) {
      setStudentInfoMsg("Student No. must contain digits only.");
      return;
    }

    if (normalizedStudentCode) {
      const { data: duplicateStudent, error: duplicateError } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "student")
        .eq("school_id", activeSchoolId)
        .eq("student_code", normalizedStudentCode)
        .neq("id", selectedStudentId)
        .limit(1)
        .maybeSingle();
      if (duplicateError) {
        console.error("student number duplicate check error:", duplicateError);
        setStudentInfoMsg(`Save failed: ${duplicateError.message}`);
        return;
      }
      if (duplicateStudent?.id) {
        setStudentInfoMsg("Student No. is already used by another student in this school.");
        return;
      }
    }

    setStudentInfoSaving(true);
    const nextUploads = { ...getProfileUploads(studentInfoForm.profile_uploads) };
    for (const field of PERSONAL_UPLOAD_FIELDS) {
      const file = studentInfoUploadFiles[field.key];
      if (!file) continue;
      const { asset, error: uploadError } = await uploadProfileDocument(supabase, file, selectedStudentId, field.key);
      if (uploadError) {
        console.error("profile upload error:", uploadError);
        setStudentInfoMsg(`Upload failed: ${uploadError.message}`);
        setStudentInfoSaving(false);
        return;
      }
      if (asset?.url) nextUploads[field.key] = asset;
    }
    const payload = buildPersonalInfoPayload({
      ...studentInfoForm,
      student_code: normalizedStudentCode,
      profile_uploads: nextUploads,
    });
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", selectedStudentId)
      .select(STUDENT_DETAIL_SELECT_FIELDS)
      .single();
    if (error) {
      console.error("student info update error:", error);
      setStudentInfoMsg(
        isUniqueViolationError(error)
          ? "Student No. is already used by another student in this school."
          : `Save failed: ${error.message}`,
      );
      setStudentInfoSaving(false);
      return;
    }
    mergeStudentIntoState({ id: selectedStudentId, ...(data ?? payload) });
    setStudentInfoForm(getPersonalInfoForm(data ?? payload));
    setStudentInfoUploadFiles({});
    setStudentInfoSaving(false);
    setStudentInfoOpen(false);
  }

  async function fetchDailyRecords() {
    if (!activeSchoolId) {
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordSyllabusAnnouncements([]);
      setDailyRecordConfirmedDates([]);
      setDailyRecordHolidaySavingDate("");
      setDailyRecordsMsg("Select a school.");
      return;
    }
    setDailyRecordsMsg("Loading...");
    let result = await supabase
      .from("daily_records")
      .select(`
        id,
        school_id,
        record_date,
        is_holiday,
        todays_content,
        mini_test_1,
        mini_test_2,
        special_test_1,
        special_test_2,
        created_at,
        updated_at,
        daily_record_student_comments(${DAILY_RECORD_COMMENT_FIELDS})
      `)
      .eq("school_id", activeSchoolId)
      .order("record_date", { ascending: false })
      .limit(180);
    if (result.error && isMissingColumnError(result.error, "is_holiday")) {
      result = await supabase
        .from("daily_records")
        .select(`
          id,
          school_id,
          record_date,
          todays_content,
          mini_test_1,
          mini_test_2,
          special_test_1,
          special_test_2,
          created_at,
          updated_at,
          daily_record_student_comments(${DAILY_RECORD_COMMENT_FIELDS})
        `)
        .eq("school_id", activeSchoolId)
        .order("record_date", { ascending: false })
        .limit(180);
    }
    const { data, error } = result;
    if (error) {
      console.error("daily records fetch error:", error);
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordSyllabusAnnouncements([]);
      setDailyRecordConfirmedDates([]);
      setDailyRecordHolidaySavingDate("");
      setDailyRecordsMsg(`Load failed: ${error.message}`);
      return;
    }
    const { data: announcementRows, error: announcementError } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .eq("school_id", activeSchoolId)
      .like("title", "Exam Syllabus (%)")
      .limit(400);
    if (announcementError) {
      console.error("daily record syllabus announcements fetch error:", announcementError);
    }
    const list = data ?? [];
    setDailyRecords(list);
    setDailyRecordPlanDrafts(buildDailyRecordPlanDrafts(list));
    setDailyRecordSyllabusAnnouncements(announcementRows ?? []);
    setDailyRecordConfirmedDates(
      Array.from(
        new Set(
          (announcementRows ?? [])
            .map((row) => parseSyllabusAnnouncementDate(row.title))
            .filter(Boolean)
        )
      )
    );
    setDailyRecordHolidaySavingDate("");
    setDailyRecordsMsg(list.length ? "" : "No daily records yet. The next 2 months are shown below for planning.");
  }

function openDailyRecordModal(record = null, recordDate = "") {
    const existingRecord =
      record
      ?? dailyRecords.find((item) => item.record_date === recordDate)
      ?? null;
    let nextForm = existingRecord
      ? getDailyRecordForm(existingRecord)
      : getEmptyDailyRecordForm(recordDate || getTodayDateInput());
    if (!existingRecord) {
      const previousRecordDate = addDays(nextForm.record_date || recordDate || getTodayDateInput(), -1);
      const previousRecord = dailyRecords.find((item) => item.record_date === previousRecordDate) ?? null;
      const previousLargestEntry = getLargestDailyRecordTextbookEntry(previousRecord?.todays_content);
      if (previousLargestEntry) {
        nextForm = {
          ...nextForm,
          textbook_entries: [createDailyRecordTextbookRow(previousLargestEntry.book, String(previousLargestEntry.lesson))],
        };
      }
    }
    setDailyRecordForm(nextForm);
    setDailyRecordDate(nextForm.record_date || recordDate || getTodayDateInput());
    setDailyRecordsMsg("");
    setDailyRecordSaving(false);
    setDailyRecordModalOpen(true);
  }

  function closeDailyRecordModal() {
    setDailyRecordModalOpen(false);
    setDailyRecordSaving(false);
    setDailyRecordForm(getEmptyDailyRecordForm(dailyRecordDate || getTodayDateInput()));
    setDailyRecordAnnouncementTitleDraft("");
    setDailyRecordAnnouncementDraft("");
  }

  function updateDailyRecordPlanDraft(recordDate, field, value) {
    setDailyRecordPlanDrafts((prev) => ({
      ...prev,
      [recordDate]: {
        ...getEmptyDailyRecordPlanDraft(),
        ...(prev[recordDate] ?? {}),
        [field]: value,
      }
    }));
  }

  function updateDailyRecordComment(tempId, patch) {
    setDailyRecordForm((prev) => ({
      ...prev,
      comments: prev.comments.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item))
    }));
  }

  function updateDailyRecordTextbookEntry(tempId, patch) {
    setDailyRecordForm((prev) => ({
      ...prev,
      textbook_entries: prev.textbook_entries.map((item) => {
        if (item.tempId !== tempId) return item;
        const nextBook = patch.book ?? item.book;
        const nextLesson = patch.lesson ?? item.lesson;
        const availableOptions = new Set(getIrodoriCanDoOptions(nextBook, nextLesson));
        const nextCandoIds = (patch.cando_ids ?? item.cando_ids).filter((candoId) => availableOptions.has(String(candoId)));
        return {
          ...item,
          ...patch,
          textbook: IRODORI_TEXTBOOK_VALUE,
          book: nextBook,
          lesson: nextLesson,
          cando_ids: nextCandoIds,
        };
      }),
    }));
  }

  function toggleDailyRecordCanDo(tempId, candoId) {
    setDailyRecordForm((prev) => ({
      ...prev,
      textbook_entries: prev.textbook_entries.map((item) => {
        if (item.tempId !== tempId) return item;
        const current = new Set(item.cando_ids);
        if (current.has(candoId)) {
          current.delete(candoId);
        } else {
          current.add(candoId);
        }
        return {
          ...item,
          cando_ids: Array.from(current).sort((a, b) => Number(a) - Number(b)),
        };
      }),
    }));
  }

  function addDailyRecordTextbookEntry() {
    setDailyRecordForm((prev) => ({
      ...prev,
      textbook_entries: [...prev.textbook_entries, createDailyRecordTextbookRow()],
    }));
  }

  function removeDailyRecordTextbookEntry(tempId) {
    setDailyRecordForm((prev) => {
      const nextEntries = prev.textbook_entries.filter((item) => item.tempId !== tempId);
      return {
        ...prev,
        textbook_entries: nextEntries.length ? nextEntries : [createDailyRecordTextbookRow()],
      };
    });
  }

  function addDailyRecordCommentRow() {
    setDailyRecordForm((prev) => ({
      ...prev,
      comments: [...prev.comments, createDailyRecordCommentRow("")]
    }));
  }

  function removeDailyRecordCommentRow(tempId) {
    setDailyRecordForm((prev) => {
      const nextComments = prev.comments.filter((item) => item.tempId !== tempId);
      return {
        ...prev,
        comments: nextComments.length ? nextComments : [createDailyRecordCommentRow("")]
      };
    });
  }

  async function saveDailyRecord({ announcementAction = null } = {}) {
    if (!activeSchoolId) {
      setDailyRecordsMsg("Select a school.");
      return;
    }
    if (!dailyRecordForm.record_date) {
      setDailyRecordsMsg("Date is required.");
      return;
    }
    if (announcementAction && !dailyRecordAnnouncementTitleDraft.trim()) {
      setDailyRecordsMsg("Announcement title is required.");
      return;
    }
    if (announcementAction && !dailyRecordAnnouncementDraft.trim()) {
      setDailyRecordsMsg("Announcement draft is empty.");
      return;
    }
    setDailyRecordSaving(true);
    setDailyRecordsMsg("");
    const payload = {
      school_id: activeSchoolId,
      record_date: dailyRecordForm.record_date,
      todays_content: serializeDailyRecordContent(dailyRecordForm),
      updated_at: new Date().toISOString(),
      created_by: session?.user?.id ?? null,
    };

    let recordId = dailyRecordForm.id;
    if (recordId) {
      const { error } = await supabase
        .from("daily_records")
        .update(payload)
        .eq("id", recordId);
      if (error) {
        console.error("daily record update error:", error);
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("daily_records")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        console.error("daily record insert error:", error);
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordSaving(false);
        return;
      }
      recordId = data?.id ?? "";
    }
    setDailyRecordForm((prev) => ({ ...prev, id: recordId }));

    const { error: deleteError } = await supabase
      .from("daily_record_student_comments")
      .delete()
      .eq("record_id", recordId);
    if (deleteError) {
      console.error("daily record comments clear error:", deleteError);
      setDailyRecordsMsg(`Save failed: ${deleteError.message}`);
      setDailyRecordSaving(false);
      return;
    }

    const commentsPayload = (dailyRecordForm.comments ?? [])
      .map((item) => ({
        record_id: recordId,
        student_id: item.student_id,
        comment: item.comment.trim(),
      }))
      .filter((item) => item.student_id && item.comment);
    if (commentsPayload.length) {
      const { error: commentsError } = await supabase
        .from("daily_record_student_comments")
        .insert(commentsPayload);
      if (commentsError) {
        console.error("daily record comments insert error:", commentsError);
        setDailyRecordsMsg(`Save failed: ${commentsError.message}`);
        setDailyRecordSaving(false);
        return;
      }
    }

    if (announcementAction === "send") {
      const nowIso = new Date().toISOString();
      const { error: closePrevError } = await supabase
        .from("announcements")
        .update({ end_at: nowIso })
        .eq("school_id", activeSchoolId)
        .like("title", "Exam Syllabus (%)")
        .is("end_at", null);
      if (closePrevError) {
        console.error("daily record announcement close previous error:", closePrevError);
        const failureMessage = `Record saved, but the previous syllabus announcement could not be closed: ${closePrevError.message}`;
        setDailyRecordSaving(false);
        await fetchDailyRecords();
        setDailyRecordsMsg(failureMessage);
        return;
      }
    }

    if (announcementAction === "send") {
      const nowIso = new Date().toISOString();
      const announcementPayload = {
        school_id: activeSchoolId,
        title: dailyRecordAnnouncementTitleDraft.trim(),
        body: dailyRecordAnnouncementDraft.trim(),
        publish_at: nowIso,
        end_at: null,
        created_by: session?.user?.id ?? null,
      };
      const { error: announcementError } = await supabase
        .from("announcements")
        .insert(announcementPayload);
      if (announcementError) {
        console.error("daily record announcement create error:", announcementError);
        const failureMessage = `Record saved, but the announcement could not be sent: ${announcementError.message}`;
        setDailyRecordSaving(false);
        await fetchDailyRecords();
        setDailyRecordsMsg(failureMessage);
        return;
      }
    } else if (announcementAction === "edit") {
      if (!dailyRecordExistingAnnouncement?.id) {
        setDailyRecordSaving(false);
        setDailyRecordsMsg("No existing syllabus announcement was found to edit.");
        return;
      }
      const { error: announcementError } = await supabase
        .from("announcements")
        .update({
          title: dailyRecordAnnouncementTitleDraft.trim(),
          body: dailyRecordAnnouncementDraft.trim(),
        })
        .eq("id", dailyRecordExistingAnnouncement.id);
      if (announcementError) {
        console.error("daily record announcement edit error:", announcementError);
        const failureMessage = `Record saved, but the announcement could not be updated: ${announcementError.message}`;
        setDailyRecordSaving(false);
        await fetchDailyRecords();
        setDailyRecordsMsg(failureMessage);
        return;
      }
    }

    setDailyRecordSaving(false);
    setDailyRecordModalOpen(false);
    setDailyRecordDate(dailyRecordForm.record_date);
    setDailyRecordAnnouncementTitleDraft("");
    setDailyRecordAnnouncementDraft("");
    setDailyRecordsMsg(
      announcementAction === "send"
        ? "Daily record saved and announcement sent."
        : announcementAction === "edit"
          ? "Daily record saved and announcement updated."
          : ""
    );
    await recordAuditEvent({
      actionType: dailyRecordForm.id ? "update" : "create",
      entityType: "daily_record",
      entityId: recordId,
      summary: `Saved daily record for ${dailyRecordForm.record_date}${announcementAction === "send" ? " and sent syllabus announcement" : announcementAction === "edit" ? " and updated syllabus announcement" : ""}.`,
      metadata: {
        record_date: dailyRecordForm.record_date,
        comment_count: commentsPayload.length,
        announcement_action: announcementAction || null,
      },
    });
    await fetchDailyRecords();
  }

  async function saveDailyRecordPlan(recordDate) {
    if (!activeSchoolId || !recordDate) return;
    setDailyRecordPlanSavingDate(recordDate);
    setDailyRecordsMsg("");
    const draft = {
      ...getEmptyDailyRecordPlanDraft(),
      ...(dailyRecordPlanDrafts[recordDate] ?? {})
    };
    const existingRecord = dailyRecords.find((item) => item.record_date === recordDate) ?? null;
    const payload = {
      school_id: activeSchoolId,
      record_date: recordDate,
      mini_test_1: draft.mini_test_1.trim() || null,
      mini_test_2: draft.mini_test_2.trim() || null,
      special_test_1: draft.special_test_1.trim() || null,
      special_test_2: null,
      updated_at: new Date().toISOString(),
      created_by: session?.user?.id ?? null,
    };
    if (existingRecord?.id) {
      const { error } = await supabase
        .from("daily_records")
        .update(payload)
        .eq("id", existingRecord.id);
      if (error) {
        console.error("daily record plan update error:", error);
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordPlanSavingDate("");
        return;
      }
    } else {
      const { error } = await supabase
        .from("daily_records")
        .insert({
          ...payload,
          todays_content: null,
        });
      if (error) {
        console.error("daily record plan insert error:", error);
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordPlanSavingDate("");
        return;
      }
    }
    setDailyRecordPlanSavingDate("");
    setDailyRecordsMsg(`Saved plan for ${recordDate}.`);
    await fetchDailyRecords();
  }

  async function saveDailyRecordHoliday(recordDate, nextHoliday) {
    if (!activeSchoolId || !recordDate) return;
    setDailyRecordHolidaySavingDate(recordDate);
    setDailyRecordsMsg("");
    const existingRecord = dailyRecords.find((item) => item.record_date === recordDate) ?? null;
    const payload = {
      school_id: activeSchoolId,
      record_date: recordDate,
      is_holiday: nextHoliday,
      updated_at: new Date().toISOString(),
      created_by: session?.user?.id ?? null,
    };

    if (existingRecord?.id) {
      const { error } = await supabase
        .from("daily_records")
        .update(payload)
        .eq("id", existingRecord.id);
      if (error) {
        console.error("daily record holiday update error:", error);
        setDailyRecordHolidaySavingDate("");
        setDailyRecordsMsg(
          isMissingColumnError(error, "is_holiday")
            ? "Holiday toggle requires the latest daily_records migration."
            : `Save failed: ${error.message}`,
        );
        return;
      }
    } else {
      const { error } = await supabase
        .from("daily_records")
        .insert({
          ...payload,
          todays_content: null,
          mini_test_1: null,
          mini_test_2: null,
          special_test_1: null,
          special_test_2: null,
        });
      if (error) {
        console.error("daily record holiday insert error:", error);
        setDailyRecordHolidaySavingDate("");
        setDailyRecordsMsg(
          isMissingColumnError(error, "is_holiday")
            ? "Holiday toggle requires the latest daily_records migration."
            : `Save failed: ${error.message}`,
        );
        return;
      }
    }

    await fetchDailyRecords();
    setDailyRecordsMsg(`${recordDate} marked as ${nextHoliday ? "holiday" : "school day"}.`);
  }

  async function fetchRankingPeriods() {
    if (!activeSchoolId) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg("Select a school.");
      return;
    }
    setRankingMsg("Loading...");
    let { data, error } = await supabase
      .from("ranking_periods")
      .select(`
        id,
        school_id,
        label,
        start_date,
        end_date,
        sort_order,
        updated_at,
        ranking_entries(id, student_id, student_name, average_rate, rank_position)
      `)
      .eq("school_id", activeSchoolId)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("ranking periods fetch error:", error);
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg(`Load failed: ${error.message}`);
      return;
    }
    const periods = data ?? [];
    const normalized = periods.map((period) => ({
      ...period,
      ranking_entries: [...(period.ranking_entries ?? [])].sort((a, b) => (a.rank_position ?? 0) - (b.rank_position ?? 0))
    }));
    setRankingPeriods(normalized);
    setRankingDrafts(getRankingDrafts(normalized));
    setRankingMsg(normalized.length ? "" : "No ranking periods yet. Click Add Period.");
  }

  function updateRankingDraft(periodId, field, value) {
    setRankingDrafts((prev) => ({
      ...prev,
      [periodId]: {
        label: prev[periodId]?.label ?? "",
        start_date: prev[periodId]?.start_date ?? "",
        end_date: prev[periodId]?.end_date ?? "",
        [field]: value,
      }
    }));
  }

  async function saveRankingPeriodLabel(period) {
    if (!period?.id) return;
    const draft = rankingDrafts[period.id] ?? { label: "", start_date: "", end_date: "" };
    const nextLabel = String(draft.label ?? "").trim();
    const currentLabel = String(period.label ?? "").trim();
    if (!nextLabel) {
      setRankingMsg("Period name is required.");
      setRankingDrafts((prev) => ({
        ...prev,
        [period.id]: {
          label: currentLabel,
          start_date: prev[period.id]?.start_date ?? period.start_date ?? "",
          end_date: prev[period.id]?.end_date ?? period.end_date ?? "",
        }
      }));
      return;
    }
    if (nextLabel === currentLabel) return;
    const { error } = await supabase
      .from("ranking_periods")
      .update({
        label: nextLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id);
    if (error) {
      console.error("ranking period label update error:", error);
      setRankingMsg(`Save failed: ${error.message}`);
      return;
    }
    setRankingPeriods((prev) =>
      prev.map((item) => (item.id === period.id ? { ...item, label: nextLabel } : item))
    );
    setRankingDrafts((prev) => ({
      ...prev,
      [period.id]: {
        label: nextLabel,
        start_date: prev[period.id]?.start_date ?? period.start_date ?? "",
        end_date: prev[period.id]?.end_date ?? period.end_date ?? "",
      }
    }));
    setRankingMsg(`Saved ${nextLabel}.`);
  }

  async function addRankingPeriod() {
    if (!activeSchoolId) {
      setRankingMsg("Select a school.");
      return;
    }
    const nextSortOrder = (rankingPeriods ?? []).reduce((max, period) => Math.max(max, Number(period.sort_order ?? -1)), -1) + 1;
    const nextLabel = `Period ${nextSortOrder + 1}`;
    const { error } = await supabase
      .from("ranking_periods")
      .insert({
        school_id: activeSchoolId,
        label: nextLabel,
        sort_order: nextSortOrder,
      });
    if (error) {
      console.error("ranking period create error:", error);
      setRankingMsg(`Add period failed: ${error.message}`);
      return;
    }
    setRankingMsg("");
    await fetchRankingPeriods();
  }

  async function refreshRankingPeriod(period) {
    if (!period?.id) return;
    const draft = rankingDrafts[period.id] ?? { label: "", start_date: "", end_date: "" };
    const nextLabel = String(draft.label ?? "").trim();
    if (!nextLabel) {
      setRankingMsg("Period name is required.");
      return;
    }
    if (!draft.start_date || !draft.end_date) {
      setRankingMsg(`Set both start and end dates for ${nextLabel}.`);
      return;
    }
    setRankingRefreshingId(period.id);
    setRankingMsg("");
    const { error: periodError } = await supabase
      .from("ranking_periods")
      .update({
        label: nextLabel,
        start_date: draft.start_date,
        end_date: draft.end_date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id);
    if (periodError) {
      console.error("ranking period update error:", periodError);
      setRankingMsg(`Refresh failed: ${periodError.message}`);
      setRankingRefreshingId("");
      return;
    }

    const { data: attemptsData, error: attemptsError } = await supabase
      .from("attempts")
      .select("student_id, test_session_id, test_version, score_rate, correct, total, created_at, ended_at")
      .eq("school_id", activeSchoolId)
      .gte("created_at", new Date(`${draft.start_date}T00:00:00`).toISOString())
      .lte("created_at", new Date(`${draft.end_date}T23:59:59`).toISOString());
    if (attemptsError) {
      console.error("ranking attempts fetch error:", attemptsError);
      setRankingMsg(`Refresh failed: ${attemptsError.message}`);
      setRankingRefreshingId("");
      return;
    }

    let rankingStudents = analyticsStudents ?? [];
    if (!rankingStudents.length) {
      const { data: studentRows, error: studentsError } = await supabase
        .from("profiles")
        .select("id, display_name, email, student_code, is_withdrawn, is_test_account")
        .eq("role", "student")
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false });
      if (studentsError) {
        console.error("ranking students fetch error:", studentsError);
        setRankingMsg(`Refresh failed: ${studentsError.message}`);
        setRankingRefreshingId("");
        return;
      }
      rankingStudents = (studentRows ?? []).filter((student) => !isAnalyticsExcludedStudent(student));
    }
    const studentMeta = new Map(
      rankingStudents.map((student) => [
        student.id,
        student.display_name || student.email || student.student_code || student.id
      ])
    );
    const totalsByStudent = new Map();
    Array.from(buildLatestAttemptMapByStudentAndScope(attemptsData).values()).forEach((row) => {
      if (!row?.student_id || !studentMeta.has(row.student_id)) return;
      const rate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
      if (!Number.isFinite(rate)) return;
      const current = totalsByStudent.get(row.student_id) ?? { sum: 0, count: 0 };
      current.sum += rate;
      current.count += 1;
      totalsByStudent.set(row.student_id, current);
    });
    const rankings = Array.from(totalsByStudent.entries())
      .map(([studentId, stats]) => ({
        student_id: studentId,
        student_name: studentMeta.get(studentId) ?? studentId,
        average_rate: stats.count ? stats.sum / stats.count : 0,
      }))
      .sort((a, b) => {
        if (b.average_rate !== a.average_rate) return b.average_rate - a.average_rate;
        return String(a.student_name).localeCompare(String(b.student_name));
      })
      .map((item, index) => ({
        period_id: period.id,
        school_id: activeSchoolId,
        student_id: item.student_id,
        student_name: item.student_name,
        average_rate: item.average_rate,
        rank_position: index + 1,
      }));

    const { error: clearError } = await supabase
      .from("ranking_entries")
      .delete()
      .eq("period_id", period.id);
    if (clearError) {
      console.error("ranking entries clear error:", clearError);
      setRankingMsg(`Refresh failed: ${clearError.message}`);
      setRankingRefreshingId("");
      return;
    }
    if (rankings.length) {
      const { error: insertError } = await supabase
        .from("ranking_entries")
        .insert(rankings);
      if (insertError) {
        console.error("ranking entries insert error:", insertError);
        setRankingMsg(`Refresh failed: ${insertError.message}`);
        setRankingRefreshingId("");
        return;
      }
    }
    setRankingRefreshingId("");
    setRankingMsg(`Updated ${nextLabel}.`);
    await fetchRankingPeriods();
  }

  useEffect(() => {
    if (activeTab !== "attendance") return;
    if (attendanceSubTab === "sheet") {
      if (!students.length) fetchStudents();
      fetchAttendanceDays();
    }
    if (attendanceSubTab === "absence") {
      fetchAbsenceApplications();
    }
  }, [activeSchoolId, activeTab, attendanceSubTab]);

  async function fetchAbsenceApplications() {
    if (!activeSchoolId) {
      setAbsenceApplications([]);
      setAbsenceApplicationsMsg("");
      return;
    }
    setAbsenceApplicationsMsg("Loading...");
    const { data, error } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, day_date, status, reason, catch_up, late_type, time_value, created_at, decided_at, profiles:student_id (display_name, student_code, email)")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("absence applications fetch error:", error);
      setAbsenceApplications([]);
      setAbsenceApplicationsMsg(`Load failed: ${error.message}`);
      return;
    }
    setAbsenceApplications(data ?? []);
    setAbsenceApplicationsMsg(data?.length ? "" : "No applications.");
  }

  async function decideAbsenceApplication(id, nextStatus) {
    if (!id) return;
    const targetApplication = (absenceApplications ?? []).find((item) => item.id === id) ?? null;
    const { error } = await supabase
      .from("absence_applications")
      .update({
        status: nextStatus,
        decided_at: new Date().toISOString(),
        decided_by: session?.user?.id ?? null
      })
      .eq("id", id);
    if (error) {
      console.error("absence application update error:", error);
      setAbsenceApplicationsMsg(`Update failed: ${error.message}`);
      return;
    }
    await recordAuditEvent({
      actionType: nextStatus === "approved" ? "approve" : "deny",
      entityType: "absence_application",
      entityId: id,
      summary: `${nextStatus === "approved" ? "Approved" : "Denied"} absence application for ${targetApplication?.profiles?.display_name || targetApplication?.student_id || "student"}.`,
      metadata: {
        application_type: targetApplication?.type ?? null,
        day_date: targetApplication?.day_date ?? null,
        status: nextStatus,
      },
    });
    fetchAbsenceApplications();
  }

  useEffect(() => {
    if (activeTab === "announcements") {
      fetchAnnouncements();
    }
  }, [activeSchoolId, activeTab]);

  async function fetchAnnouncements() {
    const schoolIdSnapshot = activeSchoolIdRef.current;
    if (!schoolIdSnapshot) {
      setAnnouncements([]);
      setAnnouncementMsg("");
      return;
    }
    setAnnouncementMsg("Loading...");
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .eq("school_id", schoolIdSnapshot)
      .order("created_at", { ascending: false })
      .limit(200);
    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      console.error("announcements fetch error:", error);
      setAnnouncements([]);
      setAnnouncementMsg(`Load failed: ${error.message}`);
      return;
    }
    setAnnouncements(data ?? []);
    setAnnouncementMsg(data?.length ? "" : "No announcements.");
  }

  async function createAnnouncement() {
    setAnnouncementMsg("");
    const title = announcementForm.title.trim();
    const body = announcementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const publishAt = announcementForm.publish_at
      ? fromBangladeshInput(announcementForm.publish_at)
      : new Date().toISOString();
    const endAt = announcementForm.end_at ? fromBangladeshInput(announcementForm.end_at) : null;
    const payload = {
      title,
      body,
      publish_at: publishAt,
      end_at: endAt,
      created_by: session?.user?.id ?? null
    };
    const { error } = await supabase.from("announcements").insert(payload);
    if (error) {
      console.error("announcement create error:", error);
      setAnnouncementMsg(`Create failed: ${error.message}`);
      return;
    }
    setAnnouncementForm({ title: "", body: "", publish_at: formatDateTimeInput(new Date()), end_at: "" });
    setAnnouncementCreateOpen(false);
    setAnnouncementMsg("Announcement created.");
    await recordAuditEvent({
      actionType: "create",
      entityType: "announcement",
      entityId: title,
      summary: `Created announcement "${title}".`,
      metadata: {
        title,
        publish_at: publishAt,
        end_at: endAt,
      },
    });
    fetchAnnouncements();
  }

  async function deleteAnnouncement(id) {
    if (!id) return;
    const ok = window.confirm("Delete this announcement?");
    if (!ok) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      console.error("announcement delete error:", error);
      setAnnouncementMsg(`Delete failed: ${error.message}`);
      return;
    }
    fetchAnnouncements();
  }

  function startEditAnnouncement(announcement) {
    if (!announcement?.id) return;
    setAnnouncementMsg("");
    setEditingAnnouncementId(announcement.id);
    setEditingAnnouncementForm({
      title: announcement.title ?? "",
      body: announcement.body ?? "",
      publish_at: formatDateTimeInput(announcement.publish_at),
      end_at: announcement.end_at ? formatDateTimeInput(announcement.end_at) : ""
    });
  }

  function cancelEditAnnouncement() {
    setEditingAnnouncementId("");
    setEditingAnnouncementForm({ title: "", body: "", publish_at: "", end_at: "" });
  }

  function openCreateAnnouncementModal() {
    setAnnouncementMsg("");
    setAnnouncementForm((current) => ({
      ...current,
      publish_at: current.publish_at || formatDateTimeInput(new Date()),
    }));
    setAnnouncementCreateOpen(true);
  }

  function closeCreateAnnouncementModal() {
    setAnnouncementCreateOpen(false);
  }

  async function saveAnnouncementEdits() {
    if (!editingAnnouncementId) return;
    const title = editingAnnouncementForm.title.trim();
    const body = editingAnnouncementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const payload = {
      title,
      body,
      publish_at: editingAnnouncementForm.publish_at
        ? fromBangladeshInput(editingAnnouncementForm.publish_at)
        : new Date().toISOString(),
      end_at: editingAnnouncementForm.end_at ? fromBangladeshInput(editingAnnouncementForm.end_at) : null
    };
    const { error } = await supabase
      .from("announcements")
      .update(payload)
      .eq("id", editingAnnouncementId);
    if (error) {
      console.error("announcement update error:", error);
      setAnnouncementMsg(`Update failed: ${error.message}`);
      return;
    }
    cancelEditAnnouncement();
    setAnnouncementMsg("Announcement updated.");
    fetchAnnouncements();
  }

  async function fetchStudentAttempts(studentId) {
    if (!studentId) return { list: [], hydratedQuestions: {}, rankMap: {} };
    setStudentAttemptsMsg("Loading...");
    let { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json, tab_left_count")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && isMissingTabLeftCountError(error)) {
      ({ data, error } = await supabase
        .from("attempts")
        .select("id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, created_at, ended_at, answers_json")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(200));
    }
    if (error) {
      console.error("student attempts fetch error:", error);
      setStudentAttempts([]);
      setStudentAttemptsMsg(`Load failed: ${error.message}`);
      return { list: [], hydratedQuestions: {}, rankMap: {} };
    }
    const list = data ?? [];
    setStudentAttempts(list);
    setStudentAttemptsMsg(list.length ? "" : "No attempts.");
    const hydratedQuestions = await hydrateAttemptQuestions(list.map((a) => a.test_version));
    const rankMap = await fetchAttemptRanksForSessions(list);
    return { list, hydratedQuestions, rankMap };
  }

  async function fetchAttemptRanksForSessions(attemptsList) {
    const sessionIds = Array.from(new Set((attemptsList ?? []).map((a) => a.test_session_id).filter(Boolean)));
    if (!sessionIds.length) {
      setStudentAttemptRanks({});
      return {};
    }
    const { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, test_session_id, correct, total, score_rate, created_at, ended_at")
      .in("test_session_id", sessionIds);
    if (error) {
      console.error("attempt rank fetch error:", error);
      setStudentAttemptRanks({});
      return {};
    }
    const bySession = new Map();
    (data ?? []).forEach((a) => {
      if (!a.test_session_id) return;
      if (!bySession.has(a.test_session_id)) bySession.set(a.test_session_id, []);
      bySession.get(a.test_session_id).push(a);
    });
    const rankMap = {};
    bySession.forEach((rows, sessionId) => {
      const latestRows = Array.from(buildLatestAttemptMapByStudent(rows).values())
        .filter((row) => !isAnalyticsExcludedStudent(studentsById.get(row.student_id)));
      const sorted = latestRows
        .map((row) => Number(row.score_rate ?? (row.total ? row.correct / row.total : 0)))
        .sort((a, b) => b - a);
      latestRows.forEach((row) => {
        const attemptRate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
        let rank = sorted.findIndex((v) => v === attemptRate);
        if (rank === -1) {
          rank = sorted.findIndex((v) => v < attemptRate);
          if (rank === -1) rank = sorted.length;
        }
        rankMap[row.id] = { rank: rank + 1, total: sorted.length };
      });
    });
    setStudentAttemptRanks(rankMap);
    return rankMap;
  }

  async function hydrateAttemptQuestions(versions) {
    const unique = Array.from(new Set((versions ?? []).filter(Boolean)));
    const missing = unique.filter((v) => !attemptQuestionsByVersion[v]);
    if (!missing.length) return {};
    const { data, error } = await supabase
      .from("questions")
      .select("test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
      .in("test_version", missing)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("attempt questions preload error:", error);
      return {};
    }
    const grouped = {};
    (data ?? []).forEach((row) => {
      const version = row.test_version;
      if (!version) return;
      if (!grouped[version]) grouped[version] = [];
      grouped[version].push(mapDbQuestion(row));
    });
    setAttemptQuestionsByVersion((prev) => ({ ...prev, ...grouped }));
    return grouped;
  }

  async function fetchStudentAttendance(studentId) {
    if (!studentId) return [];
    setStudentAttendanceMsg("Loading...");
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, status, comment")
      .eq("student_id", studentId);
    if (error) {
      console.error("student attendance fetch error:", error);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${error.message}`);
      return [];
    }
    const entries = data ?? [];
    const dayIds = entries.map((e) => e.day_id).filter(Boolean);
    if (!dayIds.length) {
      setStudentAttendance([]);
      setStudentAttendanceMsg("No attendance records.");
      return [];
    }
    const { data: daysData, error: daysError } = await supabase
      .from("attendance_days")
      .select("id, day_date")
      .in("id", dayIds);
    if (daysError) {
      console.error("attendance days fetch error:", daysError);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${daysError.message}`);
      return [];
    }
    const dayMap = {};
    (daysData ?? []).forEach((d) => {
      dayMap[d.id] = d.day_date;
    });
    const list = entries
      .map((e) => ({
        day_id: e.day_id,
        day_date: dayMap[e.day_id] ?? "",
        status: e.status,
        comment: e.comment ?? ""
      }))
      .sort((a, b) => String(a.day_date).localeCompare(String(b.day_date)));
    setStudentAttendance(list);
    setStudentAttendanceMsg(list.length ? "" : "No attendance records.");
    return list;
  }

  async function seedModelCategory(list) {
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
  }

  async function attachGeneratedDailySourceSetIds(list) {
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
  }

  async function fetchTests() {
    setTestsMsg("Loading...");
    const { data, error } = await supabase
      .from("tests")
      .select("id, version, title, type, pass_rate, is_public, created_at, questions(count)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("relationship") || msg.includes("questions")) {
        const fallback = await supabase
          .from("tests")
          .select("id, version, title, type, pass_rate, is_public, created_at")
          .eq("is_public", true)
          .order("created_at", { ascending: false })
          .limit(200);
        if (fallback.error) {
          console.error("tests fetch error:", fallback.error);
          setTests([]);
          setTestsMsg(`Load failed: ${fallback.error.message}`);
          return;
        }
        const list = fallback.data ?? [];
        const counts = await fetchQuestionCounts(supabase, list.map((t) => t.version));
        const withCounts = list.map((t) => ({
          ...t,
          question_count: counts[t.version] ?? 0
        }));
        const seeded = await seedModelCategory(withCounts);
        const hydrated = await attachGeneratedDailySourceSetIds(seeded);
        setTests(hydrated);
        if (hydrated.length && !testSessionForm.problem_set_id) {
          setTestSessionForm((s) => ({ ...s, problem_set_id: hydrated[0].version }));
        }
        const firstDaily = hydrated.find((t) => t.type === "daily" && !isGeneratedDailySessionVersion(t.version));
        if (firstDaily && !dailySessionForm.problem_set_id) {
          setDailySessionForm((s) => ({ ...s, problem_set_id: firstDaily.version }));
        }
        setTestsMsg(list.length ? "" : "No tests.");
        return;
      }
      console.error("tests fetch error:", error);
      setTests([]);
      setTestsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    const hasRelation = list.some((t) => Array.isArray(t.questions));
    if (!hasRelation) {
      const counts = await fetchQuestionCounts(supabase, list.map((t) => t.version));
      const withCounts = list.map((t) => ({
        ...t,
        question_count: counts[t.version] ?? 0
      }));
      const seeded = await seedModelCategory(withCounts);
      const hydrated = await attachGeneratedDailySourceSetIds(seeded);
      setTests(hydrated);
      const firstModel = hydrated.find((t) => t.type === "mock");
      const firstDaily = hydrated.find((t) => t.type === "daily" && !isGeneratedDailySessionVersion(t.version));
      if (firstModel && !testSessionForm.problem_set_id) {
        setTestSessionForm((s) => ({ ...s, problem_set_id: firstModel.version }));
      }
      if (firstDaily && !dailySessionForm.problem_set_id) {
        setDailySessionForm((s) => ({ ...s, problem_set_id: firstDaily.version }));
      }
      setTestsMsg(list.length ? "" : "No tests.");
      return;
    }
    const withCounts = list.map((t) => ({
      ...t,
      question_count: t.questions?.[0]?.count ?? 0
    }));
    const seeded = await seedModelCategory(withCounts);
    const hydrated = await attachGeneratedDailySourceSetIds(seeded);
    setTests(hydrated);
    const firstModel = hydrated.find((t) => t.type === "mock");
    const firstDaily = hydrated.find((t) => t.type === "daily" && !isGeneratedDailySessionVersion(t.version));
    if (firstModel && !testSessionForm.problem_set_id) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: firstModel.version }));
    }
    if (firstDaily && !dailySessionForm.problem_set_id) {
      setDailySessionForm((s) => ({ ...s, problem_set_id: firstDaily.version }));
    }
    setTestsMsg(list.length ? "" : "No tests.");
  }

  async function fetchTestSessions() {
    setTestSessionsMsg("Loading...");
    let { data, error } = await supabase
      .from("test_sessions")
      .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, retake_source_session_id, retake_release_scope, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error && isMissingRetakeSessionFieldsError(error)) {
      ({ data, error } = await supabase
        .from("test_sessions")
        .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at")
        .order("created_at", { ascending: false })
        .limit(500));
    }
    if (error) {
      console.error("test_sessions fetch error:", error);
      setTestSessions([]);
      setTestSessionsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = (data ?? []).map((session) => ({
      retake_source_session_id: null,
      retake_release_scope: "all",
      ...session,
    }));
    setTestSessions(list);
    setTestSessionsMsg(list.length ? "" : "No test sessions.");
    if (list.length && !testSessionForm.problem_set_id) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: list[0].problem_set_id || "" }));
    }
  }

  async function fetchAttendanceDays() {
    const schoolIdSnapshot = activeSchoolIdRef.current;
    if (!schoolIdSnapshot) {
      setAttendanceDays([]);
      setAttendanceEntries({});
      setAttendanceMsg("");
      return;
    }
    setAttendanceMsg("Loading attendance...");
    const { data, error } = await supabase
      .from("attendance_days")
      .select("id, day_date, created_at")
      .eq("school_id", schoolIdSnapshot)
      .order("day_date", { ascending: true })
      .limit(60);
    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      console.error("attendance_days fetch error:", error);
      setAttendanceDays([]);
      setAttendanceEntries({});
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setAttendanceDays(list);
    setAttendanceMsg(list.length ? "" : "No attendance days yet.");
    if (list.length) {
      fetchAttendanceEntries(list.map((d) => d.id), schoolIdSnapshot);
    } else {
      setAttendanceEntries({});
    }
  }

  async function fetchAttendanceEntries(dayIds, schoolIdSnapshot = activeSchoolIdRef.current) {
    if (!dayIds?.length) {
      setAttendanceEntries({});
      return;
    }
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, student_id, status, comment")
      .in("day_id", dayIds);
    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      console.error("attendance_entries fetch error:", error);
      setAttendanceEntries({});
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const map = {};
    (data ?? []).forEach((row) => {
      if (!row?.day_id || !row?.student_id) return;
      if (!map[row.day_id]) map[row.day_id] = {};
      map[row.day_id][row.student_id] = {
        status: row.status,
        comment: row.comment ?? ""
      };
    });
    setAttendanceEntries(map);
  }

  async function openAttendanceDay(dayDate, options = {}) {
    if (!dayDate) return;
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    const existingDay = (attendanceDays ?? []).find((day) => day.day_date === dayDate) ?? null;
    if (existingDay && options.confirmExisting) {
      const shouldEditExisting = window.confirm(
        `Attendance for ${dayDate} already exists. Edit it?`
      );
      if (!shouldEditExisting) {
        return;
      }
    }
    setAttendanceMsg("");
    setAttendanceModalOpen(true);
    setAttendanceSaving(false);
    setApprovedAbsenceByStudent({});
    let day = existingDay;
    if (!day) {
      day = {
        id: null,
        school_id: activeSchoolId,
        day_date: dayDate,
        created_at: null,
        isDraft: true,
      };
    }
    const { data: approvedApps, error: appsError } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, late_type, time_value, reason, catch_up")
      .eq("school_id", activeSchoolId)
      .eq("day_date", day.day_date)
      .eq("status", "approved");
    if (appsError) {
      console.error("approved applications fetch error:", appsError);
      setApprovedAbsenceByStudent({});
    } else {
      const map = {};
      (approvedApps ?? []).forEach((a) => {
        map[a.student_id] = a;
      });
      setApprovedAbsenceByStudent(map);
    }
    setAttendanceModalDay(day);
    const existing = day.id ? (attendanceEntriesByDay[day.id] ?? {}) : {};
    const draft = {};
    (activeStudents ?? []).forEach((s) => {
      const entry = existing[s.id] || {};
      draft[s.id] = {
        status: entry.status || "P",
        comment: entry.comment || ""
      };
    });
    setAttendanceDraft(draft);
  }

  async function saveAttendanceDay() {
    if (!attendanceModalDay?.day_date) return;
    setAttendanceSaving(true);
    let dayId = attendanceModalDay.id;
    if (!dayId) {
      const { data: dayData, error: dayError } = await supabase
        .from("attendance_days")
        .upsert({ school_id: activeSchoolId, day_date: attendanceModalDay.day_date }, { onConflict: "school_id,day_date" })
        .select()
        .single();
      if (dayError || !dayData?.id) {
        console.error("attendance day upsert error:", dayError);
        setAttendanceMsg(`Save failed: ${dayError?.message ?? "Unknown error"}`);
        setAttendanceSaving(false);
        return;
      }
      dayId = dayData.id;
      setAttendanceModalDay(dayData);
    }
    const rows = Object.entries(attendanceDraft || {})
      .map(([studentId, v]) => ({
        day_id: dayId,
        student_id: studentId,
        status: v.status,
        comment: v.comment?.trim() || null
      }))
      .filter((row) => ATTENDANCE_SUPPORTED_STATUSES.includes(normalizeAttendanceStatusToken(row.status)));
    const { error } = await supabase
      .from("attendance_entries")
      .upsert(rows, { onConflict: "day_id,student_id" });
    if (error) {
      console.error("attendance save error:", error);
      setAttendanceMsg(`Save failed: ${error.message}`);
      setAttendanceSaving(false);
      return;
    }
    setAttendanceSaving(false);
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    await recordAuditEvent({
      actionType: attendanceModalDay.id ? "update" : "create",
      entityType: "attendance_day",
      entityId: dayId,
      summary: `Saved attendance for ${attendanceModalDay.day_date}.`,
      metadata: {
        day_date: attendanceModalDay.day_date,
        entry_count: rows.length,
      },
    });
    fetchAttendanceDays();
  }

  async function deleteAttendanceDay(day) {
    if (!day?.id) return;
    const ok = window.confirm(`Delete attendance for ${day.day_date}?`);
    if (!ok) return;
    const { error } = await supabase
      .from("attendance_days")
      .delete()
      .eq("id", day.id)
      .eq("school_id", activeSchoolId);
    if (error) {
      console.error("attendance delete error:", error);
      setAttendanceMsg(`Delete failed: ${error.message}`);
      return;
    }
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    await recordAuditEvent({
      actionType: "delete",
      entityType: "attendance_day",
      entityId: day.id,
      summary: `Deleted attendance day ${day.day_date}.`,
      metadata: {
        day_date: day.day_date,
      },
    });
    fetchAttendanceDays();
  }

  async function clearAllAttendanceValues() {
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    const ok = window.confirm(
      "Clear all attendance data for this school? This will remove all attendance day columns and every saved attendance value."
    );
    if (!ok) return;

    setAttendanceClearing(true);
    setAttendanceMsg("");
    try {
      const { data: dayRows, error: dayError } = await supabase
        .from("attendance_days")
        .select("id")
        .eq("school_id", activeSchoolId)
        .limit(5000);
      if (dayError) throw dayError;

      const dayIds = Array.from(new Set((dayRows ?? []).map((row) => row.id).filter(Boolean)));
      if (!dayIds.length) {
        setAttendanceMsg("No attendance days found.");
        return;
      }

      for (let index = 0; index < dayIds.length; index += 200) {
        const chunk = dayIds.slice(index, index + 200);
        const { error: deleteError } = await supabase
          .from("attendance_entries")
          .delete()
          .in("day_id", chunk);
        if (deleteError) throw deleteError;
      }

      for (let index = 0; index < dayIds.length; index += 200) {
        const chunk = dayIds.slice(index, index + 200);
        const { error: deleteDayError } = await supabase
          .from("attendance_days")
          .delete()
          .in("id", chunk)
          .eq("school_id", activeSchoolId);
        if (deleteDayError) throw deleteDayError;
      }

      setAttendanceModalOpen(false);
      setAttendanceModalDay(null);
      setAttendanceDraft({});
      setAttendanceSaving(false);
      await recordAuditEvent({
        actionType: "delete",
        entityType: "attendance_day",
        entityId: `${activeSchoolId}:all`,
        summary: "Cleared all attendance data.",
        metadata: {
          school_id: activeSchoolId,
          attendance_day_count: dayIds.length,
        },
      });
      setAttendanceMsg("Cleared all attendance data.");
      fetchAttendanceDays();
    } catch (error) {
      console.error("clear attendance values error:", error);
      setAttendanceMsg(`Clear failed: ${error.message || error}`);
    } finally {
      setAttendanceClearing(false);
    }
  }

  async function hasDuplicateSessionTitle(title, excludeId = "") {
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
  }

  function applySourceSessionToForm(session, setForm) {
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
  }

  function applyDailyRetakeSourceSession(session) {
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
  }

  function openModelConductModal(mode = "normal") {
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
  }

  function openDailyConductModal(mode = "normal") {
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
  }

  function selectModelRetakeSource(sessionId) {
    setModelRetakeSourceId(sessionId);
    const source = pastModelSessions.find((session) => session.id === sessionId);
    if (source) applySourceSessionToForm(source, setTestSessionForm);
  }

  function selectDailyRetakeSource(sessionId) {
    setDailySourceCategoryDropdownOpen(false);
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    setDailyRetakeSourceId(sessionId);
    const source = dailyRetakeSessions.find((session) => session.id === sessionId);
    if (source) applyDailyRetakeSourceSession(source);
  }

  function toggleDailySourceCategorySelection(categoryName) {
    const normalizedName = String(categoryName ?? "").trim();
    if (!normalizedName) return;
    const currentlySelected = selectedDailySourceCategoryNames;
    const isSelected = currentlySelected.includes(normalizedName);

    if (isSelected) {
      if (currentlySelected.length <= 1) return;
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
  }

  function toggleDailyProblemSetSelection(problemSetId) {
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
  }

  function updateDailySessionTimePart(field, part, value) {
    setDailySessionForm((current) => {
      const nextParts = {
        ...getTwelveHourTimeParts(current[field]),
        [part]: value,
      };
      return {
        ...current,
        [field]: buildTwentyFourHourTime(nextParts),
      };
    });
  }

  function updateModelSessionTimePart(field, part, value) {
    setTestSessionForm((current) => {
      const nextParts = {
        ...getTwelveHourTimeParts(current[field]),
        [part]: value,
      };
      return {
        ...current,
        [field]: buildTwentyFourHourTime(nextParts),
      };
    });
  }

  function buildGeneratedDailySessionTitle({ category, setIds, sessionDate, startTime }) {
    const normalizedCategory = String(category ?? "").trim() || "Daily Test";
    const normalizedDate = String(sessionDate ?? "").trim() || new Date().toISOString().slice(0, 10);
    const normalizedTime = String(startTime ?? "").trim() || "00:00";
    if ((setIds ?? []).length <= 1) {
      return `${normalizedCategory} ${setIds[0] ?? "Session"} ${normalizedDate} ${normalizedTime}`;
    }
    return `${normalizedCategory} ${setIds.length} Sets ${normalizedDate} ${normalizedTime}`;
  }

  async function materializeDailyProblemSet({
    sourceSetIds,
    category,
    questionCountMode,
    questionCount,
    passRate,
  }) {
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

    const selectedQuestions = shuffleList(orderedQuestions).slice(0, requestedQuestionCount);
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
  }

  async function createTestSession() {
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
    fetchExamLinks();
  }

  async function createDailySession() {
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
    fetchExamLinks();
  }

  function startEditSession(session) {
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
  }

  function cancelEditSession() {
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
  }

  async function saveSessionEdits() {
    if (!editingSessionId) return;
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
    fetchExamLinks();
    fetchTests();
  }

  async function deleteTestSession(id, options = {}) {
    if (!id) return;
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
    fetchExamLinks();
    if (options?.refreshResults && options?.type) {
      await runSearch(options.type);
    }
  }

  async function ensureTestRecord(testVersion, title, type, passRate, schoolId = activeSchoolId) {
    if (!schoolId) {
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
        return { ok: false, message: normalizeLegacyTestErrorMessage(updateError, "update") };
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
      return { ok: false, message: normalizeLegacyTestErrorMessage(insertError, "create") };
    }
    return { ok: true, existing: false };
  }

  async function fetchAssets() {
    setAssetsMsg("Loading...");
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
  }

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData?.session?.access_token ?? null;
    const expiresAt = sessionData?.session?.expires_at ?? 0;
    if (!accessToken || expiresAt * 1000 < Date.now() + 60_000) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        accessToken = refreshed?.session?.access_token ?? null;
      }
    }
    return accessToken;
  }

  async function recordAuditEvent({
    actionType,
    entityType,
    entityId,
    summary,
    metadata = {},
    schoolId = activeSchoolId,
  }) {
    if (!supabase || !actionType || !entityType || !entityId || !summary) return;
    const accessToken = await getAccessToken();
    if (!accessToken) return;
    const { error } = await supabase.functions.invoke("record-audit-log", {
      body: {
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        school_id: schoolId,
        metadata: {
          summary,
          ...metadata,
        },
      },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("record-audit-log error:", error);
    }
  }

  async function openPreview(testVersion) {
    setPreviewOpen(true);
    setPreviewTest(testVersion);
    setPreviewSession(null);
    setPreviewReplacementPool([]);
    setPreviewReplacementDrafts({});
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("");
    setPreviewAnswers({});
    setPreviewMsg("Loading...");
    const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, testVersion);
    if (error) {
      console.error("preview questions error:", error);
      setPreviewQuestions([]);
      setPreviewMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = (data ?? []).map(mapDbQuestion);
    setPreviewQuestions(list);
    setPreviewMsg(list.length ? "" : "No questions.");
  }

  async function openSessionPreview(session) {
    if (!session?.problem_set_id) return;
    setPreviewOpen(true);
    setPreviewSession(session);
    setPreviewTest(session.title || session.problem_set_id);
    setPreviewReplacementPool([]);
    setPreviewReplacementDrafts({});
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("");
    setPreviewAnswers({});
    setPreviewMsg("Loading...");

    const { data, error } = await fetchQuestionsForVersionWithFallback(supabase, session.problem_set_id);
    if (error) {
      console.error("session preview questions error:", error);
      setPreviewQuestions([]);
      setPreviewMsg(`Load failed: ${error.message}`);
      return;
    }

    const list = (data ?? []).map(mapDbQuestion);
    setPreviewQuestions(list);
    setPreviewMsg(list.length ? "" : "No questions.");

    if (!isGeneratedDailySessionVersion(session.problem_set_id)) {
      return;
    }

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
      const mapped = mapDbQuestion(row);
      return {
        ...mapped,
        sourceVersion: row.test_version,
        sourceQuestionId: row.question_id,
      };
    });
    setPreviewReplacementPool(replacementPool);
  }

  function closePreview() {
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
  }

  function renderPreviewQuestionCard(question, index) {
    const activeSourceKeys = new Set(
      previewQuestions
        .map((item) => buildSourceQuestionKey(item.sourceVersion, item.sourceQuestionId))
        .filter((key) => key !== "::")
    );
    const currentSourceKey = buildSourceQuestionKey(question.sourceVersion, question.sourceQuestionId);
    activeSourceKeys.delete(currentSourceKey);
    const replacementOptions = previewReplacementPool.filter((candidate) => {
      const candidateKey = buildSourceQuestionKey(
        candidate.sourceVersion || candidate.testVersion,
        candidate.sourceQuestionId || candidate.questionId
      );
      return candidateKey !== currentSourceKey && !activeSourceKeys.has(candidateKey);
    });
    const canReplace = Boolean(
      previewSession
      && isGeneratedDailySessionVersion(previewSession.problem_set_id)
      && replacementOptions.length
      && question.dbId
    );

    return (
      <QuestionPreviewCard key={`${question.id}-${index}`} question={question} index={index}>
        {canReplace ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={previewReplacementDrafts[question.dbId] ?? ""}
              onChange={(e) =>
                setPreviewReplacementDrafts((current) => ({
                  ...current,
                  [question.dbId]: e.target.value,
                }))
              }
              style={{ minWidth: 260 }}
            >
              <option value="">Replace with...</option>
              {replacementOptions.map((candidate) => {
                const candidateKey = buildSourceQuestionKey(
                  candidate.sourceVersion || candidate.testVersion,
                  candidate.sourceQuestionId || candidate.questionId
                );
                return (
                  <option key={`${question.dbId}-${candidateKey}`} value={candidateKey}>
                    {(candidate.sourceVersion || candidate.testVersion)} / {(candidate.sourceQuestionId || candidate.questionId)}
                  </option>
                );
              })}
            </select>
            <button
              className="btn"
              type="button"
              disabled={previewReplacementSavingId === question.dbId}
              onClick={() => replacePreviewQuestion(question.dbId)}
            >
              {previewReplacementSavingId === question.dbId ? "Replacing..." : "Replace Question"}
            </button>
          </div>
        ) : null}
      </QuestionPreviewCard>
    );
  }

  async function replacePreviewQuestion(targetDbId) {
    if (!previewSession?.problem_set_id || !targetDbId) return;
    const nextKey = previewReplacementDrafts[targetDbId];
    if (!nextKey) {
      setPreviewReplacementMsg("Choose a replacement question first.");
      return;
    }

    const targetQuestion = previewQuestions.find((question) => question.dbId === targetDbId);
    const sourceQuestion = previewReplacementPool.find((question) =>
      buildSourceQuestionKey(question.sourceVersion || question.testVersion, question.sourceQuestionId || question.questionId) === nextKey
    );
    if (!targetQuestion || !sourceQuestion?.dbId) {
      setPreviewReplacementMsg("Replacement question was not found.");
      return;
    }

    setPreviewReplacementSavingId(targetDbId);
    setPreviewReplacementMsg("");

    const { data: sourceChoices, error: sourceChoicesError } = await supabase
      .from("choices")
      .select("part_index, choice_index, label, choice_image")
      .eq("question_id", sourceQuestion.dbId);
    if (sourceChoicesError) {
      console.error("replacement choices fetch error:", sourceChoicesError);
      setPreviewReplacementMsg(`Replacement load failed: ${sourceChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextData = {
      ...(sourceQuestion.rawData ?? {}),
      itemId: targetQuestion.id,
      sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
      sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
    };

    const { error: updateQuestionError } = await supabase
      .from("questions")
      .update({
        section_key: sourceQuestion.sectionKey,
        type: sourceQuestion.type,
        prompt_en: sourceQuestion.promptEn ?? null,
        prompt_bn: sourceQuestion.promptBn ?? null,
        answer_index: sourceQuestion.answerIndex,
        data: nextData,
      })
      .eq("id", targetDbId);
    if (updateQuestionError) {
      console.error("replacement question update error:", updateQuestionError);
      setPreviewReplacementMsg(`Replace failed: ${updateQuestionError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const { error: deleteChoicesError } = await supabase
      .from("choices")
      .delete()
      .eq("question_id", targetDbId);
    if (deleteChoicesError) {
      console.error("replacement delete choices error:", deleteChoicesError);
      setPreviewReplacementMsg(`Replace failed: ${deleteChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextChoices = (sourceChoices ?? []).map((choice) => ({
      question_id: targetDbId,
      part_index: choice.part_index ?? null,
      choice_index: choice.choice_index,
      label: choice.label,
      choice_image: choice.choice_image,
    }));
    if (nextChoices.length) {
      const { error: insertChoicesError } = await supabase.from("choices").insert(nextChoices);
      if (insertChoicesError) {
        console.error("replacement insert choices error:", insertChoicesError);
        setPreviewReplacementMsg(`Replace failed: ${insertChoicesError.message}`);
        setPreviewReplacementSavingId("");
        return;
      }
    }

    setPreviewQuestions((current) => current.map((question) => {
      if (question.dbId !== targetDbId) return question;
      return {
        ...sourceQuestion,
        dbId: question.dbId,
        id: question.id,
        questionId: question.questionId,
        orderIndex: question.orderIndex,
        rawData: nextData,
        sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
        sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
      };
    }));
    setPreviewReplacementDrafts((current) => ({ ...current, [targetDbId]: "" }));
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("Question replaced.");
  }

  async function deleteTest(testVersion) {
    if (!testVersion) return;
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
  }

  async function deleteAttempt(attemptId) {
    if (!attemptId) return;
    const ok = window.confirm(`Delete attempt ${attemptId}?`);
    if (!ok) return;
    const { error } = await supabase.from("attempts").delete().eq("id", attemptId);
    if (error) {
      console.error("delete attempt error:", error);
      setMsg(`Delete failed: ${error.message}`);
      setStudentAttemptsMsg(`Delete failed: ${error.message}`);
      return;
    }
    setAttempts((prev) => prev.filter((attempt) => attempt.id !== attemptId));
    setStudentAttempts((prev) => prev.filter((attempt) => attempt.id !== attemptId));
    if (selectedAttemptObj?.id === attemptId || selectedId === attemptId) {
      setAttemptDetailOpen(false);
      setSelectedAttemptObj(null);
      setAttemptDetailSource("default");
      setSelectedId(null);
    }
    if (selectedId === attemptId) setSelectedId(null);
    setMsg(`Deleted: ${attemptId}`);
    setStudentAttemptsMsg(`Deleted: ${attemptId}`);
    if (selectedStudentId) {
      fetchStudentAttempts(selectedStudentId);
    }
    runSearch();
  }

  function getAttemptTitle(attempt) {
    if (!attempt) return "";
    const importedTitle = String(attempt?.answers_json?.__meta?.imported_test_title ?? "").trim();
    if (isImportedResultsSummaryAttempt(attempt) && importedTitle) return importedTitle;
    if (attempt.test_session_id) {
      const session = testSessionsById.get(attempt.test_session_id);
      if (session?.title) return session.title;
    }
    return getProblemSetTitle(attempt.test_version, tests);
  }

  function getAttemptDisplayDateValue(attempt) {
    if (!attempt) return "";
    const importedDate = String(
      attempt?.answers_json?.__meta?.imported_test_date
      ?? attempt?.answers_json?.__meta?.imported_date_iso
      ?? ""
    ).trim();
    if (importedDate) return importedDate;
    const session = attempt?.test_session_id ? testSessionsById.get(attempt.test_session_id) : null;
    return session?.starts_at || session?.ends_at || attempt?.ended_at || attempt?.started_at || attempt?.created_at || "";
  }

  function getAttemptDisplayTimestamp(attempt) {
    const value = getAttemptDisplayDateValue(attempt);
    if (!value) return getRowTimestamp(attempt);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const time = new Date(`${value}T00:00:00`).getTime();
      return Number.isFinite(time) ? time : getRowTimestamp(attempt);
    }
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : getRowTimestamp(attempt);
  }

  function isAttemptUsingCategoryTitle(attempt) {
    const category = normalizeLookupValue(testMetaByVersion[attempt?.test_version]?.category || DEFAULT_MODEL_CATEGORY);
    const title = normalizeLookupValue(getAttemptTitle(attempt));
    return Boolean(category && title && category === title);
  }

  function setPreviewAnswer(questionId, choiceIndex) {
    setPreviewAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  }

  function setPreviewPartAnswer(questionId, partIndex, choiceIndex) {
    setPreviewAnswers((prev) => {
      const cur = prev[questionId] ?? {};
      const next = Array.isArray(cur.partAnswers) ? [...cur.partAnswers] : [];
      next[partIndex] = choiceIndex;
      return { ...prev, [questionId]: { partAnswers: next } };
    });
  }

  async function inviteStudents(payload) {
    setCsvMsg("");
    setStudentMsg("");
    setInviteResults([]);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setStudentMsg("Session expired. Please log in again.");
      return false;
    }
    const { data, error } = await supabase.functions.invoke("invite-students", {
      body: activeSchoolId ? { ...payload, school_id: activeSchoolId } : payload,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("invite-students error:", error);
      setStudentMsg(`Create failed: ${error.message}`);
      return false;
    }
    const results = data?.results ?? [];
    setInviteResults(results);
    const okCount = results.filter((r) => r.ok).length;
    const ngCount = results.length - okCount;
    setStudentTempMap((prev) => {
      const next = { ...prev };
      results.forEach((r) => {
        if (r.ok && r.user_id && r.temp_password) {
          next[r.user_id] = r.temp_password;
        }
      });
      return next;
    });
    setStudentMsg(`Created: ${okCount} ok / ${ngCount} failed`);
    if (okCount > 0) {
      await recordAuditEvent({
        actionType: "invite",
        entityType: "student",
        entityId: activeSchoolId || "student-invite",
        summary: `Invited ${okCount} student${okCount === 1 ? "" : "s"}${ngCount ? ` (${ngCount} failed)` : ""}.`,
        metadata: {
          success_count: okCount,
          failed_count: ngCount,
        },
      });
    }
    fetchStudents();
    return okCount > 0;
  }

  async function reissueTempPassword(student, tempPasswordInput) {
    if (!student?.id) return;
    setStudentMsg("");
    setReissueMsg("Generating new pass...");
    setReissueLoading(true);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setReissueMsg("Session expired. Please log in again.");
      setReissueLoading(false);
      return;
    }
    const body = { user_id: student.id, email: student.email, school_id: activeSchoolId };
    if (tempPasswordInput) body.temp_password = tempPasswordInput;
    const { data, error } = await supabase.functions.invoke("reissue-temp-password", {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("reissue-temp-password error:", error);
      setReissueMsg(`Reissue failed: ${error.message}`);
      setReissueLoading(false);
      return;
    }
    if (data?.error) {
      setReissueMsg(`Reissue failed: ${data.error}`);
      setReissueLoading(false);
      return;
    }
    const tempPassword = data?.temp_password ?? "";
    if (tempPassword) {
      setStudentTempMap((prev) => ({ ...prev, [student.id]: tempPassword }));
    }
    setReissueIssuedPassword(tempPassword);
    setReissueMsg("");
    setReissueLoading(false);
    setStudentMsg(`Reissued temp password for ${student.email || student.id}`);
  }

  function closeReissueModal() {
    setReissueOpen(false);
    setReissueStudent(null);
    setReissuePassword("");
    setReissueIssuedPassword("");
    setReissueLoading(false);
    setReissueMsg("");
  }

  async function deleteStudent(userId, email) {
    if (!userId) return;
    const ok = window.confirm(`Delete student ${email || userId}?`);
    if (!ok) return;
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setStudentMsg("Session expired. Please log in again.");
      return;
    }
    const { data, error } = await supabase.functions.invoke("delete-student", {
      body: { user_id: userId, school_id: activeSchoolId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("delete-student error:", error);
      setStudentMsg(`Delete failed: ${error.message}`);
      return;
    }
    if (data?.error) {
      setStudentMsg(`Delete failed: ${data.error}`);
      return;
    }
    if (selectedStudentId === userId) {
      setStudentDetailOpen(false);
      setSelectedStudentId("");
      setSelectedStudentDetail(null);
    }
    setStudentMsg(`Deleted: ${email || userId}`);
    fetchStudents();
  }

  async function exportStudentReportPdf() {
    if (!selectedStudentId || !selectedStudent || typeof window === "undefined") return;
    const detailedStudent = hasStudentDetailFields(selectedStudent)
      ? selectedStudent
      : await fetchStudentDetail(selectedStudentId, { force: true });
    if (!detailedStudent) {
      setStudentMsg("Student details failed to load. Please try again.");
      return;
    }
    const reportWindow = window.open("", "_blank", "width=1200,height=900");
    if (!reportWindow) {
      setStudentMsg("Popup blocked. Please allow popups and try again.");
      return;
    }

    setStudentReportExporting(true);
    setStudentMsg("");
    reportWindow.document.write("<!doctype html><html><head><title>Preparing report...</title></head><body style=\"font-family: Arial, sans-serif; padding: 24px;\">Preparing student report...</body></html>");
    reportWindow.document.close();

    try {
      const [attemptResult, attendanceList] = await Promise.all([
        fetchStudentAttempts(selectedStudentId),
        fetchStudentAttendance(selectedStudentId),
      ]);

      const attemptsList = attemptResult?.list ?? [];
      const questionMap = { ...(attemptQuestionsByVersion ?? {}), ...(attemptResult?.hydratedQuestions ?? {}) };
      const rankMap = attemptResult?.rankMap ?? {};
      const attendanceRows = attendanceList ?? [];
      const attendanceSummaryData = buildAttendanceSummary(attendanceRows);

      const modelAttempts = attemptsList.filter((attempt) => testMetaByVersion[attempt.test_version]?.type === "mock");
      const dailyAttempts = attemptsList.filter((attempt) => testMetaByVersion[attempt.test_version]?.type !== "mock");

      const modelGrouped = new Map();
      modelAttempts.forEach((attempt) => {
        const category = testMetaByVersion[attempt.test_version]?.category || DEFAULT_MODEL_CATEGORY;
        if (!modelGrouped.has(category)) modelGrouped.set(category, []);
        modelGrouped.get(category).push(attempt);
      });
      const modelAttemptsByCategory = [];
      modelCategories.forEach((category) => {
        if (modelGrouped.has(category.name)) modelAttemptsByCategory.push([category.name, modelGrouped.get(category.name)]);
      });
      for (const entry of modelGrouped.entries()) {
        if (!modelAttemptsByCategory.some((item) => item[0] === entry[0])) modelAttemptsByCategory.push(entry);
      }

      const dailyGrouped = new Map();
      dailyAttempts.forEach((attempt) => {
        const category = testMetaByVersion[attempt.test_version]?.category || "Uncategorized";
        if (!dailyGrouped.has(category)) dailyGrouped.set(category, []);
        dailyGrouped.get(category).push(attempt);
      });
      const dailyAttemptsByCategory = [];
      dailyCategories.forEach((category) => {
        if (dailyGrouped.has(category.name)) dailyAttemptsByCategory.push([category.name, dailyGrouped.get(category.name)]);
      });
      for (const entry of dailyGrouped.entries()) {
        if (!dailyAttemptsByCategory.some((item) => item[0] === entry[0])) dailyAttemptsByCategory.push(entry);
      }

      const modelSummaryByAttemptId = {};
      modelAttempts.forEach((attempt) => {
        const list = questionMap[attempt.test_version];
        if (!list) return;
        const rows = buildAttemptDetailRowsFromList(attempt.answers_json, list);
        const summary = buildMainSectionSummary(rows);
        const bySection = {};
        summary.forEach((item) => {
          bySection[item.section ?? item.mainSection] = item;
        });
        modelSummaryByAttemptId[attempt.id] = bySection;
      });
      const modelSectionTitles = [...sectionTitles];

      const uploadMap = getProfileUploads(detailedStudent.profile_uploads);
      const personalInfoRows = [
        { label: "Full Name", value: detailedStudent.display_name || "-" },
        { label: "Email", value: detailedStudent.email || "-" },
        { label: "Student No.", value: detailedStudent.student_code || "-" },
        { label: "Phone Number", value: detailedStudent.phone_number || "-" },
        {
          label: "Date of Birth",
          value: detailedStudent.date_of_birth
            ? `${formatDateFull(detailedStudent.date_of_birth)}${calculateAge(detailedStudent.date_of_birth) != null ? ` / Age ${calculateAge(detailedStudent.date_of_birth)}` : ""}`
            : "-",
        },
        { label: "Sex", value: detailedStudent.sex || "-" },
        { label: "Current Working Facility", value: detailedStudent.current_working_facility || "-" },
        { label: "Years of Experience", value: formatYearsOfExperience(detailedStudent.years_of_experience) || "-" },
        { label: "Nursing Certificate", value: detailedStudent.nursing_certificate || "-" },
        { label: "Certificate Status", value: detailedStudent.nursing_certificate_status || "-" },
        { label: "BNMC Registration Number", value: detailedStudent.bnmc_registration_number || "-" },
        {
          label: "BNMC Registration Expiry Date",
          value: detailedStudent.bnmc_registration_expiry_date ? formatDateFull(detailedStudent.bnmc_registration_expiry_date) : "-",
        },
        { label: "Passport Number", value: detailedStudent.passport_number || "-" },
        ...PERSONAL_UPLOAD_FIELDS.map((field) => {
          const asset = uploadMap[field.key];
          const url = String(asset?.url ?? "").trim();
          const name = String(asset?.name ?? field.label ?? "").trim();
          const isImage = isImageUpload(asset);
          const imageHtml = isImage
            ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name || field.label)}" style="display:block;max-width:220px;max-height:220px;border:1px solid #cbd5e1;" />`
            : "";
          return {
            label: field.label,
            value: url
              ? isImage
                ? imageHtml
                : `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(name || url)}</a>`
              : "-",
            isHtml: true,
          };
        }),
      ];

      const formatPercent = (value, digits = 1) => {
        const num = Number(value);
        return Number.isFinite(num) ? `${num.toFixed(digits)}%` : "N/A";
      };

      const buildCategorySummaryRowsForExport = (groups) => {
        return (groups ?? []).map(([category, attemptsForCategory]) => {
          const attempts = attemptsForCategory ?? [];
          const count = attempts.length;
          const passCount = attempts.filter((attempt) => {
            const passRate = getAttemptEffectivePassRate(attempt);
            return getScoreRate(attempt) >= passRate;
          }).length;
          const failCount = Math.max(0, count - passCount);
          const totalCorrect = attempts.reduce((sum, attempt) => sum + Number(attempt.correct ?? 0), 0);
          const totalQuestions = attempts.reduce((sum, attempt) => sum + Number(attempt.total ?? 0), 0);
          const avgCorrect = count ? totalCorrect / count : 0;
          const avgTotal = count ? totalQuestions / count : 0;
          const avgRate = count ? attempts.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / count : 0;
          return [
            escapeHtml(category),
            escapeHtml(count ? `${avgCorrect.toFixed(1)}/${avgTotal.toFixed(1)}` : "-"),
            escapeHtml(count ? `${(avgRate * 100).toFixed(1)}%` : "-"),
            escapeHtml(passCount),
            escapeHtml(failCount),
          ];
        });
      };

      const renderTable = (headers, rows, options = {}) => {
        if (!rows.length) {
          return `<div class="report-empty">${escapeHtml(options.emptyText || "No records found.")}</div>`;
        }
        return `
          <div class="report-table-wrap">
            <table class="report-table">
              <thead>
                <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${rows.map((row) => `
                  <tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;
      };

      const personalInfoTable = renderTable(
        ["Field", "Value"],
        personalInfoRows.map((row) => [
          escapeHtml(row.label),
          row.isHtml ? row.value : escapeHtml(row.value),
        ]),
        { emptyText: "No personal information found." }
      );

      const attendanceSummaryTable = renderTable(
        ["Metric", "Overall", ...attendanceSummaryData.months.map((month) => escapeHtml(month.label))],
        [
          [
            "Attendance Rate",
            escapeHtml(formatPercent(attendanceSummaryData.overall.rate, 2)),
            ...attendanceSummaryData.months.map((month) => escapeHtml(formatPercent(month.stats.rate, 2))),
          ],
          [
            "Total Days",
            escapeHtml(attendanceSummaryData.overall.total || "-"),
            ...attendanceSummaryData.months.map((month) => escapeHtml(month.stats.total || "-")),
          ],
          [
            "Present (P)",
            escapeHtml(attendanceSummaryData.overall.present || "-"),
            ...attendanceSummaryData.months.map((month) => escapeHtml(month.stats.present || "-")),
          ],
          [
            "Late / Left Early (L)",
            escapeHtml(attendanceSummaryData.overall.late || "-"),
            ...attendanceSummaryData.months.map((month) => escapeHtml(month.stats.late || "-")),
          ],
          [
            "Excused Absence (E)",
            escapeHtml(attendanceSummaryData.overall.excused || "-"),
            ...attendanceSummaryData.months.map((month) => escapeHtml(month.stats.excused || "-")),
          ],
          [
            "Unexcused Absence (A)",
            escapeHtml(attendanceSummaryData.overall.unexcused || "-"),
            ...attendanceSummaryData.months.map((month) => escapeHtml(month.stats.unexcused || "-")),
          ],
        ]
      );

      const attendanceDetailTable = renderTable(
        ["Date", "Weekday", "Status", "Comment"],
        attendanceRows.map((row) => [
          escapeHtml(formatDateFull(row.day_date) || "-"),
          escapeHtml(formatWeekday(row.day_date) || "-"),
          escapeHtml(row.status || "-"),
          escapeHtml(row.comment || "-"),
        ]),
        { emptyText: "No attendance records." }
      );

      const dailySummaryTable = renderTable(
        ["Category", "Average Score", "Average Rate", "Pass", "Fail"],
        buildCategorySummaryRowsForExport(dailyAttemptsByCategory),
        { emptyText: "No daily test records." }
      );

      const modelSummaryTable = renderTable(
        ["Category", "Average Score", "Average Rate", "Pass", "Fail"],
        buildCategorySummaryRowsForExport(modelAttemptsByCategory),
        { emptyText: "No model test records." }
      );

      const dailyResultsHtml = dailyAttemptsByCategory.length
        ? dailyAttemptsByCategory.map(([category, items]) => `
            <section class="report-subsection">
              <h3>${escapeHtml(category)}</h3>
              ${renderTable(
                ["Test", "Date", "Score", "Rate", "P/F"],
                items.map((attempt) => {
                  const passRate = getAttemptEffectivePassRate(attempt);
                  const passed = getScoreRate(attempt) >= passRate;
                  return [
                    escapeHtml(getAttemptTitle(attempt) || "-"),
                    escapeHtml(formatDateFull(attempt.created_at) || "-"),
                    escapeHtml(`${attempt.correct}/${attempt.total}`),
                    escapeHtml(formatPercent(getScoreRate(attempt) * 100, 1)),
                    escapeHtml(passed ? "Pass" : "Fail"),
                  ];
                }),
                { emptyText: "No daily test records." }
              )}
            </section>
          `).join("")
        : `<div class="report-empty">No daily test records.</div>`;

      const modelResultsHtml = renderTable(
        [
          "Test",
          "Date",
          "Total Score",
          "Rate",
          "P/F",
          "Class Rank",
          ...modelSectionTitles.map((title) => escapeHtml(title)),
        ],
        modelAttempts.map((attempt) => {
          const passRate = getAttemptEffectivePassRate(attempt);
          const passed = getScoreRate(attempt) >= passRate;
          const rankInfo = rankMap[attempt.id];
          const summary = modelSummaryByAttemptId[attempt.id] || {};
          return [
            escapeHtml(getAttemptTitle(attempt) || "-"),
            escapeHtml(formatDateFull(attempt.created_at) || "-"),
            escapeHtml(`${attempt.correct}/${attempt.total}`),
            escapeHtml(formatPercent(getScoreRate(attempt) * 100, 1)),
            escapeHtml(passed ? "Pass" : "Fail"),
            escapeHtml(rankInfo ? `${rankInfo.rank}/${rankInfo.total}` : "-"),
            ...modelSectionTitles.map((title) => {
              const section = summary[title];
              return escapeHtml(section ? `${section.correct}/${section.total}` : "-");
            }),
          ];
        }),
        { emptyText: "No model test records." }
      );

      const reportTitle = `${selectedStudent.display_name || selectedStudent.email || "Student"} - Student Report`;
      const html = `
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(reportTitle)}</title>
            <style>
              @page { size: A4 portrait; margin: 14mm; }
              body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
              .report { padding: 0; }
              .report-header { margin-bottom: 18px; border-bottom: 2px solid #cbd5e1; padding-bottom: 10px; }
              .report-title { font-size: 24px; font-weight: 800; margin: 0 0 6px; }
              .report-meta { font-size: 12px; color: #475569; margin: 2px 0; }
              .report-section { margin-top: 18px; }
              .report-section h2 { font-size: 17px; margin: 0 0 8px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }
              .report-subsection { margin-top: 14px; }
              .report-subsection h3 { font-size: 14px; margin: 0 0 8px; }
              .report-table-wrap { width: 100%; overflow: hidden; }
              .report-table { width: 100%; border-collapse: collapse; table-layout: auto; }
              .report-table th, .report-table td {
                border: 1px solid #cbd5e1;
                padding: 6px 8px;
                font-size: 11px;
                vertical-align: top;
                text-align: left;
                word-break: break-word;
              }
              .report-table th { background: #e2e8f0; font-weight: 800; }
              .report-empty { border: 1px dashed #cbd5e1; padding: 10px; font-size: 12px; color: #64748b; }
              .page-break { break-before: page; page-break-before: always; }
              a { color: #0f766e; text-decoration: none; }
            </style>
          </head>
          <body>
            <div class="report">
              <div class="report-header">
                <div class="report-title">${escapeHtml(reportTitle)}</div>
                <div class="report-meta">Student No.: ${escapeHtml(selectedStudent.student_code || "-")}</div>
                <div class="report-meta">Email: ${escapeHtml(selectedStudent.email || "-")}</div>
                <div class="report-meta">Generated: ${escapeHtml(new Date().toLocaleString())}</div>
              </div>

              <section class="report-section">
                <h2>Personal Information</h2>
                ${personalInfoTable}
              </section>

              <section class="report-section">
                <h2>Attendance Summary</h2>
                ${attendanceSummaryTable}
              </section>

              <section class="report-section">
                <h2>Daily Test Results</h2>
                ${dailySummaryTable}
                <div style="height: 10px;"></div>
                ${dailyResultsHtml}
              </section>

              <section class="report-section">
                <h2>Model Test Results</h2>
                ${modelSummaryTable}
                <div style="height: 10px;"></div>
                ${modelResultsHtml}
              </section>

              <section class="report-section page-break">
                <h2>Attendance Details</h2>
                ${attendanceDetailTable}
              </section>
            </div>
            <script>
              window.onload = function () {
                setTimeout(function () {
                  window.focus();
                  window.print();
                }, 300);
              };
            </script>
          </body>
        </html>
      `;

      reportWindow.document.open();
      reportWindow.document.write(html);
      reportWindow.document.close();
    } catch (error) {
      console.error("student report export error:", error);
      setStudentMsg(`Export failed: ${error?.message || error}`);
      reportWindow.close();
    } finally {
      setStudentReportExporting(false);
    }
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length === 0) return [];
    const header = lines[0].split(",").map((s) => s.trim());
    const idxEmail = header.indexOf("email");
    const idxName = header.indexOf("display_name");
    const idxCode = header.indexOf("student_code");
    const idxPass = header.indexOf("temp_password");
    if (idxEmail === -1) throw new Error("CSV must include 'email' header");
    const out = [];
    const safeCell = (row, idx) => (idx === -1 ? "" : String(row[idx] ?? "").trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const tempPassword = safeCell(cols, idxPass);
      out.push({
        email: safeCell(cols, idxEmail),
        display_name: safeCell(cols, idxName),
        student_code: safeCell(cols, idxCode),
        temp_password: tempPassword,
      });
    }
    return out.filter((r) => r.email);
  }

  function getAssetTypeByExt(filename) {
    const ext = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
    if (ext === "csv") return "csv";
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
    if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
    return "file";
  }

  async function uploadSingleAsset(file, testVersion, type, schoolId = activeSchoolId) {
    if (!schoolId) {
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
  }

  async function validateCsvAssetsBeforeUpload({
    csvFile,
    uploadFiles,
    testVersion,
    parseCsv,
    missingVersionMessage,
    isCsvLike,
    onResolvedVersion,
    allowMultipleVersions = false,
  }) {
    if (!csvFile) {
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
  }

  async function uploadAssets() {
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

    await importQuestionsFromCsv();

    setAssetFile(null);
    setAssetFiles([]);
  }

  async function importQuestionsFromCsv() {
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
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("Only CSV is supported.");
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
  }

  async function uploadDailyAssets() {
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

    await importDailyQuestionsFromCsv();

    setDailyFile(null);
    setDailyFiles([]);
  }

  async function importDailyQuestionsFromCsv() {
    setDailyImportMsg("");
    if (!activeSchoolId) {
      setDailyImportMsg("School scope is required.");
      return;
    }
    const file = dailyCsvFile || dailyFile;
    const category = dailyForm.category.trim();
    const type = "daily";

    if (!file) {
      setDailyImportMsg("CSV file is required.");
      return;
    }
    const isCsvLike = (name) => {
      const lower = String(name ?? "").toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".tsv");
    };
    if (!isCsvLike(file.name)) {
      setDailyImportMsg("CSV file is required.");
      return;
    }

    setDailyImportMsg("Parsing...");
    const text = await file.text();
    const { questions, choices, errors } = parseDailyCsv(text, "");
    if (errors.length) {
      setDailyImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setDailyImportMsg("No questions found.");
      return;
    }
    const groupedByVersion = groupParsedCsvByVersion(questions, choices);
    const versions = Array.from(groupedByVersion.keys());
    if (!versions.length) {
      setDailyImportMsg("set_id is required in the CSV.");
      return;
    }

    setDailyImportMsg("Resolving assets...");
    let totalQuestions = 0;
    let totalChoiceRows = 0;

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
        console.error("daily assets fetch error:", assetErr);
        setDailyImportMsg(`Asset lookup failed: ${assetErr.message}`);
        return;
      }
      const assetMap = {};
      for (const row of assetRows ?? []) {
        const name = row.original_name || row.path?.split("/").pop();
        if (name) assetMap[name] = resolveAdminAssetUrl(row.path);
      }
      const { missing, invalid } = validateAssetRefs(groupQuestions, groupChoices, assetMap);
      if (invalid.length) {
        setDailyImportMsg(`Invalid asset paths for ${version} (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
        return;
      }
      if (missing.length) {
        setDailyImportMsg(`Missing assets for ${version} (upload first):\n${missing.slice(0, 5).join("\n")}`);
        return;
      }
      applyAssetMap(groupQuestions, groupChoices, assetMap);

      const ensure = await ensureTestRecord(version, category || version, type, null, activeSchoolId);
      if (!ensure.ok) {
        setDailyImportMsg(ensure.message);
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
          console.error("daily questions cleanup error:", cleanupErr);
          setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
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
        console.error("daily questions upsert error:", qError);
        setDailyImportMsg(`Question upsert failed: ${qError.message}`);
        return;
      }

      const { data: qRows, error: qFetchErr } = await supabase
        .from("questions")
        .select("id, question_id")
        .eq("test_version", version)
        .in("question_id", questionIds);
      if (qFetchErr) {
        console.error("daily questions fetch error:", qFetchErr);
        setDailyImportMsg(`Question fetch failed: ${qFetchErr.message}`);
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
          console.error("daily choices delete error:", delErr);
          setDailyImportMsg(`Choice cleanup failed: ${delErr.message}`);
          return;
        }
      }

      if (choiceRows.length) {
        const { error: cErr } = await supabase.from("choices").insert(choiceRows);
        if (cErr) {
          console.error("daily choices insert error:", cErr);
          setDailyImportMsg(`Choice insert failed: ${cErr.message}`);
          return;
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
      summary: `Imported ${versions.length} daily set${versions.length === 1 ? "" : "s"}${category ? ` in ${category}` : ""}.`,
      metadata: {
        category: category || null,
        set_ids: versions,
        question_count: totalQuestions,
        choice_count: totalChoiceRows,
      },
    });
    fetchTests();
    setDailyCsvFile(null);
  }

  async function handleCsvFile(file) {
    setCsvMsg("");
    if (!file) return;
    const text = await file.text();
    let rows = [];
    try {
      rows = parseCsv(text);
    } catch (e) {
      setCsvMsg(String(e?.message ?? e));
      return;
    }
    if (rows.length === 0) {
      setCsvMsg("No rows.");
      return;
    }
    setCsvMsg(`Uploading ${rows.length} students...`);
    await inviteStudents({ students: rows });
    setCsvMsg("");
  }

  async function exportSummaryCsv(list) {
    const emailMap = await buildProfileEmailMap(supabase, list);
    const rows = [
      ["attempt_id", "created_at", "display_name", "student_code", "email", "test_version", "correct", "total", "score_rate", "tab_left_count"],
      ...list.map((a) => [
        a.id,
        a.created_at,
        a.display_name ?? "",
        a.student_code ?? "",
        emailMap[a.student_id] ?? "",
        a.test_version ?? "",
        a.correct ?? 0,
        a.total ?? 0,
        getScoreRate(a),
        getTabLeftCount(a)
      ])
    ];
    downloadText(`attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  function exportAttendanceGoogleSheetsCsv() {
    setAttendanceMsg("");
    if (!sortedStudents.length && !attendanceDayColumns.length) {
      setAttendanceMsg("No attendance data to export.");
      return;
    }

    const exportColumns = attendanceRangeColumns;
    const allColumns = attendanceDayColumns;
    const totalColumns = 10 + exportColumns.length;
    const rangeHeaderLabel = attendanceFilter.startDate && attendanceFilter.endDate
      ? `Attendance Rate from ${formatMonthDayCompact(attendanceFilter.startDate)} to ${formatMonthDayCompact(attendanceFilter.endDate)}`
      : attendanceFilter.startDate
        ? `Attendance Rate from ${formatMonthDayCompact(attendanceFilter.startDate)}`
        : attendanceFilter.endDate
          ? `Attendance Rate until ${formatMonthDayCompact(attendanceFilter.endDate)}`
          : "Attendance Rate (Selected Range)";

    const csvRows = [
      padCsvRow(
        [
          "",
          "vb/w",
          "Student Name",
          "Section",
          "Phone Number",
          "Email Address",
          "Attendance Rate",
          rangeHeaderLabel,
          "Unexcused Absence",
          "Withdrawn",
          ...exportColumns.map((day) => formatSlashDateShortYear(day.day_date)),
        ],
        totalColumns
      ),
      padCsvRow(
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          ...exportColumns.map((day) => formatWeekday(day.day_date)),
        ],
        totalColumns
      ),
      padCsvRow(
        [
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
      ...exportColumns.map((day) => {
            const statuses = sortedStudents
              .filter((student) => !isAnalyticsExcludedStudent(student))
              .map((student) => attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "")
              .filter((status) => status && status !== "W");
            const stats = buildAttendanceStats(statuses);
            return stats.rate == null ? "N/A" : formatRatePercent(stats.rate);
          }),
        ],
        totalColumns
      ),
    ];

    sortedStudents.forEach((student, index) => {
      const allStatuses = allColumns.map((day) => {
        const status = attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "";
        return status || (student.is_withdrawn ? "W" : "");
      });
      const rangeStatuses = exportColumns.map((day) => {
        const status = attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "";
        return status || (student.is_withdrawn ? "W" : "");
      });
      const overallStats = buildAttendanceStats(allStatuses);
      const rangeStats = buildAttendanceStats(rangeStatuses);
      csvRows.push(
        padCsvRow(
          [
            "",
            index + 1,
            getStudentDisplayName(student),
            getStudentSectionValue(student),
            student.phone_number ?? "",
            student.email ?? "",
            overallStats.rate == null ? "N/A" : formatRatePercent(overallStats.rate),
            rangeStats.rate == null ? "N/A" : formatRatePercent(rangeStats.rate),
            overallStats.unexcused ?? 0,
            formatBooleanCsv(student.is_withdrawn),
            ...rangeStatuses.map((status) => status || ""),
          ],
          totalColumns
        )
      );
    });

    csvRows.push(new Array(totalColumns).fill(""));
    csvRows.push(padCsvRow(["", "Rule"], totalColumns));
    ATTENDANCE_EXPORT_RULES.forEach((rule) => {
      csvRows.push(padCsvRow(["", rule], totalColumns));
    });

    downloadText(`attendance_google_sheets_${Date.now()}.csv`, toCsv(csvRows), "text/csv");
  }

  function exportDailyGoogleSheetsCsv() {
    setQuizMsg("");
    const sessions = dailyResultsMatrix.sessions ?? [];
    const matrixRows = dailyResultsMatrix.rows ?? [];
    if (!sessions.length) {
      setQuizMsg("No daily test sessions to export.");
      return;
    }

    const totalColumns = 5 + sessions.length;
    const visibleAttemptAt = (row, index) => row?.cells?.[index]?.[0] ?? null;
    const exportRows = [
      padCsvRow(
        ["", "No.", "Student Name", "Section", "Withdrawn", ...sessions.map((session) => session.title ?? session.problem_set_id ?? "")],
        totalColumns
      ),
      padCsvRow(
        ["", "", "", "", "", ...sessions.map((session) => formatSlashDateShortYear(session.starts_at || session.created_at))],
        totalColumns
      ),
      padCsvRow(
        [
          "",
          "",
          "",
          "",
          "",
          ...sessions.map((session, index) => {
            const attemptsForSession = matrixRows
              .filter((row) => !isAnalyticsExcludedStudent(row.student))
              .map((row) => visibleAttemptAt(row, index))
              .filter(Boolean);
            if (!attemptsForSession.length) return "-";
            const averageRate = attemptsForSession.reduce((sum, attempt) => sum + getScoreRate(attempt), 0) / attemptsForSession.length;
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
            ...sessions.map((session, sessionIndex) => {
              const attempt = visibleAttemptAt(row, sessionIndex);
              return attempt ? formatRatePercent(getScoreRate(attempt)) : "-";
            }),
          ],
          totalColumns
        )
      );
    });

    downloadText(`daily_results_google_sheets_${Date.now()}.csv`, toCsv(exportRows), "text/csv");
  }

  async function exportModelGoogleSheetsCsv() {
    setQuizMsg("");
    const sessions = modelResultsMatrix.sessions ?? [];
    const matrixRows = modelResultsMatrix.rows ?? [];
    if (!sessions.length) {
      setQuizMsg("No model test sessions to export.");
      return;
    }
    const versions = Array.from(new Set(sessions.map((session) => session.problem_set_id).filter(Boolean)));
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
        questionsByVersion[version].push(mapDbQuestion(row));
      }
    }

    const visibleAttemptAt = (row, index) => row?.cells?.[index]?.[0] ?? null;
    const activeMatrixRows = matrixRows.filter((row) => !isAnalyticsExcludedStudent(row.student));
    const sessionBlocks = sessions.map((session, sessionIndex) => {
      const title = String(session?.title ?? session?.problem_set_id ?? "").trim() || session?.problem_set_id || "";
      const questionsList = questionsByVersion[session.problem_set_id] ?? [];
      const baseRows = buildAttemptDetailRowsFromList({}, questionsList);
      const baseSummary = buildMainSectionSummary(baseRows);
      const blockSectionTitles = sections
        .filter((section) => section.key !== "DAILY")
        .map((section) => getSectionTitle(section.key))
        .filter((sectionTitle) => baseSummary.some((row) => row.section === sectionTitle));
      const sectionTotals = Object.fromEntries(
        blockSectionTitles.map((sectionTitle) => [
          sectionTitle,
          Number(baseSummary.find((row) => row.section === sectionTitle)?.total ?? 0),
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
          .map((attempt) => {
            const summary = buildMainSectionSummary(buildAttemptDetailRowsFromList(attempt.answers_json, block.questionsList));
            return summary.find((item) => item.section === sectionTitle) ?? null;
          })
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
      const totalQuestionCount = Number(block.questionsList?.length ?? 0);
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
        const sectionSummary = attempt
          ? buildMainSectionSummary(buildAttemptDetailRowsFromList(attempt.answers_json, block.questionsList))
          : [];
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
          attempt ? formatScoreFraction(Number(attempt.correct ?? 0), Number(attempt.total ?? 0), 0) : "-",
          attempt && ranking ? `${formatOrdinalRank(ranking.rank)} / ${ranking.total}` : "-"
        );
      });

      exportRows.push(padCsvRow(dataRow, totalColumns));
    });

    const buildModelFooterRows = (title, collectNames) => {
      const headerRow = ["", "", "", title, ""];
      const columns = [];
      sessionBlocks.forEach((block) => {
        block.sectionTitles.forEach((sectionTitle) => {
          headerRow.push(sectionTitle, "");
          columns.push(collectNames({ kind: "section", block, sectionTitle }));
        });
        headerRow.push("Total", "", "");
        columns.push(collectNames({ kind: "total", block, sectionTitle: "" }));
      });
      const rows = [padCsvRow(headerRow, totalColumns)];
      const maxRows = Math.max(0, ...columns.map((items) => items.length));
      for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
        const nextRow = ["", "", "", "", ""];
        let columnIndex = 0;
        sessionBlocks.forEach((block) => {
          block.sectionTitles.forEach(() => {
            nextRow.push(columns[columnIndex]?.[rowIndex] ?? "", "");
            columnIndex += 1;
          });
          nextRow.push(columns[columnIndex]?.[rowIndex] ?? "", "", "");
          columnIndex += 1;
        });
        rows.push(padCsvRow(nextRow, totalColumns));
      }
      return rows;
    };

    downloadText(`model_results_google_sheets_${Date.now()}.csv`, toCsv(exportRows), "text/csv");
  }

  async function fetchExistingImportedAttemptIdsForPairs(pairs) {
    const normalizedPairs = (pairs ?? []).filter((pair) => pair?.student_id && pair?.test_session_id);
    if (!normalizedPairs.length) {
      return { ids: [], error: null };
    }
    const sessionIds = Array.from(new Set(normalizedPairs.map((pair) => pair.test_session_id)));
    const studentIds = Array.from(new Set(normalizedPairs.map((pair) => pair.student_id)));
    const pairKeys = new Set(normalizedPairs.map((pair) => `${pair.student_id}::${pair.test_session_id}`));

    const deleteIds = [];
    for (const sessionIdChunk of chunkItems(sessionIds, IMPORTED_ATTEMPT_QUERY_BATCH_SIZE)) {
      const { data: existingRows, error: existingError } = await supabase
        .from("attempts")
        .select("id, answers_json, student_id, test_session_id")
        .in("test_session_id", sessionIdChunk)
        .in("student_id", studentIds);
      if (existingError) {
        return { ids: [], error: existingError };
      }
      deleteIds.push(
        ...(existingRows ?? [])
          .filter((row) => pairKeys.has(`${row.student_id}::${row.test_session_id}`))
          .filter((row) => isImportedSummaryAttempt(row))
          .map((row) => row.id)
      );
    }

    return {
      ids: Array.from(new Set(deleteIds)),
      error: null,
    };
  }

  async function deleteAttemptIdsInChunks(attemptIds) {
    for (const attemptIdChunk of chunkItems(attemptIds, IMPORTED_ATTEMPT_BATCH_SIZE)) {
      const { error } = await supabase.from("attempts").delete().in("id", attemptIdChunk);
      if (error) return error;
    }
    return null;
  }

  async function insertImportedAttemptPayloadChunk(payloadChunk) {
    let payloadsToInsert = payloadChunk;
    let { error: insertError } = await supabase.from("attempts").insert(payloadsToInsert);
    if (insertError && isMissingTabLeftCountError(insertError)) {
      payloadsToInsert = payloadsToInsert.map(({ tab_left_count, ...payload }) => payload);
      ({ error: insertError } = await supabase.from("attempts").insert(payloadsToInsert));
    }
    if (insertError && isGeneratedScoreRateInsertError(insertError)) {
      payloadsToInsert = payloadsToInsert.map(({ score_rate, ...payload }) => payload);
      ({ error: insertError } = await supabase.from("attempts").insert(payloadsToInsert));
    }
    return insertError ?? null;
  }

  async function removeImportedSummaryAttemptsForPairs(pairs) {
    const normalizedPairs = (pairs ?? []).filter((pair) => pair?.student_id && pair?.test_session_id);
    if (!normalizedPairs.length) return { ok: true, deleted: 0 };
    const { ids: deleteIds, error } = await fetchExistingImportedAttemptIdsForPairs(normalizedPairs);
    if (error) {
      return { ok: false, message: error.message };
    }
    if (!deleteIds.length) {
      return { ok: true, deleted: 0 };
    }
    const deleteError = await deleteAttemptIdsInChunks(deleteIds);
    if (deleteError) {
      return { ok: false, message: deleteError.message };
    }
    return { ok: true, deleted: deleteIds.length };
  }

  async function replaceImportedSummaryAttempts(payloads, options = {}) {
    if (!payloads.length) return { ok: true, inserted: 0 };

    const overwriteSessionIds = Array.from(new Set((options?.overwriteSessionIds ?? []).filter(Boolean)));
    for (const sessionIdChunk of chunkItems(overwriteSessionIds, IMPORTED_ATTEMPT_QUERY_BATCH_SIZE)) {
      const { error: overwriteDeleteError } = await supabase
        .from("attempts")
        .delete()
        .in("test_session_id", sessionIdChunk);
      if (overwriteDeleteError) {
        return { ok: false, message: overwriteDeleteError.message };
      }
    }

    const replacementPairs = payloads
      .filter((payload) => payload.student_id && payload.test_session_id && !overwriteSessionIds.includes(payload.test_session_id))
      .map((payload) => ({
        student_id: payload.student_id,
        test_session_id: payload.test_session_id,
      }));

    const { ids: deleteIds, error: existingError } = await fetchExistingImportedAttemptIdsForPairs(replacementPairs);
    if (existingError) {
      return { ok: false, message: existingError.message };
    }
    if (deleteIds.length) {
      const deleteError = await deleteAttemptIdsInChunks(deleteIds);
      if (deleteError) {
        return { ok: false, message: deleteError.message };
      }
    }

    for (const payloadChunk of chunkItems(payloads, IMPORTED_ATTEMPT_BATCH_SIZE)) {
      const insertError = await insertImportedAttemptPayloadChunk(payloadChunk);
      if (insertError) {
        return { ok: false, message: insertError.message };
      }
    }
    return { ok: true, inserted: payloads.length };
  }

  async function importAttendanceGoogleSheetsCsv(file) {
    if (!file) return;
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    const showLoadingStatus = (message) => {
      setAttendanceMsg(message);
      setAttendanceImportStatus({
        loading: true,
        tone: "info",
        title: "Importing Attendance CSV",
        message,
      });
    };
    const showResultStatus = (message, tone = "info", title = "") => {
      setAttendanceMsg(message);
      setAttendanceImportStatus({
        loading: false,
        tone,
        title: title || (tone === "success"
          ? "Attendance Import Complete"
          : tone === "error"
            ? "Attendance Import Failed"
            : "Attendance Import Status"),
        message,
      });
    };
    showLoadingStatus("Reading uploaded attendance CSV...");
    try {
      const text = await file.text();
      const rows = parseSeparatedRows(text, detectDelimiter(text));
      if (rows.length < 4) {
        showResultStatus("Import failed: CSV format is not recognized.", "error");
        return;
      }

      const layout = detectAttendanceImportLayout(rows);
      const dayColumns = layout?.dayColumns ?? [];
      if (!dayColumns.length) {
        showResultStatus("Import failed: no attendance date columns were found.", "error");
        return;
      }

      showLoadingStatus("Matching students and attendance columns...");
      const matchStudent = createAttendanceImportedStudentMatcher(sortedStudents);
      const importedByDay = new Map();
      const unmatchedRows = [];
      let skippedEmptyDayCount = 0;
      let skippedAllNaDayCount = 0;
      const getCell = (row, index) => (index >= 0 ? row[index] : "");

      for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] ?? [];
        if (!rowHasCsvValues(row)) continue;
        if (normalizeLookupValue(getCell(row, layout?.ruleIndex ?? 0)) === "rule") break;

        const student = matchStudent({
          rowNumber: Number(normalizeCsvValue(getCell(row, layout?.rowNumberIndex ?? -1))),
          name: getCell(row, layout?.nameIndex ?? -1),
          section: getCell(row, layout?.sectionIndex ?? -1),
          email: getCell(row, layout?.emailIndex ?? -1),
        });

        if (!student?.id) {
          unmatchedRows.push(rowIndex + 1);
          continue;
        }

        dayColumns.forEach(({ colIndex, dayDate }) => {
          const status = normalizeAttendanceImportStatus(row[colIndex]);
          if (ATTENDANCE_SUPPORTED_STATUSES.includes(status)) {
            if (!importedByDay.has(dayDate)) {
              importedByDay.set(dayDate, new Map());
            }
            importedByDay.get(dayDate).set(student.id, status);
          }
        });
      }

      if (!importedByDay.size) {
        showResultStatus("Import failed: no student attendance rows were recognized.", "error");
        return;
      }

      const importedDayDates = [];
      dayColumns.forEach(({ dayDate }) => {
        const statusMap = importedByDay.get(dayDate);
        const statuses = Array.from(statusMap?.values?.() ?? []);
        if (!statuses.length) {
          skippedEmptyDayCount += 1;
          return;
        }
        if (statuses.every((status) => status === "N/A")) {
          skippedAllNaDayCount += 1;
          importedByDay.delete(dayDate);
          return;
        }
        importedDayDates.push(dayDate);
      });

      if (!importedDayDates.length) {
        showResultStatus("Import skipped: every detected attendance column was empty or N/A only.", "info");
        return;
      }

      showLoadingStatus("Checking for existing attendance dates...");
      const { data: existingDaysData, error: existingDaysError } = await supabase
        .from("attendance_days")
        .select("id, day_date")
        .eq("school_id", activeSchoolId)
        .in("day_date", importedDayDates);
      if (existingDaysError) {
        showResultStatus(`Import failed: ${existingDaysError.message}`, "error");
        return;
      }

      const existingDayDates = new Set((existingDaysData ?? []).map((row) => row.day_date));
      const overlappingDayDates = importedDayDates.filter((dayDate) => existingDayDates.has(dayDate));
      let shouldUpdateExistingDays = true;

      if (overlappingDayDates.length) {
        setAttendanceImportStatus(null);
        const importChoice = await promptAttendanceImportConflict(overlappingDayDates);
        if (importChoice === "cancel") {
          showResultStatus("Import cancelled.", "info", "Attendance Import Cancelled");
          return;
        }
        shouldUpdateExistingDays = importChoice === "update";
      }

      const daysToImport = importedDayDates.filter((dayDate) => shouldUpdateExistingDays || !existingDayDates.has(dayDate));
      if (!daysToImport.length) {
        showResultStatus("Import skipped: all imported attendance days already exist, and only new days was selected.", "info");
        return;
      }

      showLoadingStatus("Saving attendance days and entries...");
      const { data: daysData, error: daysError } = await supabase
        .from("attendance_days")
        .upsert(
          daysToImport.map((dayDate) => ({ school_id: activeSchoolId, day_date: dayDate })),
          { onConflict: "school_id,day_date" }
        )
        .select("id, day_date");
      if (daysError) {
        showResultStatus(`Import failed: ${daysError.message}`, "error");
        return;
      }

      const dayIdByDate = Object.fromEntries((daysData ?? []).map((row) => [row.day_date, row.id]));
      const actualImportedStatusCount = daysToImport.reduce(
        (sum, dayDate) => sum + (importedByDay.get(dayDate)?.size ?? 0),
        0
      );
      for (const dayDate of daysToImport) {
        const statusMap = importedByDay.get(dayDate);
        const dayId = dayIdByDate[dayDate];
        const studentIds = Array.from(statusMap?.keys?.() ?? []);
        if (!dayId || !studentIds.length) continue;

        const { error: deleteError } = await supabase
          .from("attendance_entries")
          .delete()
          .eq("day_id", dayId)
          .in("student_id", studentIds);
        if (deleteError) {
          showResultStatus(`Import failed: ${deleteError.message}`, "error");
          return;
        }

        const insertRows = studentIds
          .map((studentId) => ({
            day_id: dayId,
            student_id: studentId,
            status: statusMap.get(studentId),
            comment: null,
          }))
          .filter((row) => ATTENDANCE_SUPPORTED_STATUSES.includes(row.status));

        if (insertRows.length) {
          const { error: insertError } = await supabase
            .from("attendance_entries")
            .upsert(insertRows, { onConflict: "day_id,student_id" });
          if (insertError) {
            showResultStatus(`Import failed: ${insertError.message}`, "error");
            return;
          }
        }
      }

      await fetchAttendanceDays();
      const updatedExistingDayCount = shouldUpdateExistingDays ? overlappingDayDates.length : 0;
      const addedNewDayCount = daysToImport.length - updatedExistingDayCount;
      const skippedExistingDayCount = shouldUpdateExistingDays ? 0 : overlappingDayDates.length;
      await recordAuditEvent({
        actionType: "import",
        entityType: "attendance_import",
        entityId: `${daysToImport[0] ?? "attendance"}:${daysToImport.length}`,
        summary: `Imported attendance for ${daysToImport.length} day${daysToImport.length === 1 ? "" : "s"} (${actualImportedStatusCount} entries).`,
        metadata: {
          imported_day_count: daysToImport.length,
          imported_entry_count: actualImportedStatusCount,
          added_new_day_count: addedNewDayCount,
          updated_existing_day_count: updatedExistingDayCount,
        },
      });
      showResultStatus(
        `Imported ${actualImportedStatusCount} attendance entr${actualImportedStatusCount === 1 ? "y" : "ies"} across ${daysToImport.length} day${daysToImport.length === 1 ? "" : "s"}`
        + (addedNewDayCount ? `, added ${addedNewDayCount} new day${addedNewDayCount === 1 ? "" : "s"}` : "")
        + (updatedExistingDayCount ? `, updated ${updatedExistingDayCount} existing day${updatedExistingDayCount === 1 ? "" : "s"}` : "")
        + (skippedExistingDayCount ? `, skipped ${skippedExistingDayCount} existing day${skippedExistingDayCount === 1 ? "" : "s"}` : "")
        + (skippedEmptyDayCount ? `, ignored ${skippedEmptyDayCount} empty day column${skippedEmptyDayCount === 1 ? "" : "s"}` : "")
        + (skippedAllNaDayCount ? `, ignored ${skippedAllNaDayCount} N/A-only day column${skippedAllNaDayCount === 1 ? "" : "s"}` : "")
        + (unmatchedRows.length ? ` (${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} unmatched).` : "."),
        "success"
      );
    } catch (error) {
      showResultStatus(`Import failed: ${error instanceof Error ? error.message : error}`, "error");
    } finally {
      if (attendanceImportInputRef.current) attendanceImportInputRef.current.value = "";
    }
  }

  async function importDailyResultsGoogleSheetsCsv(file, targetCategoryName = "") {
    if (!file) return;
    const categoryName = String(targetCategoryName ?? "").trim();
    if (!categoryName) {
      const message = "Import failed: select a daily test category first.";
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
      return;
    }
    const testsForCategory = (dailyTests ?? []).filter(
      (test) => String(test.title ?? "").trim() === categoryName
    );
    const testByVersion = new Map((testsForCategory ?? []).map((test) => [test.version, test]));
    const importSessions = (testSessions ?? [])
      .filter((session) => testByVersion.has(session.problem_set_id))
      .filter((session) => !isRetakeSessionTitle(session.title))
      .map((session) => ({
        ...session,
        linkedTest: testByVersion.get(session.problem_set_id) ?? null,
      }));
    setQuizMsg("Importing CSV...");
    showResultsImportLoadingStatus("daily", "Reading uploaded CSV...");
    try {
      const text = await file.text();
      const rows = parseSeparatedRows(text, detectDelimiter(text));
      if (rows.length < 4) {
        const message = "Import failed: CSV format is not recognized.";
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "error");
        return;
      }

      const sessionKeyMap = new Map();
      const uniqueTitleMap = new Map();
      importSessions.forEach((session, index) => {
        const title = String(session.title ?? session.problem_set_id ?? "").trim();
        const dateKey = formatSlashDateShortYear(session.starts_at || session.created_at);
        sessionKeyMap.set(`${normalizeLookupValue(title)}::${dateKey}`, session);
        const titleKey = normalizeLookupValue(title);
        if (!uniqueTitleMap.has(titleKey)) uniqueTitleMap.set(titleKey, []);
        uniqueTitleMap.get(titleKey).push({ session, index });
      });

      const existingResultTitles = new Set(
        importSessions
          .map((session) => String(session?.title ?? session?.problem_set_id ?? "").trim())
          .filter(Boolean)
      );
      const csvColumns = [];
      for (let col = 5; col < Math.max(rows[0]?.length ?? 0, rows[1]?.length ?? 0); col += 1) {
        const rawTitle = String(rows[0]?.[col] ?? "").trim();
        const rawDate = String(rows[1]?.[col] ?? "").trim();
        if (!rawTitle) continue;
        csvColumns.push({
          columnIndex: csvColumns.length,
          colIndex: col,
          importTitle: rawTitle,
          importDateCell: rawDate,
          importDateIso: parseSlashDateShortYearToIso(rawDate),
          session: null,
          linkedTest: null,
        });
      }

      const populatedCsvColumns = csvColumns.filter((column) => hasDailyResultValues(rows, column.colIndex, 3));

      if (!populatedCsvColumns.length) {
        const message = "Import failed: no daily result columns were found in the CSV.";
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "error");
        return;
      }

      const duplicateTitles = populatedCsvColumns
        .map((column) => String(column.importTitle ?? "").trim())
        .filter((title, index, list) => title && list.indexOf(title) === index && existingResultTitles.has(title));
      let selectedColumns = populatedCsvColumns;
      let overwriteSessionIds = [];

      if (duplicateTitles.length) {
        showResultsImportResultStatus("daily", "Duplicate test titles found. Choose how to continue.", "info", "Daily Results Import Warning");
        const importChoice = await promptDailyResultsImportConflict(duplicateTitles);
        if (importChoice === "cancel") {
          const message = "Import cancelled.";
          setQuizMsg(message);
          showResultsImportResultStatus("daily", message, "info", "Daily Results Import Cancelled");
          return;
        }
        if (importChoice === "new_only") {
          selectedColumns = populatedCsvColumns.filter((column) => !existingResultTitles.has(String(column.importTitle ?? "").trim()));
          if (!selectedColumns.length) {
            const message = "Import skipped: all CSV test titles already exist in the current category, and only new tests was selected.";
            setQuizMsg(message);
            showResultsImportResultStatus("daily", message, "info");
            return;
          }
        } else {
          overwriteSessionIds = Array.from(new Set(
            importSessions
              .filter((session) => duplicateTitles.includes(String(session.title ?? "").trim()))
              .map((session) => session.id)
          ));
        }
      }

      showResultsImportLoadingStatus("daily", `Preparing daily result sessions for ${categoryName}...`);
      selectedColumns.forEach((column) => {
        const titleKey = normalizeLookupValue(column.importTitle);
        const matchedByKey = sessionKeyMap.get(`${titleKey}::${column.importDateCell}`);
        const matchedByTitle = uniqueTitleMap.get(titleKey) ?? [];
        const session = matchedByKey ?? matchedByTitle[0]?.session ?? null;
        if (session?.id) {
          column.session = session;
          column.linkedTest = session.linkedTest ?? testByVersion.get(session.problem_set_id) ?? null;
          return;
        }
        const linkedTest = testsForCategory[column.columnIndex] ?? testsForCategory[0] ?? null;
        if (linkedTest?.version) column.linkedTest = linkedTest;
      });

      const columnsMissingLinkedTest = selectedColumns.filter((column) => !column.session?.id && !column.linkedTest?.version);
      for (let index = 0; index < columnsMissingLinkedTest.length; index += 1) {
        const column = columnsMissingLinkedTest[index];
        const version = buildImportedResultTestVersion("daily", categoryName, index);
        const ensure = await ensureTestRecord(version, categoryName, "daily", 0.8, activeSchoolId);
        if (!ensure.ok) {
          const message = `Import failed: ${ensure.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("daily", message, "error");
          return;
        }
        column.linkedTest = {
          version,
          title: categoryName,
          type: "daily",
          pass_rate: 0.8,
          question_count: 0,
        };
      }

      const columnsToCreate = selectedColumns.filter((column) => !column.session?.id);
      if (columnsToCreate.length) {
        const createPayloads = columnsToCreate.map((column) => {
          const sessionDateIso = column.importDateIso
            ? new Date(`${column.importDateIso}T00:00:00`).toISOString()
            : new Date().toISOString();
          return {
            school_id: activeSchoolId,
            problem_set_id: column.linkedTest.version,
            title: column.importTitle,
            starts_at: sessionDateIso,
            ends_at: sessionDateIso,
            time_limit_min: null,
            is_published: false,
            show_answers: false,
            allow_multiple_attempts: false,
          };
        });
        const { data: createdSessions, error: createError } = await supabase
          .from("test_sessions")
          .insert(createPayloads)
          .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at");
        if (createError) {
          const message = `Import failed: ${createError.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("daily", message, "error");
          return;
        }
        createdSessions?.forEach((sessionRow, index) => {
          const column = columnsToCreate[index];
          column.session = {
            retake_source_session_id: null,
            retake_release_scope: "all",
            ...sessionRow,
            linkedTest: column.linkedTest,
          };
        });
      }

      const matchStudent = createImportedStudentMatcher(sortedStudents);
      const payloads = [];
      const unmatchedRows = [];
      showResultsImportLoadingStatus("daily", `Matching students and saving imported results into ${categoryName}...`);

      for (let rowIndex = 3; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] ?? [];
        if (!rowHasCsvValues(row)) continue;
        const sectionMarker = normalizeLookupValue(row[3]);
        if (sectionMarker.startsWith("failed students") || sectionMarker.startsWith("absent students")) break;

        const student = matchStudent({
          rowNumber: Number(normalizeCsvValue(row[1])),
          name: row[2],
          section: row[3],
          email: "",
        });
        if (!student?.id) {
          unmatchedRows.push(rowIndex + 1);
          continue;
        }

        selectedColumns.forEach((column) => {
          const { colIndex, session } = column;
          const rate = parsePercentCell(row[colIndex]);
          if (rate == null) return;
          const total = Math.max(0, Number(session?.linkedTest?.question_count ?? 0));
          const correct = total > 0 ? Math.round(rate * total) : 0;
          payloads.push({
            student_id: student.id,
            display_name: student.display_name ?? null,
            student_code: student.student_code ?? null,
            test_version: session.problem_set_id,
            test_session_id: session.id,
            correct,
            total,
            score_rate: rate,
            started_at: session.starts_at ?? null,
            ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
            answers_json: buildImportedSummaryAnswersJson("daily_results_csv", {
              imported_test_title: column.importTitle,
              imported_test_date: column.importDateIso || null,
            }),
            tab_left_count: 0,
          });
        });
      }

      const dedupedPayloads = dedupeImportedAttemptPayloads(payloads);
      if (!dedupedPayloads.length) {
        const message = "Import failed: no daily result rows were recognized.";
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "error");
        return;
      }

      const result = await replaceImportedSummaryAttempts(dedupedPayloads, {
        overwriteSessionIds,
      });
      if (!result.ok) {
        const message = `Import failed: ${result.message}`;
        setQuizMsg(message);
        showResultsImportResultStatus("daily", message, "error");
        return;
      }

      await fetchTestSessions();
      await fetchTests();
      setDailyResultsCategory(categoryName);
      await runSearch("daily");
      const skippedExistingCount = duplicateTitles.length && !overwriteSessionIds.length
        ? duplicateTitles.length
        : 0;
      const createdSessionCount = columnsToCreate.length;
      const message = 
        `Imported ${result.inserted} daily result entr${result.inserted === 1 ? "y" : "ies"}`
        + (createdSessionCount ? `, created ${createdSessionCount} new result session${createdSessionCount === 1 ? "" : "s"}` : "")
        + (overwriteSessionIds.length ? `, replaced ${overwriteSessionIds.length} existing test result set${overwriteSessionIds.length === 1 ? "" : "s"}` : "")
        + (skippedExistingCount ? `, skipped ${skippedExistingCount} existing test title${skippedExistingCount === 1 ? "" : "s"}` : "")
        + (unmatchedRows.length ? ` (${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} unmatched).` : ".");
      await recordAuditEvent({
        actionType: "import",
        entityType: "results_import",
        entityId: `daily:${categoryName}:${Date.now()}`,
        summary: `Imported daily results into ${categoryName} (${result.inserted} entries).`,
        metadata: {
          test_type: "daily",
          category: categoryName,
          imported_entry_count: result.inserted,
          created_session_count: createdSessionCount,
        },
      });
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "success");
    } catch (error) {
      const message = `Import failed: ${error instanceof Error ? error.message : error}`;
      setQuizMsg(message);
      showResultsImportResultStatus("daily", message, "error");
    } finally {
      if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
    }
  }

  async function importModelResultsGoogleSheetsCsv(file, targetCategoryName = "") {
    if (!file) return;
    const categoryName = String(targetCategoryName ?? "").trim();
    if (!categoryName) {
      const message = "Import failed: select a model test category first.";
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
      return;
    }
    const testsForCategory = (modelTests ?? []).filter(
      (test) => String(test.title ?? "").trim() === categoryName
    );
    const testByVersion = new Map((testsForCategory ?? []).map((test) => [test.version, test]));
    const importSessions = (testSessions ?? [])
      .filter((session) => testByVersion.has(session.problem_set_id))
      .filter((session) => !isRetakeSessionTitle(session.title))
      .map((session) => ({
        ...session,
        linkedTest: testByVersion.get(session.problem_set_id) ?? null,
      }));
    setQuizMsg("Importing CSV...");
    showResultsImportLoadingStatus("mock", "Reading uploaded CSV...");
    try {
      const text = await file.text();
      const rows = parseSeparatedRows(text, detectDelimiter(text));
      if (rows.length < 5) {
        const message = "Import failed: CSV format is not recognized.";
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }

      const headerRowIndex = rows.findIndex((row) => {
        const normalized = (row ?? []).map((cell) => normalizeLookupValue(cell));
        return normalized.includes("no.") && normalized.includes("student name");
      });
      if (headerRowIndex < 0 || rows.length < headerRowIndex + 5) {
        const message = "Import failed: CSV header rows are not recognized.";
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }
      const titleRowIndex = headerRowIndex;
      const sectionRowIndex = headerRowIndex + 1;
      const dateRowIndex = headerRowIndex + 2;
      const sampleValueRowIndex = headerRowIndex + 3;
      const dataStartRowIndex = headerRowIndex + 4;

      const sessionKeyMap = new Map();
      const uniqueTitleMap = new Map();
      importSessions.forEach((session, index) => {
        const title = String(session.title ?? session.problem_set_id ?? "").trim();
        const dateKey = formatSlashDateShortYear(session.starts_at || session.created_at);
        sessionKeyMap.set(`${normalizeLookupValue(title)}::${dateKey}`, session);
        const titleKey = normalizeLookupValue(title);
        if (!uniqueTitleMap.has(titleKey)) uniqueTitleMap.set(titleKey, []);
        uniqueTitleMap.get(titleKey).push({ session, index });
      });

      const existingResultTitles = new Set(
        importSessions
          .map((session) => String(session?.title ?? session?.problem_set_id ?? "").trim())
          .filter(Boolean)
      );

      const csvBlocks = [];
      let currentBlock = null;
      const maxHeaderColumns = Math.max(
        rows[titleRowIndex]?.length ?? 0,
        rows[sectionRowIndex]?.length ?? 0,
        rows[dateRowIndex]?.length ?? 0,
        rows[sampleValueRowIndex]?.length ?? 0
      );
      for (let col = 5; col < maxHeaderColumns; col += 1) {
        const titleCell = String(rows[titleRowIndex]?.[col] ?? "").trim();
        if (titleCell) {
          currentBlock = {
            blockIndex: csvBlocks.length,
            importTitle: titleCell,
            importDateCell: String(rows[dateRowIndex]?.[col] ?? "").trim(),
            importDateIso: parseSlashDateShortYearToIso(rows[dateRowIndex]?.[col]),
            sections: [],
            total: null,
            blockStartColumnIndex: col,
            session: null,
            linkedTest: null,
          };
          csvBlocks.push(currentBlock);
        }
        if (!currentBlock) continue;
        const sectionCell = String(rows[sectionRowIndex]?.[col] ?? "").trim();
        if (!sectionCell || sectionCell === "Ranking") continue;
        if (!currentBlock.importDateCell) {
          currentBlock.importDateCell = String(rows[dateRowIndex]?.[col] ?? "").trim();
        }
        if (!currentBlock.importDateIso) {
          currentBlock.importDateIso = parseSlashDateShortYearToIso(rows[dateRowIndex]?.[col]);
        }
        if (sectionCell === "Total") {
          currentBlock.total = {
            rateColumnIndex: col,
            scoreColumnIndex: col + 1,
          };
          continue;
        }
        currentBlock.sections.push({
          sectionTitle: sectionCell,
          rateColumnIndex: col,
          scoreColumnIndex: col + 1,
        });
      }

      csvBlocks.forEach((block, blockIndex) => {
        if (block.total) return;
        const nextBlockStart = csvBlocks[blockIndex + 1]?.blockStartColumnIndex ?? maxHeaderColumns;
        let inferredTotal = null;
        for (let col = block.blockStartColumnIndex; col < nextBlockStart - 1; col += 1) {
          const percentValue = rows[sampleValueRowIndex]?.[col];
          const scoreValue = rows[sampleValueRowIndex]?.[col + 1];
          if (parsePercentCell(percentValue) == null) continue;
          if (!parseScoreFractionCell(scoreValue)) continue;
          inferredTotal = {
            rateColumnIndex: col,
            scoreColumnIndex: col + 1,
          };
        }
        if (inferredTotal) block.total = inferredTotal;
      });

      const mappedBlocks = csvBlocks.filter((block) => block.total);
      const populatedBlocks = mappedBlocks.filter((block) => hasModelResultValues(rows, block, dataStartRowIndex));
      if (!populatedBlocks.length) {
        const message = "Import failed: no model result columns were found in the CSV.";
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }

      const duplicateTitles = populatedBlocks
        .map((block) => String(block.importTitle ?? "").trim())
        .filter((title, index, list) => title && list.indexOf(title) === index && existingResultTitles.has(title));
      let selectedBlocks = populatedBlocks;

      if (duplicateTitles.length) {
        showResultsImportResultStatus("mock", "Duplicate test titles found. Choose how to continue.", "info", "Model Results Import Warning");
        const importChoice = await promptModelResultsImportConflict(duplicateTitles);
        if (importChoice === "cancel") {
          const message = "Import cancelled.";
          setQuizMsg(message);
          showResultsImportResultStatus("mock", message, "info", "Model Results Import Cancelled");
          return;
        }
        if (importChoice === "new_only") {
          selectedBlocks = populatedBlocks.filter((block) => !existingResultTitles.has(String(block.importTitle ?? "").trim()));
          if (!selectedBlocks.length) {
            const message = "Import skipped: all CSV test titles already exist in the current results, and only new tests was selected.";
            setQuizMsg(message);
            showResultsImportResultStatus("mock", message, "info");
            return;
          }
        }
      }

      showResultsImportLoadingStatus("mock", `Preparing model result sessions for ${categoryName}...`);
      selectedBlocks.forEach((block) => {
        const titleKey = normalizeLookupValue(block.importTitle);
        const matchedByKey = sessionKeyMap.get(`${titleKey}::${block.importDateCell}`);
        const matchedByTitle = uniqueTitleMap.get(titleKey) ?? [];
        const session = matchedByKey ?? matchedByTitle[0]?.session ?? null;
        if (session?.id) {
          block.session = session;
          block.linkedTest = session.linkedTest ?? testByVersion.get(session.problem_set_id) ?? null;
          return;
        }
        const linkedTest = testsForCategory[block.blockIndex] ?? null;
        if (linkedTest?.version) block.linkedTest = linkedTest;
      });

      const blocksMissingLinkedTest = selectedBlocks.filter((block) => !block.session?.id && !block.linkedTest?.version);
      for (let index = 0; index < blocksMissingLinkedTest.length; index += 1) {
        const block = blocksMissingLinkedTest[index];
        const version = buildImportedResultTestVersion("mock", categoryName, index);
        const ensure = await ensureTestRecord(version, categoryName, "mock", 0.8, activeSchoolId);
        if (!ensure.ok) {
          const message = `Import failed: ${ensure.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("mock", message, "error");
          return;
        }
        block.linkedTest = {
          version,
          title: categoryName,
          type: "mock",
          pass_rate: 0.8,
          question_count: 0,
        };
      }

      const blocksToCreate = selectedBlocks.filter((block) => !block.session?.id);
      if (blocksToCreate.length) {
        const createPayloads = blocksToCreate.map((block) => {
          const sessionDateIso = block.importDateIso
            ? new Date(`${block.importDateIso}T00:00:00`).toISOString()
            : new Date().toISOString();
          return {
            school_id: activeSchoolId,
            problem_set_id: block.linkedTest.version,
            title: block.importTitle,
            starts_at: sessionDateIso,
            ends_at: sessionDateIso,
            time_limit_min: null,
            is_published: false,
            show_answers: false,
            allow_multiple_attempts: false,
          };
        });
        const { data: createdSessions, error: createError } = await supabase
          .from("test_sessions")
          .insert(createPayloads)
          .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at");
        if (createError) {
          const message = `Import failed: ${createError.message}`;
          setQuizMsg(message);
          showResultsImportResultStatus("mock", message, "error");
          return;
        }
        createdSessions?.forEach((sessionRow, index) => {
          const block = blocksToCreate[index];
          block.session = {
            retake_source_session_id: null,
            retake_release_scope: "all",
            ...sessionRow,
            linkedTest: block.linkedTest,
          };
        });
      }

      const overwriteSessionIds = Array.from(
        new Set(
          selectedBlocks
            .filter((block) => existingResultTitles.has(String(block.importTitle ?? "").trim()))
            .map((block) => block.session?.id)
            .filter(Boolean)
        )
      );

      const matchStudent = createImportedStudentMatcher(sortedStudents);
      const payloads = [];
      const unmatchedRows = [];
      showResultsImportLoadingStatus("mock", `Matching students and saving imported results into ${categoryName}...`);

      for (let rowIndex = dataStartRowIndex; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] ?? [];
        if (!rowHasCsvValues(row)) continue;
        const sectionMarker = normalizeLookupValue(row[3]);
        if (sectionMarker.startsWith("failed students") || sectionMarker.startsWith("absent students")) break;

        const student = matchStudent({
          rowNumber: Number(normalizeCsvValue(row[1])),
          name: row[2],
          section: row[3],
          email: "",
        });
        if (!student?.id) {
          unmatchedRows.push(rowIndex + 1);
          continue;
        }

        selectedBlocks.forEach(({ session, total: totalColumns, sections: blockSections }) => {
          const rate = parsePercentCell(row[totalColumns.rateColumnIndex]);
          if (rate == null) return;
          const score = parseScoreFractionCell(row[totalColumns.scoreColumnIndex]);
          const total = score?.total ?? Math.max(0, Number(session?.linkedTest?.question_count ?? 0));
          const correct = score?.correct ?? (total > 0 ? Math.round(rate * total) : 0);
          const mainSectionSummary = blockSections
            .map((section) => {
              const sectionRate = parsePercentCell(row[section.rateColumnIndex]);
              const sectionScore = parseScoreFractionCell(row[section.scoreColumnIndex]);
              if (sectionRate == null && !sectionScore) return null;
              const sectionTotal = Number(sectionScore?.total ?? 0);
              const sectionCorrect = Number(
                sectionScore?.correct
                ?? (sectionRate != null && sectionTotal > 0 ? Math.round(sectionRate * sectionTotal) : 0)
              );
              return {
                section: normalizeImportedModelSectionTitle(section.sectionTitle),
                correct: Number.isFinite(sectionCorrect) ? sectionCorrect : 0,
                total: Number.isFinite(sectionTotal) ? sectionTotal : 0,
                rate: sectionRate != null
                  ? sectionRate
                  : (sectionTotal > 0 ? sectionCorrect / sectionTotal : 0),
              };
            })
            .filter(Boolean);
          payloads.push({
            student_id: student.id,
            display_name: student.display_name ?? null,
            student_code: student.student_code ?? null,
            test_version: session.problem_set_id,
            test_session_id: session.id,
            correct,
            total,
            score_rate: rate,
            started_at: session.starts_at ?? null,
            ended_at: session.ends_at ?? session.starts_at ?? new Date().toISOString(),
            answers_json: buildImportedSummaryAnswersJson("model_results_csv", {
              imported_test_title: session.title || block.importTitle || "",
              imported_test_date: block.importDateIso || null,
              main_section_summary: mainSectionSummary,
            }),
            tab_left_count: 0,
          });
        });
      }

      const dedupedPayloads = dedupeImportedAttemptPayloads(payloads);
      if (!dedupedPayloads.length) {
        const message = "Import failed: no model result rows were recognized.";
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }

      const result = await replaceImportedSummaryAttempts(dedupedPayloads, {
        overwriteSessionIds,
      });
      if (!result.ok) {
        const message = `Import failed: ${result.message}`;
        setQuizMsg(message);
        showResultsImportResultStatus("mock", message, "error");
        return;
      }

      await fetchTestSessions();
      await fetchTests();
      setModelResultsCategory(categoryName);
      await runSearch("mock");
      const skippedExistingCount = duplicateTitles.length && !overwriteSessionIds.length
        ? duplicateTitles.length
        : 0;
      const createdSessionCount = blocksToCreate.length;
      const message =
        `Imported ${result.inserted} model result entr${result.inserted === 1 ? "y" : "ies"}`
        + (createdSessionCount ? `, created ${createdSessionCount} new result session${createdSessionCount === 1 ? "" : "s"}` : "")
        + (overwriteSessionIds.length ? `, replaced ${overwriteSessionIds.length} existing test result set${overwriteSessionIds.length === 1 ? "" : "s"}` : "")
        + (skippedExistingCount ? `, skipped ${skippedExistingCount} existing test title${skippedExistingCount === 1 ? "" : "s"}` : "")
        + (unmatchedRows.length ? ` (${unmatchedRows.length} row${unmatchedRows.length === 1 ? "" : "s"} unmatched).` : ".");
      await recordAuditEvent({
        actionType: "import",
        entityType: "results_import",
        entityId: `mock:${categoryName}:${Date.now()}`,
        summary: `Imported model results into ${categoryName} (${result.inserted} entries).`,
        metadata: {
          test_type: "mock",
          category: categoryName,
          imported_entry_count: result.inserted,
          created_session_count: createdSessionCount,
        },
      });
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "success");
    } catch (error) {
      const message = `Import failed: ${error instanceof Error ? error.message : error}`;
      setQuizMsg(message);
      showResultsImportResultStatus("mock", message, "error");
    } finally {
      if (resultsImportInputRef.current) resultsImportInputRef.current.value = "";
    }
  }

  async function exportQuizSummaryCsv() {
    setQuizMsg("");
    const quizVersions = (tests ?? []).filter((t) => t.type === "quiz").map((t) => t.version);
    const buildQuizSummaryQuery = (fields) => {
      let query = supabase
        .from("attempts")
        .select(fields)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (quizVersions.length) {
        query = query.in("test_version", quizVersions);
      } else {
        query = query.ilike("test_version", "quiz_%");
      }
      return query;
    };
    let { data, error } = await buildQuizSummaryQuery(
      "id, student_id, display_name, student_code, test_version, correct, total, score_rate, created_at, tab_left_count"
    );
    if (error && isMissingTabLeftCountError(error)) {
      ({ data, error } = await buildQuizSummaryQuery(
        "id, student_id, display_name, student_code, test_version, correct, total, score_rate, created_at"
      ));
    }
    if (error) {
      console.error("quiz attempts fetch error:", error);
      setQuizMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    if (list.length === 0) {
      setQuizMsg("No quiz attempts.");
      return;
    }
    const emailMap = await buildProfileEmailMap(supabase, list);
    const rows = [
      ["attempt_id", "created_at", "display_name", "student_code", "email", "test_version", "correct", "total", "score_rate", "tab_left_count"],
      ...list.map((a) => [
        a.id,
        a.created_at,
        a.display_name ?? "",
        a.student_code ?? "",
        emailMap[a.student_id] ?? "",
        a.test_version ?? "",
        a.correct ?? 0,
        a.total ?? 0,
        getScoreRate(a),
        getTabLeftCount(a)
      ])
    ];
    downloadText(`quiz_attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  async function exportDetailCsv(list) {
    const versions = Array.from(new Set((list ?? []).map((a) => a.test_version).filter(Boolean)));
    let questionsByVersion = {};
    if (versions.length) {
      const { data, error } = await fetchQuestionsForVersionsWithFallback(supabase, versions);
      if (error) {
        console.error("export detail questions fetch error:", error);
      } else {
        for (const row of data ?? []) {
          const version = row.test_version;
          if (!version) continue;
          if (!questionsByVersion[version]) questionsByVersion[version] = [];
          questionsByVersion[version].push(mapDbQuestion(row));
        }
      }
    }

    const rows = [
      [
        "attempt_id",
        "created_at",
        "display_name",
        "student_code",
        "test_version",
        "question_id",
        "section",
        "prompt",
        "chosen",
        "correct",
        "is_correct"
      ]
    ];
    for (const a of list) {
      const questionsList = questionsByVersion[a.test_version] || null;
      const details = questionsList && questionsList.length
        ? buildAttemptDetailRowsFromList(a.answers_json, questionsList)
        : buildAttemptDetailRows(a.answers_json);
      for (const d of details) {
        rows.push([
          a.id,
          a.created_at,
          a.display_name ?? "",
          a.student_code ?? "",
          a.test_version ?? "",
          d.qid,
          d.section,
          d.prompt,
          d.chosen,
          d.correct,
          d.isCorrect ? 1 : 0
        ]);
      }
    }
    downloadText(`attempts_detail_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  function exportSelectedAttemptCsv(attempt) {
    const details = buildAttemptDetailRows(attempt.answers_json);
    const rows = [
      ["question_id", "section", "prompt", "chosen", "correct", "is_correct"],
      ...details.map((d) => [d.qid, d.section, d.prompt, d.chosen, d.correct, d.isCorrect ? 1 : 0])
    ];
    downloadText(`attempt_${attempt.id}_detail.csv`, toCsv(rows), "text/csv");
  }

  const kpi = useMemo(() => {
    const count = attempts.length;
    const avgRate =
      count === 0 ? 0 : attempts.reduce((acc, a) => acc + getScoreRate(a), 0) / Math.max(1, count);
    const maxRate = count === 0 ? 0 : Math.max(...attempts.map((a) => getScoreRate(a)));
    return {
      count,
      avgRate,
      maxRate
    };
  }, [attempts]);

  const previewScore = useMemo(() => {
    let correct = 0;
    let total = 0;
    for (const q of previewQuestions) {
      if (Array.isArray(q.parts) && q.parts.length) {
        q.parts.forEach((p, idx) => {
          if (p.answerIndex == null) return;
          total += 1;
          const selected = previewAnswers[q.id]?.partAnswers?.[idx];
          if (selected === p.answerIndex) correct += 1;
        });
        continue;
      }
      if (q.answerIndex == null) continue;
      total += 1;
      if (previewAnswers[q.id] === q.answerIndex) correct += 1;
    }
    return { correct, total };
  }, [previewQuestions, previewAnswers]);

  async function handlePasswordChange() {
    setPasswordChangeMsg("");
    const nextPassword = passwordChangeForm.password;
    const confirmPassword = passwordChangeForm.confirmPassword;
    if (!nextPassword || !confirmPassword) {
      setPasswordChangeMsg("Enter and confirm the new password.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordChangeMsg("Passwords do not match.");
      return;
    }
    if (nextPassword.length < 8) {
      setPasswordChangeMsg("Password must be at least 8 characters.");
      return;
    }

    setPasswordChangeLoading(true);
    const { error: authError } = await supabase.auth.updateUser({
      password: nextPassword,
      data: { force_password_change: false },
    });
    if (authError) {
      setPasswordChangeMsg(authError.message);
      setPasswordChangeLoading(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", session?.user?.id ?? "");
    if (profileError) {
      setPasswordChangeMsg(profileError.message);
      setPasswordChangeLoading(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, force_password_change: false } : prev));
    setPasswordChangeForm({ password: "", confirmPassword: "" });
    setPasswordChangeMsg("");
    setPasswordChangeLoading(false);
  }

  async function handleLogin() {
    if (!supabase) {
      setLoginMsg(supabaseConfigError || "Admin client is unavailable.");
      return;
    }
    setLoginMsg("");
    const { email, password } = loginForm;
    if (!email || !password) {
      setLoginMsg("Email / Password を入力してください。");
      return;
    }
    loginValidationInFlightRef.current = true;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginValidationInFlightRef.current = false;
      setLoginMsg(normalizeAdminLoginErrorMessage(error.message));
      return;
    }
    try {
      const nextSession = data?.session ?? null;
      const userId = nextSession?.user?.id ?? data?.user?.id ?? "";
      if (!nextSession || !userId) {
        await supabase.auth.signOut({ scope: "local" });
        syncAdminAuthCookie(null);
        setSession(null);
        setProfile(null);
        setLoginMsg("Invalid login credentials");
        return;
      }
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, display_name, school_id, account_status, force_password_change")
        .eq("id", userId)
        .maybeSingle();
      if (profileError || !isAllowedAdminProfile(profileData)) {
        await supabase.auth.signOut({ scope: "local" });
        syncAdminAuthCookie(null);
        setSession(null);
        setProfile(null);
        setLoginMsg("Invalid login credentials");
        return;
      }
      syncAdminAuthCookie(nextSession);
      setProfile(profileData);
      setSession(nextSession);
      setAuthReady(true);
      setLoginMsg("");
    } finally {
      loginValidationInFlightRef.current = false;
    }
  }

  function handleAdminLoginKeyDown(event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleLogin();
  }

  function handleAdminSchoolScopeChange(nextSchoolId) {
    setSchoolScopeId(nextSchoolId || null);
  }

  function handleForcedSchoolScopeChange(nextSchoolId) {
    if (!nextSchoolId || nextSchoolId === forcedSchoolId) return;
    router.push(`/super/schools/${nextSchoolId}/admin`);
  }

  function renderSessionDetailView() {
    if (!selectedSessionDetail) return null;
    const isMockSessionDetail = sessionDetail.type === "mock";
    const isImportedSummarySession = sessionDetailUsesImportedResultsSummary;
    const isImportedModelSummarySession = sessionDetailUsesImportedModelSummary;
    const analysisPopupQuestions = Array.isArray(sessionDetailAnalysisPopup.questions)
      ? sessionDetailAnalysisPopup.questions
      : [];

    const bestQuestions = sessionDetailQuestionAnalysis.slice(0, 5);
    const worstQuestions = [...sessionDetailQuestionAnalysis]
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return String(a.qid).localeCompare(String(b.qid));
      })
      .slice(0, 5);
    const sessionDetailTabs = isImportedSummarySession
      ? [
        ["analysis", "Result Analysis"],
        ["studentRanking", "Student Ranking"],
      ]
      : [
        ["analysis", "Result Analysis"],
        ["questions", "Questions"],
        ["attempts", "Attempts"],
        ["studentRanking", "Student Ranking"],
      ];
    const analysisRadarData = sessionDetailMainSectionAverages.map((row) => ({
      label: row.section,
      value: row.averageRate ?? 0,
    }));

    return (
      <div className="session-detail-page">
        <div className="session-detail-header">
          <div className="session-detail-head-main">
            <div className="session-detail-head-top">
              <button
                className="session-detail-back-btn"
                type="button"
                onClick={closeSessionDetail}
                aria-label="Back to sessions"
                title="Back to sessions"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                  <path
                    d="m15 6-6 6 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => deleteTestSession(selectedSessionDetail.id, {
                  title: selectedSessionDetail.title || selectedSessionDetail.problem_set_id,
                  type: sessionDetail.type,
                  refreshResults: true,
                  surface: "results",
                })}
              >
                Delete test
              </button>
            </div>
            <div className="admin-title session-detail-title">
              {selectedSessionDetail.title || selectedSessionDetail.problem_set_id}
            </div>
            <div className="admin-help session-detail-meta">
              {!isMockSessionDetail ? (
                <>
                  SetID: <b>{selectedSessionDetail.problem_set_id}</b>
                  {" · "}
                </>
              ) : null}
              Start: <b>{formatDateTime(selectedSessionDetail.starts_at) || "—"}</b>
              {" · "}
              End: <b>{formatDateTime(selectedSessionDetail.ends_at) || "—"}</b>
            </div>
            <div className="admin-top-tabs session-detail-tabs">
              {sessionDetailTabs.map(([key, label]) => (
                <button
                  key={`session-detail-tab-${key}`}
                  className={`admin-top-tab ${sessionDetailTab === key ? "active" : ""}`}
                  type="button"
                  onClick={() => setSessionDetailTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sessionDetailLoading ? <div className="admin-msg">Loading...</div> : null}
        {!sessionDetailLoading && sessionDetailMsg ? <div className="admin-msg">{sessionDetailMsg}</div> : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "questions" ? (
          <div className="session-detail-section">
            <div className="admin-help">
              Total: <b>{sessionDetailQuestions.length}</b>
            </div>
            {!sessionDetailQuestions.length ? (
              <div className="admin-help" style={{ marginTop: 8 }}>No questions found for this session.</div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                {sessionDetailQuestions.map((question, index) => (
                  <QuestionPreviewCard
                    key={`session-detail-question-${question.id}-${index}`}
                    question={question}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "attempts" ? (
          <div className="session-detail-section">
            <div className="session-detail-actions">
              <div>
                <div className="admin-title" style={{ fontSize: 18 }}>Allow another attempt</div>
                <div className="admin-help">
                  Select a student who already submitted this test and add one more allowed attempt.
                </div>
              </div>
              <div className="session-detail-allow-form">
                <select
                  value={sessionDetailAllowStudentId}
                  onChange={(e) => setSessionDetailAllowStudentId(e.target.value)}
                  disabled={!sessionDetailStudentOptions.length || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  {sessionDetailStudentOptions.length ? (
                    sessionDetailStudentOptions.map((student) => {
                      const extraAttempts = Number(sessionDetailAllowances[student.id] ?? 0);
                      return (
                        <option key={`session-allow-${student.id}`} value={student.id}>
                          {student.display_name}
                          {student.student_code ? ` (${student.student_code})` : ""}
                          {extraAttempts > 0 ? ` (+${extraAttempts} extra)` : ""}
                        </option>
                      );
                    })
                  ) : (
                    <option value="">No submitted students</option>
                  )}
                </select>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={allowSessionAnotherAttempt}
                  disabled={!sessionDetailAllowStudentId || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  Allow another attempt
                </button>
              </div>
            </div>
            {selectedSessionDetail.allow_multiple_attempts !== false ? (
              <div className="admin-help" style={{ marginTop: 10 }}>
                This session already allows multiple attempts for everyone.
              </div>
            ) : null}
            {sessionDetailAllowMsg ? <div className="admin-msg">{sessionDetailAllowMsg}</div> : null}

            <div className="admin-table-wrap" style={{ marginTop: 12 }}>
              <table className="admin-table" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Submitted</th>
                    <th>Name</th>
                    <th>Student<br />No.</th>
                    <th>Score</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th>Attempt ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailDisplayAttempts.map((attempt, index) => {
                    const passed = getScoreRate(attempt) >= sessionDetailPassRate;
                    return (
                      <tr key={`session-attempt-${attempt.id}`} onClick={() => openAttemptDetail(attempt)}>
                        <td>{index + 1}</td>
                        <td>{formatDateTime(attempt.created_at)}</td>
                        <td>{attempt.display_name ?? ""}</td>
                        <td>{attempt.student_code ?? ""}</td>
                        <td>{attempt.correct}/{attempt.total}</td>
                        <td>{(getScoreRate(attempt) * 100).toFixed(1)}%</td>
                        <td className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{attempt.id}</td>
                      </tr>
                    );
                  })}
                  {!sessionDetailDisplayAttempts.length ? (
                    <tr>
                      <td colSpan={8}>No attempts yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "studentRanking" ? (
          <div className="session-detail-section">
            <div className="admin-table-wrap">
              <table className="admin-table session-student-ranking-table" style={{ minWidth: Math.max(900, 420 + sessionDetailRankingSections.length * 120) }}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Student<br />No.</th>
                    <th>Total Score</th>
                    <th>Total %</th>
                    {sessionDetailRankingSections.map((section) => (
                      <th key={`student-ranking-col-${section.section}`}>
                        <span className="session-ranking-section-header">
                          {getSectionLabelLines(section.section).map((line, index) => (
                            <span key={`student-ranking-col-${section.section}-${index}`}>{line}</span>
                          ))}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailStudentRankingRows.map((row) => (
                    <tr key={`student-ranking-row-${row.student_id}`} onClick={() => openAttemptDetail(row.attempt, "sessionRanking")}>
                      <td>{formatOrdinal(row.rank)}</td>
                      <td>{row.display_name}</td>
                      <td>{row.student_code || "—"}</td>
                      <td>{row.totalCorrect}/{row.totalQuestions}</td>
                      <td>{(row.totalRate * 100).toFixed(1)}%</td>
                      {sessionDetailRankingSections.map((section) => (
                        <td key={`student-ranking-cell-${row.student_id}-${section.section}`}>
                          {((row.sectionRates?.[section.section] ?? 0) * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!sessionDetailStudentRankingRows.length ? (
                    <tr>
                      <td colSpan={Math.max(5, 5 + sessionDetailRankingSections.length)}>No ranking data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "analysis" ? (
          <div className="session-detail-section">
            <div className="session-detail-analysis-summary">
              <div className="session-analysis-top-grid">
                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Class Score</div>
                  <div className="session-analysis-score-table-wrap">
                    <table className="session-analysis-score-table">
                      <tbody>
                        <tr>
                          <th className="pass">No. of Pass</th>
                          <td>
                            <span className="session-analysis-score-main pass">{sessionDetailAnalysisSummary.passCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th className="fail">No. of Fail</th>
                          <td>
                            <span className="session-analysis-score-main fail">{sessionDetailAnalysisSummary.failCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average score</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.averageCorrect.toFixed(2)}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.totalQuestions || 0}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average %</th>
                          <td>
                            <span className={`session-analysis-score-main ${sessionDetailOverview.averageScore < sessionDetailPassRate ? "fail" : ""}`}>
                              {(sessionDetailAnalysisSummary.averageRate * 100).toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th>Absent</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.absentCount}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Grade Distribution</div>
                  <div className="session-analysis-distribution-chart">
                    <div className="session-analysis-distribution-yaxis">
                      {Array.from({ length: Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1) }, (_, index) => {
                        const value = sessionDetailAnalysisSummary.maxBucketCount - index;
                        return (
                          <div key={`dist-y-${value}`} className="session-analysis-distribution-ytick">
                            <span>{value}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="session-analysis-distribution-plot">
                      <div
                        className="session-analysis-distribution-grid"
                        style={{ gridTemplateRows: `repeat(${Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1)}, 1fr)` }}
                      >
                        {Array.from({ length: Math.max(1, sessionDetailAnalysisSummary.maxBucketCount + 1) }, (_, index) => (
                          <div key={`dist-grid-${index}`} className="session-analysis-distribution-gridline" />
                        ))}
                      </div>
                      <div className="session-analysis-distribution-bars">
                        {sessionDetailAnalysisSummary.bucketLabels.map((label, index) => {
                          const count = sessionDetailAnalysisSummary.bucketCounts[index] ?? 0;
                          const maxCount = Math.max(1, sessionDetailAnalysisSummary.maxBucketCount);
                          return (
                            <div key={`dist-bar-${label}`} className="session-analysis-distribution-bar-group">
                              <div className="session-analysis-distribution-bar-wrap">
                                <div
                                  className={`session-analysis-distribution-bar ${index * 10 < sessionDetailPassRate * 100 ? "fail" : "pass"}`}
                                  style={{ height: `${(count / maxCount) * 100}%` }}
                                  title={`${label}: ${count} student${count === 1 ? "" : "s"}`}
                                />
                              </div>
                              <div className="session-analysis-distribution-label">{label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isMockSessionDetail && (isImportedModelSummarySession || sessionDetailNestedSectionAverages.length) ? (
                <div className="admin-panel session-analysis-performance-panel">
                  <div className="admin-title" style={{ fontSize: 18 }}>Average Section Performance</div>
                  <div className="session-analysis-summary-grid">
                    <div className="session-radar-wrap">
                      {analysisRadarData.length ? (
                        buildSectionRadarSvg(analysisRadarData)
                      ) : (
                        <div className="admin-help">No section average data yet.</div>
                      )}
                    </div>
                    <div className="admin-table-wrap">
                      {isImportedModelSummarySession ? (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 520 }}>
                          <thead>
                            <tr>
                              <th>Section</th>
                              <th>Total</th>
                              <th>Average</th>
                              <th>Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailMainSectionAverages.map((row) => {
                              const isBelowPass = row.averageRate < sessionDetailPassRate;
                              return (
                                <tr key={`session-average-main-${row.section}`}>
                                  <td><span className="session-ranking-section-header">{renderTwoLineHeader(row.section)}</span></td>
                                  <td>{row.total}</td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {row.averageCorrect.toFixed(2)}
                                  </td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {(row.averageRate * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                            {!sessionDetailMainSectionAverages.length ? (
                              <tr>
                                <td colSpan={4}>No section average data yet.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      ) : (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 640 }}>
                          <colgroup>
                            <col className="session-section-average-col-section" />
                            <col className="session-section-average-col-subsection" />
                            <col className="session-section-average-col-total" />
                            <col className="session-section-average-col-correct" />
                            <col className="session-section-average-col-rate" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="session-section-average-head-section">Section</th>
                              <th className="session-section-average-head-subsection">Sub-section</th>
                              <th className="session-section-average-head-total">Total</th>
                              <th className="session-section-average-head-correct">Average</th>
                              <th className="session-section-average-head-rate">Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailNestedSectionAverages.map((group) => {
                              const rowSpan = 1 + group.subSections.length;
                              const isGroupBelowPass = group.averageRate < sessionDetailPassRate;
                              return (
                                <Fragment key={`session-average-group-${group.mainSection}`}>
                                  <tr className="attempt-overview-total-row session-section-average-total-row">
                                    <td rowSpan={rowSpan} className="attempt-overview-area-cell session-section-average-cell-section">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-section-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-subsection">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-total-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="attempt-score-detail-total-label">Total</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-total">{group.total}</td>
                                    <td className={`session-section-average-cell-correct ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {group.averageCorrect.toFixed(2)}
                                    </td>
                                    <td className={`session-section-average-cell-rate ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {(group.averageRate * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                  {group.subSections.map((subSection) => {
                                    const isSubSectionBelowPass = subSection.averageRate < sessionDetailPassRate;
                                    return (
                                      <tr
                                        key={`session-average-sub-${group.mainSection}-${subSection.section}`}
                                        className="session-section-average-subsection-row"
                                        onClick={() => openSessionDetailAnalysisPopupFor("subSection", subSection.section)}
                                        onKeyDown={(event) => handleSessionDetailAnalysisRowKeyDown(event, "subSection", subSection.section)}
                                        tabIndex={0}
                                        role="button"
                                      >
                                        <td className="session-section-average-cell-subsection">{subSection.section}</td>
                                        <td className="session-section-average-cell-total">{subSection.total}</td>
                                        <td className={`session-section-average-cell-correct ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {subSection.averageCorrect.toFixed(2)}
                                        </td>
                                        <td className={`session-section-average-cell-rate ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {(subSection.averageRate * 100).toFixed(1)}%
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {!isImportedSummarySession ? (
              <>
                <div className="session-detail-analysis-grid">
                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Best Questions</div>
                    <div className="session-analysis-list">
                      {bestQuestions.map((row) => (
                        <div key={`best-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-title">{row.qid}</div>
                            <div className="admin-help">{row.prompt}</div>
                          </div>
                        </div>
                      ))}
                      {!bestQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>

                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Worst Questions</div>
                    <div className="session-analysis-list">
                      {worstQuestions.map((row) => (
                        <div key={`worst-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-title">{row.qid}</div>
                            <div className="admin-help">{row.prompt}</div>
                          </div>
                        </div>
                      ))}
                      {!worstQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>
                </div>
 
                <div style={{ marginTop: 14 }}>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => setSessionDetailShowAllAnalysis((current) => !current)}
                  >
                    {sessionDetailShowAllAnalysis ? "Hide all v" : "View all ->"}
                  </button>
                </div>

                {sessionDetailShowAllAnalysis ? (
                  <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                    <table className="admin-table session-analysis-table" style={{ minWidth: 1100 }}>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Accuracy</th>
                          {sessionDetailQuestionStudents.map((student) => (
                            <th key={`analysis-student-${student.id}`}>
                              <div>{student.display_name}</div>
                              {student.student_code ? (
                                <div className="session-analysis-student-code">{student.student_code}</div>
                              ) : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetailQuestionAnalysis.map((row) => (
                          <tr key={`analysis-row-${row.qid}`}>
                            <td>
                              <div style={{ fontWeight: 800 }}>{row.qid}</div>
                              <div className="admin-help">{row.prompt}</div>
                            </td>
                            <td>{(row.rate * 100).toFixed(1)}%</td>
                            {sessionDetailQuestionStudents.map((student) => {
                              const status = row.byStudent[student.id];
                              return (
                                <td key={`analysis-cell-${row.qid}-${student.id}`} className="session-analysis-cell">
                                  {status == null ? "—" : status ? "○" : "×"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {!sessionDetailQuestionAnalysis.length ? (
                          <tr>
                            <td colSpan={Math.max(2, sessionDetailQuestionStudents.length + 2)}>No question analysis available.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {sessionDetailAnalysisPopup.open ? (
          <div className="admin-modal-overlay" onClick={closeSessionDetailAnalysisPopup}>
            <div className="admin-modal admin-modal-wide session-analysis-popup-modal" onClick={(event) => event.stopPropagation()}>
              <div className="admin-modal-header">
                <div>
                  <div className="admin-title">{sessionDetailAnalysisPopup.title || "Questions"}</div>
                  <div className="admin-help">
                    Total: <b>{analysisPopupQuestions.length}</b>
                  </div>
                </div>
                <button className="admin-modal-close" onClick={closeSessionDetailAnalysisPopup} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="session-analysis-popup-body">
                {analysisPopupQuestions.length ? (
                  analysisPopupQuestions.map((question, index) => (
                    <QuestionPreviewCard
                      key={`session-analysis-popup-${question.id}-${index}`}
                      question={question}
                      index={index}
                    />
                  ))
                ) : (
                  <div className="admin-help">No questions found for this selection.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="admin-login-screen">
        <div className="admin-login admin-login-card">
          <div className="admin-login-header">
            <img className="admin-login-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
            <h1 className="admin-login-title">Admin Panel Login</h1>
          </div>
          <div className="admin-login-divider" />
          <form
            className="admin-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleLogin();
            }}
          >
            <label className="admin-login-label" htmlFor="adminLoginEmail">Username</label>
            <input
              id="adminLoginEmail"
              className="admin-login-input"
              type="email"
              autoComplete="username"
              placeholder="example@gmail.com"
              value={loginForm.email}
              onChange={(e) => setLoginForm((s) => ({ ...s, email: e.target.value }))}
              onKeyDown={handleAdminLoginKeyDown}
            />
            <label className="admin-login-label" htmlFor="adminLoginPassword">Password</label>
            <div className="admin-login-password">
              <input
                id="adminLoginPassword"
                className="admin-login-input admin-login-input-password"
                type={showLoginPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value }))}
                onKeyDown={handleAdminLoginKeyDown}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showLoginPassword ? "Hide password" : "Show password"}
                onClick={() => setShowLoginPassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showLoginPassword} />
              </button>
            </div>
            <button className="admin-login-submit" type="submit">LOGIN</button>
          </form>
          <div className={`admin-login-msg ${loginMsg ? "visible" : ""}`}>{loginMsg || "\u00a0"}</div>
        </div>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="admin-login">
        <h2>{loginMsg ? "Startup Error" : "Loading..."}</h2>
        {loginMsg ? <div className="admin-msg">{loginMsg}</div> : null}
      </div>
    );
  }

  if (profile.account_status === "active" && profile.force_password_change) {
    return (
      <div className="admin-login-screen">
        <div className="admin-login admin-login-card admin-password-card">
          <div className="admin-password-change-head">
            <h2 className="admin-password-change-title">Set New Password</h2>
            <p className="admin-password-change-copy">
              This account must set a new password before continuing.
            </p>
            <p className="admin-password-change-note">Use at least 8 characters for your new password.</p>
          </div>
          <form
            className="admin-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              handlePasswordChange();
            }}
          >
            <label className="admin-login-label" htmlFor="adminPasswordChangeNew">New Password</label>
            <div className="admin-login-password">
              <input
                id="adminPasswordChangeNew"
                className="admin-login-input admin-login-input-password"
                type={showPasswordChangePassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="new password"
                value={passwordChangeForm.password}
                onChange={(e) => setPasswordChangeForm((s) => ({ ...s, password: e.target.value }))}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showPasswordChangePassword ? "Hide password" : "Show password"}
                onClick={() => setShowPasswordChangePassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showPasswordChangePassword} />
              </button>
            </div>

            <label className="admin-login-label" htmlFor="adminPasswordChangeConfirm">Confirm Password</label>
            <div className="admin-login-password">
              <input
                id="adminPasswordChangeConfirm"
                className="admin-login-input admin-login-input-password"
                type={showPasswordChangeConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="confirm password"
                value={passwordChangeForm.confirmPassword}
                onChange={(e) => setPasswordChangeForm((s) => ({ ...s, confirmPassword: e.target.value }))}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showPasswordChangeConfirmPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPasswordChangeConfirmPassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showPasswordChangeConfirmPassword} />
              </button>
            </div>

            <button className="admin-login-submit" type="submit" disabled={passwordChangeLoading}>
              {passwordChangeLoading ? "SAVING..." : "UPDATE PASSWORD"}
            </button>
            <button
              className="admin-password-change-secondary"
              type="button"
              onClick={() => supabase.auth.signOut()}
            >
              SIGN OUT
            </button>
          </form>
          <div className={`admin-login-msg ${passwordChangeMsg ? "visible" : ""}`}>
            {passwordChangeMsg || "\u00a0"}
          </div>
        </div>
      </div>
    );
  }

  if (
    !forcedSchoolId &&
    profile.role === "super_admin" &&
    profile.account_status === "active"
  ) {
    return (
      <div className="admin-login">
        <h2>Redirecting...</h2>
      </div>
    );
  }

  if (!canUseAdminConsole) {
    return (
      <div className="admin-login">
        <h2>Unauthorized</h2>
        <div className="admin-help">
          {profile.account_status !== "active"
            ? "This account is disabled."
            : profile.role === "super_admin"
            ? "Super Admin must enter a school from the Schools list before using the admin console."
            : "このユーザーは admin 権限ではありません。"}
        </div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          {profile.role === "super_admin" ? (
            <Link className="btn" href="/super/schools" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                <path
                  d="m15 6-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Go to Schools</span>
            </Link>
          ) : null}
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  function handleSidebarMenuClick(action) {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
    action();
  }

  const displayName = profile?.display_name?.trim() || session?.user?.email || "User";
  const adminPageTitle = (() => {
    if (activeTab === "students") return "Student List";
    if (activeTab === "attendance") {
      return attendanceSubTab === "absence" ? "Absence Applications" : "Attendance Sheet";
    }
    if (activeTab === "dailyRecord") return "Schedule & Record";
    if (activeTab === "ranking") return "Ranking";
    if (activeTab === "announcements") return "Announcements";
    if (activeTab === "model") {
      if (sessionDetail.type === "mock" && sessionDetail.sessionId) return "Test Session Detail";
      if (modelSubTab === "results") return "Model Test Results";
      if (modelSubTab === "upload") return "Upload Question Set";
      if (modelSubTab === "sets") return "Sets";
      return "Test Sessions";
    }
    if (activeTab === "daily") {
      if (sessionDetail.type === "daily" && sessionDetail.sessionId) return "Daily Test Session Detail";
      if (dailySubTab === "results") return "Daily Test Results";
      if (dailySubTab === "upload") return "Upload Question Set";
      if (dailySubTab === "conduct") return "Daily Test Sessions";
      return "Daily Test Sessions";
    }
    return "Admin Console";
  })();

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="admin-sidebar-head">
          <div className="admin-brand">
            <div className="admin-brand-text">
              <div className="admin-brand-title">
                <img className="admin-brand-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
              </div>
              <div className="admin-brand-sub">Admin Console</div>
            </div>
          </div>
          <button
            className="admin-sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <svg viewBox="0 0 24 24" className="admin-sidebar-toggle-icon" aria-hidden="true">
              {sidebarCollapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
            </svg>
          </button>
        </div>
        <div className="admin-nav">
          <button
            className={`admin-nav-item ${activeTab === "students" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(() => setActiveTab("students"))}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <circle cx="8" cy="8" r="3" />
                <circle cx="16" cy="9" r="3" />
                <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
                <path d="M12 19c1-2 3-3 5-3 2.5 0 4 1.4 4 4" />
              </svg>
            </span>
            Student List
          </button>

          <div className={`admin-nav-group ${activeTab === "attendance" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "attendance" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => {
                setActiveTab("attendance");
                setAttendanceSubTab("sheet");
              })}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <rect x="4" y="5" width="16" height="15" rx="2" />
                  <path d="M8 3v4M16 3v4M4 9h16" />
                </svg>
              </span>
              Attendance
              <span className={`admin-nav-arrow ${activeTab === "attendance" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "attendance" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${attendanceSubTab === "sheet" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("attendance");
                    setAttendanceSubTab("sheet");
                  })}
                >
                  Attendance Sheet
                </button>
                <button
                  className={`admin-subnav-item ${attendanceSubTab === "absence" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("attendance");
                    setAttendanceSubTab("absence");
                  })}
                >
                  Absence Applications
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "model" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "model" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => {
                setActiveTab("model");
                setModelSubTab("results");
              })}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <path d="M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3V5z" />
                  <path d="M8 5v14" />
                </svg>
              </span>
              Model Test
              <span className={`admin-nav-arrow ${activeTab === "model" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "model" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${modelSubTab === "results" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("model");
                    setModelSubTab("results");
                  })}
                >
                  Model Test Results
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "conduct" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("model");
                    setModelSubTab("conduct");
                  })}
                >
                  Create Test Session
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "upload" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("model");
                    setModelSubTab("upload");
                  })}
                >
                  Upload Question Set
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "daily" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "daily" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => {
                setActiveTab("daily");
                setDailySubTab("results");
              })}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <path d="M7 4h7l4 4v12H7z" />
                  <path d="M14 4v4h4" />
                  <path d="M9 12h6M9 16h6" />
                </svg>
              </span>
              Daily Test
              <span className={`admin-nav-arrow ${activeTab === "daily" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "daily" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${dailySubTab === "results" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("daily");
                    setDailySubTab("results");
                  })}
                >
                  Daily Test Results
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "conduct" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("daily");
                    setDailySubTab("conduct");
                  })}
                >
                  Create Test Session
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "upload" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("daily");
                    setDailySubTab("upload");
                  })}
                >
                  Upload Question Set
                </button>
              </div>
            ) : null}
          </div>

          <button
            className={`admin-nav-item ${activeTab === "dailyRecord" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(() => setActiveTab("dailyRecord"))}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <path d="M6 4h12v16H6z" />
                <path d="M9 8h6M9 12h6M9 16h4" />
              </svg>
            </span>
            Schedule & Record
          </button>

          <button
            className={`admin-nav-item ${activeTab === "ranking" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(() => setActiveTab("ranking"))}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <path d="M5 19h14" />
                <path d="M7 17V9" />
                <path d="M12 17V5" />
                <path d="M17 17v-6" />
              </svg>
            </span>
            Ranking
          </button>

          <button
            className={`admin-nav-item ${activeTab === "announcements" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(() => setActiveTab("announcements"))}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <path d="M4 4h16v12H7l-3 3z" />
                <path d="M7 8h10M7 12h6" />
              </svg>
            </span>
            Announcements
          </button>
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-email">{session.user.email}</div>
          {forcedSchoolId && profile?.role === "super_admin" ? (
            <Link className="admin-nav-item" href={homeHref}>{homeLabel}</Link>
          ) : null}
          <button className="admin-nav-item logout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-wrap">
          <div className="admin-page-topbar">
            <div className="admin-page-topbar-title">{adminPageTitle}</div>
            <div className="admin-page-topbar-meta">
              {forcedSchoolId && profile?.role === "super_admin" ? (
                <div className="admin-school-switcher admin-topbar-school-switcher">
                  <label htmlFor="admin-school-switcher">School</label>
                  <select
                    id="admin-school-switcher"
                    value={activeSchoolId ?? ""}
                    onChange={(event) => handleForcedSchoolScopeChange(event.target.value)}
                  >
                    {forcedSchoolOptions.map((schoolOption) => (
                      <option key={schoolOption.school_id} value={schoolOption.school_id}>
                        {schoolOption.school_name}
                        {schoolOption.school_status === "inactive" ? " (Inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {!forcedSchoolId && profile?.role === "admin" ? (
                <div className="admin-school-switcher admin-topbar-school-switcher">
                  <label htmlFor="admin-school-switcher">School</label>
                  {schoolAssignments.length > 1 ? (
                    <select
                      id="admin-school-switcher"
                      value={activeSchoolId ?? ""}
                      onChange={(event) => handleAdminSchoolScopeChange(event.target.value)}
                    >
                      {schoolAssignments.map((assignment) => (
                        <option key={assignment.school_id} value={assignment.school_id}>
                          {assignment.school_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="admin-topbar-school-label">
                      {schoolAssignments[0]?.school_name ?? activeSchoolName}
                    </div>
                  )}
                </div>
              ) : null}
              {changeSchoolHref && profile?.role !== "super_admin" ? (
                <Link className="btn admin-topbar-link" href={changeSchoolHref}>Change school</Link>
              ) : null}
              <div className="admin-page-topbar-console">Admin Console</div>
              <div className="admin-page-topbar-user">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" />
                  <path d="M4 20a8 8 0 0 1 16 0Z" fill="currentColor" />
                </svg>
                <span>{displayName}</span>
              </div>
            </div>
          </div>

          <div className="admin-panel admin-console-panel">

        {activeTab === "students" ? (
        <div style={{ marginBottom: 12 }}>
          {!studentDetailOpen ? (
            <>
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, flexWrap: "wrap" }}>
                <div className="admin-title">Student List</div>
                <button className="btn btn-primary student-list-primary-btn" onClick={() => setInviteOpen(true)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>Add New Student</span>
                </button>
                <button
                  className="btn student-list-primary-btn student-warning-launch-btn"
                  onClick={openStudentWarningsModal}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span>Warnings</span>
                </button>
                <button
                  className="btn student-list-primary-btn"
                  type="button"
                  onClick={() => void handleLoadStudentMetrics()}
                  disabled={studentListLoading}
                  aria-label={studentListLoading ? "Loading metrics" : studentListMetricsLoaded ? "Refresh metrics" : "Load metrics"}
                  title={studentListLoading ? "Loading metrics..." : studentListMetricsLoaded ? "Refresh metrics" : "Load metrics"}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M16 10a6 6 0 1 1-1.76-4.24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 4.5v3.75h-3.75"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{studentListLoading ? "Loading Metrics..." : studentListMetricsLoaded ? "Refresh Metrics" : "Load Metrics"}</span>
                </button>
                <button
                  className="btn student-list-primary-btn"
                  type="button"
                  onClick={() => void handleLoadStudentWarnings()}
                  disabled={studentWarningsLoading}
                  aria-label={studentWarningsLoading ? "Loading warnings" : studentWarningsLoaded ? "Refresh warnings" : "Load warnings"}
                  title={studentWarningsLoading ? "Loading warnings..." : studentWarningsLoaded ? "Refresh warnings" : "Load warnings"}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M16 10a6 6 0 1 1-1.76-4.24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 4.5v3.75h-3.75"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>{studentWarningsLoading ? "Loading Warnings..." : studentWarningsLoaded ? "Refresh Warnings" : "Load Warnings"}</span>
                </button>
              </div>

              <div className="attendance-filter-box" style={{ marginTop: 14 }}>
                <div className="admin-form" style={{ marginTop: 0 }}>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />(Attendance Rate ≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="e.g. 80"
                      value={studentListFilters.maxAttendance}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, maxAttendance: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />(Unexcused ≥)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 3"
                      value={studentListFilters.minUnexcused}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, minUnexcused: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />(Model Avg Rate ≥)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="e.g. 60"
                      value={studentListFilters.minModelAvg}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, minModelAvg: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />(Daily Avg Rate ≥)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      placeholder="e.g. 60"
                      value={studentListFilters.minDailyAvg}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, minDailyAvg: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />Date From</label>
                    <input
                      type="date"
                      value={studentListFilters.from}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, from: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label className="student-list-filter-label">Filter<br />Date To</label>
                    <input
                      type="date"
                      value={studentListFilters.to}
                      onChange={(e) => setStudentListFilters((s) => ({ ...s, to: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th>Student<br />No.</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Attendance<br />Rate</th>
                      <th>Unexcused<br />Absence</th>
                      <th>Model Avg<br />Rate</th>
                      <th>Daily Avg<br />Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentListRows.map((row) => {
                      const s = row.student;
                      const rateLabel = row.attendanceRate == null ? "-" : `${row.attendanceRate.toFixed(1)}%`;
                      const modelLabel = row.modelAvg == null ? "-" : `${row.modelAvg.toFixed(1)}%`;
                      const dailyLabel = row.dailyAvg == null ? "-" : `${row.dailyAvg.toFixed(1)}%`;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => {
                            void openStudentDetail(s.id);
                          }}
                          className={s.is_withdrawn ? "row-withdrawn" : ""}
                        >
                          <td>{s.student_code ?? ""}</td>
                          <td>
                            <div className="student-list-name-cell">
                              <span>{s.display_name ?? ""}</span>
                              {studentWarningCounts[s.id] ? (
                                <button
                                  type="button"
                                  className="student-warning-badge student-warning-badge-btn"
                                  title={`${studentWarningCounts[s.id]} warning(s) issued`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setStudentWarningPreviewStudentId(s.id);
                                  }}
                                >
                                  !
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td>{s.email ?? ""}</td>
                          <td>{rateLabel}</td>
                          <td>{row.unexcused ?? 0}</td>
                          <td>{modelLabel}</td>
                          <td>{dailyLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!studentListMetricsLoaded && !studentListLoading ? (
                <div className="admin-help" style={{ marginTop: 6 }}>
                  Metrics are not loaded yet. Click <b>Load Metrics</b> to calculate attendance and test averages.
                </div>
              ) : null}
              {!studentWarningsLoaded && !studentWarningsLoading ? (
                <div className="admin-help" style={{ marginTop: 6 }}>
                  Warnings are not loaded yet. Click <b>Load Warnings</b> to show warning badges and warning history.
                </div>
              ) : null}
              {studentListLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading metrics...</div> : null}
              {studentWarningsLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading warnings...</div> : null}
              <div className="admin-msg">{studentMsg}</div>

              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="admin-help">
                  CSV: <b>email,display_name,student_code,temp_password</b>
                </div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleCsvFile(e.target.files?.[0])}
                />
                <div className="admin-help">{csvMsg}</div>
              </div>
            </>
          ) : null}

          {selectedStudentId && studentDetailOpen ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      className="admin-icon-btn"
                      onClick={() => {
                        setStudentDetailOpen(false);
                        setSelectedStudentId("");
                      }}
                      aria-label="Back"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                        <path
                          d="m15 6-6 6 6 6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <div className="admin-title">
                      {selectedStudent?.display_name ?? ""} {selectedStudent?.student_code ? `(${selectedStudent.student_code})` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn student-detail-action-btn"
                    onClick={exportStudentReportPdf}
                    disabled={studentReportExporting || studentDetailLoading}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M10 3v8m0 0 3-3m-3 3-3-3M4 13.5v1.25C4 15.44 4.56 16 5.25 16h9.5c.69 0 1.25-.56 1.25-1.25V13.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {studentReportExporting ? "Exporting..." : "Export PDF"}
                  </button>
                  <button
                    className="btn student-detail-action-btn"
                    onClick={() => {
                      if (!selectedStudent) return;
                      setReissueStudent(selectedStudent);
                      setReissuePassword("");
                      setReissueIssuedPassword("");
                      setReissueLoading(false);
                      setReissueMsg("");
                      setReissueOpen(true);
                    }}
                  >
                    Reissue Temp Pass
                  </button>
                  <div className="student-detail-toggle-card">
                    <span className="student-detail-toggle-label">Test Account</span>
                    <label className="daily-session-create-switch" aria-label="Test Account">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedStudent?.is_test_account)}
                        onChange={(event) => {
                          if (!selectedStudent) return;
                          toggleTestAccount(selectedStudent, event.target.checked);
                        }}
                      />
                      <span className="daily-session-create-switch-slider" />
                    </label>
                  </div>
                  <button
                    className={`btn student-detail-action-btn ${selectedStudent?.is_withdrawn ? "btn-withdrawn" : ""}`}
                    onClick={() => {
                      if (!selectedStudent) return;
                      toggleWithdrawn(selectedStudent, !selectedStudent.is_withdrawn);
                    }}
                  >
                    {selectedStudent?.is_withdrawn ? "Withdrawn" : "Withdraw"}
                  </button>
                  <button
                    className="btn btn-danger student-detail-action-btn"
                    onClick={() => {
                      if (!selectedStudent) return;
                      deleteStudent(selectedStudent.id, selectedStudent.email);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="student-detail-tab-row">
                <div className="admin-top-tabs student-detail-tabs">
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "information" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("information");
                    }}
                  >
                    Information
                  </button>
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "attendance" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("attendance");
                      fetchStudentAttendance(selectedStudentId);
                    }}
                  >
                    Attendance
                  </button>
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "daily" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("daily");
                      fetchStudentAttempts(selectedStudentId);
                    }}
                  >
                    Daily Test
                  </button>
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "model" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("model");
                      fetchStudentAttempts(selectedStudentId);
                    }}
                  >
                    Model Test
                  </button>
                </div>
              </div>

              {selectedStudentTab === "information" ? (
                <>
                  <div className="student-info-panel" style={{ marginTop: 12 }}>
                    <div className="student-info-panel-header">
                      <div>
                        <div className="admin-title">Personal Information</div>
                        <div className="admin-subtitle">Shared student profile data visible from both student and admin portals.</div>
                      </div>
                      <button
                        className="btn btn-primary"
                        disabled={studentDetailLoading || !hasStudentDetailFields(selectedStudent)}
                        onClick={() => {
                          setStudentInfoForm(getPersonalInfoForm(selectedStudent));
                          setStudentInfoUploadFiles({});
                          setStudentInfoMsg("");
                          setStudentInfoOpen(true);
                        }}
                      >
                        Edit Information
                      </button>
                    </div>
                    {studentDetailLoading ? (
                      <div className="admin-help" style={{ marginTop: 10 }}>
                        Loading full student details...
                      </div>
                    ) : null}
                    {studentDetailMsg ? (
                      <div className="admin-msg">{studentDetailMsg}</div>
                    ) : null}
                    <div className="student-info-grid admin-student-info-grid">
                      {[
                        { label: "Full Name", value: selectedStudent?.display_name || "-" },
                        { label: "Email", value: selectedStudent?.email || "-" },
                        { label: "Student No.", value: selectedStudent?.student_code || "-" },
                        { label: "Phone Number", value: selectedStudent?.phone_number || "-" },
                        {
                          label: "Date of Birth",
                          value: selectedStudent?.date_of_birth
                            ? `${formatDateFull(selectedStudent.date_of_birth)}${calculateAge(selectedStudent.date_of_birth) != null ? ` • Age ${calculateAge(selectedStudent.date_of_birth)}` : ""}`
                            : "-"
                        },
                        { label: "Sex", value: selectedStudent?.sex || "-" },
                        { label: "Current Working Facility", value: selectedStudent?.current_working_facility || "-" },
                        {
                          label: "Years of Experience",
                          value: formatYearsOfExperience(selectedStudent?.years_of_experience) || "-"
                        },
                        { label: "Nursing Certificate", value: selectedStudent?.nursing_certificate || "-" },
                        { label: "Certificate Status", value: selectedStudent?.nursing_certificate_status || "-" },
                        { label: "BNMC Registration Number", value: selectedStudent?.bnmc_registration_number || "-" },
                        {
                          label: "BNMC Registration Expiry Date",
                          value: selectedStudent?.bnmc_registration_expiry_date
                            ? formatDateFull(selectedStudent.bnmc_registration_expiry_date)
                            : "-"
                        },
                        { label: "Passport Number", value: selectedStudent?.passport_number || "-" },
                        ...PERSONAL_UPLOAD_FIELDS.map((field) => ({
                          label: field.label,
                          value: renderProfileUpload(getProfileUploads(selectedStudent?.profile_uploads)[field.key], field.label),
                          wide: true
                        }))
                      ].map((item) => (
                        <div key={item.label} className={`student-info-row ${item.wide ? "student-info-row-wide" : ""}`}>
                          <div className="student-info-label">{item.label}</div>
                          <div className="student-info-value">{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {selectedStudentTab === "model" ? (
                <>
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 640 }}>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Average Score</th>
                          <th>Average Rate</th>
                          <th>Pass</th>
                          <th>Fail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentModelCategorySummaryRows.length ? studentModelCategorySummaryRows.map((row) => (
                          <tr key={`student-model-summary-${row.category}`}>
                            <td>{row.category}</td>
                            <td>{row.averageScoreLabel}</td>
                            <td>{row.averageRateLabel}</td>
                            <td>{row.passCount}</td>
                            <td>{row.failCount}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={5}>No model test records.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 980 }}>
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Date</th>
                          <th>Total Score</th>
                          <th>Rate</th>
                          <th>P/F</th>
                          <th>Class Rank</th>
                          {sectionTitles.map((title) => (
                            <th key={`sec-${title}`} className="admin-table-compact">
                              {renderTwoLineHeader(title)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {studentModelAttempts.map((a) => {
                          const score = `${a.correct}/${a.total}`;
                          const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                          const passRate = getAttemptEffectivePassRate(a);
                          const passed = getScoreRate(a) >= passRate;
                          const rankInfo = studentAttemptRanks[a.id];
                          const summary = studentAttemptSummaryById[a.id] || {};
                          return (
                            <tr
                              key={`student-model-${a.id}`}
                              onClick={() => openAttemptDetail(a)}
                            >
                              <td>{getAttemptTitle(a)}</td>
                              <td>{formatDateFull(getAttemptDisplayDateValue(a))}</td>
                              <td>{score}</td>
                              <td>{rate}</td>
                              <td>
                                <span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span>
                              </td>
                              <td>{rankInfo ? `${rankInfo.rank}/${rankInfo.total}` : "-"}</td>
                              {sectionTitles.map((title) => {
                                const s = summary[title];
                                return (
                                  <td key={`${a.id}-${title}`} className="admin-table-compact">
                                    {s ? `${s.correct}/${s.total}` : "-"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{studentAttemptsMsg}</div>
                </>
              ) : null}

              {selectedStudentTab === "daily" ? (
                <>
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 640 }}>
                      <thead>
                        <tr>
                          <th>Category</th>
                          <th>Average Score</th>
                          <th>Average Rate</th>
                          <th>Pass</th>
                          <th>Fail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {studentDailyCategorySummaryRows.length ? studentDailyCategorySummaryRows.map((row) => (
                          <tr key={`student-daily-summary-${row.category}`}>
                            <td>{row.category}</td>
                            <td>{row.averageScoreLabel}</td>
                            <td>{row.averageRateLabel}</td>
                            <td>{row.passCount}</td>
                            <td>{row.failCount}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={5}>No daily test records.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {studentDailyAttemptsByCategory.map(([category, items]) => (
                    <div key={`daily-${category}`} style={{ marginTop: 12 }}>
                      <div className="admin-subtitle" style={{ fontWeight: 900 }}>{category}</div>
                      <div className="admin-table-wrap" style={{ marginTop: 8 }}>
                        <table className="admin-table" style={{ minWidth: 820 }}>
                          <thead>
                            <tr>
                              <th>Test</th>
                              <th>Date</th>
                              <th>Score</th>
                              <th>Rate</th>
                              <th>P/F</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((a) => {
                              const score = `${a.correct}/${a.total}`;
                              const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                              const passRate = getAttemptEffectivePassRate(a);
                              const passed = getScoreRate(a) >= passRate;
                              return (
                                <tr key={`student-daily-${a.id}`} onClick={() => openAttemptDetail(a)}>
                                  <td>{getAttemptTitle(a)}</td>
                                  <td>{formatDateFull(getAttemptDisplayDateValue(a))}</td>
                                  <td>{score}</td>
                                  <td>{rate}</td>
                                  <td>
                                    <span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  <div className="admin-msg">{studentAttemptsMsg}</div>
                </>
              ) : null}

              {selectedStudentTab === "attendance" ? (
                <>
                  <div className="student-attendance-summary-section" style={{ marginTop: 10 }}>
                    <div className="student-attendance-summary-top">
                      <div className="student-attendance-pie-panel">
                        <div className="student-attendance-month-bar">
                          <button
                            className="student-attendance-month-nav"
                            type="button"
                            onClick={() => studentAttendancePrevMonthKey && setStudentAttendanceMonthKey(studentAttendancePrevMonthKey)}
                            disabled={!studentAttendancePrevMonthKey}
                            aria-label="Previous month"
                          >
                            ‹
                          </button>
                          <div className="student-attendance-month-label">
                            <select
                              className="student-attendance-month-select"
                              value={selectedStudentAttendanceMonth.key}
                              onChange={(e) => setStudentAttendanceMonthKey(e.target.value)}
                            >
                              {studentAttendanceMonthOptions.map((option) => (
                                <option key={`student-attendance-month-${option.key}`} value={option.key}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <button
                            className="student-attendance-month-nav"
                            type="button"
                            onClick={() => studentAttendanceNextMonthKey && setStudentAttendanceMonthKey(studentAttendanceNextMonthKey)}
                            disabled={!studentAttendanceNextMonthKey}
                            aria-label="Next month"
                          >
                            ›
                          </button>
                        </div>

                        <div className="student-attendance-pie-wrap">
                          <div
                            className="student-attendance-pie"
                            style={{ "--pie-bg": `conic-gradient(${studentAttendancePie.pieStops})` }}
                          >
                            <div className="student-attendance-pie-labels">
                              {studentAttendancePie.pieLabels.map((item) => (
                                <span
                                  key={`student-attendance-pie-${item.key}`}
                                  className="student-attendance-pie-label"
                                  style={{ "--x": `${item.x.toFixed(1)}px`, "--y": `${item.y.toFixed(1)}px` }}
                                >
                                  {item.label}
                                </span>
                              ))}
                            </div>
                            <div className="student-attendance-pie-center">
                              <div className="student-attendance-rate">{studentAttendancePie.rateValue.toFixed(1)}%</div>
                              <div className="student-attendance-rate-label">Attendance Rate</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="admin-table-wrap">
                        <table className="admin-table" style={{ minWidth: 760 }}>
                          <thead>
                            <tr>
                              <th></th>
                              <th>Overall</th>
                              {attendanceSummary.months.map((m) => (
                                <th key={m.key}>{m.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Attendance %</td>
                              <td>{attendanceSummary.overall.rate == null ? "N/A" : `${attendanceSummary.overall.rate.toFixed(2)}%`}</td>
                              {attendanceSummary.months.map((m) => (
                                <td key={`${m.key}-rate`}>{m.stats.rate == null ? "N/A" : `${m.stats.rate.toFixed(2)}%`}</td>
                            ))}
                          </tr>
                          <tr>
                            <td>Total Days</td>
                            <td>{attendanceSummary.overall.total || "-"}</td>
                              {attendanceSummary.months.map((m) => (
                              <td key={`${m.key}-total`}>{m.stats.total || "-"}</td>
                            ))}
                          </tr>
                          <tr>
                            <td>Present (P)</td>
                            <td>{attendanceSummary.overall.present || "-"}</td>
                            {attendanceSummary.months.map((m) => (
                              <td key={`${m.key}-present`}>{m.stats.present || "-"}</td>
                            ))}
                          </tr>
                          <tr>
                            <td>Late/Left Early (L)</td>
                            <td>{attendanceSummary.overall.late || "-"}</td>
                            {attendanceSummary.months.map((m) => (
                              <td key={`${m.key}-late`}>{m.stats.late || "-"}</td>
                            ))}
                          </tr>
                          <tr>
                            <td>Excused Absence (E)</td>
                            <td>{attendanceSummary.overall.excused || "-"}</td>
                            {attendanceSummary.months.map((m) => (
                              <td key={`${m.key}-excused`}>{m.stats.excused || "-"}</td>
                            ))}
                          </tr>
                          <tr>
                            <td>Unexcused Absence (A)</td>
                            <td>{attendanceSummary.overall.unexcused || "-"}</td>
                            {attendanceSummary.months.map((m) => (
                              <td key={`${m.key}-unexcused`}>{m.stats.unexcused || "-"}</td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="admin-form" style={{ marginTop: 10 }}>
                    <div className="field small">
                      <label>From</label>
                      <input
                        type="date"
                        value={studentAttendanceRange.from}
                        onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, from: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>To</label>
                      <input
                        type="date"
                        value={studentAttendanceRange.to}
                        onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, to: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>&nbsp;</label>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setStudentAttendanceRange({ from: "", to: "" })}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Status</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudentAttendance.map((r, idx) => (
                          <tr key={`att-row-${idx}`}>
                            <td>{`${formatDateShort(r.day_date)} (${formatWeekday(r.day_date)})`}</td>
                            <td>{r.status}</td>
                            <td>{r.comment}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{studentAttendanceMsg}</div>
                </>
              ) : null}
            </div>
          ) : null}

          {studentWarningIssueOpen ? (
            <div className="admin-modal-overlay" onClick={() => setStudentWarningIssueOpen(false)}>
              <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Warnings</div>
                  <button className="admin-modal-close" onClick={() => setStudentWarningIssueOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="student-warning-history" style={{ marginTop: 10 }}>
                  <div className="student-warning-history-head">
                    <div className="admin-title" style={{ fontSize: 18 }}>Issued Warnings</div>
                    {studentWarningsLoading ? <div className="admin-help">Loading warnings...</div> : null}
                  </div>
                  <div className="student-warning-history-list">
                    {studentWarnings.map((warning) => {
                      const summary = summarizeWarningCriteria(warning.criteria);
                      return (
                        <button
                          key={warning.id}
                          type="button"
                          className="student-warning-card"
                          onClick={() => setSelectedStudentWarning(warning)}
                        >
                          <div className="student-warning-card-title">{warning.title || "Warning"}</div>
                          <div className="student-warning-card-meta">
                            {formatDateTime(warning.created_at)} · {warning.student_count || warning.recipients?.length || 0} student{(warning.student_count || warning.recipients?.length || 0) === 1 ? "" : "s"}
                          </div>
                          <div className="student-warning-card-summary">
                            {(summary.length ? summary : ["No criteria summary"]).join(" / ")}
                          </div>
                        </button>
                      );
                    })}
                    {!studentWarningsLoading && !studentWarnings.length ? (
                      <div className="admin-help">No warnings issued yet.</div>
                    ) : null}
                  </div>
                  {studentWarningsMsg ? <div className="admin-msg">{studentWarningsMsg}</div> : null}
                </div>
                <div className="admin-title" style={{ fontSize: 18, marginTop: 14 }}>Create Warning</div>
                <div className="admin-form" style={{ marginTop: 10, gridTemplateColumns: "1fr" }}>
                  <div className="field">
                    <label>Title (optional)</label>
                    <input
                      value={studentWarningForm.title}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Warning title"
                    />
                  </div>
                  <div className="field">
                    <label>Date From</label>
                    <input
                      type="date"
                      value={studentWarningForm.from}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, from: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Date To</label>
                    <input
                      type="date"
                      value={studentWarningForm.to}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, to: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Attendance % (≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={studentWarningForm.maxAttendance}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxAttendance: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Unexcused (≥)</label>
                    <input
                      type="number"
                      min="0"
                      value={studentWarningForm.minUnexcused}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, minUnexcused: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Model Avg % (≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={studentWarningForm.maxModelAvg}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxModelAvg: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Daily Avg % (≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={studentWarningForm.maxDailyAvg}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxDailyAvg: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="admin-help" style={{ marginTop: 10 }}>
                  Students are included if they match any selected warning threshold.
                </div>
                {studentWarningIssueMsg ? <div className="admin-msg">{studentWarningIssueMsg}</div> : null}
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={issueStudentWarning} disabled={studentWarningIssueSaving}>
                    {studentWarningIssueSaving ? "Issuing..." : "Issue Warning"}
                  </button>
                  <button className="btn" onClick={() => setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters))}>
                    Reset
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {selectedStudentWarning ? (
            <div className="admin-modal-overlay" onClick={() => setSelectedStudentWarning(null)}>
              <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div>
                    <div className="admin-title">{selectedStudentWarning.title || "Warning"}</div>
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      {formatDateTime(selectedStudentWarning.created_at)} · {selectedStudentWarning.student_count || selectedStudentWarning.recipients?.length || 0} student{(selectedStudentWarning.student_count || selectedStudentWarning.recipients?.length || 0) === 1 ? "" : "s"}
                    </div>
                  </div>
                  <button className="admin-modal-close" onClick={() => setSelectedStudentWarning(null)} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="admin-help" style={{ marginTop: 10 }}>
                  {(summarizeWarningCriteria(selectedStudentWarning.criteria).length
                    ? summarizeWarningCriteria(selectedStudentWarning.criteria)
                    : ["No criteria summary"]
                  ).join(" / ")}
                </div>
                <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                  <table className="admin-table" style={{ minWidth: 760 }}>
                    <thead>
                      <tr>
                        <th>Student<br />No.</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedStudentWarning.recipients ?? []).map((recipient) => {
                        const student = students.find((item) => item.id === recipient.student_id) ?? null;
                        return (
                          <tr key={`warning-recipient-${recipient.id}`}>
                            <td>{student?.student_code ?? ""}</td>
                            <td>{student?.display_name ?? recipient.student_id}</td>
                            <td>{student?.email ?? ""}</td>
                            <td>{(recipient.issues ?? []).join(" / ") || "-"}</td>
                          </tr>
                        );
                      })}
                      {!(selectedStudentWarning.recipients ?? []).length ? (
                        <tr>
                          <td colSpan={4}>No recipients found.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => deleteStudentWarning(selectedStudentWarning)}
                    disabled={studentWarningDeletingId === selectedStudentWarning.id}
                  >
                    {studentWarningDeletingId === selectedStudentWarning.id ? "Deleting..." : "Delete Warning"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {studentWarningPreviewStudentId ? (
            <div className="admin-modal-overlay" onClick={() => setStudentWarningPreviewStudentId("")}>
              <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div>
                    <div className="admin-title">Applied Warnings</div>
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      {studentWarningPreviewStudent?.display_name || studentWarningPreviewStudent?.email || studentWarningPreviewStudentId}
                    </div>
                  </div>
                  <button className="admin-modal-close" onClick={() => setStudentWarningPreviewStudentId("")} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="student-warning-history-list" style={{ marginTop: 12 }}>
                  {studentWarningPreviewEntries.map(({ warning, recipient }) => {
                    const summary = summarizeWarningCriteria(warning.criteria);
                    return (
                      <button
                        key={`student-warning-preview-${warning.id}-${recipient.id}`}
                        type="button"
                        className="student-warning-card"
                        onClick={() => {
                          setStudentWarningPreviewStudentId("");
                          setSelectedStudentWarning(warning);
                        }}
                      >
                        <div className="student-warning-card-title">{warning.title || "Warning"}</div>
                        <div className="student-warning-card-meta">
                          {formatDateTime(warning.created_at)}
                        </div>
                        <div className="student-warning-card-summary">
                          {(recipient.issues ?? []).join(" / ") || (summary.length ? summary.join(" / ") : "No criteria summary")}
                        </div>
                      </button>
                    );
                  })}
                  {!studentWarningPreviewEntries.length ? (
                    <div className="admin-help">No warnings found for this student.</div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "sheet" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "nowrap", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flex: "0 0 auto" }}>
              <div>
                <label style={{ display: "block", fontWeight: 800, marginBottom: 6, color: "var(--admin-text)" }}>Date</label>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  style={{
                    width: 190,
                    border: "1px solid var(--admin-control-border)",
                    borderRadius: 6,
                    padding: "10px 10px",
                    fontSize: 14,
                    fontFamily: "inherit",
                  }}
                />
              </div>
              <button className="btn btn-primary attendance-open-day-btn" type="button" onClick={() => openAttendanceDay(attendanceDate, { confirmExisting: true })}>
                Open Day
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "nowrap", justifyContent: "flex-end", marginLeft: "auto", alignSelf: "flex-start", flex: "0 0 auto" }}>
              <button className="btn results-page-action-btn" type="button" onClick={exportAttendanceGoogleSheetsCsv}>
                <span className="results-page-action-icon" aria-hidden="true">↓</span>
                <span>Export CSV</span>
              </button>
              <button
                className="btn btn-danger results-page-action-btn"
                type="button"
                onClick={clearAllAttendanceValues}
                disabled={attendanceClearing}
              >
                <span>{attendanceClearing ? "Clearing..." : "Clear All Attendance"}</span>
              </button>
              <button
                className="btn results-page-action-btn"
                type="button"
                onClick={() => attendanceImportInputRef.current?.click()}
              >
                <span className="results-page-action-icon" aria-hidden="true">↑</span>
                <span>Import CSV</span>
              </button>
              <input
                ref={attendanceImportInputRef}
                type="file"
                accept=".csv,.tsv"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  importAttendanceGoogleSheetsCsv(file);
                }}
              />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="admin-form attendance-filter-box">
            <div className="field small">
              <label className="attendance-filter-label">Filter (Rate &lt;)</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 80"
                value={attendanceFilter.minRate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minRate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Filter (Unexcused ≥)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 3"
                value={attendanceFilter.minAbsences}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minAbsences: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Range From</label>
              <input
                type="date"
                value={attendanceFilter.startDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Range To</label>
              <input
                type="date"
                value={attendanceFilter.endDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, endDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button
                className="btn"
                type="button"
                onClick={() => setAttendanceFilter({ minRate: "", minAbsences: "", startDate: "", endDate: "" })}
              >
                Clear Filter
              </button>
            </div>
            </div>
          </div>

          <div className="attendance-table-header">
            <div className="admin-help">
              <span className="att-legend-item att-legend-present">P: Present</span>
              <span className="att-legend-item att-legend-late">L: Late/Leave Early</span>
              <span className="att-legend-item att-legend-excused">E: Excused Absence</span>
              <span className="att-legend-item att-legend-absent">A: Unexcused Absence</span>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 2 }}>
            <table className="admin-table attendance-table">
              <thead>
                <tr>
                  <th className="att-col-code att-sticky-1">Student<br />No.</th>
                  <th className="att-col-name att-sticky-2">Student Name</th>
                  <th className="att-col-rate att-sticky-3">Attendance<br />Rate</th>
                  <th className="att-col-absent att-sticky-4">Unexcused<br />Absence</th>
                  {attendanceDayColumns.map((d) => (
                    <th key={d.id}>
                      <button className="link-btn" type="button" onClick={() => openAttendanceDay(d.day_date)}>
                        {d.label}
                      </button>
                      <div className="att-day-total">
                        {attendanceDayRates[d.id] == null ? "-" : formatRatePercent(attendanceDayRates[d.id])}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceFilteredStudents.map((s) => {
                  const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
                  const stats = buildAttendanceStats(perDay);
                  const rate = stats.total ? (stats.present / stats.total) * 100 : 0;
                  return (
                    <tr key={s.id}>
                      <td className="att-col-code att-sticky-1">{s.student_code ?? ""}</td>
                      <td className="att-col-name att-sticky-2">{s.display_name ?? s.email ?? s.id}</td>
                      <td className="att-col-rate att-sticky-3">{rate.toFixed(2)}%</td>
                      <td className="att-col-absent att-sticky-4">{stats.unexcused}</td>
                      {attendanceDayColumns.map((d) => {
                        const status = attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "";
                        return (
                          <td key={`${s.id}-${d.id}`} className={`att-cell ${getAttendanceStatusClassName(status)}`}>
                            {status || ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{attendanceMsg}</div>
        </div>
        ) : null}

        {activeTab === "dailyRecord" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="admin-title">Schedule & Record</div>
              <div className="attendance-control-row" style={{ marginTop: 0 }}>
                <div className="admin-form">
                  <div className="field">
                    <label>Date</label>
                    <div className="daily-record-date-picker" ref={dailyRecordDatePickerRef}>
                      <button
                        className="daily-record-date-picker-trigger"
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={dailyRecordDatePickerOpen}
                        onClick={() => setDailyRecordDatePickerOpen((open) => !open)}
                      >
                        <span>
                          {dailyRecordDate
                            ? `${formatDateFull(dailyRecordDate)}${formatWeekday(dailyRecordDate) ? ` (${formatWeekday(dailyRecordDate)})` : ""}`
                            : "Select date"}
                        </span>
                        <span aria-hidden="true">▾</span>
                      </button>
                      {dailyRecordDatePickerOpen ? (
                        <div className="daily-record-date-picker-panel" role="dialog" aria-label="Select record date">
                          {dailyRecordActiveCalendarMonth ? (
                            <div className="daily-record-date-picker-month">
                              <div className="daily-record-date-picker-nav">
                                <button
                                  type="button"
                                  className="daily-record-date-picker-nav-btn"
                                  disabled={dailyRecordCalendarMonthKeys[0] === dailyRecordActiveCalendarMonth.monthKey}
                                  onClick={() => {
                                    const currentIndex = dailyRecordCalendarMonthKeys.indexOf(dailyRecordActiveCalendarMonth.monthKey);
                                    if (currentIndex > 0) setDailyRecordCalendarMonth(dailyRecordCalendarMonthKeys[currentIndex - 1]);
                                  }}
                                  aria-label="Previous month"
                                >
                                  ‹
                                </button>
                                <div className="daily-record-date-picker-month-label">{dailyRecordActiveCalendarMonth.label}</div>
                                <button
                                  type="button"
                                  className="daily-record-date-picker-nav-btn"
                                  disabled={dailyRecordCalendarMonthKeys[dailyRecordCalendarMonthKeys.length - 1] === dailyRecordActiveCalendarMonth.monthKey}
                                  onClick={() => {
                                    const currentIndex = dailyRecordCalendarMonthKeys.indexOf(dailyRecordActiveCalendarMonth.monthKey);
                                    if (currentIndex >= 0 && currentIndex < dailyRecordCalendarMonthKeys.length - 1) {
                                      setDailyRecordCalendarMonth(dailyRecordCalendarMonthKeys[currentIndex + 1]);
                                    }
                                  }}
                                  aria-label="Next month"
                                >
                                  ›
                                </button>
                              </div>
                              <div className="daily-record-date-picker-weekdays">
                                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                                  <span key={`daily-record-weekday-${label}`}>{label}</span>
                                ))}
                              </div>
                              <div className="daily-record-date-picker-grid">
                                {dailyRecordActiveCalendarMonth.weeks.flat().map((cell, index) => {
                                  if (!cell) {
                                    return <span key={`daily-record-empty-${dailyRecordActiveCalendarMonth.monthKey}-${index}`} className="daily-record-date-cell-empty" />;
                                  }
                                  const isSelected = cell.recordDate === dailyRecordDate;
                                  const className = [
                                    "daily-record-date-picker-day",
                                    cell.isHoliday ? "is-holiday" : "",
                                    cell.isSelectable ? "is-selectable" : "",
                                    isSelected ? "is-selected" : "",
                                  ].filter(Boolean).join(" ");
                                  return (
                                    <button
                                      key={cell.recordDate}
                                      type="button"
                                      className={className}
                                      disabled={!cell.isSelectable}
                                      onClick={() => {
                                        setDailyRecordDate(cell.recordDate);
                                        setDailyRecordDatePickerOpen(false);
                                      }}
                                      title={cell.isHoliday ? "Holiday" : formatDateFull(cell.recordDate)}
                                    >
                                      {cell.dayNumber}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="field small">
                    <label>&nbsp;</label>
                    <button className="btn btn-primary attendance-open-day-btn" type="button" onClick={() => openDailyRecordModal(null, dailyRecordDate)}>
                      Open Record
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <button
              className="btn admin-icon-action-btn"
              aria-label="Refresh daily records"
              title="Refresh daily records"
              onClick={() => fetchDailyRecords()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M16 10a6 6 0 1 1-1.76-4.24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M16 4.5v3.75h-3.75"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 8, maxHeight: "70vh" }} ref={dailyRecordTableWrapRef}>
            <table className="admin-table daily-record-table" style={{ minWidth: 1360 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="daily-record-holiday-head">Holiday</th>
                  <th>Today's Content</th>
                  <th>Student Comments</th>
                  <th>Test 1</th>
                  <th>Test 2</th>
                  <th>Test 3</th>
                  <th>Save Plan</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRecordRows.map(({ recordDate, record, draft }) => {
                  const display = scheduleRecordDisplayByDate[recordDate] ?? {
                    isConfirmed: false,
                    isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
                    mini_test_1: draft.mini_test_1,
                    mini_test_2: draft.mini_test_2,
                    special_test_1: draft.special_test_1,
                  };
                  const weekdayLabel = formatWeekday(recordDate);
                  return (
                  <tr
                    key={record?.id ?? recordDate}
                    data-daily-record-date={recordDate}
                    className={display.isHoliday ? "daily-record-holiday-row" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={(event) => {
                      if (event.target.closest("input, textarea, select, button, a, label")) return;
                      openDailyRecordModal(record, recordDate);
                    }}
                  >
                    <td className="daily-record-date-cell">
                      {`${formatDateFull(recordDate)}${weekdayLabel ? ` (${weekdayLabel})` : ""}`}
                    </td>
                    <td className="daily-record-holiday-cell" onClick={(event) => event.stopPropagation()}>
                      <label className="daily-session-create-switch daily-record-holiday-switch" aria-label={`Mark ${recordDate} as holiday`}>
                        <input
                          type="checkbox"
                          checked={display.isHoliday}
                          disabled={dailyRecordHolidaySavingDate === recordDate}
                          onChange={(event) => saveDailyRecordHoliday(recordDate, event.target.checked)}
                        />
                        <span className="daily-session-create-switch-slider" />
                      </label>
                    </td>
                    {display.isHoliday ? (
                      <td colSpan={5} className="daily-record-holiday-summary">
                        {dailyRecordHolidaySavingDate === recordDate ? "Saving..." : "Holiday"}
                      </td>
                    ) : (
                      <>
                        <td>
                          {record?.todays_content
                            ? (() => {
                                const summary = summarizeDailyRecordContent(record.todays_content);
                                return summary.length > 140 ? `${summary.slice(0, 140)}...` : summary;
                              })()
                            : "-"}
                        </td>
                        <td>{record ? summarizeDailyRecordComments(record) : "-"}</td>
                        <td>
                          {display.isConfirmed ? (
                            <span>{display.mini_test_1}</span>
                          ) : (
                            <input
                              className="daily-record-plan-input"
                              value={display.mini_test_1}
                              onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_1", e.target.value)}
                              placeholder="Plan"
                            />
                          )}
                        </td>
                        <td>
                          {display.isConfirmed ? (
                            <span>{display.mini_test_2}</span>
                          ) : (
                            <input
                              className="daily-record-plan-input"
                              value={display.mini_test_2}
                              onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_2", e.target.value)}
                              placeholder="Plan"
                            />
                          )}
                        </td>
                        <td>
                          {display.isConfirmed ? (
                            <span>{display.special_test_1}</span>
                          ) : (
                            <input
                              className="daily-record-plan-input"
                              value={display.special_test_1}
                              onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_1", e.target.value)}
                              placeholder="Plan"
                            />
                          )}
                        </td>
                        <td>
                          <button
                            className="btn"
                            type="button"
                            onClick={() => saveDailyRecordPlan(recordDate)}
                            disabled={display.isConfirmed || dailyRecordPlanSavingDate === recordDate}
                          >
                            {display.isConfirmed ? "Confirmed" : dailyRecordPlanSavingDate === recordDate ? "Saving..." : "Save Plan"}
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{dailyRecordsMsg}</div>
        </div>
        ) : null}

        {activeTab === "ranking" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="admin-title">Ranking</div>
              <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" type="button" onClick={addRankingPeriod}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M10 5v10M5 10h10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                Add Period
              </button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table ranking-table" style={{ minWidth: Math.max(420, 160 + rankingPeriods.length * 260) }}>
              <thead>
                <tr>
                  <th rowSpan={2}>Rank</th>
                  {rankingPeriods.map((period) => {
                    const draft = rankingDrafts[period.id] ?? { label: period.label ?? "", start_date: "", end_date: "" };
                    return (
                      <th key={period.id} colSpan={2}>
                        <div className="ranking-period-head">
                          <input
                            type="text"
                            value={draft.label}
                            onChange={(e) => updateRankingDraft(period.id, "label", e.target.value)}
                            onBlur={() => saveRankingPeriodLabel(period)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                            placeholder="Period name"
                            aria-label={`Name for ${period.label}`}
                            className="admin-input"
                            style={{ minWidth: 0, width: "100%" }}
                          />
                          <button
                            className="btn btn-primary admin-icon-action-btn ranking-refresh-btn"
                            type="button"
                            aria-label={`Refresh ${draft.label || period.label || "ranking period"}`}
                            title={rankingRefreshingId === period.id ? "Refreshing..." : "Refresh period"}
                            onClick={() => refreshRankingPeriod(period)}
                            disabled={rankingRefreshingId === period.id}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path
                                d="M16 10a6 6 0 1 1-1.76-4.24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                              <path
                                d="M16 4.5v3.75h-3.75"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                        <div className="ranking-period-range">
                          <input
                            type="date"
                            value={draft.start_date}
                            onChange={(e) => updateRankingDraft(period.id, "start_date", e.target.value)}
                          />
                          <span>to</span>
                          <input
                            type="date"
                            value={draft.end_date}
                            onChange={(e) => updateRankingDraft(period.id, "end_date", e.target.value)}
                          />
                        </div>
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {rankingPeriods.map((period) => (
                    <Fragment key={`cols-${period.id}`}>
                      <th>Student</th>
                      <th>Average %</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rankingPeriods.length && rankingRowCount ? (
                  Array.from({ length: rankingRowCount }, (_, idx) => (
                    <tr key={`ranking-row-${idx + 1}`}>
                      <td>{idx + 1}</td>
                      {rankingPeriods.map((period) => {
                        const entry = period.ranking_entries?.[idx] ?? null;
                        return (
                          <Fragment key={`${period.id}-${idx + 1}`}>
                            <td>{entry?.student_name || "-"}</td>
                            <td>{entry ? `${(Number(entry.average_rate) * 100).toFixed(2)}%` : "-"}</td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={Math.max(1, 1 + rankingPeriods.length * 2)} className="ranking-empty-cell">
                      {rankingPeriods.length ? "Press Refresh to calculate the configured periods." : "No ranking periods yet. Click Add Period."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{rankingMsg}</div>
        </div>
        ) : null}

        {activeTab === "announcements" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div className="admin-title">Announcements</div>
              <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={openCreateAnnouncementModal}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M4.5 10.5V8.5l8-3v9l-8-3z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12.5 8.5h1.5a2 2 0 0 1 0 4h-1.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7.5 13.5 8.5 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                Create Announcement
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn admin-icon-action-btn"
                aria-label="Refresh announcements"
                title="Refresh announcements"
                onClick={() => fetchAnnouncements()}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M16 10a6 6 0 1 1-1.76-4.24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M16 4.5v3.75h-3.75"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Publish At</th>
                  <th>End At</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {announcements.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>{a.title}</td>
                    <td>{a.body}</td>
                    <td>{formatDateTime(a.publish_at)}</td>
                    <td>{a.end_at ? formatDateTime(a.end_at) : ""}</td>
                    <td>
                      <button className="btn" onClick={() => startEditAnnouncement(a)}>
                        Edit
                      </button>
                    </td>
                    <td>
                      <button className="btn btn-danger" onClick={() => deleteAnnouncement(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{announcementMsg}</div>

          {announcementCreateOpen ? (
            <div className="admin-modal-overlay" onClick={closeCreateAnnouncementModal}>
              <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Create Announcement</div>
                  <button className="admin-modal-close" onClick={closeCreateAnnouncementModal} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="admin-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Title</label>
                    <input
                      value={announcementForm.title}
                      onChange={(e) => setAnnouncementForm((s) => ({ ...s, title: e.target.value }))}
                      placeholder="Announcement title"
                    />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Message</label>
                    <textarea
                      value={announcementForm.body}
                      onChange={(e) => setAnnouncementForm((s) => ({ ...s, body: e.target.value }))}
                      placeholder="Write your message here..."
                      rows={6}
                    />
                  </div>
                  <div className="field small">
                    <label>Publish At</label>
                    <input
                      type="datetime-local"
                      step="300"
                      value={announcementForm.publish_at}
                      onChange={(e) => setAnnouncementForm((s) => ({ ...s, publish_at: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>End At</label>
                    <input
                      type="datetime-local"
                      step="300"
                      value={announcementForm.end_at}
                      onChange={(e) => setAnnouncementForm((s) => ({ ...s, end_at: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btn" onClick={closeCreateAnnouncementModal}>Cancel</button>
                  <button className="btn btn-primary" onClick={createAnnouncement}>Create Announcement</button>
                </div>
              </div>
            </div>
          ) : null}

          {editingAnnouncementId ? (
            <div className="admin-modal-overlay" onClick={cancelEditAnnouncement}>
              <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Edit Announcement</div>
                  <button className="admin-modal-close" onClick={cancelEditAnnouncement} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="admin-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Title</label>
                    <input
                      value={editingAnnouncementForm.title}
                      onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, title: e.target.value }))}
                      placeholder="Announcement title"
                    />
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label>Message</label>
                    <textarea
                      value={editingAnnouncementForm.body}
                      onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, body: e.target.value }))}
                      placeholder="Write your message here..."
                      rows={6}
                    />
                  </div>
                  <div className="field small">
                    <label>Publish At</label>
                    <input
                      type="datetime-local"
                      step="300"
                      value={editingAnnouncementForm.publish_at}
                      onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, publish_at: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>End At</label>
                    <input
                      type="datetime-local"
                      step="300"
                      value={editingAnnouncementForm.end_at}
                      onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, end_at: e.target.value }))}
                    />
                  </div>
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button className="btn" onClick={cancelEditAnnouncement}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveAnnouncementEdits}>Save</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "absence" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Absence Applications</div>
              <div className="admin-subtitle">Review and approve/deny student applications.</div>
            </div>
            <button
              className="btn admin-icon-action-btn"
              aria-label="Refresh absence applications"
              title="Refresh absence applications"
              onClick={() => fetchAbsenceApplications()}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M16 10a6 6 0 1 1-1.76-4.24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <path
                  d="M16 4.5v3.75h-3.75"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Reason</th>
                  <th>Catch Up</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {absenceApplications.map((a) => {
                  const student = a.profiles || {};
                  const name = student.display_name || student.email || a.student_id;
                  const code = student.student_code ? ` (${student.student_code})` : "";
                  const typeLabel = a.type === "excused" ? "Excused Absence" : "Late/Leave Early";
                  const timeLabel =
                    a.type === "late"
                      ? `${a.late_type === "leave_early" ? "Leave" : "Arrive"}: ${a.time_value || "-"}`
                      : "";
                  return (
                    <tr key={a.id}>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>{name}{code}</td>
                      <td>{typeLabel}</td>
                      <td>{a.day_date}</td>
                      <td>{timeLabel}</td>
                      <td>{a.reason || ""}</td>
                      <td>{a.catch_up || ""}</td>
                      <td>{a.status}</td>
                      <td>
                        {a.status === "pending" ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button className="btn btn-primary" onClick={() => decideAbsenceApplication(a.id, "approved")}>
                              Approve
                            </button>
                            <button className="btn btn-danger" onClick={() => decideAbsenceApplication(a.id, "denied")}>
                              Deny
                            </button>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{absenceApplicationsMsg}</div>
        </div>
        ) : null}

        {activeTab === "model" ? (
        <>
        {modelSubTab === "conduct" ? (
        <div style={{ marginBottom: 12 }}>
          {!(sessionDetail.type === "mock" && sessionDetail.sessionId) ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div className="admin-title">Test Sessions</div>
                    <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={() => openModelConductModal("normal")}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M10 5v10M5 10h10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                      Create Test Session
                    </button>
                    <button className="btn btn-retake admin-compact-action-btn admin-upload-cta-btn" onClick={() => openModelConductModal("retake")}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M5.5 6.5h8V4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M13.5 13.5h-8V16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M13.5 4l2.5 2.5-2.5 2.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6.5 16 4 13.5 6.5 11"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Create Retake Session
                    </button>
                  </div>
                </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn admin-icon-action-btn"
                  aria-label="Refresh sessions"
                  title="Refresh sessions"
                  onClick={() => {
                    fetchTestSessions();
                    fetchExamLinks();
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M16 10a6 6 0 1 1-1.76-4.24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 4.5v3.75h-3.75"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}

          {sessionDetail.type === "mock" && sessionDetail.sessionId ? (
            renderSessionDetailView()
          ) : (
            <>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Test Title</th>
                      <th>SetID</th>
                      <th>Show Answers</th>
                      <th>Attempts</th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Time (min)</th>
                      <th>Pass Rate</th>
                      <th style={{ textAlign: "center" }}>Action</th>
                      <th style={{ textAlign: "center" }}>Preview</th>
                      <th style={{ textAlign: "center" }}>Edit</th>
                      <th style={{ textAlign: "center" }}>Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelSessions.map((t) => (
                      <tr key={t.id} onClick={editingSessionId === t.id ? undefined : () => openSessionDetailView(t, "mock")}>
                        <td>{formatDateTime(t.created_at)}</td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.title}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, title: e.target.value }))}
                            />
                          ) : (
                            t.title ?? ""
                          )}
                        </td>
                        <td>{getProblemSetDisplayId(t.problem_set_id, tests)}</td>
                        <td>
                          {editingSessionId === t.id ? (
                            <select
                              value={editingSessionForm.show_answers ? "yes" : "no"}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          ) : (
                            t.show_answers ? "Yes" : "No"
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <select
                              value={editingSessionForm.allow_multiple_attempts ? "multiple" : "once"}
                              onChange={(e) =>
                                setEditingSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                              }
                            >
                              <option value="once">Only once</option>
                              <option value="multiple">Allow multiple</option>
                            </select>
                          ) : (
                            t.allow_multiple_attempts === false ? "Only once" : "Allow multiple"
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              type="datetime-local"
                              step="300"
                              value={editingSessionForm.starts_at}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                            />
                          ) : (
                            formatDateTime(t.starts_at)
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              type="datetime-local"
                              step="300"
                              value={editingSessionForm.ends_at}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                            />
                          ) : (
                            formatDateTime(t.ends_at)
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.time_limit_min}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            />
                          ) : (
                            t.time_limit_min ?? ""
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.pass_rate}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            />
                          ) : (
                            `${(getSessionEffectivePassRate(t) * 100).toFixed(0)}%`
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {linkBySession[t.id]?.id ? (
                            <button
                              className="btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyLink(linkBySession[t.id].id);
                              }}
                            >
                              Copy URL
                            </button>
                          ) : (
                            ""
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSessionPreview(t);
                            }}
                          >
                            Preview
                          </button>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {editingSessionId === t.id ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); saveSessionEdits(); }}>
                                Save
                              </button>
                              <button className="btn" onClick={(e) => { e.stopPropagation(); cancelEditSession(); }}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button className="btn" onClick={(e) => { e.stopPropagation(); startEditSession(t); }}>
                              Edit
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); deleteTestSession(t.id); }}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-msg">{testSessionsMsg}</div>
              <div className="admin-msg">{linkMsg}</div>
              {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
            </>
          )}

          {modelConductOpen ? (
            <div
              className="admin-modal-overlay"
              onClick={() => {
                setModelConductOpen(false);
                setModelConductMode("normal");
                setModelRetakeSourceId("");
                setActiveModelTimePicker("");
              }}
            >
              <div
                className="admin-modal daily-session-create-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="admin-modal-header daily-session-create-header">
                  <div className="admin-title">{modelConductMode === "retake" ? "Conduct Model Retake" : "Create Model Test Session"}</div>
                  <button
                    className="admin-modal-close"
                    onClick={() => {
                      setModelConductOpen(false);
                      setModelConductMode("normal");
                      setModelRetakeSourceId("");
                      setActiveModelTimePicker("");
                    }}
                    aria-label="Close"
                  >
                    &times;
                  </button>
                </div>

                <div className="daily-session-create-body">
                  {modelConductMode === "retake" ? (
                    <div className="daily-session-create-layout">
                      <div className="daily-session-create-field">
                        <label>Original Session</label>
                        <select
                          value={modelRetakeSourceId}
                          onChange={(e) => selectModelRetakeSource(e.target.value)}
                        >
                          {pastModelSessions.length ? (
                            pastModelSessions.map((session) => (
                              <option key={`model-retake-${session.id}`} value={session.id}>
                                {session.title || session.problem_set_id} ({formatDateTime(session.ends_at || session.starts_at || session.created_at)})
                              </option>
                            ))
                          ) : (
                            <option value="">No past model sessions</option>
                          )}
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Release To</label>
                        <select
                          value={testSessionForm.retake_release_scope}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, retake_release_scope: e.target.value }))}
                        >
                          <option value="all">All students</option>
                          <option value="failed_only">Only students who failed</option>
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Test Title</label>
                        <input
                          value={testSessionForm.title}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Mock Test (Retake)"
                        />
                      </div>
                      <div className="daily-session-create-split-row">
                        <div className="daily-session-create-field">
                          <label>Date</label>
                          <input
                            type="date"
                            value={testSessionForm.session_date}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, session_date: e.target.value }))}
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Start Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                            {(() => {
                              const startTimeParts = getTwelveHourTimeParts(testSessionForm.start_time);
                              const isOpen = activeModelTimePicker === "start_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveModelTimePicker((current) => (current === "start_time" ? "" : "start_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(testSessionForm.start_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model retake start time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`model-retake-start-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`model-retake-start-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`model-retake-start-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="daily-session-create-field">
                          <label>Close Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                            {(() => {
                              const closeTimeParts = getTwelveHourTimeParts(testSessionForm.close_time);
                              const isOpen = activeModelTimePicker === "close_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveModelTimePicker((current) => (current === "close_time" ? "" : "close_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(testSessionForm.close_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model retake close time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`model-retake-close-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`model-retake-close-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`model-retake-close-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="daily-session-create-two-col">
                        <div className="daily-session-create-field">
                          <label>Time Limit (min)</label>
                          <input
                            value={testSessionForm.time_limit_min}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            placeholder="60"
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Pass Rate</label>
                          <input
                            value={testSessionForm.pass_rate}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            placeholder="0.8"
                          />
                        </div>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Show Answers</span>
                        <label className="daily-session-create-switch" aria-label="Show Answers">
                          <input
                            type="checkbox"
                            checked={testSessionForm.show_answers}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Allow Multiple Attempts</span>
                        <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                          <input
                            type="checkbox"
                            checked={testSessionForm.allow_multiple_attempts}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-actions">
                        <button
                          className="btn btn-retake"
                          type="button"
                          onClick={createTestSession}
                          disabled={!modelRetakeSourceId}
                        >
                          Create Session
                        </button>
                      </div>
                      {testSessionsMsg ? <div className="admin-msg">{testSessionsMsg}</div> : null}
                    </div>
                  ) : (
                    <div className="daily-session-create-layout">
                      <div className="daily-session-create-field">
                        <label>Category</label>
                        <select
                          value={modelConductCategory}
                          onChange={(e) => setModelConductCategory(e.target.value)}
                        >
                          {modelCategories.length ? (
                            <>
                              <option value="">Select category</option>
                              {modelCategories.map((c) => (
                                <option key={`model-cat-${c.name}`} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </>
                          ) : (
                            <option value="">No categories</option>
                          )}
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Set ID</label>
                        <select
                          value={testSessionForm.problem_set_id}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
                        >
                          {modelConductTests.length ? (
                            modelConductTests.map((t) => (
                              <option key={`ps-${t.version}`} value={t.version}>
                                {t.version}
                              </option>
                            ))
                          ) : (
                            <option value="">No problem sets</option>
                          )}
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Test Title</label>
                        <input
                          value={testSessionForm.title}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Mock Test"
                        />
                      </div>
                      <div className="daily-session-create-split-row">
                        <div className="daily-session-create-field">
                          <label>Date</label>
                          <input
                            type="date"
                            value={testSessionForm.session_date}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, session_date: e.target.value }))}
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Start Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                            {(() => {
                              const startTimeParts = getTwelveHourTimeParts(testSessionForm.start_time);
                              const isOpen = activeModelTimePicker === "start_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveModelTimePicker((current) => (current === "start_time" ? "" : "start_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(testSessionForm.start_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model start time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`model-start-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`model-start-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`model-start-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("start_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="daily-session-create-field">
                          <label>Close Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-model-time-picker>
                            {(() => {
                              const closeTimeParts = getTwelveHourTimeParts(testSessionForm.close_time);
                              const isOpen = activeModelTimePicker === "close_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveModelTimePicker((current) => (current === "close_time" ? "" : "close_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(testSessionForm.close_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select model close time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`model-close-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`model-close-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`model-close-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateModelSessionTimePart("close_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="daily-session-create-two-col">
                        <div className="daily-session-create-field">
                          <label>Time Limit (min)</label>
                          <input
                            value={testSessionForm.time_limit_min}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            placeholder="60"
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Pass Rate</label>
                          <input
                            value={testSessionForm.pass_rate}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            placeholder="0.8"
                          />
                        </div>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Show Answers</span>
                        <label className="daily-session-create-switch" aria-label="Show Answers">
                          <input
                            type="checkbox"
                            checked={testSessionForm.show_answers}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Allow Multiple Attempts</span>
                        <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                          <input
                            type="checkbox"
                            checked={testSessionForm.allow_multiple_attempts}
                            onChange={(e) => setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-actions">
                        <button
                          className="btn btn-primary"
                          type="button"
                          onClick={createTestSession}
                        >
                          Create Session
                        </button>
                      </div>
                      {testSessionsMsg ? <div className="admin-msg">{testSessionsMsg}</div> : null}
                    </div>
                  )}

                </div>

                {modelConductMode === "retake" ? (
                  <div className="admin-help" style={{ marginTop: 6 }}>
                    Student Base URL: <b>{getStudentBaseUrl() || "Not set"}</b>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        ) : null}

        {modelSubTab === "upload" ? (
        <>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="admin-title">Set Upload (CSV)</div>
                  <button
                    className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn"
                    onClick={openModelUploadModal}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path
                        d="M10 13V4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M6.75 7.75 10 4.5l3.25 3.25"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M4.5 14.5v1h11v-1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Upload Question Set
                  </button>
                </div>
              </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={modelUploadCategory}
                onChange={(e) => setModelUploadCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {modelCategories.map((c) => (
                  <option key={`model-upload-cat-${c.name}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {groupedModelUploadTests.map((group) => (
              <div key={`model-upload-group-${group.name}`}>
                {!modelUploadCategory ? (
                  <div className="admin-subtitle" style={{ fontWeight: 900 }}>{group.name}</div>
                ) : null}
                <div className="admin-table-wrap" style={{ marginTop: !modelUploadCategory ? 8 : 0 }}>
                  <table className="admin-table" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>SetID</th>
                        <th>Category</th>
                        <th>Questions</th>
                        <th>Preview</th>
                        <th>Edit</th>
                        <th>Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tests.map((t) => (
                        <tr
                          key={t.id}
                          onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                        >
                          <td>{formatDateTime(t.created_at)}</td>
                          <td>
                            {editingTestId === t.id ? (
                              <input
                                value={editingTestForm.version}
                                onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                              />
                            ) : (
                              t.version ?? ""
                            )}
                          </td>
                          <td>
                            {editingTestId === t.id ? (
                              <>
                                <select
                                  value={editingCategorySelect}
                                  onChange={(e) => {
                                    const next = e.target.value;
                                    setEditingCategorySelect(next);
                                    if (next !== "__custom__") {
                                      setEditingTestForm((s) => ({ ...s, title: next }));
                                    }
                                  }}
                                >
                                  {modelCategories.map((c) => (
                                    <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                                  ))}
                                  <option value="__custom__">Custom...</option>
                                </select>
                                {editingCategorySelect === "__custom__" ? (
                                  <input
                                    value={editingTestForm.title}
                                    onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                                    placeholder="Grammar Review"
                                    style={{ marginTop: 6 }}
                                  />
                                ) : null}
                              </>
                            ) : (
                              t.title ?? ""
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                          <td>
                            <button
                              className="btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPreview(t.version);
                              }}
                            >
                              Preview
                            </button>
                          </td>
                          <td>
                            {editingTestId === t.id ? (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  className="btn btn-primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveTestEdits(modelCategories);
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditTest();
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditTest(t, modelCategories);
                                }}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTest(t.version);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          {groupedModelUploadTests.length === 0 ? <div className="admin-msg">{testsMsg || "No sets found."}</div> : null}
          {!modelUploadOpen && assetUploadMsg ? <div className="admin-msg">{assetUploadMsg}</div> : null}
          {!modelUploadOpen && assetImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {assetImportMsg}
            </pre>
          ) : null}
          <div className="admin-msg">{assetsMsg}</div>
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          {groupedModelUploadTests.length ? <div className="admin-msg">{testsMsg}</div> : null}

          {modelUploadOpen ? (
            <div className="admin-modal-overlay" onClick={() => setModelUploadOpen(false)}>
              <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Upload Model Questions</div>
                  <button className="admin-modal-close" onClick={() => setModelUploadOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>
                {assetUploadMsg ? <div className="admin-msg" style={{ marginTop: 10 }}>{assetUploadMsg}</div> : null}
                {assetImportMsg ? (
                  <pre className="admin-msg" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                    {assetImportMsg}
                  </pre>
                ) : null}

                <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Category</label>
                    <select
                      value={assetCategorySelect}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAssetCategorySelect(next);
                        if (next !== "__custom__") {
                          setAssetForm((current) => ({ ...current, category: next }));
                        }
                      }}
                    >
                      {(modelCategories.length ? modelCategories : [{ name: DEFAULT_MODEL_CATEGORY }]).map((category) => (
                        <option key={`asset-upload-category-${category.name}`} value={category.name}>
                          {category.name}
                        </option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                    {assetCategorySelect === "__custom__" ? (
                      <input
                        value={assetForm.category}
                        onChange={(e) => setAssetForm((current) => ({ ...current, category: e.target.value }))}
                        placeholder="Book Review"
                        style={{ marginTop: 6 }}
                      />
                    ) : null}
                  </div>
                  <div className="field">
                    <label>CSV File (required)</label>
                    <input
                      type="file"
                      accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setAssetFile(file);
                        if (file && file.name.toLowerCase().endsWith(".csv")) {
                          setAssetCsvFile(file);
                        }
                      }}
                    />
                    {assetCsvFile ? (
                      <div className="admin-help" style={{ marginTop: 4 }}>
                        CSV ready: {assetCsvFile.name}
                      </div>
                    ) : null}
                  </div>
                  <div className="field">
                    <label>Folder (PNG/MP3/M4A)</label>
                    <div className="upload-question-picker">
                      <input
                        ref={assetFolderInputRef}
                        className="upload-question-picker-input"
                        type="file"
                        multiple
                        webkitdirectory="true"
                        directory="true"
                        accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          setAssetFiles(files);
                          const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
                          if (csvFile) {
                            setAssetCsvFile(csvFile);
                          }
                        }}
                      />
                      <button className="btn upload-question-picker-button" type="button" onClick={() => assetFolderInputRef.current?.click()}>
                        Choose Folder
                      </button>
                    </div>
                    {assetFiles.length ? (
                      <div className="admin-help" style={{ marginTop: 4 }}>
                        Selected: {assetFiles.length} files
                      </div>
                    ) : null}
                  </div>
                  <div className="upload-question-actions">
                    <button className="btn btn-primary admin-upload-cta-btn" type="button" onClick={uploadAssets}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M10 13V4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path
                          d="M6.75 7.75 10 4.5l3.25 3.25"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M4.5 14.5v1h11v-1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Upload & Register Set
                    </button>
                  </div>
                </div>
                <div className="admin-help" style={{ marginTop: 8 }}>
                  SetID is read from the CSV `set_id` column. If the file contains multiple `set_id` values, each one is imported as a separate model test set.
                </div>
                <div className="admin-help" style={{ marginTop: 8 }}>
                  Template: <a href="/question_csv_template.csv" download>Model CSV template</a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        </>
        ) : null}
        </>
        ) : null}

        {activeTab === "daily" ? (
        <>
        {dailySubTab === "conduct" ? (
        <div style={{ marginBottom: 12 }}>
          {!(sessionDetail.type === "daily" && sessionDetail.sessionId) ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div className="admin-title">Daily Test Sessions</div>
                    <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={() => openDailyConductModal("normal")}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M10 5v10M5 10h10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                      Create Test Session
                    </button>
                    <button className="btn btn-retake admin-compact-action-btn admin-upload-cta-btn" onClick={() => openDailyConductModal("retake")}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M5.5 6.5h8V4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M13.5 13.5h-8V16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M13.5 4l2.5 2.5-2.5 2.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6.5 16 4 13.5 6.5 11"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Create Retake Session
                    </button>
                  </div>
                </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn admin-icon-action-btn"
                  aria-label="Refresh sessions"
                  title="Refresh sessions"
                  onClick={() => {
                    fetchTestSessions();
                    fetchExamLinks();
                  }}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M16 10a6 6 0 1 1-1.76-4.24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M16 4.5v3.75h-3.75"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}

          {sessionDetail.type === "daily" && sessionDetail.sessionId ? (
            renderSessionDetailView()
          ) : (
            <>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table daily-sessions-table" style={{ minWidth: 860 }}>
                  <colgroup>
                    <col />
                    <col />
                    <col />
                    <col className="daily-sessions-col-setid" />
                    <col className="daily-sessions-col-show-answers" />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Test Title</th>
                      <th>Category</th>
                      <th>SetID</th>
                      <th><span className="daily-sessions-show-answers-head">Show Answers</span></th>
                      <th>Start</th>
                      <th>End</th>
                      <th>Time (min)</th>
                      <th>Pass Rate</th>
                      <th style={{ textAlign: "center" }}>Action</th>
                      <th style={{ textAlign: "center" }}>Preview</th>
                      <th style={{ textAlign: "center" }}>Edit</th>
                      <th style={{ textAlign: "center" }}>Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailySessions.map((t) => (
                      <tr key={t.id} onClick={editingSessionId === t.id ? undefined : () => openSessionDetailView(t, "daily")}>
                        <td>{formatDateTime(t.created_at)}</td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.title}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, title: e.target.value }))}
                            />
                          ) : (
                            t.title ?? ""
                          )}
                        </td>
                        <td>{testMetaByVersion[t.problem_set_id]?.category || "Uncategorized"}</td>
                        <td>{getProblemSetDisplayId(t.problem_set_id, tests)}</td>
                        <td>
                          {editingSessionId === t.id ? (
                            <select
                              value={editingSessionForm.show_answers ? "yes" : "no"}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                            >
                              <option value="yes">Yes</option>
                              <option value="no">No</option>
                            </select>
                          ) : (
                            t.show_answers ? "Yes" : "No"
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              type="datetime-local"
                              step="300"
                              value={editingSessionForm.starts_at}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                            />
                          ) : (
                            formatDateTime(t.starts_at)
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              type="datetime-local"
                              step="300"
                              value={editingSessionForm.ends_at}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                            />
                          ) : (
                            formatDateTime(t.ends_at)
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.time_limit_min}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            />
                          ) : (
                            t.time_limit_min ?? ""
                          )}
                        </td>
                        <td>
                          {editingSessionId === t.id ? (
                            <input
                              value={editingSessionForm.pass_rate}
                              onChange={(e) => setEditingSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            />
                          ) : (
                            `${(getSessionEffectivePassRate(t) * 100).toFixed(0)}%`
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {linkBySession[t.id]?.id ? (
                            <button
                              className="btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                copyLink(linkBySession[t.id].id);
                              }}
                            >
                              Copy URL
                            </button>
                          ) : (
                            ""
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSessionPreview(t);
                            }}
                          >
                            Preview
                          </button>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {editingSessionId === t.id ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); saveSessionEdits(); }}>
                                Save
                              </button>
                              <button className="btn" onClick={(e) => { e.stopPropagation(); cancelEditSession(); }}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button className="btn" onClick={(e) => { e.stopPropagation(); startEditSession(t); }}>
                              Edit
                            </button>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); deleteTestSession(t.id); }}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-msg">{dailySessionsMsg}</div>
              <div className="admin-msg">{linkMsg}</div>
              {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
            </>
          )}

          {dailyConductOpen ? (
            <div
              className="admin-modal-overlay"
              onClick={() => {
                setDailyConductOpen(false);
                setDailyConductMode("normal");
                setDailyRetakeCategory("");
                setDailyRetakeSourceId("");
                setDailySetDropdownOpen(false);
                setActiveDailyTimePicker("");
              }}
            >
              <div
                className="admin-modal daily-session-create-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="admin-modal-header daily-session-create-header">
                  <div className="admin-title">{dailyConductMode === "retake" ? "Conduct Daily Retake" : "Create Daily Test Session"}</div>
                  <button
                    className="admin-modal-close"
                    onClick={() => {
                      setDailyConductOpen(false);
                      setDailyConductMode("normal");
                      setDailyRetakeCategory("");
                      setDailyRetakeSourceId("");
                      setDailySetDropdownOpen(false);
                      setActiveDailyTimePicker("");
                    }}
                    aria-label="Close"
                  >
                    &times;
                  </button>
                </div>

                <div className="daily-session-create-body">
                  {dailyConductMode === "retake" ? (
                    <div className="daily-session-create-layout">
                      <div className="daily-session-create-field">
                        <label>Session Category</label>
                        <select
                          value={dailyRetakeCategory}
                          onChange={(e) => {
                            setDailyRetakeCategory(e.target.value);
                            setDailyRetakeSourceId("");
                          }}
                        >
                          {pastDailySessionCategories.length ? (
                            pastDailySessionCategories.map((category) => (
                              <option key={`daily-retake-category-${category.name}`} value={category.name}>
                                {category.name}
                              </option>
                            ))
                          ) : (
                            <option value="">No past daily session categories</option>
                          )}
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Original Session</label>
                        <select
                          value={dailyRetakeSourceId}
                          onChange={(e) => selectDailyRetakeSource(e.target.value)}
                        >
                          {filteredPastDailySessions.length ? (
                            filteredPastDailySessions.map((session) => (
                              <option key={`daily-retake-${session.id}`} value={session.id}>
                                {session.title || session.problem_set_id} ({formatDateTime(session.ends_at || session.starts_at || session.created_at)})
                              </option>
                            ))
                          ) : (
                            <option value="">
                              {dailyRetakeCategory ? "No past daily sessions in this category" : "No past daily sessions"}
                            </option>
                          )}
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Release To</label>
                        <select
                          value={dailySessionForm.retake_release_scope}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, retake_release_scope: e.target.value }))}
                        >
                          <option value="all">All students</option>
                          <option value="failed_only">Only students who failed</option>
                        </select>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Test Title</label>
                        <input
                          value={dailySessionForm.title}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Daily Test"
                        />
                      </div>
                      <div className="daily-session-create-split-row">
                        <div className="daily-session-create-field">
                          <label>Date</label>
                          <input
                            type="date"
                            value={dailySessionForm.session_date}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, session_date: e.target.value }))}
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Start Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-daily-time-picker>
                            {(() => {
                              const startTimeParts = getTwelveHourTimeParts(dailySessionForm.start_time);
                              const isOpen = activeDailyTimePicker === "start_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveDailyTimePicker((current) => (current === "start_time" ? "" : "start_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(dailySessionForm.start_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select daily retake start time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`daily-retake-start-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`daily-retake-start-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`daily-retake-start-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="daily-session-create-field">
                          <label>Close Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-daily-time-picker>
                            {(() => {
                              const closeTimeParts = getTwelveHourTimeParts(dailySessionForm.close_time);
                              const isOpen = activeDailyTimePicker === "close_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => setActiveDailyTimePicker((current) => (current === "close_time" ? "" : "close_time"))}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(dailySessionForm.close_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select daily retake close time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`daily-retake-close-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`daily-retake-close-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`daily-retake-close-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="daily-session-create-two-col">
                        <div className="daily-session-create-field">
                          <label>Time Limit (min)</label>
                          <input
                            value={dailySessionForm.time_limit_min}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            placeholder="10"
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Pass Rate</label>
                          <input
                            value={dailySessionForm.pass_rate}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            placeholder="0.8"
                          />
                        </div>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Show Answers After Attempt</span>
                        <label className="daily-session-create-switch" aria-label="Show Answers After Attempt">
                          <input
                            type="checkbox"
                            checked={dailySessionForm.show_answers}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Allow Multiple Attempts</span>
                        <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                          <input
                            type="checkbox"
                            checked={dailySessionForm.allow_multiple_attempts}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-actions">
                        <button
                          className="btn btn-retake"
                          type="button"
                          onClick={createDailySession}
                          disabled={!dailyRetakeSourceId}
                        >
                          Create Session
                        </button>
                      </div>
                      {dailySessionsMsg ? <div className="admin-msg">{dailySessionsMsg}</div> : null}
                    </div>
                  ) : (
                    <div className="daily-session-create-layout">
                      <div className="daily-session-create-choice-row">
                        <label className="daily-session-create-choice">
                          <input
                            type="radio"
                            name="dailySessionSelectionMode"
                            checked={dailySessionForm.selection_mode === "single"}
                            onChange={() => {
                              setDailySetDropdownOpen(false);
                              setDailySessionForm((s) => ({
                                ...s,
                                selection_mode: "single",
                                problem_set_ids: s.problem_set_id ? [s.problem_set_id] : [],
                              }));
                            }}
                          />
                          Single Question Set
                        </label>
                        <label className="daily-session-create-choice">
                          <input
                            type="radio"
                            name="dailySessionSelectionMode"
                            checked={dailySessionForm.selection_mode === "multiple"}
                            onChange={() => {
                              setDailySessionForm((s) => ({
                                ...s,
                                selection_mode: "multiple",
                                problem_set_ids: s.problem_set_id
                                  ? Array.from(new Set([...(s.problem_set_ids ?? []), s.problem_set_id]))
                                  : s.problem_set_ids ?? [],
                              }));
                            }}
                          />
                          Multiple Question Sets
                        </label>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Source Categories</label>
                        {dailySessionForm.selection_mode === "multiple" ? (
                          <>
                            <div className="daily-session-create-multi-select" ref={dailySourceCategoryDropdownRef}>
                              <button
                                className="daily-session-create-multi-trigger"
                                type="button"
                                onClick={() => {
                                  setActiveDailyTimePicker("");
                                  setDailySetDropdownOpen(false);
                                  setDailySourceCategoryDropdownOpen((open) => !open);
                                }}
                                disabled={!dailyCategories.length}
                              >
                                <span className="daily-session-create-multi-trigger-value">
                                  {selectedDailySourceCategoryNames.length
                                    ? (
                                      <span className="daily-session-create-trigger-chip-list">
                                        {selectedDailySourceCategoryNames.map((categoryName) => (
                                          <span key={`selected-source-category-${categoryName}`} className="daily-session-create-selected-chip">
                                            {categoryName}
                                          </span>
                                        ))}
                                      </span>
                                    )
                                    : "Select Source Categories"}
                                </span>
                                <span className={`daily-session-create-multi-arrow ${dailySourceCategoryDropdownOpen ? "open" : ""}`}>▾</span>
                              </button>
                              {dailySourceCategoryDropdownOpen ? (
                                <div className="daily-session-create-set-list">
                                  {dailyCategories.length ? (
                                    dailyCategories.map((category) => {
                                      const checked = selectedDailySourceCategoryNames.includes(category.name);
                                      return (
                                        <label
                                          key={`daily-source-category-${category.name}`}
                                          className="daily-session-create-set-option"
                                        >
                                          <span className="daily-session-create-set-option-main">
                                            <input
                                              className="daily-session-create-set-option-check"
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => toggleDailySourceCategorySelection(category.name)}
                                            />
                                            <span className="daily-session-create-set-option-id">{category.name}</span>
                                          </span>
                                          <span className="daily-session-create-set-meta">{Number(category.tests?.length ?? 0)} Sets</span>
                                        </label>
                                      );
                                    })
                                  ) : (
                                    <div className="daily-session-create-help">No categories available.</div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                            <div className="daily-session-create-help">
                              Checked categories determine which Set IDs are available below.
                            </div>
                          </>
                        ) : (
                          <select
                            value={dailyConductCategory}
                            onChange={(e) => {
                              setDailySourceCategoryDropdownOpen(false);
                              setDailyConductCategory(e.target.value);
                            }}
                          >
                            {dailyCategories.length ? (
                              dailyCategories.map((category) => (
                                <option key={`daily-source-single-${category.name}`} value={category.name}>
                                  {category.name}
                                </option>
                              ))
                            ) : (
                              <option value="">No categories</option>
                            )}
                          </select>
                        )}
                      </div>
                      <div className="daily-session-create-field">
                        <label>Set ID</label>
                        {dailySessionForm.selection_mode === "multiple" ? (
                          <div className="daily-session-create-multi-select" ref={dailySetDropdownRef}>
                            <button
                              className="daily-session-create-multi-trigger"
                              type="button"
                              onClick={() => {
                                setActiveDailyTimePicker("");
                                setDailySetDropdownOpen((open) => !open);
                              }}
                              disabled={!dailyConductTests.length}
                            >
                              <span className="daily-session-create-multi-trigger-value">
                                {selectedDailyProblemSetIds.length
                                  ? (
                                    <span className="daily-session-create-trigger-chip-list">
                                      {selectedDailyProblemSetIds.map((setId) => (
                                        <span key={`selected-set-inline-${setId}`} className="daily-session-create-selected-chip">
                                          {setId}
                                        </span>
                                      ))}
                                    </span>
                                  )
                                  : "Select Set ID"}
                              </span>
                              <span className={`daily-session-create-multi-arrow ${dailySetDropdownOpen ? "open" : ""}`}>▾</span>
                            </button>
                            {dailySetDropdownOpen ? (
                              <div className="daily-session-create-set-list">
                                {dailyConductTests.length ? (
                                  dailyConductTests.map((test) => {
                                    const checked = selectedDailyProblemSetIds.includes(test.version);
                                    return (
                                      <label
                                        key={`daily-ps-multi-${test.version}`}
                                        className="daily-session-create-set-option"
                                      >
                                        <span className="daily-session-create-set-option-main">
                                          <input
                                            className="daily-session-create-set-option-check"
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleDailyProblemSetSelection(test.version)}
                                          />
                                          <span className="daily-session-create-set-option-id">{test.version}</span>
                                        </span>
                                        <span className="daily-session-create-set-meta">{Number(test.question_count ?? 0)}Q</span>
                                      </label>
                                    );
                                  })
                                ) : (
                                  <div className="daily-session-create-help">No daily tests in the selected categories.</div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <select
                            value={dailySessionForm.problem_set_id}
                            onChange={(e) =>
                              setDailySessionForm((s) => ({
                                ...s,
                                problem_set_id: e.target.value,
                                problem_set_ids: e.target.value ? [e.target.value] : [],
                              }))
                            }
                          >
                            {dailyConductTests.length ? (
                              dailyConductTests.map((t) => (
                                <option key={`daily-ps-${t.version}`} value={t.version}>
                                  {t.version}
                                </option>
                              ))
                            ) : (
                              <option value="">No daily tests</option>
                            )}
                          </select>
                        )}
                      </div>
                      <div className="daily-session-create-field">
                        <label>Session Category</label>
                        {dailySessionCategories.length ? (
                          <>
                            <select
                              value={dailySessionCategorySelectValue}
                              onChange={(e) => {
                                const next = e.target.value;
                                if (next === CUSTOM_CATEGORY_OPTION) {
                                  setDailySessionForm((s) => ({
                                    ...s,
                                    session_category: dailySessionCategories.some((category) => category.name === s.session_category)
                                      ? ""
                                      : s.session_category,
                                  }));
                                  return;
                                }
                                setDailySessionForm((s) => ({ ...s, session_category: next }));
                              }}
                            >
                              {dailySessionCategories.map((category) => (
                                <option key={`daily-session-category-${category.name}`} value={category.name}>
                                  {category.name}
                                </option>
                              ))}
                              <option value={CUSTOM_CATEGORY_OPTION}>Custom...</option>
                            </select>
                            {dailySessionCategorySelectValue === CUSTOM_CATEGORY_OPTION ? (
                              <input
                                value={dailySessionForm.session_category}
                                onChange={(e) => setDailySessionForm((s) => ({ ...s, session_category: e.target.value }))}
                                placeholder="Mixed Practice"
                                style={{ marginTop: 6 }}
                              />
                            ) : null}
                          </>
                        ) : (
                          <input
                            value={dailySessionForm.session_category}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, session_category: e.target.value }))}
                            placeholder="Mixed Practice"
                          />
                        )}
                        <div className="daily-session-create-help">
                          This category will be used for the generated daily test session.
                        </div>
                      </div>
                      <div className="daily-session-create-field">
                        <label>Test Title</label>
                        <input
                          value={dailySessionForm.title}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Test Title"
                        />
                      </div>
                      <div className="daily-session-create-field">
                        <label>Number of Questions</label>
                        <div className="daily-session-create-choice-row daily-session-create-count-row">
                          <label className="daily-session-create-choice">
                            <input
                              type="radio"
                              name="dailySessionQuestionMode"
                              checked={dailySessionForm.question_count_mode === "all"}
                              onChange={() => setDailySessionForm((s) => ({ ...s, question_count_mode: "all", question_count: "" }))}
                            />
                            <span className="daily-session-create-choice-copy">All Questions</span>
                          </label>
                          <div className="daily-session-create-count-option">
                            <label className="daily-session-create-choice">
                              <input
                                type="radio"
                                name="dailySessionQuestionMode"
                                checked={dailySessionForm.question_count_mode === "specify"}
                                onChange={() => setDailySessionForm((s) => ({ ...s, question_count_mode: "specify" }))}
                              />
                              <span className="daily-session-create-choice-copy">Specify</span>
                            </label>
                            <input
                              className={`daily-session-create-count-input ${dailySessionForm.question_count_mode === "specify" ? "is-active" : ""}`}
                              value={dailySessionForm.question_count}
                              disabled={dailySessionForm.question_count_mode !== "specify"}
                              onChange={(e) => setDailySessionForm((s) => ({ ...s, question_count: e.target.value }))}
                              placeholder=""
                            />
                          </div>
                        </div>
                        <div className="daily-session-create-help">
                          Available questions: {selectedDailyQuestionCount || 0}
                        </div>
                      </div>
                      <div className="daily-session-create-split-row">
                        <div className="daily-session-create-field">
                          <label>Date</label>
                          <input
                            type="date"
                            value={dailySessionForm.session_date}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, session_date: e.target.value }))}
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Start Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-daily-time-picker>
                            {(() => {
                              const startTimeParts = getTwelveHourTimeParts(dailySessionForm.start_time);
                              const isOpen = activeDailyTimePicker === "start_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => {
                                      setDailySetDropdownOpen(false);
                                      setActiveDailyTimePicker((current) => (current === "start_time" ? "" : "start_time"));
                                    }}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(dailySessionForm.start_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select start time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`daily-start-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`daily-start-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`daily-start-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${startTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("start_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                        <div className="daily-session-create-field">
                          <label>Close Time</label>
                          <div className="daily-session-create-time-picker-wrap" data-daily-time-picker>
                            {(() => {
                              const closeTimeParts = getTwelveHourTimeParts(dailySessionForm.close_time);
                              const isOpen = activeDailyTimePicker === "close_time";
                              return (
                                <>
                                  <button
                                    type="button"
                                    className="daily-session-create-time-trigger"
                                    aria-haspopup="dialog"
                                    aria-expanded={isOpen}
                                    onClick={() => {
                                      setDailySetDropdownOpen(false);
                                      setActiveDailyTimePicker((current) => (current === "close_time" ? "" : "close_time"));
                                    }}
                                  >
                                    <span>{formatTwelveHourTimeDisplay(dailySessionForm.close_time)}</span>
                                    <span className={`daily-session-create-multi-arrow ${isOpen ? "open" : ""}`}>▾</span>
                                  </button>
                                  {isOpen ? (
                                    <div className="daily-session-create-time-popover" role="dialog" aria-label="Select close time">
                                      <div className="daily-session-create-time-columns">
                                        <div className="daily-session-create-time-column">
                                          {TWELVE_HOUR_TIME_OPTIONS.map((hourValue) => (
                                            <button
                                              key={`daily-close-hour-${hourValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.hour === hourValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "hour", hourValue)}
                                            >
                                              {hourValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {FIVE_MINUTE_MINUTE_OPTIONS.map((minuteValue) => (
                                            <button
                                              key={`daily-close-minute-${minuteValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.minute === minuteValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "minute", minuteValue)}
                                            >
                                              {minuteValue}
                                            </button>
                                          ))}
                                        </div>
                                        <div className="daily-session-create-time-column">
                                          {MERIDIEM_OPTIONS.map((periodValue) => (
                                            <button
                                              key={`daily-close-period-${periodValue}`}
                                              type="button"
                                              className={`daily-session-create-time-option ${closeTimeParts.period === periodValue ? "active" : ""}`}
                                              onClick={() => updateDailySessionTimePart("close_time", "period", periodValue)}
                                            >
                                              {periodValue}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                      <div className="daily-session-create-two-col">
                        <div className="daily-session-create-field">
                          <label>Time Limit (min)</label>
                          <input
                            value={dailySessionForm.time_limit_min}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                            placeholder=""
                          />
                        </div>
                        <div className="daily-session-create-field">
                          <label>Pass Rate</label>
                          <input
                            value={dailySessionForm.pass_rate}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                            placeholder=""
                          />
                        </div>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Show Answers After Attempt</span>
                        <label className="daily-session-create-switch" aria-label="Show Answers After Attempt">
                          <input
                            type="checkbox"
                            checked={dailySessionForm.show_answers}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, show_answers: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-toggle-row">
                        <span>Allow Multiple Attempts</span>
                        <label className="daily-session-create-switch" aria-label="Allow Multiple Attempts">
                          <input
                            type="checkbox"
                            checked={dailySessionForm.allow_multiple_attempts}
                            onChange={(e) => setDailySessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.checked }))}
                          />
                          <span className="daily-session-create-switch-slider" />
                        </label>
                      </div>
                      <div className="daily-session-create-actions">
                        <button
                          className="btn btn-primary"
                          type="button"
                          onClick={createDailySession}
                        >
                          Create Session
                        </button>
                      </div>
                      {dailySessionsMsg ? <div className="admin-msg">{dailySessionsMsg}</div> : null}
                    </div>
                  )}
                </div>

                {dailyConductMode === "retake" ? (
                  <div className="admin-help" style={{ marginTop: 6 }}>
                    Student Base URL: <b>{getStudentBaseUrl() || "Not set"}</b>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        ) : null}

        {dailySubTab === "upload" ? (
        <>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="admin-title">Daily Test Upload (CSV)</div>
                <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" onClick={() => setDailyUploadOpen(true)}>
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      d="M10 13V4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <path
                      d="M6.75 7.75 10 4.5l3.25 3.25"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M4.5 14.5v1h11v-1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Upload Question Set
                </button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={dailyUploadCategory}
                onChange={(e) => setDailyUploadCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {dailyCategories.map((c) => (
                  <option key={`daily-upload-cat-${c.name}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 12 }}>
            {groupedDailyUploadTests.map((group) => (
              <div key={`daily-upload-group-${group.name}`}>
                {!dailyUploadCategory ? (
                  <div className="admin-subtitle" style={{ fontWeight: 900 }}>{group.name}</div>
                ) : null}
                <div className="admin-table-wrap" style={{ marginTop: !dailyUploadCategory ? 8 : 0 }}>
                  <table className="admin-table" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Category</th>
                        <th>SetID</th>
                        <th>Questions</th>
                        <th>Preview</th>
                        <th>Edit</th>
                        <th>Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tests.map((t) => (
                        <tr
                          key={t.id}
                          onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                        >
                          <td>{formatDateTime(t.created_at)}</td>
                          <td>
                            {editingTestId === t.id ? (
                              <>
                                <select
                                  value={editingCategorySelect}
                                  onChange={(e) => {
                                    const next = e.target.value;
                                    setEditingCategorySelect(next);
                                    if (next !== "__custom__") {
                                      setEditingTestForm((s) => ({ ...s, title: next }));
                                    }
                                  }}
                                >
                                  {dailyCategories.map((c) => (
                                    <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                                  ))}
                                  <option value="__custom__">Custom...</option>
                                </select>
                                {editingCategorySelect === "__custom__" ? (
                                  <input
                                    value={editingTestForm.title}
                                    onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                                    placeholder="Vocabulary Test"
                                    style={{ marginTop: 6 }}
                                  />
                                ) : null}
                              </>
                            ) : (
                              t.title ?? ""
                            )}
                          </td>
                          <td>
                            {editingTestId === t.id ? (
                              <input
                                value={editingTestForm.version}
                                onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                              />
                            ) : (
                              t.version ?? ""
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                          <td>
                            <button
                              className="btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                openPreview(t.version);
                              }}
                            >
                              Preview
                            </button>
                          </td>
                          <td>
                            {editingTestId === t.id ? (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                <button
                                  className="btn btn-primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveTestEdits(dailyCategories);
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditTest();
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditTest(t, dailyCategories);
                                }}
                              >
                                Edit
                              </button>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-danger"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteTest(t.version);
                              }}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
          {groupedDailyUploadTests.length === 0 ? <div className="admin-msg">{testsMsg || "No daily tests found."}</div> : null}
          {!dailyUploadOpen && dailyUploadMsg ? <div className="admin-msg">{dailyUploadMsg}</div> : null}
          {!dailyUploadOpen && dailyImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {dailyImportMsg}
            </pre>
          ) : null}
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          {groupedDailyUploadTests.length ? <div className="admin-msg">{testsMsg}</div> : null}

          {dailyUploadOpen ? (
            <div className="admin-modal-overlay" onClick={() => setDailyUploadOpen(false)}>
              <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Upload Daily Questions</div>
                  <button className="admin-modal-close" onClick={() => setDailyUploadOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>
                {dailyUploadMsg ? <div className="admin-msg" style={{ marginTop: 10 }}>{dailyUploadMsg}</div> : null}
                {dailyImportMsg ? (
                  <pre className="admin-msg" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
                    {dailyImportMsg}
                  </pre>
                ) : null}

                <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Category</label>
                    {dailyCategories.length ? (
                      <>
                        <select
                          value={dailyCategorySelect}
                          onChange={(e) => {
                            const next = e.target.value;
                            setDailyCategorySelect(next);
                            if (next !== "__custom__") {
                              setDailyForm((s) => ({ ...s, category: next }));
                            }
                          }}
                        >
                          {dailyCategories.map((c) => (
                            <option key={`daily-cat-${c.name}`} value={c.name}>{c.name}</option>
                          ))}
                          <option value="__custom__">Custom...</option>
                        </select>
                        {dailyCategorySelect === "__custom__" ? (
                          <input
                            value={dailyForm.category}
                            onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                            placeholder="Vocabulary Test"
                            style={{ marginTop: 6 }}
                          />
                        ) : null}
                      </>
                    ) : (
                      <input
                        value={dailyForm.category}
                        onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                        placeholder="Vocabulary Test"
                      />
                    )}
                  </div>
                  <div className="field">
                    <label>CSV File (required)</label>
                    <input
                      type="file"
                      accept=".csv,.tsv"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setDailyFile(file);
                        if (file && (file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".tsv"))) {
                          setDailyCsvFile(file);
                        }
                      }}
                    />
                    {dailyCsvFile ? (
                      <div className="admin-help" style={{ marginTop: 4 }}>
                        CSV ready: {dailyCsvFile.name}
                      </div>
                    ) : null}
                  </div>
                  <div className="field">
                    <label>Folder (PNG/MP3/M4A)</label>
                    <div className="upload-question-picker">
                      <input
                        ref={dailyFolderInputRef}
                        className="upload-question-picker-input"
                        type="file"
                        multiple
                        webkitdirectory="true"
                        directory="true"
                        accept=".csv,.tsv,.png,.jpg,.jpeg,.webp"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          setDailyFiles(files);
                          const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".tsv"));
                          if (csvFile) {
                            setDailyCsvFile(csvFile);
                          }
                        }}
                      />
                      <button className="btn upload-question-picker-button" type="button" onClick={() => dailyFolderInputRef.current?.click()}>
                        Choose Folder
                      </button>
                    </div>
                    {dailyFiles.length ? (
                      <div className="admin-help" style={{ marginTop: 4 }}>
                        Selected: {dailyFiles.length} files
                      </div>
                    ) : null}
                  </div>
                  <div className="upload-question-actions">
                    <button className="btn btn-primary admin-upload-cta-btn" type="button" onClick={uploadDailyAssets}>
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path
                          d="M10 13V4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                        <path
                          d="M6.75 7.75 10 4.5l3.25 3.25"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M4.5 14.5v1h11v-1"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Upload & Register Daily Test
                    </button>
                  </div>
                </div>
                <div className="admin-help" style={{ marginTop: 8 }}>
                  SetID is read from the CSV `set_id` column. If the file contains multiple `set_id` values, each one is imported as a separate daily test set.
                </div>
                <div className="admin-help" style={{ marginTop: 8 }}>
                  Template: <a href="/daily_question_csv_template.csv" download>Daily CSV template</a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
        </>
        ) : null}

        </>
        ) : null}

        {dailyRecordModalOpen && typeof document !== "undefined" ? createPortal((
          <div
            className="daily-record-modal-overlay"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.52)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: 20,
              overflowY: "auto",
            }}
            onClick={() => {
              if (dailyRecordSaving) return;
              closeDailyRecordModal();
            }}
          >
            <div
              className="daily-record-modal-shell"
              style={{
                width: "min(860px, 94vw)",
                maxWidth: 860,
                maxHeight: "calc(100vh - 40px)",
                background: "#ffffff",
                borderRadius: 12,
                boxShadow: "0 24px 60px rgba(15, 23, 42, 0.24)",
                padding: 0,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="daily-record-modal-topbar"
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  margin: 0,
                  padding: "14px 16px",
                  background: "#d9e7d7",
                  borderBottom: "1px solid #d1dbcf",
                  flex: "0 0 auto",
                }}
              >
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 800,
                    color: "#0f172a",
                    paddingRight: 40,
                  }}
                >
                  {`Daily Record${dailyRecordForm.record_date ? ` - ${formatDateFull(dailyRecordForm.record_date)}` : ""}`}
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 12,
                    border: 0,
                    background: "transparent",
                    color: "#333333",
                    fontSize: 24,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: "0 2px",
                    minWidth: 28,
                    minHeight: 28,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    if (dailyRecordSaving) return;
                    closeDailyRecordModal();
                  }}
                >
                  &times;
                </button>
              </div>

              <div
                className="daily-record-modal-body"
                style={{
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  overflowY: "auto",
                  flex: "1 1 auto",
                  minHeight: 0,
                }}
              >
                <div className="daily-record-modal-section">
                  <div className="daily-record-modal-section-head">
                    <div>
                      <div className="daily-record-modal-section-title">Today&apos;s Content</div>
                    </div>
                    <button className="btn" type="button" onClick={addDailyRecordTextbookEntry}>
                      Add Lesson
                    </button>
                  </div>
                  <div className="daily-record-textbook-list">
                    {dailyRecordForm.textbook_entries.map((entry, index) => {
                      const candoOptions = getIrodoriCanDoOptions(entry.book, entry.lesson);
                      return (
                        <div key={entry.tempId} className="daily-record-textbook-row">
                          <div className="daily-record-textbook-row-head">
                            <button
                              className="daily-record-textbook-remove-icon"
                              type="button"
                              onClick={() => removeDailyRecordTextbookEntry(entry.tempId)}
                              aria-label="Remove lesson"
                            >
                              &times;
                            </button>
                          </div>
                          <div className="daily-record-textbook-grid">
                            <div>
                              <label>Textbook</label>
                              <select
                                value={entry.textbook}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { textbook: e.target.value })}
                              >
                                <option value={IRODORI_TEXTBOOK_VALUE}>Irodori</option>
                              </select>
                            </div>
                            <div>
                              <label>Book</label>
                              <select
                                value={entry.book}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { book: e.target.value })}
                              >
                                {IRODORI_BOOK_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label>Lesson</label>
                              <select
                                value={entry.lesson}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { lesson: e.target.value })}
                              >
                                {IRODORI_LESSON_OPTIONS.map((lesson) => (
                                  <option key={`${entry.tempId}-lesson-${lesson}`} value={lesson}>
                                    {lesson}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="daily-record-cando-wrap">
                            <label>Can-do</label>
                            <div className="daily-record-cando-list">
                              {candoOptions.map((candoId) => (
                                <label key={`${entry.tempId}-cando-${candoId}`} className="daily-record-cando-option">
                                  <input
                                    type="checkbox"
                                    checked={entry.cando_ids.includes(candoId)}
                                    onChange={() => toggleDailyRecordCanDo(entry.tempId, candoId)}
                                  />
                                  <span>{candoId}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="field" style={{ marginTop: 16 }}>
                    <label>Other Content</label>
                    <textarea
                      rows={1}
                      className="daily-record-other-content"
                      value={dailyRecordForm.free_writing}
                      onChange={(e) => setDailyRecordForm((prev) => ({ ...prev, free_writing: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="daily-record-modal-section">
                  <div className="daily-record-modal-section-head">
                    <div>
                      <div className="daily-record-modal-section-title">Student Comment</div>
                    </div>
                    <button className="btn" type="button" onClick={addDailyRecordCommentRow}>
                      Add Student
                    </button>
                  </div>

                  <div className="daily-record-comments-list">
                    {dailyRecordForm.comments.map((item) => (
                      <div key={item.tempId} className="daily-record-comment-row">
                        <div className="daily-record-comment-row-head">
                          <button
                            className="daily-record-textbook-remove-icon"
                            type="button"
                            onClick={() => removeDailyRecordCommentRow(item.tempId)}
                            aria-label="Remove student comment"
                          >
                            &times;
                          </button>
                        </div>
                        <div className="daily-record-comment-fields">
                          <div>
                            <label>Student</label>
                            <select
                              value={item.student_id}
                              onChange={(e) => updateDailyRecordComment(item.tempId, { student_id: e.target.value })}
                            >
                              <option value="">Select student</option>
                              {activeStudents.map((student) => (
                                <option key={student.id} value={student.id}>
                                  {student.display_name || student.email || student.id}{student.student_code ? ` (${student.student_code})` : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label>Comment</label>
                            <textarea
                              rows={3}
                              value={item.comment}
                              onChange={(e) => updateDailyRecordComment(item.tempId, { comment: e.target.value })}
                              placeholder="Add a comment about this student."
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="daily-record-modal-section">
                  <div className="daily-record-modal-section-head">
                    <div>
                      <div className="daily-record-modal-section-title">Tomorrow&apos;s Tests</div>
                      <div className="admin-subtitle">Scheduled for {formatDateDots(dailyRecordTomorrowSessions.targetDate)}.</div>
                    </div>
                  </div>
                  <div className="daily-record-upcoming-grid">
                    <div>
                      <div className="daily-record-upcoming-label">Scheduled tests</div>
                      {dailyRecordTomorrowSessions.regular.length ? (
                        <div className="daily-record-upcoming-list">
                          {dailyRecordTomorrowSessions.regular.map((session) => (
                            <div key={session.id} className="daily-record-upcoming-item">
                              <span>{session.title}</span>
                              <strong>{session.timeLabel || "-"}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="daily-record-upcoming-empty">No standard tests scheduled.</div>
                      )}
                    </div>
                    <div>
                      <div className="daily-record-upcoming-label">Retake syllabus</div>
                      {dailyRecordTomorrowSessions.retake.length ? (
                        <div className="daily-record-upcoming-list">
                          {dailyRecordTomorrowSessions.retake.map((session) => (
                            <div key={session.id} className="daily-record-upcoming-item">
                              <span>{session.title}</span>
                              <strong>{session.timeLabel || "-"}</strong>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="daily-record-upcoming-empty">No retake sessions scheduled.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="daily-record-modal-section">
                  <div className="daily-record-modal-section-head">
                    <div>
                      <div className="daily-record-modal-section-title">Announcement Draft</div>
                      <div className="admin-subtitle">This message will be sent immediately and remain active with no end date until the next syllabus announcement replaces it.</div>
                    </div>
                  </div>
                    <div className="admin-form" style={{ marginTop: 0 }}>
                      <div className="field">
                        <label>Title</label>
                        <input
                          className="daily-record-announcement-title"
                          value={dailyRecordAnnouncementTitleDraft}
                          onChange={(e) => setDailyRecordAnnouncementTitleDraft(e.target.value)}
                          placeholder="Announcement title"
                        />
                    </div>
                    <div className="field" style={{ gridColumn: "1 / -1" }}>
                      <label>Message</label>
                      <textarea
                        className="daily-record-announcement-draft"
                        rows={10}
                        value={dailyRecordAnnouncementDraft}
                        onChange={(e) => setDailyRecordAnnouncementDraft(e.target.value)}
                        placeholder="Write your message here..."
                      />
                    </div>
                  </div>
                </div>

                {dailyRecordsMsg ? <div className="admin-msg">{dailyRecordsMsg}</div> : null}

                <div className="daily-record-modal-actions">
                  <button className="btn" onClick={closeDailyRecordModal} disabled={dailyRecordSaving}>
                    Cancel
                  </button>
                  <button className="btn" onClick={() => saveDailyRecord()} disabled={dailyRecordSaving}>
                    {dailyRecordSaving ? "Saving..." : "Save Record"}
                  </button>
                  {!dailyRecordExistingAnnouncement ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => saveDailyRecord({ announcementAction: "send" })}
                      disabled={dailyRecordSaving}
                    >
                      {dailyRecordSaving ? "Saving..." : "Save Record and Send Announcement"}
                    </button>
                  ) : null}
                  {dailyRecordExistingAnnouncement && dailyRecordAnnouncementNeedsEdit ? (
                    <button
                      className="btn btn-primary"
                      onClick={() => saveDailyRecord({ announcementAction: "edit" })}
                      disabled={dailyRecordSaving}
                    >
                      {dailyRecordSaving ? "Saving..." : "Save Record and Edit Announcements"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {studentInfoOpen && selectedStudent && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (studentInfoSaving) return;
              setStudentInfoOpen(false);
              setStudentInfoMsg("");
              setStudentInfoForm(getPersonalInfoForm(selectedStudent));
              setStudentInfoUploadFiles({});
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.5)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
              zIndex: 300,
            }}
          >
            <div
              className="admin-modal"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "relative",
                maxWidth: 720,
                width: "min(720px, calc(100vw - 28px))",
                paddingTop: 56,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  background: "#d9e7d7",
                  borderBottom: "1px solid #d1dbcf",
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                }}
              >
                <div
                  className="admin-title"
                  style={{
                    color: "#1f2937",
                    fontSize: 16,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    textAlign: "left",
                    marginRight: "auto",
                  }}
                >
                  Edit Information
                </div>
                <button
                  className="admin-modal-close"
                  onClick={() => {
                    if (studentInfoSaving) return;
                    setStudentInfoOpen(false);
                    setStudentInfoMsg("");
                    setStudentInfoForm(getPersonalInfoForm(selectedStudent));
                    setStudentInfoUploadFiles({});
                  }}
                  aria-label="Close"
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "#333333",
                    fontSize: 24,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: "4px 8px",
                    marginLeft: "auto",
                    cursor: "pointer",
                  }}
                >
                  &times;
                </button>
              </div>

              <div className="admin-form student-info-form" style={{ marginTop: 10, gridTemplateColumns: "1fr" }}>
                <div className="field">
                  <label>Full Name</label>
                  <input
                    value={studentInfoForm.display_name}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, display_name: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={studentInfoForm.email}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, email: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Student No.</label>
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={studentInfoForm.student_code}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, student_code: normalizeStudentNumberInput(e.target.value) }))}
                  />
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    Numbers only. Must be unique within this school.
                  </div>
                </div>
                <div className="field">
                  <label>Phone Number</label>
                  <input
                    value={studentInfoForm.phone_number}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, phone_number: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Date of Birth</label>
                  <input
                    type="date"
                    value={studentInfoForm.date_of_birth}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, date_of_birth: e.target.value }))}
                  />
                  <div className="admin-help" style={{ marginTop: 4 }}>
                    {calculateAge(studentInfoForm.date_of_birth) != null ? `Age ${calculateAge(studentInfoForm.date_of_birth)}` : "Age -"}
                  </div>
                </div>
                <div className="field">
                  <label>Sex</label>
                  <select
                    value={studentInfoForm.sex}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, sex: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {SEX_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Current Working Facility</label>
                  <input
                    value={studentInfoForm.current_working_facility}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, current_working_facility: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Years of Experience</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={studentInfoForm.years_of_experience}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, years_of_experience: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Nursing Certificate</label>
                  <input
                    value={studentInfoForm.nursing_certificate}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, nursing_certificate: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Certificate Status</label>
                  <select
                    value={studentInfoForm.nursing_certificate_status}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, nursing_certificate_status: e.target.value }))}
                  >
                    <option value="">Select</option>
                    {CERTIFICATE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>BNMC Registration Number</label>
                  <input
                    value={studentInfoForm.bnmc_registration_number}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, bnmc_registration_number: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>BNMC Registration Expiry Date</label>
                  <input
                    type="date"
                    value={studentInfoForm.bnmc_registration_expiry_date}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, bnmc_registration_expiry_date: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Passport Number</label>
                  <input
                    value={studentInfoForm.passport_number}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, passport_number: e.target.value }))}
                  />
                </div>
                {PERSONAL_UPLOAD_FIELDS.map((field) => {
                  const currentUpload = getProfileUploads(studentInfoForm.profile_uploads)[field.key];
                  return (
                    <div key={field.key} className="field">
                      <label>{field.label}</label>
                      <input
                        type="file"
                        accept={field.accept}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setStudentInfoUploadFiles((prev) => ({ ...prev, [field.key]: file }));
                        }}
                      />
                      <div className="admin-help" style={{ marginTop: 6 }}>
                        {studentInfoUploadFiles[field.key]
                          ? `Selected: ${studentInfoUploadFiles[field.key].name}`
                          : currentUpload?.url
                            ? "Current file"
                            : `Upload ${field.label.toLowerCase()}.`}
                      </div>
                      {currentUpload?.url ? renderProfileUpload(currentUpload, field.label) : null}
                    </div>
                  );
                })}
              </div>

              {studentInfoMsg ? <div className="admin-msg">{studentInfoMsg}</div> : null}

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="btn"
                  onClick={() => {
                    if (studentInfoSaving) return;
                    setStudentInfoOpen(false);
                    setStudentInfoMsg("");
                    setStudentInfoForm(getPersonalInfoForm(selectedStudent));
                    setStudentInfoUploadFiles({});
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={saveStudentInformation}
                  disabled={studentInfoSaving}
                >
                  {studentInfoSaving ? "Saving..." : "Save Information"}
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {reissueOpen && reissueStudent && typeof document !== "undefined" ? createPortal((
          <div className="admin-modal-overlay" onClick={closeReissueModal}>
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Reissue Temp Password</div>
                <button className="admin-modal-close" onClick={closeReissueModal} aria-label="Close">
                  &times;
                </button>
              </div>
              <div className="admin-help" style={{ marginTop: 6 }}>
                {reissueStudent.display_name ?? ""} {reissueStudent.student_code ? `(${reissueStudent.student_code})` : ""}
              </div>
              <div className="admin-help">{reissueStudent.email ?? reissueStudent.id}</div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Temp Password</label>
                  <input
                    value={reissuePassword}
                    onChange={(e) => setReissuePassword(e.target.value)}
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setReissuePassword(generateTempPassword())}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {reissueMsg ? <div className="admin-msg">{reissueMsg}</div> : null}

              {reissueIssuedPassword ? (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(reissueIssuedPassword);
                        setReissueMsg("Copied to clipboard.");
                      } catch {
                        setReissueMsg("Copy failed. Please copy manually.");
                      }
                    }}
                  >
                    Copy to Clipboard
                  </button>
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="btn" onClick={closeReissueModal} disabled={reissueLoading}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => reissueTempPassword(reissueStudent, reissuePassword.trim())}
                  disabled={reissueLoading}
                >
                  {reissueLoading ? "Generating..." : "Reissue Temp Password"}
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {inviteOpen && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => setInviteOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              width: "100vw",
              height: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
              background: "rgba(15, 23, 42, 0.5)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
              zIndex: 300,
            }}
          >
            <div
              className="admin-modal student-add-modal"
              onClick={(e) => e.stopPropagation()}
              style={{ position: "relative", zIndex: 301 }}
            >
              <div
                className="student-add-modal-titlebar"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 14px",
                  background: "#d9e7d7",
                  borderBottom: "1px solid #d1dbcf",
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  zIndex: 1,
                }}
              >
                <div
                  className="admin-title student-add-modal-title"
                  style={{
                    display: "block",
                    color: "#1f2937",
                    fontSize: 16,
                    fontWeight: 800,
                    lineHeight: 1.2,
                    textAlign: "left",
                    marginRight: "auto",
                  }}
                >
                  Add New Student
                </div>
                <button
                  className="admin-modal-close student-add-modal-close"
                  onClick={() => setInviteOpen(false)}
                  aria-label="Close"
                  style={{
                    border: 0,
                    background: "transparent",
                    color: "#333333",
                    fontSize: 24,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: "4px 8px",
                    marginLeft: "auto",
                    cursor: "pointer",
                  }}
                >
                  &times;
                </button>
              </div>
              <div className="admin-form" style={{ marginTop: 10, gridTemplateColumns: "1fr" }}>
                <div className="field">
                  <label>Email</label>
                  <input
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm((s) => ({ ...s, email: e.target.value }))}
                    placeholder="student@example.com"
                  />
                </div>
                <div className="field">
                  <label>Name</label>
                  <input
                    value={inviteForm.display_name}
                    onChange={(e) => setInviteForm((s) => ({ ...s, display_name: e.target.value }))}
                    placeholder="Taro"
                  />
                </div>
                <div className="field">
                  <label>Student No.</label>
                  <input
                    value={inviteForm.student_code}
                    onChange={(e) => setInviteForm((s) => ({ ...s, student_code: e.target.value }))}
                    placeholder="ID001"
                  />
                </div>
                <div className="field">
                  <label>Temp Password</label>
                  <input
                    value={inviteForm.temp_password}
                    onChange={(e) => setInviteForm((s) => ({ ...s, temp_password: e.target.value }))}
                    placeholder="(optional)"
                  />
                </div>
              </div>
              {studentMsg ? <div className="admin-msg">{studentMsg}</div> : null}
              {inviteResults.length ? (
                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>OK</th>
                        <th>User ID</th>
                        <th>Error/Warning</th>
                        <th>Temp Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inviteResults.map((r, idx) => (
                        <tr key={`${r.email}-${idx}`}>
                          <td>{r.email}</td>
                          <td style={{ textAlign: "center" }}>{r.ok ? "OK" : "NG"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.user_id ?? ""}</td>
                          <td>{r.error ?? r.warning ?? ""}</td>
                          <td>{r.temp_password ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setInviteForm((s) => ({ ...s, temp_password: generateTempPassword() }))}
                >
                  Generate
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={async () => {
                    const ok = await inviteStudents(inviteForm);
                    if (ok) setInviteOpen(false);
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {attendanceImportStatus && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (!attendanceImportStatus.loading) closeAttendanceImportStatus();
            }}
          >
            <div className="admin-modal attendance-import-status-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">{attendanceImportStatus.title}</div>
                {!attendanceImportStatus.loading ? (
                  <button
                    className="admin-modal-close"
                    aria-label="Close"
                    onClick={closeAttendanceImportStatus}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className={`attendance-import-status-body tone-${attendanceImportStatus.tone ?? "info"}`}>
                {attendanceImportStatus.loading ? (
                  <div className="attendance-import-status-loading">
                    <span className="attendance-import-status-spinner" aria-hidden="true" />
                    <span>{attendanceImportStatus.message}</span>
                  </div>
                ) : (
                  <div className="attendance-import-status-message">{attendanceImportStatus.message}</div>
                )}
              </div>

              {!attendanceImportStatus.loading ? (
                <div className="attendance-import-status-actions">
                  <button className="btn btn-primary" type="button" onClick={closeAttendanceImportStatus}>
                    Close
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ), document.body) : null}

        {resultsImportStatus?.open && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (!resultsImportStatus.loading) closeResultsImportStatus();
            }}
          >
            <div className="admin-modal attendance-import-status-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">{resultsImportStatus.title}</div>
                {!resultsImportStatus.loading ? (
                  <button
                    className="admin-modal-close"
                    aria-label="Close"
                    onClick={closeResultsImportStatus}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className={`attendance-import-status-body tone-${resultsImportStatus.tone ?? "info"}`}>
                {resultsImportStatus.loading ? (
                  <div className="attendance-import-status-loading">
                    <span className="attendance-import-status-spinner" aria-hidden="true" />
                    <span>{resultsImportStatus.message}</span>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div className="attendance-import-status-message">{resultsImportStatus.message}</div>
                    <div className="admin-form" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
                      <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                        <label>Category</label>
                        <select
                          value={resultsImportStatus.categorySelect ?? ""}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setResultsImportStatus((current) => ({
                              ...current,
                              categorySelect: nextValue,
                              categoryDraft: nextValue === RESULTS_IMPORT_NEW_CATEGORY_OPTION ? current?.categoryDraft ?? "" : "",
                            }));
                          }}
                        >
                          <option value="">Select category</option>
                          {(resultsImportStatus.type === "daily" ? dailyResultsImportCategories : modelResultsImportCategories).map((categoryName) => (
                            <option key={`results-import-category-${resultsImportStatus.type}-${categoryName}`} value={categoryName}>
                              {categoryName}
                            </option>
                          ))}
                          <option value={RESULTS_IMPORT_NEW_CATEGORY_OPTION}>Create new category...</option>
                        </select>
                      </div>
                      {resultsImportStatus.categorySelect === RESULTS_IMPORT_NEW_CATEGORY_OPTION ? (
                        <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                          <label>New Category</label>
                          <input
                            value={resultsImportStatus.categoryDraft ?? ""}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              setResultsImportStatus((current) => ({
                                ...current,
                                categoryDraft: nextValue,
                              }));
                            }}
                            placeholder="New category name"
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>

              {!resultsImportStatus.loading ? (
                <div className="attendance-import-status-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => resultsImportInputRef.current?.click()}
                    disabled={!getResultsImportTargetCategoryName(resultsImportStatus)}
                  >
                    Select CSV File
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ), document.body) : null}

        {dailyManualEntryModal.open && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (!dailyManualEntryModal.saving) closeDailyManualEntryModal();
            }}
          >
            <div className="admin-modal attendance-import-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">{dailyManualEntryModal.hasImportedAttempt ? "Edit Manual Daily Result" : "Add Manual Daily Result"}</div>
                {!dailyManualEntryModal.saving ? (
                  <button
                    className="admin-modal-close"
                    aria-label="Close"
                    onClick={closeDailyManualEntryModal}
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="attendance-import-modal-body">
                <div className="admin-form" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                    <label>Student</label>
                    <div className="form-input readonly">
                      {dailyManualEntryStudent?.display_name ?? dailyManualEntryStudent?.email ?? dailyManualEntryStudent?.id ?? "-"}
                      {dailyManualEntryStudent?.student_code ? ` (${dailyManualEntryStudent.student_code})` : ""}
                    </div>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                    <label>Test Session</label>
                    <div className="form-input readonly">
                      {dailyManualEntrySession?.title ?? dailyManualEntrySession?.problem_set_id ?? "-"}
                    </div>
                  </div>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: 0 }}>
                    <label>Score (%)</label>
                    <input
                      value={dailyManualEntryModal.rateInput}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDailyManualEntryModal((current) => ({
                          ...current,
                          rateInput: nextValue,
                          msg: "",
                        }));
                      }}
                      placeholder="e.g. 82.5"
                      inputMode="decimal"
                      disabled={dailyManualEntryModal.saving}
                    />
                  </div>
                </div>
                <div className="attendance-import-modal-note">
                  This saves a summary result for the selected daily test session. Real submitted attempts are not modified.
                </div>
                {Number(dailyManualEntrySession?.linkedTest?.question_count ?? 0) <= 0 ? (
                  <div className="attendance-import-modal-note">
                    This session has no question count, so the manual entry will store the percentage only.
                  </div>
                ) : null}
                {dailyManualEntryModal.msg ? (
                  <div className="admin-msg" style={{ marginTop: 10 }}>{dailyManualEntryModal.msg}</div>
                ) : null}
              </div>

              <div className="attendance-import-modal-actions">
                {dailyManualEntryModal.hasImportedAttempt ? (
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={clearDailyManualEntry}
                    disabled={dailyManualEntryModal.saving}
                  >
                    Clear Manual Result
                  </button>
                ) : null}
                <button
                  className="btn"
                  type="button"
                  onClick={closeDailyManualEntryModal}
                  disabled={dailyManualEntryModal.saving}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={saveDailyManualEntry}
                  disabled={dailyManualEntryModal.saving}
                >
                  {dailyManualEntryModal.saving ? "Saving..." : "Save Result"}
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {attendanceImportConflict && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => resolveAttendanceImportConflict("cancel")}
          >
            <div className="admin-modal attendance-import-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Attendance Import Warning</div>
                <button
                  className="admin-modal-close"
                  aria-label="Close"
                  onClick={() => resolveAttendanceImportConflict("cancel")}
                >
                  ×
                </button>
              </div>

              <div className="attendance-import-modal-body">
                <div className="admin-help">
                  This CSV includes {attendanceImportConflict.dayDates.length} day{attendanceImportConflict.dayDates.length === 1 ? "" : "s"} that already exist in the attendance sheet.
                </div>
                <div className="attendance-import-modal-note">
                  Choose one action for those existing date columns:
                </div>
                <div className="attendance-import-modal-option-list">
                  <div><strong>Update Existing Columns</strong>: replace the existing attendance for those dates with the CSV values, and add any new dates.</div>
                  <div><strong>Only Add New Columns</strong>: skip the existing dates and import only dates that are not already in the sheet.</div>
                  <div><strong>Cancel Import</strong>: stop this upload without changing anything.</div>
                </div>
                <div className="attendance-import-modal-date-list">
                  {attendanceImportConflict.previewDates.map((dayDate) => (
                    <span key={`attendance-import-conflict-${dayDate}`} className="attendance-import-modal-date-pill">
                      {formatDateFull(dayDate)}
                    </span>
                  ))}
                  {attendanceImportConflict.dayDates.length > attendanceImportConflict.previewDates.length ? (
                    <span className="attendance-import-modal-more">
                      +{attendanceImportConflict.dayDates.length - attendanceImportConflict.previewDates.length} more
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="attendance-import-modal-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => resolveAttendanceImportConflict("update")}
                >
                  Update Existing Columns
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => resolveAttendanceImportConflict("new_only")}
                >
                  Only Add New Columns
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => resolveAttendanceImportConflict("cancel")}
                >
                  Cancel Import
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {dailyResultsImportConflict && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => resolveDailyResultsImportConflict("cancel")}
          >
            <div className="admin-modal attendance-import-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Daily Results Import Warning</div>
                <button
                  className="admin-modal-close"
                  aria-label="Close"
                  onClick={() => resolveDailyResultsImportConflict("cancel")}
                >
                  ×
                </button>
              </div>

              <div className="attendance-import-modal-body">
                <div className="admin-help">
                  This CSV includes {dailyResultsImportConflict.testTitles.length} test title{dailyResultsImportConflict.testTitles.length === 1 ? "" : "s"} that already exist in the current category results.
                </div>
                <div className="attendance-import-modal-note">
                  Choose how to handle those same-name tests:
                </div>
                <div className="attendance-import-modal-option-list">
                  <div><strong>Overwrite and Import All</strong>: replace the existing results for those tests with the CSV data. Existing attempts for those sessions will be deleted.</div>
                  <div><strong>Only Import New Tests</strong>: skip the same-name tests and import only CSV tests whose titles are not already in the current category.</div>
                  <div><strong>Cancel Import</strong>: stop this upload without changing anything.</div>
                </div>
                <div className="attendance-import-modal-date-list">
                  {dailyResultsImportConflict.previewTitles.map((title) => (
                    <span key={`daily-results-import-conflict-${title}`} className="attendance-import-modal-date-pill">
                      {title}
                    </span>
                  ))}
                  {dailyResultsImportConflict.testTitles.length > dailyResultsImportConflict.previewTitles.length ? (
                    <span className="attendance-import-modal-more">
                      +{dailyResultsImportConflict.testTitles.length - dailyResultsImportConflict.previewTitles.length} more
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="attendance-import-modal-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => resolveDailyResultsImportConflict("overwrite")}
                >
                  Overwrite and Import All
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => resolveDailyResultsImportConflict("new_only")}
                >
                  Only Import New Tests
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => resolveDailyResultsImportConflict("cancel")}
                >
                  Cancel Import
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {modelResultsImportConflict && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => resolveModelResultsImportConflict("cancel")}
          >
            <div className="admin-modal attendance-import-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Model Results Import Warning</div>
                <button
                  className="admin-modal-close"
                  aria-label="Close"
                  onClick={() => resolveModelResultsImportConflict("cancel")}
                >
                  ×
                </button>
              </div>

              <div className="attendance-import-modal-body">
                <div className="admin-help">
                  This CSV includes {modelResultsImportConflict.testTitles.length} test title{modelResultsImportConflict.testTitles.length === 1 ? "" : "s"} that already exist in the current results.
                </div>
                <div className="attendance-import-modal-note">
                  Choose how to handle those same-name tests:
                </div>
                <div className="attendance-import-modal-option-list">
                  <div><strong>Overwrite and Import All</strong>: replace the existing results for those tests with the CSV data. Existing detailed attempts for those sessions will be deleted.</div>
                  <div><strong>Only Import New Tests</strong>: skip the same-name tests and import only CSV tests whose titles are not already in the current results.</div>
                  <div><strong>Cancel Import</strong>: stop this upload without changing anything.</div>
                </div>
                <div className="attendance-import-modal-date-list">
                  {modelResultsImportConflict.previewTitles.map((title) => (
                    <span key={`model-results-import-conflict-${title}`} className="attendance-import-modal-date-pill">
                      {title}
                    </span>
                  ))}
                  {modelResultsImportConflict.testTitles.length > modelResultsImportConflict.previewTitles.length ? (
                    <span className="attendance-import-modal-more">
                      +{modelResultsImportConflict.testTitles.length - modelResultsImportConflict.previewTitles.length} more
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="attendance-import-modal-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => resolveModelResultsImportConflict("overwrite")}
                >
                  Overwrite and Import All
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => resolveModelResultsImportConflict("new_only")}
                >
                  Only Import New Tests
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => resolveModelResultsImportConflict("cancel")}
                >
                  Cancel Import
                </button>
              </div>
            </div>
          </div>
        ), document.body) : null}

        {attendanceModalOpen && attendanceModalDay && typeof document !== "undefined" ? createPortal((
          <div
            className="admin-modal-overlay"
            onClick={() => {
              setAttendanceModalOpen(false);
              setAttendanceModalDay(null);
              setAttendanceDraft({});
              setAttendanceSaving(false);
            }}
          >
            <div className="admin-modal attendance-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">
                  {`Attendance - ${formatDateFull(attendanceModalDay.day_date)}`}
                </div>
                <button
                  className="admin-modal-close"
                  aria-label="Close"
                  onClick={() => {
                    setAttendanceModalOpen(false);
                    setAttendanceModalDay(null);
                    setAttendanceDraft({});
                    setAttendanceSaving(false);
                  }}
                >
                  ×
                </button>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10, maxHeight: "60vh" }}>
                <table className="admin-table attendance-modal-table">
                  <thead>
                    <tr>
                      <th>Student<br />No.</th>
                      <th>Student</th>
                      <th>Present</th>
                      <th>Late/Leave Early</th>
                      <th>Excused Absence</th>
                      <th>Unexcused Absence</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStudents.map((s) => {
                      const entry = attendanceDraft?.[s.id] || { status: "", comment: "" };
                      const approved = approvedAbsenceByStudent?.[s.id];
                      return (
                        <tr key={`att-${s.id}`}>
                          <td>{s.student_code ?? ""}</td>
                          <td>
                            {s.display_name ?? s.email ?? s.id}
                            {approved ? (
                              <div className={`admin-help att-approved-note ${approved.type === "excused" ? "excused" : "late"}`} style={{ marginTop: 4 }}>
                                Approved {approved.type === "excused" ? "Excused Absence" : "Late/Leave Early"}
                                {approved.time_value ? ` (${approved.time_value})` : ""}
                              </div>
                            ) : null}
                          </td>
                          {["P", "L", "E", "A"].map((code) => (
                            <td key={`${s.id}-${code}`}>
                              <button
                                className={`att-status-btn ${entry.status === code ? "active" : ""} att-${code}`}
                                type="button"
                                onClick={() =>
                                  setAttendanceDraft((prev) => ({
                                    ...prev,
                                    [s.id]: { ...entry, status: code }
                                  }))
                                }
                              >
                                {code}
                              </button>
                            </td>
                          ))}
                          <td>
                            <input
                              value={entry.comment || ""}
                              onChange={(e) =>
                                setAttendanceDraft((prev) => ({
                                  ...prev,
                                  [s.id]: { ...entry, comment: e.target.value }
                                }))
                              }
                              placeholder="(optional)"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={saveAttendanceDay} disabled={attendanceSaving}>
                  {attendanceSaving ? "Saving..." : "Save Attendance"}
                </button>
                {attendanceModalDay.id ? (
                  <button className="btn btn-danger" onClick={() => deleteAttendanceDay(attendanceModalDay)}>
                    Delete Day
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ), document.body) : null}

        {resultContext ? (
        <>
        {sessionDetail.type === resultContext.type && sessionDetail.sessionId ? (
          renderSessionDetailView()
        ) : (
          <>
            <div className="results-page-header">
              <div className="results-page-header-row">
                {(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).length ? (
                  <div className="admin-mini-tabs results-category-tabs">
                    {resultContext.type === "mock" ? (
                      <button
                        key="model-cat-all"
                        className={`admin-mini-tab results-category-tab ${!modelResultsCategory ? "active" : ""}`}
                        onClick={() => setModelResultsCategory("")}
                      >
                        All
                      </button>
                    ) : null}
                    {(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).map((c) => (
                      <button
                        key={`daily-cat-${c.name}`}
                        className={`admin-mini-tab results-category-tab ${((resultContext.type === "daily"
                          ? selectedDailyCategory
                          : selectedModelCategory)?.name === c.name)
                          ? "active"
                          : ""}`}
                        onClick={() => {
                          if (resultContext.type === "daily") {
                            setDailyResultsCategory(c.name);
                          } else {
                            setModelResultsCategory(c.name);
                          }
                        }}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : <div />}
                <div className="results-page-title-wrap">
                  <div className="admin-title">{resultContext.title}</div>
                </div>
                <div className="results-page-actions">
                  <button
                    className="btn admin-icon-action-btn"
                    aria-label="Refresh results"
                    title="Refresh results"
                    onClick={() => runSearch(resultContext.type)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path
                        d="M16 10a6 6 0 1 1-1.76-4.24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path
                        d="M16 4.5v3.75h-3.75"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className="btn results-page-action-btn"
                    onClick={() => (resultContext.type === "daily" ? exportDailyGoogleSheetsCsv() : exportModelGoogleSheetsCsv())}
                  >
                    <span className="results-page-action-icon" aria-hidden="true">↓</span>
                    <span>Export CSV</span>
                  </button>
                  <button
                    className="btn results-page-action-btn"
                    type="button"
                    onClick={() => openResultsImportStatus(resultContext.type)}
                  >
                    <span className="results-page-action-icon" aria-hidden="true">↑</span>
                    <span>Import CSV</span>
                  </button>
                  {resultContext.type === "daily" ? (
                    <button
                      className={`btn results-page-action-btn ${dailyManualEntryMode ? "active" : ""}`}
                      type="button"
                      onClick={() => setDailyManualEntryMode((current) => !current)}
                      disabled={!selectedDailyCategory}
                    >
                      <span className="results-page-action-icon" aria-hidden="true">M</span>
                      <span>{dailyManualEntryMode ? "Manual Entry On" : "Manual Entry"}</span>
                    </button>
                  ) : null}
                  {resultContext.type === "daily" ? (
                    <button
                      className="btn btn-danger results-page-action-btn"
                      type="button"
                      onClick={() => clearDailyResultsForCategory(selectedDailyCategory)}
                      disabled={!selectedDailyCategory}
                    >
                      <span>Clear All Results</span>
                    </button>
                  ) : null}
                  <input
                    ref={resultsImportInputRef}
                    type="file"
                    accept=".csv,.tsv"
                    style={{ display: "none" }}
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      const importType = resultsImportStatus?.type || resultContext.type;
                      const targetCategoryName = getResultsImportTargetCategoryName();
                      if (importType === "daily") {
                        importDailyResultsGoogleSheetsCsv(file, targetCategoryName);
                        return;
                      }
                      importModelResultsGoogleSheetsCsv(file, targetCategoryName);
                    }}
                  />
                </div>
              </div>
              {quizMsg ? <div className="admin-help">{quizMsg}</div> : null}
              {resultContext.type === "daily" && dailyManualEntryMode ? (
                <div className="admin-help" style={{ marginTop: 6 }}>
                  Manual entry mode is on. Click an empty cell to add a score, or click an imported summary cell to update it. Cells with real submitted attempts stay read-only.
                </div>
              ) : null}
            </div>

            {resultContext.type === "daily" || resultContext.type === "mock" ? (
              <>
                {!(resultContext.type === "daily" ? dailyResultCategories : modelResultCategories).length ? (
                  <div className="admin-msg">No test categories yet.</div>
                ) : null}

                <div className="admin-table-wrap results-matrix-table-wrap" style={{ marginTop: 10 }}>
                  <table
                    className={`admin-table daily-results-table ${resultContext.type === "mock" ? "model-results-matrix-table" : ""}`}
                    style={{
                      minWidth: Math.max(
                        860,
                        360 + ((resultContext.type === "daily"
                          ? dailyResultsMatrix.sessions.length
                          : modelResultsMatrix.sessions.length) || 0) * 140
                      )
                    }}
                  >
                    <thead>
                      <tr>
                        <th className="daily-sticky-1 daily-col-no">Student<br />No.</th>
                        <th className="daily-sticky-2 daily-col-name">Student Name</th>
                      {(resultContext.type === "daily" ? dailyResultsMatrix.sessions : modelResultsMatrix.sessions).map((sessionItem) => {
                        const sessionAverage = (resultContext.type === "daily"
                          ? dailyResultsSessionHeaderAverages
                          : modelResultsSessionHeaderAverages)[sessionItem.id] ?? null;
                        return (
                          <th key={`daily-col-${sessionItem.id}`}>
                            {((resultContext.type === "daily"
                              ? dailyResultsSessionDetailAvailability
                              : modelResultsSessionDetailAvailability)[sessionItem.id]) ? (
                              <button
                                type="button"
                                className="session-column-link"
                                onClick={() => openSessionDetailView(sessionItem, resultContext.type)}
                              >
                                <div className="daily-col-title">{sessionItem.title ?? sessionItem.problem_set_id ?? ""}</div>
                                <div className="daily-col-date">{formatDateShort(sessionItem.starts_at || sessionItem.created_at)}</div>
                                <div className="daily-col-average">
                                  Avg {(((sessionAverage?.averageRate ?? 0) * 100)).toFixed(1)}%
                                </div>
                              </button>
                            ) : (
                              <div className="session-column-link" style={{ cursor: "default" }}>
                                <div className="daily-col-title">{sessionItem.title ?? sessionItem.problem_set_id ?? ""}</div>
                                <div className="daily-col-date">{formatDateShort(sessionItem.starts_at || sessionItem.created_at)}</div>
                                <div className="daily-col-average">
                                  Avg {(((sessionAverage?.averageRate ?? 0) * 100)).toFixed(1)}%
                                </div>
                              </div>
                            )}
                          </th>
                        );
                      })}
                      </tr>
                    </thead>
                    <tbody>
                      {(resultContext.type === "daily" ? dailyResultsMatrix.rows : modelResultsMatrix.rows)
                        .filter((row) => !row.student.is_withdrawn)
                        .map((row) => (
                        <tr key={`daily-row-${row.student.id}`}>
                          <td className="daily-sticky-1 daily-col-no">{row.student.student_code ?? ""}</td>
                          <td className="daily-sticky-2 daily-col-name">
                            <div className="daily-name">{row.student.display_name ?? ""}</div>
                          </td>
                          {row.cells.map((attemptList, idx) => {
                            const sessionItem = (resultContext.type === "daily"
                              ? dailyResultsMatrix.sessions
                              : modelResultsMatrix.sessions)[idx];
                            const canEditManualCell = resultContext.type === "daily"
                              && dailyManualEntryMode
                              && Array.isArray(attemptList)
                              && attemptList.every((attempt) => isImportedSummaryAttempt(attempt));
                            const editableImportedAttempt = attemptList?.find((attempt) => isImportedSummaryAttempt(attempt)) ?? null;
                            if (!attemptList?.length) {
                              return (
                                <td key={`daily-cell-${row.student.id}-${idx}`} className="daily-score-cell">
                                  {resultContext.type === "daily" && dailyManualEntryMode ? (
                                    <button
                                      className="daily-manual-cell-btn"
                                      type="button"
                                      onClick={() => openDailyManualEntryModal(row.student, sessionItem, [])}
                                    >
                                      Add result
                                    </button>
                                  ) : "—"}
                                </td>
                              );
                            }
                            const passRate = getSessionEffectivePassRate(sessionItem, attemptList);
                            const cellKey = `${row.student.id}:${sessionItem.id}`;
                            const extraAttempts = attemptList.slice(1);
                            const visibleAttempts = expandedResultCells[cellKey] ? attemptList : attemptList.slice(0, 1);
                            return (
                              <td
                                key={`daily-cell-${row.student.id}-${idx}`}
                                className="daily-score-cell"
                              >
                                <div className="daily-score-stack">
                                  {visibleAttempts.map((attempt, attemptIdx) => {
                                    const rateValue = getScoreRate(attempt);
                                    const label = `${(rateValue * 100).toFixed(1)}%`;
                                    const isLow = Number.isFinite(passRate) && passRate > 0 && rateValue < passRate;
                                    const tabLeftCount = getTabLeftCount(attempt);
                                    const scoreContent = (
                                      <>
                                        <span className="daily-score-main">
                                          {attempt.__isRetake ? <span className="daily-retake-icon">Re</span> : null}
                                          <span>{label}</span>
                                        </span>
                                        {tabLeftCount > 0 ? (
                                          <span className="daily-score-meta daily-score-meta-alert">
                                            Tabs left: {tabLeftCount}
                                          </span>
                                        ) : null}
                                      </>
                                    );
                                    if (!attemptCanOpenDetail(attempt)) {
                                      return (
                                        <div
                                          key={`daily-cell-${row.student.id}-${idx}-${attempt.id || attemptIdx}`}
                                          className={`daily-score-btn ${isLow ? "low" : ""}`}
                                        >
                                          {scoreContent}
                                        </div>
                                      );
                                    }
                                    return (
                                      <button
                                        key={`daily-cell-${row.student.id}-${idx}-${attempt.id || attemptIdx}`}
                                        className={`daily-score-btn ${isLow ? "low" : ""}`}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openAttemptDetail(attempt);
                                        }}
                                      >
                                        {scoreContent}
                                      </button>
                                    );
                                  })}
                                  {extraAttempts.length ? (
                                    <button
                                      className="daily-more-btn"
                                      type="button"
                                      onClick={() => {
                                        setExpandedResultCells((prev) => ({
                                          ...prev,
                                          [cellKey]: !prev[cellKey],
                                        }));
                                      }}
                                    >
                                      {expandedResultCells[cellKey]
                                        ? "Hide extra attempts"
                                        : `${extraAttempts.length} more attempt${extraAttempts.length > 1 ? "s" : ""}`}
                                    </button>
                                  ) : null}
                                  {canEditManualCell ? (
                                    <button
                                      className="daily-manual-cell-btn"
                                      type="button"
                                      onClick={() => openDailyManualEntryModal(row.student, sessionItem, attemptList)}
                                    >
                                      {editableImportedAttempt ? "Edit manual result" : "Add result"}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="admin-msg">{loading ? "Loading..." : msg}</div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <div className="admin-title">Tests</div>
                    </div>
                    <button className="btn" onClick={() => applyTestFilter("", resultContext.type)}>Clear Filter</button>
                  </div>
                  {filters.testVersion ? (
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      Filter: <b>{filters.testVersion}</b>
                    </div>
                  ) : null}
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 860 }}>
                      <thead>
                        <tr>
                          <th>Created</th>
                          <th>SetID</th>
                          <th>Category</th>
                          <th>Questions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {resultContext.tests.map((t) => (
                          <tr key={`result-test-${t.id}`} onClick={() => applyTestFilter(t.version, resultContext.type)}>
                            <td>{formatDateTime(t.created_at)}</td>
                            <td>{t.version ?? ""}</td>
                            <td>{t.title ?? ""}</td>
                            <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <form
                  className="admin-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    runSearch(resultContext.type);
                  }}
                >
                  <div className="field">
                    <label>Student No.（partial match）</label>
                    <input
                      placeholder="ID001"
                      value={filters.code}
                      onChange={(e) => setFilters((s) => ({ ...s, code: e.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Display Name（部分一致）</label>
                    <input
                      placeholder="Taro"
                      value={filters.name}
                      onChange={(e) => setFilters((s) => ({ ...s, name: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>From（created_at）</label>
                    <input
                      type="date"
                      value={filters.from}
                      onChange={(e) => setFilters((s) => ({ ...s, from: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>To（created_at）</label>
                    <input
                      type="date"
                      value={filters.to}
                      onChange={(e) => setFilters((s) => ({ ...s, to: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>Limit</label>
                    <select
                      value={filters.limit}
                      onChange={(e) => setFilters((s) => ({ ...s, limit: Number(e.target.value) }))}
                    >
                      <option value={50}>50</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                    </select>
                  </div>
                  <div className="field small">
                    <label>&nbsp;</label>
                    <button className="btn btn-primary" type="submit">Search</button>
                  </div>
                </form>

                <div className="admin-kpi">
                  <div className="box">
                    <div className="label">Attempts</div>
                    <div className="value">{kpi.count}</div>
                  </div>
                  <div className="box">
                    <div className="label">Avg rate</div>
                    <div className="value">{(kpi.avgRate * 100).toFixed(1)}%</div>
                  </div>
                  <div className="box">
                    <div className="label">Max rate</div>
                    <div className="value">{(kpi.maxRate * 100).toFixed(1)}%</div>
                  </div>
                </div>

                <div style={{ marginTop: 12 }} className="admin-table-wrap">
                  <table className="admin-table admin-model-results-table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Name</th>
                        <th>Student<br />No.</th>
                        <th>Score</th>
                        <th>Rate</th>
                        <th>Test</th>
                        <th>Attempt ID</th>
                        <th>Detail CSV</th>
                        <th>Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attempts.map((a) => {
                        const score = `${a.correct}/${a.total}`;
                        const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                        return (
                          <tr key={a.id}>
                            <td>
                              <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                {formatDateTime(a.created_at)}
                              </button>
                            </td>
                            <td>{a.display_name ?? ""}</td>
                            <td>{a.student_code ?? ""}</td>
                            <td>
                              <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                {score}
                              </button>
                            </td>
                            <td>
                              <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                {rate}
                              </button>
                            </td>
                            <td>
                              <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                {a.test_version ?? ""}
                              </button>
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <button className="admin-model-results-link" type="button" onClick={() => openAttemptDetail(a)}>
                                {a.id}
                              </button>
                            </td>
                            <td>
                              <button
                                className="btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportSelectedAttemptCsv(a);
                                }}
                              >
                                Download
                              </button>
                            </td>
                            <td>
                              <button
                                className="btn btn-danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAttempt(a.id);
                                }}
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
	                <div className="admin-msg">{loading ? "Loading..." : msg}</div>
	              </>
	            )}
	          </>
	        )}
	        </>
	        ) : null}
          </div>

          {previewOpen ? (
            <div
              className="admin-modal-overlay"
              onClick={closePreview}
            >
              <div className="admin-modal admin-modal-wide" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div>
                    <div className="admin-title">Preview: {previewTest}</div>
                    <div className="admin-help">正解の選択肢を色で表示します。</div>
                  </div>
                  <button className="admin-modal-close" onClick={closePreview} aria-label="Close">
                    ×
                  </button>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                    <button className="btn" onClick={closePreview}>Exit Preview</button>
                    {!previewSession ? (
                      <button className="btn" onClick={() => deleteTest(previewTest)}>Delete Test</button>
                    ) : null}
                  </div>
                  <div className="admin-help">
                    Total: <b>{previewQuestions.length}</b>
                  </div>
                  {previewSession ? (
                    <div className="admin-help">
                      Session preview for: <b>{previewSession.title || previewSession.problem_set_id}</b>
                    </div>
                  ) : null}
                  {previewMsg ? <div className="admin-msg">{previewMsg}</div> : null}
                  {previewReplacementMsg ? <div className="admin-msg">{previewReplacementMsg}</div> : null}
                  {!previewMsg && previewQuestions.length === 0 ? (
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      No questions. Upload & Register SetでCSVを取り込むか、CSVの`test_version`がこのセットと一致しているか確認してください。
                    </div>
                  ) : null}
                </div>

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
                  {isModelPreview && previewSectionTitles.length ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {previewSectionTitles.map((sectionTitle) => (
                        <button
                          key={`preview-jump-${sectionTitle}`}
                          className="btn"
                          type="button"
                          onClick={() => previewSectionRefs.current[sectionTitle]?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        >
                          {sectionTitle}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {isModelPreview ? (
                    previewSectionBreaks.map(({ question, index, sectionTitle, showHeader }) => (
                      <Fragment key={`preview-section-row-${question.id}-${index}`}>
                        {showHeader ? (
                          <div
                            ref={(node) => {
                              if (node) previewSectionRefs.current[sectionTitle] = node;
                            }}
                            className="admin-title"
                            style={{ fontSize: 22, marginTop: index === 0 ? 0 : 6 }}
                          >
                            {sectionTitle}
                          </div>
                        ) : null}
                        {renderPreviewQuestionCard(question, index)}
                      </Fragment>
                    ))
                  ) : (
                    previewDisplayQuestions.map((question, index) => renderPreviewQuestionCard(question, index))
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {attemptDetailOpen && selectedAttempt ? (() => {
            const totalCorrect = Number(selectedAttempt.correct ?? selectedAttemptRows.filter((row) => row.isCorrect).length);
            const totalQuestions = Number(selectedAttempt.total ?? selectedAttemptRows.length);
            const scorePercent = (selectedAttemptScoreRate * 100).toFixed(1);
            const attemptTitle = getAttemptTitle(selectedAttempt) || selectedAttempt.test_version || "";
            const tabLeftCount = getTabLeftCount(selectedAttempt);
            const selectedAttemptRankInfo = studentAttemptRanks[selectedAttempt.id] ?? null;
            const showSummaryOnly = selectedAttemptUsesImportedSummary;
            const showRankingMainSectionsOnly = attemptDetailSource === "sessionRanking" || selectedAttemptUsesImportedModelSummary;
            const radarData = selectedAttemptMainSectionSummary.map((row) => ({
              label: row.section,
              value: row.total ? row.correct / row.total : 0,
            }));

            return (
              <div
                className="admin-modal-overlay"
                onClick={() => {
                  setAttemptDetailOpen(false);
                  setSelectedAttemptObj(null);
                  setAttemptDetailSource("default");
                }}
              >
                <div
                  className="admin-modal admin-modal-wide"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="admin-modal-header">
                    <div className="admin-title">Attempt Detail</div>
                    <button
                      className="admin-modal-close"
                      onClick={() => {
                        setAttemptDetailOpen(false);
                        setSelectedAttemptObj(null);
                        setAttemptDetailSource("default");
                      }}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div className="attempt-detail-top">
                    <div className="attempt-detail-summary-card">
                      <table className="attempt-detail-summary-table">
                        <tbody>
                          <tr>
                            <th>Student Name</th>
                            <td>{selectedAttempt.display_name ?? ""}</td>
                          </tr>
                          <tr>
                            <th>Test</th>
                            <td>{attemptTitle}</td>
                          </tr>
                          <tr>
                            <th>Attempt Date</th>
                            <td>{formatDateTime(selectedAttempt.created_at)}</td>
                          </tr>
                          <tr>
                            <th>Tab left count</th>
                            <td className={tabLeftCount > 0 ? "attempt-detail-warn-value" : ""}>{tabLeftCount}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="attempt-detail-actions">
                      <button
                        className="attempt-detail-action-button"
                        type="button"
                        onClick={() => exportSelectedAttemptCsv(selectedAttempt)}
                      >
                        <span className="attempt-detail-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 20 20" focusable="false">
                            <path d="M10 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M6.5 8.5 10 12l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M4 15h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span>Export Attempt Detail (csv)</span>
                      </button>
                      <button
                        className="attempt-detail-action-button"
                        type="button"
                        disabled
                      >
                        <span className="attempt-detail-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 20 20" focusable="false">
                            <path d="M10 3v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path d="M6.5 8.5 10 12l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M4 15h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span>Export Overview (PDF)</span>
                      </button>
                      <button
                        className="attempt-detail-action-button attempt-detail-action-button-danger"
                        type="button"
                        onClick={() => deleteAttempt(selectedAttempt.id)}
                      >
                        <span className="attempt-detail-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 20 20" focusable="false">
                            <path d="M5 5 15 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                            <path d="M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span>Delete Attempt</span>
                      </button>
                    </div>
                  </div>
                  <div className="attempt-detail-top-divider" />
                  {attemptQuestionsLoading ? <div className="admin-help">Loading questions...</div> : null}
                  {attemptQuestionsError ? <div className="admin-msg">{attemptQuestionsError}</div> : null}

                  <div className="admin-top-tabs attempt-detail-tabs" style={{ marginBottom: 12 }}>
                    <button
                      className={`admin-top-tab ${attemptDetailTab === "overview" ? "active" : ""}`}
                      type="button"
                      onClick={() => setAttemptDetailTab("overview")}
                    >
                      Overview
                    </button>
                    {!showSummaryOnly ? (
                      <button
                        className={`admin-top-tab ${attemptDetailTab === "questions" ? "active" : ""}`}
                        type="button"
                        onClick={() => setAttemptDetailTab("questions")}
                      >
                        All Questions
                      </button>
                    ) : null}
                  </div>

                  {attemptDetailTab === "overview" ? (
                    <div className="attempt-detail-pane">
                      <div className="attempt-detail-score-summary">
                        <div className="attempt-detail-score-row">
                          <span className="attempt-detail-score-label">Total Score</span>
                          <span className={`attempt-detail-score-right ${selectedAttemptIsPass ? "" : "attempt-detail-score-right-fail"}`}>
                            <span className="attempt-detail-score-value">
                              <span className="attempt-detail-score-value-primary">{totalCorrect}</span>
                              <span className="attempt-detail-score-value-separator">/</span>
                              <span>{totalQuestions}</span>
                            </span>
                            <span className="attempt-detail-score-rate">({scorePercent}%)</span>
                          </span>
                        </div>
                        <div className="attempt-detail-score-row">
                          <span className="attempt-detail-score-label">Pass/Fail</span>
                          <span className={`attempt-detail-score-pass ${selectedAttemptIsPass ? "pass" : "fail"}`}>
                            {selectedAttemptIsPass ? "Pass" : "Fail"}
                          </span>
                        </div>
                        <div className="attempt-detail-score-row">
                          <span className="attempt-detail-score-label">Class Rank</span>
                          <span className="attempt-detail-score-rank">
                            {selectedAttemptRankInfo
                              ? `${formatOrdinal(selectedAttemptRankInfo.rank)} of ${selectedAttemptRankInfo.total} students`
                              : "—"}
                          </span>
                        </div>
                      </div>

                      {selectedAttemptIsModel && selectedAttemptMainSectionSummary.length ? (
                        <>
                          <div className="attempt-detail-overview-grid">
                            <div className="session-radar-wrap">
                              {buildSectionRadarSvg(radarData)}
                            </div>
                            <div className="admin-table-wrap">
                              <table className="admin-table attempt-score-detail-table" style={{ minWidth: 640 }}>
                                {showRankingMainSectionsOnly ? null : (
                                  <colgroup>
                                    <col className="attempt-score-detail-col-section" />
                                    <col className="attempt-score-detail-col-subsection" />
                                    <col className="attempt-score-detail-col-total" />
                                    <col className="attempt-score-detail-col-correct" />
                                    <col className="attempt-score-detail-col-rate" />
                                  </colgroup>
                                )}
                                <thead>
                                  <tr>
                                    <th className="attempt-score-detail-head-section">Section</th>
                                    {showRankingMainSectionsOnly ? null : <th className="attempt-score-detail-head-subsection">Sub-section</th>}
                                    <th className="attempt-score-detail-head-total">Total</th>
                                    <th className="attempt-score-detail-head-correct">Correct</th>
                                    <th className="attempt-score-detail-head-rate">%</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {showRankingMainSectionsOnly
                                    ? selectedAttemptMainSectionSummary.map((section) => {
                                        const isSectionBelowPass = section.rate < selectedAttemptPassRate;
                                        return (
                                          <tr key={`attempt-ranking-main-${section.section}`}>
                                            <td className="attempt-score-detail-cell-section">
                                              <span className="session-ranking-section-header">{renderTwoLineHeader(section.section)}</span>
                                            </td>
                                            <td className="attempt-score-detail-cell-total">{section.total}</td>
                                            <td className={`attempt-score-detail-cell-correct ${isSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{section.correct}</td>
                                            <td className={`attempt-score-detail-cell-rate ${isSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(section.rate * 100).toFixed(1)}%</td>
                                          </tr>
                                        );
                                      })
                                    : selectedAttemptNestedSectionSummary.map((group) => {
                                        const rowSpan = 1 + group.subSections.length;
                                        const isGroupBelowPass = group.rate < selectedAttemptPassRate;
                                        return (
                                          <Fragment key={`attempt-group-${group.mainSection}`}>
                                            <tr className="attempt-overview-total-row">
                                              <td rowSpan={rowSpan} className="attempt-overview-area-cell attempt-score-detail-cell-section">
                                                <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                              </td>
                                              <td className="attempt-score-detail-cell-subsection">
                                                <span className="attempt-score-detail-total-label">Total</span>
                                              </td>
                                              <td className="attempt-score-detail-cell-total">{group.total}</td>
                                              <td className={`attempt-score-detail-cell-correct ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{group.correct}</td>
                                              <td className={`attempt-score-detail-cell-rate ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(group.rate * 100).toFixed(1)}%</td>
                                            </tr>
                                            {group.subSections.map((subSection) => {
                                              const isSubSectionBelowPass = subSection.rate < selectedAttemptPassRate;
                                              return (
                                                <tr key={`attempt-sub-${group.mainSection}-${subSection.section}`}>
                                                  <td className="attempt-score-detail-cell-subsection">{subSection.section}</td>
                                                  <td className="attempt-score-detail-cell-total">{subSection.total}</td>
                                                  <td className={`attempt-score-detail-cell-correct ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{subSection.correct}</td>
                                                  <td className={`attempt-score-detail-cell-rate ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>{(subSection.rate * 100).toFixed(1)}%</td>
                                                </tr>
                                              );
                                            })}
                                          </Fragment>
                                        );
                                      })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          {!showRankingMainSectionsOnly && !showSummaryOnly ? (
                            <div className="admin-help">
                              Main section totals are shown with their sub-section breakdown underneath.
                            </div>
                          ) : null}
                        </>
                      ) : (
                        selectedAttemptUsesImportedSummary ? (
                          <div className="admin-help" style={{ marginTop: 10 }}>
                            Imported summary results do not include question-level detail.
                          </div>
                        ) : selectedAttemptIsModel ? (
                          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                            <table className="admin-table" style={{ minWidth: 520 }}>
                              <thead>
                                <tr>
                                  <th>Section</th>
                                  <th>Correct</th>
                                  <th>Total</th>
                                  <th>Rate</th>
                                </tr>
                              </thead>
                              <tbody>
                                {selectedAttemptSectionSummary.map((section) => (
                                  <tr key={`attempt-overview-${section.section}`}>
                                    <td>{section.section}</td>
                                    <td>{section.correct}</td>
                                    <td>{section.total}</td>
                                    <td>{(section.rate * 100).toFixed(1)}%</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null
                      )}
                    </div>
                  ) : !showSummaryOnly ? (
                    <div className="attempt-detail-pane">
                      <div className="student-detail-tab-row" style={{ marginBottom: 2 }}>
                        <label className="attempt-detail-toggle">
                          <input
                            type="checkbox"
                            checked={attemptDetailWrongOnly}
                            onChange={(e) => setAttemptDetailWrongOnly(e.target.checked)}
                          />
                          Wrong questions only
                        </label>
                        {selectedAttemptQuestionSectionsFiltered.length ? (
                          <div className="attempt-detail-jumps">
                            {selectedAttemptQuestionSectionsFiltered.map((section) => (
                              <button
                                key={`attempt-jump-${section.title}`}
                                className="btn"
                                type="button"
                                onClick={() =>
                                  attemptDetailSectionRefs.current[section.title]?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "start",
                                  })
                                }
                              >
                                {section.title}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
            
                      {selectedAttemptQuestionSectionsFiltered.length ? (
                        <div className="attempt-question-sections">
                          {selectedAttemptQuestionSectionsFiltered.map((section) => (
                            <div key={`attempt-question-section-${section.title}`} className="attempt-question-section">
                              <div
                                ref={(node) => {
                                  if (node) attemptDetailSectionRefs.current[section.title] = node;
                                }}
                                className="admin-title"
                                style={{ fontSize: 22, marginTop: 6 }}
                              >
                                {section.title}
                              </div>
                              <div className="attempt-question-list">
                                {section.rows.map((row, rowIndex) => (
                                  <div
                                    key={`attempt-question-row-${section.title}-${row.qid}-${rowIndex}`}
                                    className={`attempt-question-card ${row.isCorrect ? "correct" : "wrong"}`}
                                  >
                                    <div className="attempt-question-card-head">
                                      <div className="attempt-question-card-title">
                                        {row.qid} {row.section ? `(${row.section})` : ""}
                                      </div>
                                      <span className={`attempt-question-pill ${row.isCorrect ? "correct" : "wrong"}`}>
                                        {row.isCorrect ? "Correct" : "Wrong"}
                                      </span>
                                    </div>
                                    <div
                                      className="attempt-question-card-prompt"
                                      dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(row.prompt || "") }}
                                    />
                                    {row.stemAudios?.length || row.stemImages?.length ? (
                                      <div className="attempt-question-card-media">
                                        {(row.stemAudios ?? []).map((asset, assetIndex) => (
                                          <audio
                                            key={`attempt-audio-${row.qid}-${assetIndex}`}
                                            controls
                                            preload="none"
                                            src={asset}
                                            className="attempt-question-card-audio"
                                          />
                                        ))}
                                        {(row.stemImages ?? []).map((asset, assetIndex) => (
                                          <img
                                            key={`attempt-image-${row.qid}-${assetIndex}`}
                                            src={asset}
                                            alt="stem"
                                            className="attempt-question-card-image"
                                          />
                                        ))}
                                      </div>
                                    ) : null}
                                    <div className="attempt-question-card-answer-grid">
                                      <div className="attempt-question-card-answer">
                                        <div className="attempt-question-card-answer-label">Chosen</div>
                                        <div className="attempt-question-card-answer-value">
                                          {row.chosenImage ? (
                                            <img src={row.chosenImage} alt="chosen" className="attempt-question-card-choice-image" />
                                          ) : (
                                            row.chosen || "—"
                                          )}
                                        </div>
                                      </div>
                                      <div className="attempt-question-card-answer">
                                        <div className="attempt-question-card-answer-label">Correct</div>
                                        <div className="attempt-question-card-answer-value">
                                          {row.correctImage ? (
                                            <img src={row.correctImage} alt="correct" className="attempt-question-card-choice-image" />
                                          ) : (
                                            row.correct || "—"
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="admin-help" style={{ marginTop: 6 }}>
                          {attemptDetailWrongOnly ? "No wrong questions in this attempt." : "No questions available."}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
}
