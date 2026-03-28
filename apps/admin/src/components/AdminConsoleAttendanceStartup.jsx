"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createAdminTrace, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import AdminConsoleAttendanceWorkspace from "./AdminConsoleAttendanceWorkspace";
import { AdminConsoleWorkspaceProvider } from "./AdminConsoleWorkspaceContext";

const STUDENT_SELECT_FIELDS = [
  "id",
  "email",
  "display_name",
  "student_code",
  "phone_number",
  "created_at",
  "is_withdrawn",
  "is_test_account",
  "section",
  "class_section",
  "group",
  "batch",
].join(", ");

const ATTENDANCE_EXPORT_RULES = [
  "1. If you skip the class without any notification for 3 times, you will be eliminated.",
  "2. If you skip classes, please practice that part by yourself. We don't conduct the same class again for you.",
  "3. If your attendance rate is less than 75%, we will ask you if you would like to continue or quit. If you don't have a strong will to continue, you will be eliminated.",
  "4. We will call you one by one if you are absent without any reason.",
];
const ATTENDANCE_COUNTED_STATUSES = ["P", "L", "E", "A"];
const ATTENDANCE_SUPPORTED_STATUSES = [...ATTENDANCE_COUNTED_STATUSES, "N/A", "W"];
const ADMIN_SUPABASE_CONFIG_ERROR = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

function toCsv(rows) {
  const escapeCell = (value) => {
    const text = String(value ?? "");
    if (/[,"\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  };
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function padCsvRow(row, length) {
  const next = [...(row ?? [])];
  while (next.length < length) next.push("");
  return next;
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

function formatDateShort(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[2]}/${match[3]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateFull(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

function formatWeekday(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "short" });
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
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  return `${Number(match[2])}/${Number(match[3])}`;
}

function formatBooleanCsv(value) {
  return value ? "TRUE" : "FALSE";
}

function getTodayDateInput() {
  const today = new Date();
  if (Number.isNaN(today.getTime())) return "";
  return today.toISOString().slice(0, 10);
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

function parseSlashDateShortYearToIso(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const compact = text.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?$/i, "");
  let match = compact.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const rawYear = Number(match[3]);
    const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  match = compact.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
      if (dayDate) dayColumns.push({ colIndex: col, dayDate });
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

function getStudentSectionValue(student) {
  return String(student?.section ?? student?.class_section ?? student?.group ?? student?.batch ?? "").trim();
}

function getStudentDisplayName(student) {
  return student?.display_name ?? student?.email ?? student?.id ?? "";
}

function createImportedStudentMatcher(studentsList) {
  const students = Array.isArray(studentsList) ? studentsList : [];
  const emailMap = new Map();
  const nameSectionMap = new Map();

  students.forEach((student) => {
    const emailKey = normalizeLookupValue(student?.email);
    if (emailKey) emailMap.set(emailKey, student);
    const nameSectionKey = `${normalizeLookupValue(student?.display_name)}::${normalizeLookupValue(getStudentSectionValue(student))}`;
    if (!nameSectionMap.has(nameSectionKey)) nameSectionMap.set(nameSectionKey, []);
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

    if (normalizedEmail && emailMap.has(normalizedEmail)) return emailMap.get(normalizedEmail);
    return fallbackMatch({ rowNumber, name, section, email });
  };
}

function parseSeparatedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        index += 1;
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
  return rows.filter((nextRow) => nextRow.some((cell) => String(cell ?? "").trim().length));
}

function detectDelimiter(text) {
  const firstLine = String(text ?? "").split(/\r?\n/)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function normalizeCsvValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toUpperCase() === "N/A") return "";
  return raw;
}

function isAnalyticsExcludedStudent(student) {
  return Boolean(student?.is_withdrawn || student?.is_test_account);
}

export default function AdminConsoleAttendanceStartup({
  activeSchoolId,
  initialAttendanceSubTab = "sheet",
  onSelectAttendanceSubTab = null,
  onOpenFullConsole = null,
}) {
  const renderTraceLoggedRef = useRef(false);
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const supabaseRef = useRef(null);
  const attendanceImportInputRef = useRef(null);
  const attendanceImportChoiceResolverRef = useRef(null);
  const [attendanceSubTab, setAttendanceSubTab] = useState(initialAttendanceSubTab);
  const [students, setStudents] = useState([]);
  const [attendanceDays, setAttendanceDays] = useState([]);
  const [attendanceEntries, setAttendanceEntries] = useState({});
  const [attendanceMsg, setAttendanceMsg] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => getTodayDateInput());
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [attendanceModalDay, setAttendanceModalDay] = useState(null);
  const [attendanceDraft, setAttendanceDraft] = useState({});
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceClearing, setAttendanceClearing] = useState(false);
  const [attendanceImportConflict, setAttendanceImportConflict] = useState(null);
  const [attendanceImportStatus, setAttendanceImportStatus] = useState(null);
  const [approvedAbsenceByStudent, setApprovedAbsenceByStudent] = useState({});
  const [attendanceFilter, setAttendanceFilter] = useState({
    minRate: "",
    minAbsences: "",
    startDate: "",
    endDate: "",
  });
  const [absenceApplications, setAbsenceApplications] = useState([]);
  const [absenceApplicationsMsg, setAbsenceApplicationsMsg] = useState("");

  useEffect(() => {
    supabaseRef.current = null;
  }, [activeSchoolId]);

  const getSupabaseClient = useCallback(async () => {
    if (supabaseConfigError) {
      throw new Error(supabaseConfigError);
    }
    if (!activeSchoolId) {
      throw new Error("Select a school.");
    }
    if (supabaseRef.current) {
      return supabaseRef.current;
    }
    const { createAdminSupabaseClient } = await import("../lib/adminSupabase");
    const client = createAdminSupabaseClient({ schoolScopeId: activeSchoolId });
    supabaseRef.current = client;
    return client;
  }, [activeSchoolId, supabaseConfigError]);

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console attendance startup render start", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console attendance startup first commit", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }, [activeSchoolId, supabaseConfigError]);

  useEffect(() => {
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    setAttendanceSaving(false);
    setAttendanceImportConflict(null);
    setAttendanceImportStatus(null);
    setApprovedAbsenceByStudent({});
  }, [activeSchoolId]);

  useEffect(() => {
    setAttendanceSubTab(initialAttendanceSubTab === "absence" ? "absence" : "sheet");
  }, [initialAttendanceSubTab]);

  const sortedStudents = useMemo(
    () => [...students].sort((left, right) => String(left.student_code ?? "").localeCompare(String(right.student_code ?? "")) || String(left.display_name ?? "").localeCompare(String(right.display_name ?? ""))),
    [students]
  );

  const activeStudents = useMemo(
    () => sortedStudents.filter((student) => !student.is_withdrawn),
    [sortedStudents]
  );

  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);

  const attendanceDayColumns = useMemo(() => {
    return attendanceDays.map((day) => ({
      ...day,
      label: `${formatDateShort(day.day_date)} (${formatWeekday(day.day_date)})`,
    }));
  }, [attendanceDays]);

  const attendanceRangeColumns = useMemo(() => {
    const start = attendanceFilter.startDate;
    const end = attendanceFilter.endDate;
    if (!start && !end) return attendanceDayColumns;
    return attendanceDayColumns.filter((day) => {
      if (start && day.day_date < start) return false;
      if (end && day.day_date > end) return false;
      return true;
    });
  }, [attendanceDayColumns, attendanceFilter.endDate, attendanceFilter.startDate]);

  const attendanceFilteredStudents = useMemo(() => {
    const minRate = attendanceFilter.minRate === "" ? null : Number(attendanceFilter.minRate);
    const minAbsences = attendanceFilter.minAbsences === "" ? null : Number(attendanceFilter.minAbsences);
    return activeStudents.filter((student) => {
      const perDay = attendanceRangeColumns.map((day) => attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "");
      const stats = buildAttendanceStats(perDay);
      const rate = stats.total ? (stats.present / stats.total) * 100 : 0;
      if (minRate != null && rate >= minRate) return false;
      if (minAbsences != null && stats.unexcused < minAbsences) return false;
      return true;
    });
  }, [activeStudents, attendanceEntriesByDay, attendanceFilter, attendanceRangeColumns]);

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

  async function fetchStudents() {
    if (supabaseConfigError) {
      setStudents([]);
      return [];
    }
    if (!activeSchoolId) {
      setStudents([]);
      return [];
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch {
      setStudents([]);
      return [];
    }
    const { data, error } = await supabase
      .from("profiles")
      .select(STUDENT_SELECT_FIELDS)
      .eq("role", "student")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false });
    if (error) {
      setStudents([]);
      return [];
    }
    const list = data ?? [];
    setStudents(list);
    return list;
  }

  async function fetchAttendanceEntries(dayIds, supabaseClient = null) {
    if (!dayIds?.length) {
      setAttendanceEntries({});
      return;
    }
    let supabase = supabaseClient;
    if (!supabase) {
      try {
        supabase = await getSupabaseClient();
      } catch (error) {
        setAttendanceEntries({});
        setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
        return;
      }
    }
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, student_id, status, comment")
      .in("day_id", dayIds);
    if (error) {
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
        comment: row.comment ?? "",
      };
    });
    setAttendanceEntries(map);
  }

  async function fetchAttendanceDays() {
    if (!activeSchoolId) {
      setAttendanceDays([]);
      setAttendanceEntries({});
      setAttendanceMsg("");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceDays([]);
      setAttendanceEntries({});
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    setAttendanceMsg("Loading attendance...");
    const { data, error } = await supabase
      .from("attendance_days")
      .select("id, day_date, created_at")
      .eq("school_id", activeSchoolId)
      .order("day_date", { ascending: true })
      .limit(60);
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
      await fetchAttendanceEntries(list.map((day) => day.id), supabase);
    } else {
      setAttendanceEntries({});
    }
  }

  async function fetchAbsenceApplications() {
    if (!activeSchoolId) {
      setAbsenceApplications([]);
      setAbsenceApplicationsMsg("");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAbsenceApplications([]);
      setAbsenceApplicationsMsg(error instanceof Error ? error.message : "Failed to load school context.");
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
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAbsenceApplicationsMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const { error } = await supabase
      .from("absence_applications")
      .update({
        status: nextStatus,
        decided_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) {
      console.error("absence application update error:", error);
      setAbsenceApplicationsMsg(`Update failed: ${error.message}`);
      return;
    }
    await fetchAbsenceApplications();
  }

  async function openAttendanceDay(dayDate, options = {}) {
    if (!dayDate) return;
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const existingDay = attendanceDays.find((day) => day.day_date === dayDate) ?? null;
    if (existingDay && options.confirmExisting) {
      const shouldEditExisting = window.confirm(`Attendance for ${dayDate} already exists. Edit it?`);
      if (!shouldEditExisting) return;
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
      const approvedMap = {};
      (approvedApps ?? []).forEach((item) => {
        approvedMap[item.student_id] = item;
      });
      setApprovedAbsenceByStudent(approvedMap);
    }
    setAttendanceModalDay(day);
    const existing = day.id ? (attendanceEntriesByDay[day.id] ?? {}) : {};
    const draft = {};
    activeStudents.forEach((student) => {
      const entry = existing[student.id] || {};
      draft[student.id] = {
        status: entry.status || "P",
        comment: entry.comment || "",
      };
    });
    setAttendanceDraft(draft);
  }

  async function saveAttendanceDay() {
    if (!attendanceModalDay?.day_date) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
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
      .map(([studentId, value]) => ({
        day_id: dayId,
        student_id: studentId,
        status: value.status,
        comment: value.comment?.trim() || null,
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
    await fetchAttendanceDays();
  }

  async function deleteAttendanceDay(day) {
    if (!day?.id) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
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
    await fetchAttendanceDays();
  }

  async function clearAllAttendanceValues() {
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const ok = window.confirm("Clear all attendance data for this school? This will remove all attendance day columns and every saved attendance value.");
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
        const { error: deleteEntriesError } = await supabase
          .from("attendance_entries")
          .delete()
          .in("day_id", chunk);
        if (deleteEntriesError) throw deleteEntriesError;
      }
      for (let index = 0; index < dayIds.length; index += 200) {
        const chunk = dayIds.slice(index, index + 200);
        const { error: deleteDaysError } = await supabase
          .from("attendance_days")
          .delete()
          .in("id", chunk)
          .eq("school_id", activeSchoolId);
        if (deleteDaysError) throw deleteDaysError;
      }
      setAttendanceModalOpen(false);
      setAttendanceModalDay(null);
      setAttendanceDraft({});
      setAttendanceSaving(false);
      setAttendanceMsg("Cleared all attendance data.");
      await fetchAttendanceDays();
    } catch (error) {
      console.error("clear attendance values error:", error);
      setAttendanceMsg(`Clear failed: ${error?.message || error}`);
    } finally {
      setAttendanceClearing(false);
    }
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
      padCsvRow(["", "vb/w", "Student Name", "Section", "Phone Number", "Email Address", "Attendance Rate", rangeHeaderLabel, "Unexcused Absence", "Withdrawn", ...exportColumns.map((day) => formatSlashDateShortYear(day.day_date))], totalColumns),
      padCsvRow(["", "", "", "", "", "", "", "", "", "", ...exportColumns.map((day) => formatWeekday(day.day_date))], totalColumns),
      padCsvRow(["", "", "", "", "", "", "", "", "", "", ...exportColumns.map((day) => {
        const statuses = sortedStudents
          .filter((student) => !isAnalyticsExcludedStudent(student))
          .map((student) => attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "")
          .filter((status) => status && status !== "W");
        const stats = buildAttendanceStats(statuses);
        return stats.rate == null ? "N/A" : formatRatePercent(stats.rate);
      })], totalColumns),
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
        padCsvRow([
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
        ], totalColumns)
      );
    });

    csvRows.push(new Array(totalColumns).fill(""));
    csvRows.push(padCsvRow(["", "Rule"], totalColumns));
    ATTENDANCE_EXPORT_RULES.forEach((rule) => {
      csvRows.push(padCsvRow(["", rule], totalColumns));
    });
    downloadText(`attendance_google_sheets_${Date.now()}.csv`, toCsv(csvRows), "text/csv");
  }

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

  const closeAttendanceImportStatus = useCallback(() => {
    setAttendanceImportStatus((current) => (current?.loading ? current : null));
  }, []);

  async function importAttendanceGoogleSheetsCsv(file) {
    if (!file) return;
    if (!activeSchoolId) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAttendanceMsg(error instanceof Error ? error.message : "Failed to load school context.");
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
        title: title || (tone === "success" ? "Attendance Import Complete" : tone === "error" ? "Attendance Import Failed" : "Attendance Import Status"),
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

      const availableStudents = students.length ? students : await fetchStudents();
      const finishTrace = createAdminTrace("Admin console attendance startup import", {
        activeSchoolId,
        detectedDayCount: dayColumns.length,
      });

      showLoadingStatus("Matching students and attendance columns...");
      const matchStudent = createAttendanceImportedStudentMatcher(
        availableStudents.length ? availableStudents : sortedStudents
      );
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
            if (!importedByDay.has(dayDate)) importedByDay.set(dayDate, new Map());
            importedByDay.get(dayDate).set(student.id, status);
          }
        });
      }

      if (!importedByDay.size) {
        finishTrace("failed", { reason: "no-recognized-rows" });
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
        finishTrace("failed", { reason: "all-empty-or-na" });
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
        finishTrace("failed", { reason: existingDaysError.message || "existing-days-error" });
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
          finishTrace("failed", { reason: "cancelled" });
          showResultStatus("Import cancelled.", "info", "Attendance Import Cancelled");
          return;
        }
        shouldUpdateExistingDays = importChoice === "update";
      }

      const daysToImport = importedDayDates.filter((dayDate) => shouldUpdateExistingDays || !existingDayDates.has(dayDate));
      if (!daysToImport.length) {
        finishTrace("failed", { reason: "all-existing-skipped" });
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
        finishTrace("failed", { reason: daysError.message || "days-upsert-error" });
        showResultStatus(`Import failed: ${daysError.message}`, "error");
        return;
      }

      const dayIdByDate = Object.fromEntries((daysData ?? []).map((row) => [row.day_date, row.id]));
      const actualImportedStatusCount = daysToImport.reduce((sum, dayDate) => sum + (importedByDay.get(dayDate)?.size ?? 0), 0);
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
          finishTrace("failed", { reason: deleteError.message || "delete-existing-entries-error" });
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
            finishTrace("failed", { reason: insertError.message || "insert-rows-error" });
            showResultStatus(`Import failed: ${insertError.message}`, "error");
            return;
          }
        }
      }

      await fetchAttendanceDays();
      finishTrace("success", {
        dayCount: daysToImport.length,
        entryCount: actualImportedStatusCount,
      });
      const updatedExistingDayCount = shouldUpdateExistingDays ? overlappingDayDates.length : 0;
      const addedNewDayCount = daysToImport.length - updatedExistingDayCount;
      const skippedExistingDayCount = shouldUpdateExistingDays ? 0 : overlappingDayDates.length;
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
      logAdminRequestFailure("Admin console attendance startup import failed", error, {
        activeSchoolId,
      });
      showResultStatus(`Import failed: ${error instanceof Error ? error.message : error}`, "error");
    } finally {
      if (attendanceImportInputRef.current) attendanceImportInputRef.current.value = "";
    }
  }

  const workspaceContextValue = {
    activeSchoolId,
    attendanceSubTab,
    students,
    fetchStudents,
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
    attendanceMsg,
    absenceApplications,
    formatDateTime,
    decideAbsenceApplication,
    absenceApplicationsMsg,
  };

  return (
    <AdminConsoleWorkspaceProvider value={workspaceContextValue}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          className={`btn ${attendanceSubTab === "sheet" ? "btn-primary" : ""}`}
          type="button"
          onClick={() => {
            setAttendanceSubTab("sheet");
            onSelectAttendanceSubTab?.("sheet");
          }}
        >
          Attendance Sheet
        </button>
        <button
          className={`btn ${attendanceSubTab === "absence" ? "btn-primary" : ""}`}
          type="button"
          onClick={() => {
            setAttendanceSubTab("absence");
            onSelectAttendanceSubTab?.("absence");
          }}
        >
          Absence Applications
        </button>
        {typeof onOpenFullConsole === "function" ? (
          <button className="btn" type="button" onClick={onOpenFullConsole}>
            Open Full Console
          </button>
        ) : null}
      </div>

      {typeof onOpenFullConsole === "function" ? (
        <div className="admin-help" style={{ marginBottom: 12 }}>
          Need the full attendance console with every linked admin workflow? Open the full console from here.
        </div>
      ) : null}

      <AdminConsoleAttendanceWorkspace />

      {attendanceImportStatus && typeof document !== "undefined" ? createPortal((
        <div
          className="admin-modal-overlay"
          onClick={() => {
            if (!attendanceImportStatus.loading) closeAttendanceImportStatus();
          }}
        >
          <div className="admin-modal attendance-import-status-modal" onClick={(event) => event.stopPropagation()}>
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

      {attendanceImportConflict && typeof document !== "undefined" ? createPortal((
        <div className="admin-modal-overlay" onClick={() => resolveAttendanceImportConflict("cancel")}>
          <div className="admin-modal attendance-import-modal" onClick={(event) => event.stopPropagation()}>
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
              <button className="btn btn-primary" type="button" onClick={() => resolveAttendanceImportConflict("update")}>
                Update Existing Columns
              </button>
              <button className="btn" type="button" onClick={() => resolveAttendanceImportConflict("new_only")}>
                Only Add New Columns
              </button>
              <button className="btn btn-danger" type="button" onClick={() => resolveAttendanceImportConflict("cancel")}>
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
          <div className="admin-modal attendance-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">{`Attendance - ${formatDateFull(attendanceModalDay.day_date)}`}</div>
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
                  {activeStudents.map((student) => {
                    const entry = attendanceDraft?.[student.id] || { status: "", comment: "" };
                    const approved = approvedAbsenceByStudent?.[student.id];
                    return (
                      <tr key={`att-${student.id}`}>
                        <td>{student.student_code ?? ""}</td>
                        <td>
                          {student.display_name ?? student.email ?? student.id}
                          {approved ? (
                            <div className={`admin-help att-approved-note ${approved.type === "excused" ? "excused" : "late"}`} style={{ marginTop: 4 }}>
                              Approved {approved.type === "excused" ? "Excused Absence" : "Late/Leave Early"}
                              {approved.time_value ? ` (${approved.time_value})` : ""}
                            </div>
                          ) : null}
                        </td>
                        {["P", "L", "E", "A"].map((code) => (
                          <td key={`${student.id}-${code}`}>
                            <button
                              className={`att-status-btn ${entry.status === code ? "active" : ""} att-${code}`}
                              type="button"
                              onClick={() =>
                                setAttendanceDraft((prev) => ({
                                  ...prev,
                                  [student.id]: { ...entry, status: code },
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
                            onChange={(event) =>
                              setAttendanceDraft((prev) => ({
                                ...prev,
                                [student.id]: { ...entry, comment: event.target.value },
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
    </AdminConsoleWorkspaceProvider>
  );
}
