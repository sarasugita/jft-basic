import { escapeHtml } from "../lib/escapeHtml.js";
import { state, saveState } from "../state/appState.js";
import { authState } from "../state/authState.js";
import { testsState, testSessionsState } from "../state/testsState.js";
import {
  studentResultsState,
  resultDetailState,
  fetchQuestionsForDetailWithOptions,
} from "../state/resultsState.js";
import {
  buildResultAttemptEntries,
  getAttemptDateLabel,
  getAttemptTitle,
  getAttemptCategory,
  getVisibleAttemptScoreSummary,
  formatAttemptScoreCell,
  buildAttemptDetailRows,
  shouldShowAnswers,
  renderDetailTable,
} from "../lib/attemptHelpers.js";
import { triggerRender } from "../lib/renderBus.js";

export function buildDailyResultsTabHTML() {
  if (!authState.session) {
    return `<div class="text-muted">Log in to see results.</div>`;
  }
  if (studentResultsState.loading) {
    return `<div class="text-muted">Loading results...</div>`;
  }
  if (studentResultsState.error) {
    return `<div class="text-error">${escapeHtml(studentResultsState.error)}</div>`;
  }

  const dailyAttemptEntries = buildResultAttemptEntries("daily", studentResultsState.list);
  const dailyAttempts = dailyAttemptEntries.map((entry) => entry.attempt);
  const dailyCategories = Array.from(
    new Set(
      (testsState.list ?? [])
        .filter((t) => t.type === "daily")
        .map((t) => getAttemptCategory({ test_version: t.version }, testsState.list))
    )
  ).filter(Boolean);
  const rawCategoryFilter = state.dailyResultsCategory || "";
  const categoryFilter = dailyCategories.includes(rawCategoryFilter) ? rawCategoryFilter : "";
  const failedOnly = Boolean(state.dailyResultsFailedOnly);
  const filteredAttemptEntries = dailyAttemptEntries.filter((entry) => {
    if (categoryFilter && getAttemptCategory(entry.attempt) !== categoryFilter) return false;
    if (failedOnly && (entry.hideFromFailedOnly || entry.actualPass)) return false;
    return true;
  });

  if (resultDetailState.open && resultDetailState.mode === "daily" && resultDetailState.attempt) {
    const attempt = resultDetailState.attempt;
    const title = getAttemptTitle(attempt);
    const showAnswers = shouldShowAnswers(attempt, testSessionsState.list, testsState.list);
    const questionsList = resultDetailState.questionsByVersion[attempt.test_version] || [];
    const detailRows = buildAttemptDetailRows(attempt, questionsList);
    const detailBody = resultDetailState.loading
      ? `<div class="text-muted">Loading details...</div>`
      : resultDetailState.error
        ? `<div class="text-error">${escapeHtml(resultDetailState.error)}</div>`
        : renderDetailTable(detailRows, showAnswers);
    return `
      <div class="student-detail-topbar">
        <button class="student-detail-back" id="dailyResultBack" aria-label="Back">←</button>
        <div class="student-detail-title">${escapeHtml(title)}</div>
      </div>
      <div class="student-detail-body">
        ${detailBody}
      </div>
    `;
  }

  if (!filteredAttemptEntries.length) {
    return `<div class="text-muted">No daily test results yet.</div>`;
  }

  return `
    <div class="student-results-header">
      <div class="student-results-title">Daily Test Results</div>
      <div class="student-results-filter">
        <label for="dailyCategorySelect">Category</label>
        <select id="dailyCategorySelect">
          <option value="" ${categoryFilter ? "" : "selected"}>All Categories</option>
          ${dailyCategories
            .map(
              (c) =>
                `<option value="${escapeHtml(c)}" ${categoryFilter === c ? "selected" : ""}>${escapeHtml(c)}</option>`
            )
            .join("")}
        </select>
        <label class="student-results-check">
          <input id="dailyFailedOnlyToggle" type="checkbox" ${failedOnly ? "checked" : ""} />
          Failed only
        </label>
      </div>
    </div>
    <div class="detail-table-wrap">
      <table class="detail-table student-results-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Test Name</th>
            <th>Score</th>
            <th>%</th>
            <th>Pass/Fail</th>
          </tr>
        </thead>
        <tbody>
          ${filteredAttemptEntries
            .map((entry) => {
              const attempt = entry.attempt;
              const scoreSummary = getVisibleAttemptScoreSummary(attempt);
              const isPass = entry.effectivePass;
              const passLabel = entry.convertedToPass
                ? "Converted to Pass"
                : entry.actualPass
                  ? "Pass"
                  : "Fail";
              return `
                <tr class="student-results-row" data-daily-attempt-id="${attempt.id}">
                  <td>${escapeHtml(getAttemptDateLabel(attempt))}</td>
                  <td>${escapeHtml(getAttemptTitle(attempt))}</td>
                  <td>${escapeHtml(formatAttemptScoreCell(attempt, scoreSummary))}</td>
                  <td>${(scoreSummary.rate * 100).toFixed(1)}%</td>
                  <td class="col-pf ${entry.convertedToPass ? "result-converted-cell" : isPass ? "result-pass-cell" : "result-fail-cell"}">${passLabel}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function bindDailyResultsTabEvents(app) {
  app.querySelector("#dailyCategorySelect")?.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    state.dailyResultsCategory = event.target.value;
    saveState();
    triggerRender();
  });

  app.querySelector("#dailyFailedOnlyToggle")?.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    state.dailyResultsFailedOnly = event.target.checked;
    saveState();
    triggerRender();
  });

  app.querySelectorAll("[data-daily-attempt-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      const attemptId = row.dataset.dailyAttemptId;
      const attempt = studentResultsState.list.find((a) => a.id === attemptId);
      if (!attempt) return;
      resultDetailState.open = true;
      resultDetailState.mode = "daily";
      resultDetailState.subTab = "score";
      resultDetailState.sectionFilter = "";
      resultDetailState.wrongOnly = false;
      resultDetailState.popupOpen = false;
      resultDetailState.popupTitle = "";
      resultDetailState.popupRows = [];
      resultDetailState.attempt = attempt;
      resultDetailState.error = "";
      if (attempt.test_version) {
        await fetchQuestionsForDetailWithOptions(attempt.test_version, { force: true });
      }
      triggerRender();
    });
  });

  app.querySelector("#dailyResultBack")?.addEventListener("click", () => {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.sectionFilter = "";
    resultDetailState.wrongOnly = false;
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    resultDetailState.attempt = null;
    triggerRender();
  });
}
