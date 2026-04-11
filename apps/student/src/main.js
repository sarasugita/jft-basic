import "./style.css";
import { inject } from "@vercel/analytics";
import { setRenderCallback } from "./lib/renderBus";
import { formatTime } from "./lib/formatters";
import { renderAndSync, registerStudentMenu } from "./lib/uiHelpers";
import { checkLinkFromUrl } from "./lib/linkHelpers";
import { registerFocusWarning } from "./lib/focusWarning";
import {
  state, appBootstrapState, saveState,
  shouldBlockOnQuestions, setLinkStateRefreshCallback,
} from "./state/appState";
import { testsState, testSessionsState, fetchPublicTests, fetchTestSessions } from "./state/testsState";
import { questionsState, ensureQuestionsLoaded, getQuestions } from "./state/questionsState";
import { authState, refreshAuthState, registerAuthStateListener } from "./state/authState";
import { getActiveTestVersion } from "./lib/sessionHelpers";
import { getTotalTimeLeftSec } from "./lib/quizControls";
import { renderLoading, renderQuestionLoadError } from "./pages/loadingPage";
import { renderLogin } from "./pages/loginPage";
import { renderSetPassword } from "./pages/setPasswordPage";
import { renderIntro } from "./pages/introPage";
import { renderLinkInvalid } from "./pages/linkInvalidPage";
import { renderSectionIntro } from "./pages/sectionIntroPage";
import { renderQuiz } from "./pages/quizPage";
import { renderSectionEnd } from "./pages/sectionEndPage";
import { renderResult } from "./pages/resultPage";
import { renderTestSelect } from "./pages/testSelectPage";

inject();

function render() {
  const app = document.querySelector("#app");
  if (appBootstrapState.loading && (!state.linkChecked || !authState.checked)) {
    renderAndSync(renderLoading, app);
    return;
  }
  if (state.linkInvalid) {
    renderAndSync(renderLinkInvalid, app);
    return;
  }
  if (authState.session && authState.mustChangePassword) {
    renderAndSync(renderSetPassword, app);
    return;
  }
  if (state.requireLogin || state.linkLoginRequired) {
    if (state.phase !== "login") {
      state.phase = "login";
      saveState();
    }
    renderAndSync(renderLogin, app);
    return;
  }
  if (!authState.session && !state.linkId) {
    renderAndSync(renderLogin, app);
    return;
  }

  const needsQuestions = shouldBlockOnQuestions();
  const activeVersion = getActiveTestVersion();
  const sessionsReady = testSessionsState.loaded || Boolean(state.linkId);
  const needsDynamicQuestions = Boolean(activeVersion);
  if (needsQuestions && sessionsReady && (testsState.loaded || needsDynamicQuestions)) {
    ensureQuestionsLoaded();
    if (!questionsState.loaded || questionsState.version !== activeVersion) {
      return renderLoading(app);
    }
    if (!getQuestions().length) {
      return renderQuestionLoadError(app);
    }
  }

  if (authState.session && !state.linkId && state.phase === "intro") {
    renderAndSync(renderTestSelect, app);
    return;
  }
  if (state.phase === "login") {
    renderAndSync(renderLogin, app);
    return;
  }
  if (state.phase === "intro") {
    renderAndSync(renderIntro, app);
    return;
  }
  if (state.phase === "sectionIntro") {
    renderAndSync(renderSectionIntro, app);
    return;
  }
  if (state.phase === "quiz") {
    renderAndSync(renderQuiz, app);
    return;
  }
  if (state.phase === "result") {
    renderAndSync(renderResult, app);
  }
}

setRenderCallback(render);
setLinkStateRefreshCallback(checkLinkFromUrl);

setInterval(() => {
  const left = getTotalTimeLeftSec();
  const timerEl = document.querySelector(".timer");
  if (timerEl) timerEl.textContent = formatTime(left);

  if (state.phase !== "quiz") return;

  if (left <= 0) {
    state.testEndAt = state.testEndAt ?? Date.now();
    state.phase = "result";
    saveState();
    render();
  }
}, 1000);

registerAuthStateListener();

Promise.allSettled([checkLinkFromUrl(), refreshAuthState(), fetchPublicTests(), fetchTestSessions()])
  .finally(() => {
    appBootstrapState.loading = false;
    render();
  });

registerFocusWarning();
registerStudentMenu();
