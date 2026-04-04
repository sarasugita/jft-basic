"use client";

const attendanceSheetCache = new Map();
const attendanceSheetAutoRefreshSeen = new Set();

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

function cloneAttendanceFilter(filter) {
  if (!filter || typeof filter !== "object") {
    return { minRate: "", minAbsences: "", startDate: "", endDate: "" };
  }
  return {
    minRate: filter.minRate ?? "",
    minAbsences: filter.minAbsences ?? "",
    startDate: filter.startDate ?? "",
    endDate: filter.endDate ?? "",
  };
}

export function readAttendanceSheetCache(schoolId) {
  if (!schoolId) return null;
  const cached = attendanceSheetCache.get(String(schoolId));
  if (!cached) return null;
  return {
    attendanceDays: cloneAttendanceDays(cached.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(cached.attendanceEntries),
    attendanceMsg: cached.attendanceMsg ?? "",
    attendanceFilter: cloneAttendanceFilter(cached.attendanceFilter),
  };
}

export function writeAttendanceSheetCache(schoolId, snapshot = {}) {
  if (!schoolId) return;
  attendanceSheetCache.set(String(schoolId), {
    attendanceDays: cloneAttendanceDays(snapshot.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(snapshot.attendanceEntries),
    attendanceMsg: snapshot.attendanceMsg ?? "",
    attendanceFilter: cloneAttendanceFilter(snapshot.attendanceFilter),
  });
}

export function clearAttendanceSheetCache(schoolId) {
  if (!schoolId) return;
  attendanceSheetCache.delete(String(schoolId));
}

export function hasAttendanceSheetAutoRefreshed(schoolId) {
  if (!schoolId) return false;
  return attendanceSheetAutoRefreshSeen.has(String(schoolId));
}

export function markAttendanceSheetAutoRefreshed(schoolId) {
  if (!schoolId) return;
  attendanceSheetAutoRefreshSeen.add(String(schoolId));
}
