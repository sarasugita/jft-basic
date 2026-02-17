"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { questions, sections } from "../../../../packages/shared/questions.js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase env vars for admin app.");
}
const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

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

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function formatDateShort(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { month: "2-digit", day: "2-digit" });
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

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
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
  const [modelSubTab, setModelSubTab] = useState("create");
  const [dailySubTab, setDailySubTab] = useState("create");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");
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
  const [studentAttempts, setStudentAttempts] = useState([]);
  const [studentAttemptsMsg, setStudentAttemptsMsg] = useState("");
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
  const [testSessionForm, setTestSessionForm] = useState({
    problem_set_id: "",
    title: "",
    starts_at: "",
    ends_at: "",
    time_limit_min: "",
    is_published: true,
    link_expires_at: "",
    show_answers: true
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
    type: "mock",
    pass_rate: "0.8"
  });
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");
  const [dailyForm, setDailyForm] = useState({
    test_version: "",
    pass_rate: "0.8"
  });
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
    is_published: true,
    link_expires_at: "",
    show_answers: false
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

  const attendanceEntriesByDay = useMemo(() => attendanceEntries || {}, [attendanceEntries]);

  const attendanceDayColumns = useMemo(() => {
    return attendanceDays.map((d) => ({
      ...d,
      label: formatDateShort(d.day_date),
    }));
  }, [attendanceDays]);

  const activeStudents = useMemo(
    () => (students ?? []).filter((s) => !s.is_withdrawn),
    [students]
  );

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
      setSession(data?.session ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

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
      .select("id, role, display_name")
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
  }, [session]);

  useEffect(() => {
    if (!session || profile?.role !== "admin") return;
    fetchExamLinks();
    fetchStudents();
    fetchTests();
    fetchTestSessions();
    fetchAssets();
  }, [session, profile]);

  useEffect(() => {
    if (!session || profile?.role !== "admin") return;
    if (activeTab === "model" && modelSubTab === "results") {
      runSearch("mock");
    }
    if (activeTab === "daily" && dailySubTab === "results") {
      runSearch("daily");
    }
  }, [session, profile, activeTab, modelSubTab, dailySubTab, tests]);

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
        "id, student_id, display_name, student_code, test_version, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
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
    if (activeTab === "attendance") {
      if (!students.length) fetchStudents();
      fetchAttendanceDays();
    }
  }, [activeTab]);

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
    setStudentAttempts(data ?? []);
    setStudentAttemptsMsg(data?.length ? "" : "No attempts.");
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
        setTests(withCounts);
        if (withCounts.length && !testSessionForm.problem_set_id) {
          setTestSessionForm((s) => ({ ...s, problem_set_id: withCounts[0].version }));
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
      setTests(withCounts);
      const firstModel = withCounts.find((t) => t.type === "mock");
      const firstDaily = withCounts.find((t) => t.type === "daily");
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
    setTests(withCounts);
    const firstModel = withCounts.find((t) => t.type === "mock");
    const firstDaily = withCounts.find((t) => t.type === "daily");
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
      .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, created_at")
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
      .order("day_date", { ascending: false })
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
    setAttendanceMsg("");
    setAttendanceModalOpen(true);
    setAttendanceSaving(false);
    const { data, error } = await supabase
      .from("attendance_days")
      .upsert({ day_date: dayDate }, { onConflict: "day_date" })
      .select()
      .single();
    if (error || !data?.id) {
      console.error("attendance day upsert error:", error);
      setAttendanceMsg(`Open day failed: ${error?.message ?? "Unknown error"}`);
      setAttendanceModalOpen(false);
      return;
    }
    const day = data;
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

  async function createTestSession() {
    setTestSessionsMsg("");
    const problemSetId = testSessionForm.problem_set_id.trim();
    const title = testSessionForm.title.trim();
    const linkExpiresAt = testSessionForm.link_expires_at;
    if (!problemSetId) {
      setTestSessionsMsg("Problem Set ID is required.");
      return;
    }
    if (!title) {
      setTestSessionsMsg("Title is required.");
      return;
    }
    if (!linkExpiresAt) {
      setTestSessionsMsg("Link Expires At is required.");
      return;
    }
    const payload = {
      problem_set_id: problemSetId,
      title,
      starts_at: testSessionForm.starts_at ? new Date(testSessionForm.starts_at).toISOString() : null,
      ends_at: testSessionForm.ends_at ? new Date(testSessionForm.ends_at).toISOString() : null,
      time_limit_min: testSessionForm.time_limit_min ? Number(testSessionForm.time_limit_min) : null,
      is_published: Boolean(testSessionForm.is_published),
      show_answers: Boolean(testSessionForm.show_answers)
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("test_sessions insert error:", error);
      setTestSessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: new Date(linkExpiresAt).toISOString()
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
    const linkExpiresAt = dailySessionForm.link_expires_at;
    if (!problemSetId) {
      setDailySessionsMsg("Problem Set ID is required.");
      return;
    }
    if (!title) {
      setDailySessionsMsg("Title is required.");
      return;
    }
    if (!linkExpiresAt) {
      setDailySessionsMsg("Link Expires At is required.");
      return;
    }
    const payload = {
      problem_set_id: problemSetId,
      title,
      starts_at: dailySessionForm.starts_at ? new Date(dailySessionForm.starts_at).toISOString() : null,
      ends_at: dailySessionForm.ends_at ? new Date(dailySessionForm.ends_at).toISOString() : null,
      time_limit_min: dailySessionForm.time_limit_min ? Number(dailySessionForm.time_limit_min) : null,
      is_published: Boolean(dailySessionForm.is_published),
      show_answers: Boolean(dailySessionForm.show_answers)
    };
    const { data: created, error } = await supabase.from("test_sessions").insert(payload).select().single();
    if (error || !created?.id) {
      console.error("daily test_sessions insert error:", error);
      setDailySessionsMsg(`Create failed: ${error.message}`);
      return;
    }
    const { error: linkError } = await supabase.from("exam_links").insert({
      test_session_id: created.id,
      test_version: problemSetId,
      expires_at: new Date(linkExpiresAt).toISOString()
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
      const { error: updateError } = await supabase
        .from("tests")
        .update({ pass_rate: passRate, type, updated_at: new Date().toISOString() })
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
      pass_rate: passRate,
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
      return;
    }
    const { data, error } = await supabase.functions.invoke("invite-students", {
      body: payload,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      console.error("invite-students error:", error);
      setStudentMsg(`Create failed: ${error.message}`);
      return;
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
    const body = { user_id: student.id, email: student.email };
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
      body: { user_id: userId },
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
    const title = testVersion;
    const type = assetForm.type;
    const passRate = Number(assetForm.pass_rate);

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
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setAssetUploadMsg("pass_rate must be between 0 and 1.");
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

    const ensure = await ensureTestRecord(testVersion, title, type, passRate);
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
    const title = "";
    const type = assetForm.type;
    const passRate = Number(assetForm.pass_rate);

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
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setAssetImportMsg("pass_rate must be between 0 and 1.");
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
    const resolvedTitle = resolvedVersion;

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
    const ensure = await ensureTestRecord(resolvedVersion, resolvedTitle, type, passRate);
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
    const passRate = Number(dailyForm.pass_rate);
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
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setDailyUploadMsg("pass_rate must be between 0 and 1.");
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
    const ensure = await ensureTestRecord(testVersion, testVersion, type, passRate);
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
    const type = "daily";
    const passRate = Number(dailyForm.pass_rate);

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
    if (!Number.isFinite(passRate) || passRate <= 0 || passRate > 1) {
      setDailyImportMsg("pass_rate must be between 0 and 1.");
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
    const ensure = await ensureTestRecord(resolvedVersion, resolvedVersion, type, passRate);
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

  if (profile.role !== "admin") {
    return (
      <div className="admin-login">
        <h2>Unauthorized</h2>
        <div className="admin-help">このユーザーは admin 権限ではありません。</div>
        <div className="admin-actions" style={{ marginTop: 14 }}>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-title">Admin</div>
          <div className="admin-brand-sub">JFT Mock</div>
        </div>
        <div className="admin-nav">
          <button
            className={`admin-nav-item ${activeTab === "students" ? "active" : ""}`}
            onClick={() => setActiveTab("students")}
          >
            <span className="admin-nav-dot" />
            Student List
          </button>

          <button
            className={`admin-nav-item ${activeTab === "attendance" ? "active" : ""}`}
            onClick={() => setActiveTab("attendance")}
          >
            <span className="admin-nav-dot" />
            Attendance
          </button>

          <div className={`admin-nav-group ${activeTab === "model" ? "active" : ""}`}>
            <button
              className={`admin-nav-item admin-group-toggle ${activeTab === "model" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("model");
                setModelSubTab("create");
              }}
            >
              <span className="admin-nav-dot" />
              Model Test
              <span className={`admin-nav-arrow ${activeTab === "model" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "model" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${modelSubTab === "create" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("model");
                    setModelSubTab("create");
                  }}
                >
                  Create Tests
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
                setDailySubTab("create");
              }}
            >
              <span className="admin-nav-dot" />
              Daily Test
              <span className={`admin-nav-arrow ${activeTab === "daily" ? "open" : ""}`}>▾</span>
            </button>
            {activeTab === "daily" ? (
              <div className="admin-subnav">
                <button
                  className={`admin-subnav-item ${dailySubTab === "create" ? "active" : ""}`}
                  onClick={() => {
                    setActiveTab("daily");
                    setDailySubTab("create");
                  }}
                >
                  Create Tests
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

          <div className="admin-panel">

        {activeTab === "students" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Students</div>
              <div className="admin-subtitle">一時パスワードで生徒アカウントを作成できます。</div>
            </div>
            <button className="btn" onClick={() => fetchStudents()}>Refresh Students</button>
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
              <label>Display Name</label>
              <input
                value={inviteForm.display_name}
                onChange={(e) => setInviteForm((s) => ({ ...s, display_name: e.target.value }))}
                placeholder="Taro"
              />
            </div>
            <div className="field small">
              <label>Student Code</label>
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
                onClick={() => inviteStudents(inviteForm)}
              >
                Create
              </button>
            </div>
          </div>

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

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Code</th>
                  <th>User ID</th>
                  <th>Temp Password</th>
                  <th>Reissue Password</th>
                  <th>Withdrawn</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => {
                      setSelectedStudentId(s.id);
                      fetchStudentAttempts(s.id);
                    }}
                  >
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>{s.email ?? ""}</td>
                    <td>{s.display_name ?? ""}</td>
                    <td>{s.student_code ?? ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.id}</td>
                    <td>{studentTempMap[s.id] ?? ""}</td>
                    <td>
                      <button
                        className="btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReissueStudent(s);
                          setReissuePassword("");
                          setReissueIssuedPassword("");
                          setReissueLoading(false);
                          setReissueMsg("");
                          setReissueOpen(true);
                        }}
                      >
                        Reissue Password
                      </button>
                    </td>
                    <td>
                      <button
                        className={`btn ${s.is_withdrawn ? "" : "btn-danger"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWithdrawn(s, !s.is_withdrawn);
                        }}
                      >
                        {s.is_withdrawn ? "Undo" : "Withdraw"}
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteStudent(s.id, s.email);
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

          {selectedStudentId ? (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <div className="admin-title">Student Attempts</div>
                  <div className="admin-subtitle">
                    {selectedStudent?.display_name ?? ""} {selectedStudent?.student_code ? `(${selectedStudent.student_code})` : ""}
                  </div>
                </div>
                <button className="btn" onClick={() => fetchStudentAttempts(selectedStudentId)}>Refresh Attempts</button>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th>Created</th>
                      <th>Test</th>
                      <th>Score</th>
                      <th>Rate</th>
                      <th>Attempt ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentAttempts.map((a) => {
                      const score = `${a.correct}/${a.total}`;
                      const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                      return (
                        <tr
                          key={`student-attempt-${a.id}`}
                          onClick={() => {
                            setSelectedAttemptObj(a);
                            setAttemptDetailOpen(true);
                          }}
                        >
                          <td>{formatDateTime(a.created_at)}</td>
                          <td>{getAttemptTitle(a)}</td>
                          <td>{score}</td>
                          <td>{rate}</td>
                          <td style={{ whiteSpace: "nowrap" }}>{a.id}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="admin-msg">{studentAttemptsMsg}</div>
            </div>
          ) : null}

          {inviteResults.length ? (
            <div className="admin-table-wrap" style={{ marginTop: 10 }}>
              <table className="admin-table" style={{ minWidth: 860 }}>
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

          <div className="admin-msg">{studentMsg}</div>
        </div>
        ) : null}

        {activeTab === "attendance" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div className="admin-title">Attendance</div>
              <div className="admin-subtitle">P / L / E / A を日別で管理します。</div>
            </div>
            <button className="btn" onClick={() => fetchAttendanceDays()}>Refresh</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
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

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table attendance-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student Name</th>
                  <th>Attendance Rate</th>
                  <th>Unexcused Absence</th>
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
                {activeStudents.map((s, idx) => {
                  const perDay = attendanceDayColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
                  const total = perDay.filter(Boolean).length;
                  const present = perDay.filter((v) => v === "P").length;
                  const absences = perDay.filter((v) => v === "A").length;
                  const rate = total ? (present / total) * 100 : 0;
                  return (
                    <tr key={s.id}>
                      <td>{idx + 1}</td>
                      <td>{s.display_name ?? s.email ?? s.id}</td>
                      <td>{rate.toFixed(2)}%</td>
                      <td>{absences}</td>
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

        {activeTab === "model" ? (
        <>
        {modelSubTab === "create" ? (
        <>
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
              <label>Problem Set</label>
              <select
                value={testSessionForm.problem_set_id}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
              >
                {modelTests.length ? (
                  modelTests.map((t) => (
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
                value={testSessionForm.starts_at}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, starts_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Ends At</label>
              <input
                type="datetime-local"
                value={testSessionForm.ends_at}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, ends_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Link Expires At</label>
              <input
                type="datetime-local"
                value={testSessionForm.link_expires_at}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, link_expires_at: e.target.value }))}
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
              <label>Published</label>
              <select
                value={testSessionForm.is_published ? "yes" : "no"}
                onChange={(e) => setTestSessionForm((s) => ({ ...s, is_published: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
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
                  <th>Published</th>
                  <th>Show Answers</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Link Expires</th>
                  <th>Time (min)</th>
                  <th>Link ID</th>
                  <th>Action</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {modelSessions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>{t.title ?? ""}</td>
                    <td>{t.problem_set_id ?? ""}</td>
                    <td>{t.is_published ? "Yes" : "No"}</td>
                    <td>{t.show_answers ? "Yes" : "No"}</td>
                    <td>{formatDateTime(t.starts_at)}</td>
                    <td>{formatDateTime(t.ends_at)}</td>
                    <td>{formatDateTime(linkBySession[t.id]?.expires_at)}</td>
                    <td>{t.time_limit_min ?? ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{linkBySession[t.id]?.id ?? ""}</td>
                    <td>
                      {linkBySession[t.id]?.id ? (
                        <button className="btn" onClick={() => copyLink(linkBySession[t.id].id)}>Copy URL</button>
                      ) : (
                        ""
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
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Problem Sets</div>
              <div className="admin-subtitle">問題セット（CSV/Assets）の一覧です。</div>
            </div>
            <button className="btn" onClick={() => fetchTests()}>Refresh Problem Sets</button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Problem Set ID</th>
                  <th>Title</th>
                  <th>Pass Rate</th>
                  <th>Public</th>
                  <th>Questions</th>
                  <th>Preview</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {modelTests.map((t) => (
                  <tr key={t.id} onClick={() => openPreview(t.version)}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>{t.type ?? ""}</td>
                    <td>{t.version ?? ""}</td>
                    <td>{t.title ?? ""}</td>
                    <td>{t.pass_rate != null ? `${Number(t.pass_rate) * 100}%` : ""}</td>
                    <td>{t.is_public ? "Yes" : "No"}</td>
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
          <div className="admin-msg">{testsMsg}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Problem Set Upload (CSV)</div>
              <div className="admin-subtitle">CSVとAssetsをアップロードし、問題セットを登録します（タイトルはTest Sessionで設定）。</div>
            </div>
            <button className="btn" onClick={() => fetchAssets()}>Refresh</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field small">
              <label>Type</label>
              <select
                value={assetForm.type}
                onChange={(e) => setAssetForm((s) => ({ ...s, type: e.target.value }))}
              >
                <option value="mock">mock</option>
                <option value="quiz">quiz</option>
              </select>
            </div>
            <div className="field">
              <label>Problem Set ID</label>
              <input
                value={assetForm.test_version}
                onChange={(e) => setAssetForm((s) => ({ ...s, test_version: e.target.value }))}
                placeholder="problem_set_v1"
              />
            </div>
            <div className="field small">
              <label>Pass Rate</label>
              <input
                value={assetForm.pass_rate}
                onChange={(e) => setAssetForm((s) => ({ ...s, pass_rate: e.target.value }))}
                placeholder="0.8"
              />
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
        </>
        ) : null}
        </>
        ) : null}

        {activeTab === "daily" ? (
        <>
        {dailySubTab === "create" ? (
        <>
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
              <label>Problem Set</label>
              <select
                value={dailySessionForm.problem_set_id}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, problem_set_id: e.target.value }))}
              >
                {dailyTests.length ? (
                  dailyTests.map((t) => (
                    <option key={`daily-ps-${t.version}`} value={t.version}>
                      {t.version}
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
                value={dailySessionForm.starts_at}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, starts_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Ends At</label>
              <input
                type="datetime-local"
                value={dailySessionForm.ends_at}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, ends_at: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Link Expires At</label>
              <input
                type="datetime-local"
                value={dailySessionForm.link_expires_at}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, link_expires_at: e.target.value }))}
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
              <label>Published</label>
              <select
                value={dailySessionForm.is_published ? "yes" : "no"}
                onChange={(e) => setDailySessionForm((s) => ({ ...s, is_published: e.target.value === "yes" }))}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
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
                  <th>Published</th>
                  <th>Show Answers</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Link Expires</th>
                  <th>Time (min)</th>
                  <th>Link ID</th>
                  <th>Action</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {dailySessions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>{t.title ?? ""}</td>
                    <td>{t.problem_set_id ?? ""}</td>
                    <td>{t.is_published ? "Yes" : "No"}</td>
                    <td>{t.show_answers ? "Yes" : "No"}</td>
                    <td>{formatDateTime(t.starts_at)}</td>
                    <td>{formatDateTime(t.ends_at)}</td>
                    <td>{formatDateTime(linkBySession[t.id]?.expires_at)}</td>
                    <td>{t.time_limit_min ?? ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{linkBySession[t.id]?.id ?? ""}</td>
                    <td>
                      {linkBySession[t.id]?.id ? (
                        <button className="btn" onClick={() => copyLink(linkBySession[t.id].id)}>Copy URL</button>
                      ) : (
                        ""
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
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Daily Tests</div>
              <div className="admin-subtitle">Daily Test（CSV/Assets）の一覧です。</div>
            </div>
            <button className="btn" onClick={() => fetchTests()}>Refresh Daily Tests</button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Problem Set ID</th>
                  <th>Pass Rate</th>
                  <th>Public</th>
                  <th>Questions</th>
                  <th>Preview</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {dailyTests.map((t) => (
                  <tr key={t.id} onClick={() => openPreview(t.version)}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>{t.version ?? ""}</td>
                    <td>{t.pass_rate != null ? `${Number(t.pass_rate) * 100}%` : ""}</td>
                    <td>{t.is_public ? "Yes" : "No"}</td>
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
          <div className="admin-msg">{testsMsg}</div>
        </div>

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
            <div className="field small">
              <label>Pass Rate</label>
              <input
                value={dailyForm.pass_rate}
                onChange={(e) => setDailyForm((s) => ({ ...s, pass_rate: e.target.value }))}
                placeholder="0.8"
              />
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
                <div className="admin-title">Attendance — {attendanceModalDay.day_date}</div>
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
                      <th>#</th>
                      <th>Student</th>
                      <th>P</th>
                      <th>L</th>
                      <th>E</th>
                      <th>A</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeStudents.map((s, idx) => {
                      const entry = attendanceDraft?.[s.id] || { status: "", comment: "" };
                      return (
                        <tr key={`att-${s.id}`}>
                          <td>{idx + 1}</td>
                          <td>{s.display_name ?? s.email ?? s.id}</td>
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
                          <td>{r.prompt}</td>
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
