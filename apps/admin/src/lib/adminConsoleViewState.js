"use client";

const ADMIN_CONSOLE_VIEW_STATE_STORAGE_PREFIX = "jft_admin_console_view_state_v1";

const DEFAULT_STUDENT_LIST_FILTERS = {
  from: "",
  to: "",
  maxAttendance: "",
  minUnexcused: "",
  minModelAvg: "",
  minDailyAvg: "",
};

function safeParseJson(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function cloneDefaultStudentListFilters() {
  return { ...DEFAULT_STUDENT_LIST_FILTERS };
}

export function getAdminConsoleViewStateStorageKey(userId) {
  return `${ADMIN_CONSOLE_VIEW_STATE_STORAGE_PREFIX}:${String(userId ?? "anon")}`;
}

export function readAdminConsoleViewState(storageKey) {
  if (typeof window === "undefined" || !storageKey) return null;
  try {
    return safeParseJson(window.sessionStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

export function updateAdminConsoleViewState(storageKey, patch = {}) {
  if (typeof window === "undefined" || !storageKey) return;
  try {
    const current = readAdminConsoleViewState(storageKey) ?? {};
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        ...current,
        ...patch,
      })
    );
  } catch {
    // Keep view-state persistence best-effort only.
  }
}

export function getDefaultStudentListFilters() {
  return cloneDefaultStudentListFilters();
}

export function normalizeStudentListFilters(filters) {
  const next = cloneDefaultStudentListFilters();
  if (!filters || typeof filters !== "object") return next;

  for (const key of Object.keys(next)) {
    if (Object.prototype.hasOwnProperty.call(filters, key)) {
      next[key] = String(filters[key] ?? "");
    }
  }

  return next;
}
