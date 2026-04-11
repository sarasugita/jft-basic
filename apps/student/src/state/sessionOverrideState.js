import { supabase } from "../supabaseClient";
import { SESSION_ATTEMPT_OVERRIDE_REFRESH_MS } from "../lib/constants";
import { getErrorMessage, logSupabaseError, logUnexpectedError, isMissingSessionAttemptOverrideTableError } from "../lib/errorHelpers";

export let sessionAttemptOverrideState = {
  loaded: false,
  loading: false,
  map: {},
  error: "",
  userId: "",
  lastFetchedAt: 0,
};

export async function fetchSessionAttemptOverrides(options = {}) {
  const { authState } = await import("./authState");
  if (!authState.session) return;
  const { force = false } = options;
  const isFresh =
    sessionAttemptOverrideState.loaded &&
    Date.now() - Number(sessionAttemptOverrideState.lastFetchedAt ?? 0) < SESSION_ATTEMPT_OVERRIDE_REFRESH_MS;
  if (sessionAttemptOverrideState.loading || (isFresh && !force)) return;
  sessionAttemptOverrideState.loading = true;
  sessionAttemptOverrideState.error = "";
  try {
    const { data, error } = await supabase
      .from("test_session_attempt_overrides")
      .select("test_session_id, extra_attempts")
      .eq("student_id", authState.session.user.id);
    if (error) {
      if (!isMissingSessionAttemptOverrideTableError(error)) {
        logSupabaseError("session attempt overrides fetch error", error);
        sessionAttemptOverrideState.error = getErrorMessage(error, "Failed to load extra attempts.");
      }
      sessionAttemptOverrideState.map = {};
      sessionAttemptOverrideState.lastFetchedAt = Date.now();
      return;
    }
    const map = {};
    (data ?? []).forEach((row) => {
      if (!row?.test_session_id) return;
      map[row.test_session_id] = Math.max(0, Number(row.extra_attempts ?? 0));
    });
    sessionAttemptOverrideState.map = map;
    sessionAttemptOverrideState.lastFetchedAt = Date.now();
  } catch (error) {
    sessionAttemptOverrideState.map = {};
    sessionAttemptOverrideState.error = getErrorMessage(error, "Failed to load extra attempts.");
    logUnexpectedError("session attempt overrides fetch failed", error);
  } finally {
    sessionAttemptOverrideState.loaded = true;
    sessionAttemptOverrideState.loading = false;
  }
}
