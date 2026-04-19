import { supabase, publicSupabase } from "../supabaseClient";
import { PASS_RATE_DEFAULT, TEST_VERSION } from "../lib/constants";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { state, saveState } from "./appState";
import { authState } from "./authState";

export let testsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

export let testSessionsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

export async function fetchPublicTests() {
  if (testsState.loading) return;
  testsState.loading = true;
  testsState.error = "";
  const hadData = testsState.loaded && testsState.list.length > 0;
  try {
    const client = authState.session ? supabase : publicSupabase;
    let query = client
      .from("tests")
      .select("id, version, title, type, pass_rate, is_public, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!authState.session) {
      query = query.eq("is_public", true);
    }
    const { data, error } = await query;
    if (error) {
      logSupabaseError("tests fetch error", error);
      const msg = getErrorMessage(error, "Failed to load tests.");
      if (!hadData) {
        testsState.list = [];
      }
      if (String(msg).includes("does not exist") || error.status === 404) {
        testsState.error = "testsテーブルがありません。Supabaseでスキーマを適用してください。";
      } else {
        testsState.error = msg;
      }
      return;
    }
    const list = (data ?? []).filter((t) => t.type === "mock" || t.type === "daily");
    testsState.list = list;
    testsState.loaded = true;
    if (!state.linkId && !state.selectedTestVersion && list.length) {
      state.selectedTestVersion = list[0].version;
      saveState();
    }
  } catch (error) {
    logUnexpectedError("tests fetch failed", error);
    if (!hadData) {
      testsState.list = [];
    }
    testsState.error = getErrorMessage(error, "Failed to load tests.");
  } finally {
    testsState.loaded = true;
    testsState.loading = false;
  }
}

export async function fetchTestSessions() {
  if (testSessionsState.loading) return;
  testSessionsState.loading = true;
  testSessionsState.error = "";
  const hadData = testSessionsState.loaded && testSessionsState.list.length > 0;
  try {
    const { data, error } = await publicSupabase
      .from("test_sessions")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      logSupabaseError("test_sessions fetch error", error);
      const msg = getErrorMessage(error, "Failed to load test sessions.");
      if (!hadData) {
        testSessionsState.list = [];
      }
      if (String(msg).includes("does not exist") || error.status === 404) {
        testSessionsState.error = "test_sessionsテーブルがありません。Supabaseでスキーマを適用してください。";
      } else {
        testSessionsState.error = msg;
      }
      return;
    }
    const list = (data ?? []).map((session) => ({
      audience_mode: "all",
      audience_student_ids: [],
      retake_source_session_id: null,
      retake_release_scope: "all",
      ...session,
    }));
    testSessionsState.list = list;
    testSessionsState.loaded = true;
    if (!state.linkId) {
      const selectedSessionId = state.selectedTestSessionId || "";
      const selectedSession = selectedSessionId ? list.find((session) => session.id === selectedSessionId) : null;
      const fallbackSession = list[0] || null;
      if (!selectedSessionId && fallbackSession) {
        state.selectedTestSessionId = fallbackSession.id;
        if (fallbackSession.problem_set_id) state.selectedTestVersion = fallbackSession.problem_set_id;
        saveState();
      } else if (selectedSessionId && !selectedSession) {
        state.selectedTestSessionId = fallbackSession?.id || "";
        if (fallbackSession?.problem_set_id) {
          state.selectedTestVersion = fallbackSession.problem_set_id;
        } else if (!fallbackSession) {
          state.selectedTestVersion = "";
        }
        saveState();
      }
    }
  } catch (error) {
    logUnexpectedError("test_sessions fetch failed", error);
    if (!hadData) {
      testSessionsState.list = [];
    }
    testSessionsState.error = getErrorMessage(error, "Failed to load test sessions.");
  } finally {
    testSessionsState.loaded = true;
    testSessionsState.loading = false;
  }
}

// --- Session helpers (will move to lib/sessionHelpers.js in Phase 3) ---

export function getActiveTestVersion() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (sessionId) {
    const session = testSessionsState.list.find((s) => s.id === sessionId);
    if (session?.problem_set_id) return session.problem_set_id;
  }
  return state.linkTestVersion || state.selectedTestVersion || TEST_VERSION;
}

export function getActiveTestSession() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (!sessionId) return null;
  return testSessionsState.list.find((s) => s.id === sessionId) || null;
}

export function getActiveTestTitle() {
  const session = getActiveTestSession();
  if (session?.title) return session.title;
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  return test?.title || version || "Test";
}

export function getActiveTestType() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  return test?.type || "";
}

export function getSessionTestType(session) {
  if (!session?.problem_set_id) return "";
  const test = testsState.list.find((t) => t.version === session.problem_set_id);
  return test?.type || "";
}

export function getActivePassRate() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

export function getPassRateForVersion(version) {
  const test = testsState.list.find((t) => t.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

/**
 * Fetch any test versions that appear in attempt records but are missing from
 * testsState.list (e.g., historical versions beyond the initial load limit, or
 * versions belonging to tests that were never published as public).
 */
export async function ensureTestVersionsLoaded(versions) {
  if (!versions?.length) return;
  const missing = versions.filter((v) => v && !testsState.list.find((t) => t.version === v));
  if (!missing.length) return;
  try {
    const client = authState.session ? supabase : publicSupabase;
    const { data, error } = await client
      .from("tests")
      .select("id, version, title, type, pass_rate, is_public, created_at, updated_at")
      .in("version", missing);
    if (error) {
      logSupabaseError("ensureTestVersionsLoaded error", error);
      return;
    }
    const newTests = (data ?? []).filter((t) => t.type === "mock" || t.type === "daily");
    const existingVersions = new Set(testsState.list.map((t) => t.version));
    const toAdd = newTests.filter((t) => !existingVersions.has(t.version));
    if (toAdd.length) {
      testsState.list = [...testsState.list, ...toAdd];
    }
  } catch (error) {
    logUnexpectedError("ensureTestVersionsLoaded failed", error);
  }
}
