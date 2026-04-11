import { publicSupabase } from "../supabaseClient";
import { state, saveState } from "../state/appState";
import { logSupabaseError, logUnexpectedError } from "./errorHelpers";

export function hasLinkParam() {
  try {
    const url = new URL(window.location.href);
    return Boolean(url.searchParams.get("link"));
  } catch {
    return false;
  }
}

export async function checkLinkFromUrl() {
  try {
    const url = new URL(window.location.href);
    const linkId = url.searchParams.get("link");
    if (!linkId) {
      state.linkId = null;
      state.linkExpiresAt = null;
      state.linkTestVersion = null;
      state.linkTestSessionId = null;
      state.linkInvalid = false;
      state.linkLoginRequired = false;
      saveState();
      return;
    }

    const { data, error } = await publicSupabase
      .from("exam_links")
      .select("id, test_version, test_session_id, expires_at")
      .eq("id", linkId)
      .single();

    if (error || !data) {
      if (error) logSupabaseError("exam_links fetch error", error);
      state.linkInvalid = true;
      saveState();
      return;
    }

    const expiresAt = new Date(data.expires_at).getTime();
    if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
      state.linkInvalid = true;
      saveState();
      return;
    }

    state.linkId = data.id;
    state.linkExpiresAt = data.expires_at;
    state.linkTestSessionId = data.test_session_id ?? null;
    if (data.test_session_id) {
      const { data: sessionRow, error: sessionErr } = await publicSupabase
        .from("test_sessions")
        .select("id, problem_set_id")
        .eq("id", data.test_session_id)
        .single();
      if (sessionErr || !sessionRow) {
        if (sessionErr) logSupabaseError("linked test_session fetch error", sessionErr);
        state.linkInvalid = true;
        saveState();
        return;
      }
      state.linkTestVersion = sessionRow.problem_set_id;
    } else {
      state.linkTestVersion = data.test_version;
    }
    state.linkInvalid = false;
    state.linkLoginRequired = true;
    state.requireLogin = true;
    state.phase = "login";
    saveState();
  } catch (error) {
    logUnexpectedError("exam link bootstrap failed", error);
    state.linkInvalid = true;
    saveState();
  } finally {
    state.linkChecked = true;
  }
}
