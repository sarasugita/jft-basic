"use client";

const ATTENDANCE_SHEET_CACHE_PREFIX = "jft_admin_attendance_sheet_v1";
const ATTENDANCE_SHEET_AUTO_REFRESH_PREFIX = "jft_admin_attendance_sheet_auto_refreshed_v1";

const attendanceSheetCache = new Map();
const attendanceSheetAutoRefreshSeen = new Set();

function getAttendanceSheetCacheKey(schoolId) {
  return `${ATTENDANCE_SHEET_CACHE_PREFIX}:${String(schoolId ?? "none")}`;
}

function getAttendanceSheetAutoRefreshKey(schoolId) {
  return `${ATTENDANCE_SHEET_AUTO_REFRESH_PREFIX}:${String(schoolId ?? "none")}`;
}

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
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
  const cacheKey = String(schoolId);
  const cached = attendanceSheetCache.get(cacheKey);
  if (cached) {
    return {
      attendanceDays: cloneAttendanceDays(cached.attendanceDays),
      attendanceEntries: cloneAttendanceEntries(cached.attendanceEntries),
      attendanceMsg: cached.attendanceMsg ?? "",
      attendanceFilter: cloneAttendanceFilter(cached.attendanceFilter),
      attendanceSheetHydrated: Boolean(cached.attendanceSheetHydrated),
    };
  }
  if (typeof window === "undefined") return null;
  const stored = safeParseJson(window.sessionStorage.getItem(getAttendanceSheetCacheKey(schoolId)));
  if (!stored) return null;
  attendanceSheetCache.set(cacheKey, {
    attendanceDays: cloneAttendanceDays(stored.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(stored.attendanceEntries),
    attendanceMsg: stored.attendanceMsg ?? "",
    attendanceFilter: cloneAttendanceFilter(stored.attendanceFilter),
    attendanceSheetHydrated: Boolean(stored.attendanceSheetHydrated),
  });
  return {
    attendanceDays: cloneAttendanceDays(stored.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(stored.attendanceEntries),
    attendanceMsg: stored.attendanceMsg ?? "",
    attendanceFilter: cloneAttendanceFilter(stored.attendanceFilter),
    attendanceSheetHydrated: Boolean(stored.attendanceSheetHydrated),
  };
}

export function writeAttendanceSheetCache(schoolId, snapshot = {}) {
  if (!schoolId) return;
  const payload = {
    attendanceDays: cloneAttendanceDays(snapshot.attendanceDays),
    attendanceEntries: cloneAttendanceEntries(snapshot.attendanceEntries),
    attendanceMsg: snapshot.attendanceMsg ?? "",
    attendanceFilter: cloneAttendanceFilter(snapshot.attendanceFilter),
    attendanceSheetHydrated: Boolean(snapshot.attendanceSheetHydrated),
  };
  attendanceSheetCache.set(String(schoolId), payload);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(getAttendanceSheetCacheKey(schoolId), JSON.stringify(payload));
    } catch {
      // Best effort only.
    }
  }
}

export function clearAttendanceSheetCache(schoolId) {
  if (!schoolId) return;
  attendanceSheetCache.delete(String(schoolId));
  attendanceSheetAutoRefreshSeen.delete(String(schoolId));
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(getAttendanceSheetCacheKey(schoolId));
      window.sessionStorage.removeItem(getAttendanceSheetAutoRefreshKey(schoolId));
    } catch {
      // Best effort only.
    }
  }
}

export function hasAttendanceSheetAutoRefreshed(schoolId) {
  if (!schoolId) return false;
  const cacheKey = String(schoolId);
  if (attendanceSheetAutoRefreshSeen.has(cacheKey)) return true;
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(getAttendanceSheetAutoRefreshKey(schoolId));
    if (raw === "1") {
      attendanceSheetAutoRefreshSeen.add(cacheKey);
      return true;
    }
  } catch {
    // Best effort only.
  }
  return false;
}

export function markAttendanceSheetAutoRefreshed(schoolId) {
  if (!schoolId) return;
  const cacheKey = String(schoolId);
  attendanceSheetAutoRefreshSeen.add(cacheKey);
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(getAttendanceSheetAutoRefreshKey(schoolId), "1");
    } catch {
      // Best effort only.
    }
  }
}
