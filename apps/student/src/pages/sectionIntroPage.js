import { escapeHtml } from "../lib/escapeHtml";
import { topbarHTML, focusWarningHTML } from "../lib/uiHelpers";
import { getCurrentSection, getSectionQuestions } from "../lib/sectionHelpers";
import { getActiveTestType, getActiveTestTitle } from "../lib/sessionHelpers";
import { state, saveState, exitToHome } from "../state/appState";
import { startTestTimer } from "../lib/quizControls";
import { triggerRender } from "../lib/renderBus";

export function renderSectionIntro(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const questionCount = secQs.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  const isDaily = getActiveTestType() === "daily";
  const activeTitle = getActiveTestTitle();
  const sectionTitle = isDaily && activeTitle ? activeTitle : sec.title;

  const isFirstSection = state.sectionIndex === 0;
  const btnLabel = isFirstSection ? "Start Exam (Fullscreen)" : "Next";
  const hintLine = isFirstSection
    ? "When you press Start, the timer begins."
    : "Press Next to continue.";

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({
        rightButtonLabel: "Ready",
        rightButtonId: "disabledBtn",
        hideTimer: true,
      })}

      <main class="content" style="margin:12px;">
        ${focusWarningHTML()}
        <h1 class="prompt section-title">${escapeHtml(sectionTitle)}</h1>

        <div style="line-height:1.7; margin-top:10px;">
          <p>• Questions in this section: <b>${questionCount}</b></p>
          <p>• ${hintLine}</p>
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          ${isFirstSection ? `<button class="nav-btn ghost" id="backHomeBtn">Back</button>` : ""}
          <button class="nav-btn" id="goBtn">${btnLabel}</button>
        </div>
      </main>
    </div>
  `;

  document.querySelector("#disabledBtn").disabled = true;

  if (isFirstSection) {
    document.querySelector("#backHomeBtn")?.addEventListener("click", () => {
      state.studentTab = "home";
      exitToHome();
    });
  }

  document.querySelector("#goBtn").addEventListener("click", async () => {
    if (isFirstSection) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch (e) {
        console.warn("fullscreen failed:", e);
      }
      startTestTimer();
    }
    state.phase = "quiz";
    saveState();
    triggerRender();
  });
}
