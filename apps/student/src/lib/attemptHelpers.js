import { sections } from "../../../../packages/shared/questions.js";
import { escapeHtml } from "./escapeHtml";
import { formatDateFull, formatDateShort } from "./formatters";
import {
  getEffectiveAnswerIndices,
  getStemMediaAssets,
  isChoiceCorrect,
  normalizeStemKindValue,
  parseSpeakerStemLine,
  splitStemLinesPreserveIndent,
  splitTextBoxStemLines,
} from "./questionHelpers";
import { getPassRateForVersion, getSourceSessionForRetake, isRetakeSession } from "./sessionHelpers";
import { getQuestions } from "../state/questionsState";
import { state } from "../state/appState";
import { resultDetailState } from "../state/resultsState";
import { testsState, testSessionsState } from "../state/testsState";
import { renderSpeakerStemLines, renderUnderlines } from "./questionRenderers";

function getSectionTitle(sectionKey) {
  return sections.find((section) => section.key === sectionKey)?.title ?? sectionKey ?? "";
}

function getChoiceText(question, index) {
  if (index == null) return "";
  if (Array.isArray(question?.choices) && question.choices[index] != null) return question.choices[index];
  if (Array.isArray(question?.choicesJa) && question.choicesJa[index] != null) return question.choicesJa[index];
  return "";
}

function pickChoiceImage(question, index) {
  if (index == null) return "";
  const value = question?.choices?.[index] ?? question?.choicesJa?.[index];
  if (value && /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(String(value))) {
    return value;
  }
  return "";
}

function hasSpeakerLine(text) {
  return splitStemLinesPreserveIndent(text).some((line) => Boolean(parseSpeakerStemLine(line)?.speaker));
}

function shouldUseSpeakerLayout(question, text) {
  const stemKind = normalizeStemKindValue(question?.stemKind ?? "");
  const type = String(question?.type ?? "").trim();
  const blankStyle = String(question?.blankStyle ?? question?.blank_style ?? "").trim().toLowerCase();
  return (
    stemKind === "dialog"
    || stemKind === "text_box"
    || blankStyle === "redbox"
    || type === "mcq_sentence_blank"
    || type === "mcq_dialog"
    || type === "mcq_dialog_with_image"
    || hasSpeakerLine(text)
  );
}

function renderPromptHtml(question, text) {
  const promptText = String(text ?? "");
  if (!promptText) return "";
  if (!shouldUseSpeakerLayout(question, promptText)) {
    return `<div class="preserve-lines">${renderUnderlines(promptText)}</div>`;
  }
  const stemKind = normalizeStemKindValue(question?.stemKind ?? "");
  const lines = stemKind === "text_box" || String(question?.type ?? "").trim() === "mcq_sentence_blank"
    ? splitTextBoxStemLines(promptText)
    : splitStemLinesPreserveIndent(promptText);
  const className = stemKind === "text_box" || String(question?.type ?? "").trim() === "mcq_sentence_blank"
    ? "dialog-lines text-box-lines"
    : "dialog-lines";
  return renderSpeakerStemLines(lines, className);
}

function getAttemptMeta(attempt) {
  return attempt?.answers_json?.__meta ?? {};
}

function hasImportedCsvSummaryMeta(meta) {
  const source = String(meta?.imported_source ?? "").trim();
  if (source !== "daily_results_csv" && source !== "model_results_csv") {
    return false;
  }
  return Boolean(
    String(meta?.imported_test_title ?? "").trim()
    || String(meta?.imported_test_date ?? "").trim()
    || String(meta?.imported_csv_index ?? "").trim()
    || String(meta?.imported_rate ?? "").trim()
    || (Array.isArray(meta?.main_section_summary) && meta.main_section_summary.length > 0)
  );
}

export function isImportedSummaryAttempt(attempt) {
  const meta = getAttemptMeta(attempt);
  return Boolean(meta?.imported_summary) || hasImportedCsvSummaryMeta(meta);
}

export function isImportedResultsSummaryAttempt(attempt) {
  const source = String(getAttemptMeta(attempt)?.imported_source ?? "").trim();
  return isImportedSummaryAttempt(attempt)
    && (source === "daily_results_csv" || source === "model_results_csv");
}

export function getAttemptDedupKey(attempt) {
  const startedAt = String(attempt?.started_at || "");
  const endedAt = String(attempt?.ended_at || "");
  if (!startedAt && !endedAt) return `id:${attempt?.id || ""}`;
  // Strip __meta so the key is stable regardless of which insert path was used
  // (legacy schema omits tab_left_count column; both paths include __meta in answers_json)
  // eslint-disable-next-line no-unused-vars
  const { __meta, ...answersCore } = (attempt?.answers_json ?? {});
  const keyParts = [
    attempt?.test_session_id || "",
    attempt?.test_version || "",
    startedAt,
    endedAt,
    Number(attempt?.correct) || 0,
    Number(attempt?.total) || 0,
    JSON.stringify(answersCore),
  ];
  if (isImportedSummaryAttempt(attempt)) {
    const meta = getAttemptMeta(attempt);
    keyParts.push(
      String(meta.imported_source ?? ""),
      String(meta.imported_test_title ?? ""),
      String(meta.imported_test_date ?? ""),
      String(meta.imported_csv_index ?? ""),
      String(meta.imported_rate ?? ""),
      JSON.stringify(meta.main_section_summary ?? []),
    );
  }
  return JSON.stringify(keyParts);
}

export function dedupeAttempts(list) {
  const seen = new Set();
  return (list ?? []).filter((attempt) => {
    const key = getAttemptDedupKey(attempt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getAttemptTimestamp(attempt) {
  const value = attempt?.ended_at || attempt?.created_at || attempt?.started_at || null;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function buildLatestAttemptMapByStudent(attemptsList) {
  const map = new Map();
  for (const attempt of attemptsList ?? []) {
    if (!attempt?.student_id) continue;
    const existing = map.get(attempt.student_id);
    if (!existing || getAttemptTimestamp(attempt) >= getAttemptTimestamp(existing)) {
      map.set(attempt.student_id, attempt);
    }
  }
  return map;
}

export function getScoreRateFromAttempt(attempt) {
  const importedRate = Number(getAttemptMeta(attempt)?.imported_rate);
  if (Number.isFinite(importedRate)) return importedRate;
  const rate = Number(attempt?.score_rate);
  if (Number.isFinite(rate)) return rate;
  const total = Number(attempt?.total) || 0;
  const correct = Number(attempt?.correct) || 0;
  return total ? correct / total : 0;
}

export function getAttemptTest(attempt, testsList) {
  if (!attempt?.test_version) return null;
  const list = testsList ?? testsState.list;
  return list.find((test) => test.version === attempt.test_version) || null;
}

export function getAttemptTestType(attempt, testsList) {
  const test = getAttemptTest(attempt, testsList);
  if (test?.type) return test.type;
  // For CSV-imported attempts whose test_version is a synthetic string
  // (e.g. "imported-daily-vocabulary-…") there is no matching entry in
  // the tests table.  Fall back to the import source flag stored in meta.
  const importedSource = String(attempt?.answers_json?.__meta?.imported_source ?? "").trim();
  if (importedSource === "daily_results_csv") return "daily";
  if (importedSource === "model_results_csv") return "mock";
  return "";
}

export function getAttemptCategory(attempt, testsList) {
  const test = getAttemptTest(attempt, testsList);
  const name = String(test?.title ?? "").trim();
  if (name) return name;
  // No test found (session not linked to a question set) — fall back to session title
  const session = getAttemptSession(attempt, testSessionsState.list);
  return String(session?.title ?? "").trim() || "Uncategorized";
}

export function getAttemptDisplayDateValue(attempt, sessionsList) {
  const meta = getAttemptMeta(attempt);
  const importedDate = String(meta.imported_test_date ?? meta.imported_date_iso ?? meta.session_date ?? "").trim();
  if (importedDate) return importedDate;
  const session = getAttemptSession(attempt, sessionsList);
  return session?.starts_at || session?.ends_at || attempt?.ended_at || attempt?.created_at || attempt?.started_at || "";
}

export function getAttemptDisplayTimestamp(attempt, sessionsList) {
  const value = getAttemptDisplayDateValue(attempt, sessionsList);
  if (!value) return getAttemptTimestamp(attempt);
  const text = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : getAttemptTimestamp(attempt);
}

export function getAttemptDateLabel(attempt) {
  const date = getAttemptDisplayDateValue(attempt);
  return date ? formatDateShort(date) : "—";
}

export function getAttemptTitle(attempt, sessionsList, testsList) {
  const meta = getAttemptMeta(attempt);
  const importedTitle = String(meta.imported_test_title ?? meta.session_title ?? "").trim();
  if (importedTitle) return importedTitle;
  if (attempt?.test_session_id) {
    const list = sessionsList ?? testSessionsState.list;
    const session = list.find((item) => item.id === attempt.test_session_id);
    if (session?.title) return session.title;
  }
  const test = getAttemptTest(attempt, testsList);
  return test?.title || attempt?.test_version || "Test";
}

export function getAttemptSession(attempt, sessionsList) {
  if (!attempt?.test_session_id) return null;
  const list = sessionsList ?? testSessionsState.list;
  return list.find((session) => session.id === attempt.test_session_id) || null;
}

export function shouldShowAnswers(attempt, sessionsList, testsList) {
  if (attempt?.test_session_id) {
    const list = sessionsList ?? testSessionsState.list;
    const session = list.find((session) => session.id === attempt.test_session_id);
    if (typeof session?.show_answers === "boolean") return session.show_answers;
  }
  const test = getAttemptTest(attempt, testsList);
  if (test?.type === "daily") return false;
  return true;
}

export function buildAttemptDetailRows(attempt, questionsList) {
  const answers = attempt?.answers_json ?? {};
  return (questionsList ?? []).map((question) => {
    const chosenIdx = answers[question.id];
    const correctIndices = getEffectiveAnswerIndices(question);
    const stemMedia = getStemMediaAssets(question);
    const promptText = getQuestionPrompt(question);
    return {
      qid: String(question.id),
      sectionKey: question.sectionKey || "",
      section: getQuestionSectionLabel(question),
      prompt: promptText,
      promptHtml: renderPromptHtml(question, promptText),
      stemImages: stemMedia.images,
      stemAudios: stemMedia.audios,
      chosen: getChoiceText(question, chosenIdx),
      chosenImg: pickChoiceImage(question, chosenIdx),
      correct: correctIndices.map((value) => getChoiceText(question, value)).filter(Boolean).join(" / "),
      correctImg: pickChoiceImage(question, correctIndices[0]),
      isCorrect: isChoiceCorrect(chosenIdx, correctIndices),
    };
  });
}

export function buildAttemptScoreSummaryFromQuestions(attempt, questionsList) {
  const rows = buildAttemptDetailRows(attempt, questionsList);
  const total = rows.length || Number(attempt?.total) || 0;
  const correct = rows.reduce((sum, row) => sum + (row.isCorrect ? 1 : 0), 0);
  return {
    correct,
    total,
    rate: total ? correct / total : 0,
  };
}

export function getVisibleAttemptScoreSummary(attempt) {
  if (isImportedResultsSummaryAttempt(attempt)) {
    const correct = Number(attempt?.correct);
    const total = Number(attempt?.total);
    return {
      correct: Number.isFinite(correct) ? correct : 0,
      total: Number.isFinite(total) ? total : 0,
      rate: getScoreRateFromAttempt(attempt),
    };
  }
  const fallback = {
    correct: Number(attempt?.correct) || 0,
    total: Number(attempt?.total) || 0,
    rate: getScoreRateFromAttempt(attempt),
  };
  const version = String(attempt?.test_version ?? "").trim();
  if (!version) return fallback;
  // If questions haven't loaded for this version yet, fall back to stored values.
  // Also fall back when the questions array is empty (load failed or version has no
  // questions in the DB) — calling buildAttemptScoreSummaryFromQuestions with []
  // would produce "0 / N" which is misleading.
  const questions = resultDetailState.questionsByVersion[version];
  if (!questions?.length) return fallback;
  return buildAttemptScoreSummaryFromQuestions(attempt, questions);
}

export function formatAttemptScoreCell(attempt, scoreSummary = getVisibleAttemptScoreSummary(attempt)) {
  if (isImportedResultsSummaryAttempt(attempt) && !(Number(scoreSummary?.total) > 0)) {
    return "—";
  }
  return `${Number(scoreSummary?.correct) || 0} / ${Number(scoreSummary?.total) || 0}`;
}

function getImportedSummarySourceLabel(attempt) {
  const source = String(getAttemptMeta(attempt)?.imported_source ?? "").trim();
  if (source === "daily_results_csv") return "Daily CSV";
  if (source === "model_results_csv") return "Model CSV";
  return "Imported CSV";
}

export function getImportedModelSectionSummaries(attempt) {
  const rows = Array.isArray(getAttemptMeta(attempt)?.main_section_summary)
    ? getAttemptMeta(attempt).main_section_summary
    : [];
  const orderMap = new Map(
    sections
      .filter((section) => section.key !== "DAILY")
      .map((section, index) => [section.title, index])
  );
  return rows
    .map((row) => {
      const rawSection = String(row?.section ?? "").trim();
      const matchedSection = sections.find((section) => (
        section.key !== "DAILY"
        && (
          String(section.title ?? "").trim().toLowerCase() === rawSection.toLowerCase()
          || String(section.key ?? "").trim().toLowerCase() === rawSection.toLowerCase()
        )
      ));
      const section = matchedSection?.title || rawSection;
      const correct = Number(row?.correct ?? 0);
      const total = Number(row?.total ?? 0);
      const rawRate = Number(row?.rate);
      const rate = Number.isFinite(rawRate) ? rawRate : (total > 0 ? correct / total : 0);
      return {
        section,
        correct: Number.isFinite(correct) ? correct : 0,
        total: Number.isFinite(total) ? total : 0,
        rate: Number.isFinite(rate) ? rate : 0,
      };
    })
    .filter((row) => row.section)
    .sort((left, right) => {
      const leftOrder = orderMap.has(left.section) ? orderMap.get(left.section) : 999;
      const rightOrder = orderMap.has(right.section) ? orderMap.get(right.section) : 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.section.localeCompare(right.section);
    });
}

export function renderImportedResultsSummaryDetail(attempt, mode = "daily") {
  const meta = getAttemptMeta(attempt);
  const scoreSummary = getVisibleAttemptScoreSummary(attempt);
  const rate = Number(scoreSummary?.rate) || 0;
  const scoreCell = formatAttemptScoreCell(attempt, scoreSummary);
  const importedTitle = String(meta.imported_test_title ?? meta.session_title ?? "").trim();
  const importedDate = String(meta.imported_test_date ?? meta.imported_date_iso ?? meta.session_date ?? "").trim();
  const sourceLabel = getImportedSummarySourceLabel(attempt);
  const passRate = getPassRateForVersion(attempt?.test_version);
  const isPass = rate >= passRate;
  const sectionSummaries = mode === "model" ? getImportedModelSectionSummaries(attempt) : [];
  const hasSectionSummaries = sectionSummaries.length > 0;

  return `
    <div class="student-score-summary">
      ${importedTitle ? `
        <div class="student-score-row">
          <span class="student-score-label">Test Name</span>
          <span class="student-score-rank-value">${escapeHtml(importedTitle)}</span>
        </div>
      ` : ""}
      ${importedDate ? `
        <div class="student-score-row">
          <span class="student-score-label">Date</span>
          <span class="student-score-rank-value">${escapeHtml(formatDateFull(importedDate) || formatDateShort(importedDate) || importedDate)}</span>
        </div>
      ` : ""}
      <div class="student-score-row">
        <span class="student-score-label">Source</span>
        <span class="student-score-rank-value">${escapeHtml(sourceLabel)}</span>
      </div>
      <div class="student-score-row">
        <span class="student-score-label">Score</span>
        <span class="student-score-right ${isPass ? "" : "student-score-right-fail"}">
          <span class="student-score-value">
            <span class="student-score-value-primary">${escapeHtml(scoreCell)}</span>
          </span>
          <span class="student-score-rate">(${(rate * 100).toFixed(1)}%)</span>
        </span>
      </div>
      <div class="student-score-row">
        <span class="student-score-label">Pass/Fail</span>
        <span class="student-score-pass ${isPass ? "result-pass-cell" : "result-fail-cell"}">
          ${isPass ? "Pass" : "Fail"}
        </span>
      </div>
      <div class="student-score-row">
        <span class="student-score-label">Note</span>
        <span class="student-score-rank-value">Imported CSV results do not include question-level detail.</span>
      </div>
    </div>
    ${mode === "model" && hasSectionSummaries ? `
      <div class="detail-table-wrap">
        <table class="detail-table score-detail-table">
          <thead>
            <tr>
              <th class="score-detail-head-section">Section</th>
              <th class="score-detail-head-total"><span class="score-detail-head-label score-detail-head-label-total">Total</span></th>
              <th class="score-detail-head-correct"><span class="score-detail-head-label score-detail-head-label-correct">Correct</span></th>
              <th class="score-detail-head-rate"><span class="score-detail-head-label score-detail-head-label-rate">%</span></th>
            </tr>
          </thead>
          <tbody>
            ${sectionSummaries
              .map((row) => `
                <tr>
                  <td class="score-detail-cell-section">${escapeHtml(row.section)}</td>
                  <td class="score-detail-cell-total">${row.total}</td>
                  <td class="score-detail-cell-correct">${row.correct}</td>
                  <td class="score-detail-cell-rate">${(row.rate * 100).toFixed(1)}%</td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </div>
    ` : ""}
  `;
}

export function shouldShowAttemptInStudentResults(attempt) {
  if (!attempt) return false;
  if (isImportedResultsSummaryAttempt(attempt)) return true;
  if (!attempt.test_session_id) return true;
  return Boolean(getAttemptSession(attempt, testSessionsState.list));
}

export function buildResultAttemptEntries(testType, attemptsList = []) {
  const baseAttempts = (attemptsList ?? []).filter((attempt) => (
    getAttemptTestType(attempt, testsState.list) === testType
    && shouldShowAttemptInStudentResults(attempt)
  ));
  const sortedAttempts = [...baseAttempts].sort((left, right) => {
    const rightDisplay = getAttemptDisplayTimestamp(right, testSessionsState.list);
    const leftDisplay = getAttemptDisplayTimestamp(left, testSessionsState.list);
    if (rightDisplay !== leftDisplay) return rightDisplay - leftDisplay;
    const rightTime = getAttemptTimestamp(right);
    const leftTime = getAttemptTimestamp(left);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
  });
  const convertedSourceSessionIds = new Set();

  sortedAttempts.forEach((attempt) => {
    const session = getAttemptSession(attempt, testSessionsState.list);
    if (!isRetakeSession(session)) return;
    const sourceSession = getSourceSessionForRetake(session);
    if (!sourceSession?.id) return;
    const passRate = getPassRateForVersion(sourceSession.problem_set_id || session.problem_set_id || attempt.test_version);
    if (getVisibleAttemptScoreSummary(attempt).rate >= passRate) {
      convertedSourceSessionIds.add(sourceSession.id);
    }
  });

  return sortedAttempts.map((attempt) => {
    const session = getAttemptSession(attempt, testSessionsState.list);
    const sourceSession = isRetakeSession(session) ? getSourceSessionForRetake(session) : null;
    const isRetake = Boolean(sourceSession?.id);
    const actualPassRate = getPassRateForVersion(sourceSession?.problem_set_id || attempt.test_version);
    const actualPass = getVisibleAttemptScoreSummary(attempt).rate >= actualPassRate;
    const convertedToPass = !isRetake && Boolean(session?.id) && convertedSourceSessionIds.has(session.id);
    const hideFromFailedOnly = convertedToPass || (isRetake && Boolean(sourceSession?.id) && convertedSourceSessionIds.has(sourceSession.id));
    return {
      attempt,
      session,
      sourceSession,
      isRetake,
      actualPass,
      convertedToPass,
      hideFromFailedOnly,
      effectivePass: actualPass || convertedToPass,
    };
  });
}

export function buildResultRows() {
  const rows = [];
  for (const question of getQuestions()) {
    const chosenIdx = state.answers[question.id];
    const correctIndices = getEffectiveAnswerIndices(question);
    const stemMedia = getStemMediaAssets(question);
    const promptText = question.boxText || question.stemText || question.stemExtra || question.promptEn || "";

    rows.push({
      id: String(question.id),
      prompt: promptText,
      promptHtml: renderPromptHtml(question, promptText),
      isCorrect: isChoiceCorrect(chosenIdx, correctIndices),
      stemImages: stemMedia.images,
      stemAudios: stemMedia.audios,
      chosen: getChoiceText(question, chosenIdx),
      correct: correctIndices.map((value) => getChoiceText(question, value)).filter(Boolean).join(" / "),
      chosenImg: pickChoiceImage(question, chosenIdx),
      correctImg: pickChoiceImage(question, correctIndices[0]),
    });
  }
  return rows;
}

export function buildSectionSummary(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.section || "Unknown";
    const current = map.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    map.set(key, current);
  });
  return Array.from(map.values()).map((summary) => ({
    ...summary,
    rate: summary.total ? summary.correct / summary.total : 0,
  }));
}

export function buildMainSectionSummary(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = getSectionTitle(row.sectionKey) || row.sectionKey || "Unknown";
    const current = map.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    map.set(key, current);
  });
  return sections
    .map((section) => getSectionTitle(section.key))
    .filter(Boolean)
    .map((label) => map.get(label))
    .filter(Boolean)
    .map((summary) => ({
      ...summary,
      rate: summary.total ? summary.correct / summary.total : 0,
    }));
}

export function buildNestedSectionSummary(rows) {
  const subSectionSummary = buildSectionSummary(rows);
  const subSectionMap = new Map(subSectionSummary.map((row) => [row.section, row]));
  const mainSectionMap = new Map();

  rows.forEach((row) => {
    const mainSection = getSectionTitle(row.sectionKey) || row.sectionKey || "Unknown";
    if (!mainSectionMap.has(mainSection)) {
      mainSectionMap.set(mainSection, {
        mainSection,
        total: 0,
        correct: 0,
        subSections: [],
      });
    }
    const group = mainSectionMap.get(mainSection);
    group.total += 1;
    if (row.isCorrect) group.correct += 1;
  });

  subSectionSummary.forEach((subSection) => {
    const sourceRow = (rows ?? []).find((row) => row.section === subSection.section);
    const mainSection = getSectionTitle(sourceRow?.sectionKey) || sourceRow?.sectionKey || "Unknown";
    const group = mainSectionMap.get(mainSection);
    if (!group) return;
    group.subSections.push(subSectionMap.get(subSection.section) || subSection);
  });

  return sections
    .filter((section) => section.key !== "DAILY")
    .map((section) => getSectionTitle(section.key))
    .filter((title) => mainSectionMap.has(title))
    .map((title) => {
      const group = mainSectionMap.get(title);
      return {
        ...group,
        rate: group.total ? group.correct / group.total : 0,
        subSections: group.subSections.map((subSection) => ({
          ...subSection,
          rate: subSection.total ? subSection.correct / subSection.total : 0,
        })),
      };
    });
}

export function getAvailableSections(rows) {
  const list = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    const label = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
    if (seen.has(label)) continue;
    seen.add(label);
    list.push(label);
  }
  return list;
}

export function renderDetailTable(rows, showAnswers) {
  if (!rows?.length) {
    return `<div class="text-muted">No details available.</div>`;
  }

  return `
    <div class="detail-table-wrap">
      <table class="detail-table wide">
        <thead>
          <tr>
            <th class="col-no">No.</th>
            <th class="col-question">Question</th>
            <th>Chosen</th>
            ${showAnswers ? "<th>Correct</th>" : ""}
            <th>Correct?</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row, index) => `
                <tr>
                  <td class="cell-no">${index + 1}</td>
                  <td class="cell-question">
                    <div class="detail-question">
                      <div class="detail-question-text">${row.promptHtml || escapeHtml(row.prompt)}</div>
                      ${
                        row.stemAudios?.length || row.stemImages?.length
                          ? `
                            <div class="detail-question-media">
                              ${(row.stemAudios ?? [])
                                .map((src) => `<audio class="detail-question-audio" controls preload="none" src="${src}"></audio>`)
                                .join("")}
                              ${(row.stemImages ?? [])
                                .map((src) => `<img class="detail-question-thumb" src="${src}" alt="q" />`)
                                .join("")}
                            </div>
                          `
                          : ""
                      }
                    </div>
                  </td>
                  <td>${
                    row.chosenImg
                      ? `<img class="detail-choice-image" src="${row.chosenImg}" alt="chosen" />`
                      : escapeHtml(row.chosen || "—")
                  }</td>
                  ${showAnswers ? `<td>${
                    row.correctImg
                      ? `<img class="detail-choice-image" src="${row.correctImg}" alt="correct" />`
                      : escapeHtml(row.correct || "—")
                  }</td>` : ""}
                  <td style="text-align:center;">${row.isCorrect ? "○" : "×"}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getQuestionSectionLabel(question) {
  return question?.sectionLabel || getSectionTitle(question?.sectionKey);
}

function getQuestionPrompt(question) {
  return question?.boxText || question?.stemText || question?.stemExtra || question?.promptEn || "";
}
