import { escapeHtml } from "../lib/escapeHtml";
import { getActiveSections } from "../lib/sectionHelpers";
import { getActiveTestTitle, getActiveTestType, canAccessSession } from "../lib/sessionHelpers";
import { state, saveState, goIntro, resetAll } from "../state/appState";
import { authState } from "../state/authState";
import { testsState, testSessionsState } from "../state/testsState";
import { questionsState, ensureSessionQuestionsAvailable } from "../state/questionsState";
import { supabase } from "../supabaseClient";
import { triggerRender } from "../lib/renderBus";

export function renderIntro(app) {
  const activeSections = getActiveSections();
  const activeTitle = getActiveTestTitle();
  const isGuest = !authState.session;
  const isDaily = getActiveTestType() === "daily";
  const visibleSessions = testSessionsState.list.filter((session) => canAccessSession(session));
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId;
  const activeSession = activeSessionId
    ? testSessionsState.list.find((session) => session.id === activeSessionId)
    : null;
  const linkBlocked = Boolean(state.linkId && activeSession && !canAccessSession(activeSession));
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <h1 class="prompt test-title">${escapeHtml(activeTitle)}</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>• Sections: ${
            activeSections.length
              ? activeSections.map((s) => `<b>${s.title}</b>`).join(" → ")
              : "—"
          }</p>
          ${isDaily ? "" : `<p>• Each section has a timer.</p>`}
          <p>• Answers are saved automatically.</p>
          ${
            state.linkId
              ? `<p style="margin-top:6px;"><b>Guest link active</b> (expires: ${state.linkExpiresAt ? new Date(state.linkExpiresAt).toLocaleString() : "—"})</p>`
              : ""
          }
          ${isDaily ? "" : `<p style="margin-top:6px;"><b>Test</b>: ${escapeHtml(activeTitle)}</p>`}
          ${isDaily ? "" : (authState.session ? `<p style="margin-top:6px;"><b>Logged in</b> (${escapeHtml(authState.session.user.email ?? "")})</p>` : "")}
        </div>

        <div class="intro-form" style="margin-top:16px; max-width:520px;">
          ${
            state.linkId
              ? ""
              : `
                <label class="form-label">Test Session</label>
                <select class="form-input" id="testSelect">
                  ${
                    visibleSessions.length
                      ? visibleSessions
                          .map((t) => {
                            const label = `${t.title} (${t.problem_set_id})`;
                            return `<option value="${escapeHtml(t.id)}" ${
                              t.id === activeSessionId ? "selected" : ""
                            }>${escapeHtml(label)}</option>`;
                          })
                          .join("")
                      : `<option value="">No sessions</option>`
                  }
                </select>
                ${
                  testsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testsState.error)}</div>`
                    : ""
                }
                ${
                  questionsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(questionsState.error)}</div>`
                    : ""
                }
                ${
                  testSessionsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testSessionsState.error)}</div>`
                    : ""
                }
                ${
                  testSessionsState.loaded && visibleSessions.length === 0
                    ? `<div style="margin-top:6px;color:#666;">公開テストがありません。</div>`
                    : ""
                }
              `
          }
          ${
            linkBlocked
              ? `<div style="margin-top:10px;color:#b00;">This retake session is available only to students who failed the original test.</div>`
              : ""
          }

          ${
            isGuest
              ? `
                ${
                  isDaily
                    ? ""
                    : `
                      <label class="form-label">Name（任意）</label>
                      <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

                      <label class="form-label" style="margin-top:10px;">ID（任意）</label>
                      <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
                    `
                }
              `
              : `
                ${
                  isDaily
                    ? ""
                    : `
                      <label class="form-label">Name</label>
                      <div class="form-input readonly">${escapeHtml(state.user?.name ?? "")}</div>
                      <label class="form-label" style="margin-top:10px;">ID</label>
                      <div class="form-input readonly">${escapeHtml(state.user?.id ?? "")}</div>
                    `
                }
              `
          }
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextBtn">Next</button>
          ${!authState.session && !state.linkId ? `<button class="nav-btn ghost" id="loginNavBtn">Log in</button>` : ``}
          <button class="nav-btn ghost" id="resetBtn">Reset</button>
        </div>
      </main>
    </div>
  `;

  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;

  const testSelect = app.querySelector("#testSelect");
  if (testSelect) {
    testSelect.addEventListener("change", () => {
      state.selectedTestSessionId = testSelect.value;
      const session = testSessionsState.list.find((s) => s.id === testSelect.value);
      if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      saveState();
      triggerRender();
    });
  }

  app.querySelector("#nextBtn")?.addEventListener("click", async () => {
    if (isGuest) {
      const name = app.querySelector("#nameInput")?.value.trim() ?? "";
      const id = app.querySelector("#idInput")?.value.trim() ?? "";
      state.user = { name, id };
    }
    if (linkBlocked) {
      window.alert("You are not eligible to take this retake session.");
      return;
    }
    if (!state.linkId && !canAccessSession(activeSession)) {
      window.alert("You are not eligible to take this retake session.");
      return;
    }
    if (!(await ensureSessionQuestionsAvailable(activeSession))) {
      return;
    }
    state.phase = "sectionIntro";
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;

    saveState();
    triggerRender();
  });

  app.querySelector("#signOutBtn")?.addEventListener("click", () => {
    supabase.auth.signOut();
    state.requireLogin = true;
    state.phase = "login";
    saveState();
    triggerRender();
  });
  app.querySelector("#loginNavBtn")?.addEventListener("click", () => {
    state.phase = "login";
    saveState();
    triggerRender();
  });
  app.querySelector("#resetBtn")?.addEventListener("click", resetAll);
}
