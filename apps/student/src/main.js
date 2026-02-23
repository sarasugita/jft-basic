import "./style.css";
import { inject } from "@vercel/analytics";
import { questions, sections } from "../../../packages/shared/questions.js";
import { supabase, publicSupabase } from "./supabaseClient";

inject();

const STORAGE_KEY = "jft_mock_state_v3";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";

const TOTAL_TIME_SEC = 60 * 60; // 60分
const TEST_VERSION = "test_exam";
const PASS_RATE_DEFAULT = 0.8;

let authState = {
  checked: false,
  session: null,
  profile: null,
  recoveryMode: false,
  mustChangePassword: false,
};

let testsState = {
  loaded: false,
  list: [],
  error: "",
};

let studentResultsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  userId: "",
};

let studentAttendanceState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  userId: "",
};

let announcementsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

let absenceApplicationsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
};

let resultDetailState = {
  open: false,
  mode: "",
  subTab: "score",
  attempt: null,
  loading: false,
  error: "",
  questionsByVersion: {},
};

let modelRankState = {
  loading: false,
  loaded: false,
  map: {},
};

let testSessionsState = {
  loaded: false,
  list: [],
  error: "",
};

let questionsState = {
  loaded: false,
  loading: false,
  list: [],
  error: "",
  version: "",
  updatedAt: "",
};

const defaultState = {
  phase: "intro",
  sectionIndex: 0,
  questionIndexInSection: 0,
  answers: {},
  showBangla: false,

  testStartAt: null,   // ★追加：テスト開始時刻
  
  testEndAt: null,   // ★追加：結果表示の時刻（タイマー固定用）

  user: { name: "", id: "" },
  attemptSaved: false,
  linkId: null,
  linkExpiresAt: null,
  linkTestVersion: null,
  linkTestSessionId: null,
  linkChecked: false,
  linkInvalid: false,
  linkLoginRequired: false,
  requireLogin: true,
  selectedTestVersion: "",
  selectedTestSessionId: "",
  studentTab: "home",
  dailyResultsCategory: "",
  focusWarnings: 0,
  focusWarningAt: 0,
};



let state = loadState();

const legacyQuestionMap = (() => {
  const map = new Map();
  for (const q of questions ?? []) {
    if (q?.id) map.set(q.id, q);
  }
  return map;
})();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const loaded = { ...defaultState, ...JSON.parse(raw) };
    if (!["quiz", "sectionIntro", "result"].includes(loaded.phase)) {
      loaded.phase = "intro";
    }
    if (loaded.studentTab === "results") loaded.studentTab = "dailyResults";
    if (loaded.studentTab === "take") loaded.studentTab = "home";
    if (!["home", "dailyResults", "modelResults", "attendance"].includes(loaded.studentTab)) {
      loaded.studentTab = "home";
    }
    return loaded;
  } catch {
    return { ...defaultState };
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function hasLinkParam() {
  try {
    const url = new URL(window.location.href);
    return Boolean(url.searchParams.get("link"));
  } catch {
    return false;
  }
}

function mapDbQuestion(row, version) {
  const data = row.data ?? {};
  const base = {
    id: data.itemId || row.question_id,
    qid: data.qid || null,
    subId: data.subId || null,
    sectionKey: row.section_key,
    type: row.type,
    promptEn: row.prompt_en,
    promptBn: row.prompt_bn,
    answerIndex: row.answer_index,
    orderIndex: row.order_index ?? 0,
    stemKind: data.stemKind || null,
    stemText: data.stemText || null,
    stemAsset: data.stemAsset || null,
    stemExtra: data.stemExtra || null,
    boxText: data.boxText || null,
    choices: data.choices || data.choicesJa || [],
    blankStyle: data.blankStyle || null,
    target: data.target || null,
  };
  return normalizeQuestionAssets(base, version);
}

async function fetchQuestionsForVersion(version, updatedAt = "") {
  if (!version) return;
  if (questionsState.loading && questionsState.version === version) return;
  questionsState.loading = true;
  questionsState.error = "";
  questionsState.version = version;
  const { data, error } = await publicSupabase
    .from("questions")
    .select("question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
    .eq("test_version", version)
    .order("order_index", { ascending: true });
  if (error) {
    questionsState.list = [];
    questionsState.error = error.message || "Failed to load questions.";
  } else {
    questionsState.list = (data ?? []).map((row) => mapDbQuestion(row, version));
  }
  questionsState.loaded = true;
  questionsState.loading = false;
  questionsState.updatedAt = updatedAt || "";
}

function ensureQuestionsLoaded() {
  const version = getActiveTestVersion();
  if (!version) return;
  const problemSet = testsState.list.find((t) => t.version === version);
  const updatedAt = problemSet?.updated_at ?? "";
  if ((questionsState.version !== version || questionsState.updatedAt !== updatedAt) && !questionsState.loading) {
    questionsState.loaded = false;
    questionsState.list = [];
    questionsState.error = "";
    fetchQuestionsForVersion(version, updatedAt).finally(render);
  }
}

function getQuestions() {
  if (questionsState.loaded && questionsState.version === getActiveTestVersion()) {
    return questionsState.list;
  }
  if (testsState.loaded && testsState.list.length > 0) return [];
  return questions;
}

function resetAll() {
  state = { ...defaultState };
  state.testEndAt = null;
  state.requireLogin = true;
  state.focusWarnings = 0;
  state.focusWarningAt = 0;
  const url = new URL(window.location.href);
  const linkId = url.searchParams.get("link");
  if (!linkId) {
    state.linkChecked = true;
    saveState();
    render();
    return;
  }
  saveState();
  checkLinkFromUrl().finally(render);
}

function exitToHome() {
  if (authState.session && state.linkId) {
    state.linkId = null;
    state.linkExpiresAt = null;
    state.linkTestVersion = null;
    state.linkTestSessionId = null;
    state.linkInvalid = false;
    state.linkLoginRequired = false;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("link");
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore URL update failures
    }
  }
  state.phase = "intro";
  state.sectionIndex = 0;
  state.questionIndexInSection = 0;
  state.showBangla = false;
  state.testStartAt = null;
  state.testEndAt = null;
  state.answers = {};
  state.attemptSaved = false;
  state.requireLogin = false;
  state.linkLoginRequired = false;
  state.focusWarnings = 0;
  state.focusWarningAt = 0;
  saveState();
  render();
}

function goIntro() {
  state.phase = "intro";
  state.sectionIndex = 0;
  state.questionIndexInSection = 0;
  state.showBangla = false;
  state.testStartAt = null; // ★全体タイマーを戻す
  state.testEndAt = null;
  state.attemptSaved = false;
  saveState();
  render();
}

function renderLoading(app) {
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Loading", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Loading...</h1>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
}

function syncTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const height = Math.ceil(topbar.getBoundingClientRect().height);
  if (height > 0) {
    document.documentElement.style.setProperty("--topbar-height", `${height}px`);
  }
}

function renderAndSync(fn, app) {
  fn(app);
  requestAnimationFrame(syncTopbarHeight);
}

async function refreshAuthState() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession error:", error);
  authState.session = data?.session ?? null;
  authState.profile = null;

  const isRecovery = window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token=");
  authState.recoveryMode = Boolean(isRecovery && authState.session);

  if (!authState.session) {
    state.requireLogin = true;
    authState.checked = true;
    studentResultsState.userId = "";
    studentResultsState.loaded = false;
    studentResultsState.list = [];
    studentResultsState.error = "";
    studentAttendanceState.userId = "";
    studentAttendanceState.loaded = false;
    studentAttendanceState.list = [];
    studentAttendanceState.error = "";
    return;
  }

  const { data: prof, error: profErr } = await supabase
    .from("profiles")
    .select("id, role, display_name, student_code, force_password_change")
    .eq("id", authState.session.user.id)
    .single();
  authState.mustChangePassword = Boolean(authState.recoveryMode);

  if (profErr) {
    console.error("fetch profile error:", profErr);
  } else {
    authState.profile = prof;
    authState.mustChangePassword = Boolean(authState.mustChangePassword || prof?.force_password_change);
    const nextName = (prof?.display_name ?? "").trim() || (state.user?.name ?? "").trim();
    const nextId = (prof?.student_code ?? "").trim() || (state.user?.id ?? "").trim();
    state.user = { name: nextName, id: nextId };
    saveState();
  }

  if (authState.session && state.linkId) {
    if (state.phase === "login" && !state.requireLogin) {
      state.linkLoginRequired = false;
      state.phase = "intro";
      saveState();
    }
  }

  authState.checked = true;

  if (!state.linkLoginRequired) {
    state.requireLogin = false;
    if (state.phase === "login") {
      state.phase = "intro";
      saveState();
    }
  }
  const currentUserId = authState.session.user.id;
  if (studentResultsState.userId !== currentUserId) {
    studentResultsState.userId = currentUserId;
    studentResultsState.loaded = false;
    studentResultsState.list = [];
    studentResultsState.error = "";
  }
  if (studentAttendanceState.userId !== currentUserId) {
    studentAttendanceState.userId = currentUserId;
    studentAttendanceState.loaded = false;
    studentAttendanceState.list = [];
    studentAttendanceState.error = "";
  }
  if (authState.session && !studentResultsState.loaded && !studentResultsState.loading) {
    fetchStudentResults().finally(render);
  }
}

async function fetchPublicTests() {
  testsState.error = "";
  const { data, error } = await publicSupabase
    .from("tests")
    .select("id, version, title, type, pass_rate, is_public, created_at, updated_at")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    testsState.list = [];
    const msg = error.message || "Failed to load tests.";
    if (String(msg).includes("does not exist") || error.status === 404) {
      testsState.error = "testsテーブルがありません。Supabaseでスキーマを適用してください。";
    } else {
      testsState.error = msg;
    }
    testsState.loaded = true;
    return;
  }
  const list = (data ?? []).filter((t) => t.type === "mock" || t.type === "daily");
  testsState.list = list;
  testsState.loaded = true;
  if (!state.linkId && !state.selectedTestVersion && list.length) {
    state.selectedTestVersion = list[0].version;
    saveState();
  }
  ensureQuestionsLoaded();
}

async function fetchTestSessions() {
  testSessionsState.error = "";
  const { data, error } = await publicSupabase
    .from("test_sessions")
    .select("id, problem_set_id, title, starts_at, ends_at, time_limit_min, is_published, show_answers, allow_multiple_attempts, created_at")
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    testSessionsState.list = [];
    const msg = error.message || "Failed to load test sessions.";
    if (String(msg).includes("does not exist") || error.status === 404) {
      testSessionsState.error = "test_sessionsテーブルがありません。Supabaseでスキーマを適用してください。";
    } else {
      testSessionsState.error = msg;
    }
    testSessionsState.loaded = true;
    return;
  }
  const list = data ?? [];
  testSessionsState.list = list;
  testSessionsState.loaded = true;
  if (!state.linkId && !state.selectedTestSessionId && list.length) {
    state.selectedTestSessionId = list[0].id;
    saveState();
  }
  ensureQuestionsLoaded();
}

function getActiveTestVersion() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (sessionId) {
    const session = testSessionsState.list.find((s) => s.id === sessionId);
    if (session?.problem_set_id) return session.problem_set_id;
  }
  return state.linkTestVersion || state.selectedTestVersion || TEST_VERSION;
}

function getActiveTestSession() {
  const sessionId = state.linkTestSessionId || state.selectedTestSessionId;
  if (!sessionId) return null;
  return testSessionsState.list.find((s) => s.id === sessionId) || null;
}

function getActiveTestTitle() {
  const session = getActiveTestSession();
  if (session?.title) return session.title;
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  return test?.title || version || "Test";
}

function getActiveTestType() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  return test?.type || "";
}

function getSessionTestType(session) {
  if (!session?.problem_set_id) return "";
  const test = testsState.list.find((t) => t.version === session.problem_set_id);
  return test?.type || "";
}

function allowMultipleAttempts(session) {
  return session?.allow_multiple_attempts !== false;
}

function hasAttemptForSession(sessionId) {
  if (!sessionId) return false;
  return (studentResultsState.list ?? []).some((a) => a.test_session_id === sessionId);
}

function getActivePassRate() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

function getPassRateForVersion(version) {
  const test = testsState.list.find((t) => t.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

function getAttemptTest(attempt) {
  if (!attempt?.test_version) return null;
  return testsState.list.find((t) => t.version === attempt.test_version) || null;
}

function getAttemptTestType(attempt) {
  const test = getAttemptTest(attempt);
  return test?.type || "";
}

function getAttemptCategory(attempt) {
  const test = getAttemptTest(attempt);
  const name = String(test?.title ?? "").trim();
  return name || "Uncategorized";
}

function getAttemptDateLabel(attempt) {
  const date = attempt?.ended_at || attempt?.created_at;
  return date ? formatDateShort(date) : "—";
}

function getScoreRateFromAttempt(attempt) {
  const rate = Number(attempt?.score_rate);
  if (Number.isFinite(rate)) return rate;
  const total = Number(attempt?.total) || 0;
  const correct = Number(attempt?.correct) || 0;
  return total ? correct / total : 0;
}

function getAttemptTitle(attempt) {
  if (attempt?.test_session_id) {
    const session = testSessionsState.list.find((s) => s.id === attempt.test_session_id);
    if (session?.title) return session.title;
  }
  const test = testsState.list.find((t) => t.version === attempt?.test_version);
  return test?.title || attempt?.test_version || "Test";
}

function shouldShowAnswers(attempt) {
  if (attempt?.test_session_id) {
    const session = testSessionsState.list.find((s) => s.id === attempt.test_session_id);
    if (typeof session?.show_answers === "boolean") return session.show_answers;
  }
  const test = testsState.list.find((t) => t.version === attempt?.test_version);
  if (test?.type === "daily") return false;
  return true;
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

function formatTimeBdt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" });
}

function getBdtDateKey(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(d);
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

function formatWeekday(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
}

function buildAttendanceSummary(list) {
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
}

async function fetchStudentResults() {
  if (!authState.session) return;
  if (studentResultsState.loading) return;
  studentResultsState.loading = true;
  studentResultsState.error = "";
  modelRankState.loaded = false;
  modelRankState.loading = false;
  modelRankState.map = {};
  const { data, error } = await supabase
    .from("attempts")
    .select("id, test_version, test_session_id, correct, total, score_rate, created_at, ended_at, answers_json")
    .eq("student_id", authState.session.user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    studentResultsState.list = [];
    studentResultsState.error = error.message || "Failed to load results.";
  } else {
    studentResultsState.list = data ?? [];
  }
  studentResultsState.loaded = true;
  studentResultsState.loading = false;
}

async function fetchModelRanks(attempts) {
  if (modelRankState.loading || modelRankState.loaded) return;
  const sessionIds = Array.from(
    new Set((attempts ?? []).map((a) => a.test_session_id).filter(Boolean))
  );
  if (!sessionIds.length) {
    modelRankState.loaded = true;
    return;
  }
  modelRankState.loading = true;
  const map = { ...modelRankState.map };
  for (const sessionId of sessionIds) {
    try {
      const { data, error } = await supabase
        .from("attempts")
        .select("id, score_rate")
        .eq("test_session_id", sessionId);
      if (error) {
        console.warn("model rank fetch error:", error);
        continue;
      }
      const list = (data ?? []).slice().sort((a, b) => (b.score_rate ?? 0) - (a.score_rate ?? 0));
      list.forEach((row, idx) => {
        if (row?.id) map[row.id] = idx + 1;
      });
    } catch (e) {
      console.warn("model rank fetch failed:", e);
    }
  }
  modelRankState.map = map;
  modelRankState.loading = false;
  modelRankState.loaded = true;
}

async function fetchStudentAttendance() {
  if (!authState.session) return;
  if (studentAttendanceState.loading) return;
  studentAttendanceState.loading = true;
  studentAttendanceState.error = "";
  const { data, error } = await supabase
    .from("attendance_entries")
    .select("day_id, status, comment")
    .eq("student_id", authState.session.user.id);
  if (error) {
    studentAttendanceState.list = [];
    studentAttendanceState.error = error.message || "Failed to load attendance.";
    studentAttendanceState.loaded = true;
    studentAttendanceState.loading = false;
    return;
  }
  const entries = data ?? [];
  const dayIds = entries.map((e) => e.day_id).filter(Boolean);
  if (!dayIds.length) {
    studentAttendanceState.list = [];
    studentAttendanceState.loaded = true;
    studentAttendanceState.loading = false;
    return;
  }
  const { data: daysData, error: daysError } = await supabase
    .from("attendance_days")
    .select("id, day_date")
    .in("id", dayIds);
  if (daysError) {
    studentAttendanceState.list = [];
    studentAttendanceState.error = daysError.message || "Failed to load attendance.";
  } else {
    const dayMap = {};
    (daysData ?? []).forEach((d) => {
      dayMap[d.id] = d.day_date;
    });
    studentAttendanceState.list = entries
      .map((e) => ({
        day_id: e.day_id,
        day_date: dayMap[e.day_id] ?? "",
        status: e.status,
        comment: e.comment ?? ""
      }))
      .sort((a, b) => String(b.day_date).localeCompare(String(a.day_date)));
  }
  studentAttendanceState.loaded = true;
  studentAttendanceState.loading = false;
}

async function fetchAbsenceApplications() {
  if (!authState.session || absenceApplicationsState.loading) return;
  absenceApplicationsState.loading = true;
  absenceApplicationsState.error = "";
  const { data, error } = await supabase
    .from("absence_applications")
    .select("id, type, day_date, status, reason, catch_up, late_type, time_value, created_at")
    .eq("student_id", authState.session.user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    absenceApplicationsState.list = [];
    absenceApplicationsState.error = error.message || "Failed to load applications.";
  } else {
    absenceApplicationsState.list = data ?? [];
  }
  absenceApplicationsState.loaded = true;
  absenceApplicationsState.loading = false;
}

async function fetchAnnouncements() {
  if (announcementsState.loading) return;
  announcementsState.loading = true;
  announcementsState.error = "";
  const nowIso = new Date().toISOString();
  const { data, error } = await publicSupabase
    .from("announcements")
    .select("id, title, body, publish_at, end_at, created_at")
    .lte("publish_at", nowIso)
    .or(`end_at.is.null,end_at.gte.${nowIso}`)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    announcementsState.list = [];
    announcementsState.error = error.message || "Failed to load announcements.";
  } else {
    announcementsState.list = data ?? [];
  }
  announcementsState.loaded = true;
  announcementsState.loading = false;
}

async function fetchQuestionsForDetail(version) {
  if (!version) return [];
  if (resultDetailState.questionsByVersion[version]) {
    resultDetailState.loading = false;
    resultDetailState.error = "";
    return resultDetailState.questionsByVersion[version];
  }
  resultDetailState.loading = true;
  resultDetailState.error = "";
  const { data, error } = await publicSupabase
    .from("questions")
    .select("question_id, section_key, type, prompt_en, prompt_bn, answer_index, order_index, data")
    .eq("test_version", version)
    .order("order_index", { ascending: true });
  if (error) {
    resultDetailState.error = error.message || "Failed to load questions.";
    resultDetailState.loading = false;
    return [];
  }
  const list = (data ?? []).map((row) => mapDbQuestion(row, version));
  resultDetailState.questionsByVersion = {
    ...resultDetailState.questionsByVersion,
    [version]: list,
  };
  resultDetailState.loading = false;
  return list;
}

function renderLogin(app) {
  const isDaily = getActiveTestType() === "daily";
  const showGuest = hasLinkParam() && testsState.loaded && !isDaily;
  const emailPrefill = authState.session?.user?.email ?? "";
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <div style="max-width:420px;margin:40px auto;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;">
          <h2 style="margin:0 0 6px;">Student Login</h2>
          <p style="margin-top:0;line-height:1.6;">
            Log in with email and password.
            ${showGuest ? `<br/>You can also take this test as a guest from this link.` : ""}
          </p>

          <label>Email</label>
          <input id="email" type="email" style="width:100%;padding:10px;margin:6px 0 12px;" value="${escapeHtml(emailPrefill)}" />

          <label>Password</label>
          <input id="password" type="password" style="width:100%;padding:10px;margin:6px 0 12px;" />

          <div>
            <button class="btn btn-primary" id="loginBtn" style="width:100%; min-width: 160px;">Log in</button>
            ${
              showGuest
                ? `<button class="btn btn-guest" id="guestBtn" style="width:100%; min-width: 160px; margin-top:10px;">Take as Guest</button>`
                : ""
            }
          </div>

          <p id="msg" style="color:#b00;margin-top:12px;min-height:20px;"></p>
        </div>
      </main>
    </div>
  `;

  const emailEl = app.querySelector("#email");
  const passEl = app.querySelector("#password");
  const msgEl = app.querySelector("#msg");

  app.querySelector("#loginBtn").addEventListener("click", async () => {
    msgEl.textContent = "";
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (!email || !password) {
      msgEl.textContent = "Email / Password を入力してください。";
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      msgEl.textContent = error.message;
      return;
    }
    state.requireLogin = false;
    state.linkLoginRequired = false;
    state.phase = "intro";
    saveState();
  });

  if (showGuest) {
    app.querySelector("#guestBtn")?.addEventListener("click", () => {
      supabase.auth.signOut();
      state.requireLogin = false;
      state.linkLoginRequired = false;
      goIntro();
    });
  }
}

function eyeIcon() {
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 5c5.5 0 9.6 4.1 10.7 6.6.2.4.2.8 0 1.1C21.6 15.9 17.5 20 12 20S2.4 15.9 1.3 12.7c-.2-.4-.2-.8 0-1.1C2.4 9.1 6.5 5 12 5zm0 2.2c-4.1 0-7.4 2.9-8.4 4.9 1 2 4.3 4.9 8.4 4.9s7.4-2.9 8.4-4.9c-1-2-4.3-4.9-8.4-4.9zm0 1.8a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z"/>
    </svg>
  `;
}

function eyeOffIcon() {
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 4.3 4.3 3 21 19.7 19.7 21l-2.4-2.4c-1.6.8-3.4 1.4-5.3 1.4-5.5 0-9.6-4.1-10.7-6.6-.2-.4-.2-.8 0-1.1.7-1.7 2.3-3.6 4.6-4.9L3 4.3zm5 5 1.7 1.7a3.9 3.9 0 0 0 4.6 4.6l1.7 1.7c-1 .5-2.1.7-3.4.7a3.9 3.9 0 0 1-3.9-3.9c0-1.3.3-2.4.8-3.4zM12 7.2c1.2 0 2.3.3 3.2.8l-1.7 1.7a3.9 3.9 0 0 0-4.6 4.6L6.2 10c1.5-1.7 3.7-2.8 5.8-2.8zm9.2 4.8c-.5 1.1-1.4 2.4-2.8 3.5l-1.4-1.4c1-.8 1.7-1.7 2.1-2.1-.8-1.6-3.1-4.1-6.1-4.6l-1.8-1.8c4.2.4 7.5 3.2 8.5 4.7.2.4.2.8 0 1.1z"/>
    </svg>
  `;
}

function renderSetPassword(app) {
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Reset", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <div style="max-width:420px;margin:20px auto;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;">
          <h2 style="margin:0 0 6px;">Set New Password</h2>
          <p style="margin-top:0;line-height:1.6;">新しいパスワードを設定します。</p>

          <label>New Password</label>
          <div class="pass-field">
            <input id="newPass" type="password" class="pass-input" />
            <button class="pass-toggle" type="button" id="toggleNewPass" aria-label="Show password">
              ${eyeOffIcon()}
            </button>
          </div>

          <label>Confirm Password</label>
          <div class="pass-field">
            <input id="confirmPass" type="password" class="pass-input" />
            <button class="pass-toggle" type="button" id="toggleConfirmPass" aria-label="Show password">
              ${eyeOffIcon()}
            </button>
          </div>

          <button class="nav-btn" id="updateBtn" style="width:100%;">Update password</button>
          <p id="msg" style="color:#b00;margin-top:12px;min-height:20px;"></p>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
  const passEl = app.querySelector("#newPass");
  const confirmEl = app.querySelector("#confirmPass");
  const msgEl = app.querySelector("#msg");
  const toggleNew = app.querySelector("#toggleNewPass");
  const toggleConfirm = app.querySelector("#toggleConfirmPass");

  toggleNew?.addEventListener("click", () => {
    const next = passEl.type === "password" ? "text" : "password";
    passEl.type = next;
    toggleNew.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });
  toggleConfirm?.addEventListener("click", () => {
    const next = confirmEl.type === "password" ? "text" : "password";
    confirmEl.type = next;
    toggleConfirm.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });
  app.querySelector("#updateBtn").addEventListener("click", async () => {
    msgEl.textContent = "";
    const password = passEl.value;
    const confirm = confirmEl.value;
    if (!password || password.length < 8) {
      msgEl.textContent = "8文字以上のパスワードを入力してください。";
      return;
    }
    if (password !== confirm) {
      msgEl.textContent = "パスワードが一致しません。";
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      msgEl.textContent = error.message;
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", authState.session?.user?.id ?? "");
    if (profileError) {
      msgEl.textContent = profileError.message;
      return;
    }
    authState.mustChangePassword = false;
    if (authState.profile) authState.profile.force_password_change = false;
    state.phase = "intro";
    saveState();
    render();
  });
}


function renderCandidateLabel() {
  const name = state.user?.name?.trim();
  const id = state.user?.id?.trim();

  if (name && id) return `${name} (${id})`;
  if (name) return name;
  return "Guest";
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getSectionTitle(sectionKey) {
  return sections.find((s) => s.key === sectionKey)?.title ?? sectionKey ?? "";
}

function getQuestionPrompt(q) {
  return q.boxText || q.stemText || q.stemExtra || q.promptEn || "";
}

function renderUnderlines(text) {
  const escaped = escapeHtml(text ?? "");
  return escaped
    .replace(/【(.*?)】/g, '<span class="u">$1</span>')
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

function isImageChoiceValue(value) {
  return /\.(png|jpe?g|webp)(\?.*)?$/i.test(String(value ?? "").trim());
}

function isAudioAssetValue(value) {
  return /\.(mp3|wav|m4a|ogg)(\?.*)?$/i.test(String(value ?? "").trim());
}

function splitAssetList(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  if (raw.includes("|") || raw.includes("\n")) {
    return splitStemLines(raw);
  }
  return [raw];
}

function getAssetBaseUrl(testVersion, assetType) {
  if (!SUPABASE_URL || !testVersion) return "";
  const test = testsState.list.find((t) => t.version === testVersion);
  const type = test?.type || "mock";
  return `${SUPABASE_URL}/storage/v1/object/public/test-assets/${type}/${testVersion}/${assetType}/`;
}

function resolveAssetUrl(value, testVersion) {
  const raw = String(value ?? "").trim();
  if (!raw) return raw;
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.includes("/")) return raw;
  const isAudio = /\.(mp3|wav|m4a|ogg)$/i.test(raw);
  const isImage = /\.(png|jpe?g|webp)$/i.test(raw);
  if (!isAudio && !isImage) return raw;
  const assetType = isAudio ? "audio" : "image";
  const base = getAssetBaseUrl(testVersion, assetType);
  return base ? `${base}${raw}` : raw;
}

function normalizeQuestionAssets(q, version) {
  const next = { ...q };
  if (next.stemAsset) {
    const assets = splitAssetList(next.stemAsset).map((v) => resolveAssetUrl(v, version));
    next.stemAsset = assets.join("|");
  }
  if (next.stemKind === "dialog") {
    const parts = splitAssetList(next.stemAsset);
    const hasImage = parts.some((p) => isImageChoiceValue(p));
    if (!hasImage) {
      const legacy = legacyQuestionMap.get(next.id);
      const legacyImage = legacy?.image || legacy?.stemImage || null;
      if (legacyImage) {
        parts.push(legacyImage);
        next.stemAsset = parts.filter(Boolean).join("|");
      }
    }
  }
  if (next.stemKind === "audio") {
    const parts = splitAssetList(next.stemAsset);
    const hasImage = parts.some((p) => isImageChoiceValue(p));
    if (!hasImage) {
      const legacy = legacyQuestionMap.get(next.id);
      const legacyImage = legacy?.stemImage || legacy?.image || legacy?.passageImage || null;
      if (legacyImage) {
        parts.push(legacyImage);
        next.stemAsset = parts.filter(Boolean).join("|");
      }
    }
  }
  if (Array.isArray(next.choices)) {
    next.choices = next.choices.map((v) => resolveAssetUrl(v, version));
  }
  return next;
}


function getCurrentSection() {
  const active = getActiveSections();
  if (active.length === 0) return sections[state.sectionIndex] || sections[0];
  if (state.sectionIndex >= active.length) {
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    saveState();
  }
  return active[state.sectionIndex];
}
function getSectionQuestions(sectionKey) {
  const list = getQuestions()
    .filter((q) => q.sectionKey === sectionKey)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  const groups = [];
  const map = new Map();
  for (const q of list) {
    const key = q.qid || q.id;
    let group = map.get(key);
    if (!group) {
      group = { key, items: [], orderIndex: q.orderIndex ?? 0 };
      map.set(key, group);
      groups.push(group);
    }
    group.items.push(q);
    if (q.orderIndex != null && q.orderIndex < group.orderIndex) {
      group.orderIndex = q.orderIndex;
    }
  }
  for (const group of groups) {
    group.items.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }
  return groups.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

function getActiveSections() {
  const all = sections ?? [];
  const list = getQuestions();
  if (!list || list.length === 0) return all;
  const keys = new Set(list.map((q) => q.sectionKey).filter(Boolean));
  return all.filter((s) => keys.has(s.key));
}
function getCurrentQuestion() {
  const sec = getCurrentSection();
  const qs = getSectionQuestions(sec.key);
  return qs[state.questionIndexInSection];
}

function startTestTimer() {
  if (state.testStartAt) return;      // すでに開始してたら何もしない
  state.testStartAt = Date.now();
  state.focusWarnings = 0;
  state.focusWarningAt = 0;
  saveState();
}



function getTotalTimeLeftSec() {
  const base = state.testEndAt ?? Date.now(); // ★結果なら endAt で固定
  if (!state.testStartAt) return TOTAL_TIME_SEC;
  const elapsed = Math.floor((base - state.testStartAt) / 1000);
  return Math.max(0, TOTAL_TIME_SEC - elapsed);
}



function formatTime(sec) {
  const hh = String(Math.floor(sec / 3600)).padStart(2, "0");
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function countAnsweredAll() {
  return Object.keys(state.answers).length;
}

function scoreAll() {
  let correct = 0;
  const list = getQuestions();
  for (const q of list) {
    const ans = state.answers[q.id];
    if (ans === q.answerIndex) correct++;
  }
  const total = list.length;
  return { correct, total };
}

function toggleBangla() {
  state.showBangla = !state.showBangla;
  saveState();
  render();
}

/** ===== Answer setters ===== */
function setSingleAnswer(questionId, choiceIndex) {
  state.answers = { ...state.answers, [questionId]: choiceIndex };
  saveState();
  render();
}

function setPartAnswer(questionId, partIdx, choiceIndex) {
  const cur = state.answers[questionId];
  const partAnswers = cur?.partAnswers ? [...cur.partAnswers] : [];
  partAnswers[partIdx] = choiceIndex;
  state.answers = { ...state.answers, [questionId]: { partAnswers } };
  saveState();
  render();
}

/** ===== Navigation ===== */
function jumpToQuestionInSection(idx) {
  const sec = getCurrentSection();
  const qs = getSectionQuestions(sec.key);
  state.questionIndexInSection = Math.max(0, Math.min(idx, qs.length - 1));
  saveState();
  render();
}
function goPrevQuestion() {
  state.questionIndexInSection = Math.max(0, state.questionIndexInSection - 1);
  saveState();
  render();
}

function goNextQuestionOrEnd() {
  const sec = getCurrentSection();
  const qs = getSectionQuestions(sec.key);
  const next = state.questionIndexInSection + 1;

  if (next >= qs.length) {
    goNextSectionOrResult(); // ←ここが超大事
    return;
  }

  state.questionIndexInSection = next;
  saveState();
  render();
}




function finishSection() {
  goNextSectionOrResult();
}

function goNextSectionOrResult() {
  const activeSections = getActiveSections();
  const nextSectionIndex = state.sectionIndex + 1;

  // 最後のセクションが終わったら結果へ
  if (nextSectionIndex >= activeSections.length) {
  state.testEndAt = state.testEndAt ?? Date.now(); // ★固定
  state.phase = "result";
  saveState();
  render();
  return;
  }


  // 次セクションへ
  state.sectionIndex = nextSectionIndex;
  state.questionIndexInSection = 0;

  // セクションIntroを毎回出したいので quiz にはしない
  state.phase = "sectionIntro";

  saveState();
  render();
}


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

async function saveAttemptIfNeeded() {
  if (state.attemptSaved) return;
  const statusEl = document.querySelector("#saveStatus");
  if (statusEl) statusEl.textContent = "Saving...";

  const { correct, total } = scoreAll();
  const scoreRate = total === 0 ? 0 : correct / total;
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId || null;
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
    answers_json: state.answers ?? {},
    link_id: state.linkId,
  };

  const { error } = await supabase.from("attempts").insert(payload);
  if (error) {
    console.error("saveAttempt error:", error);
    if (statusEl) statusEl.textContent = `Save failed: ${error.message}`;
    return;
  }

  state.attemptSaved = true;
  studentResultsState.loaded = false;
  saveState();
  if (statusEl) statusEl.textContent = "Saved";
}

/** ===== UI helpers ===== */
function topbarHTML({ rightButtonLabel = "Finish Test", rightButtonId = "finishBtn", hideTimer = false } = {}) {
  const sec = getCurrentSection();
  const hideQA =
    state.phase === "intro" ||
    state.phase === "sectionIntro" ||
    state.phase === "result";
  // intro / sectionIntro / result などで「セクション表示を出さない」モード

  const testType = getActiveTestType();
  const testTitle = getActiveTestTitle();
  const testLabel =
    testType === "daily"
      ? (testTitle?.trim() || "Daily Test")
      : "Test: Japan Foundation Test for Basic Japanese";
  const metaHtml = hideQA
    ? `<div><span class="muted">Question:</span> <b>—</b></div>
       <div><span class="muted">Section:</span> <b>—</b></div>`
    : `<div><span class="muted">Question:</span> <b>${state.questionIndexInSection + 1}</b></div>
       <div><span class="muted">Section:</span> <b>${sec?.title ?? "—"}</b></div>`;
  const timerHtml = hideTimer
    ? ""
    : `
        <div class="timer-label">Test Time Remaining</div>
        <div class="timer">${formatTime(getTotalTimeLeftSec())}</div>
      `;

  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-meta">
          ${metaHtml}
        </div>
        <div class="topbar-test">${escapeHtml(testLabel)}</div>
      </div>

      <div class="topbar-center">
        ${timerHtml}
      </div>

      <div class="topbar-right">
        <button class="finish-btn" id="${rightButtonId}">${rightButtonLabel}</button>
        <div class="candidate">
          Candidate: <b>${renderCandidateLabel()}</b>
        </div>
      </div>
    </header>
  `;
}

function setStudentMenuOpen(isOpen) {
  const overlay = document.querySelector("#studentMenuOverlay");
  const btn = document.querySelector("#studentMenuBtn");
  if (!overlay || !btn) return;
  btn.setAttribute("aria-expanded", String(isOpen));
  overlay.hidden = !isOpen;
}

function closeStudentMenu() {
  setStudentMenuOpen(false);
}

function registerStudentMenu() {
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const overlay = document.querySelector("#studentMenuOverlay");
    const menu = document.querySelector("#studentMenu");
    const btn = document.querySelector("#studentMenuBtn");
    if (!overlay || !menu || !btn) return;

    const clickedButton = event.target.closest("#studentMenuBtn");
    const clickedMenu = event.target.closest("#studentMenu");
    const clickedTab = event.target.closest("[data-student-tab]");
    const clickedClose = event.target.closest("[data-student-menu-close]");

    if (clickedClose) {
      closeStudentMenu();
      return;
    }

    if (clickedTab) {
      const nextTab = clickedTab.dataset.studentTab || "home";
      state.studentTab = nextTab;
      resultDetailState.open = false;
      resultDetailState.mode = "";
      resultDetailState.subTab = "score";
      resultDetailState.attempt = null;
      saveState();
      closeStudentMenu();
      if ((nextTab === "dailyResults" || nextTab === "modelResults") && !studentResultsState.loaded) {
        fetchStudentResults().finally(render);
        return;
      }
      if (nextTab === "attendance" && !studentAttendanceState.loaded) {
        fetchStudentAttendance().finally(render);
        return;
      }
      render();
      return;
    }

    if (clickedButton) {
      setStudentMenuOpen(overlay.hidden);
      return;
    }

    if (!overlay.hidden && !clickedMenu) {
      closeStudentMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeStudentMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeStudentMenu();
  });
}


function banglaButtonHTML() {
  if (getActiveTestType() === "daily") return "";
  return `
    <div class="lang-buttons">
      <button class="lang-btn" id="banglaBtn">
        ${state.showBangla ? "✓ " : ""}Bangla
      </button>
    </div>
  `;
}

function focusWarningHTML() {
  if (!state.focusWarnings) return "";
  return `
    <div class="focus-warning">
      <b>Warning:</b> You left the exam tab. Count: ${state.focusWarnings}
    </div>
  `;
}

function promptBoxHTML(q, opts = {}) {
  const showPrompt = opts.showPrompt !== false;
  const includeStemInPrompt = Boolean(opts.includeStemInPrompt);
  const includeBoxTextInPrompt = Boolean(opts.includeBoxTextInPrompt);
  const main = q.promptEn ?? "";
  const sub = q.promptBn ?? "";
  const lines = [];
  if (showPrompt && main) lines.push(`<div class="prompt">${escapeHtml(main)}</div>`);
  if (showPrompt && state.showBangla && sub) lines.push(`<div class="prompt-sub">${escapeHtml(sub)}</div>`);
  if (includeStemInPrompt) {
    const stemLines = splitStemLines(q.stemText || q.stemExtra || "");
    if (stemLines.length) {
      lines.push(
        `<div class="sv-stem">${stemLines
          .map((l) => `<div class="jp-sentence">${renderUnderlines(l)}</div>`)
          .join("")}</div>`
      );
    }
  }
  if (includeBoxTextInPrompt && q.boxText) {
    const subPrefix = q.subId && q.subId !== "N/A" ? `(${q.subId}) ` : "";
    const jpClass = q.sectionKey === "LC" || q.sectionKey === "RC" ? "jp-sentence jp-bold" : "jp-sentence";
    lines.push(`<div class="${jpClass}">${renderUnderlines(`${subPrefix}${q.boxText}`)}</div>`);
  }
  if (!lines.length) return "";
  return `<div class="blue-box">${lines.join("")}</div>`;
}

/** ===== Render question blocks by type ===== */
function getChoices(q) {
  const raw = Array.isArray(q.choices)
    ? q.choices
    : Array.isArray(q.choicesJa)
      ? q.choicesJa
      : [];
  return raw
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter((v) => v && v.toUpperCase() !== "N/A");
}

function isJapaneseText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(String(value ?? ""));
}

function renderChoicesText(q, choices) {
  const chosen = state.answers[q.id];
  return `
    <div class="choices">
      ${choices.map((c, i) => {
        const sel = chosen === i ? "selected" : "";
        const jp = isJapaneseText(c) ? "jp" : "";
        return `<button class="choice ${sel} ${jp}" data-choice="${i}" data-qid="${q.id}">${escapeHtml(c)}</button>`;
      }).join("")}
    </div>
  `;
}

function renderChoicesImages(q, choices) {
  const chosen = state.answers[q.id];
  return `
    <div class="img-choice-grid">
      ${choices.map((src, i) => {
        const sel = chosen === i ? "selected" : "";
        return `
          <button class="img-choice ${sel}" data-choice="${i}" data-qid="${q.id}">
            <img src="${src}" alt="choice ${i + 1}" />
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderStemHTML(q, opts = {}) {
  if (opts.skipStem) return "";
  const isDaily = getActiveTestType() === "daily";
  const parts = [];
  if (q.stemKind === "dialog") {
    const lines = splitStemLinesPreserveIndent(q.stemExtra || q.stemText || "");
    const dialogLines = lines.length
      ? `<div class="dialog-lines">${lines.map((l) => `<div class="dialog-line">${renderUnderlines(l)}</div>`).join("")}</div>`
      : "";
    const assets = splitAssetList(q.stemAsset).filter(Boolean);
    if (assets.length) {
      parts.push(`
        <div class="dialog-row">
          ${dialogLines}
          <div class="dialog-img">
            ${assets.map((src) => `<img src="${src}" alt="dialog" />`).join("")}
          </div>
        </div>
      `);
    } else if (dialogLines) {
      parts.push(dialogLines);
    }
  } else {
    if (!opts.skipStemText && q.stemText) {
      parts.push(`<div class="stem-text">${renderUnderlines(q.stemText)}</div>`);
    }
    if (!opts.skipStemExtra && q.stemExtra) {
      const lines = splitStemLines(q.stemExtra);
      if (lines.length) {
        parts.push(
          `<div class="stem-extra">${lines.map((l) => `<div>${renderUnderlines(l)}</div>`).join("")}</div>`
        );
      }
    }
  }

  if (q.stemKind === "audio" && q.stemAsset) {
    const assets = splitAssetList(q.stemAsset);
    const audioAssets = assets.filter((src) => isAudioAssetValue(src));
    const imageAssets = assets.filter((src) => isImageChoiceValue(src));
    const imgClass = isDaily
      ? "illustration illustration-daily"
      : q.sectionKey === "CE"
        ? "illustration illustration-wide"
        : q.sectionKey === "SV"
          ? "illustration illustration-small"
          : "illustration";
    const imgWrapClass = q.sectionKey === "LC" ? "question-area left" : "question-area";
    if (audioAssets.length) {
      parts.push(`
        <div style="margin:10px 0 12px;">
          ${audioAssets.map((src) => `<audio controls preload="auto" src="${src}"></audio>`).join("")}
        </div>
      `);
    }
    if (imageAssets.length) {
      parts.push(`
        <div class="${imgWrapClass}">
          ${imageAssets.map((src) => `<img class="${imgClass}" src="${src}" alt="stem" />`).join("")}
        </div>
      `);
    }
  }
  if (["image", "passage_image", "table_image"].includes(q.stemKind) && q.stemAsset) {
    const assets = splitAssetList(q.stemAsset);
    const cls = isDaily
      ? "illustration illustration-daily"
      : q.stemKind === "image"
        ? q.sectionKey === "CE"
          ? "illustration illustration-wide"
          : q.sectionKey === "SV"
            ? "illustration illustration-small"
            : "illustration"
        : "passage-img";
    parts.push(`
      <div class="question-area">
        ${assets.map((src) => `<img class="${cls}" src="${src}" alt="stem" />`).join("")}
      </div>
    `);
  }
  if (!q.stemKind && q.stemAsset && isAudioAssetValue(q.stemAsset)) {
    parts.push(`
      <div style="margin:10px 0 12px;">
        <audio controls preload="auto" src="${q.stemAsset}"></audio>
      </div>
    `);
  }
  if (!q.stemKind && q.stemAsset && isImageChoiceValue(q.stemAsset)) {
    parts.push(`
      <div class="question-area">
        <img class="${isDaily ? "illustration illustration-daily" : "illustration"}" src="${q.stemAsset}" alt="stem" />
      </div>
    `);
  }
  if (!opts.skipBoxText && q.boxText) {
    parts.push(`<div class="boxed">${renderUnderlines(q.boxText)}</div>`);
  }
  return parts.join("");
}

function questionBodyHTML(q, opts = {}) {
  const choices = getChoices(q);
  const hasImageChoices = choices.length > 0 && choices.every((c) => isImageChoiceValue(c));
  return `
    ${renderStemHTML(q, opts)}
    ${choices.length ? (hasImageChoices ? renderChoicesImages(q, choices) : renderChoicesText(q, choices)) : ""}
  `;
}

function hasSharedPrompt(items) {
  if (!items.length) return null;
  const first = items[0];
  const key = `${first.promptEn ?? ""}|||${first.promptBn ?? ""}`;
  if (!key.trim()) return null;
  for (const item of items) {
    const cur = `${item.promptEn ?? ""}|||${item.promptBn ?? ""}`;
    if (cur !== key) return null;
  }
  return first;
}

function getSharedStem(items) {
  if (items.length < 2) return null;
  const first = items[0];
  const keys = ["stemKind", "stemText", "stemExtra", "stemAsset"];
  for (const item of items) {
    for (const k of keys) {
      if ((item[k] ?? null) !== (first[k] ?? null)) return null;
    }
  }
  if (!first.stemKind && !first.stemText && !first.stemExtra && !first.stemAsset) return null;
  return first;
}

function renderQuestionBlock(q, opts = {}) {
  const promptBox = promptBoxHTML(q, opts);
  const body = questionBodyHTML(q, opts);
  return `<div class="question-block">${promptBox}${body}</div>`;
}

function renderQuestionGroupHTML(group) {
  const items = group?.items ?? [];
  if (!items.length) return `<div class="placeholder">No question</div>`;

  if (items.length === 1) {
    const q = items[0];
    const includeStemInPrompt = q.sectionKey === "SV";
    const includeBoxTextInPrompt = !q.promptEn && Boolean(q.boxText);
    const promptBox = promptBoxHTML(q, {
      showPrompt: true,
      includeStemInPrompt,
      includeBoxTextInPrompt,
    });
    const body = questionBodyHTML(q, {
      skipStemText: includeStemInPrompt,
      skipBoxText: includeBoxTextInPrompt,
    });
    return `
      ${promptBox}
      ${banglaButtonHTML()}
      <div class="question-block">${body}</div>
    `;
  }

  const sharedPrompt = hasSharedPrompt(items);
  const sharedStem = getSharedStem(items);
  const blocks = [];

  if (sharedPrompt) {
    const promptBox = promptBoxHTML(sharedPrompt, { showPrompt: true });
    if (promptBox) blocks.push(promptBox);
  }
  blocks.push(banglaButtonHTML());

  if (sharedStem) {
    blocks.push(renderStemHTML({ ...sharedStem, boxText: null }, { skipBoxText: true }));
  }

  items.forEach((q) => {
    const includeStemInPrompt = q.sectionKey === "SV";
    const includeBoxTextInPrompt = Boolean(q.boxText);
    const showPrompt = !sharedPrompt;
    blocks.push(
      renderQuestionBlock(q, {
        showPrompt,
        includeStemInPrompt,
        includeBoxTextInPrompt,
        skipStemText: includeStemInPrompt,
        skipBoxText: includeBoxTextInPrompt,
        skipStem: Boolean(sharedStem),
      })
    );
  });

  return blocks.join("");
}

/** ===== Sidebar ===== */
function sidebarHTML() {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const questionCount = secQs.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  return `
    <aside class="sidebar">
      <div class="side-title">intro</div>
      <div class="step-list">
        ${secQs
          .map((_, idx) => {
            const active = idx === state.questionIndexInSection ? "active" : "";
            return `
              <button class="step ${active}" data-step="${idx}">
                <span class="step-num">${idx + 1}</span>
                <span class="step-arrow"></span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="side-rail"></div>
    </aside>
  `;
}

/** ===== Renders ===== */
function renderIntro(app) {
  const activeSections = getActiveSections();
  const activeVersion = getActiveTestVersion();
  const activeTitle = getActiveTestTitle();
  const isGuest = !authState.session;
  const isDaily = getActiveTestType() === "daily";
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
                    testSessionsState.list.length
                      ? testSessionsState.list
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
                  testSessionsState.loaded && testSessionsState.list.length === 0
                    ? `<div style="margin-top:6px;color:#666;">公開テストがありません。</div>`
                    : ""
                }
              `
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

  const disabledBtn = document.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;

  const testSelect = document.querySelector("#testSelect");
  if (testSelect) {
    testSelect.addEventListener("change", () => {
      state.selectedTestSessionId = testSelect.value;
      const session = testSessionsState.list.find((s) => s.id === testSelect.value);
      if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      saveState();
      render();
    });
  }

  document.querySelector("#nextBtn").addEventListener("click", () => {
    if (isGuest) {
      const name = document.querySelector("#nameInput").value.trim();
      const id = document.querySelector("#idInput").value.trim();
      state.user = { name, id };
    }
    state.phase = "sectionIntro";
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;

    saveState();
    render();
  });

  document.querySelector("#signOutBtn")?.addEventListener("click", () => {
    supabase.auth.signOut();
    state.requireLogin = true;
    state.phase = "login";
    saveState();
    render();
  });
  document.querySelector("#loginNavBtn")?.addEventListener("click", () => {
    state.phase = "login";
    saveState();
    render();
  });
  document.querySelector("#resetBtn").addEventListener("click", resetAll);
}

function renderTestSelect(app) {
  const activeSections = getActiveSections();
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId;
  const isGuest = !authState.session;
  const showTabs = Boolean(authState.session);
  const activeTab = showTabs ? state.studentTab : "take";
  const showHome = showTabs && activeTab === "home";
  const showDailyResults = showTabs && activeTab === "dailyResults";
  const showModelResults = showTabs && activeTab === "modelResults";
  const showAttendance = showTabs && activeTab === "attendance";
  const showTakeTest = !showTabs;
  const canStart = activeSections.length > 0;

  if (showAttendance && authState.session && !studentAttendanceState.loaded && !studentAttendanceState.loading) {
    fetchStudentAttendance().finally(render);
  }
  if (showAttendance && !absenceApplicationsState.loaded && !absenceApplicationsState.loading) {
    fetchAbsenceApplications().finally(render);
  }
  if (showHome && authState.session && !studentAttendanceState.loaded && !studentAttendanceState.loading) {
    fetchStudentAttendance().finally(render);
  }
  if (showHome && !announcementsState.loaded && !announcementsState.loading) {
    fetchAnnouncements().finally(render);
  }
  if ((showDailyResults || showModelResults) && authState.session && !studentResultsState.loaded && !studentResultsState.loading) {
    fetchStudentResults().finally(render);
  }
  if (showModelResults && studentResultsState.loaded && !modelRankState.loaded && !modelRankState.loading) {
    const modelAttempts = (studentResultsState.list ?? []).filter((a) => getAttemptTestType(a) === "mock");
    fetchModelRanks(modelAttempts).finally(render);
  }

  const welcomeName =
    (state.user?.name || authState.profile?.display_name || authState.session?.user?.email || "Student")
      .trim();

  const studentInfoHtml = showTabs
    ? `
        <header class="student-topbar">
          <div class="student-topbar-brand" id="studentLogoHome">
            <div class="student-topbar-title">
              <svg viewBox="0 0 24 24" class="student-topbar-icon" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"></circle>
                <path
                  d="M6.3 11.1 16.8 7.4 14 17.9 11.7 12.3 6.3 11.1Z"
                  fill="currentColor"
                ></path>
              </svg>
              <span>JFT Navi</span>
            </div>
          </div>
          <div class="student-topbar-spacer"></div>
          <span class="student-topbar-name">${escapeHtml(welcomeName)}</span>
          <button class="menu-btn student-menu-btn" id="studentMenuBtn" aria-expanded="false" aria-controls="studentMenu" aria-label="Open menu">☰</button>
        </header>
        <div class="student-menu-overlay" id="studentMenuOverlay" hidden>
          <nav class="student-menu-panel" id="studentMenu" aria-label="Student menu">
            <div class="student-menu-header">
              <button class="student-menu-close" type="button" data-student-menu-close aria-label="Close menu">×</button>
            </div>
            <button class="student-menu-item" data-student-tab="home">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Home
            </button>
            <button class="student-menu-item" data-student-tab="dailyResults">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M7 4v3M17 4v3M4 9h16M5 12h6M5 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Daily Test Results
            </button>
            <button class="student-menu-item" data-student-tab="modelResults">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Model Test Results
            </button>
            <button class="student-menu-item" data-student-tab="attendance">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Attendance
            </button>
            <div class="student-menu-spacer"></div>
            <button class="student-menu-item student-menu-logout" id="signOutBtn">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M9 6h6M9 18h6M14 6v12M5 12h10M5 12l3-3M5 12l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              Sign out
            </button>
          </nav>
        </div>
      `
    : "";

  const renderDetailTable = (rows, showAnswers) => {
    if (!rows?.length) {
      return `<div class="text-muted">No details available.</div>`;
    }
    return `
      <div class="detail-table-wrap">
        <table class="detail-table wide">
          <thead>
            <tr>
              <th>No.</th>
              <th class="col-question">Question</th>
              <th>Chosen</th>
              ${showAnswers ? "<th>Correct</th>" : ""}
              <th>Correct?</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r, idx) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td class="cell-question">
                      <div class="detail-question">
                        <div class="detail-question-text">${escapeHtml(r.prompt)}</div>
                        ${r.thumb ? `<img class="detail-question-thumb" src="${r.thumb}" alt="q" />` : ""}
                      </div>
                    </td>
                    <td>${escapeHtml(r.chosen || "—")}</td>
                    ${showAnswers ? `<td>${escapeHtml(r.correct || "—")}</td>` : ""}
                    <td style="text-align:center;">${r.isCorrect ? "○" : "×"}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  };

  const dailyResultsHtml = showDailyResults
    ? (() => {
        if (!authState.session) {
          return `<div class="text-muted">Log in to see results.</div>`;
        }
        if (studentResultsState.loading) {
          return `<div class="text-muted">Loading results...</div>`;
        }
        if (studentResultsState.error) {
          return `<div class="text-error">${escapeHtml(studentResultsState.error)}</div>`;
        }

        const dailyAttempts = (studentResultsState.list ?? []).filter(
          (attempt) => getAttemptTestType(attempt) === "daily"
        );
        const dailyCategories = Array.from(
          new Set(
            (testsState.list ?? [])
              .filter((t) => t.type === "daily")
              .map((t) => getAttemptCategory({ test_version: t.version }))
          )
        ).filter(Boolean);
        const categoryFilter = state.dailyResultsCategory || "";
        const filteredAttempts = categoryFilter
          ? dailyAttempts.filter((a) => getAttemptCategory(a) === categoryFilter)
          : dailyAttempts;

        if (resultDetailState.open && resultDetailState.mode === "daily" && resultDetailState.attempt) {
          const attempt = resultDetailState.attempt;
          const title = getAttemptTitle(attempt);
          const showAnswers = shouldShowAnswers(attempt);
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

        if (!filteredAttempts.length) {
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
                ${filteredAttempts
                  .map((attempt) => {
                    const rate = getScoreRateFromAttempt(attempt);
                    const passRate = getPassRateForVersion(attempt.test_version);
                    const isPass = rate >= passRate;
                    return `
                      <tr class="student-results-row" data-daily-attempt-id="${attempt.id}">
                        <td>${escapeHtml(getAttemptDateLabel(attempt))}</td>
                        <td>${escapeHtml(getAttemptTitle(attempt))}</td>
                        <td>${Number(attempt.correct) || 0} / ${Number(attempt.total) || 0}</td>
                        <td>${(rate * 100).toFixed(1)}%</td>
                        <td class="${isPass ? "result-pass-cell" : "result-fail-cell"}">${isPass ? "Pass" : "Fail"}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      })()
    : "";

  const modelResultsHtml = showModelResults
    ? (() => {
        if (!authState.session) {
          return `<div class="text-muted">Log in to see results.</div>`;
        }
        if (studentResultsState.loading) {
          return `<div class="text-muted">Loading results...</div>`;
        }
        if (studentResultsState.error) {
          return `<div class="text-error">${escapeHtml(studentResultsState.error)}</div>`;
        }
        const modelAttempts = (studentResultsState.list ?? []).filter(
          (attempt) => getAttemptTestType(attempt) === "mock"
        );

        if (resultDetailState.open && resultDetailState.mode === "model" && resultDetailState.attempt) {
          const attempt = resultDetailState.attempt;
          const title = getAttemptTitle(attempt);
          const showAnswers = shouldShowAnswers(attempt);
          const questionsList = resultDetailState.questionsByVersion[attempt.test_version] || [];
          const detailRows = buildAttemptDetailRows(attempt, questionsList);
          const summary = buildSectionSummary(detailRows);
          const subTab = resultDetailState.subTab || "score";
          let detailBody = "";
          if (resultDetailState.loading) {
            detailBody = `<div class="text-muted">Loading details...</div>`;
          } else if (resultDetailState.error) {
            detailBody = `<div class="text-error">${escapeHtml(resultDetailState.error)}</div>`;
          } else if (subTab === "score") {
            detailBody = summary.length
              ? `
                <div class="detail-table-wrap">
                  <table class="detail-table">
                    <thead>
                      <tr>
                        <th>Section</th>
                        <th>Correct</th>
                        <th>Total</th>
                        <th>%</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${summary
                        .map(
                          (s) => `
                            <tr>
                              <td>${escapeHtml(s.section)}</td>
                              <td>${s.correct}</td>
                              <td>${s.total}</td>
                              <td>${(s.rate * 100).toFixed(1)}%</td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              `
              : `<div class="text-muted">No score data.</div>`;
          } else if (subTab === "wrong") {
            const wrongRows = detailRows.filter((r) => !r.isCorrect);
            detailBody = wrongRows.length
              ? renderDetailTable(wrongRows, showAnswers)
              : `<div class="text-muted">No wrong questions.</div>`;
          } else {
            detailBody = renderDetailTable(detailRows, showAnswers);
          }
          return `
            <div class="student-detail-topbar">
              <button class="student-detail-back" id="modelResultBack" aria-label="Back">←</button>
              <div class="student-detail-title">${escapeHtml(title)}</div>
            </div>
            <div class="student-detail-tabs">
              <button class="student-detail-tab ${subTab === "score" ? "active" : ""}" data-model-detail-tab="score">Score Details</button>
              <button class="student-detail-tab ${subTab === "all" ? "active" : ""}" data-model-detail-tab="all">All Questions</button>
              <button class="student-detail-tab ${subTab === "wrong" ? "active" : ""}" data-model-detail-tab="wrong">Wrong Questions</button>
            </div>
            <div class="student-detail-body">
              ${detailBody}
            </div>
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
                  <th>Model Test Name</th>
                  <th>Total Score</th>
                  <th>Total %</th>
                  <th>Pass/Fail</th>
                  <th>Class Rank</th>
                </tr>
              </thead>
              <tbody>
                ${modelAttempts
                  .map((attempt) => {
                    const rate = getScoreRateFromAttempt(attempt);
                    const passRate = getPassRateForVersion(attempt.test_version);
                    const isPass = rate >= passRate;
                    const rank = modelRankState.map[attempt.id] || "—";
                    return `
                      <tr class="student-results-row" data-model-attempt-id="${attempt.id}">
                        <td>${escapeHtml(getAttemptDateLabel(attempt))}</td>
                        <td>${escapeHtml(getAttemptTitle(attempt))}</td>
                        <td>${Number(attempt.correct) || 0} / ${Number(attempt.total) || 0}</td>
                        <td>${(rate * 100).toFixed(1)}%</td>
                        <td class="${isPass ? "result-pass-cell" : "result-fail-cell"}">${isPass ? "Pass" : "Fail"}</td>
                        <td>${escapeHtml(String(rank))}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `;
      })()
    : "";

  const homeWarningHtml = showHome
    ? (() => {
        if (!studentAttendanceState.loaded || !studentAttendanceState.list.length) return "";
        const total = studentAttendanceState.list.length;
        const present = studentAttendanceState.list.filter((r) => r.status === "P" || r.status === "L").length;
        const unexcused = studentAttendanceState.list.filter((r) => r.status === "A").length;
        const rate = total ? (present / total) * 100 : 0;
        const warnings = [];
        if (rate < 80) warnings.push(`Attendance below 80% (${rate.toFixed(1)}%).`);
        if (unexcused >= 3) warnings.push(`Unexcused absences: ${unexcused}.`);
        if (!warnings.length) return "";
        return `
          <div class="student-warning-title">Warning</div>
          <ul class="student-warning-list">
            ${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}
          </ul>
        `;
      })()
    : "";

  const homeHtml = showHome
    ? (() => {
        const todayKey = getBdtDateKey(new Date());
        const sessions = (testSessionsState.list ?? [])
          .filter((s) => s?.starts_at && s.is_published)
          .filter((s) => getBdtDateKey(s.starts_at) === todayKey);
        if (!testSessionsState.loaded) {
          return `<div class="text-muted">Loading today's tests...</div>`;
        }
        const noTestsHtml = !sessions.length
          ? `<div class="text-muted">No tests scheduled for today.</div>`
          : "";
        const nowMs = Date.now();
        return `
          <section class="home-card">
            <div class="student-home-title">Today's Tests</div>
            <div class="student-home-list">
              ${sessions
                .map((session) => {
                  const startLabel = formatTimeBdt(session.starts_at);
                  const name = session.title || session.problem_set_id || "Test";
                  const startMs = new Date(session.starts_at).getTime();
                  const alreadyTaken =
                    studentResultsState.loaded &&
                    !allowMultipleAttempts(session) &&
                    hasAttemptForSession(session.id);
                  const canStart = Number.isFinite(startMs) && nowMs >= startMs && !alreadyTaken;
                  return `
                    <div class="student-home-card">
                      <div>
                        <div class="student-home-time">${escapeHtml(startLabel)}</div>
                        <div class="student-home-name">${escapeHtml(name)}</div>
                      </div>
                      <button
                        class="student-home-start ${canStart ? "" : "disabled"}"
                        data-session-id="${escapeHtml(session.id)}"
                        ${canStart ? "" : "disabled"}
                      >
                        ${alreadyTaken ? "Completed" : "Start"}
                      </button>
                    </div>
                  `;
                })
                .join("")}
            </div>
            ${noTestsHtml}
          </section>
        `;
      })()
    : "";

  const announcementHtml = showHome
    ? (() => {
        if (!announcementsState.loaded) {
          return `<div class="text-muted">Loading announcements...</div>`;
        }
        if (announcementsState.error) {
          return `<div class="text-error">${escapeHtml(announcementsState.error)}</div>`;
        }
        if (!announcementsState.list.length) {
          return `<div class="text-muted">No announcements.</div>`;
        }
        return `
          <section class="home-card">
            <div class="student-home-title student-home-title-icon">
              <span class="student-home-title-icon-svg" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M6 8a6 6 0 1 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              Announcements
            </div>
            <div class="student-announcement-list">
              ${announcementsState.list
                .map(
                  (a) => `
                    <div class="student-announcement-card">
                      <div class="student-announcement-title">${escapeHtml(a.title)}</div>
                      <div class="student-announcement-date">${escapeHtml(formatDateShort(a.publish_at || a.created_at))}</div>
                      <div class="student-announcement-body">${escapeHtml(a.body)}</div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </section>
        `;
      })()
    : "";

  const attendanceHtml = showAttendance
    ? (() => {
        if (!authState.session) {
          return `<div class="text-muted">Log in to see attendance.</div>`;
        }
        if (studentAttendanceState.loading) {
          return `<div class="text-muted">Loading attendance...</div>`;
        }
        if (studentAttendanceState.error) {
          return `<div class="text-error">${escapeHtml(studentAttendanceState.error)}</div>`;
        }
        if (!studentAttendanceState.list.length) {
          return `<div class="text-muted">No attendance records.</div>`;
        }
        const summary = buildAttendanceSummary(studentAttendanceState.list);
        return `
          <section class="home-card">
            <div class="student-application-header">
              <div class="student-home-title">Submit Application</div>
              <a class="student-application-view" href="#applicationHistory">View All →</a>
            </div>
            <div class="student-application-actions">
              <button class="btn" id="openExcusedApp">Excused Absence</button>
              <button class="btn" id="openLateApp">Late / Leave Early</button>
            </div>
          </section>
          <div class="detail-section">
            <div class="detail-title">Summary</div>
            <div class="detail-table-wrap">
              <table class="detail-table wide">
                <thead>
                  <tr>
                    <th></th>
                    <th>Overall</th>
                    ${summary.months.map((m) => `<th>${escapeHtml(m.label)}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Attendance %</td>
                    <td>${summary.overall.rate == null ? "N/A" : `${summary.overall.rate.toFixed(2)}%`}</td>
                    ${summary.months.map((m) => `<td>${m.stats.rate == null ? "N/A" : `${m.stats.rate.toFixed(2)}%`}</td>`).join("")}
                  </tr>
                  <tr>
                    <td>Total Days</td>
                    <td>${summary.overall.total || "-"}</td>
                    ${summary.months.map((m) => `<td>${m.stats.total || "-"}</td>`).join("")}
                  </tr>
                  <tr>
                    <td>Present (Days)</td>
                    <td>${summary.overall.present || "-"}</td>
                    ${summary.months.map((m) => `<td>${m.stats.present || "-"}</td>`).join("")}
                  </tr>
                  <tr>
                    <td>Late/Left early (Days)</td>
                    <td>${summary.overall.late || "-"}</td>
                    ${summary.months.map((m) => `<td>${m.stats.late || "-"}</td>`).join("")}
                  </tr>
                  <tr>
                    <td>Excused Absence (Days)</td>
                    <td>${summary.overall.excused || "-"}</td>
                    ${summary.months.map((m) => `<td>${m.stats.excused || "-"}</td>`).join("")}
                  </tr>
                  <tr>
                    <td>Unexcused Absence (Days)</td>
                    <td>${summary.overall.unexcused || "-"}</td>
                    ${summary.months.map((m) => `<td>${m.stats.unexcused || "-"}</td>`).join("")}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="detail-section">
            <div class="detail-title">Daily Records</div>
            <div class="detail-table-wrap">
              <table class="detail-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  ${studentAttendanceState.list
                    .map(
                      (r) => `
                        <tr>
                          <td>${escapeHtml(`${formatDateShort(r.day_date)} (${formatWeekday(r.day_date)})`)}</td>
                          <td>${escapeHtml(r.status ?? "")}</td>
                          <td>${escapeHtml(r.comment ?? "")}</td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
          <section class="home-card" id="applicationHistory" style="margin-top:12px;">
            <div class="student-home-title">Application History</div>
            ${
              absenceApplicationsState.loading
                ? `<div class="text-muted">Loading applications...</div>`
                : absenceApplicationsState.error
                  ? `<div class="text-error">${escapeHtml(absenceApplicationsState.error)}</div>`
                  : absenceApplicationsState.list.length
                    ? `
                      <div class="detail-table-wrap">
                        <table class="detail-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Submitted</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${absenceApplicationsState.list
                              .map((a) => {
                                const typeLabel =
                                  a.type === "excused"
                                    ? "Excused Absence"
                                    : a.late_type === "leave_early"
                                      ? "Leave Early"
                                      : "Late";
                                return `
                                  <tr>
                                    <td>${escapeHtml(a.day_date)}</td>
                                    <td>${escapeHtml(typeLabel)}</td>
                                    <td>${escapeHtml(a.status)}</td>
                                    <td>${escapeHtml(formatDateShort(a.created_at))}</td>
                                  </tr>
                                `;
                              })
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    `
                    : `<div class="text-muted">No applications yet.</div>`
            }
          </section>
          <div class="student-modal-overlay" id="excusedAppModal" hidden>
            <div class="student-modal" role="dialog" aria-modal="true" aria-labelledby="excusedTitle">
              <div class="student-modal-header">
                <div class="student-modal-title" id="excusedTitle">Excused Absence</div>
                <button class="btn" type="button" id="excusedClose">Close</button>
              </div>
              <div class="student-modal-body">
                <label class="form-label">Date</label>
                <input class="form-input" type="date" id="excusedDate" />
                <label class="form-label" style="margin-top:10px;">Reason</label>
                <textarea class="form-input" id="excusedReason" rows="3"></textarea>
                <label class="form-label" style="margin-top:10px;">What will you do to catch up?</label>
                <textarea class="form-input" id="excusedCatchUp" rows="3"></textarea>
                <div class="admin-msg" id="excusedMsg" style="margin-top:8px;"></div>
              </div>
              <div class="student-modal-actions">
                <button class="btn btn-primary" id="excusedSubmit">Submit</button>
              </div>
            </div>
          </div>
          <div class="student-modal-overlay" id="lateAppModal" hidden>
            <div class="student-modal" role="dialog" aria-modal="true" aria-labelledby="lateTitle">
              <div class="student-modal-header">
                <div class="student-modal-title" id="lateTitle">Late / Leave Early</div>
                <button class="btn" type="button" id="lateClose">Close</button>
              </div>
              <div class="student-modal-body">
                <label class="form-label">Date</label>
                <input class="form-input" type="date" id="lateDate" />
                <label class="form-label" style="margin-top:10px;">Type</label>
                <select class="form-input" id="lateType">
                  <option value="late">Late</option>
                  <option value="leave_early">Leave Early</option>
                </select>
                <label class="form-label" style="margin-top:10px;" id="lateTimeLabel">Arrival Time</label>
                <input class="form-input" type="time" id="lateTime" />
                <label class="form-label" style="margin-top:10px;">Reason</label>
                <textarea class="form-input" id="lateReason" rows="3"></textarea>
                <label class="form-label" style="margin-top:10px;">What will you do to catch up?</label>
                <textarea class="form-input" id="lateCatchUp" rows="3"></textarea>
                <div class="admin-msg" id="lateMsg" style="margin-top:8px;"></div>
              </div>
              <div class="student-modal-actions">
                <button class="btn btn-primary" id="lateSubmit">Submit</button>
              </div>
            </div>
          </div>
        `;
      })()
    : "";

  const resultDetailHtml = "";

  app.innerHTML = `
    <div class="app ${showTabs ? "has-student-topbar" : ""}">
      ${studentInfoHtml}
      <main class="content ${showHome ? "home-content" : ""}" style="margin:12px;">
        ${
          showTakeTest
            ? `
              <h1 class="prompt section-title">Select Test</h1>
              <div style="line-height:1.7; margin-top:10px;">
                <p>• Choose a mock test and start.</p>
                <p>• Answers are saved automatically.</p>
              </div>

              <div class="intro-form" style="margin-top:16px; max-width:640px;">
                ${
                  activeSections.length === 0
                    ? `<div style="color:#b00;margin-bottom:10px;">No questions available.</div>`
                    : ""
                }
                <label class="form-label">Test Session</label>
                <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
                  ${
                    testSessionsState.list.length
                      ? testSessionsState.list
                          .map((t) => {
                            const problemSet = testsState.list.find((ps) => ps.version === t.problem_set_id);
                            const passRate = Number(problemSet?.pass_rate ?? PASS_RATE_DEFAULT);
                            const alreadyTaken =
                              studentResultsState.loaded &&
                              !allowMultipleAttempts(t) &&
                              hasAttemptForSession(t.id);
                            return `
                              <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid #ddd; border-radius:10px; background:#fff;">
                                <input type="radio" name="testSelect" value="${escapeHtml(t.id)}" ${
                                  t.id === activeSessionId ? "checked" : ""
                                } ${alreadyTaken ? "disabled" : ""} />
                                <div>
                                  <div style="font-weight:600;">${escapeHtml(t.title)}</div>
                                  <div style="font-size:12px;color:#666;">${escapeHtml(t.problem_set_id)} • pass ${(passRate * 100).toFixed(0)}%</div>
                                  ${
                                    alreadyTaken
                                      ? `<div style="font-size:12px;color:#b00;margin-top:4px;">Already taken</div>`
                                      : ""
                                  }
                                </div>
                              </label>
                            `;
                          })
                          .join("")
                      : `<div style="color:#666;">公開テストがありません。</div>`
                  }
                </div>
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
                  isGuest
                    ? `
                      <label class="form-label" style="margin-top:14px;">Name（任意）</label>
                      <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

                      <label class="form-label" style="margin-top:10px;">ID（任意）</label>
                      <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
                    `
                    : ``
                }
              </div>

              <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
                <button class="nav-btn" id="startBtn" ${canStart ? "" : "disabled"}>Start</button>
              </div>
            `
            : showHome
              ? `
                <div class="home-stack" style="max-width:900px;">
                  ${homeWarningHtml ? `<section class="home-card student-warning">${homeWarningHtml}</section>` : ""}
                  ${homeHtml}
                  ${announcementHtml}
                </div>
              `
              : `
                <div class="intro-form" style="margin-top:16px; max-width:900px;">
                  ${showDailyResults ? dailyResultsHtml : showModelResults ? modelResultsHtml : attendanceHtml}
                </div>
              `
        }
      </main>
      ${resultDetailHtml}
    </div>
  `;


  if (showTakeTest) {
    document.querySelector("#startBtn")?.addEventListener("click", () => {
      if (!canStart) return;
      if (isGuest) {
        const name = document.querySelector("#nameInput").value.trim();
        const id = document.querySelector("#idInput").value.trim();
        state.user = { name, id };
      }
      const selected = document.querySelector('input[name="testSelect"]:checked');
      let session = null;
      if (selected) {
        state.selectedTestSessionId = selected.value;
        session = testSessionsState.list.find((s) => s.id === selected.value);
        if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      }
      if (!allowMultipleAttempts(session) && hasAttemptForSession(session?.id)) {
        window.alert("You have already taken this test.");
        return;
      }
      state.phase = "sectionIntro";
      state.sectionIndex = 0;
      state.questionIndexInSection = 0;
      state.sectionStartAt = null;
      state.showBangla = false;

      saveState();
      render();
    });
  }

  if (showHome) {
    document.querySelectorAll(".student-home-start").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const sessionId = btn.dataset.sessionId;
        if (!sessionId) return;
        const session = testSessionsState.list.find((s) => s.id === sessionId);
        if (!session?.starts_at) return;
        const startMs = new Date(session.starts_at).getTime();
        if (!Number.isFinite(startMs) || Date.now() < startMs) return;
        if (!allowMultipleAttempts(session) && hasAttemptForSession(sessionId)) {
          return;
        }
        if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
        state.selectedTestSessionId = sessionId;
        state.phase = "sectionIntro";
        state.sectionIndex = 0;
        state.questionIndexInSection = 0;
        state.sectionStartAt = null;
        state.showBangla = false;
        saveState();
        render();
      });
    });
    setTimeout(() => {
      if (state.studentTab === "home") render();
    }, 30000);
  }

  if (showAttendance) {
    const excusedModal = app.querySelector("#excusedAppModal");
    const lateModal = app.querySelector("#lateAppModal");
    app.querySelector("#openExcusedApp")?.addEventListener("click", () => {
      if (excusedModal) excusedModal.hidden = false;
    });
    app.querySelector("#openLateApp")?.addEventListener("click", () => {
      if (lateModal) lateModal.hidden = false;
    });
    app.querySelector("#excusedClose")?.addEventListener("click", () => {
      if (excusedModal) excusedModal.hidden = true;
    });
    app.querySelector("#lateClose")?.addEventListener("click", () => {
      if (lateModal) lateModal.hidden = true;
    });

    app.querySelector("#lateType")?.addEventListener("change", (e) => {
      const val = e.target.value;
      const label = app.querySelector("#lateTimeLabel");
      if (label) label.textContent = val === "leave_early" ? "Leave Time" : "Arrival Time";
    });

    app.querySelector("#excusedSubmit")?.addEventListener("click", async () => {
      const date = app.querySelector("#excusedDate")?.value;
      const reason = app.querySelector("#excusedReason")?.value?.trim();
      const catchUp = app.querySelector("#excusedCatchUp")?.value?.trim();
      const msg = app.querySelector("#excusedMsg");
      if (msg) msg.textContent = "";
      if (!date || !reason) {
        if (msg) msg.textContent = "Date and reason are required.";
        return;
      }
      const { error } = await supabase.from("absence_applications").insert({
        student_id: authState.session?.user?.id ?? null,
        type: "excused",
        day_date: date,
        reason,
        catch_up: catchUp || null,
        status: "pending"
      });
      if (error) {
        if (msg) msg.textContent = `Submit failed: ${error.message}`;
        return;
      }
      if (msg) msg.textContent = "Submitted.";
      if (excusedModal) excusedModal.hidden = true;
    });

    app.querySelector("#lateSubmit")?.addEventListener("click", async () => {
      const date = app.querySelector("#lateDate")?.value;
      const type = app.querySelector("#lateType")?.value || "late";
      const timeValue = app.querySelector("#lateTime")?.value;
      const reason = app.querySelector("#lateReason")?.value?.trim();
      const catchUp = app.querySelector("#lateCatchUp")?.value?.trim();
      const msg = app.querySelector("#lateMsg");
      if (msg) msg.textContent = "";
      if (!date || !timeValue || !reason) {
        if (msg) msg.textContent = "Date, time, and reason are required.";
        return;
      }
      const { error } = await supabase.from("absence_applications").insert({
        student_id: authState.session?.user?.id ?? null,
        type: "late",
        late_type: type,
        time_value: timeValue,
        day_date: date,
        reason,
        catch_up: catchUp || null,
        status: "pending"
      });
      if (error) {
        if (msg) msg.textContent = `Submit failed: ${error.message}`;
        return;
      }
      if (msg) msg.textContent = "Submitted.";
      if (lateModal) lateModal.hidden = true;
    });

    excusedModal?.addEventListener("click", (e) => {
      if (e.target === excusedModal) excusedModal.hidden = true;
    });
    lateModal?.addEventListener("click", (e) => {
      if (e.target === lateModal) lateModal.hidden = true;
    });
  }

  if (showDailyResults) {
    app.querySelector("#dailyCategorySelect")?.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      state.dailyResultsCategory = event.target.value;
      saveState();
      render();
    });

    app.querySelectorAll("[data-daily-attempt-id]").forEach((row) => {
      row.addEventListener("click", async () => {
        const attemptId = row.dataset.dailyAttemptId;
        const attempt = studentResultsState.list.find((a) => a.id === attemptId);
        if (!attempt) return;
        resultDetailState.open = true;
        resultDetailState.mode = "daily";
        resultDetailState.subTab = "score";
        resultDetailState.attempt = attempt;
        resultDetailState.error = "";
        if (attempt.test_version) {
          await fetchQuestionsForDetail(attempt.test_version);
        }
        render();
      });
    });
  }

  if (showModelResults) {
    app.querySelectorAll("[data-model-attempt-id]").forEach((row) => {
      row.addEventListener("click", async () => {
        const attemptId = row.dataset.modelAttemptId;
        const attempt = studentResultsState.list.find((a) => a.id === attemptId);
        if (!attempt) return;
        resultDetailState.open = true;
        resultDetailState.mode = "model";
        resultDetailState.subTab = "score";
        resultDetailState.attempt = attempt;
        resultDetailState.error = "";
        if (attempt.test_version) {
          await fetchQuestionsForDetail(attempt.test_version);
        }
        render();
      });
    });

    app.querySelectorAll("[data-model-detail-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.modelDetailTab || "score";
        resultDetailState.subTab = next;
        render();
      });
    });
  }

  app.querySelector("#dailyResultBack")?.addEventListener("click", () => {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.attempt = null;
    render();
  });

  app.querySelector("#modelResultBack")?.addEventListener("click", () => {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.attempt = null;
    render();
  });

  app.querySelector("#studentLogoHome")?.addEventListener("click", () => {
    state.studentTab = "home";
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.subTab = "score";
    resultDetailState.attempt = null;
    saveState();
    render();
  });

  document.querySelector("#signOutBtn")?.addEventListener("click", () => {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.subTab = "score";
    resultDetailState.attempt = null;
    supabase.auth.signOut();
    state.requireLogin = true;
    state.phase = "login";
    saveState();
    render();
  });
}

function renderLinkInvalid(app) {
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Not started", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Link is invalid / expired</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>このリンクは無効、または期限切れです。</p>
        </div>
        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="backBtn">Back</button>
        </div>
      </main>
    </div>
  `;
  const disabledBtn = document.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  document.querySelector("#backBtn").addEventListener("click", goIntro);
}

function renderSectionIntro(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const questionCount = secQs.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  const isDaily = getActiveTestType() === "daily";
  const activeTitle = getActiveTestTitle();
  const sectionTitle = isDaily && activeTitle ? activeTitle : sec.title;

  const isFirstSection = state.sectionIndex === 0;
  const btnLabel = isFirstSection ? "Start Exam (Fullscreen)" : "Next";
  const hintLine = isFirstSection
    ? "When you press Start, the timer begins."
    : "Press Next to continue.";

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({
        rightButtonLabel: "Ready",
        rightButtonId: "disabledBtn",
        hideTimer: true,              // ← Introではタイマー表示しない（あなたの希望）
      })}

      <main class="content" style="margin:12px;">
        ${focusWarningHTML()}
        <h1 class="prompt section-title">${escapeHtml(sectionTitle)}</h1>

        <div style="line-height:1.7; margin-top:10px;">
          <p>• Questions in this section: <b>${questionCount}</b></p>
          <p>• ${hintLine}</p>
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="goBtn">${btnLabel}</button>
        </div>
      </main>
    </div>
  `;

  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#goBtn").addEventListener("click", async () => {
    if (isFirstSection) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch (e) {
        console.warn("fullscreen failed:", e);
      }
      startTestTimer();   // ←最初だけ開始
    }
    state.phase = "quiz";
    saveState();
    render();
  });
}



function renderQuiz(app) {

  if (getTotalTimeLeftSec() <= 0) {
  state.phase = "result"; // ★時間切れは即結果へ（好みでsectionEndでもOK）
  saveState();
  render();
  return;
}


  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const group = getCurrentQuestion();
  const isDaily = getActiveTestType() === "daily";

  app.innerHTML = `
    <div class="app has-topbar ${isDaily ? "" : "has-bottombar"}">
      ${topbarHTML({ rightButtonLabel: "Finish Test", rightButtonId: "finishBtn" })}
      <div class="body">
        ${sidebarHTML()}
        <main class="content">
          ${focusWarningHTML()}
          ${renderQuestionGroupHTML(group)}
          ${
            isDaily
              ? `
                <div class="question-nav">
                  <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                  <button class="nav-btn" id="nextBtn">Next ▶</button>
                </div>
              `
              : ""
          }
        </main>
      </div>
      ${
        isDaily
          ? ""
          : `
            <footer class="bottombar">
              <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
              <div class="bottom-right">
                <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                <button class="nav-btn" id="nextBtn">Next ▶</button>
              </div>
            </footer>
          `
      }
    </div>
  `;

  // Bangla toggle
  document.querySelector("#banglaBtn")?.addEventListener("click", toggleBangla);

  // Sidebar step jump
  document.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToQuestionInSection(Number(btn.dataset.step)));
  });

  // Choice click (single)
  document.querySelectorAll("[data-choice]").forEach((btn) => {
    const part = btn.dataset.part;
    const choice = Number(btn.dataset.choice);
    const qid = btn.dataset.qid || "";
    if (!qid) return;
    if (part == null) {
      btn.addEventListener("click", () => setSingleAnswer(qid, choice));
    } else {
      btn.addEventListener("click", () => setPartAnswer(qid, Number(part), choice));
    }
  });

  // Nav
  document.querySelector("#backBtn")?.addEventListener("click", goPrevQuestion);
  document.querySelector("#nextBtn")?.addEventListener("click", goNextQuestionOrEnd);

  document.querySelector("#finishBtn")?.addEventListener("click", finishSection);
}

function renderSectionEnd(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const activeSections = getActiveSections();

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Section ended", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">${sec.title} — Completed</h1>
        <p style="color:var(--muted);">Next: ${state.sectionIndex === activeSections.length - 1 ? "Results" : activeSections[state.sectionIndex + 1].title}</p>

        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextSectionBtn">${state.sectionIndex === activeSections.length - 1 ? "Go to Results" : "Next Section"}</button>
          <button class="nav-btn ghost" id="reviewBtn">Review this section</button>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#nextSectionBtn").addEventListener("click", () => {
    const activeSectionsInner = getActiveSections();
    const nextSectionIndex = state.sectionIndex + 1;

    if (nextSectionIndex >= activeSectionsInner.length) {
      state.phase = "result";
      saveState();
      render();
      return;
    }

    state.sectionIndex = nextSectionIndex;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;
    state.phase = "sectionIntro";

    saveState();
    render();
  });

  document.querySelector("#reviewBtn").addEventListener("click", () => {
    state.phase = "quiz";
    saveState();
    render();
  });
}

function getChoiceLabel(q, idx) {
  if (idx == null || idx === "") return "";
  if (q.choices?.[idx] != null) return q.choices[idx];
  if (q.choicesJa?.[idx] != null) return q.choicesJa[idx];
  return `選択肢${Number(idx) + 1}`;
}

function getQuestionThumb(q) {
  // 表に出したい代表画像（あれば）
  return q.stemKind && q.stemKind !== "audio" ? (q.stemAsset || "") : "";
}

function pickChoiceImage(q, idx) {
  if (idx == null) return "";
  const value = q.choices?.[idx] ?? q.choicesJa?.[idx];
  if (value && isImageChoiceValue(value)) return value;
  return "";
}
function pickPartChoiceImage(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choiceImages) && part.choiceImages[idx]) return part.choiceImages[idx];
  return "";
}

function getChoiceText(q, idx) {
  if (idx == null) return "";
  if (Array.isArray(q.choices) && q.choices[idx] != null) return q.choices[idx];
  if (Array.isArray(q.choicesJa) && q.choicesJa[idx] != null) return q.choicesJa[idx];
  return "";
}

function getPartChoiceText(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choicesJa) && part.choicesJa[idx] != null) return part.choicesJa[idx];
  return "";
}

function buildResultRows() {
  const rows = [];

  for (const q of getQuestions()) {
    const chosenIdx = state.answers[q.id];
    const correctIdx = q.answerIndex;

    // 問題文の表示テキスト（最低限）
    const promptText =
      q.boxText || q.stemText || q.stemExtra || q.promptEn || "";

    rows.push({
      id: String(q.id),
      thumb: q.stemKind && q.stemKind !== "audio" ? (q.stemAsset || "") : "",
      prompt: promptText,
      isCorrect: chosenIdx === correctIdx,

      chosen: getChoiceText(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),

      chosenImg: pickChoiceImage(q, chosenIdx),
      correctImg: pickChoiceImage(q, correctIdx),
    });
  }

  return rows;
}

function buildAttemptDetailRows(attempt, questionsList) {
  const answers = attempt?.answers_json ?? {};
  return (questionsList ?? []).map((q) => {
    const chosenIdx = answers[q.id];
    const correctIdx = q.answerIndex;
    return {
      qid: String(q.id),
      section: getSectionTitle(q.sectionKey),
      prompt: getQuestionPrompt(q),
      thumb: q.stemKind && q.stemKind !== "audio" ? (q.stemAsset || "") : "",
      chosen: getChoiceText(q, chosenIdx),
      correct: getChoiceText(q, correctIdx),
      isCorrect: chosenIdx === correctIdx,
    };
  });
}

function buildSectionSummary(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.section || "Unknown";
    const cur = map.get(key) || { section: key, total: 0, correct: 0 };
    cur.total += 1;
    if (row.isCorrect) cur.correct += 1;
    map.set(key, cur);
  });
  return Array.from(map.values()).map((s) => ({
    ...s,
    rate: s.total ? s.correct / s.total : 0,
  }));
}





function renderResult(app) {
  const { correct, total } = scoreAll();
  const rows = buildResultRows(); // ★ results rows (chosenImg/correctImg を含む想定)
  const scoreRate = total === 0 ? 0 : correct / total;
  const passRate = getActivePassRate();
  const isPass = scoreRate >= passRate;
  const showExit = Boolean(authState.session);

  // ★ Resultに入った瞬間にタイマーを止めたい場合（testEndAt方式を入れてるなら）
  // state.testEndAt = state.testEndAt ?? Date.now();
  // saveState();

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Finished", rightButtonId: "disabledBtn", hideTimer: true })}
      <main class="result">
        <h1>Result</h1>

        <div class="score-big">
          <span class="score-correct">${correct}</span>
          <span class="score-slash">/</span>
          <span class="score-total">${total}</span>
        </div>
        <div style="margin-top:8px;font-size:20px;font-weight:700; color:${isPass ? "#1a7f37" : "#b00"};">
          ${isPass ? "Pass" : "Fail"}
          <span style="font-size:14px;font-weight:500;color:#444;"> (${(scoreRate * 100).toFixed(1)}%)</span>
        </div>
        <div style="margin-top:4px;color:#666;font-size:12px;">Pass threshold: ${(passRate * 100).toFixed(0)}%</div>
        <div class="save-status" id="saveStatus"></div>

        <div class="finish-actions">
          ${showExit ? `<button class="btn btn-primary" id="exitTestBtn">Exit Test</button>` : ``}
        </div>

        <div class="result-table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>問題</th>
                <th>正誤</th>
                <th class="col-choice">選んだ答え</th>
                <th class="col-choice">正しい答え</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr>
                  <td class="cell-id">${escapeHtml(r.id)}</td>

                  <td class="cell-prompt">
                    ${r.thumb ? `<img class="result-thumb" src="${r.thumb}" alt="q" />` : ""}
                    <div class="prompt-text">${escapeHtml(r.prompt ?? "")}</div>
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

                  <td class="cell-choice">
                    ${
                      r.correctImg
                        ? `<img class="result-choice-big" src="${r.correctImg}" alt="correct" />`
                        : `<div class="choice-text">${escapeHtml(r.correct ?? "")}</div>`
                    }
                  </td>

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

  // topbar right button disable
  document.querySelector("#disabledBtn").disabled = true;

  // actions
  document.querySelector("#exitTestBtn")?.addEventListener("click", exitToHome);

  saveAttemptIfNeeded();
}




function render() {
  const app = document.querySelector("#app");
  if (!state.linkChecked || !authState.checked) {
    renderAndSync(renderLoading, app);
    return;
  }
  if (state.linkInvalid) {
    renderAndSync(renderLinkInvalid, app);
    return;
  }
  if (authState.session && authState.mustChangePassword) {
    renderAndSync(renderSetPassword, app);
    return;
  }
  if (state.requireLogin || state.linkLoginRequired) {
    if (state.phase !== "login") {
      state.phase = "login";
      saveState();
    }
    renderAndSync(renderLogin, app);
    return;
  }
  if (!authState.session && !state.linkId) {
    renderAndSync(renderLogin, app);
    return;
  }

  const needsQuestions = ["intro", "sectionIntro", "quiz", "result"].includes(state.phase);
  const sessionsReady = testSessionsState.loaded || Boolean(state.linkId);
  if (needsQuestions && testsState.loaded && sessionsReady) {
    ensureQuestionsLoaded();
    if (!questionsState.loaded || questionsState.version !== getActiveTestVersion()) {
      return renderLoading(app);
    }
  }

  if (authState.session && !state.linkId && state.phase === "intro") {
    renderAndSync(renderTestSelect, app);
    return;
  }
  if (state.phase === "login") {
    renderAndSync(renderLogin, app);
    return;
  }
  if (state.phase === "intro") {
    renderAndSync(renderIntro, app);
    return;
  }
  if (state.phase === "sectionIntro") {
    renderAndSync(renderSectionIntro, app); // ←追加
    return;
  }
  if (state.phase === "quiz") {
    renderAndSync(renderQuiz, app);
    return;
  }
  if (state.phase === "result") {
    renderAndSync(renderResult, app);
  }
}


setInterval(() => {
  // quiz中じゃなくても、topbarを表示する画面なら更新したいならここを調整OK
  const left = getTotalTimeLeftSec();
  const timerEl = document.querySelector(".timer");
  if (timerEl) timerEl.textContent = formatTime(left);

  if (state.phase !== "quiz") return;

  if (left <= 0) {
  state.testEndAt = state.testEndAt ?? Date.now();
  state.phase = "result";
  saveState();
  render();
  }
}, 1000);


async function checkLinkFromUrl() {
  const url = new URL(window.location.href);
  const linkId = url.searchParams.get("link");
  if (!linkId) {
    state.linkId = null;
    state.linkExpiresAt = null;
    state.linkTestVersion = null;
    state.linkTestSessionId = null;
    state.linkInvalid = false;
    state.linkLoginRequired = false;
    state.linkChecked = true;
    saveState();
    return;
  }

  try {
    const { data, error } = await publicSupabase
      .from("exam_links")
      .select("id, test_version, test_session_id, expires_at")
      .eq("id", linkId)
      .single();

    if (error || !data) {
      state.linkInvalid = true;
      state.linkChecked = true;
      saveState();
      return;
    }

    const expiresAt = new Date(data.expires_at).getTime();
    if (Number.isNaN(expiresAt) || expiresAt < Date.now()) {
      state.linkInvalid = true;
      state.linkChecked = true;
      saveState();
      return;
    }

    state.linkId = data.id;
    state.linkExpiresAt = data.expires_at;
    state.linkTestSessionId = data.test_session_id ?? null;
    if (data.test_session_id) {
      const { data: sessionRow, error: sessionErr } = await publicSupabase
        .from("test_sessions")
        .select("id, problem_set_id")
        .eq("id", data.test_session_id)
        .single();
      if (sessionErr || !sessionRow) {
        state.linkInvalid = true;
        state.linkChecked = true;
        saveState();
        return;
      }
      state.linkTestVersion = sessionRow.problem_set_id;
    } else {
      state.linkTestVersion = data.test_version;
    }
    state.linkInvalid = false;
    state.linkChecked = true;
    state.linkLoginRequired = true;
    state.requireLogin = true;
    state.phase = "login";
    saveState();
  } catch {
    state.linkInvalid = true;
    state.linkChecked = true;
    saveState();
  }
}

supabase.auth.onAuthStateChange(() => {
  refreshAuthState().finally(render);
  fetchPublicTests().finally(render);
  fetchTestSessions().finally(render);
});

function registerFocusWarning() {
  const bumpWarning = () => {
    const now = Date.now();
    if (now - (state.focusWarningAt || 0) < 1000) return;
    if (!["quiz", "sectionIntro"].includes(state.phase)) return;
    state.focusWarnings = (state.focusWarnings || 0) + 1;
    state.focusWarningAt = now;
    saveState();
    render();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) bumpWarning();
  });
  window.addEventListener("blur", () => {
    bumpWarning();
  });
}

Promise.all([checkLinkFromUrl(), refreshAuthState()]).finally(render);
fetchPublicTests().finally(render);
fetchTestSessions().finally(render);
registerFocusWarning();
registerStudentMenu();
