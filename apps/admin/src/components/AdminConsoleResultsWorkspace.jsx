"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { sections } from "../../../../packages/shared/questions.js";
import AdminConsoleDeferredFeatures from "./AdminConsoleDeferredFeatures";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderUnderlinesHtml(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, (_, inner) => (String(inner ?? "").replace(/[\s\u3000]/g, "").length
      ? `<span class="u">${inner}</span>`
      : '<span class="blank-red"></span>'))
    .replace(/［[\s\u3000]*］|\[[\s\u3000]*\]/g, '<span class="blank-red"></span>');
}

function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitStemLinesPreserveIndent(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.replace(/\s+$/g, ""))
    .filter((s) => s.trim().length);
}

function splitTextBoxStemLines(text) {
  const baseLines = splitStemLinesPreserveIndent(text);
  const expanded = [];
  for (const line of baseLines) {
    const speakerMatches = Array.from(
      String(line).matchAll(/(?:^|\s+)([^:：\s]{1,20}[：:].*?)(?=(?:\s+[^:：\s]{1,20}[：:])|$)/g)
    )
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean);
    if (speakerMatches.length >= 2) {
      expanded.push(...speakerMatches);
      continue;
    }
    expanded.push(line);
  }
  return expanded;
}

function parseSpeakerStemLine(line) {
  const match = String(line ?? "").match(/^\s*([^:：]+?)([:：])(.*)$/);
  if (!match) return null;
  return {
    speaker: String(match[1] ?? "").trim(),
    delimiter: match[2] ?? "：",
    body: String(match[3] ?? "").replace(/^\s+/g, ""),
  };
}

function getSectionLabelLines(label) {
  if (label === "Script and Vocabulary") return ["Script and", "Vocabulary"];
  if (label === "Reading Comprehension") return ["Reading", "Comprehension"];
  if (label === "Listening Comprehension") return ["Listening", "Comprehension"];
  if (label === "Conversation and Expression") return ["Conversation and", "Expression"];
  return String(label ?? "")
    .split(/\s+/)
    .filter(Boolean);
}

function buildSectionRadarSvg(data) {
  if (!data?.length) return null;
  const size = 300;
  const center = size / 2;
  const maxR = 96;
  const steps = 4;
  const points = data
    .map((item, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
      const r = maxR * Math.max(0, Math.min(1, Number(item?.value ?? 0)));
      const x = center + Math.cos(angle) * r;
      const y = center + Math.sin(angle) * r;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const grid = Array.from({ length: steps }, (_, index) => {
    const r = (maxR * (index + 1)) / steps;
    return <circle key={`grid-${r}`} cx={center} cy={center} r={r} className="session-radar-grid" />;
  });
  const axes = data.map((_, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    const x = center + Math.cos(angle) * maxR;
    const y = center + Math.sin(angle) * maxR;
    return <line key={`axis-${index}`} x1={center} y1={center} x2={x} y2={y} className="session-radar-axis" />;
  });
  const labels = data.map((item, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / data.length;
    let radius = maxR + 24;
    let xOffset = 0;
    if (item.label === "Reading Comprehension") {
      radius = maxR + 10;
      xOffset = 24;
    } else if (item.label === "Conversation and Expression") {
      radius = maxR + 10;
      xOffset = -24;
    }
    const x = center + Math.cos(angle) * radius + xOffset;
    const y = center + Math.sin(angle) * radius;
    const lines = getSectionLabelLines(item.label);
    return (
      <text key={`label-${item.label}`} x={x} y={y} className="session-radar-label">
        {lines.map((line, lineIndex) => (
          <tspan key={`label-line-${item.label}-${lineIndex}`} x={x} dy={lineIndex === 0 ? "0" : "1.15em"}>
            {line}
          </tspan>
        ))}
      </text>
    );
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="session-radar-chart" role="img" aria-label="Average section performance radar chart">
      {grid}
      {axes}
      <polygon points={points} className="session-radar-shape" />
      {labels}
    </svg>
  );
}

function buildSourceQuestionKey(sourceVersion, sourceQuestionId) {
  return `${String(sourceVersion ?? "").trim()}::${String(sourceQuestionId ?? "").trim()}`;
}

function isGeneratedDailySessionVersion(version) {
  return String(version ?? "").startsWith("daily_session_");
}

function formatCompactDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function renderTwoLineHeaderFallback(title) {
  const text = String(title ?? "");
  const idx = text.lastIndexOf(" ");
  if (idx <= 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <br />
      {text.slice(idx + 1)}
    </>
  );
}

function isImportedSummaryAttempt(attempt) {
  return Boolean(attempt?.answers_json?.__meta?.imported_summary);
}

function isImportedResultsSummaryAttempt(attempt) {
  const source = String(attempt?.answers_json?.__meta?.imported_source ?? "");
  return isImportedSummaryAttempt(attempt)
    && (source === "daily_results_csv" || source === "model_results_csv");
}

function isImportedModelResultsSummaryAttempt(attempt) {
  return isImportedSummaryAttempt(attempt)
    && String(attempt?.answers_json?.__meta?.imported_source ?? "") === "model_results_csv";
}

function getAttemptTimestamp(attempt) {
  const value = attempt?.ended_at || attempt?.created_at || attempt?.started_at || null;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatOrdinalFallback(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? "");
  const mod10 = num % 10;
  const mod100 = num % 100;
  let suffix = "th";
  if (mod10 === 1 && mod100 !== 11) suffix = "st";
  else if (mod10 === 2 && mod100 !== 12) suffix = "nd";
  else if (mod10 === 3 && mod100 !== 13) suffix = "rd";
  return `${num}${suffix}`;
}

function normalizePassRate(value, fallback = 0.8) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= 1 ? rate : fallback;
}

function normalizeImportedModelSectionTitle(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const matchedSection = sections.find((section) => {
    const sectionTitle = String(section?.title ?? "").trim().toLowerCase();
    const sectionKey = String(section?.key ?? "").trim().toLowerCase();
    const normalizedRaw = raw.toLowerCase();
    return section.key !== "DAILY" && (sectionTitle === normalizedRaw || sectionKey === normalizedRaw);
  });
  return matchedSection?.title || raw;
}

function getImportedModelSectionSummaries(attempt) {
  const rows = Array.isArray(attempt?.answers_json?.__meta?.main_section_summary)
    ? attempt.answers_json.__meta.main_section_summary
    : [];
  const orderMap = new Map(
    sections
      .filter((section) => section.key !== "DAILY")
      .map((section, index) => [section.title, index])
  );
  return rows
    .map((row) => {
      const section = normalizeImportedModelSectionTitle(row?.section);
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

function buildLatestAttemptMapByStudent(attemptsList) {
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

function isMissingColumnError(error, columnName) {
  const message = String(error?.message ?? "");
  return message.includes(columnName) && message.toLowerCase().includes("does not exist");
}

function mapDbQuestion(row) {
  const data = row?.data ?? {};
  const stemAsset = [
    row?.media_file,
    data.stemAsset,
    data.stem_asset,
    data.stemAudio,
    data.stem_audio,
    data.stemImage,
    data.stem_image,
  ].filter(Boolean).join("|") || null;
  return {
    dbId: row?.id ?? null,
    id: row?.question_id ?? row?.id ?? "",
    questionId: row?.question_id ?? row?.id ?? "",
    testVersion: row?.test_version ?? "",
    sectionKey: row?.section_key ?? "",
    sectionLabel: data.sectionLabel ?? data.section_label ?? null,
    type: row?.type ?? "",
    promptEn: row?.prompt_en ?? "",
    promptBn: row?.prompt_bn ?? "",
    answerIndex: row?.answer_index,
    orderIndex: row?.order_index ?? 0,
    rawData: data,
    data,
    sourceVersion: data.sourceVersion ?? null,
    sourceQuestionId: data.sourceQuestionId ?? null,
    stemAsset,
    choices: data.choices ?? data.choicesJa ?? data.choicesEn ?? [],
    choicesJa: data.choicesJa ?? data.choices ?? [],
    choicesEn: data.choicesEn ?? data.choices ?? [],
    choiceImages: data.choiceImages ?? [],
    parts: Array.isArray(data.parts) ? data.parts : [],
  };
}

function mergeQuestionData(question) {
  return {
    ...(question?.data ?? {}),
    ...question,
    id: question?.questionId ?? question?.id,
    questionId: question?.questionId ?? question?.id,
  };
}

function getQuestionPrompt(question) {
  const q = mergeQuestionData(question);
  if (q.boxText) return q.boxText;
  if (q.stemText) return q.stemText;
  if (q.stemExtra) return q.stemExtra;
  if (q.promptEn) return q.promptEn;
  if (q.promptBn) return q.promptBn;
  return q.questionId || q.id || "";
}

function buildAttemptDetailRowsFromList(answersJson, questionsList, getQuestionSectionLabel) {
  const answers = answersJson ?? {};
  const rows = [];
  for (const rawQuestion of questionsList ?? []) {
    const question = mergeQuestionData(rawQuestion);
    const answerKey = question.questionId ?? question.id;
    const section = getQuestionSectionLabel(question);
    if (Array.isArray(question.parts) && question.parts.length) {
      const answer = answers[answerKey];
      question.parts.forEach((part, index) => {
        const chosenIdx = answer?.partAnswers?.[index];
        const correctIdx = part?.answerIndex;
        rows.push({
          qid: `${answerKey}-${index + 1}`,
          sectionKey: question.sectionKey || "",
          section,
          prompt: `${question.promptEn ?? question.promptBn ?? ""} ${part?.partLabel ?? ""} ${part?.questionJa ?? part?.promptEn ?? ""}`.trim(),
          isCorrect: chosenIdx === correctIdx,
        });
      });
      continue;
    }
    const chosenIdx = answers[answerKey];
    rows.push({
      qid: String(answerKey),
      sectionKey: question.sectionKey || "",
      section,
      prompt: getQuestionPrompt(question),
      isCorrect: chosenIdx === question.answerIndex,
    });
  }
  return rows;
}

function buildSectionSummary(rows) {
  const summaryMap = new Map();
  for (const row of rows ?? []) {
    const key = row.section || "Unknown";
    const current = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    summaryMap.set(key, current);
  }
  return Array.from(summaryMap.values()).map((row) => ({
    ...row,
    rate: row.total ? row.correct / row.total : 0,
  }));
}

function buildMainSectionSummary(rows, getSectionTitle) {
  const summaryMap = new Map();
  for (const row of rows ?? []) {
    const key = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
    const current = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    summaryMap.set(key, current);
  }
  return sections
    .map((section) => getSectionTitle(section.key))
    .filter(Boolean)
    .map((label) => summaryMap.get(label))
    .filter(Boolean)
    .map((row) => ({
      ...row,
      rate: row.total ? row.correct / row.total : 0,
    }));
}

function buildNestedSectionSummary(rows, getSectionTitle) {
  const mainSectionMap = new Map();
  for (const row of rows ?? []) {
    const mainSection = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
    const current = mainSectionMap.get(mainSection) || {
      mainSection,
      total: 0,
      correct: 0,
      subSections: new Map(),
    };
    current.total += 1;
    if (row.isCorrect) current.correct += 1;
    const subKey = row.section || "Unknown";
    const currentSub = current.subSections.get(subKey) || { section: subKey, total: 0, correct: 0 };
    currentSub.total += 1;
    if (row.isCorrect) currentSub.correct += 1;
    current.subSections.set(subKey, currentSub);
    mainSectionMap.set(mainSection, current);
  }
  const ordered = sections
    .map((section) => getSectionTitle(section.key))
    .filter((title) => mainSectionMap.has(title))
    .map((title) => mainSectionMap.get(title));
  for (const [title, group] of mainSectionMap.entries()) {
    if (!ordered.some((item) => item.mainSection === title)) ordered.push(group);
  }
  return ordered.map((group) => ({
    mainSection: group.mainSection,
    total: group.total,
    correct: group.correct,
    rate: group.total ? group.correct / group.total : 0,
    subSections: Array.from(group.subSections.values()).map((subSection) => ({
      ...subSection,
      rate: subSection.total ? subSection.correct / subSection.total : 0,
    })),
  }));
}

function buildQuestionAnalysisRows(attemptsList, questionsList, getQuestionSectionLabel) {
  const stats = new Map();
  for (const attempt of attemptsList ?? []) {
    const rows = buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel);
    for (const row of rows) {
      const current = stats.get(row.qid) || {
        qid: row.qid,
        section: row.section,
        prompt: row.prompt,
        correct: 0,
        total: 0,
        byStudent: {},
      };
      current.total += 1;
      if (row.isCorrect) current.correct += 1;
      if (attempt?.student_id) current.byStudent[attempt.student_id] = row.isCorrect;
      stats.set(row.qid, current);
    }
  }
  return Array.from(stats.values()).map((row) => ({
    ...row,
    rate: row.total ? row.correct / row.total : 0,
  }));
}

function buildSectionAverageRows(attemptsList, questionsList, getQuestionSectionLabel) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList, getQuestionSectionLabel);
  const baseSummary = buildSectionSummary(baseRows);
  return baseSummary
    .map((baseRow) => {
      const stats = attemptsList.reduce(
        (acc, attempt) => {
          const summary = buildSectionSummary(buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel));
          const row = summary.find((item) => item.section === baseRow.section);
          acc.rateSum += Number(row?.rate ?? 0);
          acc.correctSum += Number(row?.correct ?? 0);
          return acc;
        },
        { rateSum: 0, correctSum: 0 }
      );
      return {
        section: baseRow.section,
        averageRate: stats.rateSum / attemptsList.length,
        averageCorrect: stats.correctSum / attemptsList.length,
        totalQuestions: Number(baseRow.total ?? 0),
      };
    })
    .filter((row) => row.totalQuestions > 0);
}

function buildMainSectionAverageRows(attemptsList, questionsList, getQuestionSectionLabel, getSectionTitle) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList, getQuestionSectionLabel);
  const baseSummary = buildMainSectionSummary(baseRows, getSectionTitle);
  return baseSummary
    .map((baseRow) => {
      const stats = attemptsList.reduce(
        (acc, attempt) => {
          const summary = buildMainSectionSummary(
            buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel),
            getSectionTitle
          );
          const row = summary.find((item) => item.section === baseRow.section);
          acc.rateSum += Number(row?.rate ?? 0);
          acc.correctSum += Number(row?.correct ?? 0);
          return acc;
        },
        { rateSum: 0, correctSum: 0 }
      );
      return {
        section: baseRow.section,
        total: Number(baseRow.total ?? 0),
        averageCorrect: stats.correctSum / attemptsList.length,
        averageRate: stats.rateSum / attemptsList.length,
      };
    })
    .filter((row) => row.total > 0);
}

function buildNestedSectionAverageRows(attemptsList, questionsList, getQuestionSectionLabel, getSectionTitle) {
  if (!questionsList?.length || !attemptsList?.length) return [];
  const baseRows = buildAttemptDetailRowsFromList({}, questionsList, getQuestionSectionLabel);
  const baseSummary = buildNestedSectionSummary(baseRows, getSectionTitle);
  return baseSummary.map((baseGroup) => {
    const groupStats = attemptsList.reduce(
      (acc, attempt) => {
        const summary = buildNestedSectionSummary(
          buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel),
          getSectionTitle
        );
        const group = summary.find((item) => item.mainSection === baseGroup.mainSection);
        acc.rateSum += Number(group?.rate ?? 0);
        acc.correctSum += Number(group?.correct ?? 0);
        return acc;
      },
      { rateSum: 0, correctSum: 0 }
    );
    return {
      mainSection: baseGroup.mainSection,
      total: Number(baseGroup.total ?? 0),
      averageCorrect: groupStats.correctSum / attemptsList.length,
      averageRate: groupStats.rateSum / attemptsList.length,
      subSections: baseGroup.subSections.map((baseSubSection) => {
        const subStats = attemptsList.reduce(
          (acc, attempt) => {
            const summary = buildNestedSectionSummary(
              buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel),
              getSectionTitle
            );
            const group = summary.find((item) => item.mainSection === baseGroup.mainSection);
            const subSection = group?.subSections?.find((item) => item.section === baseSubSection.section);
            acc.rateSum += Number(subSection?.rate ?? 0);
            acc.correctSum += Number(subSection?.correct ?? 0);
            return acc;
          },
          { rateSum: 0, correctSum: 0 }
        );
        return {
          section: baseSubSection.section,
          total: Number(baseSubSection.total ?? 0),
          averageCorrect: subStats.correctSum / attemptsList.length,
          averageRate: subStats.rateSum / attemptsList.length,
        };
      }),
    };
  });
}

function buildImportedMainSectionAverageRows(attemptsList) {
  if (!attemptsList?.length) return [];
  return sections
    .filter((section) => section.key !== "DAILY")
    .map((section) => section.title)
    .map((sectionTitle) => {
      const matchingRows = attemptsList
        .map((attempt) => getImportedModelSectionSummaries(attempt).find((row) => row.section === sectionTitle))
        .filter(Boolean);
      if (!matchingRows.length) return null;
      return {
        section: sectionTitle,
        total: Math.max(...matchingRows.map((row) => Number(row.total ?? 0)), 0),
        averageCorrect: matchingRows.reduce((sum, row) => sum + Number(row.correct ?? 0), 0) / matchingRows.length,
        averageRate: matchingRows.reduce((sum, row) => sum + Number(row.rate ?? 0), 0) / matchingRows.length,
      };
    })
    .filter(Boolean);
}

function getDistributionTickStep(maxCount) {
  if (maxCount <= 5) return 1;
  if (maxCount <= 10) return 2;
  if (maxCount <= 25) return 5;
  if (maxCount <= 50) return 10;
  if (maxCount <= 100) return 20;
  return Math.max(25, Math.ceil(maxCount / 5 / 5) * 5);
}

function buildSessionStudentRankingRows(attemptsList, questionsList, studentsList, getQuestionSectionLabel) {
  if (!attemptsList?.length) return [];
  const sectionAverageRows = buildSectionAverageRows(attemptsList, questionsList, getQuestionSectionLabel);
  const sectionTitles = sectionAverageRows.map((row) => row.section);
  const rows = attemptsList.map((attempt) => {
    const student = (studentsList ?? []).find((item) => item.id === attempt.student_id) ?? null;
    const detailRows = buildAttemptDetailRowsFromList(attempt?.answers_json, questionsList, getQuestionSectionLabel);
    const sectionSummary = buildSectionSummary(detailRows);
    const sectionRates = Object.fromEntries(
      sectionTitles.map((title) => [title, Number(sectionSummary.find((row) => row.section === title)?.rate ?? 0)])
    );
    return {
      attempt,
      student_id: attempt.student_id,
      display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
      student_code: attempt.student_code || student?.student_code || "",
      totalCorrect: Number(attempt?.correct ?? 0),
      totalQuestions: Number(attempt?.total ?? 0),
      totalRate: Number(attempt?.score_rate ?? 0),
      sectionRates,
    };
  });
  rows.sort((a, b) => {
    if (b.totalRate !== a.totalRate) return b.totalRate - a.totalRate;
    if (b.totalCorrect !== a.totalCorrect) return b.totalCorrect - a.totalCorrect;
    const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildImportedSessionStudentRankingRows(attemptsList, studentsList) {
  if (!attemptsList?.length) return [];
  const sectionTitles = sections.filter((section) => section.key !== "DAILY").map((section) => section.title);
  const rows = attemptsList.map((attempt) => {
    const student = (studentsList ?? []).find((item) => item.id === attempt.student_id) ?? null;
    const sectionSummary = getImportedModelSectionSummaries(attempt);
    const sectionRates = Object.fromEntries(
      sectionTitles.map((title) => [title, Number(sectionSummary.find((row) => row.section === title)?.rate ?? 0)])
    );
    return {
      attempt,
      student_id: attempt.student_id,
      display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
      student_code: attempt.student_code || student?.student_code || "",
      totalCorrect: Number(attempt?.correct ?? 0),
      totalQuestions: Number(attempt?.total ?? 0),
      totalRate: Number(attempt?.score_rate ?? 0),
      sectionRates,
    };
  });
  rows.sort((a, b) => {
    if (b.totalRate !== a.totalRate) return b.totalRate - a.totalRate;
    if (b.totalCorrect !== a.totalCorrect) return b.totalCorrect - a.totalCorrect;
    const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

export default function AdminConsoleResultsWorkspace(props) {
  const {
    supabase,
    fetchTests,
    deleteTest,
    deleteTestSession,
    closeSessionDetail,
    allowSessionAnotherAttempt,
    resultContext,
    sessionDetail,
    sessionDetailTab = "analysis",
    setSessionDetailTab = () => {},
    sessionDetailQuestions = [],
    sessionDetailAttempts = [],
    sessionDetailLoading = false,
    sessionDetailMsg = "",
    sessionDetailAllowStudentId = "",
    setSessionDetailAllowStudentId = () => {},
    sessionDetailAllowMsg = "",
    sessionDetailAllowances = {},
    sessionDetailDisplayAttempts: sessionDetailDisplayAttemptsProp,
    sessionDetailStudentOptions: sessionDetailStudentOptionsProp,
    sessionDetailPassRate: sessionDetailPassRateProp,
    sessionDetailUsesImportedResultsSummary: sessionDetailUsesImportedResultsSummaryProp,
    sessionDetailUsesImportedModelSummary: sessionDetailUsesImportedModelSummaryProp,
    sessionDetailAnalysisSummary: sessionDetailAnalysisSummaryProp,
    sessionDetailOverview: sessionDetailOverviewProp,
    sessionDetailQuestionAnalysis: sessionDetailQuestionAnalysisProp,
    sessionDetailQuestionStudents: sessionDetailQuestionStudentsProp,
    sessionDetailMainSectionAverages: sessionDetailMainSectionAveragesProp,
    sessionDetailNestedSectionAverages: sessionDetailNestedSectionAveragesProp,
    sessionDetailStudentRankingRows: sessionDetailStudentRankingRowsProp,
    sessionDetailRankingSections: sessionDetailRankingSectionsProp,
    sessionDetailShowAllAnalysis = false,
    setSessionDetailShowAllAnalysis = () => {},
    sessionDetailAnalysisPopup = { open: false, title: "", questions: [] },
    setSessionDetailAnalysisPopup = () => {},
    selectedSessionDetail,
    attempts = [],
    testMetaByVersion = {},
    attemptCanOpenDetail: attemptCanOpenDetailProp,
    openAttemptDetail: openAttemptDetailProp,
    formatDateTime,
    formatOrdinal: formatOrdinalProp,
    getScoreRate,
    renderTwoLineHeader: renderTwoLineHeaderProp,
    getSectionTitle,
    getQuestionSectionLabel,
    students = [],
    attemptDetailOpen: attemptDetailOpenProp,
    selectedAttempt: selectedAttemptProp,
    selectedAttemptRows: selectedAttemptRowsProp,
    selectedAttemptScoreRate: selectedAttemptScoreRateProp,
    studentAttemptRanks: studentAttemptRanksProp,
    attemptDetailSource: attemptDetailSourceProp,
    selectedAttemptUsesImportedSummary: selectedAttemptUsesImportedSummaryProp,
    selectedAttemptUsesImportedModelSummary: selectedAttemptUsesImportedModelSummaryProp,
    selectedAttemptMainSectionSummary: selectedAttemptMainSectionSummaryProp,
    setAttemptDetailOpen: setAttemptDetailOpenProp,
    setSelectedAttemptObj: setSelectedAttemptObjProp,
    setAttemptDetailSource: setAttemptDetailSourceProp,
    attemptQuestionsLoading: attemptQuestionsLoadingProp,
    attemptQuestionsError: attemptQuestionsErrorProp,
    attemptDetailTab: attemptDetailTabProp,
    setAttemptDetailTab: setAttemptDetailTabProp,
    selectedAttemptIsPass: selectedAttemptIsPassProp,
    selectedAttemptIsModel: selectedAttemptIsModelProp,
    selectedAttemptNestedSectionSummary: selectedAttemptNestedSectionSummaryProp,
    selectedAttemptPassRate: selectedAttemptPassRateProp,
    selectedAttemptSectionSummary: selectedAttemptSectionSummaryProp,
    selectedAttemptQuestionSectionsFiltered: selectedAttemptQuestionSectionsFilteredProp,
    attemptDetailSectionRefs: attemptDetailSectionRefsProp,
    attemptDetailWrongOnly: attemptDetailWrongOnlyProp,
    setAttemptDetailWrongOnly: setAttemptDetailWrongOnlyProp,
    previewOpen,
    previewTest,
    previewSession,
    previewQuestions,
    previewReplacementPool,
    previewReplacementDrafts,
    setPreviewReplacementDrafts,
    previewReplacementSavingId,
    setPreviewReplacementSavingId,
    previewReplacementMsg,
    setPreviewReplacementMsg,
    setPreviewQuestions,
    normalizeModelCsvKind,
    splitAssetValues,
    isImageAsset,
    isAudioAsset,
  } = props;

  const sessionStudents = Array.isArray(students) ? students : [];
  const studentsById = new Map(sessionStudents.map((student) => [student.id, student]));
  const sessionDetailDisplayAttempts = Array.isArray(sessionDetailDisplayAttemptsProp)
    ? sessionDetailDisplayAttemptsProp
    : (() => {
      const actualAttempts = sessionDetailAttempts.filter((attempt) => !isImportedResultsSummaryAttempt(attempt));
      return actualAttempts.length ? actualAttempts : sessionDetailAttempts;
    })();
  const sessionDetailStudentOptions = Array.isArray(sessionDetailStudentOptionsProp)
    ? sessionDetailStudentOptionsProp
    : (() => {
      const unique = new Map();
      sessionDetailDisplayAttempts.forEach((attempt) => {
        if (!attempt?.student_id || unique.has(attempt.student_id)) return;
        const student = studentsById.get(attempt.student_id) ?? null;
        unique.set(attempt.student_id, {
          id: attempt.student_id,
          display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
          student_code: attempt.student_code || student?.student_code || "",
        });
      });
      return Array.from(unique.values()).sort((a, b) => {
        const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
        if (nameCompare !== 0) return nameCompare;
        return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
      });
    })();
  const sessionDetailLatestAttempts = Array.from(buildLatestAttemptMapByStudent(sessionDetailDisplayAttempts).values())
    .filter((attempt) => {
      const student = studentsById.get(attempt.student_id);
      return !(student?.is_withdrawn || student?.is_test_account);
    })
    .sort((a, b) => getAttemptTimestamp(a) - getAttemptTimestamp(b));
  const sessionDetailPassRate = Number.isFinite(sessionDetailPassRateProp)
    ? sessionDetailPassRateProp
    : (() => {
      if (
        sessionDetailDisplayAttempts.length
        && sessionDetailDisplayAttempts.every((attempt) => isImportedResultsSummaryAttempt(attempt))
      ) {
        return 0.8;
      }
      const selectedSessionPassRate = Number(selectedSessionDetail?.pass_rate);
      if (Number.isFinite(selectedSessionPassRate) && selectedSessionPassRate > 0 && selectedSessionPassRate <= 1) {
        return selectedSessionPassRate;
      }
      return normalizePassRate(testMetaByVersion[selectedSessionDetail?.problem_set_id]?.pass_rate);
    })();
  const sessionDetailUsesImportedResultsSummary = typeof sessionDetailUsesImportedResultsSummaryProp === "boolean"
    ? sessionDetailUsesImportedResultsSummaryProp
    : (
      sessionDetailDisplayAttempts.length > 0
      && sessionDetailDisplayAttempts.every((attempt) => isImportedResultsSummaryAttempt(attempt))
    );
  const sessionDetailUsesImportedModelSummary = typeof sessionDetailUsesImportedModelSummaryProp === "boolean"
    ? sessionDetailUsesImportedModelSummaryProp
    : (
      sessionDetail.type === "mock"
      && sessionDetailUsesImportedResultsSummary
      && sessionDetailLatestAttempts.every((attempt) => isImportedModelResultsSummaryAttempt(attempt))
    );
  const sessionDetailOverview = sessionDetailOverviewProp ?? (() => {
    const count = sessionDetailLatestAttempts.length;
    const passCount = sessionDetailLatestAttempts.filter((attempt) => getScoreRate(attempt) >= sessionDetailPassRate).length;
    const averageScore = count
      ? sessionDetailLatestAttempts.reduce((total, attempt) => total + getScoreRate(attempt), 0) / count
      : 0;
    return {
      count,
      averageScore,
      passCount,
      passRate: count ? passCount / count : 0,
    };
  })();
  const sessionDetailAnalysisSummary = sessionDetailAnalysisSummaryProp ?? (() => {
    const attendedCount = sessionDetailLatestAttempts.length;
    const activeStudentCount = sessionStudents.filter((student) => !(student?.is_withdrawn || student?.is_test_account)).length;
    const absentCount = Math.max(0, activeStudentCount - attendedCount);
    const passCount = sessionDetailLatestAttempts.filter((attempt) => getScoreRate(attempt) >= sessionDetailPassRate).length;
    const failCount = Math.max(0, attendedCount - passCount);
    const totalQuestions = sessionDetailUsesImportedResultsSummary
      ? Math.max(0, ...sessionDetailLatestAttempts.map((attempt) => Number(attempt.total ?? 0)))
      : sessionDetailQuestions.length;
    const averageCorrect = attendedCount
      ? sessionDetailLatestAttempts.reduce((total, attempt) => {
        return total + Number(attempt.correct ?? (attempt.total ? getScoreRate(attempt) * attempt.total : 0));
      }, 0) / attendedCount
      : 0;
    const bucketLabels = Array.from({ length: 10 }, (_, index) => {
      const start = index * 10;
      const end = index === 9 ? 100 : start + 9;
      return `${start}-${end}%`;
    });
    const bucketCounts = Array.from({ length: 10 }, () => 0);
    sessionDetailLatestAttempts.forEach((attempt) => {
      const ratePercent = Math.max(0, Math.min(100, getScoreRate(attempt) * 100));
      const bucketIndex = ratePercent >= 100 ? 9 : Math.floor(ratePercent / 10);
      bucketCounts[bucketIndex] += 1;
    });
    return {
      attendedCount,
      absentCount,
      passCount,
      failCount,
      totalQuestions,
      averageCorrect,
      averageRate: sessionDetailOverview.averageScore,
      bucketLabels,
      bucketCounts,
      maxBucketCount: Math.max(0, ...bucketCounts),
    };
  })();
  const sessionDetailQuestionAnalysis = Array.isArray(sessionDetailQuestionAnalysisProp)
    ? sessionDetailQuestionAnalysisProp
    : (
      sessionDetailUsesImportedResultsSummary
        ? []
        : buildQuestionAnalysisRows(sessionDetailLatestAttempts, sessionDetailQuestions, getQuestionSectionLabel)
          .sort((a, b) => {
            if (b.rate !== a.rate) return b.rate - a.rate;
            return String(a.qid).localeCompare(String(b.qid));
          })
    );
  const sessionDetailDistributionStep = getDistributionTickStep(sessionDetailAnalysisSummary.maxBucketCount);
  const sessionDetailDistributionMax = Math.max(
    sessionDetailDistributionStep,
    Math.ceil(Math.max(0, sessionDetailAnalysisSummary.maxBucketCount) / sessionDetailDistributionStep) * sessionDetailDistributionStep
  );
  const sessionDetailDistributionTicks = Array.from(
    { length: Math.floor(sessionDetailDistributionMax / sessionDetailDistributionStep) + 1 },
    (_, index) => sessionDetailDistributionMax - (index * sessionDetailDistributionStep)
  );
  const sessionDetailQuestionStudents = Array.isArray(sessionDetailQuestionStudentsProp)
    ? sessionDetailQuestionStudentsProp
    : sessionDetailLatestAttempts
      .map((attempt) => {
        const student = studentsById.get(attempt.student_id) ?? null;
        return {
          id: attempt.student_id,
          display_name: attempt.display_name || student?.display_name || student?.email || attempt.student_id,
          student_code: attempt.student_code || student?.student_code || "",
        };
      })
      .sort((a, b) => {
        const nameCompare = String(a.display_name ?? "").localeCompare(String(b.display_name ?? ""));
        if (nameCompare !== 0) return nameCompare;
        return String(a.student_code ?? "").localeCompare(String(b.student_code ?? ""));
      });
  const sessionDetailMainSectionAverages = Array.isArray(sessionDetailMainSectionAveragesProp)
    ? sessionDetailMainSectionAveragesProp
    : (
      sessionDetailUsesImportedModelSummary
        ? buildImportedMainSectionAverageRows(sessionDetailLatestAttempts)
        : buildMainSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions, getQuestionSectionLabel, getSectionTitle)
    );
  const sessionDetailNestedSectionAverages = Array.isArray(sessionDetailNestedSectionAveragesProp)
    ? sessionDetailNestedSectionAveragesProp
    : (
      sessionDetailUsesImportedResultsSummary
        ? []
        : buildNestedSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions, getQuestionSectionLabel, getSectionTitle)
    );
  const sessionDetailStudentRankingRows = Array.isArray(sessionDetailStudentRankingRowsProp)
    ? sessionDetailStudentRankingRowsProp
    : (
      sessionDetailUsesImportedResultsSummary
        ? buildImportedSessionStudentRankingRows(sessionDetailLatestAttempts, sessionStudents)
        : buildSessionStudentRankingRows(sessionDetailLatestAttempts, sessionDetailQuestions, sessionStudents, getQuestionSectionLabel)
    );
  const sessionDetailRankingSections = Array.isArray(sessionDetailRankingSectionsProp)
    ? sessionDetailRankingSectionsProp
    : (
      sessionDetailUsesImportedResultsSummary
        ? sessionDetailMainSectionAverages.map((row) => ({ section: row.section }))
        : buildSectionAverageRows(sessionDetailLatestAttempts, sessionDetailQuestions, getQuestionSectionLabel)
            .map((row) => ({ section: row.section }))
    );
  const formatOrdinal = typeof formatOrdinalProp === "function" ? formatOrdinalProp : formatOrdinalFallback;
  const renderTwoLineHeader = typeof renderTwoLineHeaderProp === "function"
    ? renderTwoLineHeaderProp
    : renderTwoLineHeaderFallback;
  const canUseExternalAttemptDetail = typeof openAttemptDetailProp === "function"
    && typeof attemptCanOpenDetailProp === "function"
    && typeof setAttemptDetailOpenProp === "function"
    && typeof setSelectedAttemptObjProp === "function"
    && typeof setAttemptDetailSourceProp === "function";
  const attemptCanOpenDetail = typeof attemptCanOpenDetailProp === "function"
    ? attemptCanOpenDetailProp
    : (attempt) => {
      if (!attempt?.id) return false;
      if (isImportedSummaryAttempt(attempt)) return true;
      if (!attempt?.answers_json || typeof attempt.answers_json !== "object") return false;
      return Object.keys(attempt.answers_json).some((key) => key !== "__meta");
    };
  const [attemptDetailOpenState, setAttemptDetailOpenState] = useState(false);
  const [selectedAttemptObjState, setSelectedAttemptObjState] = useState(null);
  const [attemptDetailSourceState, setAttemptDetailSourceState] = useState("default");
  const [attemptDetailTabState, setAttemptDetailTabState] = useState("overview");
  const [attemptDetailWrongOnlyState, setAttemptDetailWrongOnlyState] = useState(false);
  const attemptDetailSectionRefsState = useRef({});
  const [localAttemptQuestionsByVersion, setLocalAttemptQuestionsByVersion] = useState({});
  const [localAttemptQuestionsLoading, setLocalAttemptQuestionsLoading] = useState(false);
  const [localAttemptQuestionsError, setLocalAttemptQuestionsError] = useState("");
  const attemptDetailOpen = canUseExternalAttemptDetail ? Boolean(attemptDetailOpenProp) : attemptDetailOpenState;
  const selectedAttempt = canUseExternalAttemptDetail ? (selectedAttemptProp ?? null) : selectedAttemptObjState;
  const attemptDetailSource = canUseExternalAttemptDetail ? (attemptDetailSourceProp ?? "default") : attemptDetailSourceState;
  const setAttemptDetailOpen = canUseExternalAttemptDetail ? setAttemptDetailOpenProp : setAttemptDetailOpenState;
  const setSelectedAttemptObj = canUseExternalAttemptDetail ? setSelectedAttemptObjProp : setSelectedAttemptObjState;
  const setAttemptDetailSource = canUseExternalAttemptDetail ? setAttemptDetailSourceProp : setAttemptDetailSourceState;
  const attemptDetailTab = typeof setAttemptDetailTabProp === "function" ? (attemptDetailTabProp ?? "overview") : attemptDetailTabState;
  const setAttemptDetailTab = typeof setAttemptDetailTabProp === "function" ? setAttemptDetailTabProp : setAttemptDetailTabState;
  const attemptDetailWrongOnly = typeof setAttemptDetailWrongOnlyProp === "function"
    ? Boolean(attemptDetailWrongOnlyProp)
    : attemptDetailWrongOnlyState;
  const setAttemptDetailWrongOnly = typeof setAttemptDetailWrongOnlyProp === "function"
    ? setAttemptDetailWrongOnlyProp
    : setAttemptDetailWrongOnlyState;
  const attemptDetailSectionRefs = attemptDetailSectionRefsProp ?? attemptDetailSectionRefsState;
  const localOpenAttemptDetail = (attempt, source = "default") => {
    if (!attempt?.id) return;
    if (!attemptCanOpenDetail(attempt)) return;
    setSelectedAttemptObj(attempt);
    setAttemptDetailSource(source);
    setAttemptDetailOpen(true);
  };
  const openAttemptDetail = canUseExternalAttemptDetail ? openAttemptDetailProp : localOpenAttemptDetail;

  const buildDetailedAttemptRows = (answersJson, questionsList) => {
    const answers = answersJson ?? {};
    const getChoiceText = (question, choiceIndex) => {
      if (choiceIndex == null) return "";
      const choices = question?.choices ?? question?.choicesJa ?? question?.choicesEn ?? [];
      return choices[choiceIndex] ?? `#${Number(choiceIndex) + 1}`;
    };
    const getChoiceImage = (question, choiceIndex) => {
      if (choiceIndex == null) return "";
      const direct = question?.choiceImages?.[choiceIndex];
      if (direct) return direct;
      const value = getChoiceText(question, choiceIndex);
      return isImageAsset(value) ? value : "";
    };
    const getPartChoiceText = (part, choiceIndex) => {
      if (choiceIndex == null) return "";
      const choices = part?.choices ?? part?.choicesJa ?? [];
      return choices[choiceIndex] ?? `#${Number(choiceIndex) + 1}`;
    };
    const getPartChoiceImage = (part, choiceIndex) => {
      if (choiceIndex == null) return "";
      const direct = part?.choiceImages?.[choiceIndex];
      if (direct) return direct;
      const value = getPartChoiceText(part, choiceIndex);
      return isImageAsset(value) ? value : "";
    };

    return (questionsList ?? []).flatMap((rawQuestion) => {
      const question = mergeQuestionData(rawQuestion);
      const answerKey = question.questionId ?? question.id;
      const section = getQuestionSectionLabel(question);
      const stemAsset = [
        question.stemAsset,
        question.mediaFile,
        question.media_file,
        question.stemImage,
        question.stemAudio,
        question.image,
        question.data?.stemAsset,
        question.data?.stem_asset,
        question.data?.stemImage,
        question.data?.stem_image,
        question.data?.stemAudio,
        question.data?.stem_audio,
      ].find(Boolean);
      const stemAssets = splitAssetValues(stemAsset);
      const stemImages = stemAssets.filter((value) => isImageAsset(value));
      const stemAudios = stemAssets.filter((value) => isAudioAsset(value));
      if (Array.isArray(question.parts) && question.parts.length) {
        const answer = answers[answerKey];
        return question.parts.map((part, index) => {
          const chosenIdx = answer?.partAnswers?.[index];
          const correctIdx = part?.answerIndex;
          return {
            qid: `${answerKey}-${index + 1}`,
            sectionKey: question.sectionKey || "",
            section,
            prompt: `${question.promptEn ?? question.promptBn ?? ""} ${part?.partLabel ?? ""} ${part?.questionJa ?? part?.promptEn ?? ""}`.trim(),
            chosen: getPartChoiceText(part, chosenIdx),
            chosenImage: getPartChoiceImage(part, chosenIdx),
            correct: getPartChoiceText(part, correctIdx),
            correctImage: getPartChoiceImage(part, correctIdx),
            isCorrect: chosenIdx === correctIdx,
            stemImages,
            stemAudios,
          };
        });
      }
      const chosenIdx = answers[answerKey];
      return [{
        qid: String(answerKey),
        sectionKey: question.sectionKey || "",
        section,
        prompt: getQuestionPrompt(question),
        chosen: getChoiceText(question, chosenIdx),
        chosenImage: getChoiceImage(question, chosenIdx),
        correct: getChoiceText(question, question.answerIndex),
        correctImage: getChoiceImage(question, question.answerIndex),
        isCorrect: chosenIdx === question.answerIndex,
        stemImages,
        stemAudios,
      }];
    });
  };

  const selectedAttemptQuestions = useMemo(() => {
    const version = selectedAttempt?.test_version;
    if (!version) return null;
    if (localAttemptQuestionsByVersion[version]) return localAttemptQuestionsByVersion[version];
    if (selectedAttempt?.test_session_id && selectedAttempt.test_session_id === selectedSessionDetail?.id && sessionDetailQuestions.length) {
      return sessionDetailQuestions;
    }
    return null;
  }, [localAttemptQuestionsByVersion, selectedAttempt, selectedSessionDetail?.id, sessionDetailQuestions]);

  useEffect(() => {
    if (canUseExternalAttemptDetail) return;
    const version = selectedAttempt?.test_version;
    if (!attemptDetailOpen || !version || !supabase || isImportedSummaryAttempt(selectedAttempt)) return;
    if (selectedAttemptQuestions?.length) return;
    let cancelled = false;
    const loadQuestions = async () => {
      setLocalAttemptQuestionsLoading(true);
      setLocalAttemptQuestionsError("");
      const fieldsWithMedia = "id, test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data, media_file, media_type";
      const baseFields = "id, test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data";
      let result = await supabase
        .from("questions")
        .select(fieldsWithMedia)
        .eq("test_version", version)
        .order("order_index", { ascending: true });
      if (result.error && (
        isMissingColumnError(result.error, "media_file")
        || isMissingColumnError(result.error, "media_type")
      )) {
        result = await supabase
          .from("questions")
          .select(baseFields)
          .eq("test_version", version)
          .order("order_index", { ascending: true });
      }
      if (cancelled) return;
      if (result.error) {
        setLocalAttemptQuestionsError(result.error.message);
        setLocalAttemptQuestionsLoading(false);
        return;
      }
      setLocalAttemptQuestionsByVersion((current) => ({
        ...current,
        [version]: (result.data ?? []).map(mapDbQuestion),
      }));
      setLocalAttemptQuestionsLoading(false);
    };
    void loadQuestions();
    return () => {
      cancelled = true;
    };
  }, [attemptDetailOpen, canUseExternalAttemptDetail, selectedAttempt, selectedAttemptQuestions, supabase]);

  useEffect(() => {
    if (!attemptDetailOpen) return;
    setAttemptDetailTab("overview");
    setAttemptDetailWrongOnly(false);
    if (attemptDetailSectionRefs?.current) attemptDetailSectionRefs.current = {};
  }, [attemptDetailOpen, selectedAttempt?.id]);

  const selectedAttemptUsesImportedSummary = typeof selectedAttemptUsesImportedSummaryProp === "boolean"
    ? selectedAttemptUsesImportedSummaryProp
    : isImportedSummaryAttempt(selectedAttempt);
  const selectedAttemptUsesImportedModelSummary = typeof selectedAttemptUsesImportedModelSummaryProp === "boolean"
    ? selectedAttemptUsesImportedModelSummaryProp
    : isImportedModelResultsSummaryAttempt(selectedAttempt);
  const selectedAttemptRows = Array.isArray(selectedAttemptRowsProp)
    ? selectedAttemptRowsProp
    : (
      !selectedAttempt || selectedAttemptUsesImportedSummary || !selectedAttemptQuestions?.length
        ? []
        : buildDetailedAttemptRows(selectedAttempt.answers_json, selectedAttemptQuestions)
    );
  const selectedAttemptSectionSummary = Array.isArray(selectedAttemptSectionSummaryProp)
    ? selectedAttemptSectionSummaryProp
    : (
      selectedAttemptUsesImportedModelSummary
        ? getImportedModelSectionSummaries(selectedAttempt)
        : buildSectionSummary(selectedAttemptRows)
    );
  const selectedAttemptIsModel = typeof selectedAttemptIsModelProp === "boolean"
    ? selectedAttemptIsModelProp
    : testMetaByVersion[selectedAttempt?.test_version]?.type === "mock";
  const selectedAttemptMainSectionSummary = Array.isArray(selectedAttemptMainSectionSummaryProp)
    ? selectedAttemptMainSectionSummaryProp
    : (
      selectedAttemptUsesImportedModelSummary
        ? getImportedModelSectionSummaries(selectedAttempt)
        : buildMainSectionSummary(selectedAttemptRows, getSectionTitle)
    );
  const selectedAttemptNestedSectionSummary = Array.isArray(selectedAttemptNestedSectionSummaryProp)
    ? selectedAttemptNestedSectionSummaryProp
    : (
      selectedAttemptUsesImportedModelSummary
        ? []
        : buildNestedSectionSummary(selectedAttemptRows, getSectionTitle)
    );
  const selectedAttemptPassRate = Number.isFinite(selectedAttemptPassRateProp)
    ? selectedAttemptPassRateProp
    : normalizePassRate(testMetaByVersion[selectedAttempt?.test_version]?.pass_rate);
  const selectedAttemptQuestionSectionsFiltered = Array.isArray(selectedAttemptQuestionSectionsFilteredProp)
    ? selectedAttemptQuestionSectionsFilteredProp
    : (() => {
      const groups = new Map();
      selectedAttemptRows.forEach((row) => {
        const key = getSectionTitle(row.sectionKey) || row.sectionKey || row.section || "Unknown";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      });
      return Array.from(groups.entries())
        .map(([title, rows]) => ({
          title,
          rows: attemptDetailWrongOnly ? rows.filter((row) => !row.isCorrect) : rows,
        }))
        .filter((section) => section.rows.length > 0);
    })();
  const selectedAttemptScoreRate = Number.isFinite(selectedAttemptScoreRateProp)
    ? selectedAttemptScoreRateProp
    : (selectedAttempt ? getScoreRate(selectedAttempt) : 0);
  const selectedAttemptIsPass = typeof selectedAttemptIsPassProp === "boolean"
    ? selectedAttemptIsPassProp
    : selectedAttemptScoreRate >= selectedAttemptPassRate;
  const selectedAttemptDisplayName = selectedAttempt
    ? (
      selectedAttempt.display_name
      || studentsById.get(selectedAttempt.student_id)?.display_name
      || studentsById.get(selectedAttempt.student_id)?.email
      || selectedAttempt.student_id
      || ""
    )
    : "";
  const studentAttemptRanks = studentAttemptRanksProp ?? {};
  const attemptQuestionsLoading = canUseExternalAttemptDetail && typeof attemptQuestionsLoadingProp === "boolean"
    ? attemptQuestionsLoadingProp
    : localAttemptQuestionsLoading;
  const attemptQuestionsError = canUseExternalAttemptDetail ? (attemptQuestionsErrorProp ?? "") : localAttemptQuestionsError;

  function closeSessionDetailAnalysisPopup() {
    setSessionDetailAnalysisPopup({ open: false, title: "", questions: [] });
  }

  function openSessionDetailAnalysisPopupFor(kind, value) {
    const label = String(value ?? "").trim();
    if (!label) return;
    const filteredQuestions = (sessionDetailQuestions ?? []).filter((question) => {
      const mainSection = getSectionTitle(question?.sectionKey) || question?.sectionKey || "Unknown";
      const subSection = getQuestionSectionLabel(question) || question?.sectionKey || "Unknown";
      if (kind === "section") return mainSection === label;
      if (kind === "subSection") return subSection === label;
      return false;
    });
    setSessionDetailAnalysisPopup({
      open: true,
      title: `${label} Questions`,
      questions: filteredQuestions,
    });
  }

  function handleSessionDetailAnalysisRowKeyDown(event, kind, value) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openSessionDetailAnalysisPopupFor(kind, value);
  }

  async function replacePreviewQuestion(targetDbId) {
    if (!previewSession?.problem_set_id || !targetDbId) return;
    const nextKey = previewReplacementDrafts[targetDbId];
    if (!nextKey) {
      setPreviewReplacementMsg("Choose a replacement question first.");
      return;
    }

    const targetQuestion = previewQuestions.find((question) => question.dbId === targetDbId);
    const sourceQuestion = previewReplacementPool.find((question) =>
      buildSourceQuestionKey(question.sourceVersion || question.testVersion, question.sourceQuestionId || question.questionId) === nextKey
    );
    if (!targetQuestion || !sourceQuestion?.dbId) {
      setPreviewReplacementMsg("Replacement question was not found.");
      return;
    }

    setPreviewReplacementSavingId(targetDbId);
    setPreviewReplacementMsg("");

    const { data: sourceChoices, error: sourceChoicesError } = await supabase
      .from("choices")
      .select("part_index, choice_index, label, choice_image")
      .eq("question_id", sourceQuestion.dbId);
    if (sourceChoicesError) {
      console.error("replacement choices fetch error:", sourceChoicesError);
      setPreviewReplacementMsg(`Replacement load failed: ${sourceChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextData = {
      ...(sourceQuestion.rawData ?? {}),
      itemId: targetQuestion.id,
      sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
      sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
    };

    const { error: updateQuestionError } = await supabase
      .from("questions")
      .update({
        section_key: sourceQuestion.sectionKey,
        type: sourceQuestion.type,
        prompt_en: sourceQuestion.promptEn ?? null,
        prompt_bn: sourceQuestion.promptBn ?? null,
        answer_index: sourceQuestion.answerIndex,
        data: nextData,
      })
      .eq("id", targetDbId);
    if (updateQuestionError) {
      console.error("replacement question update error:", updateQuestionError);
      setPreviewReplacementMsg(`Replace failed: ${updateQuestionError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const { error: deleteChoicesError } = await supabase
      .from("choices")
      .delete()
      .eq("question_id", targetDbId);
    if (deleteChoicesError) {
      console.error("replacement delete choices error:", deleteChoicesError);
      setPreviewReplacementMsg(`Replace failed: ${deleteChoicesError.message}`);
      setPreviewReplacementSavingId("");
      return;
    }

    const nextChoices = (sourceChoices ?? []).map((choice) => ({
      question_id: targetDbId,
      part_index: choice.part_index ?? null,
      choice_index: choice.choice_index,
      label: choice.label,
      choice_image: choice.choice_image,
    }));
    if (nextChoices.length) {
      const { error: insertChoicesError } = await supabase.from("choices").insert(nextChoices);
      if (insertChoicesError) {
        console.error("replacement insert choices error:", insertChoicesError);
        setPreviewReplacementMsg(`Replace failed: ${insertChoicesError.message}`);
        setPreviewReplacementSavingId("");
        return;
      }
    }

    setPreviewQuestions((current) => current.map((question) => {
      if (question.dbId !== targetDbId) return question;
      return {
        ...sourceQuestion,
        dbId: question.dbId,
        id: question.id,
        questionId: question.questionId,
        orderIndex: question.orderIndex,
        rawData: nextData,
        sourceVersion: sourceQuestion.sourceVersion || sourceQuestion.testVersion || null,
        sourceQuestionId: sourceQuestion.sourceQuestionId || sourceQuestion.questionId || null,
      };
    }));
    setPreviewReplacementDrafts((current) => ({ ...current, [targetDbId]: "" }));
    setPreviewReplacementSavingId("");
    setPreviewReplacementMsg("Question replaced.");
    fetchTests();
  }

  function QuestionPreviewCard({ question, index, children }) {
    const prompt = question.promptEn || question.promptBn || "";
    const choices = question.choices ?? question.choicesJa ?? [];
    const stemKind = normalizeModelCsvKind(question.stemKind || "");
    const stemText = question.stemText;
    const stemExtra = question.stemExtra;
    const stemAsset = question.stemAsset;
    const stemAssets = splitAssetValues(stemAsset);
    const imageAssets = stemAssets.filter((value) => isImageAsset(value));
    const audioAssets = stemAssets.filter((value) => isAudioAsset(value));
    const boxText = question.boxText;
    const isImageStem = ["image", "passage_image", "table_image"].includes(stemKind);
    const isAudioStem = stemKind === "audio";
    const shouldShowImage = imageAssets.length > 0 || (isImageStem && stemAsset);
    const shouldShowAudio = audioAssets.length > 0 || (isAudioStem && stemAsset);
    const stemLines = splitStemLines(stemExtra);
    const textBoxLines = splitTextBoxStemLines(stemExtra || stemText);
    const sectionLabel = getQuestionSectionLabel(question) || question.sectionKey;
    const displayQuestionId = String(question.sourceQuestionId ?? "").trim()
      || String(question.id ?? "").split("__").filter(Boolean)[1]
      || String(question.id ?? "").trim();

    const renderChoices = () => (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
        {choices.map((choice, choiceIndex) => {
          const isCorrect = question.answerIndex === choiceIndex;
          const isImage = isImageAsset(choice);
          return (
            <div
              key={`choice-${question.id}-${choiceIndex}`}
              className="btn"
              style={{
                border: isCorrect ? "2px solid #1a7f37" : "1px solid #ddd",
                background: isCorrect ? "#e7f7ee" : "#fff",
                padding: 8,
              }}
            >
              {isImage ? (
                <img src={choice} alt="choice" style={{ maxWidth: "100%" }} />
              ) : (
                choice
              )}
            </div>
          );
        })}
      </div>
    );

    return (
      <div style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 700 }}>
            {displayQuestionId} {sectionLabel ? `(${sectionLabel})` : ""} {index != null ? `#${index + 1}` : ""}
          </div>
          {children ? <div style={{ display: "flex", justifyContent: "flex-end" }}>{children}</div> : null}
        </div>
        {prompt ? <div style={{ marginTop: 6, whiteSpace: question.type === "daily" ? "pre-wrap" : "normal" }}>{prompt}</div> : null}
        {question.type === "daily" && stemExtra ? (
          <div style={{ marginTop: 6, fontSize: 13, color: "#333333", whiteSpace: "pre-wrap" }}>
            {stemExtra}
          </div>
        ) : null}
        {stemText && stemKind !== "text_box" ? (
          <div
            style={{ marginTop: 6 }}
            dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
          />
        ) : null}
        {stemKind === "text_box" && textBoxLines.length ? (
          <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
            {textBoxLines.map((line, lineIndex) => {
              const parsed = parseSpeakerStemLine(line);
              if (!parsed || !parsed.speaker) {
                return (
                  <div
                    key={`textbox-line-${question.id}-${lineIndex}`}
                    dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
                  />
                );
              }
              return (
                <div
                  key={`textbox-line-${question.id}-${lineIndex}`}
                  style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "0.45em", alignItems: "start" }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>{parsed.speaker}{parsed.delimiter}</span>
                  <span dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(parsed.body) }} />
                </div>
              );
            })}
          </div>
        ) : null}
        {stemLines.length && question.type !== "daily" && stemKind !== "text_box" ? (
          <div style={{ marginTop: 6 }}>
            {stemLines.map((line, lineIndex) => (
              <div
                key={`line-${question.id}-${lineIndex}`}
                dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(line) }}
              />
            ))}
          </div>
        ) : null}
        {boxText ? (
          <div
            className="boxed"
            style={{ marginTop: 8 }}
            dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(boxText) }}
          />
        ) : null}
        {shouldShowImage ? (
          imageAssets.map((asset, assetIndex) => (
            <img key={`preview-image-${question.id}-${assetIndex}`} src={asset} alt="stem" style={{ marginTop: 8, maxWidth: "100%" }} />
          ))
        ) : null}
        {shouldShowAudio ? (
          audioAssets.map((asset, assetIndex) => (
            <audio key={`preview-audio-${question.id}-${assetIndex}`} controls src={asset} style={{ marginTop: 8, width: "100%" }} />
          ))
        ) : null}

        <div style={{ marginTop: 10 }}>
          {choices.length ? renderChoices() : null}
        </div>
      </div>
    );
  }

  function renderPreviewQuestionCard(question, index) {
    const activeSourceKeys = new Set(
      previewQuestions
        .map((item) => buildSourceQuestionKey(item.sourceVersion, item.sourceQuestionId))
        .filter((key) => key !== "::")
    );
    const currentSourceKey = buildSourceQuestionKey(question.sourceVersion, question.sourceQuestionId);
    activeSourceKeys.delete(currentSourceKey);
    const replacementOptions = previewReplacementPool.filter((candidate) => {
      const candidateKey = buildSourceQuestionKey(
        candidate.sourceVersion || candidate.testVersion,
        candidate.sourceQuestionId || candidate.questionId
      );
      return candidateKey !== currentSourceKey && !activeSourceKeys.has(candidateKey);
    });
    const canReplace = Boolean(
      previewSession
      && isGeneratedDailySessionVersion(previewSession.problem_set_id)
      && replacementOptions.length
      && question.dbId
    );

    return (
      <QuestionPreviewCard key={`${question.id}-${index}`} question={question} index={index}>
        {canReplace ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select
              value={previewReplacementDrafts[question.dbId] ?? ""}
              onChange={(e) =>
                setPreviewReplacementDrafts((current) => ({
                  ...current,
                  [question.dbId]: e.target.value,
                }))
              }
              style={{ minWidth: 260 }}
            >
              <option value="">Replace with...</option>
              {replacementOptions.map((candidate) => {
                const candidateKey = buildSourceQuestionKey(
                  candidate.sourceVersion || candidate.testVersion,
                  candidate.sourceQuestionId || candidate.questionId
                );
                return (
                  <option key={`${question.dbId}-${candidateKey}`} value={candidateKey}>
                    {(candidate.sourceVersion || candidate.testVersion)} / {(candidate.sourceQuestionId || candidate.questionId)}
                  </option>
                );
              })}
            </select>
            <button
              className="btn"
              type="button"
              disabled={previewReplacementSavingId === question.dbId}
              onClick={() => replacePreviewQuestion(question.dbId)}
            >
              {previewReplacementSavingId === question.dbId ? "Replacing..." : "Replace Question"}
            </button>
          </div>
        ) : null}
      </QuestionPreviewCard>
    );
  }

  function renderSessionDetailView() {
    if (!selectedSessionDetail) return null;
    const isMockSessionDetail = sessionDetail.type === "mock";
    const isImportedSummarySession = sessionDetailUsesImportedResultsSummary;
    const isImportedModelSummarySession = sessionDetailUsesImportedModelSummary;
    const analysisPopupQuestions = Array.isArray(sessionDetailAnalysisPopup.questions)
      ? sessionDetailAnalysisPopup.questions
      : [];

    const bestQuestions = sessionDetailQuestionAnalysis.slice(0, 5);
    const worstQuestions = [...sessionDetailQuestionAnalysis]
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return String(a.qid).localeCompare(String(b.qid));
      })
      .slice(0, 5);
    const sessionDetailTabs = isImportedSummarySession
      ? [
        ["analysis", "Result Analysis"],
        ["studentRanking", "Student Ranking"],
      ]
      : [
        ["analysis", "Result Analysis"],
        ["questions", "Questions"],
        ["attempts", "Attempts"],
        ["studentRanking", "Student Ranking"],
      ];
    const analysisRadarData = sessionDetailMainSectionAverages.map((row) => ({
      label: row.section,
      value: row.averageRate ?? 0,
    }));

    return (
      <div className="session-detail-page">
        <div className="session-detail-header">
          <div className="session-detail-head-main">
            <div className="session-detail-head-top">
              <button
                className="session-detail-back-btn"
                type="button"
                onClick={closeSessionDetail}
                aria-label="Back to sessions"
                title="Back to sessions"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                  <path
                    d="m15 6-6 6 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => deleteTestSession(selectedSessionDetail.id, {
                  title: selectedSessionDetail.title || selectedSessionDetail.problem_set_id,
                  type: sessionDetail.type,
                  refreshResults: true,
                  surface: "results",
                })}
              >
                Delete test
              </button>
            </div>
            <div className="admin-title session-detail-title">
              {selectedSessionDetail.title || selectedSessionDetail.problem_set_id}
            </div>
            <div className="admin-help session-detail-meta">
              {!isMockSessionDetail ? (
                <>
                  SetID: <b>{selectedSessionDetail.problem_set_id}</b>
                  {" · "}
                </>
              ) : null}
              Start: <b>{formatCompactDateTime(selectedSessionDetail.starts_at) || "—"}</b>
              {" · "}
              End: <b>{formatCompactDateTime(selectedSessionDetail.ends_at) || "—"}</b>
            </div>
            <div className="admin-top-tabs session-detail-tabs">
              {sessionDetailTabs.map(([key, label]) => (
                <button
                  key={`session-detail-tab-${key}`}
                  className={`admin-top-tab ${sessionDetailTab === key ? "active" : ""}`}
                  type="button"
                  onClick={() => setSessionDetailTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sessionDetailLoading ? <div className="admin-msg">Loading...</div> : null}
        {!sessionDetailLoading && sessionDetailMsg ? <div className="admin-msg">{sessionDetailMsg}</div> : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "questions" ? (
          <div className="session-detail-section">
            <div className="admin-help">
              Total: <b>{sessionDetailQuestions.length}</b>
            </div>
            {!sessionDetailQuestions.length ? (
              <div className="admin-help" style={{ marginTop: 8 }}>No questions found for this session.</div>
            ) : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                {sessionDetailQuestions.map((question, index) => (
                  <QuestionPreviewCard
                    key={`session-detail-question-${question.id}-${index}`}
                    question={question}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "attempts" ? (
          <div className="session-detail-section">
            <div className="session-detail-actions">
              <div>
                <div className="admin-title" style={{ fontSize: 18 }}>Allow another attempt</div>
                <div className="admin-help">
                  Select a student who already submitted this test and add one more allowed attempt.
                </div>
              </div>
              <div className="session-detail-allow-form">
                <select
                  value={sessionDetailAllowStudentId}
                  onChange={(e) => setSessionDetailAllowStudentId(e.target.value)}
                  disabled={!sessionDetailStudentOptions.length || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  {sessionDetailStudentOptions.length ? (
                    sessionDetailStudentOptions.map((student) => {
                      const extraAttempts = Number(sessionDetailAllowances[student.id] ?? 0);
                      return (
                        <option key={`session-allow-${student.id}`} value={student.id}>
                          {student.display_name}
                          {student.student_code ? ` (${student.student_code})` : ""}
                          {extraAttempts > 0 ? ` (+${extraAttempts} extra)` : ""}
                        </option>
                      );
                    })
                  ) : (
                    <option value="">No submitted students</option>
                  )}
                </select>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={allowSessionAnotherAttempt}
                  disabled={!sessionDetailAllowStudentId || selectedSessionDetail.allow_multiple_attempts !== false}
                >
                  Allow another attempt
                </button>
              </div>
            </div>
            {selectedSessionDetail.allow_multiple_attempts !== false ? (
              <div className="admin-help" style={{ marginTop: 10 }}>
                This session already allows multiple attempts for everyone.
              </div>
            ) : null}
            {sessionDetailAllowMsg ? <div className="admin-msg">{sessionDetailAllowMsg}</div> : null}

            <div className="admin-table-wrap" style={{ marginTop: 12 }}>
              <table className="admin-table" style={{ minWidth: 980 }}>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Submitted</th>
                    <th>Name</th>
                    <th>Student<br />No.</th>
                    <th>Score</th>
                    <th>Rate</th>
                    <th>Status</th>
                    <th>Attempt ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailDisplayAttempts.map((attempt, index) => {
                    const passed = getScoreRate(attempt) >= sessionDetailPassRate;
                    return (
                      <tr key={`session-attempt-${attempt.id}`} onClick={() => openAttemptDetail(attempt)}>
                        <td>{index + 1}</td>
                        <td>{attempt.created_at ? new Date(attempt.created_at).toLocaleString("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/,/, "") : ""}</td>
                        <td>{attempt.display_name ?? ""}</td>
                        <td>{attempt.student_code ?? ""}</td>
                        <td>{attempt.correct}/{attempt.total}</td>
                        <td>{(getScoreRate(attempt) * 100).toFixed(1)}%</td>
                        <td className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{attempt.id}</td>
                      </tr>
                    );
                  })}
                  {!sessionDetailDisplayAttempts.length ? (
                    <tr>
                      <td colSpan={8}>No attempts yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "studentRanking" ? (
          <div className="session-detail-section">
            <div className="admin-table-wrap">
              <table className="admin-table session-student-ranking-table" style={{ minWidth: Math.max(900, 420 + sessionDetailRankingSections.length * 120) }}>
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Student<br />No.</th>
                    <th>Total Score</th>
                    <th>Total %</th>
                    {sessionDetailRankingSections.map((section) => (
                      <th key={`student-ranking-col-${section.section}`}>
                        <span className="session-ranking-section-header">
                          {getSectionLabelLines(section.section).map((line, index) => (
                            <span key={`student-ranking-col-${section.section}-${index}`}>{line}</span>
                          ))}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sessionDetailStudentRankingRows.map((row) => (
                    <tr key={`student-ranking-row-${row.student_id}`} onClick={() => openAttemptDetail(row.attempt, "sessionRanking")}>
                      <td>{formatOrdinal(row.rank)}</td>
                      <td>{row.display_name}</td>
                      <td>{row.student_code || "—"}</td>
                      <td>{row.totalCorrect}/{row.totalQuestions}</td>
                      <td>{(row.totalRate * 100).toFixed(1)}%</td>
                      {sessionDetailRankingSections.map((section) => (
                        <td key={`student-ranking-cell-${row.student_id}-${section.section}`}>
                          {((row.sectionRates?.[section.section] ?? 0) * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!sessionDetailStudentRankingRows.length ? (
                    <tr>
                      <td colSpan={Math.max(5, 5 + sessionDetailRankingSections.length)}>No ranking data available.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!sessionDetailLoading && !sessionDetailMsg && sessionDetailTab === "analysis" ? (
          <div className="session-detail-section">
            <div className="session-detail-analysis-summary">
              <div className="session-analysis-top-grid">
                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Class Score</div>
                  <div className="session-analysis-score-table-wrap">
                    <table className="session-analysis-score-table">
                      <tbody>
                        <tr>
                          <th className="pass">No. of Pass</th>
                          <td>
                            <span className="session-analysis-score-main pass">{sessionDetailAnalysisSummary.passCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th className="fail">No. of Fail</th>
                          <td>
                            <span className="session-analysis-score-main fail">{sessionDetailAnalysisSummary.failCount}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.attendedCount}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average score</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.averageCorrect.toFixed(2)}</span>
                            <span className="session-analysis-score-sub">/{sessionDetailAnalysisSummary.totalQuestions || 0}</span>
                          </td>
                        </tr>
                        <tr>
                          <th>Average %</th>
                          <td>
                            <span className={`session-analysis-score-main ${sessionDetailOverview.averageScore < sessionDetailPassRate ? "fail" : ""}`}>
                              {(sessionDetailAnalysisSummary.averageRate * 100).toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <th>Absent</th>
                          <td>
                            <span className="session-analysis-score-main">{sessionDetailAnalysisSummary.absentCount}</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="session-analysis-top-card">
                  <div className="session-analysis-top-heading">Grade Distribution</div>
                  <div className="session-analysis-distribution-chart">
                    <div className="session-analysis-distribution-yaxis">
                      {sessionDetailDistributionTicks.map((value) => (
                        <div key={`dist-y-${value}`} className="session-analysis-distribution-ytick">
                          <span>{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="session-analysis-distribution-plot">
                      <div
                        className="session-analysis-distribution-grid"
                        style={{ gridTemplateRows: `repeat(${sessionDetailDistributionTicks.length}, 1fr)` }}
                      >
                        {sessionDetailDistributionTicks.map((value) => (
                          <div key={`dist-grid-${value}`} className="session-analysis-distribution-gridline" />
                        ))}
                      </div>
                      <div className="session-analysis-distribution-bars">
                        {sessionDetailAnalysisSummary.bucketLabels.map((label, index) => {
                          const count = sessionDetailAnalysisSummary.bucketCounts[index] ?? 0;
                          return (
                            <div key={`dist-bar-${label}`} className="session-analysis-distribution-bar-group">
                              <div className="session-analysis-distribution-bar-wrap">
                                <div
                                  className={`session-analysis-distribution-bar ${index * 10 < sessionDetailPassRate * 100 ? "fail" : "pass"}`}
                                  style={{ height: `${(count / sessionDetailDistributionMax) * 100}%` }}
                                  title={`${label}: ${count} student${count === 1 ? "" : "s"}`}
                                />
                              </div>
                              <div className="session-analysis-distribution-label">{label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isMockSessionDetail && (isImportedModelSummarySession || sessionDetailNestedSectionAverages.length) ? (
                <div className="admin-panel session-analysis-performance-panel">
                  <div className="admin-title" style={{ fontSize: 18 }}>Average Section Performance</div>
                  <div className="session-analysis-summary-grid">
                    <div className="session-radar-wrap">
                      {analysisRadarData.length ? (
                        buildSectionRadarSvg(analysisRadarData)
                      ) : (
                        <div className="admin-help">No section average data yet.</div>
                      )}
                    </div>
                    <div className="admin-table-wrap">
                      {isImportedModelSummarySession ? (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 520 }}>
                          <thead>
                            <tr>
                              <th>Section</th>
                              <th>Total</th>
                              <th>Average</th>
                              <th>Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailMainSectionAverages.map((row) => {
                              const isBelowPass = row.averageRate < sessionDetailPassRate;
                              return (
                                <tr key={`session-average-main-${row.section}`}>
                                  <td><span className="session-ranking-section-header">{renderTwoLineHeader(row.section)}</span></td>
                                  <td>{row.total}</td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {row.averageCorrect.toFixed(2)}
                                  </td>
                                  <td className={isBelowPass ? "attempt-score-detail-below-pass" : ""}>
                                    {(row.averageRate * 100).toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                            {!sessionDetailMainSectionAverages.length ? (
                              <tr>
                                <td colSpan={4}>No section average data yet.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      ) : (
                        <table className="admin-table session-section-average-table" style={{ minWidth: 640 }}>
                          <colgroup>
                            <col className="session-section-average-col-section" />
                            <col className="session-section-average-col-subsection" />
                            <col className="session-section-average-col-total" />
                            <col className="session-section-average-col-correct" />
                            <col className="session-section-average-col-rate" />
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="session-section-average-head-section">Section</th>
                              <th className="session-section-average-head-subsection">Sub-section</th>
                              <th className="session-section-average-head-total">Total</th>
                              <th className="session-section-average-head-correct">Average</th>
                              <th className="session-section-average-head-rate">Average %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sessionDetailNestedSectionAverages.map((group) => {
                              const rowSpan = 1 + group.subSections.length;
                              const isGroupBelowPass = group.averageRate < sessionDetailPassRate;
                              return (
                                <Fragment key={`session-average-group-${group.mainSection}`}>
                                  <tr className="attempt-overview-total-row session-section-average-total-row">
                                    <td rowSpan={rowSpan} className="attempt-overview-area-cell session-section-average-cell-section">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-section-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="session-ranking-section-header">{renderTwoLineHeader(group.mainSection)}</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-subsection">
                                      <button
                                        type="button"
                                        className="session-section-average-trigger session-section-average-total-trigger"
                                        onClick={() => openSessionDetailAnalysisPopupFor("section", group.mainSection)}
                                      >
                                        <span className="attempt-score-detail-total-label">Total</span>
                                      </button>
                                    </td>
                                    <td className="session-section-average-cell-total">{group.total}</td>
                                    <td className={`session-section-average-cell-correct ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {group.averageCorrect.toFixed(2)}
                                    </td>
                                    <td className={`session-section-average-cell-rate ${isGroupBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                      {(group.averageRate * 100).toFixed(1)}%
                                    </td>
                                  </tr>
                                  {group.subSections.map((subSection) => {
                                    const isSubSectionBelowPass = subSection.averageRate < sessionDetailPassRate;
                                    return (
                                      <tr
                                        key={`session-average-sub-${group.mainSection}-${subSection.section}`}
                                        className="session-section-average-subsection-row"
                                        onClick={() => openSessionDetailAnalysisPopupFor("subSection", subSection.section)}
                                        onKeyDown={(event) => handleSessionDetailAnalysisRowKeyDown(event, "subSection", subSection.section)}
                                        tabIndex={0}
                                        role="button"
                                      >
                                        <td className="session-section-average-cell-subsection">{subSection.section}</td>
                                        <td className="session-section-average-cell-total">{subSection.total}</td>
                                        <td className={`session-section-average-cell-correct ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {subSection.averageCorrect.toFixed(2)}
                                        </td>
                                        <td className={`session-section-average-cell-rate ${isSubSectionBelowPass ? "attempt-score-detail-below-pass" : ""}`}>
                                          {(subSection.averageRate * 100).toFixed(1)}%
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {!isImportedSummarySession ? (
              <>
                <div className="session-detail-analysis-grid">
                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Best Questions</div>
                    <div className="session-analysis-list">
                      {bestQuestions.map((row) => (
                        <div key={`best-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-question-prompt">{row.prompt || "Question"}</div>
                            <div className="session-analysis-question-id">{row.qid}</div>
                          </div>
                        </div>
                      ))}
                      {!bestQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>

                  <div className="admin-panel">
                    <div className="session-analysis-heading">Top 5 Worst Questions</div>
                    <div className="session-analysis-list">
                      {worstQuestions.map((row) => (
                        <div key={`worst-${row.qid}`} className="session-analysis-item">
                          <div className="session-analysis-rate">{(row.rate * 100).toFixed(1)}%</div>
                          <div>
                            <div className="session-analysis-question-prompt">{row.prompt || "Question"}</div>
                            <div className="session-analysis-question-id">{row.qid}</div>
                          </div>
                        </div>
                      ))}
                      {!worstQuestions.length ? <div className="admin-help">No question data yet.</div> : null}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <button
                    className="link-btn"
                    type="button"
                    onClick={() => setSessionDetailShowAllAnalysis((current) => !current)}
                  >
                    {sessionDetailShowAllAnalysis ? "Hide all v" : "View all ->"}
                  </button>
                </div>

                {sessionDetailShowAllAnalysis ? (
                  <div className="admin-table-wrap" style={{ marginTop: 12 }}>
                    <table className="admin-table session-analysis-table" style={{ minWidth: 1100 }}>
                      <thead>
                        <tr>
                          <th>Question</th>
                          <th>Accuracy</th>
                          {sessionDetailQuestionStudents.map((student) => (
                            <th key={`analysis-student-${student.id}`}>
                              <div>{student.display_name}</div>
                              {student.student_code ? (
                                <div className="session-analysis-student-code">{student.student_code}</div>
                              ) : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sessionDetailQuestionAnalysis.map((row) => (
                          <tr key={`analysis-row-${row.qid}`}>
                            <td>
                              <div style={{ fontWeight: 800 }}>{row.qid}</div>
                              <div className="admin-help">{row.prompt}</div>
                            </td>
                            <td>{(row.rate * 100).toFixed(1)}%</td>
                            {sessionDetailQuestionStudents.map((student) => {
                              const status = row.byStudent[student.id];
                              return (
                                <td key={`analysis-cell-${row.qid}-${student.id}`} className="session-analysis-cell">
                                  {status == null ? "—" : status ? "○" : "×"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {!sessionDetailQuestionAnalysis.length ? (
                          <tr>
                            <td colSpan={Math.max(2, sessionDetailQuestionStudents.length + 2)}>No question analysis available.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {sessionDetailAnalysisPopup.open ? (
          <div className="admin-modal-overlay" onClick={closeSessionDetailAnalysisPopup}>
            <div className="admin-modal admin-modal-wide session-analysis-popup-modal" onClick={(event) => event.stopPropagation()}>
              <div className="admin-modal-header">
                <div>
                  <div className="admin-title">{sessionDetailAnalysisPopup.title || "Questions"}</div>
                  <div className="admin-help">
                    Total: <b>{analysisPopupQuestions.length}</b>
                  </div>
                </div>
                <button className="admin-modal-close" onClick={closeSessionDetailAnalysisPopup} aria-label="Close">
                  ×
                </button>
              </div>
              <div className="session-analysis-popup-body">
                {analysisPopupQuestions.length ? (
                  analysisPopupQuestions.map((question, index) => (
                    <QuestionPreviewCard
                      key={`session-analysis-popup-${question.id}-${index}`}
                      question={question}
                      index={index}
                    />
                  ))
                ) : (
                  <div className="admin-help">No questions found for this selection.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <AdminConsoleDeferredFeatures
      {...props}
      deleteTest={deleteTest}
      attemptCanOpenDetail={attemptCanOpenDetail}
      openAttemptDetail={openAttemptDetail}
      renderSessionDetailView={renderSessionDetailView}
      renderPreviewQuestionCard={renderPreviewQuestionCard}
      buildSectionRadarSvg={buildSectionRadarSvg}
      renderUnderlinesHtml={renderUnderlinesHtml}
      attemptDetailOpen={attemptDetailOpen}
      selectedAttempt={selectedAttempt}
      selectedAttemptDisplayName={selectedAttemptDisplayName}
      selectedAttemptRows={selectedAttemptRows}
      selectedAttemptScoreRate={selectedAttemptScoreRate}
      studentAttemptRanks={studentAttemptRanks}
      attemptDetailSource={attemptDetailSource}
      selectedAttemptUsesImportedSummary={selectedAttemptUsesImportedSummary}
      selectedAttemptUsesImportedModelSummary={selectedAttemptUsesImportedModelSummary}
      selectedAttemptMainSectionSummary={selectedAttemptMainSectionSummary}
      setAttemptDetailOpen={setAttemptDetailOpen}
      setSelectedAttemptObj={setSelectedAttemptObj}
      setAttemptDetailSource={setAttemptDetailSource}
      attemptQuestionsLoading={attemptQuestionsLoading}
      attemptQuestionsError={attemptQuestionsError}
      attemptDetailTab={attemptDetailTab}
      setAttemptDetailTab={setAttemptDetailTab}
      selectedAttemptIsPass={selectedAttemptIsPass}
      selectedAttemptIsModel={selectedAttemptIsModel}
      selectedAttemptNestedSectionSummary={selectedAttemptNestedSectionSummary}
      selectedAttemptPassRate={selectedAttemptPassRate}
      renderTwoLineHeader={renderTwoLineHeader}
      selectedAttemptSectionSummary={selectedAttemptSectionSummary}
      selectedAttemptQuestionSectionsFiltered={selectedAttemptQuestionSectionsFiltered}
      attemptDetailSectionRefs={attemptDetailSectionRefs}
      attemptDetailWrongOnly={attemptDetailWrongOnly}
      setAttemptDetailWrongOnly={setAttemptDetailWrongOnly}
    />
  );
}
