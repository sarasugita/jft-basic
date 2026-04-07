"use client";

const ADMIN_CONSOLE_DATA_CACHE_PREFIX = "jft_admin_console_data_v1";

function getCacheKey(userId, schoolId) {
  return `${ADMIN_CONSOLE_DATA_CACHE_PREFIX}:${String(userId ?? "anon")}:${String(schoolId ?? "none")}`;
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

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === "object") {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      next[key] = cloneValue(item);
    });
    return next;
  }
  return value;
}

export function readAdminConsoleDataCache(userId, schoolId) {
  if (typeof window === "undefined") return null;
  try {
    return safeParseJson(window.sessionStorage.getItem(getCacheKey(userId, schoolId)));
  } catch {
    return null;
  }
}

export function writeAdminConsoleDataCache(userId, schoolId, snapshot = {}) {
  if (typeof window === "undefined") return;
  try {
    const current = readAdminConsoleDataCache(userId, schoolId) ?? {};
    window.sessionStorage.setItem(
      getCacheKey(userId, schoolId),
      JSON.stringify(cloneValue({
        ...current,
        ...snapshot,
      }))
    );
  } catch {
    // Best effort only.
  }
}

export function clearAdminConsoleDataCache(userId, schoolId) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(getCacheKey(userId, schoolId));
  } catch {
    // Best effort only.
  }
}
