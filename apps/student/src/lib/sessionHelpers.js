import { PASS_RATE_DEFAULT, TEST_VERSION } from "./constants";
import { getScoreRateFromAttempt } from "./attemptHelpers";
import { state } from "../state/appState";
import { authState } from "../state/authState";
import { testsState, testSessionsState } from "../state/testsState";
import { studentResultsState } from "../state/resultsState";
import { sessionAttemptOverrideState } from "../state/sessionOverrideState";

const SESSION_AUDIENCE_MODES = new Set(["all", "exclude", "include"]);

function normalizeSessionAudienceMode(value) {
  const mode = String(value ?? "all").trim().toLowerCase();
  return SESSION_AUDIENCE_MODES.has(mode) ? mode : "all";
}

function getSessionAudienceStudentIds(session) {
  if (!Array.isArray(session?.audience_student_ids)) return [];
  return Array.from(
    new Set(
      session.audience_student_ids
        .map((studentId) => String(studentId ?? "").trim())
        .filter(Boolean)
    )
  );
}

export function getActiveTestVersion() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (sessionId) {
    const session = testSessionsState.list.find((item) => item.id === sessionId);
    if (session?.problem_set_id) return session.problem_set_id;
  }
  return state.linkTestVersion || state.selectedTestVersion || TEST_VERSION;
}

export function getActiveTestSession() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (!sessionId) return null;
  return testSessionsState.list.find((item) => item.id === sessionId) || null;
}

export function getActiveTestTitle() {
  const session = getActiveTestSession();
  if (session?.title) return session.title;
  const version = getActiveTestVersion();
  const test = testsState.list.find((item) => item.version === version);
  return test?.title || version || "Test";
}

export function getActiveTestType() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((item) => item.version === version);
  return test?.type || "";
}

export function getSessionTestType(session) {
  if (!session?.problem_set_id) return "";
  const test = testsState.list.find((item) => item.version === session.problem_set_id);
  return test?.type || "";
}

export function isRetakeSessionTitle(title) {
  return String(title ?? "").trim().startsWith("[Retake]");
}

export function getRetakeBaseTitle(title) {
  return String(title ?? "").trim().replace(/^\[Retake\]\s*/i, "").trim();
}

export function isRetakeSession(session) {
  return Boolean(session?.retake_source_session_id) || isRetakeSessionTitle(session?.title);
}

export function getSourceSessionForRetake(session) {
  if (!session) return null;
  if (session.retake_source_session_id) {
    const direct = testSessionsState.list.find((item) => item.id === session.retake_source_session_id) || null;
    if (direct) return direct;
  }
  if (!isRetakeSessionTitle(session.title)) return null;
  const baseTitle = getRetakeBaseTitle(session.title);
  return testSessionsState.list.find((item) => {
    if (!item?.id || item.id === session.id) return false;
    if (String(item.problem_set_id ?? "") !== String(session.problem_set_id ?? "")) return false;
    return String(item.title ?? "").trim() === baseTitle;
  }) || null;
}

export function getBestAttemptForSession(sessionId) {
  if (!sessionId) return null;
  let bestAttempt = null;
  let bestRate = -1;
  (studentResultsState.list ?? []).forEach((attempt) => {
    if (attempt?.test_session_id !== sessionId) return;
    const rate = getScoreRateFromAttempt(attempt);
    if (!bestAttempt || rate > bestRate) {
      bestAttempt = attempt;
      bestRate = rate;
    }
  });
  return bestAttempt;
}

export function canAccessSession(session) {
  if (!session) return false;
  const audienceMode = normalizeSessionAudienceMode(session.audience_mode);
  const audienceStudentIds = getSessionAudienceStudentIds(session);
  const currentStudentId = String(authState.profile?.id ?? authState.session?.user?.id ?? "").trim();

  if (audienceMode === "include") {
    if (!currentStudentId || !audienceStudentIds.includes(currentStudentId)) return false;
  } else if (audienceMode === "exclude") {
    if (currentStudentId && audienceStudentIds.includes(currentStudentId)) return false;
    if (!currentStudentId) return false;
  }

  if (!isRetakeSession(session)) return true;
  const releaseScope = String(session.retake_release_scope || "all");
  if (releaseScope === "all") return true;
  if (!authState.session || !studentResultsState.loaded) return false;
  const sourceSession = getSourceSessionForRetake(session);
  if (!sourceSession?.id) return false;
  const sourceAttempt = getBestAttemptForSession(sourceSession.id);
  if (!sourceAttempt) return false;
  const passRate = getPassRateForVersion(sourceSession.problem_set_id || session.problem_set_id);
  return getScoreRateFromAttempt(sourceAttempt) < passRate;
}

export function allowMultipleAttempts(session) {
  return session?.allow_multiple_attempts !== false;
}

export function getAttemptCountForSession(sessionId) {
  if (!sessionId) return 0;
  return (studentResultsState.list ?? []).filter((attempt) => attempt.test_session_id === sessionId).length;
}

export function getExtraAttemptsForSession(sessionId) {
  if (!sessionId) return 0;
  return Math.max(0, Number(sessionAttemptOverrideState.map?.[sessionId] ?? 0));
}

export function hasAttemptForSession(sessionId) {
  return getAttemptCountForSession(sessionId) > 0;
}

export function isSessionAttemptAvailabilityReady() {
  return !authState.session || (studentResultsState.loaded && sessionAttemptOverrideState.loaded);
}

export function hasRemainingAttemptsForSession(session) {
  if (!session?.id) return false;
  if (allowMultipleAttempts(session)) return true;
  if (!authState.session) return !hasAttemptForSession(session.id);
  const totalAllowedAttempts = 1 + getExtraAttemptsForSession(session.id);
  return getAttemptCountForSession(session.id) < totalAllowedAttempts;
}

export function getActivePassRate() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((item) => item.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

export function getPassRateForVersion(version) {
  const test = testsState.list.find((item) => item.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}
