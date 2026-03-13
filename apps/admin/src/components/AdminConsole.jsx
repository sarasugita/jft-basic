"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { questions, sections } from "../../../../packages/shared/questions.js";
import { createAdminSupabaseClient, getAdminSupabaseConfig, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";
import { isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

const DEFAULT_MODEL_CATEGORY = "Book Review";
const ADMIN_SCHOOL_SCOPE_STORAGE_KEY = "jft_admin_school_scope";
const PROFILE_SELECT_FIELDS = [
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
  "is_withdrawn"
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
  return {
    display_name: String(values.display_name ?? "").trim() || null,
    email: String(values.email ?? "").trim() || null,
    phone_number: String(values.phone_number ?? "").trim() || null,
    date_of_birth: String(values.date_of_birth ?? "").trim() || null,
    sex: String(values.sex ?? "").trim() || null,
    student_code: String(values.student_code ?? "").trim() || null,
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

function getEmptyDailyRecordPlanDraft() {
  return {
    mini_test_1: "",
    mini_test_2: "",
    special_test_1: "",
    special_test_2: "",
  };
}

function createDailyRecordCommentRow(studentId = "") {
  return {
    tempId: `comment-${Math.random().toString(36).slice(2, 10)}`,
    student_id: studentId,
    comment: "",
  };
}

function getEmptyDailyRecordForm(recordDate = "") {
  return {
    id: "",
    record_date: recordDate,
    todays_content: "",
    comments: [createDailyRecordCommentRow("")]
  };
}

function getDailyRecordForm(record) {
  if (!record) return getEmptyDailyRecordForm("");
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
    todays_content: record.todays_content ?? "",
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
      special_test_2: record.special_test_2 ?? "",
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
  (attemptsList ?? []).forEach((attempt) => {
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
  return escaped.replace(/【(.*?)】/g, '<span class="u">$1</span>');
}

function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
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
    stemKind: data.stemKind ?? data.stem_kind ?? row.media_type ?? null,
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
    .filter((section) => section.key !== "DAILY")
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
    .filter((section) => section.key !== "DAILY")
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
  const stemKind = question.stemKind || "";
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
  const sectionLabel = getQuestionSectionLabel(question) || question.sectionKey;

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
          {question.id} {sectionLabel ? `(${sectionLabel})` : ""} {index != null ? `#${index + 1}` : ""}
        </div>
        {children ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div> : null}
      </div>
      {prompt ? <div style={{ marginTop: 6 }}>{prompt}</div> : null}
      {question.type === "daily" && stemExtra ? (
        <div style={{ marginTop: 6, fontSize: 13, color: "#333333" }}>
          {stemExtra}
        </div>
      ) : null}
      {stemText ? (
        <div
          style={{ marginTop: 6 }}
          dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
        />
      ) : null}
      {stemLines.length && question.type !== "daily" ? (
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
        errors.push(`Row ${r + 1}: set_id is required when no SetID is entered in the form.`);
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
      stemKind: getCell(row, "stem_kind") || null,
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
  const idxTest = findIdx(["testid", "test_id", "test id"]);
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
  const idx = header.indexOf("testid");
  if (idx === -1) return "";
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[idx] ?? "").trim();
    if (value) return value;
  }
  return "";
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
  const [authReady, setAuthReady] = useState(isManagedAuth);
  const [profileLoading, setProfileLoading] = useState(false);
  const [schoolAssignments, setSchoolAssignments] = useState([]);
  const [schoolScopeId, setSchoolScopeId] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [examLinks, setExamLinks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAttemptObj, setSelectedAttemptObj] = useState(null);
  const [attemptDetailOpen, setAttemptDetailOpen] = useState(false);
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
  const [modelSubTab, setModelSubTab] = useState("conduct");
  const [dailySubTab, setDailySubTab] = useState("create");
  const [attendanceSubTab, setAttendanceSubTab] = useState("sheet");
  const [dailyResultsCategory, setDailyResultsCategory] = useState("");
  const [modelResultsCategory, setModelResultsCategory] = useState("");
  const [dailyCategorySelect, setDailyCategorySelect] = useState("__custom__");
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
  const [dailyRecordModalOpen, setDailyRecordModalOpen] = useState(false);
  const [dailyRecordSaving, setDailyRecordSaving] = useState(false);
  const [dailyRecordForm, setDailyRecordForm] = useState(() => getEmptyDailyRecordForm(getTodayDateInput()));
  const [dailyRecordPlanDrafts, setDailyRecordPlanDrafts] = useState({});
  const [dailyRecordPlanSavingDate, setDailyRecordPlanSavingDate] = useState("");
  const dailyRecordTableWrapRef = useRef(null);
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
  const [studentWarningsMsg, setStudentWarningsMsg] = useState("");
  const [studentWarningIssueOpen, setStudentWarningIssueOpen] = useState(false);
  const [studentWarningIssueSaving, setStudentWarningIssueSaving] = useState(false);
  const [studentWarningIssueMsg, setStudentWarningIssueMsg] = useState("");
  const [studentWarningForm, setStudentWarningForm] = useState(() => getDefaultStudentWarningForm());
  const [selectedStudentWarning, setSelectedStudentWarning] = useState(null);
  const [studentListAttendanceMap, setStudentListAttendanceMap] = useState({});
  const [studentListAttempts, setStudentListAttempts] = useState([]);
  const [studentListLoading, setStudentListLoading] = useState(false);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
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
  const [dailyRetakeSourceId, setDailyRetakeSourceId] = useState("");
  const [activeModelTimePicker, setActiveModelTimePicker] = useState("");
  const [dailySetDropdownOpen, setDailySetDropdownOpen] = useState(false);
  const [activeDailyTimePicker, setActiveDailyTimePicker] = useState("");
  const dailySetDropdownRef = useRef(null);
  const assetFolderInputRef = useRef(null);
  const dailyFolderInputRef = useRef(null);
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
    test_version: "test_exam",
    category: DEFAULT_MODEL_CATEGORY
  });
  const [assetCategorySelect, setAssetCategorySelect] = useState(DEFAULT_MODEL_CATEGORY);
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");
  const [dailyForm, setDailyForm] = useState({
    test_version: "",
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
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [editingAnnouncementForm, setEditingAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: "",
    end_at: ""
  });
  const activeSchoolId = forcedSchoolId ?? schoolScopeId ?? profile?.school_id ?? null;
  const canUseAdminConsole = Boolean(
    profile &&
      profile.account_status === "active" &&
      ["admin", "super_admin"].includes(profile.role) &&
      activeSchoolId
  );
  const activeSchoolName = forcedSchoolName
    || schoolAssignments.find((assignment) => assignment.school_id === activeSchoolId)?.school_name
    || activeSchoolId
    || "";
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

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
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
  const pastDailySessions = useMemo(
    () => dailySessions.filter((session) => !isRetakeSessionTitle(session.title) && isPastSession(session)),
    [dailySessions]
  );
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
      if (t?.version) map[t.version] = t.pass_rate ?? null;
    });
    return map;
  }, [tests]);

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

  const sessionDetailStudentOptions = useMemo(() => {
    const unique = new Map();
    (sessionDetailAttempts ?? []).forEach((attempt) => {
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
  }, [sessionDetailAttempts, students]);

  const sessionDetailLatestAttempts = useMemo(() => {
    const latestMap = buildLatestAttemptMapByStudent(sessionDetailAttempts);
    return Array.from(latestMap.values()).sort((a, b) => getRowTimestamp(a) - getRowTimestamp(b));
  }, [sessionDetailAttempts]);

  const sessionDetailPassRate = useMemo(() => {
    const value = Number(testPassRateByVersion[selectedSessionDetail?.problem_set_id] ?? 0.8);
    return Number.isFinite(value) && value > 0 ? value : 0.8;
  }, [selectedSessionDetail, testPassRateByVersion]);

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

  const sessionDetailQuestionAnalysis = useMemo(() => {
    if (!sessionDetailQuestions.length || !sessionDetailLatestAttempts.length) return [];
    return buildQuestionAnalysisRows(sessionDetailLatestAttempts, sessionDetailQuestions)
      .sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        return String(a.qid).localeCompare(String(b.qid));
      });
  }, [sessionDetailLatestAttempts, sessionDetailQuestions]);

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
    if (sessionDetail.type !== "mock") return [];
    return buildSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions);
  }, [sessionDetail.type, sessionDetailLatestAttempts, sessionDetailQuestions]);

  const sessionDetailStudentRankingRows = useMemo(() => {
    if (sessionDetail.type !== "mock") return [];
    return buildSessionStudentRankingRows(sessionDetailLatestAttempts, sessionDetailQuestions, students);
  }, [sessionDetail.type, sessionDetailLatestAttempts, sessionDetailQuestions, students]);

  const studentModelAttempts = useMemo(() => {
    return (studentAttempts ?? []).filter((a) => testMetaByVersion[a.test_version]?.type === "mock");
  }, [studentAttempts, testMetaByVersion]);

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
    dailyCategories.forEach((c) => {
      if (grouped.has(c.name)) ordered.push([c.name, grouped.get(c.name)]);
    });
    for (const entry of grouped.entries()) {
      if (!ordered.some((o) => o[0] === entry[0])) ordered.push(entry);
    }
    return ordered;
  }, [studentDailyAttempts, testMetaByVersion, dailyCategories]);

  const studentAttemptSummaryById = useMemo(() => {
    const summaryMap = {};
    (studentModelAttempts ?? []).forEach((a) => {
      const list = attemptQuestionsByVersion[a.test_version];
      if (!list) return;
      const rows = buildAttemptDetailRowsFromList(a.answers_json, list);
      const summary = buildSectionSummary(rows);
      const bySection = {};
      summary.forEach((s) => {
        bySection[s.section] = s;
      });
      summaryMap[a.id] = bySection;
    });
    return summaryMap;
  }, [studentModelAttempts, attemptQuestionsByVersion]);

  const sectionTitles = useMemo(
    () => sections.filter((s) => s.key !== "DAILY").map((s) => s.title),
    []
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
    if (!modelCategories.length) return null;
    return modelCategories.find((c) => c.name === modelConductCategory) ?? modelCategories[0];
  }, [modelCategories, modelConductCategory]);

  const selectedDailyConductCategory = useMemo(() => {
    if (!dailyCategories.length) return null;
    return dailyCategories.find((c) => c.name === dailyConductCategory) ?? dailyCategories[0];
  }, [dailyCategories, dailyConductCategory]);

  const modelConductTests = selectedModelConductCategory?.tests ?? [];
  const dailyConductTests = selectedDailyConductCategory?.tests ?? [];
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

  const filteredDailyUploadTests = useMemo(() => {
    if (!dailyUploadCategory) return dailyQuestionSets;
    return dailyQuestionSets.filter((t) => String(t.title ?? "").trim() === dailyUploadCategory);
  }, [dailyQuestionSets, dailyUploadCategory]);

  const selectedDailyCategory = useMemo(() => {
    if (!dailyCategories.length) return null;
    return dailyCategories.find((c) => c.name === dailyResultsCategory) ?? dailyCategories[0];
  }, [dailyCategories, dailyResultsCategory]);

  const selectedModelCategory = useMemo(() => {
    if (!modelCategories.length) return null;
    return modelCategories.find((c) => c.name === modelResultsCategory) ?? modelCategories[0];
  }, [modelCategories, modelResultsCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!dailyResultsCategory || !dailyCategories.some((c) => c.name === dailyResultsCategory)) {
      setDailyResultsCategory(dailyCategories[0].name);
    }
  }, [dailyCategories, dailyResultsCategory]);

  useEffect(() => {
    if (!modelCategories.length) return;
    if (!modelResultsCategory || !modelCategories.some((c) => c.name === modelResultsCategory)) {
      setModelResultsCategory(modelCategories[0].name);
    }
  }, [modelCategories, modelResultsCategory]);

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
    if (!assetForm.category && modelCategories.length) {
      setAssetCategorySelect(modelCategories[0].name);
      setAssetForm((s) => ({ ...s, category: modelCategories[0].name }));
    } else {
      setAssetCategorySelect("__custom__");
    }
  }, [modelCategories, assetForm.category]);

  useEffect(() => {
    if (!modelCategories.length) return;
    if (!modelConductCategory || !modelCategories.some((c) => c.name === modelConductCategory)) {
      setModelConductCategory(modelCategories[0].name);
    }
  }, [modelCategories, modelConductCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!dailyConductCategory || !dailyCategories.some((c) => c.name === dailyConductCategory)) {
      setDailyConductCategory(dailyCategories[0].name);
    }
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
  }, [dailyConductTests, dailySessionForm.problem_set_id, dailySessionForm.problem_set_ids, dailySessionForm.selection_mode]);

  useEffect(() => {
    const version = testSessionForm.problem_set_id;
    if (!version) return;
    const passRate = testPassRateByVersion[version];
    if (passRate != null) {
      setTestSessionForm((s) => ({ ...s, pass_rate: String(passRate) }));
    }
  }, [testSessionForm.problem_set_id, testPassRateByVersion]);

  useEffect(() => {
    const version = selectedDailyProblemSetIds[0] || dailySessionForm.problem_set_id;
    if (!version) return;
    const passRate = testPassRateByVersion[version];
    if (passRate != null) {
      setDailySessionForm((s) => ({ ...s, pass_rate: String(passRate) }));
    }
  }, [dailySessionForm.problem_set_id, selectedDailyProblemSetIds, testPassRateByVersion]);

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

  const selectedAttemptRows = useMemo(() => {
    if (!selectedAttempt) return [];
    if (selectedAttemptQuestions && selectedAttemptQuestions.length) {
      return buildAttemptDetailRowsFromList(selectedAttempt.answers_json, selectedAttemptQuestions);
    }
    return buildAttemptDetailRows(selectedAttempt.answers_json);
  }, [selectedAttempt, selectedAttemptQuestions]);

  const selectedAttemptSectionSummary = useMemo(
    () => buildSectionSummary(selectedAttemptRows),
    [selectedAttemptRows]
  );

  const selectedAttemptIsModel = useMemo(
    () => testMetaByVersion[selectedAttempt?.test_version]?.type === "mock",
    [selectedAttempt, testMetaByVersion]
  );

  const selectedAttemptMainSectionSummary = useMemo(
    () => buildMainSectionSummary(selectedAttemptRows),
    [selectedAttemptRows]
  );

  const selectedAttemptNestedSectionSummary = useMemo(
    () => buildNestedSectionSummary(selectedAttemptRows),
    [selectedAttemptRows]
  );

  const selectedAttemptPassRate = useMemo(() => {
    const value = Number(testPassRateByVersion[selectedAttempt?.test_version] ?? 0.8);
    return Number.isFinite(value) && value > 0 ? value : 0.8;
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

  const attendanceSummary = useMemo(() => {
    const list = studentAttendance ?? [];
    const monthKeys = Array.from(
      new Set(
        list
          .map((r) => String(r.day_date || ""))
          .filter(Boolean)
          .map((d) => d.slice(0, 7))
      )
    ).sort();

    const calc = (rows) => {
      const total = rows.length;
      const present = rows.filter((r) => r.status === "P" || r.status === "L").length;
      const late = rows.filter((r) => r.status === "L").length;
      const excused = rows.filter((r) => r.status === "E").length;
      const unexcused = rows.filter((r) => r.status === "A").length;
      const rate = total ? (present / total) * 100 : null;
      return { total, present, late, excused, unexcused, rate };
    };

    const overall = calc(list);
    const months = monthKeys.map((key, idx) => {
      const rows = list.filter((r) => String(r.day_date || "").startsWith(key));
      const stats = calc(rows);
      const parts = key.split("-");
      const labelMonth = parts.length === 2
        ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString(undefined, { month: "short" })
        : key;
      return {
        key,
        label: `Month ${idx + 1} (${labelMonth})`,
        stats
      };
    });
    return { overall, months };
  }, [studentAttendance]);

  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);

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
      .filter((session) => canonicalSessionIdsWithAttempts.has(session.id));

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
    () => buildSessionResultsMatrix(selectedModelCategory),
    [buildSessionResultsMatrix, selectedModelCategory]
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

  const scheduleRecordRows = useMemo(() => {
    const today = getTodayDateInput();
    const dateSet = new Set();
    for (let i = 0; i < 14; i += 1) {
      dateSet.add(addDays(today, i));
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
            special_test_2: record.special_test_2 ?? "",
          } : {}),
          ...(dailyRecordPlanDrafts[recordDate] ?? {}),
        };
        return { recordDate, record, draft };
      });
  }, [dailyRecords, dailyRecordPlanDrafts]);

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

  const attendanceFilteredStudents = useMemo(() => {
    const minRate = attendanceFilter.minRate === "" ? null : Number(attendanceFilter.minRate);
    const minAbsences = attendanceFilter.minAbsences === "" ? null : Number(attendanceFilter.minAbsences);
    return activeStudents.filter((s) => {
      const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
      const total = perDay.filter(Boolean).length;
      const present = perDay.filter((v) => v === "P" || v === "L").length;
      const absences = perDay.filter((v) => v === "A").length;
      const rate = total ? (present / total) * 100 : 0;
      if (minRate != null && rate >= minRate) return false;
      if (minAbsences != null && absences < minAbsences) return false;
      return true;
    });
  }, [activeStudents, attendanceFilter, attendanceRangeColumns, attendanceEntriesByDay]);

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
          setProfile(null);
          setLoginMsg("This account is missing an admin profile. Please contact the system administrator.");
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
      const { data: assignments, error: assignmentsError } = await supabase
        .from("admin_school_assignments")
        .select("school_id, is_primary")
        .eq("admin_user_id", session.user.id)
        .order("is_primary", { ascending: false });

      if (assignmentsError) {
        console.error("admin school assignments error:", assignmentsError);
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
    if (!session || !canUseAdminConsole) return;
    fetchExamLinks();
    fetchStudents();
    fetchTests();
    fetchTestSessions();
    fetchAssets();
  }, [activeSchoolId, session, canUseAdminConsole]);

  useEffect(() => {
    if (activeTab !== "students") return;
    fetchStudentListMetrics();
    fetchStudentWarnings();
  }, [activeSchoolId, activeTab, studentListFilters.from, studentListFilters.to]);

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
    if (activeTab === "model" && modelSubTab === "results") {
      runSearch("mock");
    }
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
      profile.account_status === "active"
    ) {
      router.replace("/super/schools");
    }
  }, [forcedSchoolId, profile, router, session]);

  useEffect(() => {
    if (!activeSchoolId) return;
    setAttempts([]);
    setExamLinks([]);
    setStudents([]);
    setTests([]);
    setTestSessions([]);
    setAssets([]);
    setSelectedId(null);
    setSelectedAttemptObj(null);
    setSelectedStudentId("");
    setStudentAttempts([]);
    setStudentAttendance([]);
    setAbsenceApplications([]);
    setAnnouncements([]);
    setStudentWarnings([]);
    setStudentWarningsMsg("");
    setSelectedStudentWarning(null);
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

  async function runSearch(testType = "") {
    setLoading(true);
    setMsg("Loading...");
    const { code, name, from, to, limit, testVersion } = filters;

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
        .limit(Number(limit || 200));
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

  function applyTestFilter(version, testType = "") {
    setFilters((s) => ({ ...s, testVersion: version || "" }));
    setSelectedId(null);
    setTimeout(() => runSearch(testType), 0);
  }

  function openAttemptDetail(attempt) {
    if (!attempt?.id) return;
    setSelectedId(attempt.id);
    setSelectedAttemptObj(attempt);
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
  }

  function openSessionDetailView(session, type) {
    if (!session?.id) return;
    setEditingSessionId("");
    setEditingSessionMsg("");
    setSessionDetail({ type, sessionId: session.id });
    setSessionDetailTab("questions");
    setSessionDetailAllowStudentId("");
    setSessionDetailAllowMsg("");
    setSessionDetailShowAllAnalysis(false);
  }

  async function fetchSessionDetail(session) {
    if (!session?.id || !session?.problem_set_id) return;
    setSessionDetailLoading(true);
    setSessionDetailMsg("Loading...");
    setSessionDetailAllowMsg("");

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
      if (current && attemptsList.some((attempt) => attempt.student_id === current)) return current;
      return attemptsList[0]?.student_id ?? "";
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
    if (!activeSchoolId) {
      setStudents([]);
      setStudentMsg("Select a school.");
      setSelectedStudentId("");
      setStudentAttempts([]);
      setStudentAttendance([]);
      setStudentAttemptsMsg("");
      setStudentAttendanceMsg("");
      return;
    }
    setStudentMsg("Loading...");
    let query = supabase
      .from("profiles")
      .select(PROFILE_SELECT_FIELDS)
      .eq("role", "student")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false })
      .limit(500);
    const { data, error } = await query;
    if (error) {
      console.error("profiles fetch error:", error);
      setStudents([]);
      setStudentMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setStudents(list);
    setStudentMsg(list.length ? "" : "No students.");
    if (!list.length) {
      setSelectedStudentId("");
      setStudentAttempts([]);
      setStudentAttendance([]);
      setStudentAttemptsMsg("");
      setStudentAttendanceMsg("");
      return;
    }
    const exists = selectedStudentId && list.some((s) => s.id === selectedStudentId);
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
      setStudentWarningsLoading(false);
      return;
    }
    const warningIds = warningsList.map((row) => row.id);
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
    const recipientsByWarning = new Map();
    (recipientRows ?? []).forEach((recipient) => {
      const list = recipientsByWarning.get(recipient.warning_id) || [];
      list.push({
        ...recipient,
        issues: Array.isArray(recipient.issues) ? recipient.issues : [],
      });
      recipientsByWarning.set(recipient.warning_id, list);
    });
    setStudentWarnings(
      warningsList.map((warning) => ({
        ...warning,
        criteria: warning.criteria && typeof warning.criteria === "object" ? warning.criteria : {},
        recipients: (recipientsByWarning.get(warning.id) || []).sort((a, b) => String(a.student_id).localeCompare(String(b.student_id))),
      }))
    );
    setStudentWarningsLoading(false);
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
      const criteria = {
        title: String(studentWarningForm.title ?? "").trim(),
        from: studentWarningForm.from || "",
        to: studentWarningForm.to || "",
        maxAttendance: studentWarningForm.maxAttendance === "" ? "" : Number(studentWarningForm.maxAttendance),
        minUnexcused: studentWarningForm.minUnexcused === "" ? "" : Number(studentWarningForm.minUnexcused),
        maxModelAvg: studentWarningForm.maxModelAvg === "" ? "" : Number(studentWarningForm.maxModelAvg),
        maxDailyAvg: studentWarningForm.maxDailyAvg === "" ? "" : Number(studentWarningForm.maxDailyAvg),
      };
      const rows = await loadStudentWarningMetrics(criteria);
      const matched = rows
        .filter((row) => !row.student?.is_withdrawn)
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
    fetchStudents();
  }

  async function saveStudentInformation() {
    if (!selectedStudentId) return;
    setStudentInfoMsg("");
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
    const payload = buildPersonalInfoPayload({ ...studentInfoForm, profile_uploads: nextUploads });
    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", selectedStudentId)
      .select(PROFILE_SELECT_FIELDS)
      .single();
    if (error) {
      console.error("student info update error:", error);
      setStudentInfoMsg(`Save failed: ${error.message}`);
      setStudentInfoSaving(false);
      return;
    }
    setStudents((prev) => prev.map((student) => (student.id === selectedStudentId ? { ...student, ...(data ?? payload) } : student)));
    setStudentInfoForm(getPersonalInfoForm(data ?? payload));
    setStudentInfoUploadFiles({});
    setStudentInfoSaving(false);
    setStudentInfoOpen(false);
  }

  async function fetchDailyRecords() {
    if (!activeSchoolId) {
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordsMsg("Select a school.");
      return;
    }
    setDailyRecordsMsg("Loading...");
    const { data, error } = await supabase
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
    if (error) {
      console.error("daily records fetch error:", error);
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setDailyRecords(list);
    setDailyRecordPlanDrafts(buildDailyRecordPlanDrafts(list));
    setDailyRecordsMsg(list.length ? "" : "No daily records yet. The next 2 weeks are shown below for planning.");
  }

  function openDailyRecordModal(record = null, recordDate = "") {
    const existingRecord =
      record
      ?? dailyRecords.find((item) => item.record_date === recordDate)
      ?? null;
    const nextForm = existingRecord
      ? getDailyRecordForm(existingRecord)
      : getEmptyDailyRecordForm(recordDate || getTodayDateInput());
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

  async function saveDailyRecord() {
    if (!activeSchoolId) {
      setDailyRecordsMsg("Select a school.");
      return;
    }
    if (!dailyRecordForm.record_date) {
      setDailyRecordsMsg("Date is required.");
      return;
    }
    setDailyRecordSaving(true);
    setDailyRecordsMsg("");
    const payload = {
      school_id: activeSchoolId,
      record_date: dailyRecordForm.record_date,
      todays_content: dailyRecordForm.todays_content.trim() || null,
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

    setDailyRecordSaving(false);
    setDailyRecordModalOpen(false);
    setDailyRecordDate(dailyRecordForm.record_date);
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
      special_test_2: draft.special_test_2.trim() || null,
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
      .select("student_id, score_rate, correct, total, created_at")
      .eq("school_id", activeSchoolId)
      .gte("created_at", new Date(`${draft.start_date}T00:00:00`).toISOString())
      .lte("created_at", new Date(`${draft.end_date}T23:59:59`).toISOString());
    if (attemptsError) {
      console.error("ranking attempts fetch error:", attemptsError);
      setRankingMsg(`Refresh failed: ${attemptsError.message}`);
      setRankingRefreshingId("");
      return;
    }

    let rankingStudents = activeStudents ?? [];
    if (!rankingStudents.length) {
      const { data: studentRows, error: studentsError } = await supabase
        .from("profiles")
        .select("id, display_name, email, student_code, is_withdrawn")
        .eq("role", "student")
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false });
      if (studentsError) {
        console.error("ranking students fetch error:", studentsError);
        setRankingMsg(`Refresh failed: ${studentsError.message}`);
        setRankingRefreshingId("");
        return;
      }
      rankingStudents = (studentRows ?? []).filter((student) => !student.is_withdrawn);
    }
    const studentMeta = new Map(
      rankingStudents.map((student) => [
        student.id,
        student.display_name || student.email || student.student_code || student.id
      ])
    );
    const totalsByStudent = new Map();
    (attemptsData ?? []).forEach((row) => {
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
    setAbsenceApplicationsMsg("Loading...");
    const { data, error } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, day_date, status, reason, catch_up, late_type, time_value, created_at, decided_at, profiles:student_id (display_name, student_code, email)")
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
    fetchAbsenceApplications();
  }

  useEffect(() => {
    if (activeTab === "announcements") {
      fetchAnnouncements();
    }
  }, [activeSchoolId, activeTab]);

  async function fetchAnnouncements() {
    setAnnouncementMsg("Loading...");
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
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
    setAnnouncementMsg("Announcement created.");
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
    fetchAnnouncements();
  }

  async function fetchStudentAttempts(studentId) {
    if (!studentId) return;
    setStudentAttemptsMsg("Loading...");
    let { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, created_at, ended_at, answers_json, tab_left_count")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error && isMissingTabLeftCountError(error)) {
      ({ data, error } = await supabase
        .from("attempts")
        .select("id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, created_at, ended_at, answers_json")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false })
        .limit(200));
    }
    if (error) {
      console.error("student attempts fetch error:", error);
      setStudentAttempts([]);
      setStudentAttemptsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setStudentAttempts(list);
    setStudentAttemptsMsg(list.length ? "" : "No attempts.");
    hydrateAttemptQuestions(list.map((a) => a.test_version));
    fetchAttemptRanksForSessions(list);
  }

  async function fetchAttemptRanksForSessions(attemptsList) {
    const sessionIds = Array.from(new Set((attemptsList ?? []).map((a) => a.test_session_id).filter(Boolean)));
    if (!sessionIds.length) {
      setStudentAttemptRanks({});
      return;
    }
    const { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, test_session_id, correct, total, score_rate")
      .in("test_session_id", sessionIds);
    if (error) {
      console.error("attempt rank fetch error:", error);
      setStudentAttemptRanks({});
      return;
    }
    const bySession = new Map();
    (data ?? []).forEach((a) => {
      if (!a.test_session_id) return;
      if (!bySession.has(a.test_session_id)) bySession.set(a.test_session_id, []);
      bySession.get(a.test_session_id).push(a);
    });
    const rankMap = {};
    bySession.forEach((rows, sessionId) => {
      const bestByStudent = new Map();
      rows.forEach((row) => {
        const rate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
        const prev = bestByStudent.get(row.student_id);
        if (prev == null || rate > prev) bestByStudent.set(row.student_id, rate);
      });
      const sorted = Array.from(bestByStudent.values()).sort((a, b) => b - a);
      rows.forEach((row) => {
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
  }

  async function hydrateAttemptQuestions(versions) {
    const unique = Array.from(new Set((versions ?? []).filter(Boolean)));
    const missing = unique.filter((v) => !attemptQuestionsByVersion[v]);
    if (!missing.length) return;
    const { data, error } = await supabase
      .from("questions")
      .select("test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
      .in("test_version", missing)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("attempt questions preload error:", error);
      return;
    }
    const grouped = {};
    (data ?? []).forEach((row) => {
      const version = row.test_version;
      if (!version) return;
      if (!grouped[version]) grouped[version] = [];
      grouped[version].push(mapDbQuestion(row));
    });
    setAttemptQuestionsByVersion((prev) => ({ ...prev, ...grouped }));
  }

  async function fetchStudentAttendance(studentId) {
    if (!studentId) return;
    setStudentAttendanceMsg("Loading...");
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, status, comment")
      .eq("student_id", studentId);
    if (error) {
      console.error("student attendance fetch error:", error);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const entries = data ?? [];
    const dayIds = entries.map((e) => e.day_id).filter(Boolean);
    if (!dayIds.length) {
      setStudentAttendance([]);
      setStudentAttendanceMsg("No attendance records.");
      return;
    }
    const { data: daysData, error: daysError } = await supabase
      .from("attendance_days")
      .select("id, day_date")
      .in("id", dayIds);
    if (daysError) {
      console.error("attendance days fetch error:", daysError);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${daysError.message}`);
      return;
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
    setAttendanceMsg("Loading attendance...");
    const { data, error } = await supabase
      .from("attendance_days")
      .select("id, day_date, created_at")
      .order("day_date", { ascending: true })
      .limit(60);
    if (error) {
      console.error("attendance_days fetch error:", error);
      setAttendanceDays([]);
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setAttendanceDays(list);
    setAttendanceMsg(list.length ? "" : "No attendance days yet.");
    if (list.length) {
      fetchAttendanceEntries(list.map((d) => d.id));
    } else {
      setAttendanceEntries({});
    }
  }

  async function fetchAttendanceEntries(dayIds) {
    if (!dayIds?.length) {
      setAttendanceEntries({});
      return;
    }
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, student_id, status, comment")
      .in("day_id", dayIds);
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

  async function openAttendanceDay(dayDate) {
    if (!dayDate) return;
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    setAttendanceMsg("");
    setAttendanceModalOpen(true);
    setAttendanceSaving(false);
    setApprovedAbsenceByStudent({});
    const { data, error } = await supabase
      .from("attendance_days")
      .upsert({ school_id: activeSchoolId, day_date: dayDate }, { onConflict: "school_id,day_date" })
      .select()
      .single();
    if (error || !data?.id) {
      console.error("attendance day upsert error:", error);
      setAttendanceMsg(`Open day failed: ${error?.message ?? "Unknown error"}`);
      setAttendanceModalOpen(false);
      return;
    }
    const day = data;
    const { data: approvedApps, error: appsError } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, late_type, time_value, reason, catch_up")
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
    const existing = attendanceEntriesByDay[day.id] ?? {};
    const draft = {};
    (activeStudents ?? []).forEach((s) => {
      const entry = existing[s.id] || {};
      draft[s.id] = {
        status: entry.status || "P",
        comment: entry.comment || ""
      };
    });
    setAttendanceDraft(draft);
    await fetchAttendanceDays();
  }

  async function saveAttendanceDay() {
    if (!attendanceModalDay?.id) return;
    setAttendanceSaving(true);
    const rows = Object.entries(attendanceDraft || {})
      .map(([studentId, v]) => ({
        day_id: attendanceModalDay.id,
        student_id: studentId,
        status: v.status,
        comment: v.comment?.trim() || null
      }))
      .filter((r) => r.status);
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
    fetchAttendanceDays();
  }

  async function deleteAttendanceDay(day) {
    if (!day?.id) return;
    const ok = window.confirm(`Delete attendance for ${day.day_date}?`);
    if (!ok) return;
    const { error } = await supabase
      .from("attendance_days")
      .delete()
      .eq("id", day.id);
    if (error) {
      console.error("attendance delete error:", error);
      setAttendanceMsg(`Delete failed: ${error.message}`);
      return;
    }
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    fetchAttendanceDays();
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
      starts_at: "",
      ends_at: "",
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
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    if (mode !== "retake") {
      setDailyRetakeSourceId("");
      setDailySessionForm((current) => ({
        ...current,
        selection_mode: "single",
        problem_set_ids: current.problem_set_id ? [current.problem_set_id] : [],
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
    const source = pastDailySessions[0] ?? null;
    setDailyRetakeSourceId(source?.id ?? "");
    if (source) applySourceSessionToForm(source, setDailySessionForm);
  }

  function selectModelRetakeSource(sessionId) {
    setModelRetakeSourceId(sessionId);
    const source = pastModelSessions.find((session) => session.id === sessionId);
    if (source) applySourceSessionToForm(source, setTestSessionForm);
  }

  function selectDailyRetakeSource(sessionId) {
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    setDailyRetakeSourceId(sessionId);
    const source = pastDailySessions.find((session) => session.id === sessionId);
    if (source) applySourceSessionToForm(source, setDailySessionForm);
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
    if (modelConductMode === "retake" && !modelRetakeSourceId) {
      setTestSessionsMsg("Please choose a past session to retake.");
      return;
    }
    const problemSetId = testSessionForm.problem_set_id.trim();
    const title = testSessionForm.title.trim();
    const sessionDate = testSessionForm.session_date;
    const startTime = testSessionForm.start_time;
    const closeTime = testSessionForm.close_time;
    const startsAtInput = modelConductMode === "retake"
      ? testSessionForm.starts_at
      : combineBangladeshDateTime(sessionDate, startTime);
    const endsAt = modelConductMode === "retake"
      ? testSessionForm.ends_at
      : combineBangladeshDateTime(sessionDate, closeTime);
    const passRate = Number(testSessionForm.pass_rate);
    if (!problemSetId) {
      setTestSessionsMsg("SetID is required.");
      return;
    }
    if (!title) {
      setTestSessionsMsg("Test Title is required.");
      return;
    }
    if (modelConductMode !== "retake" && !sessionDate) {
      setTestSessionsMsg("Date is required.");
      return;
    }
    if (modelConductMode !== "retake" && !startTime) {
      setTestSessionsMsg("Start time is required.");
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
    fetchTestSessions();
    fetchExamLinks();
  }

  async function createDailySession() {
    setDailySessionsMsg("");
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
    const startsAtInput = dailyConductMode === "retake"
      ? dailySessionForm.starts_at
      : combineBangladeshDateTime(sessionDate, startTime);
    const endsAtInput = dailyConductMode === "retake"
      ? dailySessionForm.ends_at
      : combineBangladeshDateTime(sessionDate, closeTime);
    const title = dailySessionForm.title.trim();
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
    if (dailyConductMode !== "retake" && !sessionDate) {
      setDailySessionsMsg("Date is required.");
      return;
    }
    if (!endsAt) {
      setDailySessionsMsg("End time is required.");
      return;
    }
    if (dailyConductMode !== "retake" && !closeTime) {
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
    try {
      problemSetId = await materializeDailyProblemSet({
        sourceSetIds: selectedSetIds,
        category: dailyConductCategory,
        questionCountMode: dailySessionForm.question_count_mode,
        questionCount: dailySessionForm.question_count,
        passRate,
      });
    } catch (error) {
      setDailySessionsMsg(error.message);
      return;
    }
    const payload = {
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
    setDailySetDropdownOpen(false);
    setActiveDailyTimePicker("");
    fetchTests();
    fetchTestSessions();
    fetchExamLinks();
  }

  function startEditSession(session) {
    if (!session?.id) return;
    const passRate = testPassRateByVersion[session.problem_set_id];
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
      pass_rate: passRate != null ? String(passRate) : ""
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

  async function deleteTestSession(id) {
    if (!id) return;
    const ok = window.confirm(`Delete test session ${id}?`);
    if (!ok) return;
    const { error } = await supabase.from("test_sessions").delete().eq("id", id);
    if (error) {
      console.error("test_sessions delete error:", error);
      setTestSessionsMsg(`Delete failed: ${error.message}`);
      return;
    }
    setTestSessionsMsg(`Deleted: ${id}`);
    fetchTestSessions();
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
      return;
    }
    if (selectedId === attemptId) setSelectedId(null);
    setMsg(`Deleted: ${attemptId}`);
    runSearch();
  }

  function getAttemptTitle(attempt) {
    if (!attempt) return "";
    if (attempt.test_session_id) {
      const session = testSessions.find((s) => s.id === attempt.test_session_id);
      if (session?.title) return session.title;
    }
    return getProblemSetTitle(attempt.test_version, tests);
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
    setStudentMsg(`Deleted: ${email || userId}`);
    fetchStudents();
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

  async function uploadAssets() {
    setAssetUploadMsg("");
    if (!activeSchoolId) {
      setAssetUploadMsg("School scope is required.");
      return;
    }
    const singleFile = assetFile;
    const folderFiles = assetFiles || [];
    let testVersion = assetForm.test_version.trim();
    const type = "mock";
    const category = assetForm.category.trim();
    const title = type === "mock" ? (category || DEFAULT_MODEL_CATEGORY) : testVersion;

    if (!testVersion && assetCsvFile) {
      const csvText = await assetCsvFile.text();
      const detectedVersion = detectTestVersionFromCsvText(csvText);
      if (detectedVersion && detectedVersion !== testVersion) {
        testVersion = detectedVersion;
        setAssetForm((s) => ({ ...s, test_version: detectedVersion }));
      }
    }

    if (!singleFile && folderFiles.length === 0) {
      setAssetUploadMsg("File or folder is required.");
      return;
    }
    if (!testVersion) {
      setAssetUploadMsg("test_version is required.");
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

    setAssetUploadMsg("Uploading...");

    const ensure = await ensureTestRecord(testVersion, title, type, null, activeSchoolId);
    if (!ensure.ok) {
      setAssetUploadMsg(ensure.message);
      return;
    }

    let ok = 0;
    let ng = 0;
    for (const file of files) {
      const { error } = await uploadSingleAsset(file, testVersion, type, activeSchoolId);
      if (error) {
        ng += 1;
        console.error("asset upload error:", error);
      } else {
        ok += 1;
      }
      setAssetUploadMsg(`Uploading... ${ok + ng}/${files.length}`);
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
    const testVersion = assetForm.test_version.trim();
    const type = "mock";
    const category = assetForm.category.trim();

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
    const { questions, choices, errors } = parseQuestionCsv(text, testVersion);
    if (errors.length) {
      setAssetImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setAssetImportMsg("No questions found.");
      return;
    }
    const versionSet = new Set(questions.map((q) => q.test_version));
    if (versionSet.size > 1) {
      setAssetImportMsg("Multiple test_version values detected. Split CSV per test_version.");
      return;
    }
    const resolvedVersion = Array.from(versionSet)[0] || testVersion;
    if (resolvedVersion && resolvedVersion !== testVersion) {
      setAssetForm((s) => ({ ...s, test_version: resolvedVersion }));
    }
    if (!resolvedVersion) {
      setAssetImportMsg("test_version is required (either in form or CSV).");
      return;
    }
    const resolvedTitle = type === "mock" ? (category || DEFAULT_MODEL_CATEGORY) : resolvedVersion;

    setAssetImportMsg("Resolving assets...");
    const { data: assetRows, error: assetErr } = await supabase
      .from("test_assets")
      .select("path, original_name")
      .eq("test_version", resolvedVersion);
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
    const { missing, invalid } = validateAssetRefs(questions, choices, assetMap);
    if (invalid.length) {
      setAssetImportMsg(`Invalid asset paths (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
      return;
    }
    if (missing.length) {
      setAssetImportMsg(`Missing assets (upload first):\n${missing.slice(0, 5).join("\n")}`);
      return;
    }
    applyAssetMap(questions, choices, assetMap);

    setAssetImportMsg("Upserting tests...");
    const ensure = await ensureTestRecord(resolvedVersion, resolvedTitle, type, null, activeSchoolId);
    if (!ensure.ok) {
      setAssetImportMsg(ensure.message);
      return;
    }

    const questionIds = questions.map((q) => q.question_id);
    if (questionIds.length) {
      const notIn = `(${questionIds.map((id) => `"${id}"`).join(",")})`;
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion)
        .not("question_id", "in", notIn);
      if (cleanupErr) {
        console.error("questions cleanup error:", cleanupErr);
        setAssetImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    } else {
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion);
      if (cleanupErr) {
        console.error("questions cleanup error:", cleanupErr);
        setAssetImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    }

    setAssetImportMsg("Upserting questions...");
    const scopedQuestions = questions.map((question) => ({
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
      .eq("test_version", resolvedVersion)
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

    const choiceRows = choices
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

    setAssetImportMsg(`Imported ${questions.length} questions / ${choiceRows.length} choices.`);
    fetchTests();
    setAssetCsvFile(null);
  }

  async function uploadDailyAssets() {
    setDailyUploadMsg("");
    if (!activeSchoolId) {
      setDailyUploadMsg("School scope is required.");
      return;
    }
    const singleFile = dailyFile;
    const folderFiles = dailyFiles || [];
    let testVersion = dailyForm.test_version.trim();
    const category = dailyForm.category.trim();
    const type = "daily";

    if (!testVersion && dailyCsvFile) {
      const csvText = await dailyCsvFile.text();
      const detectedVersion = detectDailyTestIdFromCsvText(csvText);
      if (detectedVersion && detectedVersion !== testVersion) {
        testVersion = detectedVersion;
        setDailyForm((s) => ({ ...s, test_version: detectedVersion }));
      }
    }

    if (!singleFile && folderFiles.length === 0) {
      setDailyUploadMsg("File or folder is required.");
      return;
    }
    if (!testVersion) {
      setDailyUploadMsg("SetID is required.");
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

    setDailyUploadMsg("Uploading...");
    const ensure = await ensureTestRecord(testVersion, category || testVersion, type, null, activeSchoolId);
    if (!ensure.ok) {
      setDailyUploadMsg(ensure.message);
      return;
    }

    let ok = 0;
    let ng = 0;
    for (const file of files) {
      const { error } = await uploadSingleAsset(file, testVersion, type, activeSchoolId);
      if (error) {
        ng += 1;
        console.error("daily asset upload error:", error);
      } else {
        ok += 1;
      }
      setDailyUploadMsg(`Uploading... ${ok + ng}/${files.length}`);
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
    const testVersion = dailyForm.test_version.trim();
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
    const { questions, choices, errors } = parseDailyCsv(text, testVersion);
    if (errors.length) {
      setDailyImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setDailyImportMsg("No questions found.");
      return;
    }
    const versionSet = new Set(questions.map((q) => q.test_version));
    if (versionSet.size > 1) {
      setDailyImportMsg("Multiple SetID values detected. Split CSV per SetID.");
      return;
    }
    const resolvedVersion = Array.from(versionSet)[0] || testVersion;
    if (resolvedVersion && resolvedVersion !== testVersion) {
      setDailyForm((s) => ({ ...s, test_version: resolvedVersion }));
    }
    if (!resolvedVersion) {
      setDailyImportMsg("SetID is required (either in form or CSV).");
      return;
    }

    setDailyImportMsg("Resolving assets...");
    const { data: assetRows, error: assetErr } = await supabase
      .from("test_assets")
      .select("path, original_name")
      .eq("test_version", resolvedVersion);
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
    const { missing, invalid } = validateAssetRefs(questions, choices, assetMap);
    if (invalid.length) {
      setDailyImportMsg(`Invalid asset paths (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
      return;
    }
    if (missing.length) {
      setDailyImportMsg(`Missing assets (upload first):\n${missing.slice(0, 5).join("\n")}`);
      return;
    }
    applyAssetMap(questions, choices, assetMap);

    setDailyImportMsg("Upserting tests...");
    const ensure = await ensureTestRecord(resolvedVersion, category || resolvedVersion, type, null, activeSchoolId);
    if (!ensure.ok) {
      setDailyImportMsg(ensure.message);
      return;
    }

    const questionIds = questions.map((q) => q.question_id);
    if (questionIds.length) {
      const notIn = `(${questionIds.map((id) => `"${id}"`).join(",")})`;
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion)
        .not("question_id", "in", notIn);
      if (cleanupErr) {
        console.error("daily questions cleanup error:", cleanupErr);
        setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    } else {
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion);
      if (cleanupErr) {
        console.error("daily questions cleanup error:", cleanupErr);
        setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    }

    setDailyImportMsg("Upserting questions...");
    const scopedQuestions = questions.map((question) => ({
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
      .eq("test_version", resolvedVersion)
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

    const choiceRows = choices
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

    setDailyImportMsg(`Imported ${questions.length} questions / ${choiceRows.length} choices.`);
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginMsg(normalizeAdminLoginErrorMessage(error.message));
      return;
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

    const bestQuestions = sessionDetailQuestionAnalysis.slice(0, 5);
    const worstQuestions = [...sessionDetailQuestionAnalysis]
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return String(a.qid).localeCompare(String(b.qid));
      })
      .slice(0, 5);
    const sessionDetailTabs = [
      ["questions", "Questions"],
      ["attempts", "Attempts"],
      ...(isMockSessionDetail ? [["studentRanking", "Student Ranking"]] : []),
      ["analysis", "Result Analysis"],
    ];
    const analysisRadarData = sessionDetailSectionAverages.map((row) => ({
      label: row.section,
      value: row.averageRate,
    }));

    return (
      <div className="session-detail-page">
        <div className="session-detail-header">
          <div>
            <button className="link-btn" type="button" onClick={closeSessionDetail}>
              {"<- Back to sessions"}
            </button>
            <div className="admin-title" style={{ marginTop: 10 }}>
              {selectedSessionDetail.title || selectedSessionDetail.problem_set_id}
            </div>
            <div className="admin-help" style={{ marginTop: 6 }}>
              SetID: <b>{selectedSessionDetail.problem_set_id}</b>
              {" · "}
              Start: <b>{formatDateTime(selectedSessionDetail.starts_at) || "—"}</b>
              {" · "}
              End: <b>{formatDateTime(selectedSessionDetail.ends_at) || "—"}</b>
            </div>
          </div>
          <div className="admin-top-tabs">
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
                    <th>Code</th>
                    <th>Score</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th>Attempt ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailAttempts.map((attempt, index) => {
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
                  {!sessionDetailAttempts.length ? (
                    <tr>
                      <td colSpan={8}>No attempts yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && isMockSessionDetail && sessionDetailTab === "studentRanking" ? (
          <div className="session-detail-section">
            <div className="admin-table-wrap">
              <table className="admin-table session-student-ranking-table" style={{ minWidth: Math.max(900, 420 + sessionDetailSectionAverages.length * 120) }}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Code</th>
                    <th>Total Score</th>
                    <th>Total %</th>
                    {sessionDetailSectionAverages.map((section) => (
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
                    <tr key={`student-ranking-row-${row.student_id}`}>
                      <td>{formatOrdinal(row.rank)}</td>
                      <td>{row.display_name}</td>
                      <td>{row.student_code || "—"}</td>
                      <td>{row.totalCorrect}/{row.totalQuestions}</td>
                      <td>{(row.totalRate * 100).toFixed(1)}%</td>
                      {sessionDetailSectionAverages.map((section) => (
                        <td key={`student-ranking-cell-${row.student_id}-${section.section}`}>
                          {((row.sectionRates?.[section.section] ?? 0) * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!sessionDetailStudentRankingRows.length ? (
                    <tr>
                      <td colSpan={Math.max(5, 5 + sessionDetailSectionAverages.length)}>No ranking data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "analysis" ? (
          <div className="session-detail-section">
            <div className="admin-kpi session-detail-kpi">
              <div className="box">
                <div className="label">Average Score</div>
                <div className="value">{(sessionDetailOverview.averageScore * 100).toFixed(1)}%</div>
              </div>
              <div className="box">
                <div className="label">Pass Rate</div>
                <div className="value">{(sessionDetailOverview.passRate * 100).toFixed(1)}%</div>
              </div>
              <div className="box">
                <div className="label">Students Passed</div>
                <div className="value">{sessionDetailOverview.passCount}/{sessionDetailOverview.count}</div>
              </div>
            </div>

            {isMockSessionDetail ? (
              <div className="session-detail-analysis-summary">
                <div className="admin-panel">
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
                      <table className="admin-table session-section-average-table" style={{ minWidth: 520 }}>
                        <thead>
                          <tr>
                            <th>Section</th>
                            <th>Average %</th>
                            <th>Average Correct No.</th>
                            <th>Total Questions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessionDetailSectionAverages.map((row) => (
                            <tr key={`session-section-average-${row.section}`}>
                              <td>{row.section}</td>
                              <td>{(row.averageRate * 100).toFixed(1)}%</td>
                              <td>{row.averageCorrect.toFixed(2)}</td>
                              <td>{row.totalQuestions}</td>
                            </tr>
                          ))}
                          {!sessionDetailSectionAverages.length ? (
                            <tr>
                              <td colSpan={4}>No section average data available.</td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="session-detail-analysis-grid">
              <div className="admin-panel">
                <div className="admin-title" style={{ fontSize: 18 }}>Top 5 Best Questions</div>
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
                <div className="admin-title" style={{ fontSize: 18 }}>Top 5 Worst Questions</div>
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
      <div className="admin-login">
        <h2>Change Temporary Password</h2>
        <div className="admin-help">
          This account must change its temporary password before continuing.
        </div>
        <div style={{ marginTop: 12 }}>
          <label>New Password</label>
          <input
            type="password"
            value={passwordChangeForm.password}
            onChange={(e) => setPasswordChangeForm((s) => ({ ...s, password: e.target.value }))}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Confirm Password</label>
          <input
            type="password"
            value={passwordChangeForm.confirmPassword}
            onChange={(e) => setPasswordChangeForm((s) => ({ ...s, confirmPassword: e.target.value }))}
          />
        </div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" disabled={passwordChangeLoading} onClick={handlePasswordChange}>
            {passwordChangeLoading ? "Saving..." : "Update Password"}
          </button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <div className="admin-msg">{passwordChangeMsg}</div>
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
            <Link className="btn" href="/super/schools">Go to Schools</Link>
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
    if (activeTab === "students") return "Students";
    if (activeTab === "attendance") {
      return attendanceSubTab === "absence" ? "Absence Applications" : "Attendance Sheet";
    }
    if (activeTab === "dailyRecord") return "Schedule & Record";
    if (activeTab === "ranking") return "Ranking";
    if (activeTab === "announcements") return "Announcements";
    if (activeTab === "model") {
      if (sessionDetail.type === "mock" && sessionDetail.sessionId) return "Test Session Detail";
      if (modelSubTab === "results") return "Model Results";
      if (modelSubTab === "sets") return "Sets";
      return "Test Sessions";
    }
    if (activeTab === "daily") {
      if (sessionDetail.type === "daily" && sessionDetail.sessionId) return "Daily Test Session Detail";
      if (dailySubTab === "results") return "Daily Results";
      if (dailySubTab === "create") return "Daily Tests";
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
                setModelSubTab("conduct");
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
                <button
                  className={`admin-subnav-item ${modelSubTab === "results" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("model");
                    setModelSubTab("results");
                  })}
                >
                  Results
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "daily" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "daily" ? "active" : ""}`}
              onClick={() => handleSidebarMenuClick(() => {
                setActiveTab("daily");
                setDailySubTab("conduct");
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
                <button
                  className={`admin-subnav-item ${dailySubTab === "results" ? "active" : ""}`}
                  onClick={() => handleSidebarMenuClick(() => {
                    setActiveTab("daily");
                    setDailySubTab("results");
                  })}
                >
                  Results
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
                  <select
                    id="admin-school-switcher"
                    value={activeSchoolId ?? ""}
                    onChange={(event) => handleAdminSchoolScopeChange(event.target.value)}
                  >
                    {schoolAssignments.map((assignment) => (
                      <option key={assignment.school_id} value={assignment.school_id}>
                        {assignment.school_name}
                        {assignment.is_primary ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="admin-title">Students</div>
                  <div className="admin-subtitle">Student list and performance overview.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters));
                      setStudentWarningIssueMsg("");
                      setStudentWarningIssueOpen(true);
                    }}
                  >
                    Issue Warning
                  </button>
                  <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>Add New Student</button>
                  <button className="btn" onClick={() => fetchStudents()}>Refresh Students</button>
                  <button className="btn" onClick={() => fetchStudentListMetrics()}>Refresh Metrics</button>
                </div>
              </div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field small">
                  <label>Date From</label>
                  <input
                    type="date"
                    value={studentListFilters.from}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, from: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Date To</label>
                  <input
                    type="date"
                    value={studentListFilters.to}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, to: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Attendance % (≤)</label>
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
                  <label>Unexcused (≥)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 3"
                    value={studentListFilters.minUnexcused}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, minUnexcused: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Model Avg % (≥)</label>
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
                  <label>Daily Avg % (≥)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 60"
                    value={studentListFilters.minDailyAvg}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, minDailyAvg: e.target.value }))}
                  />
                </div>
              </div>

              <div className="student-warning-history">
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

              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Attendance %</th>
                      <th>Unexcused</th>
                      <th>Model Avg %</th>
                      <th>Daily Avg %</th>
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
                            setSelectedStudentId(s.id);
                            setSelectedStudentTab("information");
                            setStudentAttendance([]);
                            setStudentAttendanceMsg("");
                            setStudentAttendanceRange({ from: "", to: "" });
                            setStudentDetailOpen(true);
                          }}
                          className={s.is_withdrawn ? "row-withdrawn" : ""}
                        >
                          <td>{s.student_code ?? ""}</td>
                          <td>
                            <div className="student-list-name-cell">
                              <span>{s.display_name ?? ""}</span>
                              {studentWarningCounts[s.id] ? (
                                <span className="student-warning-badge" title={`${studentWarningCounts[s.id]} warning(s) issued`}>
                                  !
                                </span>
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
              {studentListLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading metrics...</div> : null}
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
                      ←
                    </button>
                    <div className="admin-title">
                      {selectedStudent?.display_name ?? ""} {selectedStudent?.student_code ? `(${selectedStudent.student_code})` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn"
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
                  <button
                    className={`btn ${selectedStudent?.is_withdrawn ? "btn-withdrawn" : ""}`}
                    onClick={() => {
                      if (!selectedStudent) return;
                      toggleWithdrawn(selectedStudent, !selectedStudent.is_withdrawn);
                    }}
                  >
                    {selectedStudent?.is_withdrawn ? "Withdrawn" : "Withdraw"}
                  </button>
                  <button
                    className="btn btn-danger"
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
                <div className="admin-top-tabs">
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
                <button
                  className="btn"
                  onClick={() => {
                    if (selectedStudentTab === "information") {
                      fetchStudents();
                    } else if (selectedStudentTab === "attendance") {
                      fetchStudentAttendance(selectedStudentId);
                    } else {
                      fetchStudentAttempts(selectedStudentId);
                    }
                  }}
                >
                  Refresh
                </button>
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
                    <div className="student-info-grid admin-student-info-grid">
                      {[
                        { label: "Full Name", value: selectedStudent?.display_name || "-" },
                        { label: "Email", value: selectedStudent?.email || "-" },
                        { label: "Phone Number", value: selectedStudent?.phone_number || "-" },
                        {
                          label: "Date of Birth",
                          value: selectedStudent?.date_of_birth
                            ? `${formatDateFull(selectedStudent.date_of_birth)}${calculateAge(selectedStudent.date_of_birth) != null ? ` • Age ${calculateAge(selectedStudent.date_of_birth)}` : ""}`
                            : "-"
                        },
                        { label: "Sex", value: selectedStudent?.sex || "-" },
                        { label: "UID", value: selectedStudent?.student_code || "-" },
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
                          const passRate = Number(testPassRateByVersion[a.test_version] ?? 0.8);
                          const passed = getScoreRate(a) >= passRate;
                          const rankInfo = studentAttemptRanks[a.id];
                          const summary = studentAttemptSummaryById[a.id] || {};
                          return (
                            <tr
                              key={`student-model-${a.id}`}
                              onClick={() => openAttemptDetail(a)}
                            >
                              <td>{getAttemptTitle(a)}</td>
                              <td>{formatDateFull(a.created_at)}</td>
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
                              const passRate = Number(testPassRateByVersion[a.test_version] ?? 0.8);
                              const passed = getScoreRate(a) >= passRate;
                              return (
                                <tr key={`student-daily-${a.id}`} onClick={() => openAttemptDetail(a)}>
                                  <td>{getAttemptTitle(a)}</td>
                                  <td>{formatDateFull(a.created_at)}</td>
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
                          <td>Present (Days)</td>
                          <td>{attendanceSummary.overall.present || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-present`}>{m.stats.present || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Late/Left early (Days)</td>
                          <td>{attendanceSummary.overall.late || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-late`}>{m.stats.late || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Excused Absence (Days)</td>
                          <td>{attendanceSummary.overall.excused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-excused`}>{m.stats.excused || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Unexcused Absence (Days)</td>
                          <td>{attendanceSummary.overall.unexcused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-unexcused`}>{m.stats.unexcused || "-"}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
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
              <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Issue Warning</div>
                  <button className="admin-modal-close" onClick={() => setStudentWarningIssueOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>
                <div className="admin-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>Title (optional)</label>
                    <input
                      value={studentWarningForm.title}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Warning title"
                    />
                  </div>
                  <div className="field small">
                    <label>Date From</label>
                    <input
                      type="date"
                      value={studentWarningForm.from}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, from: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>Date To</label>
                    <input
                      type="date"
                      value={studentWarningForm.to}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, to: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>Attendance % (≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={studentWarningForm.maxAttendance}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxAttendance: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>Unexcused (≥)</label>
                    <input
                      type="number"
                      min="0"
                      value={studentWarningForm.minUnexcused}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, minUnexcused: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
                    <label>Model Avg % (≤)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={studentWarningForm.maxModelAvg}
                      onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxModelAvg: e.target.value }))}
                    />
                  </div>
                  <div className="field small">
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
                        <th>Code</th>
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
              </div>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "sheet" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="admin-title">Attendance Sheet</div>
              <div className="admin-subtitle">P / L / E / A を日別で管理します。</div>
            </div>
          </div>

          <div className="attendance-control-row" style={{ marginTop: 10 }}>
            <div className="admin-form">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                />
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button className="btn btn-primary" type="button" onClick={() => openAttendanceDay(attendanceDate)}>
                  Open Day
                </button>
              </div>
            </div>

            <div className="admin-form attendance-filter-box">
            <div className="field small">
              <label>Filter (Rate &lt;)</label>
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
              <label>Filter (Unexcused ≥)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 3"
                value={attendanceFilter.minAbsences}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minAbsences: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Range From</label>
              <input
                type="date"
                value={attendanceFilter.startDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Range To</label>
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

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table attendance-table">
              <thead>
                <tr>
                  <th className="att-col-code att-sticky-1">ID</th>
                  <th className="att-col-name att-sticky-2">Student Name</th>
                  <th className="att-col-rate att-sticky-3">Attendance<br />Rate</th>
                  <th className="att-col-absent att-sticky-4">Unexcused<br />Absence</th>
                  {attendanceDayColumns.map((d) => (
                    <th key={d.id}>
                      <button className="link-btn" onClick={() => openAttendanceDay(d.day_date)}>
                        {d.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceFilteredStudents.map((s) => {
                  const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
                  const total = perDay.filter(Boolean).length;
                  const present = perDay.filter((v) => v === "P" || v === "L").length;
                  const absences = perDay.filter((v) => v === "A").length;
                  const rate = total ? (present / total) * 100 : 0;
                  return (
                    <tr key={s.id}>
                      <td className="att-col-code att-sticky-1">{s.student_code ?? ""}</td>
                      <td className="att-col-name att-sticky-2">{s.display_name ?? s.email ?? s.id}</td>
                      <td className="att-col-rate att-sticky-3">{rate.toFixed(2)}%</td>
                      <td className="att-col-absent att-sticky-4">{absences}</td>
                      {attendanceDayColumns.map((d) => {
                        const status = attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "";
                        return (
                          <td key={`${s.id}-${d.id}`} className={`att-cell ${status ? `att-${status}` : ""}`}>
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
            <div>
              <div className="admin-title">Schedule & Record</div>
              <div className="admin-subtitle">Track what was covered each day, planned mini/special tests, and student-specific comments.</div>
            </div>
            <button className="btn" onClick={() => fetchDailyRecords()}>Refresh</button>
          </div>

          <div className="attendance-control-row" style={{ marginTop: 10 }}>
            <div className="admin-form">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={dailyRecordDate}
                  onChange={(e) => setDailyRecordDate(e.target.value)}
                />
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button className="btn btn-primary" type="button" onClick={() => openDailyRecordModal(null, dailyRecordDate)}>
                  Open Record
                </button>
              </div>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12, maxHeight: "70vh" }} ref={dailyRecordTableWrapRef}>
            <table className="admin-table" style={{ minWidth: 1360 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Today's Content</th>
                  <th>Student Comments</th>
                  <th>Mini Test 1</th>
                  <th>Mini Test 2</th>
                  <th>Special Test 1</th>
                  <th>Special Test 2</th>
                  <th>Open Record</th>
                  <th>Save Plan</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRecordRows.map(({ recordDate, record, draft }) => (
                  <tr key={record?.id ?? recordDate} data-daily-record-date={recordDate}>
                    <td>{formatDateFull(recordDate)}</td>
                    <td>{record?.todays_content ? (record.todays_content.length > 140 ? `${record.todays_content.slice(0, 140)}...` : record.todays_content) : "-"}</td>
                    <td>{record ? summarizeDailyRecordComments(record) : "-"}</td>
                    <td>
                      <input
                        value={draft.mini_test_1}
                        onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_1", e.target.value)}
                        placeholder="Plan"
                      />
                    </td>
                    <td>
                      <input
                        value={draft.mini_test_2}
                        onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_2", e.target.value)}
                        placeholder="Plan"
                      />
                    </td>
                    <td>
                      <input
                        value={draft.special_test_1}
                        onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_1", e.target.value)}
                        placeholder="Plan"
                      />
                    </td>
                    <td>
                      <input
                        value={draft.special_test_2}
                        onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_2", e.target.value)}
                        placeholder="Plan"
                      />
                    </td>
                    <td>
                      <button className="btn" type="button" onClick={() => openDailyRecordModal(record, recordDate)}>
                        Open Record
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => saveDailyRecordPlan(recordDate)}
                        disabled={dailyRecordPlanSavingDate === recordDate}
                      >
                        {dailyRecordPlanSavingDate === recordDate ? "Saving..." : "Save Plan"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{dailyRecordsMsg}</div>
        </div>
        ) : null}

        {activeTab === "ranking" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="admin-title">Ranking</div>
              <div className="admin-subtitle">Set a date range for each ranking column, then refresh that column to recalculate average test percentages.</div>
            </div>
            <button className="btn btn-primary" type="button" onClick={addRankingPeriod}>
              Add Period
            </button>
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
                            className="btn btn-primary"
                            type="button"
                            onClick={() => refreshRankingPeriod(period)}
                            disabled={rankingRefreshingId === period.id}
                          >
                            {rankingRefreshingId === period.id ? "Refreshing..." : "Refresh"}
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
            <div>
              <div className="admin-title">Announcements</div>
              <div className="admin-subtitle">Create announcements and send them to students.</div>
            </div>
            <button className="btn" onClick={() => fetchAnnouncements()}>Refresh</button>
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
                rows={4}
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
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={createAnnouncement}>
                Create Announcement
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
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          value={editingAnnouncementForm.title}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, title: e.target.value }))}
                        />
                      ) : (
                        a.title
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <textarea
                          value={editingAnnouncementForm.body}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, body: e.target.value }))}
                          rows={3}
                        />
                      ) : (
                        a.body
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingAnnouncementForm.publish_at}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, publish_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(a.publish_at)
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingAnnouncementForm.end_at}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, end_at: e.target.value }))}
                        />
                      ) : (
                        a.end_at ? formatDateTime(a.end_at) : ""
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-primary" onClick={saveAnnouncementEdits}>
                            Save
                          </button>
                          <button className="btn" onClick={cancelEditAnnouncement}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn" onClick={() => startEditAnnouncement(a)}>
                          Edit
                        </button>
                      )}
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
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "absence" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Absence Applications</div>
              <div className="admin-subtitle">Review and approve/deny student applications.</div>
            </div>
            <button className="btn" onClick={() => fetchAbsenceApplications()}>Refresh</button>
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
                    <button className="btn btn-primary" onClick={() => openModelConductModal("normal")}>
                      Create Test Session
                    </button>
                    <button className="btn btn-retake" onClick={() => openModelConductModal("retake")}>
                      Create Retake Session
                    </button>
                  </div>
                  <div className="admin-subtitle">SetIDから実施テストを作成します。</div>
                </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() => {
                    fetchTestSessions();
                    fetchExamLinks();
                  }}
                >
                  Refresh Sessions
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
                            testPassRateByVersion[t.problem_set_id] != null
                              ? `${Number(testPassRateByVersion[t.problem_set_id]) * 100}%`
                              : ""
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
                className={`admin-modal ${modelConductMode === "retake" ? "invite-modal" : "daily-session-create-modal"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`admin-modal-header ${modelConductMode === "retake" ? "" : "daily-session-create-header"}`}>
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

                <div className={modelConductMode === "retake" ? "admin-form" : "daily-session-create-body"}>
                  {modelConductMode === "retake" ? (
                    <>
                      <div className="field">
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
                      <div className="field">
                        <label>Release To</label>
                        <select
                          value={testSessionForm.retake_release_scope}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, retake_release_scope: e.target.value }))}
                        >
                          <option value="all">All students</option>
                          <option value="failed_only">Only students who failed</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="daily-session-create-layout">
                      <div className="daily-session-create-field">
                        <label>Category</label>
                        <select
                          value={modelConductCategory}
                          onChange={(e) => setModelConductCategory(e.target.value)}
                        >
                          {modelCategories.length ? (
                            modelCategories.map((c) => (
                              <option key={`model-cat-${c.name}`} value={c.name}>
                                {c.name}
                              </option>
                            ))
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

                  {modelConductMode === "retake" ? (
                    <>
                      <div className="field">
                        <label>Test Title</label>
                        <input
                          value={testSessionForm.title}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Mock Test (Retake)"
                        />
                      </div>
                      <div className="field small">
                        <label>Starts At</label>
                        <input
                          type="datetime-local"
                          step="300"
                          value={testSessionForm.starts_at}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                        />
                      </div>
                      <div className="field small">
                        <label>Ends At</label>
                        <input
                          type="datetime-local"
                          step="300"
                          value={testSessionForm.ends_at}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                        />
                      </div>
                      <div className="field small">
                        <label>Time Limit (min)</label>
                        <input
                          value={testSessionForm.time_limit_min}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                          placeholder="60"
                        />
                      </div>
                      <div className="field small">
                        <label>Show Answers</label>
                        <select
                          value={testSessionForm.show_answers ? "yes" : "no"}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>
                      <div className="field small">
                        <label>Attempts</label>
                        <select
                          value={testSessionForm.allow_multiple_attempts ? "multiple" : "once"}
                          onChange={(e) =>
                            setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                          }
                        >
                          <option value="once">Only once</option>
                          <option value="multiple">Allow multiple</option>
                        </select>
                      </div>
                      <div className="field small">
                        <label>Pass Rate</label>
                        <input
                          value={testSessionForm.pass_rate}
                          onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                          placeholder="0.8"
                        />
                      </div>
                      <div className="field small">
                        <label>&nbsp;</label>
                        <button
                          className="btn btn-retake"
                          type="button"
                          onClick={createTestSession}
                          disabled={!modelRetakeSourceId}
                        >
                          Create Session
                        </button>
                      </div>
                    </>
                  ) : null}
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
                  <button className="btn btn-primary" onClick={() => setModelUploadOpen(true)}>
                    Upload Question Set
                  </button>
                </div>
                <div className="admin-subtitle">CSVとAssetsをアップロードし、問題セットを登録します（タイトルはTest Sessionで設定）。</div>
              </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => fetchAssets()}>Refresh</button>
            </div>
          </div>
          <div className="admin-msg">{assetUploadMsg}</div>
          {assetImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {assetImportMsg}
            </pre>
          ) : null}
          <div className="admin-msg">{assetsMsg}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Sets</div>
              <div className="admin-subtitle">セット（CSV/Assets）の一覧です。</div>
            </div>
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
              <button className="btn" onClick={() => fetchTests()}>Refresh Sets</button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
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
                {filteredModelUploadTests.map((t) => (
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
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          <div className="admin-msg">{testsMsg}</div>

          {modelUploadOpen ? (
            <div className="admin-modal-overlay" onClick={() => setModelUploadOpen(false)}>
              <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Upload Model Questions</div>
                  <button className="admin-modal-close" onClick={() => setModelUploadOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>

                <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>SetID</label>
                    <input
                      value={assetForm.test_version}
                      onChange={(e) => setAssetForm((s) => ({ ...s, test_version: e.target.value }))}
                      placeholder="problem_set_v1"
                    />
                  </div>
                  <div className="field">
                    <label>Category</label>
                    <select
                      value={assetCategorySelect}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAssetCategorySelect(next);
                        if (next !== "__custom__") {
                          setAssetForm((s) => ({ ...s, category: next }));
                        }
                      }}
                    >
                      {(modelCategories.length ? modelCategories : [{ name: DEFAULT_MODEL_CATEGORY }]).map((c) => (
                        <option key={`asset-cat-${c.name}`} value={c.name}>{c.name}</option>
                      ))}
                      <option value="__custom__">Custom...</option>
                    </select>
                    {assetCategorySelect === "__custom__" ? (
                      <input
                        value={assetForm.category}
                        onChange={(e) => setAssetForm((s) => ({ ...s, category: e.target.value }))}
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
                          if (!assetForm.test_version) {
                            file.text().then((text) => {
                              const detected = detectTestVersionFromCsvText(text);
                              if (detected) {
                                setAssetForm((s) => ({ ...s, test_version: detected }));
                              }
                            });
                          }
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
                    <label>Folder (PNG/MP3)</label>
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
                            if (!assetForm.test_version) {
                              csvFile.text().then((text) => {
                                const detected = detectTestVersionFromCsvText(text);
                                if (detected) {
                                  setAssetForm((s) => ({ ...s, test_version: detected }));
                                }
                              });
                            }
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
                    <button className="btn btn-primary" type="button" onClick={uploadAssets}>
                      Upload & Register Set
                    </button>
                  </div>
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
                    <button className="btn btn-primary" onClick={() => openDailyConductModal("normal")}>
                      Create Test Session
                    </button>
                    <button className="btn btn-retake" onClick={() => openDailyConductModal("retake")}>
                      Create Retake Session
                    </button>
                  </div>
                  <div className="admin-subtitle">Daily Testの実施テストを作成します。</div>
                </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  onClick={() => {
                    fetchTestSessions();
                    fetchExamLinks();
                  }}
                >
                  Refresh Sessions
                </button>
              </div>
            </div>
          ) : null}

          {sessionDetail.type === "daily" && sessionDetail.sessionId ? (
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
                            testPassRateByVersion[t.problem_set_id] != null
                              ? `${Number(testPassRateByVersion[t.problem_set_id]) * 100}%`
                              : ""
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
                setDailyRetakeSourceId("");
                setDailySetDropdownOpen(false);
                setActiveDailyTimePicker("");
              }}
            >
              <div
                className={`admin-modal ${dailyConductMode === "retake" ? "invite-modal" : "daily-session-create-modal"}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={`admin-modal-header ${dailyConductMode === "retake" ? "" : "daily-session-create-header"}`}>
                  <div className="admin-title">{dailyConductMode === "retake" ? "Conduct Daily Retake" : "Create Daily Test Session"}</div>
                  <button
                    className="admin-modal-close"
                    onClick={() => {
                      setDailyConductOpen(false);
                      setDailyConductMode("normal");
                      setDailyRetakeSourceId("");
                      setDailySetDropdownOpen(false);
                      setActiveDailyTimePicker("");
                    }}
                    aria-label="Close"
                  >
                    &times;
                  </button>
                </div>

                <div className={dailyConductMode === "retake" ? "admin-form" : "daily-session-create-body"}>
                  {dailyConductMode === "retake" ? (
                    <>
                      <div className="field">
                        <label>Original Session</label>
                        <select
                          value={dailyRetakeSourceId}
                          onChange={(e) => selectDailyRetakeSource(e.target.value)}
                        >
                          {pastDailySessions.length ? (
                            pastDailySessions.map((session) => (
                              <option key={`daily-retake-${session.id}`} value={session.id}>
                                {session.title || session.problem_set_id} ({formatDateTime(session.ends_at || session.starts_at || session.created_at)})
                              </option>
                            ))
                          ) : (
                            <option value="">No past daily sessions</option>
                          )}
                        </select>
                      </div>
                      <div className="field">
                        <label>Release To</label>
                        <select
                          value={dailySessionForm.retake_release_scope}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, retake_release_scope: e.target.value }))}
                        >
                          <option value="all">All students</option>
                          <option value="failed_only">Only students who failed</option>
                        </select>
                      </div>
                    </>
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
                        <label>Category</label>
                        <select
                          value={dailyConductCategory}
                          onChange={(e) => setDailyConductCategory(e.target.value)}
                        >
                          {dailyCategories.length ? (
                            dailyCategories.map((c) => (
                              <option key={`daily-cat-${c.name}`} value={c.name}>
                                {c.name}
                              </option>
                            ))
                          ) : (
                            <option value="">No categories</option>
                          )}
                        </select>
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
                                  <div className="daily-session-create-help">No daily tests in this category.</div>
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
                  {dailyConductMode === "retake" ? (
                    <>
                      <div className="field">
                        <label>Test Title</label>
                        <input
                          value={dailySessionForm.title}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, title: e.target.value }))}
                          placeholder="Daily Test"
                        />
                      </div>
                      <div className="field small">
                        <label>Starts At</label>
                        <input
                          type="datetime-local"
                          step="300"
                          value={dailySessionForm.starts_at}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                        />
                      </div>
                      <div className="field small">
                        <label>Ends At</label>
                        <input
                          type="datetime-local"
                          step="300"
                          value={dailySessionForm.ends_at}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                        />
                      </div>
                      <div className="field small">
                        <label>Time Limit (min)</label>
                        <input
                          value={dailySessionForm.time_limit_min}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                          placeholder="10"
                        />
                      </div>
                      <div className="field small">
                        <label>Show Answers</label>
                        <select
                          value={dailySessionForm.show_answers ? "yes" : "no"}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      </div>
                      <div className="field small">
                        <label>Attempts</label>
                        <select
                          value={dailySessionForm.allow_multiple_attempts ? "multiple" : "once"}
                          onChange={(e) =>
                            setDailySessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                          }
                        >
                          <option value="once">Only once</option>
                          <option value="multiple">Allow multiple</option>
                        </select>
                      </div>
                      <div className="field small">
                        <label>Pass Rate</label>
                        <input
                          value={dailySessionForm.pass_rate}
                          onChange={(e) => setDailySessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                          placeholder="0.8"
                        />
                      </div>
                    </>
                  ) : null}
                  {dailyConductMode === "retake" ? (
                    <div className="field small">
                      <label>&nbsp;</label>
                      <button
                        className="btn btn-retake"
                        type="button"
                        onClick={createDailySession}
                        disabled={!dailyRetakeSourceId}
                      >
                        Create Session
                      </button>
                    </div>
                  ) : null}
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
                <button className="btn btn-primary" onClick={() => setDailyUploadOpen(true)}>
                  Upload Question Set
                </button>
              </div>
              <div className="admin-subtitle">Daily Test用CSVとIllustrationをアップロードします。</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => fetchAssets()}>Refresh</button>
            </div>
          </div>
          <div className="admin-msg">{dailyUploadMsg}</div>
          {dailyImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {dailyImportMsg}
            </pre>
          ) : null}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Daily Tests</div>
              <div className="admin-subtitle">Daily Test（CSV/Assets）の一覧です。</div>
            </div>
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
              <button className="btn" onClick={() => fetchTests()}>Refresh Daily Tests</button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
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
                {filteredDailyUploadTests.map((t) => (
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
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          <div className="admin-msg">{testsMsg}</div>

          {dailyUploadOpen ? (
            <div className="admin-modal-overlay" onClick={() => setDailyUploadOpen(false)}>
              <div className="admin-modal upload-question-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Upload Daily Questions</div>
                  <button className="admin-modal-close" onClick={() => setDailyUploadOpen(false)} aria-label="Close">
                    &times;
                  </button>
                </div>

                <div className="admin-form upload-question-form" style={{ marginTop: 10 }}>
                  <div className="field">
                    <label>SetID</label>
                    <input
                      value={dailyForm.test_version}
                      onChange={(e) => setDailyForm((s) => ({ ...s, test_version: e.target.value }))}
                      placeholder="daily_vocab_01"
                    />
                  </div>
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
                          if (!dailyForm.test_version) {
                            file.text().then((text) => {
                              const detected = detectDailyTestIdFromCsvText(text);
                              if (detected) {
                                setDailyForm((s) => ({ ...s, test_version: detected }));
                              }
                            });
                          }
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
                    <label>Folder (PNG/MP3)</label>
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
                            if (!dailyForm.test_version) {
                              csvFile.text().then((text) => {
                                const detected = detectDailyTestIdFromCsvText(text);
                                if (detected) {
                                  setDailyForm((s) => ({ ...s, test_version: detected }));
                                }
                              });
                            }
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
                    <button className="btn btn-primary" type="button" onClick={uploadDailyAssets}>
                      Upload & Register Daily Test
                    </button>
                  </div>
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

        {dailyRecordModalOpen ? (
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (dailyRecordSaving) return;
              closeDailyRecordModal();
            }}
          >
            <div className="admin-modal invite-modal daily-record-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Schedule & Record</div>
                <button
                  className="admin-modal-close"
                  onClick={() => {
                    if (dailyRecordSaving) return;
                    closeDailyRecordModal();
                  }}
                  aria-label="Close"
                >
                  &times;
                </button>
              </div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Date</label>
                  <input
                    type="date"
                    value={dailyRecordForm.record_date}
                    onChange={(e) => setDailyRecordForm((prev) => ({ ...prev, record_date: e.target.value }))}
                  />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Today's Content</label>
                  <textarea
                    rows={5}
                    value={dailyRecordForm.todays_content}
                    onChange={(e) => setDailyRecordForm((prev) => ({ ...prev, todays_content: e.target.value }))}
                    placeholder="Write what was covered in class today."
                  />
                </div>
              </div>

              <div className="daily-record-comments-section">
                <div className="daily-record-comments-header">
                  <div>
                    <div className="admin-title" style={{ fontSize: 16 }}>Student Comments</div>
                    <div className="admin-subtitle">Select one or more students and add notes for the day.</div>
                  </div>
                  <button className="btn" type="button" onClick={addDailyRecordCommentRow}>
                    Add Student
                  </button>
                </div>

                <div className="daily-record-comments-list">
                  {dailyRecordForm.comments.map((item, index) => (
                    <div key={item.tempId} className="daily-record-comment-row">
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
                      <div className="daily-record-comment-actions">
                        <button className="btn" type="button" onClick={() => removeDailyRecordCommentRow(item.tempId)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {dailyRecordsMsg ? <div className="admin-msg">{dailyRecordsMsg}</div> : null}

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="btn" onClick={closeDailyRecordModal} disabled={dailyRecordSaving}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={saveDailyRecord} disabled={dailyRecordSaving}>
                  {dailyRecordSaving ? "Saving..." : "Save Record"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {studentInfoOpen && selectedStudent ? (
          <div
            className="admin-modal-overlay"
            onClick={() => {
              if (studentInfoSaving) return;
              setStudentInfoOpen(false);
              setStudentInfoMsg("");
              setStudentInfoForm(getPersonalInfoForm(selectedStudent));
              setStudentInfoUploadFiles({});
            }}
          >
            <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Edit Personal Information</div>
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
                >
                  &times;
                </button>
              </div>

              <div className="admin-form student-info-form" style={{ marginTop: 10 }}>
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
                  <label>Phone Number</label>
                  <input
                    value={studentInfoForm.phone_number}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, phone_number: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>UID</label>
                  <input
                    value={studentInfoForm.student_code}
                    onChange={(e) => setStudentInfoForm((s) => ({ ...s, student_code: e.target.value }))}
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
        ) : null}

        {reissueOpen && reissueStudent ? (
          <div
            className="admin-modal-overlay"
            onClick={() => {
              setReissueOpen(false);
              setReissueStudent(null);
              setReissuePassword("");
              setReissueIssuedPassword("");
              setReissueLoading(false);
              setReissueMsg("");
            }}
          >
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Reissue Temp Password</div>
                <button
                  className="btn"
                  onClick={() => {
                    setReissueOpen(false);
                    setReissueStudent(null);
                    setReissuePassword("");
                    setReissueIssuedPassword("");
                    setReissueLoading(false);
                    setReissueMsg("");
                  }}
                >
                  Close
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

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
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
        ) : null}

        {inviteOpen ? (
          <div
            className="admin-modal-overlay"
            onClick={() => setInviteOpen(false)}
          >
            <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Add New Student</div>
                <button className="admin-modal-close" onClick={() => setInviteOpen(false)} aria-label="Close">
                  &times;
                </button>
              </div>
              <div className="admin-form" style={{ marginTop: 10 }}>
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
                <div className="field small">
                  <label>Code</label>
                  <input
                    value={inviteForm.student_code}
                    onChange={(e) => setInviteForm((s) => ({ ...s, student_code: e.target.value }))}
                    placeholder="ID001"
                  />
                </div>
                <div className="field small">
                  <label>Temp Password</label>
                  <input
                    value={inviteForm.temp_password}
                    onChange={(e) => setInviteForm((s) => ({ ...s, temp_password: e.target.value }))}
                    placeholder="(optional)"
                  />
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setInviteForm((s) => ({ ...s, temp_password: generateTempPassword() }))}
                  >
                    Generate
                  </button>
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
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
              {studentMsg ? <div className="admin-msg">{studentMsg}</div> : null}
              {inviteResults.length ? (
                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table" style={{ minWidth: 520 }}>
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
            </div>
          </div>
        ) : null}

        {attendanceModalOpen && attendanceModalDay ? (
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
                <div>
                  <div className="admin-title">Attendance — {attendanceModalDay.day_date}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setAttendanceModalOpen(false);
                    setAttendanceModalDay(null);
                    setAttendanceDraft({});
                    setAttendanceSaving(false);
                  }}
                >
                  Close
                </button>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10, maxHeight: "60vh" }}>
                <table className="admin-table attendance-modal-table">
                  <thead>
                    <tr>
                      <th>Code</th>
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
                <button className="btn btn-danger" onClick={() => deleteAttendanceDay(attendanceModalDay)}>
                  Delete Day
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {resultContext ? (
        <>
        {sessionDetail.type === resultContext.type && sessionDetail.sessionId ? (
          renderSessionDetailView()
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="admin-title">{resultContext.title}</div>
                  <div className="admin-subtitle">受験結果を検索・詳細表示・CSV出力できます。</div>
                </div>
                <div className="admin-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => runSearch(resultContext.type)}>Refresh</button>
                  <button className="btn" onClick={() => exportSummaryCsv(attempts)}>Export CSV (Summary)</button>
                  <button className="btn" onClick={() => exportDetailCsv(attempts)}>Export CSV (Detail)</button>
                  {resultContext.type === "mock" ? (
                    <button className="btn" onClick={() => exportQuizSummaryCsv()}>Export CSV (Quiz Summary)</button>
                  ) : null}
                </div>
              </div>
              {quizMsg ? <div className="admin-help">{quizMsg}</div> : null}
            </div>

            {resultContext.type === "daily" || resultContext.type === "mock" ? (
              <>
                {(resultContext.type === "daily" ? dailyCategories : modelCategories).length ? (
                  <div className="admin-mini-tabs" style={{ marginBottom: 10 }}>
                    {(resultContext.type === "daily" ? dailyCategories : modelCategories).map((c) => (
                      <button
                        key={`daily-cat-${c.name}`}
                        className={`admin-mini-tab ${((resultContext.type === "daily"
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
                ) : (
                  <div className="admin-msg">No test categories yet.</div>
                )}

                <div className="admin-table-wrap results-matrix-table-wrap" style={{ marginTop: 10 }}>
                  <table
                    className="admin-table daily-results-table"
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
                        <th className="daily-sticky-1 daily-col-no">Student ID</th>
                        <th className="daily-sticky-2 daily-col-name">Student Name</th>
                        {(resultContext.type === "daily" ? dailyResultsMatrix.sessions : modelResultsMatrix.sessions).map((sessionItem) => (
                          <th key={`daily-col-${sessionItem.id}`}>
                            <button
                              type="button"
                              className="session-column-link"
                              onClick={() => openSessionDetailView(sessionItem, resultContext.type)}
                            >
                              <div className="daily-col-title">{sessionItem.title ?? sessionItem.problem_set_id ?? ""}</div>
                              <div className="daily-col-subtitle">{sessionItem.problem_set_id ?? ""}</div>
                              <div className="daily-col-date">{formatDateShort(sessionItem.starts_at || sessionItem.created_at)}</div>
                            </button>
                          </th>
                        ))}
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
                            <div className="daily-code">{row.student.student_code ?? ""}</div>
                          </td>
                          {row.cells.map((attemptList, idx) => {
                            const sessionItem = (resultContext.type === "daily"
                              ? dailyResultsMatrix.sessions
                              : modelResultsMatrix.sessions)[idx];
                            if (!attemptList?.length) return <td key={`daily-cell-${row.student.id}-${idx}`}>—</td>;
                            const passRate = Number(sessionItem?.linkedTest?.pass_rate ?? 0);
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
                                        <span className="daily-score-main">
                                          {attempt.__isRetake ? <span className="daily-retake-icon">Re</span> : null}
                                          <span>{label}</span>
                                        </span>
                                        {tabLeftCount > 0 ? (
                                          <span className="daily-score-meta daily-score-meta-alert">
                                            Tabs left: {tabLeftCount}
                                          </span>
                                        ) : null}
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
                      <div className="admin-subtitle">テストを選ぶと結果を絞り込みます。</div>
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
                    <label>Student Code（部分一致）</label>
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
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Created</th>
                        <th>Name</th>
                        <th>Code</th>
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
                          <tr
                            key={a.id}
                            onClick={() => {
                              setSelectedId(a.id);
                              setSelectedAttemptObj(null);
                              setAttemptDetailOpen(true);
                            }}
                          >
                            <td>{formatDateTime(a.created_at)}</td>
                            <td>{a.display_name ?? ""}</td>
                            <td>{a.student_code ?? ""}</td>
                            <td>{score}</td>
                            <td>{rate}</td>
                            <td>{a.test_version ?? ""}</td>
                            <td style={{ whiteSpace: "nowrap" }}>{a.id}</td>
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
                }}
              >
                <div
                  className="admin-modal admin-modal-wide"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="admin-modal-header">
                    <div>
                      <div className="admin-title">Attempt Detail</div>
                      <div className="admin-help">
                        <b>{selectedAttempt.display_name ?? ""}</b> ({selectedAttempt.student_code ?? ""})
                        <br />
                        test: <b>{selectedAttempt.test_version ?? ""}</b>
                        <br />
                        created: {formatDateTime(selectedAttempt.created_at)}
                        <br />
                        tab left count: <b>{getTabLeftCount(selectedAttempt)}</b>
                      </div>
                    </div>
                    <button
                      className="admin-modal-close"
                      onClick={() => {
                        setAttemptDetailOpen(false);
                        setSelectedAttemptObj(null);
                      }}
                      aria-label="Close"
                    >
                      ×
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => exportSelectedAttemptCsv(selectedAttempt)}
                    >
                      Export CSV
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setAttemptDetailOpen(false);
                        setSelectedAttemptObj(null);
                      }}
                    >
                      Close
                    </button>
                  </div>
                  {attemptQuestionsLoading ? <div className="admin-help">Loading questions...</div> : null}
                  {attemptQuestionsError ? <div className="admin-msg">{attemptQuestionsError}</div> : null}

                  <div className="admin-top-tabs" style={{ marginBottom: 12 }}>
                    <button
                      className={`admin-top-tab ${attemptDetailTab === "overview" ? "active" : ""}`}
                      type="button"
                      onClick={() => setAttemptDetailTab("overview")}
                    >
                      Overview
                    </button>
                    <button
                      className={`admin-top-tab ${attemptDetailTab === "questions" ? "active" : ""}`}
                      type="button"
                      onClick={() => setAttemptDetailTab("questions")}
                    >
                      Individual Questions
                    </button>
                  </div>

                  {attemptDetailTab === "overview" ? (
                    <div className="attempt-detail-pane">
                      <div className="attempt-detail-stat-grid">
                        <div className="attempt-detail-stat-card">
                          <div className="attempt-detail-stat-label">Total Score</div>
                          <div className="attempt-detail-stat-value">{totalCorrect} / {totalQuestions}</div>
                          <div className="attempt-detail-stat-meta">{scorePercent}%</div>
                        </div>
                        <div className="attempt-detail-stat-card">
                          <div className="attempt-detail-stat-label">Result</div>
                          <div className="attempt-detail-stat-value">{selectedAttemptIsPass ? "Pass" : "Fail"}</div>
                          <div className="attempt-detail-stat-meta">Threshold {(selectedAttemptPassRate * 100).toFixed(0)}%</div>
                        </div>
                        <div className="attempt-detail-stat-card">
                          <div className="attempt-detail-stat-label">Created</div>
                          <div className="attempt-detail-stat-value">{formatDateTime(selectedAttempt.created_at)}</div>
                          <div className="attempt-detail-stat-meta">Attempt ID {selectedAttempt.id}</div>
                        </div>
                      </div>

                      {selectedAttemptIsModel && selectedAttemptMainSectionSummary.length ? (
                        <>
                          <div className="session-overview-grid">
                            <div className="session-radar-wrap">
                              {buildSectionRadarSvg(radarData)}
                            </div>
                            <div className="admin-table-wrap">
                              <table className="admin-table" style={{ minWidth: 460 }}>
                                <thead>
                                  <tr>
                                    <th>Area</th>
                                    <th>Unit</th>
                                    <th>Correct</th>
                                    <th>Total</th>
                                    <th>Rate</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {selectedAttemptNestedSectionSummary.map((group) => {
                                    const rowSpan = 1 + group.subSections.length;
                                    return (
                                      <Fragment key={`attempt-group-${group.mainSection}`}>
                                        <tr className="attempt-overview-total-row">
                                          <td rowSpan={rowSpan} className="attempt-overview-area-cell">
                                            <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                          </td>
                                          <td><b>Total</b></td>
                                          <td>{group.correct}</td>
                                          <td>{group.total}</td>
                                          <td>{(group.rate * 100).toFixed(1)}%</td>
                                        </tr>
                                        {group.subSections.map((subSection) => (
                                          <tr key={`attempt-sub-${group.mainSection}-${subSection.section}`}>
                                            <td>{subSection.section}</td>
                                            <td>{subSection.correct}</td>
                                            <td>{subSection.total}</td>
                                            <td>{(subSection.rate * 100).toFixed(1)}%</td>
                                          </tr>
                                        ))}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                          <div className="admin-help">
                            Main section totals are shown with their sub-section breakdown underneath.
                          </div>
                        </>
                      ) : (
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
                      )}
                    </div>
                  ) : (
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
                  )}
                </div>
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
}
