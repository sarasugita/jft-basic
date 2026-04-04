"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { recordAdminAuditEvent } from "../lib/adminAudit";

const ATTENDANCE_COUNTED_STATUSES = ["P", "L", "E", "A"];
const ATTENDANCE_SUPPORTED_STATUSES = [...ATTENDANCE_COUNTED_STATUSES, "N/A", "W"];
const IMPORTED_ATTEMPT_BATCH_SIZE = 250;
const ATTENDANCE_DAYS_PAGE_SIZE = 500;
const ATTENDANCE_ENTRIES_PAGE_SIZE = 500;
const attendanceSheetCache = new Map();

async function fetchAllPages(buildPageQuery, pageSize) {
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

function cloneAttendanceDays(days) {
  return Array.isArray(days) ? days.map((day) => ({ ...day })) : [];
}

function cloneAttendanceEntries(entries) {
  const cloned = {};
  Object.entries(entries ?? {}).forEach(([dayId, dayEntries]) => {
    cloned[dayId] = {};
    Object.entries(dayEntries ?? {}).forEach(([studentId, entry]) => {
      cloned[dayId][studentId] = entry ? { ...entry } : entry;
    });
  });
  return cloned;
}

function readAttendanceSheetCache(schoolId) {
  if (!schoolId) return null;
  const cached = attendanceSheetCache.get(String(schoolId));
  if (!cached) return null;
  return {
    attendanceDays: cloneAttendanceDays(cached.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(cached.attendanceEntries),
    attendanceMsg: cached.attendanceMsg ?? "",
  };
}

function writeAttendanceSheetCache(schoolId, attendanceDays, attendanceEntries, attendanceMsg = "") {
  if (!schoolId) return;
  attendanceSheetCache.set(String(schoolId), {
    attendanceDays: cloneAttendanceDays(attendanceDays),
    attendanceEntries: cloneAttendanceEntries(attendanceEntries),
    attendanceMsg,
  });
}

function clearAttendanceSheetCache(schoolId) {
  if (!schoolId) return;
  attendanceSheetCache.delete(String(schoolId));
}


// Helper functions
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
    const countedItems = items.filter((item) => isCountedAttendanceStatus(item?.status));
    const total = countedItems.length;
    const present = countedItems.filter((item) => {
      const status = normalizeAttendanceStatusToken(item?.status);
      return status === "P" || status === "L";
    }).length;
    const late = countedItems.filter((item) => normalizeAttendanceStatusToken(item?.status) === "L").length;
    const excused = countedItems.filter((item) => normalizeAttendanceStatusToken(item?.status) === "E").length;
    const unexcused = countedItems.filter((item) => normalizeAttendanceStatusToken(item?.status) === "A").length;
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


export function useAttendanceWorkspaceState({ supabase, activeSchoolId, session, students = [], attendanceSubTab, setAttendanceSubTab, isAnalyticsExcludedStudent = () => false, formatDateShort = (d) => d, formatWeekday = (d) => "", openAttendanceDayCtx }) {
  const activeSchoolIdRef = useRef(activeSchoolId);
  const initialAttendanceSheet = readAttendanceSheetCache(activeSchoolId);
  useEffect(() => {
    activeSchoolIdRef.current = activeSchoolId;
  }, [activeSchoolId]);

  // State
  const [attendanceDays, setAttendanceDays] = useState(() => initialAttendanceSheet?.attendanceDays ?? []);
  const [attendanceEntries, setAttendanceEntries] = useState(() => initialAttendanceSheet?.attendanceEntries ?? {});
  const [attendanceMsg, setAttendanceMsg] = useState(() => initialAttendanceSheet?.attendanceMsg ?? "");
  const [attendanceSheetLoaded, setAttendanceSheetLoaded] = useState(() => Boolean(initialAttendanceSheet));
  const [attendanceSheetRefreshing, setAttendanceSheetRefreshing] = useState(false);
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
  const [attendanceImportConflict, setAttendanceImportConflict] = useState(null);
  const [attendanceImportStatus, setAttendanceImportStatus] = useState(null);
  const [approvedAbsenceByStudent, setApprovedAbsenceByStudent] = useState({});
  const [attendanceFilter, setAttendanceFilter] = useState({
    minRate: "",
    minAbsences: "",
    startDate: "",
    endDate: ""
  });
  const [absenceApplications, setAbsenceApplications] = useState([]);
  const [absenceApplicationsMsg, setAbsenceApplicationsMsg] = useState("");

  const attendanceImportInputRef = useRef(null);
  const attendanceImportChoiceResolverRef = useRef(null);

  useEffect(() => {
    const cached = readAttendanceSheetCache(activeSchoolId);
    setAttendanceDays(cached?.attendanceDays ?? []);
    setAttendanceEntries(cached?.attendanceEntries ?? {});
    setAttendanceMsg(cached?.attendanceMsg ?? "");
    setAttendanceSheetLoaded(Boolean(cached));
    setAttendanceSheetRefreshing(false);
  }, [activeSchoolId]);

  // Memos - derived attendance data
  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);

  const attendanceDayColumns = useMemo(() => {
    return [...attendanceDays]
      .sort((left, right) => String(right.day_date ?? "").localeCompare(String(left.day_date ?? "")))
      .map((d) => ({
        ...d,
        label: `${formatDateShort(d.day_date)} (${formatWeekday(d.day_date)})`
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

  const activeStudents = useMemo(() => {
    const filtered = (students ?? []).filter((s) => !s.is_withdrawn);
    const sorted = [...filtered];
    const codeNum = (code) => {
      const m = String(code ?? "").match(/(\d+)/);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    sorted.sort((a, b) => {
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
    return sorted;
  }, [students]);

  const attendanceFilteredStudents = useMemo(() => {
    const minRate = attendanceFilter.minRate === "" ? null : Number(attendanceFilter.minRate);
    const minAbsences = attendanceFilter.minAbsences === "" ? null : Number(attendanceFilter.minAbsences);
    return activeStudents.filter((s) => {
      const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
      const stats = buildAttendanceStats(perDay);
      const rate = stats.total ? (stats.present / stats.total) * 100 : null;
      const absences = stats.unexcused;
      if (minRate != null && (rate == null || rate >= minRate)) return false;
      if (minAbsences != null && absences < minAbsences) return false;
      return true;
    });
  }, [activeStudents, attendanceFilter, attendanceRangeColumns, attendanceEntriesByDay]);

  const attendanceAnalyticsStudents = useMemo(
    () => attendanceFilteredStudents.filter((student) => !isAnalyticsExcludedStudent(student)),
    [attendanceFilteredStudents, isAnalyticsExcludedStudent]
  );

  const attendanceDayRates = useMemo(() => {
    const rates = {};
    attendanceDayColumns.forEach((day) => {
      const statuses = attendanceAnalyticsStudents.map((student) => attendanceEntriesByDay?.[day.id]?.[student.id]?.status || "");
      rates[day.id] = buildAttendanceStats(statuses).rate;
    });
    return rates;
  }, [attendanceAnalyticsStudents, attendanceDayColumns, attendanceEntriesByDay]);

  // Async functions
  async function fetchAbsenceApplications() {
    if (!activeSchoolId || !supabase) {
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
    await recordAdminAuditEvent(supabase, {
      actionType: nextStatus === "approved" ? "approve" : "deny",
      entityType: "absence_application",
      entityId: id,
      summary: `${nextStatus === "approved" ? "Approved" : "Denied"} absence application for ${targetApplication?.profiles?.display_name || targetApplication?.student_id || "student"}.`,
      schoolId: activeSchoolId,
      metadata: {
        application_type: targetApplication?.type ?? null,
        day_date: targetApplication?.day_date ?? null,
        status: nextStatus,
      },
    });
    fetchAbsenceApplications();
  }

  function applyAttendanceSheetSnapshot(schoolIdSnapshot, nextAttendanceDays, nextAttendanceEntries, nextAttendanceMsg = "") {
    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    setAttendanceDays(nextAttendanceDays);
    setAttendanceEntries(nextAttendanceEntries);
    setAttendanceMsg(nextAttendanceMsg);
    setAttendanceSheetLoaded(true);
    setAttendanceSheetRefreshing(false);
    writeAttendanceSheetCache(schoolIdSnapshot, nextAttendanceDays, nextAttendanceEntries, nextAttendanceMsg);
  }

  async function fetchAttendanceDays(options = {}) {
    const { force = false } = options;
    const schoolIdSnapshot = activeSchoolIdRef.current;
    if (!schoolIdSnapshot || !supabase) {
      setAttendanceDays([]);
      setAttendanceEntries({});
      setAttendanceMsg("");
      setAttendanceSheetLoaded(false);
      setAttendanceSheetRefreshing(false);
      return;
    }
    const cached = readAttendanceSheetCache(schoolIdSnapshot);
    if (!force && cached) {
      applyAttendanceSheetSnapshot(
        schoolIdSnapshot,
        cached.attendanceDays,
        cached.attendanceEntries,
        cached.attendanceMsg
      );
      return;
    }

    setAttendanceSheetRefreshing(true);
    setAttendanceMsg(cached ? "Refreshing attendance..." : "Loading attendance...");
    const { data: rows, error } = await fetchAllPages((offset, pageSize) => (
      supabase
        .from("attendance_days")
        .select("id, day_date, created_at")
        .eq("school_id", schoolIdSnapshot)
        .order("day_date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1)
    ), ATTENDANCE_DAYS_PAGE_SIZE);

    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      console.error("attendance_days fetch error:", error);
      setAttendanceSheetRefreshing(false);
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }

    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    const list = rows ?? [];
    let nextEntries = {};
    if (list.length) {
      const { data: entryRows, error: entryError } = await fetchAttendanceEntries(
        list.map((d) => d.id),
        schoolIdSnapshot,
        { applyState: false }
      );
      if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
      if (entryError) {
        console.error("attendance_entries fetch error:", entryError);
        setAttendanceSheetRefreshing(false);
        setAttendanceMsg(`Load failed: ${entryError.message}`);
        return;
      }
      nextEntries = entryRows ?? {};
    }

    applyAttendanceSheetSnapshot(
      schoolIdSnapshot,
      list,
      nextEntries,
      list.length ? "" : "No attendance days yet."
    );
  }

  async function fetchAttendanceEntries(dayIds, schoolIdSnapshot = activeSchoolIdRef.current, options = {}) {
    const { applyState = true } = options;
    if (!dayIds?.length) {
      if (applyState) {
        applyAttendanceSheetSnapshot(schoolIdSnapshot, attendanceDays, {}, attendanceMsg);
      }
      return { data: {}, error: null };
    }

    const { data: rows, error } = await fetchAllPages((offset, pageSize) => (
      supabase
        .from("attendance_entries")
        .select("day_id, student_id, status, comment")
        .eq("school_id", schoolIdSnapshot)
        .in("day_id", dayIds)
        .order("day_id", { ascending: true })
        .order("student_id", { ascending: true })
        .range(offset, offset + pageSize - 1)
    ), ATTENDANCE_ENTRIES_PAGE_SIZE);

    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      return { data: null, error };
    }

    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    const map = {};
    (rows ?? []).forEach((row) => {
      if (!row?.day_id || !row?.student_id) return;
      if (!map[row.day_id]) map[row.day_id] = {};
      map[row.day_id][row.student_id] = {
        status: row.status,
        comment: row.comment ?? ""
      };
    });
    if (applyState) {
      applyAttendanceSheetSnapshot(schoolIdSnapshot, attendanceDays, map, attendanceMsg);
    }
    return { data: map, error: null };
  }

  // Delegate to context's openAttendanceDay which manages the core modal state
  async function openAttendanceDay(dayDate, options = {}) {
    if (openAttendanceDayCtx) {
      await openAttendanceDayCtx(dayDate, options);
    }
    // Fallback if context function not provided
    if (!dayDate) return;

    // Load existing attendance data for this day
    const dayRecord = attendanceDayColumns.find((d) => d.day_date === dayDate);
    if (dayRecord && attendanceEntriesByDay[dayRecord.id]) {
      const entries = attendanceEntriesByDay[dayRecord.id];
      const draft = {};

      // Populate draft with existing attendance data
      Object.entries(entries).forEach(([studentId, entry]) => {
        draft[studentId] = {
          status: entry.status || "N/A",
          comment: entry.comment || "",
        };
      });

      // For existing days, normalize missing historical values to N/A.
      students.forEach((student) => {
        if (!draft[student.id]) {
          draft[student.id] = {
            status: "N/A",
            comment: "",
          };
        } else if (!draft[student.id].status) {
          draft[student.id].status = "N/A";
        }
      });

      setAttendanceDraft(draft);
    } else {
      // No existing data, initialize draft with empty values for regular students, N/A for test accounts
      const draft = {};
      students.forEach((student) => {
        draft[student.id] = {
          status: student.is_test_account ? "N/A" : "",
          comment: "",
        };
      });
      setAttendanceDraft(draft);
    }
  }

  async function saveAttendanceDay() {
    if (!attendanceModalDay?.day_date) return;

    // Validate that the date is in YYYY-MM-DD format and is valid
    const dateMatch = String(attendanceModalDay.day_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
      setAttendanceMsg(`Save failed: Invalid date format "${attendanceModalDay.day_date}". Expected YYYY-MM-DD.`);
      return;
    }
    const [, yearStr, monthStr, dayStr] = dateMatch;
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      setAttendanceMsg(`Save failed: Invalid date "${attendanceModalDay.day_date}". Month must be 1-12 and day must be 1-31.`);
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
    await recordAdminAuditEvent(supabase, {
      actionType: attendanceModalDay.id ? "update" : "create",
      entityType: "attendance_day",
      entityId: dayId,
      summary: `Saved attendance for ${attendanceModalDay.day_date}.`,
      schoolId: activeSchoolId,
      metadata: {
        day_date: attendanceModalDay.day_date,
        entry_count: rows.length,
      },
    });
    await fetchAttendanceDays({ force: true });
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
    await recordAdminAuditEvent(supabase, {
      actionType: "delete",
      entityType: "attendance_day",
      entityId: day.id,
      summary: `Deleted attendance day ${day.day_date}.`,
      schoolId: activeSchoolId,
      metadata: {
        day_date: day.day_date,
      },
    });
    await fetchAttendanceDays({ force: true });
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
      const { data: dayRows, error: dayError } = await fetchAllPages((offset, pageSize) => (
        supabase
          .from("attendance_days")
          .select("id")
          .eq("school_id", activeSchoolId)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1)
      ), ATTENDANCE_DAYS_PAGE_SIZE);
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
      await recordAdminAuditEvent(supabase, {
        actionType: "delete",
        entityType: "attendance_day",
        entityId: `${activeSchoolId}:all`,
        summary: "Cleared all attendance data.",
      schoolId: activeSchoolId,
        metadata: {
          school_id: activeSchoolId,
          attendance_day_count: dayIds.length,
        },
      });
      setAttendanceMsg("Cleared all attendance data.");
      clearAttendanceSheetCache(activeSchoolId);
      await fetchAttendanceDays({ force: true });
    } catch (error) {
      console.error("clear attendance values error:", error);
      setAttendanceMsg(`Clear failed: ${error.message || error}`);
    } finally {
      setAttendanceClearing(false);
    }
  }

  async function cleanupInvalidAttendanceDates() {
    if (!activeSchoolId || !supabase) {
      setAttendanceMsg("School context is missing.");
      return;
    }

    setAttendanceMsg("Scanning for invalid attendance dates...");
    try {
      // Fetch all attendance days for this school
      const { data: allDays, error: fetchError } = await fetchAllPages((offset, pageSize) => (
        supabase
          .from("attendance_days")
          .select("id, day_date")
          .eq("school_id", activeSchoolId)
          .order("day_date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1)
      ), ATTENDANCE_DAYS_PAGE_SIZE);

      if (fetchError) throw fetchError;

      // Identify invalid dates (dates with month > 12 or day > 31)
      const invalidDayIds = (allDays ?? [])
        .filter((day) => {
          const match = String(day.day_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!match) return true; // Invalid format
          const month = Number(match[2]);
          const dayNum = Number(match[3]);
          return month < 1 || month > 12 || dayNum < 1 || dayNum > 31;
        })
        .map((day) => day.id);

      if (!invalidDayIds.length) {
        setAttendanceMsg("No invalid attendance dates found.");
        return;
      }

      // Confirm deletion
      const confirmed = window.confirm(
        `Found ${invalidDayIds.length} invalid attendance date(s). Delete them?\n\nInvalid dates: ${
          (allDays ?? [])
            .filter((day) => invalidDayIds.includes(day.id))
            .map((day) => day.day_date)
            .join(", ")
        }`
      );
      if (!confirmed) {
        setAttendanceMsg("Cleanup cancelled.");
        return;
      }

      // Delete invalid attendance entries first
      for (let index = 0; index < invalidDayIds.length; index += 200) {
        const chunk = invalidDayIds.slice(index, index + 200);
        const { error: deleteEntriesError } = await supabase
          .from("attendance_entries")
          .delete()
          .in("day_id", chunk);
        if (deleteEntriesError) throw deleteEntriesError;
      }

      // Then delete invalid attendance days
      for (let index = 0; index < invalidDayIds.length; index += 200) {
        const chunk = invalidDayIds.slice(index, index + 200);
        const { error: deleteDaysError } = await supabase
          .from("attendance_days")
          .delete()
          .in("id", chunk)
          .eq("school_id", activeSchoolId);
        if (deleteDaysError) throw deleteDaysError;
      }

      await recordAdminAuditEvent(supabase, {
        actionType: "delete",
        entityType: "attendance_day",
        entityId: `${activeSchoolId}:invalid`,
        summary: `Deleted ${invalidDayIds.length} invalid attendance date(s).`,
        schoolId: activeSchoolId,
        metadata: {
          invalid_day_count: invalidDayIds.length,
        },
      });

      setAttendanceMsg(`Deleted ${invalidDayIds.length} invalid attendance date(s).`);
      await fetchAttendanceDays({ force: true });
    } catch (error) {
      console.error("cleanup invalid attendance dates error:", error);
      setAttendanceMsg(`Cleanup failed: ${error.message || error}`);
    }
  }

  return {
    attendanceSubTab,
    setAttendanceSubTab,
    attendanceDays,
    setAttendanceDays,
    attendanceEntries,
    setAttendanceEntries,
    attendanceMsg,
    setAttendanceMsg,
    attendanceSheetLoaded,
    attendanceSheetRefreshing,
    attendanceDate,
    setAttendanceDate,
    attendanceModalOpen,
    setAttendanceModalOpen,
    attendanceModalDay,
    setAttendanceModalDay,
    attendanceDraft,
    setAttendanceDraft,
    attendanceSaving,
    setAttendanceSaving,
    attendanceClearing,
    setAttendanceClearing,
    attendanceImportConflict,
    setAttendanceImportConflict,
    attendanceImportStatus,
    setAttendanceImportStatus,
    attendanceFilter,
    setAttendanceFilter,
    absenceApplications,
    setAbsenceApplications,
    absenceApplicationsMsg,
    setAbsenceApplicationsMsg,
    attendanceImportInputRef,
    attendanceImportChoiceResolverRef,
    fetchAttendanceDays,
    fetchAttendanceEntries,
    openAttendanceDay,
    saveAttendanceDay,
    deleteAttendanceDay,
    clearAllAttendanceValues,
    cleanupInvalidAttendanceDates,
    fetchAbsenceApplications,
    decideAbsenceApplication,
    buildAttendanceStats,
    buildAttendancePieData,
    normalizeAttendanceStatusToken,
    normalizeAttendanceImportStatus,
    isCountedAttendanceStatus,
    getAttendanceStatusClassName,
    detectAttendanceImportLayout,
    // Memos
    attendanceEntriesByDay,
    attendanceDayColumns,
    attendanceRangeColumns,
    activeStudents,
    attendanceFilteredStudents,
    attendanceAnalyticsStudents,
    attendanceDayRates,
  };
}
