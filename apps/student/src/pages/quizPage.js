import { topbarHTML, focusWarningHTML } from "../lib/uiHelpers";
import { sidebarHTML, renderQuestionGroupHTML } from "../lib/questionRenderers";
import { getCurrentSection, getSectionQuestions, getCurrentQuestion, getActiveSections } from "../lib/sectionHelpers";
import { getActiveTestType } from "../lib/sessionHelpers";
import { state, saveState } from "../state/appState";
import {
  getTotalTimeLeftSec, toggleBangla, jumpToQuestionInSection,
  setSingleAnswer, setPartAnswer, goPrevQuestion, goNextQuestionOrEnd, finishSection,
} from "../lib/quizControls";
import { triggerRender } from "../lib/renderBus";

export function renderQuiz(app) {
  if (getTotalTimeLeftSec() <= 0) {
    state.phase = "result";
    saveState();
    triggerRender();
    return;
  }

  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const group = getCurrentQuestion();
  const isDaily = getActiveTestType() === "daily";
  const isLastQuestion = state.questionIndexInSection >= secQs.length - 1;
  const isLastSection = state.sectionIndex >= getActiveSections().length - 1;
  const finishLabel = isDaily ? "Finish Test" : "Finish Section";
  const nextLabel = isDaily
    ? (isLastQuestion ? "Finish Test ▶" : "Next ▶")
    : (isLastQuestion
        ? (isLastSection ? "Finish Test ▶" : "Finish Section ▶")
        : "Next ▶");

  app.innerHTML = `
    <div class="app has-topbar ${isDaily ? "" : "has-bottombar"}">
      ${topbarHTML({ rightButtonLabel: finishLabel, rightButtonId: "finishBtn" })}
      <div class="body">
        ${sidebarHTML()}
        <main class="content">
          ${focusWarningHTML()}
          ${renderQuestionGroupHTML(group)}
          ${
            isDaily
              ? `
                <div class="question-nav">
                  <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                  <button class="nav-btn ${isLastQuestion ? "danger" : ""}" id="nextBtn">${nextLabel}</button>
                </div>
              `
              : ""
          }
        </main>
      </div>
      ${
        isDaily
          ? ""
          : `
            <footer class="bottombar">
              <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
              <div class="bottom-right">
                <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                <button class="nav-btn ${isLastQuestion ? "danger" : ""}" id="nextBtn">${nextLabel}</button>
              </div>
            </footer>
          `
      }
    </div>
  `;

  // Bangla toggle
  document.querySelector("#banglaBtn")?.addEventListener("click", toggleBangla);

  // Sidebar step jump
  document.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToQuestionInSection(Number(btn.dataset.step)));
  });

  // Choice click (single)
  document.querySelectorAll("[data-choice]").forEach((btn) => {
    const part = btn.dataset.part;
    const choice = Number(btn.dataset.choice);
    const qid = btn.dataset.qid || "";
    if (!qid) return;
    if (part == null) {
      btn.addEventListener("click", () => setSingleAnswer(qid, choice));
    } else {
      btn.addEventListener("click", () => setPartAnswer(qid, Number(part), choice));
    }
  });

  // Nav
  document.querySelector("#backBtn")?.addEventListener("click", goPrevQuestion);
  document.querySelector("#nextBtn")?.addEventListener("click", goNextQuestionOrEnd);

  document.querySelector("#finishBtn")?.addEventListener("click", finishSection);
}
