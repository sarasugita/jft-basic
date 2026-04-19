import { escapeHtml } from "./escapeHtml";
import { formatTime } from "./formatters";
import { state, saveState } from "../state/appState";
import { resultDetailState, fetchStudentResults, refreshQuestionsForResultAttempts, studentResultsState } from "../state/resultsState";
import { studentAttendanceState, fetchStudentAttendance } from "../state/attendanceState";
import { rankingState, fetchStudentRanking } from "../state/rankingState";
import { getCurrentSection, getQuestionProgress, getSectionQuestions } from "./sectionHelpers";
import { getActiveTestType, getActiveTestTitle } from "./sessionHelpers";
import { triggerRender } from "./renderBus";
import { getTotalTimeLeftSec } from "./quizControls";

export function renderCandidateLabel() {
  const name = state.user?.name?.trim();
  const id = state.user?.id?.trim();
  if (name && id) return `${name} (${id})`;
  if (name) return name;
  return "Guest";
}

export function topbarHTML({ rightButtonLabel = "Finish Test", rightButtonId = "finishBtn", hideTimer = false } = {}) {
  const sec = getCurrentSection();
  const questionProgress = getQuestionProgress();
  const sectionQuestions = sec ? getSectionQuestions(sec.key) : [];
  const hideQA = state.phase === "intro" || state.phase === "sectionIntro" || state.phase === "result";
  const testType = getActiveTestType();
  const testTitle = getActiveTestTitle();
  const testLabel = testTitle?.trim() || (testType === "daily" ? "Daily Test" : "Model Test");
  const isDailyActive = testType === "daily" && !hideQA;
  const questionLabel = isDailyActive
    ? `${questionProgress.current}/${questionProgress.total}`
    : `${Math.min(state.questionIndexInSection + 1, Math.max(sectionQuestions.length, 0))}/${sectionQuestions.length}`;
  const metaHtml = hideQA
    ? `<div><span class="muted">Question:</span> <b>—</b></div><div><span class="muted">Section:</span> <b>—</b></div>`
    : `<div class="${isDailyActive ? "topbar-question" : ""}"><span class="muted">Question:</span> <b>${questionLabel}</b></div><div class="${isDailyActive ? "topbar-section" : ""}"><span class="muted">Section:</span> <b>${sec?.title ?? "—"}</b></div>`;
  const timerHtml = hideTimer ? "" : `<div class="timer-label">Test Time Remaining</div><div class="timer">${formatTime(getTotalTimeLeftSec())}</div>`;
  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-meta ${isDailyActive ? "daily-meta" : ""}">${metaHtml}</div>
        <div class="topbar-test">${escapeHtml(testLabel)}</div>
      </div>
      <div class="topbar-center">${timerHtml}</div>
      <div class="topbar-right">
        <button class="finish-btn" id="${rightButtonId}">${rightButtonLabel}</button>
        <div class="candidate">Candidate: <b>${renderCandidateLabel()}</b></div>
      </div>
    </header>
  `;
}

export function syncTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const height = Math.ceil(topbar.getBoundingClientRect().height);
  if (height > 0) {
    document.documentElement.style.setProperty("--topbar-height", `${height}px`);
  }
}

export function renderAndSync(fn, app) {
  fn(app);
  requestAnimationFrame(syncTopbarHeight);
}

export function focusWarningHTML() {
  const count = Math.max(0, Number(state.tabLeftCount ?? state.focusWarnings ?? 0));
  if (!count) return "";
  return `<div class="focus-warning"><b>Warning:</b> You left the exam tab. Count: ${count}</div>`;
}

export function setStudentMenuOpen(isOpen) {
  const overlay = document.querySelector("#studentMenuOverlay");
  const btn = document.querySelector("#studentMenuBtn");
  if (!overlay || !btn) return;
  btn.setAttribute("aria-expanded", String(isOpen));
  overlay.hidden = !isOpen;
}

export function closeStudentMenu() {
  setStudentMenuOpen(false);
}

export function registerStudentMenu() {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const overlay = document.querySelector("#studentMenuOverlay");
    const menu = document.querySelector("#studentMenu");
    const btn = document.querySelector("#studentMenuBtn");
    if (!overlay || !menu || !btn) return;

    const clickedButton = event.target.closest("#studentMenuBtn");
    const clickedMenu = event.target.closest("#studentMenu");
    const clickedTab = event.target.closest("[data-student-tab]");
    const clickedClose = event.target.closest("[data-student-menu-close]");

    if (clickedClose) {
      closeStudentMenu();
      return;
    }

    if (clickedTab) {
      const nextTab = clickedTab.dataset.studentTab || "home";
      state.studentTab = nextTab;
      resultDetailState.open = false;
      resultDetailState.mode = "";
      resultDetailState.subTab = "score";
      resultDetailState.sectionFilter = "";
      resultDetailState.wrongOnly = false;
      resultDetailState.popupOpen = false;
      resultDetailState.popupTitle = "";
      resultDetailState.popupRows = [];
      resultDetailState.attempt = null;
      saveState();
      closeStudentMenu();
      if ((nextTab === "dailyResults" || nextTab === "modelResults") && !studentResultsState.loaded) {
        fetchStudentResults().finally(triggerRender);
        return;
      }
      if ((nextTab === "dailyResults" || nextTab === "modelResults") && studentResultsState.loaded) {
        refreshQuestionsForResultAttempts(studentResultsState.list, { force: true }).finally(triggerRender);
        return;
      }
      if (nextTab === "ranking" && !rankingState.loaded) {
        fetchStudentRanking().finally(triggerRender);
        return;
      }
      if (nextTab === "attendance" && !studentAttendanceState.loaded) {
        fetchStudentAttendance().finally(triggerRender);
        return;
      }
      triggerRender();
      return;
    }

    if (clickedButton) {
      setStudentMenuOpen(overlay.hidden);
      return;
    }

    if (!overlay.hidden && !clickedMenu) {
      closeStudentMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStudentMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeStudentMenu();
  });
}

export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
