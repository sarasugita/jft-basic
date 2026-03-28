"use client";

/**
 * Shared pure helpers used across multiple workspace state hooks.
 * Extracted from AdminConsoleCore.jsx during the per-workspace refactor.
 */

export function isAnalyticsExcludedStudent(student) {
  return Boolean(student?.is_withdrawn || student?.is_test_account);
}

export function getRowTimestamp(row) {
  const value = row?.ended_at || row?.created_at || row?.started_at || null;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function getAttemptScopeKey(attempt) {
  if (attempt?.test_session_id) return `session:${attempt.test_session_id}`;
  if (attempt?.test_version) return `version:${attempt.test_version}`;
  return `attempt:${attempt?.id ?? getRowTimestamp(attempt)}`;
}

export function buildLatestAttemptMapByStudentAndScope(attemptsList, getScopeKey = getAttemptScopeKey) {
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
