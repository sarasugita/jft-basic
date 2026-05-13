import { escapeHtml } from "../lib/escapeHtml";
import { topbarHTML } from "../lib/uiHelpers";
import { scoreAll } from "../lib/quizControls";
import { getActiveTestVersion, getActivePassRate, getActiveTestSession, getActiveTestTitle } from "../lib/sessionHelpers";
import { isMissingTabLeftCountError } from "../lib/errorHelpers";
import { state, saveState, exitToHome, getCurrentTabLeftCount } from "../state/appState";
import { authState } from "../state/authState";
import { studentResultsState } from "../state/resultsState";
import { testsState, testSessionsState } from "../state/testsState";
import { supabase } from "../supabaseClient";
import { buildResultRows, getAttemptDedupKey, shouldShowAnswers } from "../lib/attemptHelpers";

let pendingAttemptSave = null;
let pendingAttemptSaveKey = "";
const UNSAVED_EXIT_MESSAGE = "Your result has not been saved yet. If you leave now, this attempt may be lost. Do you want to leave anyway?";
const resultSaveState = {
  status: "idle",
  errorMessage: "",
  lastSaveKey: "",
};
let beforeUnloadRegistered = false;

function shouldWarnUnsavedResult() {
  return state.phase === "result" && Boolean(authState.session) && state.attemptSaved !== true;
}

function handleBeforeUnload(event) {
  if (!shouldWarnUnsavedResult()) return;
  event.preventDefault();
  event.returnValue = "";
}

function syncBeforeUnloadWarning() {
  if (typeof window === "undefined") return;
  const shouldWarn = shouldWarnUnsavedResult();
  if (shouldWarn && !beforeUnloadRegistered) {
    window.addEventListener("beforeunload", handleBeforeUnload);
    beforeUnloadRegistered = true;
    return;
  }
  if (!shouldWarn && beforeUnloadRegistered) {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    beforeUnloadRegistered = false;
  }
}

function buildAttemptPayload() {
  const { correct, total } = scoreAll();
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId || null;
  const activeSession = getActiveTestSession();
  const tabLeftCount = getCurrentTabLeftCount();
  return {
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
        focus_warnings: tabLeftCount,
        session_title: activeSession?.title ?? getActiveTestTitle(),
        session_date: activeSession?.starts_at || activeSession?.ends_at || null,
      },
    },
    tab_left_count: tabLeftCount,
    link_id: state.linkId,
  };
}

function getSaveStatusClass() {
  if (resultSaveState.status === "failed") return " error";
  if (resultSaveState.status === "saving") return " saving";
  if (resultSaveState.status === "saved") return " saved";
  return "";
}

function getSaveStatusMessage() {
  if (state.attemptSaved) {
    return "Saved";
  }
  if (resultSaveState.status === "failed") {
    return `Save failed: ${resultSaveState.errorMessage || "Please try again."}`;
  }
  if (resultSaveState.status === "saving") {
    return "Saving result...";
  }
  return "";
}

function renderSaveStatus(app) {
  const statusEl = app.querySelector("#saveStatus");
  if (statusEl) {
    statusEl.className = `save-status${getSaveStatusClass()}`;
    statusEl.textContent = getSaveStatusMessage();
  }
  const retryBtn = app.querySelector("#retrySaveBtn");
  if (retryBtn) {
    retryBtn.disabled = resultSaveState.status === "saving";
  }
}

function renderAfterSaveSuccess(app) {
  resultSaveState.status = "saved";
  resultSaveState.errorMessage = "";
  syncBeforeUnloadWarning();
  renderResult(app);
}

function syncSaveStateForAttempt() {
  if (state.attemptSaved) return;
  const saveKey = getAttemptDedupKey(buildAttemptPayload());
  if (resultSaveState.lastSaveKey && resultSaveState.lastSaveKey !== saveKey) {
    resultSaveState.status = "idle";
    resultSaveState.errorMessage = "";
    resultSaveState.lastSaveKey = "";
  }
}

function isCurrentSaveAttempt(saveKey) {
  if (state.phase !== "result") return false;
  return getAttemptDedupKey(buildAttemptPayload()) === saveKey;
}

async function saveAttemptIfNeeded(app, { force = false } = {}) {
  if (state.attemptSaved) {
    resultSaveState.status = "saved";
    resultSaveState.errorMessage = "";
    renderSaveStatus(app);
    syncBeforeUnloadWarning();
    return pendingAttemptSave;
  }

  const payload = buildAttemptPayload();
  const saveKey = getAttemptDedupKey(payload);

  if (pendingAttemptSave && pendingAttemptSaveKey === saveKey) {
    resultSaveState.status = "saving";
    resultSaveState.errorMessage = "";
    resultSaveState.lastSaveKey = saveKey;
    renderSaveStatus(app);
    return pendingAttemptSave;
  }

  if (!force && resultSaveState.status === "failed" && resultSaveState.lastSaveKey === saveKey) {
    renderSaveStatus(app);
    return pendingAttemptSave;
  }

  resultSaveState.status = "saving";
  resultSaveState.errorMessage = "";
  resultSaveState.lastSaveKey = saveKey;
  renderSaveStatus(app);
  syncBeforeUnloadWarning();
  pendingAttemptSaveKey = saveKey;
  pendingAttemptSave = (async () => {
    let { error } = await supabase.from("attempts").insert(payload);
    if (error && isMissingTabLeftCountError(error)) {
      const { tab_left_count, ...legacyPayload } = payload;
      ({ error } = await supabase.from("attempts").insert(legacyPayload));
    }
    if (error) {
      console.error("saveAttempt error:", error);
      if (!isCurrentSaveAttempt(saveKey)) return;
      resultSaveState.status = "failed";
      resultSaveState.errorMessage = error.message || "Please try again.";
      syncBeforeUnloadWarning();
      renderResult(app);
      return;
    }

    if (!isCurrentSaveAttempt(saveKey)) return;
    state.attemptSaved = true;
    studentResultsState.loaded = false;
    saveState();
    renderAfterSaveSuccess(app);
  })().finally(() => {
    pendingAttemptSave = null;
    pendingAttemptSaveKey = "";
  });

  return pendingAttemptSave;
}

function resultSummaryHTML({ correct, total, isPass, passRate, showExit }) {
  return `
    <div class="result-summary">
      <h1>Result</h1>

      <div class="score-big">
        <span class="score-correct">${correct}</span>
        <span class="score-slash">/</span>
        <span class="score-total">${total}</span>
      </div>
      <div class="result-status" style="color:${isPass ? "#1a7f37" : "#b00"};">
        ${isPass ? "Pass" : "Fail"}
        <span class="result-status-rate"> (${total === 0 ? "0.0" : ((correct / total) * 100).toFixed(1)}%)</span>
      </div>
      <div class="result-threshold">Pass threshold: ${(passRate * 100).toFixed(0)}%</div>
      <div class="save-status${getSaveStatusClass()}" id="saveStatus">${escapeHtml(getSaveStatusMessage())}</div>
      ${
        resultSaveState.status === "failed" && !state.attemptSaved
          ? `<div class="result-save-actions"><button class="btn btn-primary" id="retrySaveBtn" type="button">Retry Save</button></div>`
          : ""
      }

      <div class="finish-actions">
        ${showExit ? `<button class="btn btn-primary" id="exitTestBtn">Exit Test</button>` : ``}
      </div>
    </div>
  `;
}

function resultTableHTML({ rows, showAnswers }) {
  return `
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
  `;
}

function handleExitTest() {
  if (state.attemptSaved || !shouldWarnUnsavedResult() || window.confirm(UNSAVED_EXIT_MESSAGE)) {
    exitToHome();
    syncBeforeUnloadWarning();
  }
}

export function renderResult(app) {
  window.scrollTo(0, 0);
  const { correct, total } = scoreAll();
  const scoreRate = total === 0 ? 0 : correct / total;
  const passRate = getActivePassRate();
  const isPass = scoreRate >= passRate;
  const showExit = Boolean(authState.session);
  if (state.attemptSaved) {
    resultSaveState.status = "saved";
    resultSaveState.errorMessage = "";
  } else {
    syncSaveStateForAttempt();
  }
  const tableHtml = state.attemptSaved
    ? resultTableHTML({
      rows: buildResultRows(),
      showAnswers: shouldShowAnswers(
        { test_session_id: state.linkTestSessionId || state.selectedTestSessionId || null, test_version: getActiveTestVersion() },
        testSessionsState.list,
        testsState.list,
      ),
    })
    : "";

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Finished", rightButtonId: "disabledBtn", hideTimer: true })}
      <main class="result">
        ${resultSummaryHTML({ correct, total, isPass, passRate, showExit })}
        ${tableHtml}
      </main>
    </div>
  `;

  const disabledBtn = app.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  app.querySelector("#exitTestBtn")?.addEventListener("click", handleExitTest);
  app.querySelector("#retrySaveBtn")?.addEventListener("click", () => {
    saveAttemptIfNeeded(app, { force: true });
  });
  syncBeforeUnloadWarning();

  saveAttemptIfNeeded(app);
}
