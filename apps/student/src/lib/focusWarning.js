import { fetchTestSessions, testSessionsState } from "../state/testsState";
import { state, saveState } from "../state/appState";
import { triggerRender } from "./renderBus";

export function registerFocusWarning() {
  const bumpWarning = () => {
    const now = Date.now();
    if (now - (state.focusWarningAt || 0) < 1000) return;
    if (!["quiz", "sectionIntro"].includes(state.phase)) return;
    state.focusWarnings = (state.focusWarnings || 0) + 1;
    state.tabLeftCount = (state.tabLeftCount || 0) + 1;
    state.focusWarningAt = now;
    saveState();
    triggerRender();
  };

  const refreshTestCatalog = () => {
    if (testSessionsState.loading) return;
    Promise.allSettled([fetchTestSessions()]).finally(triggerRender);
  };

  const handleVisibilityChange = () => {
    if (document.hidden || document.visibilityState === "hidden") {
      bumpWarning();
      return;
    }
    refreshTestCatalog();
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("focus", refreshTestCatalog);
  window.addEventListener("blur", bumpWarning);
  window.addEventListener("pagehide", bumpWarning);
  document.addEventListener("freeze", bumpWarning);
}
