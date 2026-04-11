import { escapeHtml } from "../lib/escapeHtml.js";
import { formatDateShort, formatOrdinal } from "../lib/formatters.js";
import { buildRadarSvg, getSectionLabelLines } from "../lib/radarChart.js";
import { getSectionTitle } from "../lib/sectionHelpers.js";
import { state } from "../state/appState.js";
import { authState } from "../state/authState.js";
import { testsState, testSessionsState } from "../state/testsState.js";
import {
  studentResultsState,
  resultDetailState,
  modelRankState,
  fetchQuestionsForDetailWithOptions,
} from "../state/resultsState.js";
import {
  buildResultAttemptEntries,
  getAttemptDateLabel,
  getAttemptTitle,
  getVisibleAttemptScoreSummary,
  formatAttemptScoreCell,
  buildAttemptDetailRows,
  shouldShowAnswers,
  renderDetailTable,
  buildMainSectionSummary,
  buildNestedSectionSummary,
  getAvailableSections,
  isImportedResultsSummaryAttempt,
  renderImportedResultsSummaryDetail,
} from "../lib/attemptHelpers.js";
import { getPassRateForVersion } from "../lib/sessionHelpers.js";
import { triggerRender } from "../lib/renderBus.js";

export function buildModelResultsTabHTML() {
  if (!authState.session) {
    return `<div class="text-muted">Log in to see results.</div>`;
  }
  if (studentResultsState.loading) {
    return `<div class="text-muted">Loading results...</div>`;
  }
  if (studentResultsState.error) {
    return `<div class="text-error">${escapeHtml(studentResultsState.error)}</div>`;
  }

  const modelAttemptEntries = buildResultAttemptEntries("mock", studentResultsState.list);
  const modelAttempts = modelAttemptEntries.map((entry) => entry.attempt);

  if (resultDetailState.open && resultDetailState.mode === "model" && resultDetailState.attempt) {
    const attempt = resultDetailState.attempt;
    const title = getAttemptTitle(attempt);
    const isImportedSummary = isImportedResultsSummaryAttempt(attempt);
    if (isImportedSummary) {
      const detailBody = renderImportedResultsSummaryDetail(attempt, "model");
      return `
        <div class="student-detail-topbar">
          <button class="student-detail-back" id="modelResultBack" aria-label="Back">←</button>
          <div class="student-detail-title">${escapeHtml(title)}</div>
          <div class="student-detail-date">${escapeHtml(getAttemptDateLabel(attempt) || "—")}</div>
        </div>
        <div class="student-detail-body">
          ${detailBody}
        </div>
      `;
    }
    const showAnswers = shouldShowAnswers(attempt, testSessionsState.list, testsState.list);
    const questionsList = resultDetailState.questionsByVersion[attempt.test_version] || [];
    const detailRows = buildAttemptDetailRows(attempt, questionsList);
    const sectionOptions = getAvailableSections(detailRows);
    const mainSummary = buildMainSectionSummary(detailRows);
    const nestedSummary = buildNestedSectionSummary(detailRows);
    const detailScoreSummary = getVisibleAttemptScoreSummary(attempt);
    const detailRate = detailScoreSummary.rate;
    const detailPassRate = getPassRateForVersion(attempt.test_version);
    const detailIsPass = detailRate >= detailPassRate;
    const detailRank = modelRankState.map[attempt.id] || "";
    const detailTotalRank = modelRankState.totalMap[attempt.id] || "";
    const detailDate = attempt?.ended_at || attempt?.created_at;
    const detailRankLabel =
      detailRank && detailTotalRank
        ? `${formatOrdinal(detailRank)} of ${detailTotalRank} students`
        : "—";
    const subTab = resultDetailState.subTab || "score";
    const sectionFilterRaw = resultDetailState.sectionFilter || "";
    const wrongOnly = Boolean(resultDetailState.wrongOnly);
    const sectionFilter = sectionOptions.includes(sectionFilterRaw) ? sectionFilterRaw : "";
    const filteredDetailRows = sectionFilter
      ? detailRows.filter(
          (row) => (getSectionTitle(row.sectionKey) || row.sectionKey || row.section) === sectionFilter
        )
      : detailRows;
    const visibleQuestionRows = wrongOnly
      ? filteredDetailRows.filter((row) => !row.isCorrect)
      : filteredDetailRows;

    const detailFilterHtml =
      subTab === "all"
        ? `
          <div class="student-detail-filter">
            <label for="modelSectionFilter">Section</label>
            <select id="modelSectionFilter">
              <option value="" ${sectionFilter ? "" : "selected"}>All Sections</option>
              ${sectionOptions
                .map(
                  (section) =>
                    `<option value="${escapeHtml(section)}" ${sectionFilter === section ? "selected" : ""}>${escapeHtml(section)}</option>`
                )
                .join("")}
            </select>
            <label class="student-results-check student-detail-check">
              <input id="modelWrongOnlyToggle" type="checkbox" ${wrongOnly ? "checked" : ""} />
              Wrong Questions Only
            </label>
          </div>
        `
        : "";

    const popupRows = Array.isArray(resultDetailState.popupRows) ? resultDetailState.popupRows : [];
    const popupHtml = resultDetailState.popupOpen
      ? `
        <div class="result-modal-overlay" id="resultDetailPopupOverlay">
          <div class="result-modal result-detail-popup" role="dialog" aria-modal="true" aria-labelledby="resultDetailPopupTitle">
            <div class="result-modal-header">
              <div>
                <div class="result-modal-title" id="resultDetailPopupTitle">${escapeHtml(resultDetailState.popupTitle || "Questions")}</div>
                <div class="result-modal-meta">${popupRows.length} question${popupRows.length === 1 ? "" : "s"}</div>
              </div>
              <button class="student-modal-close" type="button" id="resultDetailPopupClose" aria-label="Close">×</button>
            </div>
            <div class="detail-section">
              ${renderDetailTable(popupRows, showAnswers)}
            </div>
          </div>
        </div>
      `
      : "";

    let detailBody = "";
    if (resultDetailState.loading) {
      detailBody = `<div class="text-muted">Loading details...</div>`;
    } else if (resultDetailState.error) {
      detailBody = `<div class="text-error">${escapeHtml(resultDetailState.error)}</div>`;
    } else if (subTab === "score") {
      const totalCorrect = detailScoreSummary.correct;
      const totalQuestions = detailScoreSummary.total;
      const totalRate = totalQuestions ? ((totalCorrect / totalQuestions) * 100).toFixed(1) : "0.0";
      const scorePassRate = getPassRateForVersion(attempt.test_version);
      const radarData = mainSummary.map((row) => ({
        label: row.section,
        value: row.total ? row.correct / row.total : 0,
      }));
      detailBody = mainSummary.length
        ? `
          <div class="student-score-summary">
            <div class="student-score-row">
              <span class="student-score-label">Total Score</span>
              <span class="student-score-right ${detailIsPass ? "" : "student-score-right-fail"}">
                <span class="student-score-value">
                  <span class="student-score-value-primary">${totalCorrect}</span>
                  <span class="student-score-value-separator">/</span>
                  <span>${totalQuestions}</span>
                </span>
                <span class="student-score-rate">(${totalRate}%)</span>
              </span>
            </div>
            <div class="student-score-row">
              <span class="student-score-label">Pass/Fail</span>
              <span class="student-score-pass ${detailIsPass ? "result-pass-cell" : "result-fail-cell"}">
                ${detailIsPass ? "Pass" : "Fail"}
              </span>
            </div>
            <div class="student-score-row">
              <span class="student-score-label">Class Rank</span>
              <span class="student-score-rank-value">${escapeHtml(detailRankLabel)}</span>
            </div>
          </div>
          <div class="student-radar-wrap">
            ${buildRadarSvg(radarData)}
          </div>
          <div class="detail-table-wrap">
            <table class="detail-table score-detail-table">
              <colgroup>
                <col class="score-detail-col-section" />
                <col class="score-detail-col-subsection" />
                <col class="score-detail-col-total" />
                <col class="score-detail-col-correct" />
                <col class="score-detail-col-rate" />
              </colgroup>
              <thead>
                <tr>
                  <th class="score-detail-head-section">Section</th>
                  <th class="score-detail-head-subsection">Sub-section</th>
                  <th class="score-detail-head-total"><span class="score-detail-head-label score-detail-head-label-total">Total</span></th>
                  <th class="score-detail-head-correct"><span class="score-detail-head-label score-detail-head-label-correct">Correct</span></th>
                  <th class="score-detail-head-rate"><span class="score-detail-head-label score-detail-head-label-rate">%</span></th>
                </tr>
              </thead>
              <tbody>
                ${nestedSummary
                  .map((group) => {
                    const rowSpan = 1 + group.subSections.length;
                    const isGroupBelowPass = group.rate < scorePassRate;
                    const mainLabel = `
                      <button
                        class="score-detail-link score-detail-link-section"
                        type="button"
                      >
                        <span class="score-section-label">
                        ${getSectionLabelLines(group.mainSection)
                          .map((line) => `<span>${escapeHtml(line)}</span>`)
                          .join("")}
                        </span>
                      </button>
                    `;
                    const totalRow = `
                      <tr class="score-section-total-row">
                        <td
                          rowspan="${rowSpan}"
                          class="score-section-group-cell score-detail-trigger-cell score-detail-section-trigger score-detail-cell-section"
                          data-score-drilldown-kind="section"
                          data-score-drilldown-value="${escapeHtml(group.mainSection)}"
                        >${mainLabel}</td>
                        <td
                          class="score-detail-cell-subsection score-detail-trigger-cell score-detail-total-trigger"
                          data-score-drilldown-kind="section"
                          data-score-drilldown-value="${escapeHtml(group.mainSection)}"
                        ><span class="score-detail-total-label">Total</span></td>
                        <td class="score-detail-cell-total">${group.total}</td>
                        <td class="score-detail-cell-correct ${isGroupBelowPass ? "score-detail-below-pass" : ""}">${group.correct}</td>
                        <td class="score-detail-cell-rate ${isGroupBelowPass ? "score-detail-below-pass" : ""}">${(group.rate * 100).toFixed(1)}%</td>
                      </tr>
                    `;
                    const subRows = group.subSections
                      .map((subSection) => {
                        const isSubSectionBelowPass = subSection.rate < scorePassRate;
                        return `
                          <tr
                            class="score-detail-subsection-row score-detail-subsection-trigger"
                            data-score-drilldown-kind="subSection"
                            data-score-drilldown-value="${escapeHtml(subSection.section)}"
                          >
                            <td
                              class="score-detail-cell-subsection"
                            >
                              <button
                                class="score-detail-link score-detail-link-subsection"
                                type="button"
                              >
                                ${escapeHtml(subSection.section)}
                              </button>
                            </td>
                            <td class="score-detail-cell-total">${subSection.total}</td>
                            <td class="score-detail-cell-correct ${isSubSectionBelowPass ? "score-detail-below-pass" : ""}">${subSection.correct}</td>
                            <td class="score-detail-cell-rate ${isSubSectionBelowPass ? "score-detail-below-pass" : ""}">${(subSection.rate * 100).toFixed(1)}%</td>
                          </tr>
                        `;
                      })
                      .join("");
                    return `${totalRow}${subRows}`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : `<div class="text-muted">No score data.</div>`;
    } else {
      detailBody = visibleQuestionRows.length
        ? renderDetailTable(visibleQuestionRows, showAnswers)
        : `<div class="text-muted">${wrongOnly ? "No wrong questions." : "No questions available."}</div>`;
    }

    return `
      <div class="student-detail-topbar">
        <button class="student-detail-back" id="modelResultBack" aria-label="Back">←</button>
        <div class="student-detail-title">${escapeHtml(title)}</div>
        <div class="student-detail-date">${escapeHtml(detailDate ? formatDateShort(detailDate) : "—")}</div>
      </div>
      <div class="student-detail-tabs">
        <button class="student-detail-tab ${subTab === "score" ? "active" : ""}" data-model-detail-tab="score">Score Details</button>
        <button class="student-detail-tab ${subTab === "all" ? "active" : ""}" data-model-detail-tab="all">All Questions</button>
      </div>
      <div class="student-detail-body">
        ${detailFilterHtml}
        ${detailBody}
      </div>
      ${popupHtml}
    `;
  }

  if (!modelAttempts.length) {
    return `<div class="text-muted">No model test results yet.</div>`;
  }

  return `
    <div class="student-results-header">
      <div class="student-results-title">Model Test Results</div>
    </div>
    <div class="detail-table-wrap">
      <table class="detail-table student-results-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Test Name</th>
            <th class="col-pf">P/F</th>
            <th>Total %</th>
            <th class="col-total-score">Total<br />Score</th>
            <th>Class Rank</th>
          </tr>
        </thead>
        <tbody>
          ${modelAttemptEntries
            .map((entry) => {
              const attempt = entry.attempt;
              const scoreSummary = getVisibleAttemptScoreSummary(attempt);
              const isPass = entry.effectivePass;
              const rank = modelRankState.map[attempt.id] || "";
              const totalRank = modelRankState.totalMap[attempt.id] || "";
              const rankLabel = rank && totalRank ? `${rank}/${totalRank}` : "—";
              const passLabel = entry.convertedToPass
                ? "Converted to Pass"
                : entry.actualPass
                  ? "Pass"
                  : "Fail";
              return `
                <tr class="student-results-row" data-model-attempt-id="${attempt.id}">
                  <td>${escapeHtml(getAttemptDateLabel(attempt))}</td>
                  <td>${escapeHtml(getAttemptTitle(attempt))}</td>
                  <td class="col-pf ${entry.convertedToPass ? "result-converted-cell" : isPass ? "result-pass-cell" : "result-fail-cell"}">${passLabel}</td>
                  <td>${(scoreSummary.rate * 100).toFixed(1)}%</td>
                  <td class="col-total-score">${escapeHtml(formatAttemptScoreCell(attempt, scoreSummary))}</td>
                  <td>${escapeHtml(rankLabel)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function bindModelResultsTabEvents(app) {
  app.querySelectorAll("[data-model-attempt-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      const attemptId = row.dataset.modelAttemptId;
      const attempt = studentResultsState.list.find((a) => a.id === attemptId);
      if (!attempt) return;
      resultDetailState.open = true;
      resultDetailState.mode = "model";
      resultDetailState.subTab = "score";
      resultDetailState.sectionFilter = "";
      resultDetailState.wrongOnly = false;
      resultDetailState.popupOpen = false;
      resultDetailState.popupTitle = "";
      resultDetailState.popupRows = [];
      resultDetailState.attempt = attempt;
      resultDetailState.error = "";
      resultDetailState.loading = false;
      if (!isImportedResultsSummaryAttempt(attempt) && attempt.test_version) {
        resultDetailState.loading = true;
        await fetchQuestionsForDetailWithOptions(attempt.test_version, { force: true });
      }
      resultDetailState.loading = false;
      triggerRender();
    });
  });

  app.querySelectorAll("[data-model-detail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.modelDetailTab || "score";
      resultDetailState.subTab = next;
      resultDetailState.popupOpen = false;
      resultDetailState.popupTitle = "";
      resultDetailState.popupRows = [];
      if (next === "score") {
        resultDetailState.sectionFilter = "";
        resultDetailState.wrongOnly = false;
      }
      triggerRender();
    });
  });

  app.querySelector("#modelSectionFilter")?.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    resultDetailState.sectionFilter = event.target.value;
    triggerRender();
  });

  app.querySelector("#modelWrongOnlyToggle")?.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    resultDetailState.wrongOnly = event.target.checked;
    triggerRender();
  });

  app.querySelectorAll("[data-score-drilldown-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.scoreDrilldownKind || "";
      const value = button.dataset.scoreDrilldownValue || "";
      const attempt = resultDetailState.attempt;
      if (!attempt) return;
      const questionsList = resultDetailState.questionsByVersion[attempt.test_version] || [];
      const rows = buildAttemptDetailRows(attempt, questionsList);
      const filteredRows =
        kind === "section"
          ? rows.filter(
              (row) => (getSectionTitle(row.sectionKey) || row.sectionKey || row.section) === value
            )
          : rows.filter((row) => row.section === value);
      resultDetailState.popupOpen = true;
      resultDetailState.popupTitle = kind === "section" ? `Section: ${value}` : `Sub-Section: ${value}`;
      resultDetailState.popupRows = filteredRows;
      triggerRender();
    });
  });

  app.querySelector("#resultDetailPopupClose")?.addEventListener("click", () => {
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    triggerRender();
  });

  app.querySelector("#resultDetailPopupOverlay")?.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    triggerRender();
  });

  app.querySelector("#modelResultBack")?.addEventListener("click", () => {
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
