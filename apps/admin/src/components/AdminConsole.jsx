"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { questions, sections } from "../../../../packages/shared/questions.js";
import { createAdminSupabaseClient } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";

const DEFAULT_MODEL_CATEGORY = "Book Review";
const ADMIN_SCHOOL_SCOPE_STORAGE_KEY = "jft_admin_school_scope";

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  const escapeCell = (v) => {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  return rows.map((r) => r.map(escapeCell).join(",")).join("\n");
}

function getSectionTitle(sectionKey) {
  return sections.find((s) => s.key === sectionKey)?.title ?? sectionKey ?? "";
}

function getProblemSetTitle(problemSetId, testsList) {
  const item = (testsList ?? []).find((t) => t.version === problemSetId);
  return item?.title || problemSetId || "";
}

function renderTwoLineHeader(title) {
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

function getChoiceText(q, idx) {
  if (idx == null) return "";
  if (Array.isArray(q.choices) && q.choices[idx] != null) return q.choices[idx];
  if (Array.isArray(q.choicesJa) && q.choicesJa[idx] != null) return q.choicesJa[idx];
  if (Array.isArray(q.choicesEn) && q.choicesEn[idx] != null) return q.choicesEn[idx];
  return `#${Number(idx) + 1}`;
}

function getPartChoiceText(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choicesJa) && part.choicesJa[idx] != null) return part.choicesJa[idx];
  return `#${Number(idx) + 1}`;
}

function getPromptText(q) {
  if (q.boxText) return q.boxText;
  if (q.stemText) return q.stemText;
  if (q.stemExtra) return q.stemExtra;
  if (q.type === "mcq_sentence_blank") return q.sentenceJa ?? q.promptEn ?? "";
  if (q.type === "mcq_kanji_reading") return q.sentencePartsJa?.map((p) => p.text).join("") ?? q.promptEn ?? "";
  if (q.type === "mcq_dialog_with_image") return q.dialogJa?.join(" / ") ?? q.promptEn ?? "";
  return q.promptEn ?? "";
}

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
  return escaped.replace(/【(.*?)】/g, '<span class="u">$1</span>');
}

function splitStemLines(text) {
  return String(text ?? "")
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isImageAsset(value) {
  return /\.(png|jpe?g|webp)$/i.test(String(value ?? "").trim());
}

function isAudioAsset(value) {
  return /\.(mp3|wav|m4a|ogg)$/i.test(String(value ?? "").trim());
}

function getQuestionIllustration(question) {
  if (!question) return null;
  const stemAsset =
    question.stemAsset ||
    question.image ||
    question.stemImage ||
    question.passageImage ||
    question.tableImage ||
    question.stem_image ||
    question.stem_image_url ||
    null;
  if (stemAsset && isImageAsset(stemAsset)) return stemAsset;
  return null;
}

function mapDbQuestion(row) {
  const data = row.data ?? {};
  return {
    id: row.question_id,
    sectionKey: row.section_key,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    orderIndex: row.order_index ?? 0,
    ...data,
  };
}

function buildAttemptDetailRows(answersJson) {
  const answers = answersJson ?? {};
  const rows = [];

  for (const q of questions) {
    if (q.parts?.length) {
      const ans = answers[q.id];
      q.parts.forEach((part, i) => {
        const chosenIdx = ans?.partAnswers?.[i];
        const correctIdx = part.answerIndex;
        rows.push({
          qid: `${q.id}-${i + 1}`,
          section: getSectionTitle(q.sectionKey),
          prompt: `${q.promptEn ?? ""} ${part.partLabel ?? ""} ${part.questionJa ?? ""}`.trim(),
          image: getQuestionIllustration(q),
          chosen: getPartChoiceText(part, chosenIdx),
          correct: getPartChoiceText(part, correctIdx),
          isCorrect: chosenIdx === correctIdx
        });
      });
      continue;
    }

    const chosenIdx = answers[q.id];
    const correctIdx = q.answerIndex;
    rows.push({
      qid: String(q.id),
      section: getSectionTitle(q.sectionKey),
      prompt: getPromptText(q),
      image: getQuestionIllustration(q),
      chosen: getChoiceText(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),
      isCorrect: chosenIdx === correctIdx
    });
  }

  return rows;
}

function buildAttemptDetailRowsFromList(answersJson, questionsList) {
  const answers = answersJson ?? {};
  const rows = [];
  for (const q of questionsList ?? []) {
    if (q.parts?.length) {
      const ans = answers[q.id];
      q.parts.forEach((part, i) => {
        const chosenIdx = ans?.partAnswers?.[i];
        const correctIdx = part.answerIndex;
      rows.push({
        qid: `${q.id}-${i + 1}`,
        section: getSectionTitle(q.sectionKey),
        prompt: `${q.promptEn ?? ""} ${part.partLabel ?? ""} ${part.questionJa ?? ""}`.trim(),
        image: getQuestionIllustration(q),
        chosen: getPartChoiceText(part, chosenIdx),
        correct: getPartChoiceText(part, correctIdx),
        isCorrect: chosenIdx === correctIdx
      });
      });
      continue;
    }

    const chosenIdx = answers[q.id];
    const correctIdx = q.answerIndex;
    rows.push({
      qid: String(q.id),
      section: getSectionTitle(q.sectionKey),
      prompt: getPromptText(q),
      image: getQuestionIllustration(q),
      chosen: getChoiceText(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),
      isCorrect: chosenIdx === correctIdx
    });
  }
  return rows;
}

function buildSectionSummary(rows) {
  const summaryMap = new Map();
  for (const row of rows) {
    const key = row.section || "Unknown";
    const cur = summaryMap.get(key) || { section: key, total: 0, correct: 0 };
    cur.total += 1;
    if (row.isCorrect) cur.correct += 1;
    summaryMap.set(key, cur);
  }
  return Array.from(summaryMap.values()).map((s) => ({
    ...s,
    rate: s.total ? s.correct / s.total : 0
  }));
}

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

function toBangladeshInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bd = new Date(d.getTime() + BD_OFFSET_MS);
  return bd.toISOString().slice(0, 16);
}

function fromBangladeshInput(value) {
  if (!value) return null;
  const parts = value.split("T");
  if (parts.length !== 2) return null;
  const [year, month, day] = parts[0].split("-").map((v) => Number(v));
  const [hour, minute] = parts[1].split(":").map((v) => Number(v));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 6, minute));
  return utc.toISOString();
}

function formatDateTimeInput(iso) {
  return toBangladeshInput(iso);
}

function formatDateShort(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", month: "2-digit", day: "2-digit" });
}

function formatDateFull(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

function formatWeekday(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString(undefined, { weekday: "short" });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function getScoreRate(attempt) {
  const rate = Number(attempt?.score_rate);
  if (Number.isFinite(rate)) return rate;
  const correct = Number(attempt?.correct ?? 0);
  const total = Number(attempt?.total ?? 0);
  if (!total) return 0;
  return correct / total;
}

function parseSeparatedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (ch === "\r") continue;
    cur += ch;
  }
  row.push(cur);
  rows.push(row);
  return rows.filter((r) => r.some((c) => String(c ?? "").trim().length));
}

function parseCsvRows(text) {
  return parseSeparatedRows(text, ",");
}

function detectDelimiter(text) {
  const firstLine = String(text ?? "").split(/\r?\n/)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function normalizeHeaderName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\uFEFF/, "")
    .toLowerCase();
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function shuffleWithSeed(items, seedStr) {
  const out = [...items];
  let seed = hashSeed(seedStr);
  for (let i = out.length - 1; i > 0; i -= 1) {
    seed = (seed * 9301 + 49297) % 233280;
    const rand = seed / 233280;
    const j = Math.floor(rand * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseListCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return raw.split("|").map((v) => v.trim()).filter(Boolean);
}

function parseJsonCell(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeCsvValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.toUpperCase() === "N/A") return "";
  return raw;
}

function parseAnswerIndex(value) {
  const raw = normalizeCsvValue(value).toUpperCase();
  const map = { A: 0, B: 1, C: 2, D: 3 };
  return raw in map ? map[raw] : null;
}

function parseQuestionCsv(text, defaultTestVersion = "") {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { questions: [], choices: [], errors: ["CSV is empty."] };
  const header = rows[0].map((h) => String(h ?? "").trim().replace(/^\uFEFF/, ""));
  const idx = (name) => header.indexOf(name);
  const getCell = (row, name) => {
    const i = idx(name);
    return i === -1 ? "" : normalizeCsvValue(row[i]);
  };
  const getInt = (row, name) => {
    const v = getCell(row, name);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  if (idx("item_id") === -1 || idx("section_key") === -1 || idx("type") === -1) {
    return { questions: [], choices: [], errors: ["CSV must include item_id, section_key, type."] };
  }

  const questions = [];
  const choices = [];
  const errors = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const questionId = getCell(row, "item_id");
    if (!questionId) continue;
    const testVersion = defaultTestVersion || getCell(row, "test_version");
    if (!testVersion) {
      errors.push(`Row ${r + 1}: test_version is required.`);
      continue;
    }
    const sectionKey = getCell(row, "section_key");
    const type = getCell(row, "type");
    const promptEn = getCell(row, "prompt_en") || null;
    const promptBn = getCell(row, "prompt_bn") || null;
    const orderIndex = getInt(row, "order_index");
    const answerIndex = parseAnswerIndex(getCell(row, "answer"));
    const choicesList = ["choiceA", "choiceB", "choiceC", "choiceD"]
      .map((key) => getCell(row, key))
      .filter(Boolean);
    if (!sectionKey || !type) {
      errors.push(`Row ${r + 1} (${questionId}): section_key and type are required.`);
      continue;
    }
    if (answerIndex == null) {
      errors.push(`Row ${r + 1} (${questionId}): answer must be A/B/C/D.`);
      continue;
    }
    if (choicesList.length === 0) {
      errors.push(`Row ${r + 1} (${questionId}): choices are required.`);
      continue;
    }
    if (answerIndex >= choicesList.length) {
      errors.push(`Row ${r + 1} (${questionId}): answer is out of range for choices.`);
      continue;
    }

    const data = {
      qid: getCell(row, "qid") || null,
      subId: getCell(row, "sub_id") || null,
      itemId: questionId,
      stemKind: getCell(row, "stem_kind") || null,
      stemText: getCell(row, "stem_text") || null,
      stemAsset: getCell(row, "stem_asset") || null,
      stemExtra: getCell(row, "stem_extra") || null,
      boxText: getCell(row, "box_text") || null,
      choices: choicesList,
      target: getCell(row, "target") || null,
      blankStyle: getCell(row, "meta_blank_style") || null,
    };

    questions.push({
      test_version: testVersion,
      question_id: questionId,
      section_key: sectionKey || null,
      type,
      prompt_en: promptEn,
      prompt_bn: promptBn,
      answer_index: answerIndex != null ? answerIndex : null,
      order_index: orderIndex != null ? orderIndex : r,
      data,
    });
    choicesList.forEach((value, i) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(value);
      choices.push({
        test_version: testVersion,
        question_key: questionId,
        part_index: null,
        choice_index: i,
        label: isImage ? null : value,
        choice_image: isImage ? value : null,
      });
    });
  }

  return { questions, choices, errors };
}

function parseDailyCsv(text, defaultTestVersion = "") {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length === 0) return { questions: [], choices: [], errors: ["CSV is empty."] };
  const header = rows[0].map(normalizeHeaderName);
  const findIdx = (names) => {
    for (const name of names) {
      const idx = header.indexOf(normalizeHeaderName(name));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const idxTest = findIdx(["testid", "test_id", "test id"]);
  const idxNo = findIdx(["no.", "no", "number"]);
  const idxQuestion = findIdx(["question"]);
  const idxCorrect = findIdx(["correct answer", "correct"]);
  const idxWrong1 = findIdx(["wrong option 1", "wrong1", "wrong option1"]);
  const idxWrong2 = findIdx(["wrong option 2", "wrong2", "wrong option2"]);
  const idxWrong3 = findIdx(["wrong option 3", "wrong3", "wrong option3"]);
  const idxTarget = findIdx(["target"]);
  const idxCanDo = findIdx(["can-do", "cando", "can do"]);
  const idxIllustration = findIdx(["illustration"]);
  const idxDescription = findIdx(["description"]);

  if (idxQuestion === -1 || idxCorrect === -1) {
    return { questions: [], choices: [], errors: ["CSV must include Question and Correct Answer."] };
  }

  const questions = [];
  const choices = [];
  const errors = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const cell = (idx) => (idx === -1 ? "" : normalizeCsvValue(row[idx]));
    const testVersion = defaultTestVersion || cell(idxTest);
    const noValue = cell(idxNo);
    const questionText = cell(idxQuestion);
    const correct = cell(idxCorrect);
    const wrongs = [cell(idxWrong1), cell(idxWrong2), cell(idxWrong3)].filter(Boolean);
    const target = cell(idxTarget);
    const canDo = cell(idxCanDo);
    const illustration = cell(idxIllustration);
    const description = cell(idxDescription);

    if (!testVersion) {
      errors.push(`Row ${r + 1}: TestID is required.`);
      continue;
    }
    if (!questionText) {
      errors.push(`Row ${r + 1}: Question is required.`);
      continue;
    }
    if (!correct) {
      errors.push(`Row ${r + 1}: Correct Answer is required.`);
      continue;
    }

    const orderIndex = Number(noValue);
    const questionId = `${testVersion}-${noValue || r}`;
    const items = [
      ...wrongs.map((text) => ({ text, correct: false })),
      { text: correct, correct: true }
    ].filter((i) => i.text);
    if (items.length === 0) {
      errors.push(`Row ${r + 1} (${questionId}): choices are required.`);
      continue;
    }

    const shuffled = shuffleWithSeed(items, `${testVersion}-${questionId}`);
    const choicesList = shuffled.map((i) => i.text);
    const answerIndex = shuffled.findIndex((i) => i.correct);

    if (answerIndex < 0) {
      errors.push(`Row ${r + 1} (${questionId}): correct answer not found in choices.`);
      continue;
    }

    const data = {
      itemId: questionId,
      stemKind: illustration ? "image" : null,
      stemText: null,
      stemAsset: illustration || null,
      stemExtra: description || null,
      boxText: null,
      choices: choicesList,
      target: target || null,
      canDo: canDo || null
    };

    questions.push({
      test_version: testVersion,
      question_id: questionId,
      section_key: "DAILY",
      type: "daily",
      prompt_en: questionText || null,
      prompt_bn: null,
      answer_index: answerIndex,
      order_index: Number.isFinite(orderIndex) ? orderIndex : r,
      data
    });

    choicesList.forEach((value, i) => {
      const isImage = /\.(png|jpe?g|webp)$/i.test(value);
      choices.push({
        test_version: testVersion,
        question_key: questionId,
        part_index: null,
        choice_index: i,
        label: isImage ? null : value,
        choice_image: isImage ? value : null
      });
    });
  }

  return { questions, choices, errors };
}

function detectTestVersionFromCsvText(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return "";
  const header = rows[0].map((h) => String(h ?? "").trim().replace(/^\uFEFF/, ""));
  const idx = header.indexOf("test_version");
  if (idx === -1) return "";
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[idx] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function detectDailyTestIdFromCsvText(text) {
  const delimiter = detectDelimiter(text);
  const rows = parseSeparatedRows(text, delimiter);
  if (rows.length < 2) return "";
  const header = rows[0].map(normalizeHeaderName);
  const idx = header.indexOf("testid");
  if (idx === -1) return "";
  for (let i = 1; i < rows.length; i += 1) {
    const value = String(rows[i]?.[idx] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function resolveAssetValue(value, assetMap) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.includes("/")) return raw;
  return assetMap[raw] ?? raw;
}

function applyAssetMap(questions, choices, assetMap) {
  for (const q of questions) {
    const data = q.data ?? {};
    if (data.stemAsset) data.stemAsset = resolveAssetValue(data.stemAsset, assetMap);
    if (Array.isArray(data.choices)) {
      data.choices = data.choices.map((v) => {
        const raw = String(v ?? "").trim();
        if (!raw) return v;
        if (!/\.(png|jpe?g|webp|mp3|wav|m4a|ogg)$/i.test(raw)) return v;
        return resolveAssetValue(raw, assetMap);
      });
    }
    q.data = data;
  }
  for (const c of choices) {
    c.choice_image = resolveAssetValue(c.choice_image, assetMap);
  }
}

function validateAssetRefs(questions, choices, assetMap) {
  const missing = new Set();
  const invalid = new Set();

  const checkValue = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return;
    if (!/\.(png|jpe?g|webp|mp3|wav|m4a|ogg)$/i.test(raw)) return;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return;
    if (raw.startsWith("/")) {
      invalid.add(raw);
      return;
    }
    if (raw.includes("/")) return;
    if (!assetMap[raw]) missing.add(raw);
  };

  for (const q of questions) {
    const data = q.data ?? {};
    checkValue(data.stemAsset);
    if (Array.isArray(data.choices)) data.choices.forEach(checkValue);
  }
  for (const c of choices) checkValue(c.choice_image);

  return { missing: Array.from(missing), invalid: Array.from(invalid) };
}

async function buildProfileEmailMap(supabase, attemptsList) {
  const ids = Array.from(new Set((attemptsList ?? []).map((a) => a.student_id).filter(Boolean)));
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from("profiles").select("id, email").in("id", ids);
  if (error) {
    console.error("profiles lookup error:", error);
    return {};
  }
  const map = {};
  for (const row of data ?? []) {
    map[row.id] = row.email ?? "";
  }
  return map;
}

async function fetchQuestionCounts(supabase, versions) {
  if (!Array.isArray(versions) || versions.length === 0) return {};
  const { data, error } = await supabase
    .from("questions")
    .select("test_version")
    .in("test_version", versions);
  if (error) {
    console.error("question count fetch error:", error);
    return {};
  }
  const counts = {};
  for (const row of data ?? []) {
    if (!row?.test_version) continue;
    counts[row.test_version] = (counts[row.test_version] ?? 0) + 1;
  }
  return counts;
}

export default function AdminConsole({
  forcedSchoolScope = null,
  changeSchoolHref = null,
  homeHref = "/",
  homeLabel = "Admin Home",
  forcedSchoolOptions = [],
}) {
  const router = useRouter();
  const forcedSchoolId = forcedSchoolScope?.id ?? null;
  const forcedSchoolName = forcedSchoolScope?.name ?? forcedSchoolId ?? "";
  const rootSupabase = useMemo(() => createAdminSupabaseClient(), []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [schoolAssignments, setSchoolAssignments] = useState([]);
  const [schoolScopeId, setSchoolScopeId] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [examLinks, setExamLinks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAttemptObj, setSelectedAttemptObj] = useState(null);
  const [attemptDetailOpen, setAttemptDetailOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [filters, setFilters] = useState({
    code: "",
    name: "",
    from: "",
    to: "",
    limit: 200,
    testVersion: ""
  });
  const [activeTab, setActiveTab] = useState("students");
  const [modelSubTab, setModelSubTab] = useState("conduct");
  const [dailySubTab, setDailySubTab] = useState("create");
  const [attendanceSubTab, setAttendanceSubTab] = useState("sheet");
  const [dailyResultsCategory, setDailyResultsCategory] = useState("");
  const [modelResultsCategory, setModelResultsCategory] = useState("");
  const [dailyCategorySelect, setDailyCategorySelect] = useState("__custom__");
  const [editingTestId, setEditingTestId] = useState("");
  const [editingTestMsg, setEditingTestMsg] = useState("");
  const [editingCategorySelect, setEditingCategorySelect] = useState("__custom__");
  const [editingTestForm, setEditingTestForm] = useState({
    id: "",
    originalVersion: "",
    version: "",
    title: "",
    pass_rate: "",
    is_public: true,
    type: ""
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");
  const [passwordChangeForm, setPasswordChangeForm] = useState({
    password: "",
    confirmPassword: "",
  });
  const [passwordChangeMsg, setPasswordChangeMsg] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [studentMsg, setStudentMsg] = useState("");
  const [studentTempMap, setStudentTempMap] = useState({});
  const [reissueOpen, setReissueOpen] = useState(false);
  const [reissueStudent, setReissueStudent] = useState(null);
  const [reissuePassword, setReissuePassword] = useState("");
  const [reissueIssuedPassword, setReissueIssuedPassword] = useState("");
  const [reissueLoading, setReissueLoading] = useState(false);
  const [reissueMsg, setReissueMsg] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedStudentTab, setSelectedStudentTab] = useState("model");
  const [studentAttempts, setStudentAttempts] = useState([]);
  const [studentAttemptsMsg, setStudentAttemptsMsg] = useState("");
  const [studentAttemptRanks, setStudentAttemptRanks] = useState({});
  const [studentAttendance, setStudentAttendance] = useState([]);
  const [studentAttendanceMsg, setStudentAttendanceMsg] = useState("");
  const [studentAttendanceRange, setStudentAttendanceRange] = useState({ from: "", to: "" });
  const [studentListFilters, setStudentListFilters] = useState({
    from: "",
    to: "",
    maxAttendance: "",
    minUnexcused: "",
    minModelAvg: "",
    minDailyAvg: ""
  });
  const [studentListDailyCategory, setStudentListDailyCategory] = useState("");
  const [studentListAttendanceMap, setStudentListAttendanceMap] = useState({});
  const [studentListAttempts, setStudentListAttempts] = useState([]);
  const [studentListLoading, setStudentListLoading] = useState(false);
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    display_name: "",
    student_code: "",
    temp_password: ""
  });
  const [csvMsg, setCsvMsg] = useState("");
  const [inviteResults, setInviteResults] = useState([]);
  const [tests, setTests] = useState([]);
  const [testsMsg, setTestsMsg] = useState("");
  const [testSessions, setTestSessions] = useState([]);
  const [testSessionsMsg, setTestSessionsMsg] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [editingSessionId, setEditingSessionId] = useState("");
  const [editingSessionMsg, setEditingSessionMsg] = useState("");
  const [editingSessionForm, setEditingSessionForm] = useState({
    id: "",
    problem_set_id: "",
    title: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: true,
    pass_rate: ""
  });
  const [testSessionForm, setTestSessionForm] = useState({
    problem_set_id: "",
    title: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: true,
    allow_multiple_attempts: true,
    pass_rate: "0.8"
  });
  const [assets, setAssets] = useState([]);
  const [assetsMsg, setAssetsMsg] = useState("");
  const [quizMsg, setQuizMsg] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTest, setPreviewTest] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState([]);
  const [previewAnswers, setPreviewAnswers] = useState({});
  const [previewMsg, setPreviewMsg] = useState("");
  const [attemptQuestionsByVersion, setAttemptQuestionsByVersion] = useState({});
  const [attemptQuestionsLoading, setAttemptQuestionsLoading] = useState(false);
  const [attemptQuestionsError, setAttemptQuestionsError] = useState("");
  const [assetForm, setAssetForm] = useState({
    test_version: "test_exam",
    category: DEFAULT_MODEL_CATEGORY
  });
  const [assetCategorySelect, setAssetCategorySelect] = useState(DEFAULT_MODEL_CATEGORY);
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");
  const [dailyForm, setDailyForm] = useState({
    test_version: "",
    category: ""
  });
  const modelCategorySeededRef = useRef(false);
  const [dailyFile, setDailyFile] = useState(null);
  const [dailyFiles, setDailyFiles] = useState([]);
  const [dailyCsvFile, setDailyCsvFile] = useState(null);
  const [dailyUploadMsg, setDailyUploadMsg] = useState("");
  const [dailyImportMsg, setDailyImportMsg] = useState("");
  const [dailySessionForm, setDailySessionForm] = useState({
    problem_set_id: "",
    title: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    show_answers: false,
    allow_multiple_attempts: true,
    pass_rate: "0.8"
  });
  const [dailySessionsMsg, setDailySessionsMsg] = useState("");
  const [attendanceDays, setAttendanceDays] = useState([]);
  const [attendanceEntries, setAttendanceEntries] = useState({});
  const [attendanceMsg, setAttendanceMsg] = useState("");
  const [attendanceDate, setAttendanceDate] = useState(() => {
    const today = new Date();
    if (Number.isNaN(today.getTime())) return "";
    return today.toISOString().slice(0, 10);
  });
  const [attendanceModalOpen, setAttendanceModalOpen] = useState(false);
  const [attendanceModalDay, setAttendanceModalDay] = useState(null);
  const [attendanceDraft, setAttendanceDraft] = useState({});
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [approvedAbsenceByStudent, setApprovedAbsenceByStudent] = useState({});
  const [attendanceFilter, setAttendanceFilter] = useState({
    minRate: "",
    minAbsences: "",
    startDate: "",
    endDate: ""
  });
  const [absenceApplications, setAbsenceApplications] = useState([]);
  const [absenceApplicationsMsg, setAbsenceApplicationsMsg] = useState("");
  const [announcements, setAnnouncements] = useState([]);
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: formatDateTimeInput(new Date()),
    end_at: ""
  });
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [editingAnnouncementForm, setEditingAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: "",
    end_at: ""
  });
  const canUseAdminConsole = Boolean(
    profile &&
      profile.account_status === "active" &&
      ((profile.role === "admin" && (forcedSchoolId || schoolScopeId || profile.school_id))
        || (profile.role === "super_admin" && forcedSchoolId))
  );
  const activeSchoolId = forcedSchoolId ?? schoolScopeId ?? profile?.school_id ?? null;
  const activeSchoolName = forcedSchoolName
    || schoolAssignments.find((assignment) => assignment.school_id === activeSchoolId)?.school_name
    || activeSchoolId
    || "";
  const supabase = useMemo(
    () => createAdminSupabaseClient({ schoolScopeId: activeSchoolId }),
    [activeSchoolId]
  );

  function generateTempPassword(length = 10) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += chars[bytes[i] % chars.length];
    }
    return out;
  }

  const selectedAttempt = useMemo(() => {
    if (selectedAttemptObj) return selectedAttemptObj;
    return attempts.find((a) => a.id === selectedId) ?? null;
  }, [attempts, selectedAttemptObj, selectedId]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  const modelTests = useMemo(() => tests.filter((t) => t.type === "mock"), [tests]);
  const dailyTests = useMemo(() => tests.filter((t) => t.type === "daily"), [tests]);
  const modelSessions = useMemo(
    () => testSessions.filter((s) => modelTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, modelTests]
  );
  const dailySessions = useMemo(
    () => testSessions.filter((s) => dailyTests.some((t) => t.version === s.problem_set_id)),
    [testSessions, dailyTests]
  );

  const testPassRateByVersion = useMemo(() => {
    const map = {};
    (tests ?? []).forEach((t) => {
      if (t?.version) map[t.version] = t.pass_rate ?? null;
    });
    return map;
  }, [tests]);

  const buildCategories = (list, fallbackLabel = "Uncategorized") => {
    const map = new Map();
    (list ?? []).forEach((t) => {
      const name = String(t.title ?? "").trim() || fallbackLabel;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(t);
    });
    const categories = Array.from(map.entries()).map(([name, items]) => {
      const ordered = [...items].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
      return { name, tests: ordered };
    });
    categories.sort((a, b) => a.name.localeCompare(b.name));
    return categories;
  };

  const dailyCategories = useMemo(() => buildCategories(dailyTests), [dailyTests]);
  const modelCategories = useMemo(() => buildCategories(modelTests, DEFAULT_MODEL_CATEGORY), [modelTests]);

  const testMetaByVersion = useMemo(() => {
    const map = {};
    (tests ?? []).forEach((t) => {
      if (!t?.version) return;
      map[t.version] = {
        type: t.type,
        category: String(t.title ?? "").trim()
      };
    });
    return map;
  }, [tests]);

  const studentModelAttempts = useMemo(() => {
    return (studentAttempts ?? []).filter((a) => testMetaByVersion[a.test_version]?.type === "mock");
  }, [studentAttempts, testMetaByVersion]);

  const studentDailyAttempts = useMemo(() => {
    return (studentAttempts ?? []).filter((a) => testMetaByVersion[a.test_version]?.type !== "mock");
  }, [studentAttempts, testMetaByVersion]);

  const studentDailyAttemptsByCategory = useMemo(() => {
    const grouped = new Map();
    (studentDailyAttempts ?? []).forEach((a) => {
      const category = testMetaByVersion[a.test_version]?.category || "Uncategorized";
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(a);
    });
    const ordered = [];
    dailyCategories.forEach((c) => {
      if (grouped.has(c.name)) ordered.push([c.name, grouped.get(c.name)]);
    });
    for (const entry of grouped.entries()) {
      if (!ordered.some((o) => o[0] === entry[0])) ordered.push(entry);
    }
    return ordered;
  }, [studentDailyAttempts, testMetaByVersion, dailyCategories]);

  const studentAttemptSummaryById = useMemo(() => {
    const summaryMap = {};
    (studentModelAttempts ?? []).forEach((a) => {
      const list = attemptQuestionsByVersion[a.test_version];
      if (!list) return;
      const rows = buildAttemptDetailRowsFromList(a.answers_json, list);
      const summary = buildSectionSummary(rows);
      const bySection = {};
      summary.forEach((s) => {
        bySection[s.section] = s;
      });
      summaryMap[a.id] = bySection;
    });
    return summaryMap;
  }, [studentModelAttempts, attemptQuestionsByVersion]);

  const sectionTitles = useMemo(
    () => sections.filter((s) => s.key !== "DAILY").map((s) => s.title),
    []
  );

  const filteredStudentAttendance = useMemo(() => {
    if (!studentAttendanceRange.from && !studentAttendanceRange.to) return studentAttendance;
    return (studentAttendance ?? []).filter((row) => {
      if (studentAttendanceRange.from && row.day_date < studentAttendanceRange.from) return false;
      if (studentAttendanceRange.to && row.day_date > studentAttendanceRange.to) return false;
      return true;
    });
  }, [studentAttendance, studentAttendanceRange]);

  const [modelConductCategory, setModelConductCategory] = useState("");
  const [dailyConductCategory, setDailyConductCategory] = useState("");
  const [modelUploadCategory, setModelUploadCategory] = useState("");
  const [dailyUploadCategory, setDailyUploadCategory] = useState("");

  const selectedModelConductCategory = useMemo(() => {
    if (!modelCategories.length) return null;
    return modelCategories.find((c) => c.name === modelConductCategory) ?? modelCategories[0];
  }, [modelCategories, modelConductCategory]);

  const selectedDailyConductCategory = useMemo(() => {
    if (!dailyCategories.length) return null;
    return dailyCategories.find((c) => c.name === dailyConductCategory) ?? dailyCategories[0];
  }, [dailyCategories, dailyConductCategory]);

  const modelConductTests = selectedModelConductCategory?.tests ?? [];
  const dailyConductTests = selectedDailyConductCategory?.tests ?? [];

  const filteredModelUploadTests = useMemo(() => {
    if (!modelUploadCategory) return modelTests;
    return modelTests.filter((t) => String(t.title ?? "").trim() === modelUploadCategory);
  }, [modelTests, modelUploadCategory]);

  const filteredDailyUploadTests = useMemo(() => {
    if (!dailyUploadCategory) return dailyTests;
    return dailyTests.filter((t) => String(t.title ?? "").trim() === dailyUploadCategory);
  }, [dailyTests, dailyUploadCategory]);

  const selectedDailyCategory = useMemo(() => {
    if (!dailyCategories.length) return null;
    return dailyCategories.find((c) => c.name === dailyResultsCategory) ?? dailyCategories[0];
  }, [dailyCategories, dailyResultsCategory]);

  const selectedModelCategory = useMemo(() => {
    if (!modelCategories.length) return null;
    return modelCategories.find((c) => c.name === modelResultsCategory) ?? modelCategories[0];
  }, [modelCategories, modelResultsCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!dailyResultsCategory || !dailyCategories.some((c) => c.name === dailyResultsCategory)) {
      setDailyResultsCategory(dailyCategories[0].name);
    }
  }, [dailyCategories, dailyResultsCategory]);

  useEffect(() => {
    if (!modelCategories.length) return;
    if (!modelResultsCategory || !modelCategories.some((c) => c.name === modelResultsCategory)) {
      setModelResultsCategory(modelCategories[0].name);
    }
  }, [modelCategories, modelResultsCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (dailyForm.category && dailyCategories.some((c) => c.name === dailyForm.category)) {
      setDailyCategorySelect(dailyForm.category);
      return;
    }
    if (!dailyForm.category && dailyCategories.length) {
      setDailyCategorySelect(dailyCategories[0].name);
      setDailyForm((s) => ({ ...s, category: dailyCategories[0].name }));
    } else {
      setDailyCategorySelect("__custom__");
    }
  }, [dailyCategories, dailyForm.category]);

  useEffect(() => {
    if (!modelCategories.length) {
      setAssetCategorySelect(DEFAULT_MODEL_CATEGORY);
      if (!assetForm.category) {
        setAssetForm((s) => ({ ...s, category: DEFAULT_MODEL_CATEGORY }));
      }
      return;
    }
    if (assetForm.category && modelCategories.some((c) => c.name === assetForm.category)) {
      setAssetCategorySelect(assetForm.category);
      return;
    }
    if (!assetForm.category && modelCategories.length) {
      setAssetCategorySelect(modelCategories[0].name);
      setAssetForm((s) => ({ ...s, category: modelCategories[0].name }));
    } else {
      setAssetCategorySelect("__custom__");
    }
  }, [modelCategories, assetForm.category]);

  useEffect(() => {
    if (!modelCategories.length) return;
    if (!modelConductCategory || !modelCategories.some((c) => c.name === modelConductCategory)) {
      setModelConductCategory(modelCategories[0].name);
    }
  }, [modelCategories, modelConductCategory]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!dailyConductCategory || !dailyCategories.some((c) => c.name === dailyConductCategory)) {
      setDailyConductCategory(dailyCategories[0].name);
    }
  }, [dailyCategories, dailyConductCategory]);

  useEffect(() => {
    if (!modelConductTests.length) return;
    if (!modelConductTests.some((t) => t.version === testSessionForm.problem_set_id)) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: modelConductTests[0].version }));
    }
  }, [modelConductTests, testSessionForm.problem_set_id]);

  useEffect(() => {
    if (!dailyConductTests.length) return;
    if (!dailyConductTests.some((t) => t.version === dailySessionForm.problem_set_id)) {
      setDailySessionForm((s) => ({ ...s, problem_set_id: dailyConductTests[0].version }));
    }
  }, [dailyConductTests, dailySessionForm.problem_set_id]);

  useEffect(() => {
    const version = testSessionForm.problem_set_id;
    if (!version) return;
    const passRate = testPassRateByVersion[version];
    if (passRate != null) {
      setTestSessionForm((s) => ({ ...s, pass_rate: String(passRate) }));
    }
  }, [testSessionForm.problem_set_id, testPassRateByVersion]);

  useEffect(() => {
    const version = dailySessionForm.problem_set_id;
    if (!version) return;
    const passRate = testPassRateByVersion[version];
    if (passRate != null) {
      setDailySessionForm((s) => ({ ...s, pass_rate: String(passRate) }));
    }
  }, [dailySessionForm.problem_set_id, testPassRateByVersion]);

  const resultContext = useMemo(() => {
    if (activeTab === "model" && modelSubTab === "results") {
      return { type: "mock", title: "Model Test Results", tests: modelTests };
    }
    if (activeTab === "daily" && dailySubTab === "results") {
      return { type: "daily", title: "Daily Test Results", tests: dailyTests };
    }
    return null;
  }, [activeTab, modelSubTab, dailySubTab, modelTests, dailyTests]);

  const selectedAttemptQuestions = useMemo(() => {
    const version = selectedAttempt?.test_version;
    return version ? attemptQuestionsByVersion[version] : null;
  }, [selectedAttempt, attemptQuestionsByVersion]);

  const selectedAttemptRows = useMemo(() => {
    if (!selectedAttempt) return [];
    if (selectedAttemptQuestions && selectedAttemptQuestions.length) {
      return buildAttemptDetailRowsFromList(selectedAttempt.answers_json, selectedAttemptQuestions);
    }
    return buildAttemptDetailRows(selectedAttempt.answers_json);
  }, [selectedAttempt, selectedAttemptQuestions]);

  const selectedAttemptSectionSummary = useMemo(
    () => buildSectionSummary(selectedAttemptRows),
    [selectedAttemptRows]
  );

  const attendanceSummary = useMemo(() => {
    const list = studentAttendance ?? [];
    const monthKeys = Array.from(
      new Set(
        list
          .map((r) => String(r.day_date || ""))
          .filter(Boolean)
          .map((d) => d.slice(0, 7))
      )
    ).sort();

    const calc = (rows) => {
      const total = rows.length;
      const present = rows.filter((r) => r.status === "P" || r.status === "L").length;
      const late = rows.filter((r) => r.status === "L").length;
      const excused = rows.filter((r) => r.status === "E").length;
      const unexcused = rows.filter((r) => r.status === "A").length;
      const rate = total ? (present / total) * 100 : null;
      return { total, present, late, excused, unexcused, rate };
    };

    const overall = calc(list);
    const months = monthKeys.map((key, idx) => {
      const rows = list.filter((r) => String(r.day_date || "").startsWith(key));
      const stats = calc(rows);
      const parts = key.split("-");
      const labelMonth = parts.length === 2
        ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString(undefined, { month: "short" })
        : key;
      return {
        key,
        label: `Month ${idx + 1} (${labelMonth})`,
        stats
      };
    });
    return { overall, months };
  }, [studentAttendance]);

  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);

  const sortedStudents = useMemo(() => {
    const list = [...(students ?? [])];
    const codeNum = (code) => {
      const m = String(code ?? "").match(/(\d+)/);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    list.sort((a, b) => {
      const aNum = codeNum(a.student_code);
      const bNum = codeNum(b.student_code);
      if (aNum !== bNum) return aNum - bNum;
      const aCode = String(a.student_code ?? "");
      const bCode = String(b.student_code ?? "");
      if (aCode !== bCode) return aCode.localeCompare(bCode);
      const aName = String(a.display_name ?? "");
      const bName = String(b.display_name ?? "");
      if (aName !== bName) return aName.localeCompare(bName);
      return String(a.email ?? "").localeCompare(String(b.email ?? ""));
    });
    return list;
  }, [students]);

  const dailyResultsMatrix = useMemo(() => {
    const testsForCategory = selectedDailyCategory?.tests ?? [];
    if (!testsForCategory.length) return { tests: [], rows: [] };
    const versions = testsForCategory.map((t) => t.version);
    const versionSet = new Set(versions);
    const byStudent = new Map();
    (attempts ?? []).forEach((a) => {
      if (!a?.student_id) return;
      if (!versionSet.has(a.test_version)) return;
      const key = a.student_id;
      const perStudent = byStudent.get(key) ?? new Map();
      const existing = perStudent.get(a.test_version);
      const nextTime = new Date(a.ended_at || a.created_at || 0).getTime();
      const existingTime = existing
        ? new Date(existing.ended_at || existing.created_at || 0).getTime()
        : -1;
      if (!existing || nextTime >= existingTime) {
        perStudent.set(a.test_version, a);
      }
      byStudent.set(key, perStudent);
    });

    const rows = (sortedStudents ?? []).map((s, idx) => {
      const perStudent = byStudent.get(s.id) ?? new Map();
      const cells = versions.map((v) => perStudent.get(v) ?? null);
      return { index: idx + 1, student: s, cells };
    });
    return { tests: testsForCategory, rows };
  }, [attempts, sortedStudents, selectedDailyCategory]);

  const modelResultsMatrix = useMemo(() => {
    const testsForCategory = selectedModelCategory?.tests ?? [];
    if (!testsForCategory.length) return { tests: [], rows: [] };
    const versions = testsForCategory.map((t) => t.version);
    const versionSet = new Set(versions);
    const byStudent = new Map();
    (attempts ?? []).forEach((a) => {
      if (!a?.student_id) return;
      if (!versionSet.has(a.test_version)) return;
      const key = a.student_id;
      const perStudent = byStudent.get(key) ?? new Map();
      const existing = perStudent.get(a.test_version);
      const nextTime = new Date(a.ended_at || a.created_at || 0).getTime();
      const existingTime = existing
        ? new Date(existing.ended_at || existing.created_at || 0).getTime()
        : -1;
      if (!existing || nextTime >= existingTime) {
        perStudent.set(a.test_version, a);
      }
      byStudent.set(key, perStudent);
    });

    const rows = (sortedStudents ?? []).map((s, idx) => {
      const perStudent = byStudent.get(s.id) ?? new Map();
      const cells = versions.map((v) => perStudent.get(v) ?? null);
      return { index: idx + 1, student: s, cells };
    });
    return { tests: testsForCategory, rows };
  }, [attempts, sortedStudents, selectedModelCategory]);

  const attendanceDayColumns = useMemo(() => {
    return attendanceDays.map((d) => ({
      ...d,
      label: `${formatDateShort(d.day_date)} (${formatWeekday(d.day_date)})`,
    }));
  }, [attendanceDays]);

  const attendanceRangeColumns = useMemo(() => {
    const start = attendanceFilter.startDate;
    const end = attendanceFilter.endDate;
    if (!start && !end) return attendanceDayColumns;
    return attendanceDayColumns.filter((d) => {
      const day = d.day_date;
      if (start && day < start) return false;
      if (end && day > end) return false;
      return true;
    });
  }, [attendanceDayColumns, attendanceFilter.startDate, attendanceFilter.endDate]);

  const activeStudents = useMemo(
    () => (sortedStudents ?? []).filter((s) => !s.is_withdrawn),
    [sortedStudents]
  );

  const attendanceFilteredStudents = useMemo(() => {
    const minRate = attendanceFilter.minRate === "" ? null : Number(attendanceFilter.minRate);
    const minAbsences = attendanceFilter.minAbsences === "" ? null : Number(attendanceFilter.minAbsences);
    return activeStudents.filter((s) => {
      const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
      const total = perDay.filter(Boolean).length;
      const present = perDay.filter((v) => v === "P" || v === "L").length;
      const absences = perDay.filter((v) => v === "A").length;
      const rate = total ? (present / total) * 100 : 0;
      if (minRate != null && rate >= minRate) return false;
      if (minAbsences != null && absences < minAbsences) return false;
      return true;
    });
  }, [activeStudents, attendanceFilter, attendanceRangeColumns, attendanceEntriesByDay]);

  const studentListRows = useMemo(() => {
    const byStudent = new Map();
    (studentListAttempts ?? []).forEach((a) => {
      if (!a?.student_id) return;
      const list = byStudent.get(a.student_id) || [];
      list.push(a);
      byStudent.set(a.student_id, list);
    });

    const dailyCategory = studentListDailyCategory || "__all__";
    const rows = (sortedStudents ?? []).map((s) => {
      const att = studentListAttendanceMap[s.id] || { total: 0, present: 0, unexcused: 0, rate: null };
      const attemptsList = byStudent.get(s.id) || [];
      const modelScores = [];
      const dailyScores = [];
      attemptsList.forEach((a) => {
        const meta = testMetaByVersion[a.test_version];
        if (!meta?.type) return;
        const rate = getScoreRate(a) * 100;
        if (meta.type === "mock") {
          modelScores.push(rate);
        } else if (meta.type === "daily") {
          if (dailyCategory === "__all__" || meta.category === dailyCategory) {
            dailyScores.push(rate);
          }
        }
      });
      const modelAvg = modelScores.length
        ? modelScores.reduce((acc, r) => acc + r, 0) / modelScores.length
        : null;
      const dailyAvg = dailyScores.length
        ? dailyScores.reduce((acc, r) => acc + r, 0) / dailyScores.length
        : null;
      return {
        student: s,
        attendanceRate: att.rate,
        unexcused: att.unexcused ?? 0,
        modelAvg,
        dailyAvg
      };
    });

    const maxAttendance =
      studentListFilters.maxAttendance === "" ? null : Number(studentListFilters.maxAttendance);
    const minUnexcused =
      studentListFilters.minUnexcused === "" ? null : Number(studentListFilters.minUnexcused);
    const minModelAvg =
      studentListFilters.minModelAvg === "" ? null : Number(studentListFilters.minModelAvg);
    const minDailyAvg =
      studentListFilters.minDailyAvg === "" ? null : Number(studentListFilters.minDailyAvg);

    return rows.filter((row) => {
      if (maxAttendance != null) {
        const rate = row.attendanceRate ?? 0;
        if (rate > maxAttendance) return false;
      }
      if (minUnexcused != null && row.unexcused < minUnexcused) return false;
      if (minModelAvg != null) {
        const value = row.modelAvg ?? 0;
        if (value < minModelAvg) return false;
      }
      if (minDailyAvg != null) {
        const value = row.dailyAvg ?? 0;
        if (value < minDailyAvg) return false;
      }
      return true;
    });
  }, [
    sortedStudents,
    studentListAttendanceMap,
    studentListAttempts,
    studentListDailyCategory,
    studentListFilters,
    testMetaByVersion
  ]);

  const linkBySession = useMemo(() => {
    const map = {};
    for (const link of examLinks) {
      const sid = link.test_session_id;
      if (!sid) continue;
      const prev = map[sid];
      if (!prev) {
        map[sid] = link;
        continue;
      }
      const prevTime = prev.created_at ? new Date(prev.created_at).getTime() : 0;
      const curTime = link.created_at ? new Date(link.created_at).getTime() : 0;
      if (curTime >= prevTime) map[sid] = link;
    }
    return map;
  }, [examLinks]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error("getSession error:", error);
      syncAdminAuthCookie(data?.session ?? null);
      setSession(data?.session ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      syncAdminAuthCookie(nextSession ?? null);
      setSession(nextSession ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setAttempts([]);
      setSelectedId(null);
      setSelectedAttemptObj(null);
      setSelectedStudentId("");
      setStudentAttempts([]);
      setStudentAttemptsMsg("");
      return;
    }
    supabase
      .from("profiles")
      .select("id, role, display_name, school_id, account_status, force_password_change")
      .eq("id", session.user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("fetch profile error:", error);
          setProfile(null);
          return;
        }
        setProfile(data);
      });
  }, [session, supabase]);

  useEffect(() => {
    if (!session || !profile || profile.role !== "admin") {
      setSchoolAssignments([]);
      if (!forcedSchoolId) setSchoolScopeId(null);
      return;
    }

    let mounted = true;

    async function loadSchoolAssignments() {
      const { data: assignments, error: assignmentsError } = await supabase
        .from("admin_school_assignments")
        .select("school_id, is_primary")
        .eq("admin_user_id", session.user.id)
        .order("is_primary", { ascending: false });

      if (assignmentsError) {
        console.error("admin school assignments error:", assignmentsError);
        if (mounted) {
          setSchoolAssignments(
            profile.school_id
              ? [{ school_id: profile.school_id, school_name: "Current School", is_primary: true }]
              : []
          );
          if (!forcedSchoolId) setSchoolScopeId(profile.school_id ?? null);
        }
        return;
      }

      const schoolIds = Array.from(
        new Set([profile.school_id, ...(assignments ?? []).map((row) => row.school_id)].filter(Boolean))
      );
      const { data: schoolsData, error: schoolsError } = await rootSupabase
        .from("schools")
        .select("id, name, status")
        .in("id", schoolIds);

      if (!mounted) return;
      if (schoolsError) {
        console.error("admin schools lookup error:", schoolsError);
      }

      const schoolMap = Object.fromEntries((schoolsData ?? []).map((row) => [row.id, row]));
      const normalizedAssignments = schoolIds.map((id) => ({
        school_id: id,
        school_name: schoolMap[id]?.name ?? id,
        school_status: schoolMap[id]?.status ?? null,
        is_primary: id === profile.school_id || (assignments ?? []).some((row) => row.school_id === id && row.is_primary),
      }));
      setSchoolAssignments(normalizedAssignments);

      if (forcedSchoolId) return;

      const storedScope =
        typeof window !== "undefined" ? window.localStorage.getItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY) : null;
      const validStoredScope = normalizedAssignments.some((assignment) => assignment.school_id === storedScope);
      const nextScopeId = validStoredScope
        ? storedScope
        : profile.school_id ?? normalizedAssignments[0]?.school_id ?? null;
      setSchoolScopeId(nextScopeId);
    }

    loadSchoolAssignments();
    return () => {
      mounted = false;
    };
  }, [forcedSchoolId, profile, rootSupabase, session, supabase]);

  useEffect(() => {
    if (forcedSchoolId || !profile || profile.role !== "admin" || !schoolScopeId || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY, schoolScopeId);
  }, [forcedSchoolId, profile, schoolScopeId]);

  useEffect(() => {
    if (!session || !canUseAdminConsole) return;
    fetchExamLinks();
    fetchStudents();
    fetchTests();
    fetchTestSessions();
    fetchAssets();
  }, [activeSchoolId, session, canUseAdminConsole]);

  useEffect(() => {
    if (activeTab !== "students") return;
    fetchStudentListMetrics();
  }, [activeSchoolId, activeTab, studentListFilters.from, studentListFilters.to]);

  useEffect(() => {
    if (!dailyCategories.length) return;
    if (!studentListDailyCategory) {
      setStudentListDailyCategory("__all__");
    }
  }, [dailyCategories, studentListDailyCategory]);

  useEffect(() => {
    if (!session || !canUseAdminConsole) return;
    if (activeTab === "model" && modelSubTab === "results") {
      runSearch("mock");
    }
    if (activeTab === "daily" && dailySubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("daily");
    }
    if (activeTab === "model" && modelSubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("mock");
    }
  }, [activeSchoolId, session, canUseAdminConsole, activeTab, modelSubTab, dailySubTab, tests]);

  useEffect(() => {
    if (
      !(
        (activeTab === "daily" && dailySubTab === "results") ||
        (activeTab === "model" && modelSubTab === "results")
      )
    ) {
      return;
    }
    setFilters((s) => {
      if (!s.code && !s.name && !s.from && !s.to && !s.testVersion) return s;
      return {
        ...s,
        code: "",
        name: "",
        from: "",
        to: "",
        testVersion: ""
      };
    });
  }, [activeTab, dailySubTab, modelSubTab]);

  useEffect(() => {
    if (!session || !profile) return;
    if (
      !forcedSchoolId &&
      profile.role === "super_admin" &&
      profile.account_status === "active"
    ) {
      router.replace("/super/schools");
    }
  }, [forcedSchoolId, profile, router, session]);

  useEffect(() => {
    if (!activeSchoolId) return;
    setAttempts([]);
    setExamLinks([]);
    setStudents([]);
    setTests([]);
    setTestSessions([]);
    setAssets([]);
    setSelectedId(null);
    setSelectedAttemptObj(null);
    setSelectedStudentId("");
    setStudentAttempts([]);
    setStudentAttendance([]);
    setAbsenceApplications([]);
    setAnnouncements([]);
  }, [activeSchoolId]);

  useEffect(() => {
    const version = selectedAttempt?.test_version;
    if (!attemptDetailOpen || !version) return;
    if (attemptQuestionsByVersion[version]) return;
    let mounted = true;
    setAttemptQuestionsLoading(true);
    setAttemptQuestionsError("");
    supabase
      .from("questions")
      .select("question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
      .eq("test_version", version)
      .order("order_index", { ascending: true })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.error("attempt questions fetch error:", error);
          setAttemptQuestionsError(error.message);
          setAttemptQuestionsLoading(false);
          return;
        }
        const list = (data ?? []).map(mapDbQuestion);
        setAttemptQuestionsByVersion((prev) => ({ ...prev, [version]: list }));
        setAttemptQuestionsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [attemptDetailOpen, selectedAttempt, attemptQuestionsByVersion]);

  async function runSearch(testType = "") {
    setLoading(true);
    setMsg("Loading...");
    const { code, name, from, to, limit, testVersion } = filters;

    let query = supabase
      .from("attempts")
      .select(
        "id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
      )
      .order("created_at", { ascending: false })
      .limit(Number(limit || 200));

    let allowedVersions = [];
    if (testType) {
      allowedVersions = tests.filter((t) => t.type === testType).map((t) => t.version);
      if (testVersion && allowedVersions.length && !allowedVersions.includes(testVersion)) {
        setFilters((s) => ({ ...s, testVersion: "" }));
      }
      if (allowedVersions.length) {
        query = query.in("test_version", allowedVersions);
      } else {
        setAttempts([]);
        setSelectedId(null);
        setMsg("No tests.");
        setLoading(false);
        return;
      }
    }
    if (code) query = query.ilike("student_code", `%${code}%`);
    if (name) query = query.ilike("display_name", `%${name}%`);
    if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    if (testVersion && (!testType || allowedVersions.includes(testVersion))) {
      query = query.eq("test_version", testVersion);
    }

    const { data, error } = await query;
    if (error) {
      console.error("attempts fetch error:", error);
      setAttempts([]);
      setMsg(`Load failed: ${error.message}`);
      setLoading(false);
      return;
    }
    setAttempts(data ?? []);
    setSelectedId(null);
    setMsg(data?.length ? "" : "No results.");
    setLoading(false);
  }

  function applyTestFilter(version, testType = "") {
    setFilters((s) => ({ ...s, testVersion: version || "" }));
    setSelectedId(null);
    setTimeout(() => runSearch(testType), 0);
  }

  function openAttemptDetail(attempt) {
    if (!attempt?.id) return;
    setSelectedId(attempt.id);
    setSelectedAttemptObj(attempt);
    setAttemptDetailOpen(true);
  }

  function startEditTest(test, categoryOptions) {
    if (!test?.id) return;
    const normalizedTitle = String(test.title ?? "").trim() || "Uncategorized";
    const hasCategory = (categoryOptions ?? []).some((c) => c.name === normalizedTitle);
    setEditingTestId(test.id);
    setEditingTestMsg("");
    setEditingCategorySelect(hasCategory ? normalizedTitle : "__custom__");
    setEditingTestForm({
      id: test.id,
      originalVersion: test.version ?? "",
      version: test.version ?? "",
      title: normalizedTitle,
      pass_rate: test.pass_rate != null ? String(test.pass_rate) : "",
      is_public: Boolean(test.is_public),
      type: test.type ?? ""
    });
  }

  function cancelEditTest() {
    setEditingTestId("");
    setEditingTestMsg("");
    setEditingCategorySelect("__custom__");
  }

  async function updateVersionInTable(table, column, oldVersion, newVersion) {
    const { error } = await supabase
      .from(table)
      .update({ [column]: newVersion })
      .eq(column, oldVersion);
    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async function saveTestEdits(categoryOptions) {
    if (!editingTestForm.id) return;
    setEditingTestMsg("Saving...");
    const nextVersion = editingTestForm.version.trim();
    if (!nextVersion) {
      setEditingTestMsg("Test ID is required.");
      return;
    }
    const passRate = Number(editingTestForm.pass_rate);
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setEditingTestMsg("Pass Rate must be between 0 and 1.");
      return;
    }
    const nextTitleRaw = editingCategorySelect === "__custom__"
      ? editingTestForm.title
      : editingCategorySelect;
    const nextTitle = String(nextTitleRaw ?? "").trim() || "Uncategorized";

    if (nextVersion !== editingTestForm.originalVersion) {
      const { data: exists, error: existsErr } = await supabase
        .from("tests")
        .select("id")
        .eq("version", nextVersion)
        .limit(1);
      if (existsErr) {
        setEditingTestMsg(`Check failed: ${existsErr.message}`);
        return;
      }
      if (exists?.length && exists[0].id !== editingTestForm.id) {
        setEditingTestMsg("That Test ID already exists.");
        return;
      }
      const ok = window.confirm(
        `Rename Test ID from ${editingTestForm.originalVersion} to ${nextVersion}? This updates sessions, attempts, links, questions, assets.`
      );
      if (!ok) {
        setEditingTestMsg("Rename cancelled.");
        return;
      }
    }

    const updatePayload = {
      title: nextTitle,
      pass_rate: passRate,
      is_public: editingTestForm.is_public,
      updated_at: new Date().toISOString()
    };
    if (nextVersion !== editingTestForm.originalVersion) {
      updatePayload.version = nextVersion;
    }

    const { error: updateErr } = await supabase.from("tests").update(updatePayload).eq("id", editingTestForm.id);
    if (updateErr) {
      setEditingTestMsg(`Save failed: ${updateErr.message}`);
      return;
    }

    if (nextVersion !== editingTestForm.originalVersion) {
      try {
        await updateVersionInTable("questions", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("attempts", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("test_sessions", "problem_set_id", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("exam_links", "test_version", editingTestForm.originalVersion, nextVersion);
        await updateVersionInTable("test_assets", "test_version", editingTestForm.originalVersion, nextVersion);
      } catch (err) {
        console.error("rename error:", err);
        setEditingTestMsg(`Saved, but rename failed: ${err.message}`);
      }
    }

    setEditingTestMsg("Saved.");
    setEditingTestId("");
    fetchTests();
    fetchTestSessions();
    fetchExamLinks();
    if (activeTab === "daily" && dailySubTab === "results") runSearch("daily");
    if (activeTab === "model" && modelSubTab === "results") runSearch("mock");
  }

  async function fetchExamLinks() {
    setLinkMsg("Loading...");
    const { data, error } = await supabase
      .from("exam_links")
      .select("id, test_version, test_session_id, expires_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("exam_links fetch error:", error);
      setExamLinks([]);
      setLinkMsg(`Load failed: ${error.message}`);
      return;
    }
    setExamLinks(data ?? []);
    setLinkMsg(data?.length ? "" : "No links.");
  }

  function getStudentBaseUrl() {
    return process.env.NEXT_PUBLIC_STUDENT_BASE_URL || "";
  }

  async function copyLink(id) {
    const base = getStudentBaseUrl();
    const url = base ? `${base}/test?link=${id}` : `/test?link=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMsg("Copied.");
    } catch (e) {
      console.warn("clipboard error:", e);
      setLinkMsg(url);
    }
  }

  async function fetchStudents() {
    setStudentMsg("Loading...");
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, role, display_name, student_code, created_at, is_withdrawn")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("profiles fetch error:", error);
      setStudents([]);
      setStudentMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = (data ?? []).filter((p) => p.role === "student");
    setStudents(list);
    setStudentMsg(list.length ? "" : "No students.");
    if (!list.length) {
      setSelectedStudentId("");
      setStudentAttempts([]);
      setStudentAttendance([]);
      setStudentAttemptsMsg("");
      setStudentAttendanceMsg("");
      return;
    }
    const exists = selectedStudentId && list.some((s) => s.id === selectedStudentId);
    if (!exists) {
      const first = list[0];
      setSelectedStudentId(first.id);
      setSelectedStudentTab("model");
      setStudentAttendanceRange({ from: "", to: "" });
      fetchStudentAttempts(first.id);
    }
  }

  async function fetchStudentListMetrics() {
    setStudentListLoading(true);
    const { from, to } = studentListFilters;
    let daysQuery = supabase.from("attendance_days").select("id, day_date");
    if (from) daysQuery = daysQuery.gte("day_date", from);
    if (to) daysQuery = daysQuery.lte("day_date", to);
    const { data: daysData, error: daysError } = await daysQuery;
    if (daysError) {
      console.error("student list attendance days error:", daysError);
      setStudentListAttendanceMap({});
    } else {
      const dayIds = (daysData ?? []).map((d) => d.id);
      if (!dayIds.length) {
        setStudentListAttendanceMap({});
      } else {
        const { data: entriesData, error: entriesError } = await supabase
          .from("attendance_entries")
          .select("day_id, student_id, status")
          .in("day_id", dayIds);
        if (entriesError) {
          console.error("student list attendance entries error:", entriesError);
          setStudentListAttendanceMap({});
        } else {
          const map = {};
          (entriesData ?? []).forEach((row) => {
            if (!row?.student_id) return;
            const stats = map[row.student_id] || { total: 0, present: 0, unexcused: 0 };
            if (row.status) stats.total += 1;
            if (row.status === "P" || row.status === "L") stats.present += 1;
            if (row.status === "A") stats.unexcused += 1;
            map[row.student_id] = stats;
          });
          Object.keys(map).forEach((id) => {
            const stats = map[id];
            stats.rate = stats.total ? (stats.present / stats.total) * 100 : null;
          });
          setStudentListAttendanceMap(map);
        }
      }
    }

    let attemptsQuery = supabase
      .from("attempts")
      .select("id, student_id, test_version, correct, total, score_rate, created_at, ended_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (from) attemptsQuery = attemptsQuery.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) attemptsQuery = attemptsQuery.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
    const { data: attemptsData, error: attemptsError } = await attemptsQuery;
    if (attemptsError) {
      console.error("student list attempts error:", attemptsError);
      setStudentListAttempts([]);
    } else {
      setStudentListAttempts(attemptsData ?? []);
    }
    setStudentListLoading(false);
  }

  async function toggleWithdrawn(student, nextValue) {
    if (!student?.id) return;
    setStudentMsg("");
    const { error } = await supabase
      .from("profiles")
      .update({ is_withdrawn: Boolean(nextValue) })
      .eq("id", student.id);
    if (error) {
      console.error("withdrawn update error:", error);
      setStudentMsg(`Update failed: ${error.message}`);
      return;
    }
    fetchStudents();
  }

  useEffect(() => {
    if (activeTab !== "attendance") return;
    if (attendanceSubTab === "sheet") {
      if (!students.length) fetchStudents();
      fetchAttendanceDays();
    }
    if (attendanceSubTab === "absence") {
      fetchAbsenceApplications();
    }
  }, [activeSchoolId, activeTab, attendanceSubTab]);

  async function fetchAbsenceApplications() {
    setAbsenceApplicationsMsg("Loading...");
    const { data, error } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, day_date, status, reason, catch_up, late_type, time_value, created_at, decided_at, profiles:student_id (display_name, student_code, email)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("absence applications fetch error:", error);
      setAbsenceApplications([]);
      setAbsenceApplicationsMsg(`Load failed: ${error.message}`);
      return;
    }
    setAbsenceApplications(data ?? []);
    setAbsenceApplicationsMsg(data?.length ? "" : "No applications.");
  }

  async function decideAbsenceApplication(id, nextStatus) {
    if (!id) return;
    const { error } = await supabase
      .from("absence_applications")
      .update({
        status: nextStatus,
        decided_at: new Date().toISOString(),
        decided_by: session?.user?.id ?? null
      })
      .eq("id", id);
    if (error) {
      console.error("absence application update error:", error);
      setAbsenceApplicationsMsg(`Update failed: ${error.message}`);
      return;
    }
    fetchAbsenceApplications();
  }

  useEffect(() => {
    if (activeTab === "announcements") {
      fetchAnnouncements();
    }
  }, [activeSchoolId, activeTab]);

  async function fetchAnnouncements() {
    setAnnouncementMsg("Loading...");
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("announcements fetch error:", error);
      setAnnouncements([]);
      setAnnouncementMsg(`Load failed: ${error.message}`);
      return;
    }
    setAnnouncements(data ?? []);
    setAnnouncementMsg(data?.length ? "" : "No announcements.");
  }

  async function createAnnouncement() {
    setAnnouncementMsg("");
    const title = announcementForm.title.trim();
    const body = announcementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const publishAt = announcementForm.publish_at
      ? fromBangladeshInput(announcementForm.publish_at)
      : new Date().toISOString();
    const endAt = announcementForm.end_at ? fromBangladeshInput(announcementForm.end_at) : null;
    const payload = {
      title,
      body,
      publish_at: publishAt,
      end_at: endAt,
      created_by: session?.user?.id ?? null
    };
    const { error } = await supabase.from("announcements").insert(payload);
    if (error) {
      console.error("announcement create error:", error);
      setAnnouncementMsg(`Create failed: ${error.message}`);
      return;
    }
    setAnnouncementForm({ title: "", body: "", publish_at: formatDateTimeInput(new Date()), end_at: "" });
    setAnnouncementMsg("Announcement created.");
    fetchAnnouncements();
  }

  async function deleteAnnouncement(id) {
    if (!id) return;
    const ok = window.confirm("Delete this announcement?");
    if (!ok) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      console.error("announcement delete error:", error);
      setAnnouncementMsg(`Delete failed: ${error.message}`);
      return;
    }
    fetchAnnouncements();
  }

  function startEditAnnouncement(announcement) {
    if (!announcement?.id) return;
    setEditingAnnouncementId(announcement.id);
    setEditingAnnouncementForm({
      title: announcement.title ?? "",
      body: announcement.body ?? "",
      publish_at: formatDateTimeInput(announcement.publish_at),
      end_at: announcement.end_at ? formatDateTimeInput(announcement.end_at) : ""
    });
  }

  function cancelEditAnnouncement() {
    setEditingAnnouncementId("");
    setEditingAnnouncementForm({ title: "", body: "", publish_at: "", end_at: "" });
  }

  async function saveAnnouncementEdits() {
    if (!editingAnnouncementId) return;
    const title = editingAnnouncementForm.title.trim();
    const body = editingAnnouncementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const payload = {
      title,
      body,
      publish_at: editingAnnouncementForm.publish_at
        ? fromBangladeshInput(editingAnnouncementForm.publish_at)
        : new Date().toISOString(),
      end_at: editingAnnouncementForm.end_at ? fromBangladeshInput(editingAnnouncementForm.end_at) : null
    };
    const { error } = await supabase
      .from("announcements")
      .update(payload)
      .eq("id", editingAnnouncementId);
    if (error) {
      console.error("announcement update error:", error);
      setAnnouncementMsg(`Update failed: ${error.message}`);
      return;
    }
    cancelEditAnnouncement();
    fetchAnnouncements();
  }

  async function fetchStudentAttempts(studentId) {
    if (!studentId) return;
    setStudentAttemptsMsg("Loading...");
    const { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, display_name, student_code, test_version, test_session_id, correct, total, score_rate, created_at, ended_at, answers_json")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("student attempts fetch error:", error);
      setStudentAttempts([]);
      setStudentAttemptsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setStudentAttempts(list);
    setStudentAttemptsMsg(list.length ? "" : "No attempts.");
    hydrateAttemptQuestions(list.map((a) => a.test_version));
    fetchAttemptRanksForSessions(list);
  }

  async function fetchAttemptRanksForSessions(attemptsList) {
    const sessionIds = Array.from(new Set((attemptsList ?? []).map((a) => a.test_session_id).filter(Boolean)));
    if (!sessionIds.length) {
      setStudentAttemptRanks({});
      return;
    }
    const { data, error } = await supabase
      .from("attempts")
      .select("id, student_id, test_session_id, correct, total, score_rate")
      .in("test_session_id", sessionIds);
    if (error) {
      console.error("attempt rank fetch error:", error);
      setStudentAttemptRanks({});
      return;
    }
    const bySession = new Map();
    (data ?? []).forEach((a) => {
      if (!a.test_session_id) return;
      if (!bySession.has(a.test_session_id)) bySession.set(a.test_session_id, []);
      bySession.get(a.test_session_id).push(a);
    });
    const rankMap = {};
    bySession.forEach((rows, sessionId) => {
      const bestByStudent = new Map();
      rows.forEach((row) => {
        const rate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
        const prev = bestByStudent.get(row.student_id);
        if (prev == null || rate > prev) bestByStudent.set(row.student_id, rate);
      });
      const sorted = Array.from(bestByStudent.values()).sort((a, b) => b - a);
      rows.forEach((row) => {
        const attemptRate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
        let rank = sorted.findIndex((v) => v === attemptRate);
        if (rank === -1) {
          rank = sorted.findIndex((v) => v < attemptRate);
          if (rank === -1) rank = sorted.length;
        }
        rankMap[row.id] = { rank: rank + 1, total: sorted.length };
      });
    });
    setStudentAttemptRanks(rankMap);
  }

  async function hydrateAttemptQuestions(versions) {
    const unique = Array.from(new Set((versions ?? []).filter(Boolean)));
    const missing = unique.filter((v) => !attemptQuestionsByVersion[v]);
    if (!missing.length) return;
    const { data, error } = await supabase
      .from("questions")
      .select("test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
      .in("test_version", missing)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("attempt questions preload error:", error);
      return;
    }
    const grouped = {};
    (data ?? []).forEach((row) => {
      const version = row.test_version;
      if (!version) return;
      if (!grouped[version]) grouped[version] = [];
      grouped[version].push(mapDbQuestion(row));
    });
    setAttemptQuestionsByVersion((prev) => ({ ...prev, ...grouped }));
  }

  async function fetchStudentAttendance(studentId) {
    if (!studentId) return;
    setStudentAttendanceMsg("Loading...");
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, status, comment")
      .eq("student_id", studentId);
    if (error) {
      console.error("student attendance fetch error:", error);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const entries = data ?? [];
    const dayIds = entries.map((e) => e.day_id).filter(Boolean);
    if (!dayIds.length) {
      setStudentAttendance([]);
      setStudentAttendanceMsg("No attendance records.");
      return;
    }
    const { data: daysData, error: daysError } = await supabase
      .from("attendance_days")
      .select("id, day_date")
      .in("id", dayIds);
    if (daysError) {
      console.error("attendance days fetch error:", daysError);
      setStudentAttendance([]);
      setStudentAttendanceMsg(`Load failed: ${daysError.message}`);
      return;
    }
    const dayMap = {};
    (daysData ?? []).forEach((d) => {
      dayMap[d.id] = d.day_date;
    });
    const list = entries
      .map((e) => ({
        day_id: e.day_id,
        day_date: dayMap[e.day_id] ?? "",
        status: e.status,
        comment: e.comment ?? ""
      }))
      .sort((a, b) => String(a.day_date).localeCompare(String(b.day_date)));
    setStudentAttendance(list);
    setStudentAttendanceMsg(list.length ? "" : "No attendance records.");
  }

  async function seedModelCategory(list) {
    if (modelCategorySeededRef.current) return list;
    const mockTests = (list ?? []).filter((t) => t.type === "mock");
    if (!mockTests.length) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const shouldSeed = mockTests.every((t) => !String(t.title ?? "").trim());
    if (!shouldSeed) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const ids = mockTests.map((t) => t.id).filter(Boolean);
    if (!ids.length) {
      modelCategorySeededRef.current = true;
      return list;
    }
    const { error } = await supabase
      .from("tests")
      .update({ title: DEFAULT_MODEL_CATEGORY, updated_at: new Date().toISOString() })
      .in("id", ids);
    if (error) {
      console.error("model category seed error:", error);
      modelCategorySeededRef.current = true;
      return list;
    }
    modelCategorySeededRef.current = true;
    return list.map((t) => (t.type === "mock" ? { ...t, title: DEFAULT_MODEL_CATEGORY } : t));
  }

  async function fetchTests() {
    setTestsMsg("Loading...");
    const { data, error } = await supabase
      .from("tests")
      .select("id, version, title, type, pass_rate, is_public, created_at, questions(count)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("relationship") || msg.includes("questions")) {
        const fallback = await supabase
          .from("tests")
          .select("id, version, title, type, pass_rate, is_public, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (fallback.error) {
          console.error("tests fetch error:", fallback.error);
          setTests([]);
          setTestsMsg(`Load failed: ${fallback.error.message}`);
          return;
        }
        const list = fallback.data ?? [];
        const counts = await fetchQuestionCounts(supabase, list.map((t) => t.version));
        const withCounts = list.map((t) => ({
          ...t,
          question_count: counts[t.version] ?? 0
        }));
        const seeded = await seedModelCategory(withCounts);
        setTests(seeded);
        if (seeded.length && !testSessionForm.problem_set_id) {
          setTestSessionForm((s) => ({ ...s, problem_set_id: seeded[0].version }));
        }
        setTestsMsg(list.length ? "" : "No tests.");
        return;
      }
      console.error("tests fetch error:", error);
      setTests([]);
      setTestsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    const hasRelation = list.some((t) => Array.isArray(t.questions));
    if (!hasRelation) {
      const counts = await fetchQuestionCounts(supabase, list.map((t) => t.version));
      const withCounts = list.map((t) => ({
        ...t,
        question_count: counts[t.version] ?? 0
      }));
      const seeded = await seedModelCategory(withCounts);
      setTests(seeded);
      const firstModel = seeded.find((t) => t.type === "mock");
      const firstDaily = seeded.find((t) => t.type === "daily");
      if (firstModel && !testSessionForm.problem_set_id) {
        setTestSessionForm((s) => ({ ...s, problem_set_id: firstModel.version }));
      }
      if (firstDaily && !dailySessionForm.problem_set_id) {
        setDailySessionForm((s) => ({ ...s, problem_set_id: firstDaily.version }));
      }
      setTestsMsg(list.length ? "" : "No tests.");
      return;
    }
    const withCounts = list.map((t) => ({
      ...t,
      question_count: t.questions?.[0]?.count ?? 0
    }));
    const seeded = await seedModelCategory(withCounts);
    setTests(seeded);
    const firstModel = seeded.find((t) => t.type === "mock");
    const firstDaily = seeded.find((t) => t.type === "daily");
    if (firstModel && !testSessionForm.problem_set_id) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: firstModel.version }));
    }
    if (firstDaily && !dailySessionForm.problem_set_id) {
      setDailySessionForm((s) => ({ ...s, problem_set_id: firstDaily.version }));
    }
    setTestsMsg(list.length ? "" : "No tests.");
  }

  async function fetchTestSessions() {
    setTestSessionsMsg("Loading...");
    const { data, error } = await supabase
      .from("test_sessions")
      .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("test_sessions fetch error:", error);
      setTestSessions([]);
      setTestSessionsMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setTestSessions(list);
    setTestSessionsMsg(list.length ? "" : "No test sessions.");
    if (list.length && !testSessionForm.problem_set_id) {
      setTestSessionForm((s) => ({ ...s, problem_set_id: list[0].problem_set_id || "" }));
    }
  }

  async function fetchAttendanceDays() {
    setAttendanceMsg("Loading attendance...");
    const { data, error } = await supabase
      .from("attendance_days")
      .select("id, day_date, created_at")
      .order("day_date", { ascending: true })
      .limit(60);
    if (error) {
      console.error("attendance_days fetch error:", error);
      setAttendanceDays([]);
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    setAttendanceDays(list);
    setAttendanceMsg(list.length ? "" : "No attendance days yet.");
    if (list.length) {
      fetchAttendanceEntries(list.map((d) => d.id));
    } else {
      setAttendanceEntries({});
    }
  }

  async function fetchAttendanceEntries(dayIds) {
    if (!dayIds?.length) {
      setAttendanceEntries({});
      return;
    }
    const { data, error } = await supabase
      .from("attendance_entries")
      .select("day_id, student_id, status, comment")
      .in("day_id", dayIds);
    if (error) {
      console.error("attendance_entries fetch error:", error);
      setAttendanceEntries({});
      setAttendanceMsg(`Load failed: ${error.message}`);
      return;
    }
    const map = {};
    (data ?? []).forEach((row) => {
      if (!row?.day_id || !row?.student_id) return;
      if (!map[row.day_id]) map[row.day_id] = {};
      map[row.day_id][row.student_id] = {
        status: row.status,
        comment: row.comment ?? ""
      };
    });
    setAttendanceEntries(map);
  }

  async function openAttendanceDay(dayDate) {
    if (!dayDate) return;
    if (!profile?.school_id) {
      setAttendanceMsg("School context is missing for this admin.");
      return;
    }
    setAttendanceMsg("");
    setAttendanceModalOpen(true);
    setAttendanceSaving(false);
    setApprovedAbsenceByStudent({});
    const { data, error } = await supabase
      .from("attendance_days")
      .upsert({ school_id: profile.school_id, day_date: dayDate }, { onConflict: "school_id,day_date" })
      .select()
      .single();
    if (error || !data?.id) {
      console.error("attendance day upsert error:", error);
      setAttendanceMsg(`Open day failed: ${error?.message ?? "Unknown error"}`);
      setAttendanceModalOpen(false);
      return;
    }
    const day = data;
    const { data: approvedApps, error: appsError } = await supabase
      .from("absence_applications")
      .select("id, student_id, type, late_type, time_value, reason, catch_up")
      .eq("day_date", day.day_date)
      .eq("status", "approved");
    if (appsError) {
      console.error("approved applications fetch error:", appsError);
      setApprovedAbsenceByStudent({});
    } else {
      const map = {};
      (approvedApps ?? []).forEach((a) => {
        map[a.student_id] = a;
      });
      setApprovedAbsenceByStudent(map);
    }
    setAttendanceModalDay(day);
    const existing = attendanceEntriesByDay[day.id] ?? {};
    const draft = {};
    (activeStudents ?? []).forEach((s) => {
      const entry = existing[s.id] || {};
      draft[s.id] = {
        status: entry.status || "P",
        comment: entry.comment || ""
      };
    });
    setAttendanceDraft(draft);
    await fetchAttendanceDays();
  }

  async function saveAttendanceDay() {
    if (!attendanceModalDay?.id) return;
    setAttendanceSaving(true);
    const rows = Object.entries(attendanceDraft || {})
      .map(([studentId, v]) => ({
        day_id: attendanceModalDay.id,
        student_id: studentId,
        status: v.status,
        comment: v.comment?.trim() || null
      }))
      .filter((r) => r.status);
    const { error } = await supabase
      .from("attendance_entries")
      .upsert(rows, { onConflict: "day_id,student_id" });
    if (error) {
      console.error("attendance save error:", error);
      setAttendanceMsg(`Save failed: ${error.message}`);
      setAttendanceSaving(false);
      return;
    }
    setAttendanceSaving(false);
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    fetchAttendanceDays();
  }

  async function deleteAttendanceDay(day) {
    if (!day?.id) return;
    const ok = window.confirm(`Delete attendance for ${day.day_date}?`);
    if (!ok) return;
    const { error } = await supabase
      .from("attendance_days")
      .delete()
      .eq("id", day.id);
    if (error) {
      console.error("attendance delete error:", error);
      setAttendanceMsg(`Delete failed: ${error.message}`);
      return;
    }
    setAttendanceModalOpen(false);
    setAttendanceModalDay(null);
    setAttendanceDraft({});
    fetchAttendanceDays();
  }

  async function createTestSession() {
    setTestSessionsMsg("");
    const problemSetId = testSessionForm.problem_set_id.trim();
    const title = testSessionForm.title.trim();
    const endsAt = testSessionForm.ends_at;
    const passRate = Number(testSessionForm.pass_rate);
    if (!problemSetId) {
      setTestSessionsMsg("Problem Set ID is required.");
      return;
    }
    if (!title) {
      setTestSessionsMsg("Title is required.");
      return;
    }
    if (!endsAt) {
      setTestSessionsMsg("End time is required.");
      return;
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setTestSessionsMsg("Pass rate must be between 0 and 1.");
      return;
    }
    const payload = {
      problem_set_id: problemSetId,
      title,
      starts_at: testSessionForm.starts_at ? fromBangladeshInput(testSessionForm.starts_at) : null,
      ends_at: endsAt ? fromBangladeshInput(endsAt) : null,
      time_limit_min: testSessionForm.time_limit_min ? Number(testSessionForm.time_limit_min) : null,
      is_published: true,
      show_answers: Boolean(testSessionForm.show_answers),
      allow_multiple_attempts: Boolean(testSessionForm.allow_multiple_attempts)
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("test_sessions insert error:", error);
      setTestSessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: passRateError } = await supabase
      .from("tests")
      .update({ pass_rate: passRate, updated_at: new Date().toISOString() })
      .eq("version", problemSetId);
    if (passRateError) {
      console.error("test pass_rate update error:", passRateError);
      setTestSessionsMsg(`Session created but pass rate update failed: ${passRateError.message}`);
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: fromBangladeshInput(endsAt)
    });
    if (linkError) {
      console.error("exam_links insert error:", linkError);
      setTestSessionsMsg(`Session created but link failed: ${linkError.message}`);
      fetchTestSessions();
      return;
    }
    setTestSessionsMsg("Created (session + link).");
    setTestSessionForm((s) => ({ ...s, title: "" }));
    fetchTestSessions();
    fetchExamLinks();
  }

  async function createDailySession() {
    setDailySessionsMsg("");
    const problemSetId = dailySessionForm.problem_set_id.trim();
    const title = dailySessionForm.title.trim();
    const endsAt = dailySessionForm.ends_at;
    const passRate = Number(dailySessionForm.pass_rate);
    if (!problemSetId) {
      setDailySessionsMsg("Problem Set ID is required.");
      return;
    }
    if (!title) {
      setDailySessionsMsg("Title is required.");
      return;
    }
    if (!endsAt) {
      setDailySessionsMsg("End time is required.");
      return;
    }
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setDailySessionsMsg("Pass rate must be between 0 and 1.");
      return;
    }
    const payload = {
      problem_set_id: problemSetId,
      title,
      starts_at: dailySessionForm.starts_at ? fromBangladeshInput(dailySessionForm.starts_at) : null,
      ends_at: endsAt ? fromBangladeshInput(endsAt) : null,
      time_limit_min: dailySessionForm.time_limit_min ? Number(dailySessionForm.time_limit_min) : null,
      is_published: true,
      show_answers: Boolean(dailySessionForm.show_answers),
      allow_multiple_attempts: Boolean(dailySessionForm.allow_multiple_attempts)
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("daily test_sessions insert error:", error);
      setDailySessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: passRateError } = await supabase
      .from("tests")
      .update({ pass_rate: passRate, updated_at: new Date().toISOString() })
      .eq("version", problemSetId);
    if (passRateError) {
      console.error("daily pass_rate update error:", passRateError);
      setDailySessionsMsg(`Session created but pass rate update failed: ${passRateError.message}`);
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: fromBangladeshInput(endsAt)
    });
    if (linkError) {
      console.error("daily exam_links insert error:", linkError);
      setDailySessionsMsg(`Session created but link failed: ${linkError.message}`);
      fetchTestSessions();
      return;
    }
    setDailySessionsMsg("Created (session + link).");
    setDailySessionForm((s) => ({ ...s, title: "" }));
    fetchTestSessions();
    fetchExamLinks();
  }

  function startEditSession(session) {
    if (!session?.id) return;
    const passRate = testPassRateByVersion[session.problem_set_id];
    setEditingSessionId(session.id);
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: session.id,
      problem_set_id: session.problem_set_id ?? "",
      title: session.title ?? "",
      starts_at: formatDateTimeInput(session.starts_at),
      ends_at: formatDateTimeInput(session.ends_at),
      time_limit_min: session.time_limit_min ?? "",
      show_answers: Boolean(session.show_answers),
      allow_multiple_attempts: session.allow_multiple_attempts !== false,
      pass_rate: passRate != null ? String(passRate) : ""
    });
  }

  function cancelEditSession() {
    setEditingSessionId("");
    setEditingSessionMsg("");
    setEditingSessionForm({
      id: "",
      problem_set_id: "",
      title: "",
      starts_at: "",
      ends_at: "",
      time_limit_min: "",
      show_answers: false,
      allow_multiple_attempts: true,
      pass_rate: ""
    });
  }

  async function saveSessionEdits() {
    if (!editingSessionId) return;
    const {
      title,
      starts_at,
      ends_at,
      time_limit_min,
      show_answers,
      pass_rate,
      problem_set_id,
      allow_multiple_attempts
    } = editingSessionForm;
    if (!title.trim()) {
      setEditingSessionMsg("Title is required.");
      return;
    }
    if (!ends_at) {
      setEditingSessionMsg("End time is required.");
      return;
    }
    const passRateValue = Number(pass_rate);
    if (!Number.isFinite(passRateValue) || passRateValue <= 0 || passRateValue > 1) {
      setEditingSessionMsg("Pass rate must be between 0 and 1.");
      return;
    }
    setEditingSessionMsg("Saving...");
    const payload = {
      title: title.trim(),
      starts_at: starts_at ? fromBangladeshInput(starts_at) : null,
      ends_at: ends_at ? fromBangladeshInput(ends_at) : null,
      time_limit_min: time_limit_min ? Number(time_limit_min) : null,
      show_answers: Boolean(show_answers),
      allow_multiple_attempts: Boolean(allow_multiple_attempts)
    };
    const { error } = await supabase.from("test_sessions").update(payload).eq("id", editingSessionId);
    if (error) {
      console.error("session update error:", error);
      setEditingSessionMsg(`Save failed: ${error.message}`);
      return;
    }
    const { error: linkError } = await supabase
      .from("exam_links")
      .update({ expires_at: fromBangladeshInput(ends_at) })
      .eq("test_session_id", editingSessionId);
    if (linkError) {
      console.error("session link update error:", linkError);
      setEditingSessionMsg(`Saved, but link update failed: ${linkError.message}`);
    }
    if (problem_set_id) {
      const { error: passRateError } = await supabase
        .from("tests")
        .update({ pass_rate: passRateValue, updated_at: new Date().toISOString() })
        .eq("version", problem_set_id);
      if (passRateError) {
        console.error("session pass_rate update error:", passRateError);
        setEditingSessionMsg(`Saved, but pass rate update failed: ${passRateError.message}`);
      }
    }
    cancelEditSession();
    fetchTestSessions();
    fetchExamLinks();
    fetchTests();
  }

  async function deleteTestSession(id) {
    if (!id) return;
    const ok = window.confirm(`Delete test session ${id}?`);
    if (!ok) return;
    const { error } = await supabase.from("test_sessions").delete().eq("id", id);
    if (error) {
      console.error("test_sessions delete error:", error);
      setTestSessionsMsg(`Delete failed: ${error.message}`);
      return;
    }
    setTestSessionsMsg(`Deleted: ${id}`);
    fetchTestSessions();
  }

  async function ensureTestRecord(testVersion, title, type, passRate) {
    const { data, error } = await supabase
      .from("tests")
      .select("id, title")
      .eq("version", testVersion)
      .limit(1);
    if (error) {
      console.error("tests lookup error:", error);
      return { ok: false, message: `Test lookup failed: ${error.message}` };
    }
    const existing = (data ?? [])[0] ?? null;
    if (existing) {
      const updatePayload = {
        type,
        updated_at: new Date().toISOString()
      };
      if (Number.isFinite(passRate)) updatePayload.pass_rate = passRate;
      if (title) updatePayload.title = title;
      const { error: updateError } = await supabase
        .from("tests")
        .update(updatePayload)
        .eq("version", testVersion);
      if (updateError) {
        console.error("tests update error:", updateError);
        return { ok: false, message: `Test update failed: ${updateError.message}` };
      }
      return { ok: true, existing: true };
    }

    const effectiveTitle = title || testVersion;
    const { error: insertError } = await supabase.from("tests").insert({
      version: testVersion,
      title: effectiveTitle,
      type,
      pass_rate: Number.isFinite(passRate) ? passRate : null,
      is_public: true,
      updated_at: new Date().toISOString()
    });
    if (insertError) {
      console.error("tests insert error:", insertError);
      return { ok: false, message: `Test create failed: ${insertError.message}` };
    }
    return { ok: true, existing: false };
  }

  async function fetchAssets() {
    setAssetsMsg("Loading...");
    const { data, error } = await supabase
      .from("test_assets")
      .select("id")
      .limit(1);
    if (error) {
      console.error("assets fetch error:", error);
      setAssets([]);
      setAssetsMsg(`Load failed: ${error.message}`);
      return;
    }
    setAssets(data ?? []);
    setAssetsMsg("");
  }

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData?.session?.access_token ?? null;
    const expiresAt = sessionData?.session?.expires_at ?? 0;
    if (!accessToken || expiresAt * 1000 < Date.now() + 60_000) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        accessToken = refreshed?.session?.access_token ?? null;
      }
    }
    return accessToken;
  }

  async function openPreview(testVersion) {
    setPreviewOpen(true);
    setPreviewTest(testVersion);
    setPreviewAnswers({});
    setPreviewMsg("Loading...");
    const { data, error } = await supabase
      .from("questions")
      .select("question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
      .eq("test_version", testVersion)
      .order("order_index", { ascending: true });
    if (error) {
      console.error("preview questions error:", error);
      setPreviewQuestions([]);
      setPreviewMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = (data ?? []).map(mapDbQuestion);
    setPreviewQuestions(list);
    setPreviewMsg(list.length ? "" : "No questions.");
  }

  function closePreview() {
    setPreviewOpen(false);
    setPreviewTest("");
    setPreviewQuestions([]);
    setPreviewAnswers({});
    setPreviewMsg("");
  }

  async function deleteTest(testVersion) {
    if (!testVersion) return;
    const ok = window.confirm(`Delete test "${testVersion}"? This will remove questions/choices/assets.`);
    if (!ok) return;
    const { error } = await supabase.from("tests").delete().eq("version", testVersion);
    if (error) {
      console.error("delete test error:", error);
      setTestsMsg(`Delete failed: ${error.message}`);
      return;
    }
    setTestsMsg(`Deleted: ${testVersion}`);
    closePreview();
    fetchTests();
  }

  async function deleteAttempt(attemptId) {
    if (!attemptId) return;
    const ok = window.confirm(`Delete attempt ${attemptId}?`);
    if (!ok) return;
    const { error } = await supabase.from("attempts").delete().eq("id", attemptId);
    if (error) {
      console.error("delete attempt error:", error);
      setMsg(`Delete failed: ${error.message}`);
      return;
    }
    if (selectedId === attemptId) setSelectedId(null);
    setMsg(`Deleted: ${attemptId}`);
    runSearch();
  }

  function getAttemptTitle(attempt) {
    if (!attempt) return "";
    if (attempt.test_session_id) {
      const session = testSessions.find((s) => s.id === attempt.test_session_id);
      if (session?.title) return session.title;
    }
    return getProblemSetTitle(attempt.test_version, tests);
  }

  function setPreviewAnswer(questionId, choiceIndex) {
    setPreviewAnswers((prev) => ({ ...prev, [questionId]: choiceIndex }));
  }

  function setPreviewPartAnswer(questionId, partIndex, choiceIndex) {
    setPreviewAnswers((prev) => {
      const cur = prev[questionId] ?? {};
      const next = Array.isArray(cur.partAnswers) ? [...cur.partAnswers] : [];
      next[partIndex] = choiceIndex;
      return { ...prev, [questionId]: { partAnswers: next } };
    });
  }

  async function inviteStudents(payload) {
    setCsvMsg("");
    setStudentMsg("");
    setInviteResults([]);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setStudentMsg("Session expired. Please log in again.");
      return false;
    }
    const { data, error } = await supabase.functions.invoke("invite-students", {
      body: activeSchoolId ? { ...payload, school_id: activeSchoolId } : payload,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("invite-students error:", error);
      setStudentMsg(`Create failed: ${error.message}`);
      return false;
    }
    const results = data?.results ?? [];
    setInviteResults(results);
    const okCount = results.filter((r) => r.ok).length;
    const ngCount = results.length - okCount;
    setStudentTempMap((prev) => {
      const next = { ...prev };
      results.forEach((r) => {
        if (r.ok && r.user_id && r.temp_password) {
          next[r.user_id] = r.temp_password;
        }
      });
      return next;
    });
    setStudentMsg(`Created: ${okCount} ok / ${ngCount} failed`);
    fetchStudents();
    return okCount > 0;
  }

  async function reissueTempPassword(student, tempPasswordInput) {
    if (!student?.id) return;
    setStudentMsg("");
    setReissueMsg("Generating new pass...");
    setReissueLoading(true);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setReissueMsg("Session expired. Please log in again.");
      setReissueLoading(false);
      return;
    }
    const body = { user_id: student.id, email: student.email, school_id: activeSchoolId };
    if (tempPasswordInput) body.temp_password = tempPasswordInput;
    const { data, error } = await supabase.functions.invoke("reissue-temp-password", {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("reissue-temp-password error:", error);
      setReissueMsg(`Reissue failed: ${error.message}`);
      setReissueLoading(false);
      return;
    }
    if (data?.error) {
      setReissueMsg(`Reissue failed: ${data.error}`);
      setReissueLoading(false);
      return;
    }
    const tempPassword = data?.temp_password ?? "";
    if (tempPassword) {
      setStudentTempMap((prev) => ({ ...prev, [student.id]: tempPassword }));
    }
    setReissueIssuedPassword(tempPassword);
    setReissueMsg("");
    setReissueLoading(false);
    setStudentMsg(`Reissued temp password for ${student.email || student.id}`);
  }

  async function deleteStudent(userId, email) {
    if (!userId) return;
    const ok = window.confirm(`Delete student ${email || userId}?`);
    if (!ok) return;
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setStudentMsg("Session expired. Please log in again.");
      return;
    }
    const { data, error } = await supabase.functions.invoke("delete-student", {
      body: { user_id: userId, school_id: activeSchoolId },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("delete-student error:", error);
      setStudentMsg(`Delete failed: ${error.message}`);
      return;
    }
    if (data?.error) {
      setStudentMsg(`Delete failed: ${data.error}`);
      return;
    }
    setStudentMsg(`Deleted: ${email || userId}`);
    fetchStudents();
  }

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length === 0) return [];
    const header = lines[0].split(",").map((s) => s.trim());
    const idxEmail = header.indexOf("email");
    const idxName = header.indexOf("display_name");
    const idxCode = header.indexOf("student_code");
    const idxPass = header.indexOf("temp_password");
    if (idxEmail === -1) throw new Error("CSV must include 'email' header");
    const out = [];
    const safeCell = (row, idx) => (idx === -1 ? "" : String(row[idx] ?? "").trim());
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const tempPassword = safeCell(cols, idxPass);
      out.push({
        email: safeCell(cols, idxEmail),
        display_name: safeCell(cols, idxName),
        student_code: safeCell(cols, idxCode),
        temp_password: tempPassword,
      });
    }
    return out.filter((r) => r.email);
  }

  function getAssetTypeByExt(filename) {
    const ext = String(filename ?? "").toLowerCase().split(".").pop() ?? "";
    if (ext === "csv") return "csv";
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
    if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return "audio";
    return "file";
  }

  async function uploadSingleAsset(file, testVersion, type) {
    const assetType = getAssetTypeByExt(file.name);
    const relPath = file.webkitRelativePath || file.name;
    const filePath = `${type}/${testVersion}/${assetType}/${relPath}`;
    const { error: uploadError } = await supabase.storage
      .from("test-assets")
      .upload(filePath, file, { upsert: true, contentType: file.type || undefined });
    if (uploadError) return { error: uploadError };

    const { error: assetError } = await supabase.from("test_assets").insert({
      test_version: testVersion,
      test_type: type,
      asset_type: assetType,
      path: filePath,
      mime_type: file.type || null,
      original_name: file.name
    });
    if (assetError) return { error: assetError };
    return { error: null };
  }

  async function uploadAssets() {
    setAssetUploadMsg("");
    const singleFile = assetFile;
    const folderFiles = assetFiles || [];
    let testVersion = assetForm.test_version.trim();
    const type = "mock";
    const category = assetForm.category.trim();
    const title = type === "mock" ? (category || DEFAULT_MODEL_CATEGORY) : testVersion;

    if (!testVersion && assetCsvFile) {
      const csvText = await assetCsvFile.text();
      const detectedVersion = detectTestVersionFromCsvText(csvText);
      if (detectedVersion && detectedVersion !== testVersion) {
        testVersion = detectedVersion;
        setAssetForm((s) => ({ ...s, test_version: detectedVersion }));
      }
    }

    if (!singleFile && folderFiles.length === 0) {
      setAssetUploadMsg("File or folder is required.");
      return;
    }
    if (!testVersion) {
      setAssetUploadMsg("test_version is required.");
      return;
    }
    const files = [];
    if (singleFile) files.push(singleFile);
    files.push(...folderFiles);
    if (assetCsvFile && !files.includes(assetCsvFile)) files.unshift(assetCsvFile);
    if (singleFile && singleFile.name.toLowerCase().endsWith(".csv")) {
      setAssetCsvFile(singleFile);
    }
    const hasCsv =
      (assetCsvFile && assetCsvFile.name.toLowerCase().endsWith(".csv")) ||
      (singleFile && singleFile.name.toLowerCase().endsWith(".csv")) ||
      files.some((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!hasCsv) {
      setAssetUploadMsg("CSV file is required for Upload & Register Problem Set.");
      return;
    }

    setAssetUploadMsg("Uploading...");

    const ensure = await ensureTestRecord(testVersion, title, type, null);
    if (!ensure.ok) {
      setAssetUploadMsg(ensure.message);
      return;
    }

    let ok = 0;
    let ng = 0;
    for (const file of files) {
      const { error } = await uploadSingleAsset(file, testVersion, type);
      if (error) {
        ng += 1;
        console.error("asset upload error:", error);
      } else {
        ok += 1;
      }
      setAssetUploadMsg(`Uploading... ${ok + ng}/${files.length}`);
    }

    setAssetUploadMsg(`Uploaded: ${ok} ok / ${ng} failed`);
    fetchTests();
    fetchAssets();

    await importQuestionsFromCsv();

    setAssetFile(null);
    setAssetFiles([]);
  }

  async function importQuestionsFromCsv() {
    setAssetImportMsg("");
    const file = assetCsvFile || assetFile;
    const testVersion = assetForm.test_version.trim();
    const type = "mock";
    const category = assetForm.category.trim();

    if (!file) {
      setAssetImportMsg("CSV file is required.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("CSV file is required.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("Only CSV is supported.");
      return;
    }
    setAssetImportMsg("Parsing...");
    const text = await file.text();
    const { questions, choices, errors } = parseQuestionCsv(text, testVersion);
    if (errors.length) {
      setAssetImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setAssetImportMsg("No questions found.");
      return;
    }
    const versionSet = new Set(questions.map((q) => q.test_version));
    if (versionSet.size > 1) {
      setAssetImportMsg("Multiple test_version values detected. Split CSV per test_version.");
      return;
    }
    const resolvedVersion = Array.from(versionSet)[0] || testVersion;
    if (resolvedVersion && resolvedVersion !== testVersion) {
      setAssetForm((s) => ({ ...s, test_version: resolvedVersion }));
    }
    if (!resolvedVersion) {
      setAssetImportMsg("test_version is required (either in form or CSV).");
      return;
    }
    const resolvedTitle = type === "mock" ? (category || DEFAULT_MODEL_CATEGORY) : resolvedVersion;

    setAssetImportMsg("Resolving assets...");
    const { data: assetRows, error: assetErr } = await supabase
      .from("test_assets")
      .select("path, original_name")
      .eq("test_version", resolvedVersion);
    if (assetErr) {
      console.error("assets fetch error:", assetErr);
      setAssetImportMsg(`Asset lookup failed: ${assetErr.message}`);
      return;
    }
    const assetMap = {};
    const baseUrl = `${supabaseUrl}/storage/v1/object/public/test-assets/`;
    for (const row of assetRows ?? []) {
      const name = row.original_name || row.path?.split("/").pop();
      if (name) assetMap[name] = `${baseUrl}${row.path}`;
    }
    const { missing, invalid } = validateAssetRefs(questions, choices, assetMap);
    if (invalid.length) {
      setAssetImportMsg(`Invalid asset paths (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
      return;
    }
    if (missing.length) {
      setAssetImportMsg(`Missing assets (upload first):\n${missing.slice(0, 5).join("\n")}`);
      return;
    }
    applyAssetMap(questions, choices, assetMap);

    setAssetImportMsg("Upserting tests...");
    const ensure = await ensureTestRecord(resolvedVersion, resolvedTitle, type, null);
    if (!ensure.ok) {
      setAssetImportMsg(ensure.message);
      return;
    }

    const questionIds = questions.map((q) => q.question_id);
    if (questionIds.length) {
      const notIn = `(${questionIds.map((id) => `"${id}"`).join(",")})`;
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion)
        .not("question_id", "in", notIn);
      if (cleanupErr) {
        console.error("questions cleanup error:", cleanupErr);
        setAssetImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    } else {
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion);
      if (cleanupErr) {
        console.error("questions cleanup error:", cleanupErr);
        setAssetImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    }

    setAssetImportMsg("Upserting questions...");
    const { error: qError } = await supabase.from("questions").upsert(questions, {
      onConflict: "test_version,question_id"
    });
    if (qError) {
      console.error("questions upsert error:", qError);
      setAssetImportMsg(`Question upsert failed: ${qError.message}`);
      return;
    }
    const { data: qRows, error: qFetchErr } = await supabase
      .from("questions")
      .select("id, question_id")
      .eq("test_version", resolvedVersion)
      .in("question_id", questionIds);
    if (qFetchErr) {
      console.error("questions fetch error:", qFetchErr);
      setAssetImportMsg(`Question fetch failed: ${qFetchErr.message}`);
      return;
    }

    const idMap = {};
    for (const row of qRows ?? []) {
      idMap[row.question_id] = row.id;
    }

    const choiceRows = choices
      .map((c) => ({
        question_id: idMap[c.question_key],
        part_index: c.part_index,
        choice_index: c.choice_index,
        label: c.label,
        choice_image: c.choice_image
      }))
      .filter((c) => c.question_id);

    const qUuidList = Object.values(idMap);
    if (qUuidList.length) {
      const { error: delErr } = await supabase.from("choices").delete().in("question_id", qUuidList);
      if (delErr) {
        console.error("choices delete error:", delErr);
        setAssetImportMsg(`Choice cleanup failed: ${delErr.message}`);
        return;
      }
    }

    if (choiceRows.length) {
      const { error: cErr } = await supabase.from("choices").insert(choiceRows);
      if (cErr) {
        console.error("choices insert error:", cErr);
        setAssetImportMsg(`Choice insert failed: ${cErr.message}`);
        return;
      }
    }

    setAssetImportMsg(`Imported ${questions.length} questions / ${choiceRows.length} choices.`);
    fetchTests();
    setAssetCsvFile(null);
  }

  async function uploadDailyAssets() {
    setDailyUploadMsg("");
    const singleFile = dailyFile;
    const folderFiles = dailyFiles || [];
    let testVersion = dailyForm.test_version.trim();
    const category = dailyForm.category.trim();
    const type = "daily";

    if (!testVersion && dailyCsvFile) {
      const csvText = await dailyCsvFile.text();
      const detectedVersion = detectDailyTestIdFromCsvText(csvText);
      if (detectedVersion && detectedVersion !== testVersion) {
        testVersion = detectedVersion;
        setDailyForm((s) => ({ ...s, test_version: detectedVersion }));
      }
    }

    if (!singleFile && folderFiles.length === 0) {
      setDailyUploadMsg("File or folder is required.");
      return;
    }
    if (!testVersion) {
      setDailyUploadMsg("TestID is required.");
      return;
    }

    const files = [];
    if (singleFile) files.push(singleFile);
    files.push(...folderFiles);
    if (dailyCsvFile && !files.includes(dailyCsvFile)) files.unshift(dailyCsvFile);
    const isCsvLike = (name) => {
      const lower = String(name ?? "").toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".tsv");
    };
    if (singleFile && isCsvLike(singleFile.name)) {
      setDailyCsvFile(singleFile);
    }
    const hasCsv =
      (dailyCsvFile && isCsvLike(dailyCsvFile.name)) ||
      (singleFile && isCsvLike(singleFile.name)) ||
      files.some((f) => isCsvLike(f.name));
    if (!hasCsv) {
      setDailyUploadMsg("CSV file is required for Upload & Register Daily Test.");
      return;
    }

    setDailyUploadMsg("Uploading...");
    const ensure = await ensureTestRecord(testVersion, category || testVersion, type, null);
    if (!ensure.ok) {
      setDailyUploadMsg(ensure.message);
      return;
    }

    let ok = 0;
    let ng = 0;
    for (const file of files) {
      const { error } = await uploadSingleAsset(file, testVersion, type);
      if (error) {
        ng += 1;
        console.error("daily asset upload error:", error);
      } else {
        ok += 1;
      }
      setDailyUploadMsg(`Uploading... ${ok + ng}/${files.length}`);
    }

    setDailyUploadMsg(`Uploaded: ${ok} ok / ${ng} failed`);
    fetchTests();
    fetchAssets();

    await importDailyQuestionsFromCsv();

    setDailyFile(null);
    setDailyFiles([]);
  }

  async function importDailyQuestionsFromCsv() {
    setDailyImportMsg("");
    const file = dailyCsvFile || dailyFile;
    const testVersion = dailyForm.test_version.trim();
    const category = dailyForm.category.trim();
    const type = "daily";

    if (!file) {
      setDailyImportMsg("CSV file is required.");
      return;
    }
    const isCsvLike = (name) => {
      const lower = String(name ?? "").toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".tsv");
    };
    if (!isCsvLike(file.name)) {
      setDailyImportMsg("CSV file is required.");
      return;
    }

    setDailyImportMsg("Parsing...");
    const text = await file.text();
    const { questions, choices, errors } = parseDailyCsv(text, testVersion);
    if (errors.length) {
      setDailyImportMsg(`CSV errors:\n${errors.slice(0, 5).join("\n")}`);
      return;
    }
    if (questions.length === 0) {
      setDailyImportMsg("No questions found.");
      return;
    }
    const versionSet = new Set(questions.map((q) => q.test_version));
    if (versionSet.size > 1) {
      setDailyImportMsg("Multiple TestID values detected. Split CSV per TestID.");
      return;
    }
    const resolvedVersion = Array.from(versionSet)[0] || testVersion;
    if (resolvedVersion && resolvedVersion !== testVersion) {
      setDailyForm((s) => ({ ...s, test_version: resolvedVersion }));
    }
    if (!resolvedVersion) {
      setDailyImportMsg("TestID is required (either in form or CSV).");
      return;
    }

    setDailyImportMsg("Resolving assets...");
    const { data: assetRows, error: assetErr } = await supabase
      .from("test_assets")
      .select("path, original_name")
      .eq("test_version", resolvedVersion);
    if (assetErr) {
      console.error("daily assets fetch error:", assetErr);
      setDailyImportMsg(`Asset lookup failed: ${assetErr.message}`);
      return;
    }
    const assetMap = {};
    const baseUrl = `${supabaseUrl}/storage/v1/object/public/test-assets/`;
    for (const row of assetRows ?? []) {
      const name = row.original_name || row.path?.split("/").pop();
      if (name) assetMap[name] = `${baseUrl}${row.path}`;
    }
    const { missing, invalid } = validateAssetRefs(questions, choices, assetMap);
    if (invalid.length) {
      setDailyImportMsg(`Invalid asset paths (use filename only):\n${invalid.slice(0, 5).join("\n")}`);
      return;
    }
    if (missing.length) {
      setDailyImportMsg(`Missing assets (upload first):\n${missing.slice(0, 5).join("\n")}`);
      return;
    }
    applyAssetMap(questions, choices, assetMap);

    setDailyImportMsg("Upserting tests...");
    const ensure = await ensureTestRecord(resolvedVersion, category || resolvedVersion, type, null);
    if (!ensure.ok) {
      setDailyImportMsg(ensure.message);
      return;
    }

    const questionIds = questions.map((q) => q.question_id);
    if (questionIds.length) {
      const notIn = `(${questionIds.map((id) => `"${id}"`).join(",")})`;
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion)
        .not("question_id", "in", notIn);
      if (cleanupErr) {
        console.error("daily questions cleanup error:", cleanupErr);
        setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    } else {
      const { error: cleanupErr } = await supabase
        .from("questions")
        .delete()
        .eq("test_version", resolvedVersion);
      if (cleanupErr) {
        console.error("daily questions cleanup error:", cleanupErr);
        setDailyImportMsg(`Question cleanup failed: ${cleanupErr.message}`);
        return;
      }
    }

    setDailyImportMsg("Upserting questions...");
    const { error: qError } = await supabase.from("questions").upsert(questions, {
      onConflict: "test_version,question_id"
    });
    if (qError) {
      console.error("daily questions upsert error:", qError);
      setDailyImportMsg(`Question upsert failed: ${qError.message}`);
      return;
    }

    const { data: qRows, error: qFetchErr } = await supabase
      .from("questions")
      .select("id, question_id")
      .eq("test_version", resolvedVersion)
      .in("question_id", questionIds);
    if (qFetchErr) {
      console.error("daily questions fetch error:", qFetchErr);
      setDailyImportMsg(`Question fetch failed: ${qFetchErr.message}`);
      return;
    }

    const idMap = {};
    for (const row of qRows ?? []) {
      idMap[row.question_id] = row.id;
    }

    const choiceRows = choices
      .map((c) => ({
        question_id: idMap[c.question_key],
        part_index: c.part_index,
        choice_index: c.choice_index,
        label: c.label,
        choice_image: c.choice_image
      }))
      .filter((c) => c.question_id);

    const qUuidList = Object.values(idMap);
    if (qUuidList.length) {
      const { error: delErr } = await supabase.from("choices").delete().in("question_id", qUuidList);
      if (delErr) {
        console.error("daily choices delete error:", delErr);
        setDailyImportMsg(`Choice cleanup failed: ${delErr.message}`);
        return;
      }
    }

    if (choiceRows.length) {
      const { error: cErr } = await supabase.from("choices").insert(choiceRows);
      if (cErr) {
        console.error("daily choices insert error:", cErr);
        setDailyImportMsg(`Choice insert failed: ${cErr.message}`);
        return;
      }
    }

    setDailyImportMsg(`Imported ${questions.length} questions / ${choiceRows.length} choices.`);
    fetchTests();
    setDailyCsvFile(null);
  }

  async function handleCsvFile(file) {
    setCsvMsg("");
    if (!file) return;
    const text = await file.text();
    let rows = [];
    try {
      rows = parseCsv(text);
    } catch (e) {
      setCsvMsg(String(e?.message ?? e));
      return;
    }
    if (rows.length === 0) {
      setCsvMsg("No rows.");
      return;
    }
    setCsvMsg(`Uploading ${rows.length} students...`);
    await inviteStudents({ students: rows });
    setCsvMsg("");
  }

  async function exportSummaryCsv(list) {
    const emailMap = await buildProfileEmailMap(supabase, list);
    const rows = [
      ["attempt_id", "created_at", "display_name", "student_code", "email", "test_version", "correct", "total", "score_rate"],
      ...list.map((a) => [
        a.id,
        a.created_at,
        a.display_name ?? "",
        a.student_code ?? "",
        emailMap[a.student_id] ?? "",
        a.test_version ?? "",
        a.correct ?? 0,
        a.total ?? 0,
        getScoreRate(a)
      ])
    ];
    downloadText(`attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  async function exportQuizSummaryCsv() {
    setQuizMsg("");
    const quizVersions = (tests ?? []).filter((t) => t.type === "quiz").map((t) => t.version);
    let query = supabase
      .from("attempts")
      .select("id, student_id, display_name, student_code, test_version, correct, total, score_rate, created_at")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (quizVersions.length) {
      query = query.in("test_version", quizVersions);
    } else {
      query = query.ilike("test_version", "quiz_%");
    }
    const { data, error } = await query;
    if (error) {
      console.error("quiz attempts fetch error:", error);
      setQuizMsg(`Load failed: ${error.message}`);
      return;
    }
    const list = data ?? [];
    if (list.length === 0) {
      setQuizMsg("No quiz attempts.");
      return;
    }
    const emailMap = await buildProfileEmailMap(supabase, list);
    const rows = [
      ["attempt_id", "created_at", "display_name", "student_code", "email", "test_version", "correct", "total", "score_rate"],
      ...list.map((a) => [
        a.id,
        a.created_at,
        a.display_name ?? "",
        a.student_code ?? "",
        emailMap[a.student_id] ?? "",
        a.test_version ?? "",
        a.correct ?? 0,
        a.total ?? 0,
        getScoreRate(a)
      ])
    ];
    downloadText(`quiz_attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  async function exportDetailCsv(list) {
    const versions = Array.from(new Set((list ?? []).map((a) => a.test_version).filter(Boolean)));
    let questionsByVersion = {};
    if (versions.length) {
      const { data, error } = await supabase
        .from("questions")
        .select("test_version, question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
        .in("test_version", versions);
      if (error) {
        console.error("export detail questions fetch error:", error);
      } else {
        for (const row of data ?? []) {
          const version = row.test_version;
          if (!version) continue;
          if (!questionsByVersion[version]) questionsByVersion[version] = [];
          questionsByVersion[version].push(mapDbQuestion(row));
        }
      }
    }

    const rows = [
      [
        "attempt_id",
        "created_at",
        "display_name",
        "student_code",
        "test_version",
        "question_id",
        "section",
        "prompt",
        "chosen",
        "correct",
        "is_correct"
      ]
    ];
    for (const a of list) {
      const questionsList = questionsByVersion[a.test_version] || null;
      const details = questionsList && questionsList.length
        ? buildAttemptDetailRowsFromList(a.answers_json, questionsList)
        : buildAttemptDetailRows(a.answers_json);
      for (const d of details) {
        rows.push([
          a.id,
          a.created_at,
          a.display_name ?? "",
          a.student_code ?? "",
          a.test_version ?? "",
          d.qid,
          d.section,
          d.prompt,
          d.chosen,
          d.correct,
          d.isCorrect ? 1 : 0
        ]);
      }
    }
    downloadText(`attempts_detail_${Date.now()}.csv`, toCsv(rows), "text/csv");
  }

  function exportSelectedAttemptCsv(attempt) {
    const details = buildAttemptDetailRows(attempt.answers_json);
    const rows = [
      ["question_id", "section", "prompt", "chosen", "correct", "is_correct"],
      ...details.map((d) => [d.qid, d.section, d.prompt, d.chosen, d.correct, d.isCorrect ? 1 : 0])
    ];
    downloadText(`attempt_${attempt.id}_detail.csv`, toCsv(rows), "text/csv");
  }

  const kpi = useMemo(() => {
    const count = attempts.length;
    const avgRate =
      count === 0 ? 0 : attempts.reduce((acc, a) => acc + getScoreRate(a), 0) / Math.max(1, count);
    const maxRate = count === 0 ? 0 : Math.max(...attempts.map((a) => getScoreRate(a)));
    return {
      count,
      avgRate,
      maxRate
    };
  }, [attempts]);

  const previewScore = useMemo(() => {
    let correct = 0;
    let total = 0;
    for (const q of previewQuestions) {
      if (Array.isArray(q.parts) && q.parts.length) {
        q.parts.forEach((p, idx) => {
          if (p.answerIndex == null) return;
          total += 1;
          const selected = previewAnswers[q.id]?.partAnswers?.[idx];
          if (selected === p.answerIndex) correct += 1;
        });
        continue;
      }
      if (q.answerIndex == null) continue;
      total += 1;
      if (previewAnswers[q.id] === q.answerIndex) correct += 1;
    }
    return { correct, total };
  }, [previewQuestions, previewAnswers]);

  async function handlePasswordChange() {
    setPasswordChangeMsg("");
    const nextPassword = passwordChangeForm.password;
    const confirmPassword = passwordChangeForm.confirmPassword;
    if (!nextPassword || !confirmPassword) {
      setPasswordChangeMsg("Enter and confirm the new password.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordChangeMsg("Passwords do not match.");
      return;
    }
    if (nextPassword.length < 8) {
      setPasswordChangeMsg("Password must be at least 8 characters.");
      return;
    }

    setPasswordChangeLoading(true);
    const { error: authError } = await supabase.auth.updateUser({
      password: nextPassword,
      data: { force_password_change: false },
    });
    if (authError) {
      setPasswordChangeMsg(authError.message);
      setPasswordChangeLoading(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", session?.user?.id ?? "");
    if (profileError) {
      setPasswordChangeMsg(profileError.message);
      setPasswordChangeLoading(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, force_password_change: false } : prev));
    setPasswordChangeForm({ password: "", confirmPassword: "" });
    setPasswordChangeMsg("");
    setPasswordChangeLoading(false);
  }

  async function handleLogin() {
    setLoginMsg("");
    const { email, password } = loginForm;
    if (!email || !password) {
      setLoginMsg("Email / Password を入力してください。");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginMsg(error.message);
      return;
    }
  }

  function handleAdminSchoolScopeChange(nextSchoolId) {
    setSchoolScopeId(nextSchoolId || null);
  }

  function handleForcedSchoolScopeChange(nextSchoolId) {
    if (!nextSchoolId || nextSchoolId === forcedSchoolId) return;
    router.push(`/super/schools/${nextSchoolId}/admin`);
  }

  if (!session) {
    return (
      <div className="admin-login">
        <h2>Admin Login</h2>
        <div className="admin-help">メールとパスワードでログインします（admin権限のみ閲覧可）。</div>
        <div style={{ marginTop: 12 }}>
          <label>Email</label>
          <input
            type="email"
            placeholder="admin@example.com"
            value={loginForm.email}
            onChange={(e) => setLoginForm((s) => ({ ...s, email: e.target.value }))}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Password</label>
          <input
            type="password"
            placeholder="••••••••"
            value={loginForm.password}
            onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value }))}
          />
        </div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={handleLogin}>Log in</button>
        </div>
        <div className="admin-msg">{loginMsg}</div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (profile.account_status === "active" && profile.force_password_change) {
    return (
      <div className="admin-login">
        <h2>Change Temporary Password</h2>
        <div className="admin-help">
          This account must change its temporary password before continuing.
        </div>
        <div style={{ marginTop: 12 }}>
          <label>New Password</label>
          <input
            type="password"
            value={passwordChangeForm.password}
            onChange={(e) => setPasswordChangeForm((s) => ({ ...s, password: e.target.value }))}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <label>Confirm Password</label>
          <input
            type="password"
            value={passwordChangeForm.confirmPassword}
            onChange={(e) => setPasswordChangeForm((s) => ({ ...s, confirmPassword: e.target.value }))}
          />
        </div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-primary" disabled={passwordChangeLoading} onClick={handlePasswordChange}>
            {passwordChangeLoading ? "Saving..." : "Update Password"}
          </button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <div className="admin-msg">{passwordChangeMsg}</div>
      </div>
    );
  }

  if (
    !forcedSchoolId &&
    profile.role === "super_admin" &&
    profile.account_status === "active"
  ) {
    return (
      <div className="admin-login">
        <h2>Redirecting...</h2>
      </div>
    );
  }

  if (!canUseAdminConsole) {
    return (
      <div className="admin-login">
        <h2>Unauthorized</h2>
        <div className="admin-help">
          {profile.account_status !== "active"
            ? "This account is disabled."
            : profile.role === "super_admin"
            ? "Super Admin must enter a school from the Schools list before using the admin console."
            : "このユーザーは admin 権限ではありません。"}
        </div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          {profile.role === "super_admin" ? (
            <Link className="btn" href="/super/schools">Go to Schools</Link>
          ) : null}
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-text">
            <div className="admin-brand-title">
              <svg viewBox="0 0 24 24" className="admin-brand-icon" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"></circle>
                <path
                  d="M6.3 11.1 16.8 7.4 14 17.9 11.7 12.3 6.3 11.1Z"
                  fill="currentColor"
                ></path>
              </svg>
              <span>JFT Navi</span>
            </div>
            <div className="admin-brand-sub">Admin Console</div>
          </div>
        </div>
        <div className="admin-nav">
          <button
            className={`admin-nav-item ${activeTab === "students" ? "active" : ""}`}
            onClick={() => setActiveTab("students")}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <circle cx="8" cy="8" r="3" />
                <circle cx="16" cy="9" r="3" />
                <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
                <path d="M12 19c1-2 3-3 5-3 2.5 0 4 1.4 4 4" />
              </svg>
            </span>
            Student List
          </button>

          <div className={`admin-nav-group ${activeTab === "attendance" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "attendance" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("attendance");
                setAttendanceSubTab("sheet");
              }}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <rect x="4" y="5" width="16" height="15" rx="2" />
                  <path d="M8 3v4M16 3v4M4 9h16" />
                </svg>
              </span>
              Attendance
              <span className={`admin-nav-arrow ${activeTab === "attendance" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "attendance" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${attendanceSubTab === "sheet" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("attendance");
                    setAttendanceSubTab("sheet");
                  }}
                >
                  Attendance Sheet
                </button>
                <button
                  className={`admin-subnav-item ${attendanceSubTab === "absence" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("attendance");
                    setAttendanceSubTab("absence");
                  }}
                >
                  Absence Applications
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "model" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "model" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("model");
                setModelSubTab("conduct");
              }}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <path d="M5 5h11a3 3 0 0 1 3 3v11H8a3 3 0 0 0-3 3V5z" />
                  <path d="M8 5v14" />
                </svg>
              </span>
              Model Test
              <span className={`admin-nav-arrow ${activeTab === "model" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "model" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${modelSubTab === "conduct" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("model");
                    setModelSubTab("conduct");
                  }}
                >
                  Conduct Test
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "upload" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("model");
                    setModelSubTab("upload");
                  }}
                >
                  Upload Questions
                </button>
                <button
                  className={`admin-subnav-item ${modelSubTab === "results" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("model");
                    setModelSubTab("results");
                  }}
                >
                  Results
                </button>
              </div>
            ) : null}
          </div>

          <div className={`admin-nav-group ${activeTab === "daily" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "daily" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("daily");
                setDailySubTab("conduct");
              }}
            >
              <span className="admin-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" className="admin-nav-svg">
                  <path d="M7 4h7l4 4v12H7z" />
                  <path d="M14 4v4h4" />
                  <path d="M9 12h6M9 16h6" />
                </svg>
              </span>
              Daily Test
              <span className={`admin-nav-arrow ${activeTab === "daily" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "daily" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${dailySubTab === "conduct" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("daily");
                    setDailySubTab("conduct");
                  }}
                >
                  Conduct Test
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "upload" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("daily");
                    setDailySubTab("upload");
                  }}
                >
                  Upload Questions
                </button>
                <button
                  className={`admin-subnav-item ${dailySubTab === "results" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("daily");
                    setDailySubTab("results");
                  }}
                >
                  Results
                </button>
              </div>
            ) : null}
          </div>

          <button
            className={`admin-nav-item ${activeTab === "announcements" ? "active" : ""}`}
            onClick={() => setActiveTab("announcements")}
          >
            <span className="admin-nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="admin-nav-svg">
                <path d="M4 4h16v12H7l-3 3z" />
                <path d="M7 8h10M7 12h6" />
              </svg>
            </span>
            Announcements
          </button>
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-email">{session.user.email}</div>
          <button className="admin-nav-item logout" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-wrap">
          {forcedSchoolId || (profile?.role === "admin" && schoolAssignments.length > 0) ? (
            <div className="admin-scope-banner">
              {forcedSchoolId && profile?.role === "super_admin" ? (
                <div className="admin-school-switcher">
                  <label htmlFor="admin-school-switcher">School</label>
                  <select
                    id="admin-school-switcher"
                    value={activeSchoolId ?? ""}
                    onChange={(event) => handleForcedSchoolScopeChange(event.target.value)}
                  >
                    {forcedSchoolOptions.map((schoolOption) => (
                      <option key={schoolOption.school_id} value={schoolOption.school_id}>
                        {schoolOption.school_name}
                        {schoolOption.school_status === "inactive" ? " (Inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {!forcedSchoolId && profile?.role === "admin" ? (
                <div className="admin-school-switcher">
                  <label htmlFor="admin-school-switcher">School</label>
                  <select
                    id="admin-school-switcher"
                    value={activeSchoolId ?? ""}
                    onChange={(event) => handleAdminSchoolScopeChange(event.target.value)}
                  >
                    {schoolAssignments.map((assignment) => (
                      <option key={assignment.school_id} value={assignment.school_id}>
                        {assignment.school_name}
                        {assignment.is_primary ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {changeSchoolHref && profile?.role !== "super_admin" ? (
                <Link className="btn" href={changeSchoolHref}>Change school</Link>
              ) : null}
              {forcedSchoolId && profile?.role === "super_admin" ? (
                <Link className="btn" href={homeHref}>{homeLabel}</Link>
              ) : null}
            </div>
          ) : null}

          <div className="admin-panel">

        {activeTab === "students" ? (
        <div style={{ marginBottom: 12 }}>
          {!studentDetailOpen ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="admin-title">Students</div>
                  <div className="admin-subtitle">Student list and performance overview.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => setInviteOpen(true)}>Add New Student</button>
                  <button className="btn" onClick={() => fetchStudents()}>Refresh Students</button>
                  <button className="btn" onClick={() => fetchStudentListMetrics()}>Refresh Metrics</button>
                </div>
              </div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field small">
                  <label>Date From</label>
                  <input
                    type="date"
                    value={studentListFilters.from}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, from: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Date To</label>
                  <input
                    type="date"
                    value={studentListFilters.to}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, to: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Attendance % (≤)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 80"
                    value={studentListFilters.maxAttendance}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, maxAttendance: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Unexcused (≥)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="e.g. 3"
                    value={studentListFilters.minUnexcused}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, minUnexcused: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Model Avg % (≥)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 60"
                    value={studentListFilters.minModelAvg}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, minModelAvg: e.target.value }))}
                  />
                </div>
                <div className="field small">
                  <label>Daily Avg % (≥)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 60"
                    value={studentListFilters.minDailyAvg}
                    onChange={(e) => setStudentListFilters((s) => ({ ...s, minDailyAvg: e.target.value }))}
                  />
                </div>
                <div className="field">
                  <label>Daily Category</label>
                  <select
                    value={studentListDailyCategory}
                    onChange={(e) => setStudentListDailyCategory(e.target.value)}
                  >
                    <option value="__all__">All Categories</option>
                    {dailyCategories.map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 960 }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Attendance %</th>
                      <th>Unexcused</th>
                      <th>Model Avg %</th>
                      <th>Daily Avg %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentListRows.map((row) => {
                      const s = row.student;
                      const rateLabel = row.attendanceRate == null ? "-" : `${row.attendanceRate.toFixed(1)}%`;
                      const modelLabel = row.modelAvg == null ? "-" : `${row.modelAvg.toFixed(1)}%`;
                      const dailyLabel = row.dailyAvg == null ? "-" : `${row.dailyAvg.toFixed(1)}%`;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => {
                            setSelectedStudentId(s.id);
                            setSelectedStudentTab("model");
                            setStudentAttendance([]);
                            setStudentAttendanceMsg("");
                            setStudentAttendanceRange({ from: "", to: "" });
                            setStudentDetailOpen(true);
                            fetchStudentAttempts(s.id);
                          }}
                          className={s.is_withdrawn ? "row-withdrawn" : ""}
                        >
                          <td>{s.student_code ?? ""}</td>
                          <td>{s.display_name ?? ""}</td>
                          <td>{s.email ?? ""}</td>
                          <td>{rateLabel}</td>
                          <td>{row.unexcused ?? 0}</td>
                          <td>{modelLabel}</td>
                          <td>{dailyLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {studentListLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading metrics...</div> : null}
              <div className="admin-msg">{studentMsg}</div>

              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div className="admin-help">
                  CSV: <b>email,display_name,student_code,temp_password</b>
                </div>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleCsvFile(e.target.files?.[0])}
                />
                <div className="admin-help">{csvMsg}</div>
              </div>
            </>
          ) : null}

          {selectedStudentId && studentDetailOpen ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      className="admin-icon-btn"
                      onClick={() => {
                        setStudentDetailOpen(false);
                        setSelectedStudentId("");
                      }}
                      aria-label="Back"
                    >
                      ←
                    </button>
                    <div className="admin-title">
                      {selectedStudent?.display_name ?? ""} {selectedStudent?.student_code ? `(${selectedStudent.student_code})` : ""}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    onClick={() => {
                      if (!selectedStudent) return;
                      setReissueStudent(selectedStudent);
                      setReissuePassword("");
                      setReissueIssuedPassword("");
                      setReissueLoading(false);
                      setReissueMsg("");
                      setReissueOpen(true);
                    }}
                  >
                    Reissue Temp Pass
                  </button>
                  <button
                    className={`btn ${selectedStudent?.is_withdrawn ? "btn-withdrawn" : ""}`}
                    onClick={() => {
                      if (!selectedStudent) return;
                      toggleWithdrawn(selectedStudent, !selectedStudent.is_withdrawn);
                    }}
                  >
                    {selectedStudent?.is_withdrawn ? "Withdrawn" : "Withdraw"}
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      if (!selectedStudent) return;
                      deleteStudent(selectedStudent.id, selectedStudent.email);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="student-detail-tab-row">
                <div className="admin-top-tabs">
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "attendance" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("attendance");
                      fetchStudentAttendance(selectedStudentId);
                    }}
                  >
                    Attendance
                  </button>
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "daily" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("daily");
                      fetchStudentAttempts(selectedStudentId);
                    }}
                  >
                    Daily Test
                  </button>
                  <button
                    className={`admin-top-tab ${selectedStudentTab === "model" ? "active" : ""}`}
                    onClick={() => {
                      setSelectedStudentTab("model");
                      fetchStudentAttempts(selectedStudentId);
                    }}
                  >
                    Model Test
                  </button>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    if (selectedStudentTab === "attendance") {
                      fetchStudentAttendance(selectedStudentId);
                    } else {
                      fetchStudentAttempts(selectedStudentId);
                    }
                  }}
                >
                  Refresh
                </button>
              </div>

              {selectedStudentTab === "model" ? (
                <>
                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 980 }}>
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Date</th>
                          <th>Total Score</th>
                          <th>Rate</th>
                          <th>P/F</th>
                          <th>Class Rank</th>
                          {sectionTitles.map((title) => (
                            <th key={`sec-${title}`} className="admin-table-compact">
                              {renderTwoLineHeader(title)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {studentModelAttempts.map((a) => {
                          const score = `${a.correct}/${a.total}`;
                          const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                          const passRate = Number(testPassRateByVersion[a.test_version] ?? 0.8);
                          const passed = getScoreRate(a) >= passRate;
                          const rankInfo = studentAttemptRanks[a.id];
                          const summary = studentAttemptSummaryById[a.id] || {};
                          return (
                            <tr
                              key={`student-model-${a.id}`}
                              onClick={() => openAttemptDetail(a)}
                            >
                              <td>{getAttemptTitle(a)}</td>
                              <td>{formatDateFull(a.created_at)}</td>
                              <td>{score}</td>
                              <td>{rate}</td>
                              <td>
                                <span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span>
                              </td>
                              <td>{rankInfo ? `${rankInfo.rank}/${rankInfo.total}` : "-"}</td>
                              {sectionTitles.map((title) => {
                                const s = summary[title];
                                return (
                                  <td key={`${a.id}-${title}`} className="admin-table-compact">
                                    {s ? `${s.correct}/${s.total}` : "-"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{studentAttemptsMsg}</div>
                </>
              ) : null}

              {selectedStudentTab === "daily" ? (
                <>
                  {studentDailyAttemptsByCategory.map(([category, items]) => (
                    <div key={`daily-${category}`} style={{ marginTop: 12 }}>
                      <div className="admin-subtitle" style={{ fontWeight: 900 }}>{category}</div>
                      <div className="admin-table-wrap" style={{ marginTop: 8 }}>
                        <table className="admin-table" style={{ minWidth: 820 }}>
                          <thead>
                            <tr>
                              <th>Test</th>
                              <th>Date</th>
                              <th>Score</th>
                              <th>Rate</th>
                              <th>P/F</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((a) => {
                              const score = `${a.correct}/${a.total}`;
                              const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                              const passRate = Number(testPassRateByVersion[a.test_version] ?? 0.8);
                              const passed = getScoreRate(a) >= passRate;
                              return (
                                <tr key={`student-daily-${a.id}`} onClick={() => openAttemptDetail(a)}>
                                  <td>{getAttemptTitle(a)}</td>
                                  <td>{formatDateFull(a.created_at)}</td>
                                  <td>{score}</td>
                                  <td>{rate}</td>
                                  <td>
                                    <span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  <div className="admin-msg">{studentAttemptsMsg}</div>
                </>
              ) : null}

              {selectedStudentTab === "attendance" ? (
                <>
                  <div className="admin-form" style={{ marginTop: 10 }}>
                    <div className="field small">
                      <label>From</label>
                      <input
                        type="date"
                        value={studentAttendanceRange.from}
                        onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, from: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>To</label>
                      <input
                        type="date"
                        value={studentAttendanceRange.to}
                        onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, to: e.target.value }))}
                      />
                    </div>
                    <div className="field small">
                      <label>&nbsp;</label>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setStudentAttendanceRange({ from: "", to: "" })}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Overall</th>
                          {attendanceSummary.months.map((m) => (
                            <th key={m.key}>{m.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Attendance %</td>
                          <td>{attendanceSummary.overall.rate == null ? "N/A" : `${attendanceSummary.overall.rate.toFixed(2)}%`}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-rate`}>{m.stats.rate == null ? "N/A" : `${m.stats.rate.toFixed(2)}%`}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Total Days</td>
                          <td>{attendanceSummary.overall.total || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-total`}>{m.stats.total || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Present (Days)</td>
                          <td>{attendanceSummary.overall.present || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-present`}>{m.stats.present || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Late/Left early (Days)</td>
                          <td>{attendanceSummary.overall.late || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-late`}>{m.stats.late || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Excused Absence (Days)</td>
                          <td>{attendanceSummary.overall.excused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-excused`}>{m.stats.excused || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Unexcused Absence (Days)</td>
                          <td>{attendanceSummary.overall.unexcused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-unexcused`}>{m.stats.unexcused || "-"}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                    <table className="admin-table" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Status</th>
                          <th>Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredStudentAttendance.map((r, idx) => (
                          <tr key={`att-row-${idx}`}>
                            <td>{`${formatDateShort(r.day_date)} (${formatWeekday(r.day_date)})`}</td>
                            <td>{r.status}</td>
                            <td>{r.comment}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-msg">{studentAttendanceMsg}</div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "sheet" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="admin-title">Attendance Sheet</div>
              <div className="admin-subtitle">P / L / E / A を日別で管理します。</div>
            </div>
          </div>

          <div className="attendance-control-row" style={{ marginTop: 10 }}>
            <div className="admin-form">
              <div className="field">
                <label>Date</label>
                <input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                />
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button className="btn btn-primary" type="button" onClick={() => openAttendanceDay(attendanceDate)}>
                  Open Day
                </button>
              </div>
            </div>

            <div className="admin-form attendance-filter-box">
            <div className="field small">
              <label>Filter (Rate &lt;)</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 80"
                value={attendanceFilter.minRate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minRate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Filter (Unexcused ≥)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 3"
                value={attendanceFilter.minAbsences}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minAbsences: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Range From</label>
              <input
                type="date"
                value={attendanceFilter.startDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Range To</label>
              <input
                type="date"
                value={attendanceFilter.endDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, endDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button
                className="btn"
                type="button"
                onClick={() => setAttendanceFilter({ minRate: "", minAbsences: "", startDate: "", endDate: "" })}
              >
                Clear Filter
              </button>
            </div>
            </div>
          </div>

          <div className="attendance-table-header">
            <div className="admin-help">
              <span className="att-legend-item att-legend-present">P: Present</span>
              <span className="att-legend-item att-legend-late">L: Late/Leave Early</span>
              <span className="att-legend-item att-legend-excused">E: Excused Absence</span>
              <span className="att-legend-item att-legend-absent">A: Unexcused Absence</span>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table attendance-table">
              <thead>
                <tr>
                  <th className="att-col-code att-sticky-1">ID</th>
                  <th className="att-col-name att-sticky-2">Student Name</th>
                  <th className="att-col-rate att-sticky-3">Attendance<br />Rate</th>
                  <th className="att-col-absent att-sticky-4">Unexcused<br />Absence</th>
                  {attendanceDayColumns.map((d) => (
                    <th key={d.id}>
                      <button className="link-btn" onClick={() => openAttendanceDay(d.day_date)}>
                        {d.label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attendanceFilteredStudents.map((s) => {
                  const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
                  const total = perDay.filter(Boolean).length;
                  const present = perDay.filter((v) => v === "P" || v === "L").length;
                  const absences = perDay.filter((v) => v === "A").length;
                  const rate = total ? (present / total) * 100 : 0;
                  return (
                    <tr key={s.id}>
                      <td className="att-col-code att-sticky-1">{s.student_code ?? ""}</td>
                      <td className="att-col-name att-sticky-2">{s.display_name ?? s.email ?? s.id}</td>
                      <td className="att-col-rate att-sticky-3">{rate.toFixed(2)}%</td>
                      <td className="att-col-absent att-sticky-4">{absences}</td>
                      {attendanceDayColumns.map((d) => {
                        const status = attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "";
                        return (
                          <td key={`${s.id}-${d.id}`} className={`att-cell ${status ? `att-${status}` : ""}`}>
                            {status || ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{attendanceMsg}</div>
        </div>
        ) : null}

        {activeTab === "announcements" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Announcements</div>
              <div className="admin-subtitle">Create announcements and send them to students.</div>
            </div>
            <button className="btn" onClick={() => fetchAnnouncements()}>Refresh</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Title</label>
              <input
                value={announcementForm.title}
                onChange={(e) => setAnnouncementForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Announcement title"
              />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Message</label>
              <textarea
                value={announcementForm.body}
                onChange={(e) => setAnnouncementForm((s) => ({ ...s, body: e.target.value }))}
                placeholder="Write your message here..."
                rows={4}
              />
            </div>
            <div className="field small">
              <label>Publish At</label>
              <input
                type="datetime-local"
                step="300"
                value={announcementForm.publish_at}
                onChange={(e) => setAnnouncementForm((s) => ({ ...s, publish_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>End At</label>
              <input
                type="datetime-local"
                step="300"
                value={announcementForm.end_at}
                onChange={(e) => setAnnouncementForm((s) => ({ ...s, end_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={createAnnouncement}>
                Create Announcement
              </button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Title</th>
                  <th>Message</th>
                  <th>Publish At</th>
                  <th>End At</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {announcements.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          value={editingAnnouncementForm.title}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, title: e.target.value }))}
                        />
                      ) : (
                        a.title
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <textarea
                          value={editingAnnouncementForm.body}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, body: e.target.value }))}
                          rows={3}
                        />
                      ) : (
                        a.body
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingAnnouncementForm.publish_at}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, publish_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(a.publish_at)
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingAnnouncementForm.end_at}
                          onChange={(e) => setEditingAnnouncementForm((s) => ({ ...s, end_at: e.target.value }))}
                        />
                      ) : (
                        a.end_at ? formatDateTime(a.end_at) : ""
                      )}
                    </td>
                    <td>
                      {editingAnnouncementId === a.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-primary" onClick={saveAnnouncementEdits}>
                            Save
                          </button>
                          <button className="btn" onClick={cancelEditAnnouncement}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn" onClick={() => startEditAnnouncement(a)}>
                          Edit
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-danger" onClick={() => deleteAnnouncement(a.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{announcementMsg}</div>
        </div>
        ) : null}

        {activeTab === "attendance" && attendanceSubTab === "absence" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Absence Applications</div>
              <div className="admin-subtitle">Review and approve/deny student applications.</div>
            </div>
            <button className="btn" onClick={() => fetchAbsenceApplications()}>Refresh</button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Student</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Reason</th>
                  <th>Catch Up</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {absenceApplications.map((a) => {
                  const student = a.profiles || {};
                  const name = student.display_name || student.email || a.student_id;
                  const code = student.student_code ? ` (${student.student_code})` : "";
                  const typeLabel = a.type === "excused" ? "Excused Absence" : "Late/Leave Early";
                  const timeLabel =
                    a.type === "late"
                      ? `${a.late_type === "leave_early" ? "Leave" : "Arrive"}: ${a.time_value || "-"}`
                      : "";
                  return (
                    <tr key={a.id}>
                      <td>{formatDateTime(a.created_at)}</td>
                      <td>{name}{code}</td>
                      <td>{typeLabel}</td>
                      <td>{a.day_date}</td>
                      <td>{timeLabel}</td>
                      <td>{a.reason || ""}</td>
                      <td>{a.catch_up || ""}</td>
                      <td>{a.status}</td>
                      <td>
                        {a.status === "pending" ? (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button className="btn btn-primary" onClick={() => decideAbsenceApplication(a.id, "approved")}>
                              Approve
                            </button>
                            <button className="btn btn-danger" onClick={() => decideAbsenceApplication(a.id, "denied")}>
                              Deny
                            </button>
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{absenceApplicationsMsg}</div>
        </div>
        ) : null}

        {activeTab === "model" ? (
        <>
        {modelSubTab === "conduct" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Test Sessions</div>
              <div className="admin-subtitle">Problem Setから実施テストを作成します。</div>
            </div>
            <button
              className="btn"
              onClick={() => {
                fetchTestSessions();
                fetchExamLinks();
              }}
            >
              Refresh Sessions
            </button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Category</label>
              <select
                value={modelConductCategory}
                onChange={(e) => setModelConductCategory(e.target.value)}
              >
                {modelCategories.length ? (
                  modelCategories.map((c) => (
                    <option key={`model-cat-${c.name}`} value={c.name}>
                      {c.name}
                    </option>
                  ))
                ) : (
                  <option value="">No categories</option>
                )}
              </select>
            </div>
            <div className="field">
              <label>Problem Set</label>
              <select
                value={testSessionForm.problem_set_id}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
              >
                {modelConductTests.length ? (
                  modelConductTests.map((t) => (
                    <option key={`ps-${t.version}`} value={t.version}>
                      {t.version}
                    </option>
                  ))
                ) : (
                  <option value="">No problem sets</option>
                )}
              </select>
            </div>
            <div className="field">
              <label>Title</label>
              <input
                value={testSessionForm.title}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Mock Test (Retake)"
              />
            </div>
            <div className="field small">
              <label>Starts At</label>
              <input
                type="datetime-local"
                step="300"
                value={testSessionForm.starts_at}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Ends At</label>
              <input
                type="datetime-local"
                step="300"
                value={testSessionForm.ends_at}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Time Limit (min)</label>
              <input
                value={testSessionForm.time_limit_min}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                placeholder="60"
              />
            </div>
            <div className="field small">
              <label>Show Answers</label>
              <select
                value={testSessionForm.show_answers ? "yes" : "no"}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="field small">
              <label>Attempts</label>
              <select
                value={testSessionForm.allow_multiple_attempts ? "multiple" : "once"}
                onChange={(e) =>
                  setTestSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                }
              >
                <option value="once">Only once</option>
                <option value="multiple">Allow multiple</option>
              </select>
            </div>
            <div className="field small">
              <label>Pass Rate</label>
              <input
                value={testSessionForm.pass_rate}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                placeholder="0.8"
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={createTestSession}>
                Create Session
              </button>
            </div>
          </div>

          <div className="admin-help" style={{ marginTop: 6 }}>
            Student Base URL: <b>{getStudentBaseUrl() || "Not set"}</b>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Title</th>
                  <th>Problem Set</th>
                  <th>Show Answers</th>
                  <th>Attempts</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Time (min)</th>
                  <th>Pass Rate</th>
                  <th>Action</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {modelSessions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.title}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, title: e.target.value }))}
                        />
                      ) : (
                        t.title ?? ""
                      )}
                    </td>
                    <td>{t.problem_set_id ?? ""}</td>
                    <td>
                      {editingSessionId === t.id ? (
                        <select
                          value={editingSessionForm.show_answers ? "yes" : "no"}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ) : (
                        t.show_answers ? "Yes" : "No"
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <select
                          value={editingSessionForm.allow_multiple_attempts ? "multiple" : "once"}
                          onChange={(e) =>
                            setEditingSessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                          }
                        >
                          <option value="once">Only once</option>
                          <option value="multiple">Allow multiple</option>
                        </select>
                      ) : (
                        t.allow_multiple_attempts === false ? "Only once" : "Allow multiple"
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingSessionForm.starts_at}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(t.starts_at)
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingSessionForm.ends_at}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(t.ends_at)
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.time_limit_min}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                        />
                      ) : (
                        t.time_limit_min ?? ""
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.pass_rate}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                        />
                      ) : (
                        testPassRateByVersion[t.problem_set_id] != null
                          ? `${Number(testPassRateByVersion[t.problem_set_id]) * 100}%`
                          : ""
                      )}
                    </td>
                    <td>
                      {linkBySession[t.id]?.id ? (
                        <button className="btn" onClick={() => copyLink(linkBySession[t.id].id)}>Copy URL</button>
                      ) : (
                        ""
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-primary" onClick={saveSessionEdits}>
                            Save
                          </button>
                          <button className="btn" onClick={cancelEditSession}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn" onClick={() => startEditSession(t)}>
                          Edit
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-danger" onClick={() => deleteTestSession(t.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{testSessionsMsg}</div>
          <div className="admin-msg">{linkMsg}</div>
          {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
        </div>

        ) : null}

        {modelSubTab === "upload" ? (
        <>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Problem Set Upload (CSV)</div>
              <div className="admin-subtitle">CSVとAssetsをアップロードし、問題セットを登録します（タイトルはTest Sessionで設定）。</div>
            </div>
            <button className="btn" onClick={() => fetchAssets()}>Refresh</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Problem Set ID</label>
              <input
                value={assetForm.test_version}
                onChange={(e) => setAssetForm((s) => ({ ...s, test_version: e.target.value }))}
                placeholder="problem_set_v1"
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                value={assetCategorySelect}
                onChange={(e) => {
                  const next = e.target.value;
                  setAssetCategorySelect(next);
                  if (next !== "__custom__") {
                    setAssetForm((s) => ({ ...s, category: next }));
                  }
                }}
              >
                {(modelCategories.length ? modelCategories : [{ name: DEFAULT_MODEL_CATEGORY }]).map((c) => (
                  <option key={`asset-cat-${c.name}`} value={c.name}>{c.name}</option>
                ))}
                <option value="__custom__">Custom...</option>
              </select>
              {assetCategorySelect === "__custom__" ? (
                <input
                  value={assetForm.category}
                  onChange={(e) => setAssetForm((s) => ({ ...s, category: e.target.value }))}
                  placeholder="Book Review"
                  style={{ marginTop: 6 }}
                />
              ) : null}
            </div>
            <div className="field">
              <label>CSV File (required)</label>
              <input
                type="file"
                accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setAssetFile(file);
                  if (file && file.name.toLowerCase().endsWith(".csv")) {
                    setAssetCsvFile(file);
                    if (!assetForm.test_version) {
                      file.text().then((text) => {
                        const detected = detectTestVersionFromCsvText(text);
                        if (detected) {
                          setAssetForm((s) => ({ ...s, test_version: detected }));
                        }
                      });
                    }
                  }
                }}
              />
              {assetCsvFile ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  CSV ready: {assetCsvFile.name}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label>Folder (PNG/MP3)</label>
              <input
                type="file"
                multiple
                webkitdirectory="true"
                directory="true"
                accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setAssetFiles(files);
                  const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
                  if (csvFile) {
                    setAssetCsvFile(csvFile);
                    if (!assetForm.test_version) {
                      csvFile.text().then((text) => {
                        const detected = detectTestVersionFromCsvText(text);
                        if (detected) {
                          setAssetForm((s) => ({ ...s, test_version: detected }));
                        }
                      });
                    }
                  }
                }}
              />
              {assetFiles.length ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  Selected: {assetFiles.length} files
                </div>
              ) : null}
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={uploadAssets}>
                Upload & Register Problem Set
              </button>
            </div>
          </div>

          <div className="admin-help" style={{ marginTop: 6 }}>
            Bucket: <b>test-assets</b> / CSV, PNG, MP3 (他拡張子もOK)
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            Upload &amp; Register Problem SetでCSV/PNG/MP3をアップロードします。
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            CSVにはファイル名のみ記載してください。
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            ※ `/images/...` や `/audio/...` などのパスは無効です。
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            CSV format: <code>docs/question_csv.md</code>
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            Template: <a href="/question_csv_template.csv" download>question_csv_template.csv</a>
          </div>
          <div className="admin-msg">{assetUploadMsg}</div>
          {assetImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {assetImportMsg}
            </pre>
          ) : null}
          <div className="admin-msg">{assetsMsg}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Problem Sets</div>
              <div className="admin-subtitle">問題セット（CSV/Assets）の一覧です。</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={modelUploadCategory}
                onChange={(e) => setModelUploadCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {modelCategories.map((c) => (
                  <option key={`model-upload-cat-${c.name}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => fetchTests()}>Refresh Problem Sets</button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Problem Set ID</th>
                  <th>Category</th>
                  <th>Questions</th>
                  <th>Preview</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filteredModelUploadTests.map((t) => (
                  <tr
                    key={t.id}
                    onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                  >
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      {editingTestId === t.id ? (
                        <input
                          value={editingTestForm.version}
                          onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                        />
                      ) : (
                        t.version ?? ""
                      )}
                    </td>
                    <td>
                      {editingTestId === t.id ? (
                        <>
                          <select
                            value={editingCategorySelect}
                            onChange={(e) => {
                              const next = e.target.value;
                              setEditingCategorySelect(next);
                              if (next !== "__custom__") {
                                setEditingTestForm((s) => ({ ...s, title: next }));
                              }
                            }}
                          >
                            {modelCategories.map((c) => (
                              <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                            ))}
                            <option value="__custom__">Custom...</option>
                          </select>
                          {editingCategorySelect === "__custom__" ? (
                            <input
                              value={editingTestForm.title}
                              onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                              placeholder="Grammar Review"
                              style={{ marginTop: 6 }}
                            />
                          ) : null}
                        </>
                      ) : (
                        t.title ?? ""
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(t.version);
                        }}
                      >
                        Preview
                      </button>
                    </td>
                    <td>
                      {editingTestId === t.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveTestEdits(modelCategories);
                            }}
                          >
                            Save
                          </button>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditTest();
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditTest(t, modelCategories);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTest(t.version);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          <div className="admin-msg">{testsMsg}</div>
        </div>
        </>
        ) : null}
        </>
        ) : null}

        {activeTab === "daily" ? (
        <>
        {dailySubTab === "conduct" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Daily Test Sessions</div>
              <div className="admin-subtitle">Daily Testの実施テストを作成します。</div>
            </div>
            <button
              className="btn"
              onClick={() => {
                fetchTestSessions();
                fetchExamLinks();
              }}
            >
              Refresh Sessions
            </button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Category</label>
              <select
                value={dailyConductCategory}
                onChange={(e) => setDailyConductCategory(e.target.value)}
              >
                {dailyCategories.length ? (
                  dailyCategories.map((c) => (
                    <option key={`daily-cat-${c.name}`} value={c.name}>
                      {c.name}
                    </option>
                  ))
                ) : (
                  <option value="">No categories</option>
                )}
              </select>
            </div>
            <div className="field">
              <label>Problem Set</label>
              <select
                value={dailySessionForm.problem_set_id}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
              >
                {dailyConductTests.length ? (
                  dailyConductTests.map((t) => (
                    <option key={`daily-ps-${t.version}`} value={t.version}>
                      {(t.title ? `${t.title} (${t.version})` : t.version)}
                    </option>
                  ))
                ) : (
                  <option value="">No daily tests</option>
                )}
              </select>
            </div>
            <div className="field">
              <label>Title</label>
              <input
                value={dailySessionForm.title}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Daily Test"
              />
            </div>
            <div className="field small">
              <label>Starts At</label>
              <input
                type="datetime-local"
                step="300"
                value={dailySessionForm.starts_at}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, starts_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Ends At</label>
              <input
                type="datetime-local"
                step="300"
                value={dailySessionForm.ends_at}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, ends_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Time Limit (min)</label>
              <input
                value={dailySessionForm.time_limit_min}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                placeholder="10"
              />
            </div>
            <div className="field small">
              <label>Show Answers</label>
              <select
                value={dailySessionForm.show_answers ? "yes" : "no"}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
            <div className="field small">
              <label>Attempts</label>
              <select
                value={dailySessionForm.allow_multiple_attempts ? "multiple" : "once"}
                onChange={(e) =>
                  setDailySessionForm((s) => ({ ...s, allow_multiple_attempts: e.target.value === "multiple" }))
                }
              >
                <option value="once">Only once</option>
                <option value="multiple">Allow multiple</option>
              </select>
            </div>
            <div className="field small">
              <label>Pass Rate</label>
              <input
                value={dailySessionForm.pass_rate}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                placeholder="0.8"
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={createDailySession}>
                Create Session
              </button>
            </div>
          </div>

          <div className="admin-help" style={{ marginTop: 6 }}>
            Student Base URL: <b>{getStudentBaseUrl() || "Not set"}</b>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Title</th>
                  <th>Problem Set</th>
                  <th>Show Answers</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Time (min)</th>
                  <th>Pass Rate</th>
                  <th>Action</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {dailySessions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.title}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, title: e.target.value }))}
                        />
                      ) : (
                        t.title ?? ""
                      )}
                    </td>
                    <td>{t.problem_set_id ?? ""}</td>
                    <td>
                      {editingSessionId === t.id ? (
                        <select
                          value={editingSessionForm.show_answers ? "yes" : "no"}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, show_answers: e.target.value === "yes" }))}
                        >
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      ) : (
                        t.show_answers ? "Yes" : "No"
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingSessionForm.starts_at}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(t.starts_at)
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          type="datetime-local"
                          step="300"
                          value={editingSessionForm.ends_at}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
                        />
                      ) : (
                        formatDateTime(t.ends_at)
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.time_limit_min}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, time_limit_min: e.target.value }))}
                        />
                      ) : (
                        t.time_limit_min ?? ""
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <input
                          value={editingSessionForm.pass_rate}
                          onChange={(e) => setEditingSessionForm((s) => ({ ...s, pass_rate: e.target.value }))}
                        />
                      ) : (
                        testPassRateByVersion[t.problem_set_id] != null
                          ? `${Number(testPassRateByVersion[t.problem_set_id]) * 100}%`
                          : ""
                      )}
                    </td>
                    <td>
                      {linkBySession[t.id]?.id ? (
                        <button className="btn" onClick={() => copyLink(linkBySession[t.id].id)}>Copy URL</button>
                      ) : (
                        ""
                      )}
                    </td>
                    <td>
                      {editingSessionId === t.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-primary" onClick={saveSessionEdits}>
                            Save
                          </button>
                          <button className="btn" onClick={cancelEditSession}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn" onClick={() => startEditSession(t)}>
                          Edit
                        </button>
                      )}
                    </td>
                    <td>
                      <button className="btn btn-danger" onClick={() => deleteTestSession(t.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{dailySessionsMsg}</div>
          <div className="admin-msg">{linkMsg}</div>
          {editingSessionMsg ? <div className="admin-msg">{editingSessionMsg}</div> : null}
        </div>

        ) : null}

        {dailySubTab === "upload" ? (
        <>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Daily Test Upload (CSV)</div>
              <div className="admin-subtitle">Daily Test用CSVとIllustrationをアップロードします。</div>
            </div>
            <button className="btn" onClick={() => fetchAssets()}>Refresh</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>TestID</label>
              <input
                value={dailyForm.test_version}
                onChange={(e) => setDailyForm((s) => ({ ...s, test_version: e.target.value }))}
                placeholder="daily_vocab_01"
              />
            </div>
            <div className="field">
              <label>Category</label>
              {dailyCategories.length ? (
                <>
                  <select
                    value={dailyCategorySelect}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDailyCategorySelect(next);
                      if (next !== "__custom__") {
                        setDailyForm((s) => ({ ...s, category: next }));
                      }
                    }}
                  >
                    {dailyCategories.map((c) => (
                      <option key={`daily-cat-${c.name}`} value={c.name}>{c.name}</option>
                    ))}
                    <option value="__custom__">Custom...</option>
                  </select>
                  {dailyCategorySelect === "__custom__" ? (
                    <input
                      value={dailyForm.category}
                      onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                      placeholder="Vocabulary Test"
                      style={{ marginTop: 6 }}
                    />
                  ) : null}
                </>
              ) : (
                <input
                  value={dailyForm.category}
                  onChange={(e) => setDailyForm((s) => ({ ...s, category: e.target.value }))}
                  placeholder="Vocabulary Test"
                />
              )}
            </div>
            <div className="field">
              <label>CSV File (required)</label>
              <input
                type="file"
                accept=".csv,.tsv"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setDailyFile(file);
                  if (file && (file.name.toLowerCase().endsWith(".csv") || file.name.toLowerCase().endsWith(".tsv"))) {
                    setDailyCsvFile(file);
                    if (!dailyForm.test_version) {
                      file.text().then((text) => {
                        const detected = detectDailyTestIdFromCsvText(text);
                        if (detected) {
                          setDailyForm((s) => ({ ...s, test_version: detected }));
                        }
                      });
                    }
                  }
                }}
              />
              {dailyCsvFile ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  CSV ready: {dailyCsvFile.name}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label>Folder (PNG)</label>
              <input
                type="file"
                multiple
                webkitdirectory="true"
                directory="true"
                accept=".csv,.tsv,.png,.jpg,.jpeg,.webp"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setDailyFiles(files);
                  const csvFile = files.find((f) => f.name.toLowerCase().endsWith(".csv") || f.name.toLowerCase().endsWith(".tsv"));
                  if (csvFile) {
                    setDailyCsvFile(csvFile);
                    if (!dailyForm.test_version) {
                      csvFile.text().then((text) => {
                        const detected = detectDailyTestIdFromCsvText(text);
                        if (detected) {
                          setDailyForm((s) => ({ ...s, test_version: detected }));
                        }
                      });
                    }
                  }
                }}
              />
              {dailyFiles.length ? (
                <div className="admin-help" style={{ marginTop: 4 }}>
                  Selected: {dailyFiles.length} files
                </div>
              ) : null}
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={uploadDailyAssets}>
                Upload & Register Daily Test
              </button>
            </div>
          </div>

          <div className="admin-help" style={{ marginTop: 6 }}>
            Bucket: <b>test-assets</b> / CSV, PNG
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            CSV header: <code>TestID, No., Question, Correct Answer, Wrong Option 1, Wrong Option 2, Wrong Option 3, Target, Can-do, Illustration, Description</code>
          </div>
          <div className="admin-msg">{dailyUploadMsg}</div>
          {dailyImportMsg ? (
            <pre className="admin-msg" style={{ whiteSpace: "pre-wrap" }}>
              {dailyImportMsg}
            </pre>
          ) : null}
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Daily Tests</div>
              <div className="admin-subtitle">Daily Test（CSV/Assets）の一覧です。</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={dailyUploadCategory}
                onChange={(e) => setDailyUploadCategory(e.target.value)}
              >
                <option value="">All Categories</option>
                {dailyCategories.map((c) => (
                  <option key={`daily-upload-cat-${c.name}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={() => fetchTests()}>Refresh Daily Tests</button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Category</th>
                  <th>Test ID</th>
                  <th>Questions</th>
                  <th>Preview</th>
                  <th>Edit</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {filteredDailyUploadTests.map((t) => (
                  <tr
                    key={t.id}
                    onClick={editingTestId === t.id ? undefined : () => openPreview(t.version)}
                  >
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>
                      {editingTestId === t.id ? (
                        <>
                          <select
                            value={editingCategorySelect}
                            onChange={(e) => {
                              const next = e.target.value;
                              setEditingCategorySelect(next);
                              if (next !== "__custom__") {
                                setEditingTestForm((s) => ({ ...s, title: next }));
                              }
                            }}
                          >
                            {dailyCategories.map((c) => (
                              <option key={`edit-cat-${c.name}`} value={c.name}>{c.name}</option>
                            ))}
                            <option value="__custom__">Custom...</option>
                          </select>
                          {editingCategorySelect === "__custom__" ? (
                            <input
                              value={editingTestForm.title}
                              onChange={(e) => setEditingTestForm((s) => ({ ...s, title: e.target.value }))}
                              placeholder="Vocabulary Test"
                              style={{ marginTop: 6 }}
                            />
                          ) : null}
                        </>
                      ) : (
                        t.title ?? ""
                      )}
                    </td>
                    <td>
                      {editingTestId === t.id ? (
                        <input
                          value={editingTestForm.version}
                          onChange={(e) => setEditingTestForm((s) => ({ ...s, version: e.target.value }))}
                        />
                      ) : (
                        t.version ?? ""
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPreview(t.version);
                        }}
                      >
                        Preview
                      </button>
                    </td>
                    <td>
                      {editingTestId === t.id ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-primary"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveTestEdits(dailyCategories);
                            }}
                          >
                            Save
                          </button>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditTest();
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditTest(t, dailyCategories);
                          }}
                        >
                          Edit
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTest(t.version);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editingTestMsg ? <div className="admin-msg">{editingTestMsg}</div> : null}
          <div className="admin-msg">{testsMsg}</div>
        </div>
        </>
        ) : null}

        </>
        ) : null}

        {reissueOpen && reissueStudent ? (
          <div
            className="admin-modal-overlay"
            onClick={() => {
              setReissueOpen(false);
              setReissueStudent(null);
              setReissuePassword("");
              setReissueIssuedPassword("");
              setReissueLoading(false);
              setReissueMsg("");
            }}
          >
            <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Reissue Temp Password</div>
                <button
                  className="btn"
                  onClick={() => {
                    setReissueOpen(false);
                    setReissueStudent(null);
                    setReissuePassword("");
                    setReissueIssuedPassword("");
                    setReissueLoading(false);
                    setReissueMsg("");
                  }}
                >
                  Close
                </button>
              </div>
              <div className="admin-help" style={{ marginTop: 6 }}>
                {reissueStudent.display_name ?? ""} {reissueStudent.student_code ? `(${reissueStudent.student_code})` : ""}
              </div>
              <div className="admin-help">{reissueStudent.email ?? reissueStudent.id}</div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Temp Password</label>
                  <input
                    value={reissuePassword}
                    onChange={(e) => setReissuePassword(e.target.value)}
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setReissuePassword(generateTempPassword())}
                  >
                    Generate
                  </button>
                </div>
              </div>

              {reissueMsg ? <div className="admin-msg">{reissueMsg}</div> : null}

              {reissueIssuedPassword ? (
                <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(reissueIssuedPassword);
                        setReissueMsg("Copied to clipboard.");
                      } catch {
                        setReissueMsg("Copy failed. Please copy manually.");
                      }
                    }}
                  >
                    Copy to Clipboard
                  </button>
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  className="btn btn-primary"
                  onClick={() => reissueTempPassword(reissueStudent, reissuePassword.trim())}
                  disabled={reissueLoading}
                >
                  {reissueLoading ? "Generating..." : "Reissue Temp Password"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {inviteOpen ? (
          <div
            className="admin-modal-overlay"
            onClick={() => setInviteOpen(false)}
          >
            <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div className="admin-title">Add New Student</div>
                <button className="admin-modal-close" onClick={() => setInviteOpen(false)} aria-label="Close">
                  &times;
                </button>
              </div>
              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field">
                  <label>Email</label>
                  <input
                    value={inviteForm.email}
                    onChange={(e) => setInviteForm((s) => ({ ...s, email: e.target.value }))}
                    placeholder="student@example.com"
                  />
                </div>
                <div className="field">
                  <label>Name</label>
                  <input
                    value={inviteForm.display_name}
                    onChange={(e) => setInviteForm((s) => ({ ...s, display_name: e.target.value }))}
                    placeholder="Taro"
                  />
                </div>
                <div className="field small">
                  <label>Code</label>
                  <input
                    value={inviteForm.student_code}
                    onChange={(e) => setInviteForm((s) => ({ ...s, student_code: e.target.value }))}
                    placeholder="ID001"
                  />
                </div>
                <div className="field small">
                  <label>Temp Password</label>
                  <input
                    value={inviteForm.temp_password}
                    onChange={(e) => setInviteForm((s) => ({ ...s, temp_password: e.target.value }))}
                    placeholder="(optional)"
                  />
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setInviteForm((s) => ({ ...s, temp_password: generateTempPassword() }))}
                  >
                    Generate
                  </button>
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={async () => {
                      const ok = await inviteStudents(inviteForm);
                      if (ok) setInviteOpen(false);
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
              {studentMsg ? <div className="admin-msg">{studentMsg}</div> : null}
              {inviteResults.length ? (
                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table" style={{ minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>OK</th>
                        <th>User ID</th>
                        <th>Error/Warning</th>
                        <th>Temp Password</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inviteResults.map((r, idx) => (
                        <tr key={`${r.email}-${idx}`}>
                          <td>{r.email}</td>
                          <td style={{ textAlign: "center" }}>{r.ok ? "OK" : "NG"}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.user_id ?? ""}</td>
                          <td>{r.error ?? r.warning ?? ""}</td>
                          <td>{r.temp_password ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {attendanceModalOpen && attendanceModalDay ? (
          <div
            className="admin-modal-overlay"
            onClick={() => {
              setAttendanceModalOpen(false);
              setAttendanceModalDay(null);
              setAttendanceDraft({});
              setAttendanceSaving(false);
            }}
          >
            <div className="admin-modal attendance-modal" onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal-header">
                <div>
                  <div className="admin-title">Attendance — {attendanceModalDay.day_date}</div>
                </div>
                <button
                  className="btn"
                  onClick={() => {
                    setAttendanceModalOpen(false);
                    setAttendanceModalDay(null);
                    setAttendanceDraft({});
                    setAttendanceSaving(false);
                  }}
                >
                  Close
                </button>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10, maxHeight: "60vh" }}>
                <table className="admin-table attendance-modal-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Student</th>
                      <th>Present</th>
                      <th>Late/Leave Early</th>
                      <th>Excused Absence</th>
                      <th>Unexcused Absence</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStudents.map((s) => {
                      const entry = attendanceDraft?.[s.id] || { status: "", comment: "" };
                      const approved = approvedAbsenceByStudent?.[s.id];
                      return (
                        <tr key={`att-${s.id}`}>
                          <td>{s.student_code ?? ""}</td>
                          <td>
                            {s.display_name ?? s.email ?? s.id}
                            {approved ? (
                              <div className={`admin-help att-approved-note ${approved.type === "excused" ? "excused" : "late"}`} style={{ marginTop: 4 }}>
                                Approved {approved.type === "excused" ? "Excused Absence" : "Late/Leave Early"}
                                {approved.time_value ? ` (${approved.time_value})` : ""}
                              </div>
                            ) : null}
                          </td>
                          {["P", "L", "E", "A"].map((code) => (
                            <td key={`${s.id}-${code}`}>
                              <button
                                className={`att-status-btn ${entry.status === code ? "active" : ""} att-${code}`}
                                type="button"
                                onClick={() =>
                                  setAttendanceDraft((prev) => ({
                                    ...prev,
                                    [s.id]: { ...entry, status: code }
                                  }))
                                }
                              >
                                {code}
                              </button>
                            </td>
                          ))}
                          <td>
                            <input
                              value={entry.comment || ""}
                              onChange={(e) =>
                                setAttendanceDraft((prev) => ({
                                  ...prev,
                                  [s.id]: { ...entry, comment: e.target.value }
                                }))
                              }
                              placeholder="(optional)"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={saveAttendanceDay} disabled={attendanceSaving}>
                  {attendanceSaving ? "Saving..." : "Save Attendance"}
                </button>
                <button className="btn btn-danger" onClick={() => deleteAttendanceDay(attendanceModalDay)}>
                  Delete Day
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {resultContext ? (
        <>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="admin-title">{resultContext.title}</div>
              <div className="admin-subtitle">受験結果を検索・詳細表示・CSV出力できます。</div>
            </div>
            <div className="admin-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn" onClick={() => runSearch(resultContext.type)}>Refresh</button>
              <button className="btn" onClick={() => exportSummaryCsv(attempts)}>Export CSV (Summary)</button>
              <button className="btn" onClick={() => exportDetailCsv(attempts)}>Export CSV (Detail)</button>
              {resultContext.type === "mock" ? (
                <button className="btn" onClick={() => exportQuizSummaryCsv()}>Export CSV (Quiz Summary)</button>
              ) : null}
            </div>
          </div>
          {quizMsg ? <div className="admin-help">{quizMsg}</div> : null}
        </div>

        {resultContext.type === "daily" || resultContext.type === "mock" ? (
          <>
            {(resultContext.type === "daily" ? dailyCategories : modelCategories).length ? (
              <div className="admin-mini-tabs" style={{ marginBottom: 10 }}>
                {(resultContext.type === "daily" ? dailyCategories : modelCategories).map((c) => (
                  <button
                    key={`daily-cat-${c.name}`}
                    className={`admin-mini-tab ${((resultContext.type === "daily"
                      ? selectedDailyCategory
                      : selectedModelCategory)?.name === c.name)
                      ? "active"
                      : ""}`}
                    onClick={() => {
                      if (resultContext.type === "daily") {
                        setDailyResultsCategory(c.name);
                      } else {
                        setModelResultsCategory(c.name);
                      }
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ) : (
              <div className="admin-msg">No test categories yet.</div>
            )}

            <div className="admin-table-wrap" style={{ marginTop: 10 }}>
              <table
                className="admin-table daily-results-table"
                style={{
                  minWidth: Math.max(
                    860,
                    360 + ((resultContext.type === "daily"
                      ? dailyResultsMatrix.tests.length
                      : modelResultsMatrix.tests.length) || 0) * 140
                  )
                }}
              >
                <thead>
                  <tr>
                    <th className="daily-sticky-1 daily-col-no">Student ID</th>
                    <th className="daily-sticky-2 daily-col-name">Student Name</th>
                    {(resultContext.type === "daily" ? dailyResultsMatrix.tests : modelResultsMatrix.tests).map((t) => (
                      <th key={`daily-col-${t.version}`}>
                        <div className="daily-col-title">{t.version ?? ""}</div>
                        <div className="daily-col-date">{formatDateShort(t.created_at)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(resultContext.type === "daily" ? dailyResultsMatrix.rows : modelResultsMatrix.rows)
                    .filter((row) => !row.student.is_withdrawn)
                    .map((row) => (
                    <tr key={`daily-row-${row.student.id}`}>
                      <td className="daily-sticky-1 daily-col-no">{row.student.student_code ?? ""}</td>
                      <td className="daily-sticky-2 daily-col-name">
                        <div className="daily-name">{row.student.display_name ?? ""}</div>
                        <div className="daily-code">{row.student.student_code ?? ""}</div>
                      </td>
                      {row.cells.map((attempt, idx) => {
                        const test = (resultContext.type === "daily"
                          ? dailyResultsMatrix.tests
                          : modelResultsMatrix.tests)[idx];
                        if (!attempt) return <td key={`daily-cell-${row.student.id}-${idx}`}>—</td>;
                        const rateValue = getScoreRate(attempt);
                        const label = `${(rateValue * 100).toFixed(1)}%`;
                        const passRate = Number(test?.pass_rate ?? 0);
                        const isLow = Number.isFinite(passRate) && passRate > 0 && rateValue < passRate;
                        return (
                          <td
                            key={`daily-cell-${row.student.id}-${idx}`}
                            className="daily-score-cell"
                            onClick={() => openAttemptDetail(attempt)}
                          >
                            <button
                              className={`daily-score-btn ${isLow ? "low" : ""}`}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openAttemptDetail(attempt);
                              }}
                            >
                              {label}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-msg">{loading ? "Loading..." : msg}</div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div className="admin-title">Tests</div>
                  <div className="admin-subtitle">テストを選ぶと結果を絞り込みます。</div>
                </div>
                <button className="btn" onClick={() => applyTestFilter("", resultContext.type)}>Clear Filter</button>
              </div>
              {filters.testVersion ? (
                <div className="admin-help" style={{ marginTop: 6 }}>
                  Filter: <b>{filters.testVersion}</b>
                </div>
              ) : null}
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Problem Set ID</th>
                      <th>Title</th>
                      <th>Questions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultContext.tests.map((t) => (
                      <tr key={`result-test-${t.id}`} onClick={() => applyTestFilter(t.version, resultContext.type)}>
                        <td>{formatDateTime(t.created_at)}</td>
                        <td>{t.version ?? ""}</td>
                        <td>{t.title ?? ""}</td>
                        <td style={{ textAlign: "right" }}>{t.question_count ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch(resultContext.type);
              }}
            >
              <div className="field">
                <label>Student Code（部分一致）</label>
                <input
                  placeholder="ID001"
                  value={filters.code}
                  onChange={(e) => setFilters((s) => ({ ...s, code: e.target.value }))}
                />
              </div>
              <div className="field">
                <label>Display Name（部分一致）</label>
                <input
                  placeholder="Taro"
                  value={filters.name}
                  onChange={(e) => setFilters((s) => ({ ...s, name: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>From（created_at）</label>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>To（created_at）</label>
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters((s) => ({ ...s, to: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Limit</label>
                <select
                  value={filters.limit}
                  onChange={(e) => setFilters((s) => ({ ...s, limit: Number(e.target.value) }))}
                >
                  <option value={50}>50</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button className="btn btn-primary" type="submit">Search</button>
              </div>
            </form>

            <div className="admin-kpi">
              <div className="box">
                <div className="label">Attempts</div>
                <div className="value">{kpi.count}</div>
              </div>
              <div className="box">
                <div className="label">Avg rate</div>
                <div className="value">{(kpi.avgRate * 100).toFixed(1)}%</div>
              </div>
              <div className="box">
                <div className="label">Max rate</div>
                <div className="value">{(kpi.maxRate * 100).toFixed(1)}%</div>
              </div>
            </div>

            <div style={{ marginTop: 12 }} className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Name</th>
                    <th>Code</th>
                    <th>Score</th>
                    <th>Rate</th>
                    <th>Test</th>
                    <th>Attempt ID</th>
                    <th>Detail CSV</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => {
                    const score = `${a.correct}/${a.total}`;
                    const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                    return (
                      <tr
                        key={a.id}
                        onClick={() => {
                          setSelectedId(a.id);
                          setSelectedAttemptObj(null);
                          setAttemptDetailOpen(true);
                        }}
                      >
                        <td>{formatDateTime(a.created_at)}</td>
                        <td>{a.display_name ?? ""}</td>
                        <td>{a.student_code ?? ""}</td>
                        <td>{score}</td>
                        <td>{rate}</td>
                        <td>{a.test_version ?? ""}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{a.id}</td>
                        <td>
                          <button
                            className="btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              exportSelectedAttemptCsv(a);
                            }}
                          >
                            Download
                          </button>
                        </td>
                        <td>
                          <button
                            className="btn btn-danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAttempt(a.id);
                            }}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="admin-msg">{loading ? "Loading..." : msg}</div>
          </>
        )}

        </>
        ) : null}
          </div>

          {previewOpen ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                zIndex: 1000,
                padding: 16,
                overflow: "auto",
              }}
            >
              <div className="admin-panel" style={{ padding: 12, maxWidth: 1100, margin: "0 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div className="admin-title">Preview: {previewTest}</div>
                    <div className="admin-help">正解の選択肢を色で表示します。</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={closePreview}>Exit Preview</button>
                    <button className="btn" onClick={() => deleteTest(previewTest)}>Delete Test</button>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div className="admin-help">
                    Total: <b>{previewQuestions.length}</b>
                  </div>
                  {previewMsg ? <div className="admin-msg">{previewMsg}</div> : null}
                  {!previewMsg && previewQuestions.length === 0 ? (
                    <div className="admin-help" style={{ marginTop: 6 }}>
                      No questions. Upload & Register Problem SetでCSVを取り込むか、CSVの`test_version`がこの問題セットと一致しているか確認してください。
                    </div>
                  ) : null}
                </div>

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
                  {previewQuestions.map((q, idx) => {
                    const prompt = q.promptEn || q.promptBn || "";
                    const choices = q.choices ?? q.choicesJa ?? [];
                    const stemKind = q.stemKind || "";
                    const stemText = q.stemText;
                    const stemExtra = q.stemExtra;
                    const stemAsset = q.stemAsset;
                    const boxText = q.boxText;
                    const isImageStem = ["image", "passage_image", "table_image"].includes(stemKind);
                    const isAudioStem = stemKind === "audio";
                    const shouldShowImage = isImageStem || (!stemKind && isImageAsset(stemAsset));
                    const shouldShowAudio = isAudioStem || (!stemKind && isAudioAsset(stemAsset));
                    const stemLines = splitStemLines(stemExtra);

                    const renderChoices = () => (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                        {choices.map((choice, i) => {
                          const isCorrect = q.answerIndex === i;
                          const isImage = isImageAsset(choice);
                          return (
                            <div
                              key={`c-${i}`}
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
                      <div key={`${q.id}-${idx}`} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "#fff" }}>
                        <div style={{ fontWeight: 700 }}>
                          {q.id} {q.sectionKey ? `(${q.sectionKey})` : ""}
                        </div>
                        {prompt ? <div style={{ marginTop: 6 }}>{prompt}</div> : null}
                        {stemText ? (
                          <div
                            style={{ marginTop: 6 }}
                            dangerouslySetInnerHTML={{ __html: renderUnderlinesHtml(stemText) }}
                          />
                        ) : null}
                        {stemLines.length ? (
                          <div style={{ marginTop: 6 }}>
                            {stemLines.map((line, i2) => (
                              <div
                                key={`line-${i2}`}
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
                        {shouldShowImage && stemAsset ? (
                          <img src={stemAsset} alt="stem" style={{ marginTop: 8, maxWidth: "100%" }} />
                        ) : null}
                        {shouldShowAudio && stemAsset ? (
                          <audio controls src={stemAsset} style={{ marginTop: 8, width: "100%" }} />
                        ) : null}

                        <div style={{ marginTop: 10 }}>
                          {choices.length ? renderChoices() : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          {attemptDetailOpen && selectedAttempt ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.35)",
                zIndex: 1000,
                padding: 16,
                overflow: "auto",
              }}
              onClick={() => {
                setAttemptDetailOpen(false);
                setSelectedAttemptObj(null);
              }}
            >
              <div
                className="admin-panel"
                style={{ padding: 12, maxWidth: 1100, margin: "0 auto", background: "#fff" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div className="admin-title">Attempt Detail</div>
                    <div className="admin-help">
                      <b>{selectedAttempt.display_name ?? ""}</b> ({selectedAttempt.student_code ?? ""})
                      <br />
                      created: {formatDateTime(selectedAttempt.created_at)}
                      <br />
                      score: <b>{selectedAttempt.correct}/{selectedAttempt.total}</b> (
                      {(getScoreRate(selectedAttempt) * 100).toFixed(1)}%)
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => exportSelectedAttemptCsv(selectedAttempt)}
                    >
                      Export CSV
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setAttemptDetailOpen(false);
                        setSelectedAttemptObj(null);
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
                {attemptQuestionsLoading ? <div className="admin-help">Loading questions...</div> : null}
                {attemptQuestionsError ? <div className="admin-msg">{attemptQuestionsError}</div> : null}

                <div className="admin-title" style={{ marginTop: 12 }}>Overview</div>
                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table" style={{ minWidth: 520 }}>
                    <thead>
                      <tr>
                        <th>Section</th>
                        <th>Correct</th>
                        <th>Total</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAttemptSectionSummary.map((s) => (
                        <tr key={`sum-${s.section}`}>
                          <td>{s.section}</td>
                          <td>{s.correct}</td>
                          <td>{s.total}</td>
                          <td>{(s.rate * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                  <table className="admin-table" style={{ minWidth: 860 }}>
                    <thead>
                      <tr>
                        <th>QID</th>
                        <th>Section</th>
                        <th>Prompt</th>
                        <th>Chosen</th>
                        <th>Correct</th>
                        <th>OK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedAttemptRows.map((r) => (
                        <tr key={r.qid}>
                          <td style={{ whiteSpace: "nowrap" }}>{r.qid}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{r.section}</td>
                          <td>
                            <div>{r.prompt}</div>
                            {r.image ? (
                              <img
                                src={r.image}
                                alt="illustration"
                                style={{ marginTop: 6, maxWidth: 220, width: "100%", height: "auto", display: "block" }}
                              />
                            ) : null}
                          </td>
                          <td>{r.chosen}</td>
                          <td>{r.correct}</td>
                          <td style={{ textAlign: "center" }}>{r.isCorrect ? "○" : "×"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
