import { supabase } from "../supabaseClient";
import { PROFILE_SELECT_FIELDS } from "../lib/constants";
import { getErrorMessage, logSupabaseError, logUnexpectedError } from "../lib/errorHelpers";
import { triggerRender } from "../lib/renderBus";
import { state, saveState } from "./appState";
import { resetSessionScopedState } from "./index";
import { fetchPublicTests, fetchTestSessions } from "./testsState";
import { resultDetailState } from "./resultsState";

export let authState = {
  checked: false,
  session: null,
  profile: null,
  profileError: "",
  recoveryMode: false,
  mustChangePassword: false,
};

let authRefreshPromise = null;
export let studentPanelEntryUserId = "";

export async function refreshAuthState() {
  if (authRefreshPromise) {
    return authRefreshPromise;
  }

  authRefreshPromise = (async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        logSupabaseError("getSession error", error);
        const authMessage = String(error.message || "");
        if (authMessage.includes("Invalid Refresh Token") || authMessage.includes("Refresh Token Not Found")) {
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch (signOutError) {
            logUnexpectedError("auth signOut after invalid refresh token failed", signOutError);
          }
        }
      }

      authState.session = data?.session ?? null;
      authState.profile = null;
      authState.profileError = "";
      authState.mustChangePassword = false;

      const isRecovery = window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token=");
      authState.recoveryMode = Boolean(isRecovery && authState.session);

      if (!authState.session) {
        state.requireLogin = true;
        resetSessionScopedState();
        saveState();
        return;
      }

      authState.mustChangePassword = Boolean(authState.recoveryMode);

      try {
        const { data: prof, error: profErr } = await supabase
          .from("profiles")
          .select(PROFILE_SELECT_FIELDS)
          .eq("id", authState.session.user.id)
          .single();

        if (profErr) {
          authState.profileError = getErrorMessage(profErr, "Failed to load profile.");
          logSupabaseError("fetch profile error", profErr);
        } else {
          authState.profile = prof;
          authState.mustChangePassword = Boolean(authState.mustChangePassword || prof?.force_password_change);
          const nextName = (prof?.display_name ?? "").trim() || (state.user?.name ?? "").trim();
          const nextId = (prof?.student_code ?? "").trim() || (state.user?.id ?? "").trim();
          state.user = { name: nextName, id: nextId };
          saveState();
        }
      } catch (profileError) {
        authState.profileError = getErrorMessage(profileError, "Failed to load profile.");
        logUnexpectedError("fetch profile error", profileError);
      }

      if (authState.session && state.linkId) {
        if (state.phase === "login" && !state.requireLogin) {
          state.linkLoginRequired = false;
          state.phase = "intro";
          saveState();
        }
      }

      if (!state.linkLoginRequired) {
        state.requireLogin = false;
        if (state.phase === "login") {
          state.studentTab = "home";
          state.phase = "intro";
          saveState();
        }
      }

      const currentUserId = authState.session.user.id;
      if (studentPanelEntryUserId !== currentUserId) {
        const shouldResetStudentTab = state.studentPanelUserId !== currentUserId;
        studentPanelEntryUserId = currentUserId;
        state.studentPanelUserId = currentUserId;
        if (shouldResetStudentTab) {
          state.studentTab = "home";
          resultDetailState.open = false;
          resultDetailState.mode = "";
          resultDetailState.subTab = "score";
          resultDetailState.sectionFilter = "";
          resultDetailState.wrongOnly = false;
          resultDetailState.popupOpen = false;
          resultDetailState.popupTitle = "";
          resultDetailState.popupRows = [];
          resultDetailState.attempt = null;
        }
        saveState();
      }

      // Reset per-user state when user changes
      const { studentResultsState } = await import("./resultsState");
      const { studentAttendanceState } = await import("./attendanceState");
      const { rankingState } = await import("./rankingState");
      const { sessionAttemptOverrideState } = await import("./sessionOverrideState");

      if (studentResultsState.userId !== currentUserId) {
        studentResultsState.userId = currentUserId;
        studentResultsState.loaded = false;
        studentResultsState.loading = false;
        studentResultsState.list = [];
        studentResultsState.error = "";
      }
      if (studentAttendanceState.userId !== currentUserId) {
        studentAttendanceState.userId = currentUserId;
        studentAttendanceState.loaded = false;
        studentAttendanceState.loading = false;
        studentAttendanceState.list = [];
        studentAttendanceState.error = "";
      }
      if (rankingState.userId !== currentUserId) {
        rankingState.userId = currentUserId;
        rankingState.loaded = false;
        rankingState.loading = false;
        rankingState.list = [];
        rankingState.error = "";
      }
      if (sessionAttemptOverrideState.userId !== currentUserId) {
        sessionAttemptOverrideState.userId = currentUserId;
        sessionAttemptOverrideState.loaded = false;
        sessionAttemptOverrideState.loading = false;
        sessionAttemptOverrideState.map = {};
        sessionAttemptOverrideState.error = "";
        sessionAttemptOverrideState.lastFetchedAt = 0;
      }
    } catch (error) {
      logUnexpectedError("refreshAuthState failed", error);
      authState.session = null;
      authState.profile = null;
      authState.profileError = getErrorMessage(error, "Authentication check failed.");
      state.requireLogin = true;
      resetSessionScopedState();
    } finally {
      authState.checked = true;
      authRefreshPromise = null;
    }
  })();

  return authRefreshPromise;
}

const AUTH_SUBSCRIPTION_KEY = "__jft_student_auth_subscription__";

async function handleAuthStateChange() {
  await refreshAuthState();
  await Promise.allSettled([fetchPublicTests(), fetchTestSessions()]);
}

export function registerAuthStateListener() {
  const globalScope = typeof window !== "undefined" ? window : globalThis;
  const existingSubscription = globalScope[AUTH_SUBSCRIPTION_KEY];
  if (existingSubscription?.unsubscribe) {
    existingSubscription.unsubscribe();
  }

  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "INITIAL_SESSION") {
      return;
    }
    window.setTimeout(() => {
      handleAuthStateChange().finally(triggerRender);
    }, 0);
  });

  globalScope[AUTH_SUBSCRIPTION_KEY] = data?.subscription ?? null;
}
