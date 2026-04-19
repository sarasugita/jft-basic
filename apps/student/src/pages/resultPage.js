import { escapeHtml } from "../lib/escapeHtml";
import { topbarHTML } from "../lib/uiHelpers";
import { scoreAll } from "../lib/quizControls";
import { getActiveTestVersion, getActivePassRate, getActiveTestSession, getActiveTestTitle } from "../lib/sessionHelpers";
import { isMissingTabLeftCountError } from "../lib/errorHelpers";
import { state, saveState, exitToHome } from "../state/appState";
import { authState } from "../state/authState";
import { studentResultsState } from "../state/resultsState";
import { testsState, testSessionsState } from "../state/testsState";
import { supabase } from "../supabaseClient";
import { buildResultRows, getAttemptDedupKey, shouldShowAnswers } from "../lib/attemptHelpers";

let pendingAttemptSave = null;
let pendingAttemptSaveKey = "";

async function saveAttemptIfNeeded(app) {
  const statusEl = app.querySelector("#saveStatus");
  if (state.attemptSaved) {
    if (statusEl) statusEl.textContent = "Saved";
    return pendingAttemptSave;
  }

  const { correct, total } = scoreAll();
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId || null;
  const activeSession = getActiveTestSession();
  const tabLeftCount = Math.max(
    0,
    Number(state.tabLeftCount ?? state.focusWarnings ?? 0)
  );
  const payload = {
    student_id: authState.session?.user?.id ?? null,
    display_name: state.user?.name?.trim() || null,
    student_code: state.user?.id?.trim() || null,
    test_version: getActiveTestVersion(),
    test_session_id: activeSessionId,
    correct,
    total,
    started_at: state.testStartAt ? new Date(state.testStartAt).toISOString() : null,
    ended_at: state.testEndAt ? new Date(state.testEndAt).toISOString() : new Date().toISOString(),
    answers_json: {
      ...(state.answers ?? {}),
      __meta: {
        tab_left_count: tabLeftCount,
        session_title: activeSession?.title ?? getActiveTestTitle(),
        session_date: activeSession?.starts_at || activeSession?.ends_at || null,
      },
    },
    tab_left_count: tabLeftCount,
    link_id: state.linkId,
  };
  const saveKey = getAttemptDedupKey(payload);

  if (pendingAttemptSave && pendingAttemptSaveKey === saveKey) {
    if (statusEl) statusEl.textContent = "Saving...";
    return pendingAttemptSave;
  }

  if (statusEl) statusEl.textContent = "Saving...";
  pendingAttemptSaveKey = saveKey;
  pendingAttemptSave = (async () => {
    let { error } = await supabase.from("attempts").insert(payload);
    if (error && isMissingTabLeftCountError(error)) {
      const { tab_left_count, ...legacyPayload } = payload;
      ({ error } = await supabase.from("attempts").insert(legacyPayload));
    }
    if (error) {
      console.error("saveAttempt error:", error);
      if (statusEl) statusEl.textContent = `Save failed: ${error.message}`;
      return;
    }

    state.attemptSaved = true;
    studentResultsState.loaded = false;
    saveState();
    const currentStatusEl = app.querySelector("#saveStatus");
    if (currentStatusEl) currentStatusEl.textContent = "Saved";
  })().finally(() => {
    pendingAttemptSave = null;
    pendingAttemptSaveKey = "";
  });

  return pendingAttemptSave;
}

export function renderResult(app) {
  window.scrollTo(0, 0);
  const { correct, total } = scoreAll();
  const rows = buildResultRows();
  const showAnswers = shouldShowAnswers(
    { test_session_id: state.linkTestSessionId || state.selectedTestSessionId || null, test_version: getActiveTestVersion() },
    testSessionsState.list,
    testsState.list,
  );
  const scoreRate = total === 0 ? 0 : correct / total;
  const passRate = getActivePassRate();
  const isPass = scoreRate >= passRate;
  const showExit = Boolean(authState.session);

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Finished", rightButtonId: "disabledBtn", hideTimer: true })}
      <main class="result">
        <div class="result-summary">
          <h1>Result</h1>

          <div class="score-big">
            <span class="score-correct">${correct}</span>
            <span class="score-slash">/</span>
            <span class="score-total">${total}</span>
          </div>
          <div class="result-status" style="color:${isPass ? "#1a7f37" : "#b00"};">
            ${isPass ? "Pass" : "Fail"}
            <span class="result-status-rate"> (${(scoreRate * 100).toFixed(1)}%)</span>
          </div>
          <div class="result-threshold">Pass threshold: ${(passRate * 100).toFixed(0)}%</div>
          <div class="save-status" id="saveStatus"></div>

          <div class="finish-actions">
            ${showExit ? `<button class="btn btn-primary" id="exitTestBtn">Exit Test</button>` : ``}
          </div>
        </div>

        <div class="result-table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th class="col-id">ID</th>
                <th class="col-question">Question</th>
                <th class="col-result">Result</th>
                <th class="col-choice">Chosen Answer</th>
                ${showAnswers ? '<th class="col-choice">Correct Answer</th>' : ""}
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr>
                  <td class="cell-id">${escapeHtml(r.id)}</td>

                  <td class="cell-prompt">
                    ${
                      r.stemAudios?.length || r.stemImages?.length
                        ? `
                          <div class="result-stem-media">
                            ${(r.stemAudios ?? [])
                              .map((src) => `<audio class="result-stem-audio" controls preload="none" src="${src}"></audio>`)
                              .join("")}
                            ${(r.stemImages ?? [])
                              .map((src) => `<img class="result-thumb" src="${src}" alt="q" />`)
                              .join("")}
                          </div>
                        `
                        : ""
                    }
                    <div class="prompt-text">${r.promptHtml || escapeHtml(r.prompt ?? "")}</div>
                  </td>

                  <td class="cell-judge">
                    <span class="badge ${r.isCorrect ? "ok" : "ng"}">
                      ${r.isCorrect ? "○" : "×"}
                    </span>
                  </td>

                  <td class="cell-choice">
                    ${
                      r.chosenImg
                        ? `<img class="result-choice-big" src="${r.chosenImg}" alt="chosen" />`
                        : `<div class="choice-text">${r.chosen ? escapeHtml(r.chosen) : "—"}</div>`
                    }
                  </td>
                  ${showAnswers ? `
                    <td class="cell-choice">
                      ${
                        r.correctImg
                          ? `<img class="result-choice-big" src="${r.correctImg}" alt="correct" />`
                          : `<div class="choice-text">${escapeHtml(r.correct ?? "")}</div>`
                      }
                    </td>
                  ` : ""}

                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;

  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  app.querySelector("#exitTestBtn")?.addEventListener("click", exitToHome);

  saveAttemptIfNeeded(app);
}
