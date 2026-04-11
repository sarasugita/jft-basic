import { escapeHtml } from "../lib/escapeHtml";
import { topbarHTML } from "../lib/uiHelpers";
import { getActiveTestVersion } from "../lib/sessionHelpers";
import { questionsState } from "../state/questionsState";
import { goIntro, resetAll } from "../state/appState";

export function renderLoading(app) {
  app.innerHTML = `
    <div class="app has-topbar app-result">
      ${topbarHTML({ rightButtonLabel: "Loading", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Loading...</h1>
      </main>
    </div>
  `;
  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
}

export function renderQuestionLoadError(app) {
  const version = getActiveTestVersion();
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Unavailable", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Question set could not be loaded.</h1>
        <p style="margin-top:10px;color:#7a2e00;">${escapeHtml(questionsState.error || `No uploaded questions found for ${version || "this session"}.`)}</p>
        ${version ? `<p style="margin-top:6px;color:var(--muted);">Problem Set ID: ${escapeHtml(version)}</p>` : ""}
        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="backToTestSelectBtn">Back to Test Selection</button>
          <button class="nav-btn ghost" id="resetErrorStateBtn">Reset</button>
        </div>
      </main>
    </div>
  `;
  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  app.querySelector("#backToTestSelectBtn")?.addEventListener("click", () => {
    goIntro();
  });
  app.querySelector("#resetErrorStateBtn")?.addEventListener("click", () => {
    resetAll();
  });
}
