import { topbarHTML } from "../lib/uiHelpers";
import { goIntro } from "../state/appState";

export function renderLinkInvalid(app) {
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Not started", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Link is invalid / expired</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>このリンクは無効、または期限切れです。</p>
        </div>
        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="backBtn">Back</button>
        </div>
      </main>
    </div>
  `;
  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  app.querySelector("#backBtn")?.addEventListener("click", goIntro);
}
