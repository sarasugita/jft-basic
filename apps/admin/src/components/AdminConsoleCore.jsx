"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { questions, sections } from "../../../../packages/shared/questions.js";
import { buildScopedAdminHref } from "../lib/adminConsoleRoute";
import { syncAdminAuthCookie } from "../lib/authCookies";
import { createAdminTrace, isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import { recordAdminAuditEvent } from "../lib/adminAudit";
import LoadableAdminWorkspace from "./LoadableAdminWorkspace";
import { AdminConsoleWorkspaceProvider } from "./AdminConsoleWorkspaceContext";
import {
  getLoadedAdminConsoleAnnouncementsWorkspace,
  getLoadedAdminConsoleAttendanceWorkspace,
  getLoadedAdminConsoleDailyRecordWorkspace,
  getLoadedAdminConsoleRankingWorkspace,
  getLoadedAdminConsoleStudentsWorkspace,
  getLoadedAdminConsoleTestingWorkspace,
  loadAdminConsoleAnnouncementsWorkspace,
  loadAdminConsoleAttendanceWorkspace,
  loadAdminConsoleDailyRecordWorkspace,
  loadAdminConsoleRankingWorkspace,
  loadAdminConsoleStudentsWorkspace,
  loadAdminConsoleTestingWorkspace,
  preloadAdminConsoleAnnouncementsWorkspace,
  preloadAdminConsoleAttendanceWorkspace,
  preloadAdminConsoleDailyRecordWorkspace,
  preloadAdminConsoleRankingWorkspace,
  preloadAdminConsoleStudentsWorkspace,
  preloadAdminConsoleTestingWorkspace,
} from "./adminConsoleLoader";

const ADMIN_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ADMIN_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const ADMIN_SUPABASE_CONFIG_ERROR = !ADMIN_SUPABASE_URL || !ADMIN_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

let adminSupabaseModulePromise = null;

async function loadAdminSupabaseModule() {
  if (adminSupabaseModulePromise) return adminSupabaseModulePromise;
  adminSupabaseModulePromise = import("../lib/adminSupabase")
    .catch((error) => {
      adminSupabaseModulePromise = null;
      throw error;
    });
  return adminSupabaseModulePromise;
}

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

const ADMIN_WORKSPACE_CONFIG = {
  students: {
    importTarget: "AdminConsoleStudentsWorkspace",
    loadModule: loadAdminConsoleStudentsWorkspace,
    getLoadedModule: getLoadedAdminConsoleStudentsWorkspace,
    preloadModule: preloadAdminConsoleStudentsWorkspace,
    loadingLabel: "Loading students...",
  },
  attendance: {
    importTarget: "AdminConsoleAttendanceWorkspace",
    loadModule: loadAdminConsoleAttendanceWorkspace,
    getLoadedModule: getLoadedAdminConsoleAttendanceWorkspace,
    preloadModule: preloadAdminConsoleAttendanceWorkspace,
    loadingLabel: "Loading attendance...",
  },
  dailyRecord: {
    importTarget: "AdminConsoleDailyRecordWorkspace",
    loadModule: loadAdminConsoleDailyRecordWorkspace,
    getLoadedModule: getLoadedAdminConsoleDailyRecordWorkspace,
    preloadModule: preloadAdminConsoleDailyRecordWorkspace,
    loadingLabel: "Loading daily records...",
  },
  ranking: {
    importTarget: "AdminConsoleRankingWorkspace",
    loadModule: loadAdminConsoleRankingWorkspace,
    getLoadedModule: getLoadedAdminConsoleRankingWorkspace,
    preloadModule: preloadAdminConsoleRankingWorkspace,
    loadingLabel: "Loading ranking...",
  },
  announcements: {
    importTarget: "AdminConsoleAnnouncementsWorkspace",
    loadModule: loadAdminConsoleAnnouncementsWorkspace,
    getLoadedModule: getLoadedAdminConsoleAnnouncementsWorkspace,
    preloadModule: preloadAdminConsoleAnnouncementsWorkspace,
    loadingLabel: "Loading announcements...",
  },
  testing: {
    importTarget: "AdminConsoleTestingWorkspace",
    loadModule: loadAdminConsoleTestingWorkspace,
    getLoadedModule: getLoadedAdminConsoleTestingWorkspace,
    preloadModule: preloadAdminConsoleTestingWorkspace,
    loadingLabel: "Loading testing...",
  },
};

function resolveAdminWorkspaceKey(activeTab) {
  if (activeTab === "model" || activeTab === "daily") return "testing";
  return activeTab;
}

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
  const baseUrl = ADMIN_SUPABASE_URL;
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
      ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", month: "short" })
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

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
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
    timeZone: "Asia/Dhaka",
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
      return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
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
  initialAdminTab = "students",
  initialAttendanceSubTab = "sheet",
  initialModelSubTab = "results",
  initialDailySubTab = "results",
}) {
  const router = useRouter();
  const renderTraceLoggedRef = useRef(false);
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
  const [activeTab, setActiveTab] = useState(initialAdminTab);
  const [modelSubTab, setModelSubTab] = useState(initialModelSubTab);
  const [dailySubTab, setDailySubTab] = useState(initialDailySubTab);
  const [attendanceSubTab, setAttendanceSubTab] = useState(initialAttendanceSubTab);
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
  const activeSchoolId = forcedSchoolId ?? schoolScopeId ?? profile?.school_id ?? null;
  const canUseAdminConsole = Boolean(isAllowedAdminProfile(profile) && activeSchoolId);
  const activeSchoolName = forcedSchoolName
    || schoolAssignments.find((assignment) => assignment.school_id === activeSchoolId)?.school_name
    || activeSchoolId
    || "";
  const activeSchoolIdRef = useRef(activeSchoolId);
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const [supabase, setSupabase] = useState(null);
  const activeWorkspaceKey = resolveAdminWorkspaceKey(activeTab);
  const activeWorkspaceConfig = ADMIN_WORKSPACE_CONFIG[activeWorkspaceKey];

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console shell render start", {
      forcedSchoolId,
      activeSchoolId,
      isManagedAuth,
      managedRole: managedProfile?.role ?? null,
      workspaceKey: resolveAdminWorkspaceKey(activeTab),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console shell first commit", {
      forcedSchoolId,
      activeSchoolId,
      isManagedAuth,
      managedRole: managedProfile?.role ?? null,
      workspaceKey: resolveAdminWorkspaceKey(activeTab),
    });
  }, [activeSchoolId, activeTab, forcedSchoolId, isManagedAuth, managedProfile?.role]);

  useEffect(() => {
    let cancelled = false;

    if (supabaseConfigError) {
      setSupabase(null);
      return () => {
        cancelled = true;
      };
    }

    void loadAdminSupabaseModule()
      .then(({ createAdminSupabaseClient }) => {
        if (cancelled) return;
        setSupabase(createAdminSupabaseClient({ schoolScopeId: activeSchoolId }));
      })
      .catch((error) => {
        if (cancelled) return;
        logAdminRequestFailure("Admin console failed to load supabase client", error, {
          activeSchoolId,
          forcedSchoolId,
          role: profile?.role ?? null,
        });
        setSupabase(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSchoolId, forcedSchoolId, profile?.role, supabaseConfigError]);

  useEffect(() => {
    if (!canUseAdminConsole || !activeWorkspaceConfig?.preloadModule) return;
    void activeWorkspaceConfig.preloadModule({
      role: profile?.role ?? null,
      userId: session?.user?.id ?? null,
      schoolId: activeSchoolId,
      activeSchoolId,
      managedAuth: isManagedAuth,
      source: "workspace-preload",
    });
  }, [
    activeSchoolId,
    activeWorkspaceConfig,
    canUseAdminConsole,
    isManagedAuth,
    profile?.role,
    session?.user?.id,
  ]);

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
        ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString("en-GB", {
            timeZone: "Asia/Dhaka",
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


  const dailyManualEntryStudent = useMemo(
    () => sortedStudents.find((student) => student.id === dailyManualEntryModal.studentId) ?? null,
    [dailyManualEntryModal.studentId, sortedStudents]
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
    // This function has been moved to the testing workspace hook
    setDailyManualEntryModal((current) => ({ ...current, msg: "Feature moved to testing workspace" }));
  }, []);

  const clearDailyManualEntry = useCallback(async () => {
    // This function has been moved to the testing workspace hook
    setDailyManualEntryModal((current) => ({ ...current, msg: "Feature moved to testing workspace" }));
  }, []);

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
      const { createAdminSupabaseClient } = await loadAdminSupabaseModule();
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
    logAdminEvent("Admin console core managed auth ready", {
      role: profile.role,
      activeSchoolId,
      forcedSchoolId,
      schoolScopeId,
    });
  }, [activeSchoolId, forcedSchoolId, isManagedAuth, profile, schoolScopeId, session]);

  useEffect(() => {
    if (selectedStudentId) return;
    setSelectedStudentDetail(null);
    setStudentDetailLoading(false);
    setStudentDetailMsg("");
  }, [selectedStudentId]);

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
    setStudentWarnings([]);
    setStudentWarningsLoaded(false);
    setStudentWarningsMsg("");
    setSelectedStudentWarning(null);
    setStudentWarningPreviewStudentId("");
    setStudentListAttendanceMap({});
    setStudentListAttempts([]);
    setStudentListLoading(false);
    setStudentListMetricsLoaded(false);
    setAttendanceDays([]);
    setAttendanceEntries({});
    setAttendanceMsg("");
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    setAttendanceSaving(false);
    setAttendanceFilter({ minRate: "", minAbsences: "", startDate: "", endDate: "" });
    setApprovedAbsenceByStudent({});
  }, [activeSchoolId]);

  useEffect(() => {
    setStudentListAttendanceMap({});
    setStudentListAttempts([]);
    setStudentListLoading(false);
    setStudentListMetricsLoaded(false);
  }, [
    activeSchoolId,
    studentListFilters.from,
    studentListFilters.to,
  ]);

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
    const { runSearchAction } = await import("./adminTestingActions");
    await runSearchAction({
      setLoading,
      setMsg,
      filters,
      activeTab,
      dailySubTab,
      modelSubTab,
      tests,
      setFilters,
      setAttempts,
      setSelectedId,
      supabase,
      isMissingTabLeftCountError,
    }, testType);
  }

  async function clearDailyResultsForCategory(category) {
    const { clearDailyResultsForCategoryAction } = await import("./adminTestingActions");
    await clearDailyResultsForCategoryAction({
      setQuizMsg,
      dailySessions,
      supabase,
      sessionDetail,
      closeSessionDetail,
      runSearch,
      recordAuditEvent,
    }, category);
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

  // Initialize tests, test sessions, and exam links on mount
  useEffect(() => {
    if (!supabase || !activeSchoolId) return;
    fetchTests();
    fetchTestSessions();
    fetchExamLinks();
  }, [supabase, activeSchoolId]);

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
    if (!supabase || !activeSchoolId) {
      if (!supabase) {
        finishTrace("skipped", {
          reason: "supabase-not-ready",
        });
      }
      if (!activeSchoolId) {
        finishTrace("skipped", {
          reason: "missing-active-school-id",
        });
      }
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
          : `Warning issued on ${new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" })}`);
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
    if (!activeSchoolId || !supabase) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    let existingDay = (attendanceDays ?? []).find((day) => day.day_date === dayDate) ?? null;

    // If not found locally, try to fetch from database
    if (!existingDay) {
      const { data, error } = await supabase
        .from("attendance_days")
        .select("id, day_date, created_at")
        .eq("school_id", activeSchoolId)
        .eq("day_date", dayDate)
        .single();
      if (!error && data) {
        existingDay = data;
      }
    }

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
    let existing = {};

    // For existing days, fetch fresh entries from database
    if (day.id) {
      const { data: entries, error: entriesError } = await supabase
        .from("attendance_entries")
        .select("student_id, status, comment")
        .eq("day_id", day.id);
      if (!entriesError && entries && Array.isArray(entries)) {
        entries.forEach((row) => {
          if (row?.student_id) {
            existing[row.student_id] = {
              status: row.status,
              comment: row.comment ?? ""
            };
          }
        });
      } else if (entriesError) {
        console.error("Failed to fetch attendance entries:", entriesError);
      }
    }

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
    const { openPreviewAction } = await import("./adminTestingActions");
    await openPreviewAction({
      setPreviewOpen,
      setPreviewTest,
      setPreviewSession,
      setPreviewReplacementPool,
      setPreviewReplacementDrafts,
      setPreviewReplacementSavingId,
      setPreviewReplacementMsg,
      setPreviewAnswers,
      setPreviewMsg,
      fetchQuestionsForVersionWithFallback,
      supabase,
      mapDbQuestion,
      setPreviewQuestions,
    }, testVersion);
  }

  async function openSessionPreview(session) {
    const { openSessionPreviewAction } = await import("./adminTestingActions");
    await openSessionPreviewAction({
      setPreviewOpen,
      setPreviewSession,
      setPreviewTest,
      setPreviewReplacementPool,
      setPreviewReplacementDrafts,
      setPreviewReplacementSavingId,
      setPreviewReplacementMsg,
      setPreviewAnswers,
      setPreviewMsg,
      fetchQuestionsForVersionWithFallback,
      supabase,
      mapDbQuestion,
      setPreviewQuestions,
      isGeneratedDailySessionVersion,
      fetchQuestionsForVersionsWithFallback,
    }, session);
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
                <div class="report-meta">Generated: ${escapeHtml(new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }))}</div>
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

  // CSV utility functions (shared by DailyRecord and Testing workspaces)
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
    setQuizMsg("Export functionality has been moved to the testing workspace");
  }

  async function exportModelGoogleSheetsCsv() {
    setQuizMsg("Export functionality has been moved to the testing workspace");
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
    const { importDailyResultsGoogleSheetsCsvAction } = await import("./adminTestingActions");
    await importDailyResultsGoogleSheetsCsvAction({
      dailyTests,
      testSessions,
      isRetakeSessionTitle,
      setQuizMsg,
      showResultsImportResultStatus,
      showResultsImportLoadingStatus,
      parseSeparatedRows,
      detectDelimiter,
      formatSlashDateShortYear,
      normalizeLookupValue,
      parseSlashDateShortYearToIso,
      hasDailyResultValues,
      promptDailyResultsImportConflict,
      buildImportedResultTestVersion,
      ensureTestRecord,
      activeSchoolId,
      supabase,
      createImportedStudentMatcher,
      sortedStudents,
      rowHasCsvValues,
      normalizeCsvValue,
      parsePercentCell,
      buildImportedSummaryAnswersJson,
      dedupeImportedAttemptPayloads,
      replaceImportedSummaryAttempts,
      fetchTestSessions,
      fetchTests,
      setDailyResultsCategory,
      runSearch,
      recordAuditEvent,
      resultsImportInputRef,
    }, file, targetCategoryName);
  }

  async function importModelResultsGoogleSheetsCsv(file, targetCategoryName = "") {
    const { importModelResultsGoogleSheetsCsvAction } = await import("./adminTestingActions");
    await importModelResultsGoogleSheetsCsvAction({
      modelTests,
      testSessions,
      isRetakeSessionTitle,
      setQuizMsg,
      showResultsImportResultStatus,
      showResultsImportLoadingStatus,
      parseSeparatedRows,
      detectDelimiter,
      normalizeLookupValue,
      parseSlashDateShortYearToIso,
      parsePercentCell,
      parseScoreFractionCell,
      formatSlashDateShortYear,
      hasModelResultValues,
      promptModelResultsImportConflict,
      buildImportedResultTestVersion,
      ensureTestRecord,
      activeSchoolId,
      supabase,
      createImportedStudentMatcher,
      sortedStudents,
      rowHasCsvValues,
      normalizeCsvValue,
      buildImportedSummaryAnswersJson,
      normalizeImportedModelSectionTitle,
      dedupeImportedAttemptPayloads,
      replaceImportedSummaryAttempts,
      fetchTestSessions,
      fetchTests,
      setModelResultsCategory,
      runSearch,
      recordAuditEvent,
      resultsImportInputRef,
    }, file, targetCategoryName);
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
    router.push(buildScopedAdminHref(nextSchoolId, {
      adminTab: activeTab,
      attendanceSubTab,
      modelSubTab,
      dailySubTab,
    }));
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

  function syncScopedAdminRoute(nextAdminTab, options = {}) {
    if (!(forcedSchoolId && profile?.role === "super_admin")) {
      return;
    }
    const href = buildScopedAdminHref(forcedSchoolId, {
      adminTab: nextAdminTab,
      attendanceSubTab: options.attendanceSubTab ?? "sheet",
      modelSubTab: options.modelSubTab ?? "results",
      dailySubTab: options.dailySubTab ?? "results",
    });
    if (typeof window === "undefined") return;
    if (window.location?.pathname === href) return;
    window.history.replaceState(window.history.state, "", href);
  }

  function selectAnnouncementsTab() {
    setActiveTab("announcements");
    syncScopedAdminRoute("announcements");
  }

  function selectStudentsTab() {
    setActiveTab("students");
    syncScopedAdminRoute("students");
  }

  function selectAttendanceTab(nextAttendanceSubTab = "sheet") {
    setActiveTab("attendance");
    setAttendanceSubTab(nextAttendanceSubTab);
    syncScopedAdminRoute("attendance", { attendanceSubTab: nextAttendanceSubTab });
  }

  function selectModelTab(nextModelSubTab = "results") {
    setActiveTab("model");
    setModelSubTab(nextModelSubTab);
    syncScopedAdminRoute("model", { modelSubTab: nextModelSubTab });
  }

  function selectDailyTab(nextDailySubTab = "results") {
    setActiveTab("daily");
    setDailySubTab(nextDailySubTab);
    syncScopedAdminRoute("daily", { dailySubTab: nextDailySubTab });
  }

  function selectDailyRecordTab() {
    setActiveTab("dailyRecord");
    syncScopedAdminRoute("dailyRecord");
  }

  function selectRankingTab() {
    setActiveTab("ranking");
    syncScopedAdminRoute("ranking");
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
  const workspaceContextValue = {
    supabase,
    activeSchoolId,
    session,
    canUseAdminConsole,
    activeTab,
    testSessions,
    attendanceSubTab,
    modelSubTab,
    dailySubTab,
    students,
    fetchStudents,
    studentListFilters,
    setStudentListMetricsLoaded,
    setStudentListAttendanceMap,
    setStudentListAttempts,
    setStudentWarningsLoaded,
    setStudentWarnings,
    setStudentWarningsMsg,
    setSelectedStudentWarning,
    setStudentWarningPreviewStudentId,
    studentDetailOpen,
    setStudentDetailOpen,
    setInviteOpen,
    openStudentWarningsModal,
    handleLoadStudentMetrics,
    studentListLoading,
    studentListMetricsLoaded,
    handleLoadStudentWarnings,
    studentWarningsLoading,
    studentWarningsLoaded,
    setStudentListFilters,
    studentListRows,
    studentWarningCounts,
    openStudentDetail,
    studentMsg,
    handleCsvFile,
    csvMsg,
    selectedStudentId,
    setSelectedStudentId,
    selectedStudent,
    exportStudentReportPdf,
    studentReportExporting,
    studentDetailLoading,
    setReissueStudent,
    setReissuePassword,
    setReissueIssuedPassword,
    setReissueLoading,
    setReissueMsg,
    setReissueOpen,
    toggleTestAccount,
    toggleWithdrawn,
    deleteStudent,
    selectedStudentTab,
    setSelectedStudentTab,
    fetchStudentAttendance,
    fetchStudentAttempts,
    fetchStudentDetail,
    setStudentInfoForm,
    getPersonalInfoForm,
    setStudentInfoUploadFiles,
    setStudentInfoMsg,
    setStudentInfoOpen,
    studentDetailMsg,
    hasStudentDetailFields,
    formatDateFull,
    calculateAge,
    formatYearsOfExperience,
    PERSONAL_UPLOAD_FIELDS,
    renderProfileUpload,
    getProfileUploads,
    studentModelCategorySummaryRows,
    studentModelAttempts,
    sectionTitles,
    renderTwoLineHeader,
    getScoreRate,
    getAttemptEffectivePassRate,
    studentAttemptRanks,
    studentAttemptSummaryById,
    openAttemptDetail,
    getAttemptTitle,
    getAttemptDisplayDateValue,
    studentAttemptsMsg,
    studentDailyCategorySummaryRows,
    studentDailyAttemptsByCategory,
    studentAttendancePrevMonthKey,
    setStudentAttendanceMonthKey,
    selectedStudentAttendanceMonth,
    studentAttendanceMonthOptions,
    studentAttendanceNextMonthKey,
    studentAttendancePie,
    attendanceSummary,
    studentAttendanceRange,
    setStudentAttendanceRange,
    filteredStudentAttendance,
    formatDateShort,
    formatWeekday,
    studentAttendanceMsg,
    studentWarningIssueOpen,
    setStudentWarningIssueOpen,
    studentWarnings,
    formatDateTime,
    summarizeWarningCriteria,
    studentWarningsMsg,
    studentWarningForm,
    setStudentWarningForm,
    studentWarningIssueMsg,
    setStudentWarningIssueMsg,
    issueStudentWarning,
    studentWarningIssueSaving,
    getDefaultStudentWarningForm,
    selectedStudentWarning,
    deleteStudentWarning,
    studentWarningDeletingId,
    studentWarningPreviewStudentId,
    studentWarningPreviewStudent,
    studentWarningPreviewEntries,
    fetchAttendanceDays,
    fetchAbsenceApplications,
    attendanceDate,
    setAttendanceDate,
    openAttendanceDay,
    exportAttendanceGoogleSheetsCsv,
    clearAllAttendanceValues,
    attendanceClearing,
    attendanceImportInputRef,
    importAttendanceGoogleSheetsCsv,
    attendanceFilter,
    setAttendanceFilter,
    attendanceDayColumns,
    attendanceDayRates,
    formatRatePercent,
    attendanceFilteredStudents,
    attendanceRangeColumns,
    attendanceEntriesByDay,
    buildAttendanceStats,
    getAttendanceStatusClassName,
    openAttendanceDay,
    saveAttendanceDay,
    deleteAttendanceDay,
    attendanceMsg,
    absenceApplications,
    decideAbsenceApplication,
    absenceApplicationsMsg,
    parseQuestionCsv,
    parseDailyCsv,
    recordAdminAuditEvent,
    testMetaByVersion,
  };

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
            className={`admin-nav-item ${activeTab === "announcements" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(selectAnnouncementsTab)}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <path d="M4 4h16v12H7l-3 3z" />
                <path d="M7 8h10M7 12h6" />
              </svg>
            </span>
            Announcements
          </button>

          <button
            className={`admin-nav-item ${activeTab === "students" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(selectStudentsTab)}
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
              onClick={() => handleSidebarMenuClick(() => selectAttendanceTab("sheet"))}
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
                  onClick={() => handleSidebarMenuClick(() => selectAttendanceTab("sheet"))}
                >
                  Attendance Sheet
                </button>
                <button
                  className={`admin-subnav-item ${attendanceSubTab === "absence" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => selectAttendanceTab("absence"))}
                >
                  Absence Applications
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "model" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "model" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => selectModelTab("results"))}
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
                  onClick={() => handleSidebarMenuClick(() => selectModelTab("results"))}
                >
                  Model Test Results
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "conduct" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => selectModelTab("conduct"))}
                >
                  Create Test Session
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "upload" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => selectModelTab("upload"))}
                >
                  Upload Question Set
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "daily" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "daily" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => selectDailyTab("results"))}
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
                  onClick={() => handleSidebarMenuClick(() => selectDailyTab("results"))}
                >
                  Daily Test Results
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "conduct" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => selectDailyTab("conduct"))}
                >
                  Create Test Session
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "upload" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => selectDailyTab("upload"))}
                >
                  Upload Question Set
                </button>
              </div>
            ) : null}
          </div>

          <button
            className={`admin-nav-item ${activeTab === "dailyRecord" ? "active" : ""}`}
            onClick={() => handleSidebarMenuClick(selectDailyRecordTab)}
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
            onClick={() => handleSidebarMenuClick(selectRankingTab)}
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
            <AdminConsoleWorkspaceProvider value={workspaceContextValue}>
              {activeWorkspaceConfig ? (
                <LoadableAdminWorkspace
                  key={`${activeWorkspaceKey}:${activeSchoolId ?? "none"}`}
                  importTarget={activeWorkspaceConfig.importTarget}
                  loadModule={activeWorkspaceConfig.loadModule}
                  getLoadedModule={activeWorkspaceConfig.getLoadedModule}
                  context={{
                    role: profile?.role ?? null,
                    userId: session?.user?.id ?? null,
                    schoolId: activeSchoolId,
                    activeSchoolId,
                    managedAuth: isManagedAuth,
                    source: "shell-workspace",
                    adminTab: activeTab,
                    attendanceSubTab,
                    modelSubTab,
                    dailySubTab,
                  }}
                  loadingLabel={activeWorkspaceConfig.loadingLabel}
                  errorTitle="Workspace Error"
                  errorMessage="Failed to load this admin workspace. Retry or switch tabs and try again."
                  onBack={changeSchoolHref
                    ? () => {
                        window.location.assign(changeSchoolHref);
                      }
                    : null}
                  backLabel={changeSchoolHref ? "Back to Schools" : "Back"}
                  diagnosticsExtra={{
                    adminTab: activeTab,
                    attendanceSubTab,
                    modelSubTab,
                    dailySubTab,
                  }}
                />
              ) : null}
            </AdminConsoleWorkspaceProvider>
          </div>


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
        </div>
      </div>
    </div>
  );
}
