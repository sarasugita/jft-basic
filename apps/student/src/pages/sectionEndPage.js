import { escapeHtml } from "../lib/escapeHtml";
import { topbarHTML } from "../lib/uiHelpers";
import { getCurrentSection, getSectionQuestions, getActiveSections } from "../lib/sectionHelpers";
import { state, saveState } from "../state/appState";
import { triggerRender } from "../lib/renderBus";

export function renderSectionEnd(app) {
  const sec = getCurrentSection();
  const activeSections = getActiveSections();

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Section ended", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">${escapeHtml(sec.title)} — Completed</h1>
        <p style="color:var(--muted);">Next: ${state.sectionIndex === activeSections.length - 1 ? "Results" : escapeHtml(activeSections[state.sectionIndex + 1].title)}</p>

        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextSectionBtn">${state.sectionIndex === activeSections.length - 1 ? "Go to Results" : "Next Section"}</button>
          <button class="nav-btn ghost" id="reviewBtn">Review this section</button>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#nextSectionBtn").addEventListener("click", () => {
    const activeSectionsInner = getActiveSections();
    const nextSectionIndex = state.sectionIndex + 1;

    if (nextSectionIndex >= activeSectionsInner.length) {
      state.phase = "result";
      saveState();
      triggerRender();
      return;
    }

    state.sectionIndex = nextSectionIndex;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;
    state.phase = "sectionIntro";

    saveState();
    triggerRender();
  });

  document.querySelector("#reviewBtn").addEventListener("click", () => {
    state.phase = "quiz";
    saveState();
    triggerRender();
  });
}
