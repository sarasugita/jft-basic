"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { recordAdminAuditEvent } from "../lib/adminAudit";
import { getBangladeshDateInput } from "../lib/adminFormatters";

// Constants - Irodori textbook and lessons
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
const DAILY_RECORD_COMMENT_FIELDS = "id, student_id, comment, profiles(display_name, student_code)";

// Helper functions for Irodori data structures
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

// Helper function definitions
function isDefaultDailyRecordHoliday(dateString) {
  if (!dateString) return false;
  const weekday = new Date(`${dateString}T00:00:00`).toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
  });
  return weekday === "Fri" || weekday === "Sat";
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
    comments: [createDailyRecordCommentRow("")],
    mini_test_1: "",
    mini_test_2: "",
    special_test_1: "",
    special_test_2: "",
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
    mini_test_1: record.mini_test_1 ?? "",
    mini_test_2: record.mini_test_2 ?? "",
    special_test_1: record.special_test_1 ?? "",
    special_test_2: record.special_test_2 ?? "",
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

function isMissingColumnError(error, columnName) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return new RegExp(`"${columnName}"|column.*"${columnName}"`, 'i').test(text) && /does not exist|is not found/i.test(text);
}

function parseSyllabusAnnouncementDate(title) {
  const match = title.match(/Exam Schedule \((\d{4}-\d{2}-\d{2})\)/);
  return match ? match[1] : null;
}

function getTodayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, offsetDays) {
  const base = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateString;
  base.setDate(base.getDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

function getWeekdayNumber(dateString) {
  return new Date(dateString).getDay();
}

function getWeekdayLong(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "long",
  });
}

function getSessionScheduleSource(session) {
  return session?.starts_at || session?.ends_at || session?.created_at || "";
}

function getSessionDisplayTitle(session, testsList) {
  const explicitTitle = String(session?.title ?? "").trim();
  if (explicitTitle) return explicitTitle;
  const matchingTest = (testsList ?? []).find((test) => test.version === session?.problem_set_id);
  return matchingTest?.title || session?.problem_set_id || "-";
}

function getEmptyScheduledTests() {
  return {
    dailyTests: [],
    modelTests: [],
  };
}

// Main hook
export function useDailyRecordWorkspaceState({ supabase, activeSchoolId, session, testSessions = [], tests = [] }) {
  const activeSchoolIdRef = useRef(activeSchoolId);
  useEffect(() => {
    activeSchoolIdRef.current = activeSchoolId;
  }, [activeSchoolId]);

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

  const testMetaByVersion = useMemo(() => {
    const meta = {};
    (tests ?? []).forEach((test) => {
      if (test.version) {
        meta[test.version] = { type: test.type };
      }
    });
    return meta;
  }, [tests]);

  async function fetchDailyRecords() {
    if (!supabase) {
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordSyllabusAnnouncements([]);
      setDailyRecordConfirmedDates([]);
      setDailyRecordHolidaySavingDate("");
      setDailyRecordsMsg("Loading...");
      return;
    }
    const schoolIdSnapshot = activeSchoolIdRef.current;
    if (!schoolIdSnapshot) {
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
      .eq("school_id", schoolIdSnapshot)
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
        .eq("school_id", schoolIdSnapshot)
        .order("record_date", { ascending: false })
        .limit(180);
    }
    const { data, error } = result;
    if (schoolIdSnapshot !== activeSchoolIdRef.current) {
      setDailyRecordsMsg("");
      return;
    }
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
      .eq("school_id", schoolIdSnapshot)
      .like("title", "Exam Schedule (%)")
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
        .like("title", "Exam Schedule (%)")
        .is("end_at", null);
      if (closePrevError) {
        console.error("daily record announcement close previous error:", closePrevError);
        const failureMessage = `Record saved, but the previous exam schedule announcement could not be closed: ${closePrevError.message}`;
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
      const existingAnnouncement = (dailyRecordSyllabusAnnouncements ?? []).find(
        (a) => parseSyllabusAnnouncementDate(a.title) === dailyRecordForm.record_date && !a.end_at
      );
      if (!existingAnnouncement?.id) {
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
        .eq("id", existingAnnouncement.id);
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
    await recordAdminAuditEvent(supabase, {
      actionType: dailyRecordForm.id ? "update" : "create",
      entityType: "daily_record",
      entityId: recordId,
      summary: `Saved daily record for ${dailyRecordForm.record_date}${announcementAction === "send" ? " and sent syllabus announcement" : announcementAction === "edit" ? " and updated syllabus announcement" : ""}.`,
      metadata: {
        record_date: dailyRecordForm.record_date,
        comment_count: commentsPayload.length,
        announcement_action: announcementAction || null,
      },
      schoolId: activeSchoolId,
    });
    await fetchDailyRecords();
  }

  async function saveDailyRecordPlan(recordDate) {
    if (!activeSchoolId || !recordDate) return;
    setDailyRecordPlanSavingDate(recordDate);
    setDailyRecordsMsg("");
    const scheduledTests = scheduleRecordActualTestsByDate[recordDate] ?? getEmptyScheduledTests();
    const draft = {
      ...getEmptyDailyRecordPlanDraft(),
      ...(dailyRecordPlanDrafts[recordDate] ?? {}),
      mini_test_1: (dailyRecordPlanDrafts[recordDate]?.mini_test_1 ?? "").trim() || scheduledTests.dailyTests[0] || "",
      mini_test_2: (dailyRecordPlanDrafts[recordDate]?.mini_test_2 ?? "").trim() || scheduledTests.dailyTests[1] || "",
      special_test_1: (dailyRecordPlanDrafts[recordDate]?.special_test_1 ?? "").trim() || scheduledTests.modelTests[0] || "",
      special_test_2: (dailyRecordPlanDrafts[recordDate]?.special_test_2 ?? "").trim() || scheduledTests.modelTests[1] || "",
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
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordHolidaySavingDate("");
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
        console.error("daily record holiday insert error:", error);
        setDailyRecordsMsg(`Save failed: ${error.message}`);
        setDailyRecordHolidaySavingDate("");
        return;
      }
    }
    setDailyRecordHolidaySavingDate("");
    setDailyRecordsMsg(`Holiday flag updated for ${recordDate}.`);
    await fetchDailyRecords();
  }

  // Memos for calendar and scheduling
  const scheduleRecordRows = useMemo(() => {
    const targetDateStr = dailyRecordForm.record_date || getTodayDateInput();
    const targetDate = new Date(targetDateStr);
    const fromDateStr = addDays(targetDateStr, -60);
    const toDateStr = addDays(targetDateStr, 60);
    const rows = [];
    for (let dt = new Date(fromDateStr); dt <= new Date(toDateStr); dt.setDate(dt.getDate() + 1)) {
      const recordDate = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      const record = (dailyRecords ?? []).find((item) => item.record_date === recordDate) ?? null;
      rows.push({
        recordDate,
        record,
        draft: {
          ...getEmptyDailyRecordPlanDraft(),
          ...(dailyRecordPlanDrafts[recordDate] ?? {}),
        }
      });
    }
    return rows;
  }, [dailyRecords, dailyRecordPlanDrafts, dailyRecordForm.record_date]);

  const scheduleRecordDateRange = useMemo(() => {
    const targetDateStr = dailyRecordForm.record_date || getTodayDateInput();
    const fromDateStr = addDays(targetDateStr, -60);
    const toDateStr = addDays(targetDateStr, 60);
    const dates = [];
    for (let dt = new Date(fromDateStr); dt <= new Date(toDateStr); dt.setDate(dt.getDate() + 1)) {
      dates.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
    }
    return dates;
  }, [dailyRecordForm.record_date]);

  const scheduleRecordActualTestsByDate = useMemo(() => {
    const byDate = {};
    (testSessions ?? []).forEach((session) => {
      if (session?.retake_source_session_id) return;
      const date = getBangladeshDateInput(getSessionScheduleSource(session));
      if (!date) return;
      if (!byDate[date]) {
        byDate[date] = {
          dailyTests: [],
          modelTests: [],
        };
      }
      const nextBucket = testMetaByVersion?.[session.problem_set_id]?.type === "mock"
        ? byDate[date].modelTests
        : byDate[date].dailyTests;
      nextBucket.push({
        id: session.id || `${date}-${session.problem_set_id || "session"}`,
        title: getSessionDisplayTitle(session, tests),
        sortValue: new Date(getSessionScheduleSource(session)).getTime(),
      });
    });

    return Object.fromEntries(
      Object.entries(byDate).map(([date, groupedTests]) => [
        date,
        {
          dailyTests: groupedTests.dailyTests
            .sort((a, b) => a.sortValue - b.sortValue)
            .map((item) => item.title),
          modelTests: groupedTests.modelTests
            .sort((a, b) => a.sortValue - b.sortValue)
            .map((item) => item.title),
        },
      ])
    );
  }, [testSessions, testMetaByVersion, tests]);

  const dailyRecordHolidayByDate = useMemo(() => {
    return Object.fromEntries(
      (dailyRecords ?? [])
        .filter((record) => record?.record_date)
        .map((record) => [record.record_date, record?.is_holiday])
    );
  }, [dailyRecords]);

  const scheduleRecordDisplayByDate = useMemo(() => {
    const todayBangladesh = getBangladeshDateInput(new Date());
    const confirmedSet = new Set(dailyRecordConfirmedDates);
    const recordByDate = Object.fromEntries((dailyRecords ?? []).filter((record) => record?.record_date).map((record) => [record.record_date, record]));
    const displayData = {};
    scheduleRecordRows.forEach(({ recordDate, draft }) => {
      const record = recordByDate[recordDate];
      const scheduledTests = scheduleRecordActualTestsByDate[recordDate] ?? getEmptyScheduledTests();
      const lockedMiniTest1 = Boolean(scheduledTests.dailyTests[0]);
      const lockedMiniTest2 = Boolean(scheduledTests.dailyTests[1]);
      const lockedSpecialTest1 = Boolean(scheduledTests.modelTests[0]);
      const lockedSpecialTest2 = Boolean(scheduledTests.modelTests[1]);
      const isFullyLocked = lockedMiniTest1 && lockedMiniTest2 && lockedSpecialTest1 && lockedSpecialTest2;
      displayData[recordDate] = {
        hasRecord: Boolean(record),
        isPastDate: Boolean(todayBangladesh && recordDate < todayBangladesh),
        isConfirmed: confirmedSet.has(recordDate),
        isFullyLocked,
        isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
        mini_test_1: draft.mini_test_1 || scheduledTests.dailyTests[0] || "",
        mini_test_2: draft.mini_test_2 || scheduledTests.dailyTests[1] || "",
        special_test_1: draft.special_test_1 || scheduledTests.modelTests[0] || "",
        special_test_2: draft.special_test_2 || scheduledTests.modelTests[1] || "",
        lockedMiniTest1,
        lockedMiniTest2,
        lockedSpecialTest1,
        lockedSpecialTest2,
      };
    });
    return displayData;
  }, [dailyRecordConfirmedDates, dailyRecords, scheduleRecordActualTestsByDate, scheduleRecordRows]);

  useEffect(() => {
    if (!scheduleRecordDateRange.length) return;
    setDailyRecordPlanDrafts((prev) => {
      let changed = false;
      const next = { ...prev };

      scheduleRecordDateRange.forEach((recordDate) => {
        const scheduledTests = scheduleRecordActualTestsByDate[recordDate];
        if (!scheduledTests) return;

        const currentDraft = next[recordDate] ?? getEmptyDailyRecordPlanDraft();
        const mergedDraft = {
          ...getEmptyDailyRecordPlanDraft(),
          ...currentDraft,
        };

        let draftChanged = false;
        if (!(mergedDraft.mini_test_1 || "").trim() && scheduledTests.dailyTests[0]) {
          mergedDraft.mini_test_1 = scheduledTests.dailyTests[0];
          draftChanged = true;
        }
        if (!(mergedDraft.mini_test_2 || "").trim() && scheduledTests.dailyTests[1]) {
          mergedDraft.mini_test_2 = scheduledTests.dailyTests[1];
          draftChanged = true;
        }
        if (!(mergedDraft.special_test_1 || "").trim() && scheduledTests.modelTests[0]) {
          mergedDraft.special_test_1 = scheduledTests.modelTests[0];
          draftChanged = true;
        }
        if (!(mergedDraft.special_test_2 || "").trim() && scheduledTests.modelTests[1]) {
          mergedDraft.special_test_2 = scheduledTests.modelTests[1];
          draftChanged = true;
        }

        if (draftChanged) {
          next[recordDate] = mergedDraft;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [scheduleRecordActualTestsByDate, scheduleRecordDateRange]);

  const dailyRecordSelectableDates = useMemo(() => {
    return scheduleRecordRows
      .filter(({ recordDate }) => !resolveDailyRecordHoliday(recordDate, dailyRecords.find((r) => r.record_date === recordDate)?.is_holiday))
      .map(({ recordDate }) => recordDate);
  }, [scheduleRecordRows, dailyRecords]);

  const dailyRecordSelectableDateSet = useMemo(
    () => new Set(dailyRecordSelectableDates),
    [dailyRecordSelectableDates]
  );

  const dailyRecordCalendarMonths = useMemo(() => {
    if (!scheduleRecordRows.length) return [];

    // Build a map of recordDate -> record data for quick lookup
    const recordMap = new Map();
    scheduleRecordRows.forEach(({ recordDate, record }) => {
      recordMap.set(recordDate, record);
    });

    // Get unique months from scheduleRecordRows
    const monthKeys = Array.from(new Set(scheduleRecordRows.map(({ recordDate }) => recordDate.slice(0, 7)))).sort();

    return monthKeys.map((monthKey) => {
      const [year, month] = monthKey.split("-");
      const yearNum = Number(year);
      const monthNum = Number(month);

      // Create label for the month
      const date = new Date(yearNum, monthNum - 1, 1);
      const label = date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "long" });

      // Build the calendar weeks properly
      const weeks = [];
      const firstDay = new Date(yearNum, monthNum - 1, 1);
      const lastDay = new Date(yearNum, monthNum, 0);
      const startDayOfWeek = firstDay.getDay(); // 0=Sunday, 6=Saturday

      // Add days from previous month
      const prevMonthLastDay = new Date(yearNum, monthNum - 1, 0).getDate();
      let currentWeek = [];

      // Fill in previous month's trailing days
      for (let i = startDayOfWeek - 1; i >= 0; i--) {
        const prevMonthDate = prevMonthLastDay - i;
        const prevMonthKey = monthNum === 1 ? `${yearNum - 1}-12` : `${yearNum}-${String(monthNum - 1).padStart(2, "0")}`;
        const prevMonthDateStr = `${prevMonthKey}-${String(prevMonthDate).padStart(2, "0")}`;
        currentWeek.push({
          recordDate: null,
          dayNumber: prevMonthDate,
          isFromOtherMonth: true,
          isHoliday: false,
          isSelectable: false,
        });
      }

      // Fill in current month's days
      for (let day = 1; day <= lastDay.getDate(); day++) {
        const recordDate = `${monthKey}-${String(day).padStart(2, "0")}`;
        const record = recordMap.get(recordDate);

        currentWeek.push({
          recordDate,
          dayNumber: day,
          isFromOtherMonth: false,
          isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
          isSelectable: dailyRecordSelectableDateSet.has(recordDate),
        });

        // If week is full (7 days), push to weeks array and start new week
        if (currentWeek.length === 7) {
          weeks.push(currentWeek);
          currentWeek = [];
        }
      }

      // Fill in next month's leading days
      if (currentWeek.length > 0) {
        for (let day = 1; currentWeek.length < 7; day++) {
          const nextMonthKey = monthNum === 12 ? `${yearNum + 1}-01` : `${yearNum}-${String(monthNum + 1).padStart(2, "0")}`;
          currentWeek.push({
            recordDate: null,
            dayNumber: day,
            isFromOtherMonth: true,
            isHoliday: false,
            isSelectable: false,
          });
        }
        weeks.push(currentWeek);
      }

      return {
        monthKey,
        label,
        weeks,
      };
    });
  }, [scheduleRecordRows, dailyRecordSelectableDateSet]);

  const dailyRecordCalendarMonthKeys = useMemo(
    () => dailyRecordCalendarMonths.map((month) => month.monthKey),
    [dailyRecordCalendarMonths]
  );

  const dailyRecordActiveCalendarMonth = useMemo(() => {
    return dailyRecordCalendarMonths.find((month) => month.monthKey === dailyRecordCalendarMonth)
      ?? dailyRecordCalendarMonths[0];
  }, [dailyRecordCalendarMonth, dailyRecordCalendarMonths]);

  const dailyRecordTodaySessions = useMemo(() => {
    const recordDate = dailyRecordForm.record_date || getTodayDateInput();

    const sessionsForDate = (testSessions ?? [])
      .filter((session) => {
        return getBangladeshDateInput(getSessionScheduleSource(session)) === recordDate;
      })
      .sort((a, b) => {
        const aTime = new Date(getSessionScheduleSource(a)).getTime();
        const bTime = new Date(getSessionScheduleSource(b)).getTime();
        return aTime - bTime;
      });

    const dailyTests = [];
    const modelTests = [];

    for (const session of sessionsForDate) {
      const testMeta = (testMetaByVersion || {})[session.problem_set_id];
      if (testMeta?.type === "daily") {
        dailyTests.push(getSessionDisplayTitle(session, tests));
      } else if (testMeta?.type === "mock") {
        modelTests.push(getSessionDisplayTitle(session, tests));
      } else {
        dailyTests.push(getSessionDisplayTitle(session, tests));
      }
    }

    return { dailyTests, modelTests };
  }, [dailyRecordForm.record_date, testSessions, testMetaByVersion, tests]);

  const dailyRecordTomorrowSessions = useMemo(() => {
    const recordDate = dailyRecordForm.record_date || getTodayDateInput();
    const nextDay = addDays(recordDate, 1);
    let targetDate = nextDay;

    while (resolveDailyRecordHoliday(targetDate, dailyRecordHolidayByDate[targetDate])) {
      const nextDate = addDays(targetDate, 1);
      if (nextDate === targetDate) break;
      targetDate = nextDate;
    }

    const sessionsForDate = (testSessions ?? []).filter((session) => getBangladeshDateInput(getSessionScheduleSource(session)) === targetDate);
    const label = targetDate === nextDay ? "Tomorrow's Exams" : `${getWeekdayLong(targetDate)}'s Exams`;

    return {
      targetDate,
      label,
      regular: sessionsForDate.filter((s) => !s.retake_source_session_id),
      retake: sessionsForDate.filter((s) => s.retake_source_session_id),
    };
  }, [dailyRecordForm.record_date, dailyRecordHolidayByDate, testSessions]);

  useEffect(() => {
    if (!dailyRecordTodaySessions || (!dailyRecordTodaySessions.dailyTests?.length && !dailyRecordTodaySessions.modelTests?.length)) {
      return;
    }

    setDailyRecordForm((prev) => {
      const updated = { ...prev };
      let changed = false;

      // Fill daily test columns (mini_test_1, mini_test_2)
      if (!(updated.mini_test_1 || "").trim() && dailyRecordTodaySessions.dailyTests?.[0]) {
        updated.mini_test_1 = dailyRecordTodaySessions.dailyTests[0];
        changed = true;
      }
      if (!(updated.mini_test_2 || "").trim() && dailyRecordTodaySessions.dailyTests?.[1]) {
        updated.mini_test_2 = dailyRecordTodaySessions.dailyTests[1];
        changed = true;
      }

      // Fill model test columns (special_test_1, special_test_2)
      if (!(updated.special_test_1 || "").trim() && dailyRecordTodaySessions.modelTests?.[0]) {
        updated.special_test_1 = dailyRecordTodaySessions.modelTests[0];
        changed = true;
      }
      if (!(updated.special_test_2 || "").trim() && dailyRecordTodaySessions.modelTests?.[1]) {
        updated.special_test_2 = dailyRecordTodaySessions.modelTests[1];
        changed = true;
      }

      return changed ? updated : prev;
    });
  }, [dailyRecordTodaySessions, dailyRecordForm.mini_test_1, dailyRecordForm.mini_test_2, dailyRecordForm.special_test_1, dailyRecordForm.special_test_2]);

  // Effects for date/calendar sync
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
    function handleClickOutside(event) {
      if (!dailyRecordDatePickerRef.current?.contains(event.target)) {
        setDailyRecordDatePickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dailyRecordDatePickerOpen]);

  return {
    dailyRecords,
    dailyRecordsMsg,
    dailyRecordDate,
    setDailyRecordDate,
    dailyRecordDatePickerOpen,
    setDailyRecordDatePickerOpen,
    dailyRecordDatePickerRef,
    dailyRecordCalendarMonth,
    setDailyRecordCalendarMonth,
    dailyRecordModalOpen,
    setDailyRecordModalOpen,
    dailyRecordSaving,
    dailyRecordForm,
    setDailyRecordForm,
    dailyRecordAnnouncementTitleDraft,
    setDailyRecordAnnouncementTitleDraft,
    dailyRecordAnnouncementDraft,
    setDailyRecordAnnouncementDraft,
    dailyRecordSyllabusAnnouncements,
    dailyRecordPlanDrafts,
    dailyRecordConfirmedDates,
    dailyRecordPlanSavingDate,
    dailyRecordHolidaySavingDate,
    dailyRecordTableWrapRef,
    scheduleRecordRows,
    scheduleRecordActualTestsByDate,
    scheduleRecordDisplayByDate,
    dailyRecordSelectableDates,
    dailyRecordCalendarMonthKeys,
    dailyRecordActiveCalendarMonth,
    dailyRecordTomorrowSessions,
    fetchDailyRecords,
    openDailyRecordModal,
    closeDailyRecordModal,
    updateDailyRecordPlanDraft,
    updateDailyRecordComment,
    updateDailyRecordTextbookEntry,
    toggleDailyRecordCanDo,
    addDailyRecordTextbookEntry,
    removeDailyRecordTextbookEntry,
    addDailyRecordCommentRow,
    removeDailyRecordCommentRow,
    saveDailyRecord,
    saveDailyRecordPlan,
    saveDailyRecordHoliday,
    resolveDailyRecordHoliday,
    summarizeDailyRecordContent,
    summarizeDailyRecordComments,
  };
}
