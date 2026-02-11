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

function getChoiceText(q, idx) {
  if (idx == null) return "";
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
  if (q.type === "mcq_sentence_blank") return q.sentenceJa ?? q.promptEn ?? "";
  if (q.type === "mcq_kanji_reading") return q.sentencePartsJa?.map((p) => p.text).join("") ?? q.promptEn ?? "";
  if (q.type === "mcq_dialog_with_image") return q.dialogJa?.join(" / ") ?? q.promptEn ?? "";
  return q.promptEn ?? "";
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

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function getScoreRate(attempt) {
  const rate = Number(attempt?.score_rate);
  if (Number.isFinite(rate)) return rate;
  const correct = Number(attempt?.correct ?? 0);
  const total = Number(attempt?.total ?? 0);
  if (!total) return 0;
  return correct / total;
}

function parseCsvRows(text) {
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
    if (ch === ",") {
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

function parseQuestionCsv(text, defaultTestVersion = "") {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { questions: [], choices: [], errors: ["CSV is empty."] };
  const header = rows[0].map((h) => String(h ?? "").trim());
  const idx = (name) => header.indexOf(name);
  const getCell = (row, name) => {
    const i = idx(name);
    return i === -1 ? "" : String(row[i] ?? "").trim();
  };
  const getInt = (row, name) => {
    const v = getCell(row, name);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const getChoiceList = (row, prefix) => {
    const bulk = getCell(row, `${prefix}choices_ja`);
    const out = [];
    for (let i = 1; i <= 6; i += 1) {
      const v = getCell(row, `${prefix}choice${i}_ja`);
      if (v) out.push(v);
    }
    if (out.length) return out;
    if (bulk) return parseListCell(bulk);
    return out;
  };
  const getChoiceImages = (row, prefix) => {
    const bulk = getCell(row, `${prefix}choice_images`);
    const out = [];
    for (let i = 1; i <= 6; i += 1) {
      const v = getCell(row, `${prefix}choice${i}_image`);
      if (v) out.push(v);
    }
    if (out.length) return out;
    if (bulk) return parseListCell(bulk);
    return out;
  };

  if (idx("question_id") === -1 || idx("section_key") === -1 || idx("type") === -1) {
    return { questions: [], choices: [], errors: ["CSV must include question_id, section_key, type."] };
  }

  const questions = [];
  const choices = [];
  const errors = [];

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const questionId = getCell(row, "question_id");
    if (!questionId) continue;
    const testVersion = getCell(row, "test_version") || defaultTestVersion;
    if (!testVersion) {
      errors.push(`Row ${r + 1}: test_version is required.`);
      continue;
    }
    const sectionKey = getCell(row, "section_key");
    const type = getCell(row, "type");
    const promptEn = getCell(row, "prompt_en") || null;
    const promptBn = getCell(row, "prompt_bn") || null;
    const orderIndex = getInt(row, "order_index");
    const answerIndex = getInt(row, "answer_index");
    const data = {};

    const sentenceJa = getCell(row, "sentence_ja");
    const sentenceParts = parseJsonCell(getCell(row, "sentence_parts_json") || getCell(row, "sentence_parts_ja"));
    const dialogJa = parseListCell(getCell(row, "dialog_ja"));
    const blankStyle = getCell(row, "blank_style");
    const image = getCell(row, "image");
    const audio = getCell(row, "audio");
    const stemImage = getCell(row, "stem_image");
    const passageImage = getCell(row, "passage_image");
    const tableImage = getCell(row, "table_image");

    if (sentenceJa) data.sentenceJa = sentenceJa;
    if (Array.isArray(sentenceParts)) data.sentencePartsJa = sentenceParts;
    if (dialogJa.length) data.dialogJa = dialogJa;
    if (blankStyle) data.blankStyle = blankStyle;
    if (image) data.image = image;
    if (audio) data.audio = audio;
    if (stemImage) data.stemImage = stemImage;
    if (passageImage) data.passageImage = passageImage;
    if (tableImage) data.tableImage = tableImage;

    const topChoices = getChoiceList(row, "");
    const topChoiceImages = getChoiceImages(row, "");
    if (topChoices.length) data.choicesJa = topChoices;
    if (topChoiceImages.length) data.choiceImages = topChoiceImages;

    const parts = [];
    for (let i = 1; i <= 2; i += 1) {
      const partLabel = getCell(row, `part${i}_label`);
      const partQuestionJa = getCell(row, `part${i}_question_ja`);
      const partAnswerIndex = getInt(row, `part${i}_answer_index`);
      const partChoices = getChoiceList(row, `part${i}_`);
      const partChoiceImages = getChoiceImages(row, `part${i}_`);
      if (partLabel || partQuestionJa || partChoices.length || partChoiceImages.length || partAnswerIndex != null) {
        const partData = {
          partLabel: partLabel || null,
          questionJa: partQuestionJa || null,
          answerIndex: partAnswerIndex != null ? partAnswerIndex : null,
        };
        if (partChoices.length) partData.choicesJa = partChoices;
        if (partChoiceImages.length) partData.choiceImages = partChoiceImages;
        parts.push(partData);
      }
    }
    if (parts.length) data.parts = parts;

    const typeErrors = [];
    const needChoices = [
      "mcq_image",
      "mcq_sentence_blank",
      "mcq_kanji_reading",
      "mcq_dialog_with_image",
      "mcq_illustrated_dialog",
    ];
    const needChoiceImages = ["mcq_listening_image_choices"];
    const needParts = ["mcq_listening_two_part_image", "mcq_reading_passage_two_questions", "mcq_reading_table_two_questions"];

    if (needChoices.includes(type) && (!topChoices.length || answerIndex == null)) {
      typeErrors.push("choices_ja and answer_index are required.");
    }
    if (needChoiceImages.includes(type) && (!topChoiceImages.length || answerIndex == null)) {
      typeErrors.push("choice_images and answer_index are required.");
    }
    if (type === "mcq_sentence_blank" && !sentenceJa) typeErrors.push("sentence_ja is required.");
    if (type === "mcq_kanji_reading" && !Array.isArray(sentenceParts)) {
      typeErrors.push("sentence_parts_json is required.");
    }
    if (type === "mcq_dialog_with_image" && !dialogJa.length) typeErrors.push("dialog_ja is required.");
    if (type === "mcq_dialog_with_image" && !image) typeErrors.push("image is required.");
    if (type === "mcq_illustrated_dialog" && !image) typeErrors.push("image is required.");
    if (type === "mcq_listening_image_choices" && !audio) typeErrors.push("audio is required.");
    if (type === "mcq_listening_image_choices" && !stemImage) typeErrors.push("stem_image is required.");
    if (type === "mcq_listening_two_part_image" && (!audio || !stemImage)) {
      typeErrors.push("audio and stem_image are required.");
    }
    if (needParts.includes(type) && parts.length === 0) typeErrors.push("parts are required.");
    if (type === "mcq_reading_passage_two_questions" && !passageImage) typeErrors.push("passage_image is required.");
    if (type === "mcq_reading_table_two_questions" && !tableImage) typeErrors.push("table_image is required.");

    if (typeErrors.length) {
      errors.push(`Row ${r + 1} (${questionId}): ${typeErrors.join(" ")}`);
      continue;
    }

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

    const pushChoices = (items, images, partIndex) => {
      const max = Math.max(items.length, images.length);
      for (let i = 0; i < max; i += 1) {
        const label = items[i] ?? null;
        const choiceImage = images[i] ?? null;
        if (label == null && choiceImage == null) continue;
        choices.push({
          test_version: testVersion,
          question_key: questionId,
          part_index: partIndex,
          choice_index: i,
          label,
          choice_image: choiceImage,
        });
      }
    };

    if (topChoices.length || topChoiceImages.length) pushChoices(topChoices, topChoiceImages, null);
    parts.forEach((p, idx) => {
      const partChoices = p.choicesJa ?? [];
      const partChoiceImages = p.choiceImages ?? [];
      if (partChoices.length || partChoiceImages.length) pushChoices(partChoices, partChoiceImages, idx);
    });
  }

  return { questions, choices, errors };
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
    data.image = resolveAssetValue(data.image, assetMap);
    data.audio = resolveAssetValue(data.audio, assetMap);
    data.stemImage = resolveAssetValue(data.stemImage, assetMap);
    data.passageImage = resolveAssetValue(data.passageImage, assetMap);
    data.tableImage = resolveAssetValue(data.tableImage, assetMap);
    if (Array.isArray(data.choiceImages)) {
      data.choiceImages = data.choiceImages.map((v) => resolveAssetValue(v, assetMap));
    }
    if (Array.isArray(data.parts)) {
      data.parts = data.parts.map((p) => {
        if (Array.isArray(p.choiceImages)) {
          return { ...p, choiceImages: p.choiceImages.map((v) => resolveAssetValue(v, assetMap)) };
        }
        return p;
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
    checkValue(data.image);
    checkValue(data.audio);
    checkValue(data.stemImage);
    checkValue(data.passageImage);
    checkValue(data.tableImage);
    if (Array.isArray(data.choiceImages)) data.choiceImages.forEach(checkValue);
    if (Array.isArray(data.parts)) {
      data.parts.forEach((p) => {
        if (Array.isArray(p.choiceImages)) p.choiceImages.forEach(checkValue);
      });
    }
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

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [examLinks, setExamLinks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [linkMsg, setLinkMsg] = useState("");
  const [filters, setFilters] = useState({
    code: "",
    name: "",
    from: "",
    to: "",
    limit: 200
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");
  const [linkForm, setLinkForm] = useState({
    testVersion: "test_exam",
    expiresAt: ""
  });
  const [students, setStudents] = useState([]);
  const [studentMsg, setStudentMsg] = useState("");
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
  const [assets, setAssets] = useState([]);
  const [assetsMsg, setAssetsMsg] = useState("");
  const [quizMsg, setQuizMsg] = useState("");
  const [assetForm, setAssetForm] = useState({
    test_version: "test_exam",
    title: "",
    type: "mock",
    pass_rate: "0.6"
  });
  const [assetFile, setAssetFile] = useState(null);
  const [assetFiles, setAssetFiles] = useState([]);
  const [assetCsvFile, setAssetCsvFile] = useState(null);
  const [assetUploadMsg, setAssetUploadMsg] = useState("");
  const [assetImportMsg, setAssetImportMsg] = useState("");
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

  const selectedAttempt = useMemo(
    () => attempts.find((a) => a.id === selectedId) ?? null,
    [attempts, selectedId]
  );

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
    runSearch();
    fetchExamLinks();
    fetchStudents();
    fetchTests();
    fetchAssets();
  }, [session, profile]);

  async function runSearch() {
    setLoading(true);
    setMsg("Loading...");
    const { code, name, from, to, limit } = filters;

    let query = supabase
      .from("attempts")
      .select(
        "id, student_id, display_name, student_code, test_version, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
      )
      .order("created_at", { ascending: false })
      .limit(Number(limit || 200));

    if (code) query = query.ilike("student_code", `%${code}%`);
    if (name) query = query.ilike("display_name", `%${name}%`);
    if (from) query = query.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("created_at", new Date(`${to}T23:59:59`).toISOString());

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

  async function fetchExamLinks() {
    setLinkMsg("Loading...");
    const { data, error } = await supabase
      .from("exam_links")
      .select("id, test_version, expires_at, created_at")
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

  async function createExamLink() {
    setLinkMsg("");
    if (!linkForm.expiresAt) {
      setLinkMsg("期限（expires_at）を入力してください。");
      return;
    }
    const payload = {
      test_version: linkForm.testVersion || "mock_v1",
      expires_at: new Date(linkForm.expiresAt).toISOString()
    };
    const { error } = await supabase.from("exam_links").insert(payload);
    if (error) {
      console.error("exam_links insert error:", error);
      setLinkMsg(`Create failed: ${error.message}`);
      return;
    }
    setLinkMsg("Created.");
    setLinkForm((s) => ({ ...s, expiresAt: "" }));
    fetchExamLinks();
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
      .select("id, email, role, display_name, student_code, created_at")
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

  async function fetchTests() {
    setTestsMsg("Loading...");
    const { data, error } = await supabase
      .from("tests")
      .select("id, version, title, type, pass_rate, is_public, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("tests fetch error:", error);
      setTests([]);
      setTestsMsg(`Load failed: ${error.message}`);
      return;
    }
    setTests(data ?? []);
    setTestsMsg(data?.length ? "" : "No tests.");
  }

  async function fetchAssets() {
    setAssetsMsg("Loading...");
    const { data, error } = await supabase
      .from("test_assets")
      .select("id, test_version, test_type, asset_type, path, created_at, original_name")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("assets fetch error:", error);
      setAssets([]);
      setAssetsMsg(`Load failed: ${error.message}`);
      return;
    }
    setAssets(data ?? []);
    setAssetsMsg(data?.length ? "" : "No assets.");
  }

  async function inviteStudents(payload) {
    setCsvMsg("");
    setStudentMsg("");
    setInviteResults([]);
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData?.session?.access_token ?? null;
    const expiresAt = sessionData?.session?.expires_at ?? 0;
    if (!accessToken || expiresAt * 1000 < Date.now() + 60_000) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        accessToken = refreshed?.session?.access_token ?? null;
      }
    }
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
    setStudentMsg(`Created: ${okCount} ok / ${ngCount} failed`);
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
    const testVersion = assetForm.test_version.trim();
    const title = assetForm.title.trim() || testVersion;
    const type = assetForm.type;
    const passRate = Number(assetForm.pass_rate);

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

    setAssetUploadMsg("Uploading...");

    const { error: testError } = await supabase
      .from("tests")
      .upsert(
        {
          version: testVersion,
          title,
          type,
          pass_rate: passRate,
          is_public: true
        },
        { onConflict: "version" }
      );
    if (testError) {
      console.error("tests upsert error:", testError);
      setAssetUploadMsg(`Test upsert failed: ${testError.message}`);
      return;
    }

    const files = [];
    if (singleFile) files.push(singleFile);
    files.push(...folderFiles);
    if (singleFile && singleFile.name.toLowerCase().endsWith(".csv")) {
      setAssetCsvFile(singleFile);
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
    setAssetFile(null);
    setAssetFiles([]);
    fetchTests();
    fetchAssets();
  }

  async function importQuestionsFromCsv() {
    setAssetImportMsg("");
    const file = assetCsvFile || assetFile;
    const testVersion = assetForm.test_version.trim();
    const title = assetForm.title.trim();
    const type = assetForm.type;
    const passRate = Number(assetForm.pass_rate);

    if (!file) {
      setAssetImportMsg("CSV file is required for Create Exam.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setAssetImportMsg("CSV file is required for Create Exam.");
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
    if (!resolvedVersion) {
      setAssetImportMsg("test_version is required (either in form or CSV).");
      return;
    }
    const resolvedTitle = title || resolvedVersion;

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
    const { error: testError } = await supabase
      .from("tests")
      .upsert(
        {
          version: resolvedVersion,
          title: resolvedTitle,
          type,
          pass_rate: passRate,
          is_public: true
        },
        { onConflict: "version" }
      );
    if (testError) {
      console.error("tests upsert error:", testError);
      setAssetImportMsg(`Test upsert failed: ${testError.message}`);
      return;
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

    const questionIds = questions.map((q) => q.question_id);
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

  function exportDetailCsv(list) {
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
      const details = buildAttemptDetailRows(a.answers_json);
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
    <div className="admin-wrap">
      <div className="admin-top">
        <div>
          <div className="admin-title">Admin Panel</div>
          <div className="admin-help">受験結果（attempts）を検索・詳細表示・CSV出力できます。</div>
        </div>
        <div className="admin-meta">
          <span className="admin-chip">user: {session.user.email}</span>
          <span className="admin-chip">role: {profile.role}</span>
          <div className="admin-actions">
            <button className="btn" onClick={() => runSearch()}>Refresh</button>
            <button className="btn" onClick={() => exportSummaryCsv(attempts)}>Export CSV (Summary)</button>
            <button className="btn" onClick={() => exportDetailCsv(attempts)}>Export CSV (Detail)</button>
            <button className="btn" onClick={() => exportQuizSummaryCsv()}>Export CSV (Quiz Summary)</button>
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
          {quizMsg ? <div className="admin-help">{quizMsg}</div> : null}
        </div>
      </div>

      <div className="admin-panel">
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Students</div>
              <div className="admin-help">一時パスワードで生徒アカウントを作成できます。</div>
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
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.created_at)}</td>
                    <td>{s.email ?? ""}</td>
                    <td>{s.display_name ?? ""}</td>
                    <td>{s.student_code ?? ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.id}</td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Exam Links</div>
              <div className="admin-help">期限付きの模試リンクを発行します（A: 期限のみ）。</div>
            </div>
            <button className="btn" onClick={() => fetchExamLinks()}>Refresh Links</button>
          </div>

          <div className="admin-form" style={{ marginTop: 10 }}>
            <div className="field">
              <label>Test Version</label>
              <input
                value={linkForm.testVersion}
                onChange={(e) => setLinkForm((s) => ({ ...s, testVersion: e.target.value }))}
                placeholder="mock_v1"
              />
            </div>
            <div className="field">
              <label>Expires At</label>
              <input
                type="datetime-local"
                value={linkForm.expiresAt}
                onChange={(e) => setLinkForm((s) => ({ ...s, expiresAt: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>Student Base URL</label>
              <input value={getStudentBaseUrl()} readOnly />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn btn-primary" type="button" onClick={createExamLink}>Create Link</button>
            </div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Test</th>
                  <th>Link ID</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {examLinks.map((l) => {
                  const expired = l.expires_at && new Date(l.expires_at).getTime() < Date.now();
                  return (
                    <tr key={l.id}>
                      <td>{formatDateTime(l.created_at)}</td>
                      <td>{formatDateTime(l.expires_at)}{expired ? " (expired)" : ""}</td>
                      <td>{l.test_version}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{l.id}</td>
                      <td>
                        <button className="btn" onClick={() => copyLink(l.id)}>Copy URL</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{linkMsg}</div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div className="admin-title">Tests</div>
              <div className="admin-help">公開テスト（模試/小テスト）の一覧です。</div>
            </div>
            <button className="btn" onClick={() => fetchTests()}>Refresh Tests</button>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Title</th>
                  <th>Pass Rate</th>
                  <th>Public</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDateTime(t.created_at)}</td>
                    <td>{t.type ?? ""}</td>
                    <td>{t.version ?? ""}</td>
                    <td>{t.title ?? ""}</td>
                    <td>{t.pass_rate != null ? `${Number(t.pass_rate) * 100}%` : ""}</td>
                    <td>{t.is_public ? "Yes" : "No"}</td>
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
              <div className="admin-title">Content Import (CSV)</div>
              <div className="admin-help">CSVをSupabase Storageへアップロードし、DBへ登録します。</div>
            </div>
            <button className="btn" onClick={() => fetchAssets()}>Refresh Assets</button>
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
              <label>Test Version</label>
              <input
                value={assetForm.test_version}
                onChange={(e) => setAssetForm((s) => ({ ...s, test_version: e.target.value }))}
                placeholder="mock_v1"
              />
            </div>
            <div className="field">
              <label>Title</label>
              <input
                value={assetForm.title}
                onChange={(e) => setAssetForm((s) => ({ ...s, title: e.target.value }))}
                placeholder="Mock Test v1"
              />
            </div>
            <div className="field small">
              <label>Pass Rate</label>
              <input
                value={assetForm.pass_rate}
                onChange={(e) => setAssetForm((s) => ({ ...s, pass_rate: e.target.value }))}
                placeholder="0.6"
              />
            </div>
            <div className="field">
              <label>CSV File (required for Create Exam)</label>
              <input
                type="file"
                accept=".csv,.png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setAssetFile(file);
                  if (file && file.name.toLowerCase().endsWith(".csv")) setAssetCsvFile(file);
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
                accept=".png,.jpg,.jpeg,.webp,.mp3,.wav,.m4a,.ogg"
                onChange={(e) => setAssetFiles(Array.from(e.target.files ?? []))}
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
                Upload Assets
              </button>
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button className="btn" type="button" onClick={importQuestionsFromCsv}>
                Create Exam
              </button>
            </div>
          </div>

          <div className="admin-help" style={{ marginTop: 6 }}>
            Bucket: <b>test-assets</b> / CSV, PNG, MP3 (他拡張子もOK)
          </div>
          <div className="admin-help" style={{ marginTop: 4 }}>
            Upload AssetsでCSV/PNG/MP3をアップロード → Create ExamでCSVを取り込みます。
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

          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Version</th>
                  <th>Asset</th>
                  <th>Path</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>{a.test_type ?? ""}</td>
                    <td>{a.test_version ?? ""}</td>
                    <td>{a.asset_type ?? ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{a.path ?? a.original_name ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-msg">{assetsMsg}</div>
        </div>

        <form
          className="admin-form"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
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

        <div className="admin-grid" style={{ marginTop: 12 }}>
          <div>
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
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((a) => {
                    const score = `${a.correct}/${a.total}`;
                    const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                    return (
                      <tr key={a.id} onClick={() => setSelectedId(a.id)}>
                        <td>{formatDateTime(a.created_at)}</td>
                        <td>{a.display_name ?? ""}</td>
                        <td>{a.student_code ?? ""}</td>
                        <td>{score}</td>
                        <td>{rate}</td>
                        <td>{a.test_version ?? ""}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{a.id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="admin-msg">{loading ? "Loading..." : msg}</div>
          </div>

          <div>
            <div className="admin-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Attempt Detail</h3>
                <div className="admin-actions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => selectedAttempt && exportSelectedAttemptCsv(selectedAttempt)}
                  >
                    Export CSV (Selected)
                  </button>
                </div>
              </div>

              {!selectedAttempt ? (
                <div className="admin-help" style={{ marginTop: 6 }}>左の一覧から選択してください。</div>
              ) : (
                <div className="admin-detail">
                  <div className="admin-help">
                    <b>{selectedAttempt.display_name ?? ""}</b> ({selectedAttempt.student_code ?? ""})
                    <br />
                    created: {formatDateTime(selectedAttempt.created_at)}
                    <br />
                    score: <b>{selectedAttempt.correct}/{selectedAttempt.total}</b> (
                    {(getScoreRate(selectedAttempt) * 100).toFixed(1)}%)
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
                        {buildAttemptDetailRows(selectedAttempt.answers_json).map((r) => (
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
