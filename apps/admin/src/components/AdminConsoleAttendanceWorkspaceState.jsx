"use client";

import { useEffect, useRef, useState } from "react";
import { recordAdminAuditEvent } from "../lib/adminAudit";

const ATTENDANCE_COUNTED_STATUSES = ["P", "L", "E", "A"];
const ATTENDANCE_SUPPORTED_STATUSES = [...ATTENDANCE_COUNTED_STATUSES, "N/A", "W"];
const IMPORTED_ATTEMPT_BATCH_SIZE = 250;


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


export function useAttendanceWorkspaceState({ supabase, activeSchoolId, session, students = [], attendanceSubTab, setAttendanceSubTab }) {
  const activeSchoolIdRef = useRef(activeSchoolId);
  useEffect(() => {
    activeSchoolIdRef.current = activeSchoolId;
  }, [activeSchoolId]);

  // State
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

  // Async functions
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
    const existing = day.id ? (attendanceEntries[day.id] ?? {}) : {};
    const draft = {};
    (students ?? []).forEach((s) => {
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
      fetchAttendanceDays();
    } catch (error) {
      console.error("clear attendance values error:", error);
      setAttendanceMsg(`Clear failed: ${error.message || error}`);
    } finally {
      setAttendanceClearing(false);
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
    fetchAbsenceApplications,
    decideAbsenceApplication,
    buildAttendanceStats,
    buildAttendancePieData,
    normalizeAttendanceStatusToken,
    normalizeAttendanceImportStatus,
    isCountedAttendanceStatus,
    getAttendanceStatusClassName,
    detectAttendanceImportLayout,
  };
}
