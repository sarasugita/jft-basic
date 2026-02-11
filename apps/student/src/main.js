import "./style.css";
import { questions, sections } from "../../../packages/shared/questions.js";
import { supabase, publicSupabase } from "./supabaseClient";

const STORAGE_KEY = "jft_mock_state_v3";

const TOTAL_TIME_SEC = 60 * 60; // 60分
const TEST_VERSION = "test_exam";
const PASS_RATE_DEFAULT = 0.6;

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
  linkChecked: false,
  linkInvalid: false,
  selectedTestVersion: "",
};



let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    return { ...defaultState, ...JSON.parse(raw) };
  } catch {
    return { ...defaultState };
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetAll() {
  state = { ...defaultState };
  state.testEndAt = null;
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
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Loading", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Loading...</h1>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
}

async function refreshAuthState() {
  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("getSession error:", error);
  authState.session = data?.session ?? null;
  authState.profile = null;

  const isRecovery = window.location.hash.includes("type=recovery") || window.location.hash.includes("access_token=");
  authState.recoveryMode = Boolean(isRecovery && authState.session);

  if (!authState.session) {
    authState.checked = true;
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
    const nextName = (state.user?.name ?? "").trim() || (prof?.display_name ?? "");
    const nextId = (state.user?.id ?? "").trim() || (prof?.student_code ?? "");
    state.user = { name: nextName, id: nextId };
    saveState();
  }

  authState.checked = true;
}

async function fetchPublicTests() {
  testsState.error = "";
  const { data, error } = await publicSupabase
    .from("tests")
    .select("id, version, title, type, pass_rate, is_public, created_at")
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
  const list = (data ?? []).filter((t) => t.type === "mock");
  testsState.list = list;
  testsState.loaded = true;
  if (!state.linkId && !state.selectedTestVersion && list.length) {
    state.selectedTestVersion = list[0].version;
    saveState();
  }
}

function getActiveTestVersion() {
  return state.linkTestVersion || state.selectedTestVersion || TEST_VERSION;
}

function getActivePassRate() {
  const version = getActiveTestVersion();
  const test = testsState.list.find((t) => t.version === version);
  const passRate = Number(test?.pass_rate ?? PASS_RATE_DEFAULT);
  return Number.isFinite(passRate) ? passRate : PASS_RATE_DEFAULT;
}

function renderLogin(app) {
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <div style="max-width:420px;margin:40px auto;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;">
          <h2 style="margin:0 0 6px;">Student Login</h2>
          <p style="margin-top:0;line-height:1.6;">
            メールとパスワードでログインします。
            ${state.linkId ? `<br/>※このリンクからゲスト受験もできます。` : ""}
          </p>

          <label>Email</label>
          <input id="email" type="email" style="width:100%;padding:10px;margin:6px 0 12px;" />

          <label>Password</label>
          <input id="password" type="password" style="width:100%;padding:10px;margin:6px 0 12px;" />

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="nav-btn" id="loginBtn" style="flex:1; min-width: 160px;">Log in</button>
            ${state.linkId ? `<button class="nav-btn ghost" id="guestBtn" style="flex:1; min-width: 160px;">Continue as Guest</button>` : ""}
          </div>

          <button class="nav-btn ghost" id="resetBtn" style="width:100%;margin-top:10px;">Forgot password</button>

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
    state.phase = "intro";
    saveState();
  });

  app.querySelector("#resetBtn").addEventListener("click", async () => {
    msgEl.textContent = "";
    const email = emailEl.value.trim();
    if (!email) {
      msgEl.textContent = "Email を入力してください。";
      return;
    }
    const redirectTo = `${window.location.origin}/reset`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      msgEl.textContent = error.message;
      return;
    }
    msgEl.style.color = "green";
    msgEl.textContent = "Reset email sent. メールを確認してください。";
  });

  if (state.linkId) {
    app.querySelector("#guestBtn")?.addEventListener("click", () => {
      goIntro();
    });
  }
}

function renderSetPassword(app) {
  app.innerHTML = `
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Reset", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <div style="max-width:420px;margin:20px auto;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;">
          <h2 style="margin:0 0 6px;">Set New Password</h2>
          <p style="margin-top:0;line-height:1.6;">新しいパスワードを設定します。</p>

          <label>New Password</label>
          <input id="newPass" type="password" style="width:100%;padding:10px;margin:6px 0 12px;" />

          <button class="nav-btn" id="updateBtn" style="width:100%;">Update password</button>
          <p id="msg" style="color:#b00;margin-top:12px;min-height:20px;"></p>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
  const passEl = app.querySelector("#newPass");
  const msgEl = app.querySelector("#msg");
  app.querySelector("#updateBtn").addEventListener("click", async () => {
    msgEl.textContent = "";
    const password = passEl.value;
    if (!password || password.length < 8) {
      msgEl.textContent = "8文字以上のパスワードを入力してください。";
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


function getCurrentSection() {
  return sections[state.sectionIndex];
}
function getSectionQuestions(sectionKey) {
  return questions.filter((q) => q.sectionKey === sectionKey);
}
function getCurrentQuestion() {
  const sec = getCurrentSection();
  const qs = getSectionQuestions(sec.key);
  return qs[state.questionIndexInSection];
}

function startTestTimer() {
  if (state.testStartAt) return;      // すでに開始してたら何もしない
  state.testStartAt = Date.now();
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
  for (const q of questions) {
    const ans = state.answers[q.id];
    if (q.parts?.length) {
      // 2問セット：全部正解で1点×parts（パートごと採点）
      if (ans && Array.isArray(ans.partAnswers)) {
        q.parts.forEach((p, i) => {
          if (ans.partAnswers[i] === p.answerIndex) correct++;
        });
      }
    } else {
      if (ans === q.answerIndex) correct++;
    }
  }
  // total = 単問 + parts数
  const total = questions.reduce((acc, q) => acc + (q.parts?.length ? q.parts.length : 1), 0);
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
  const nextSectionIndex = state.sectionIndex + 1;

  // 最後のセクションが終わったら結果へ
  if (nextSectionIndex >= sections.length) {
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
  const payload = {
    student_id: authState.session?.user?.id ?? null,
    display_name: state.user?.name?.trim() || null,
    student_code: state.user?.id?.trim() || null,
    test_version: getActiveTestVersion(),
    correct,
    total,
    score_rate: scoreRate,
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
  saveState();
  if (statusEl) statusEl.textContent = "Saved";
}

/** ===== UI helpers ===== */
function topbarHTML({ rightButtonLabel = "Finish Section", rightButtonId = "finishBtn" } = {}) {
  const sec = sections[state.sectionIndex]; // getCurrentSection()より安全に直参照
  const hideQA =
    state.phase === "intro" ||
    state.phase === "sectionIntro" ||
    state.phase === "result";
  // intro / sectionIntro / result などで「セクション表示を出さない」モード

  return `
    <header class="topbar">
      <div class="topbar-left">
        <div class="topbar-meta">
          ${
            hideQA
              ? `<div><span class="muted">Question:</span> <b>—</b></div>
                 <div><span class="muted">Section:</span> <b>—</b></div>`
              : `<div><span class="muted">Question:</span> <b>${state.questionIndexInSection + 1}</b></div>
                 <div><span class="muted">Section:</span> <b>${sec?.title ?? "—"}</b></div>`
          }
        </div>
        <div class="topbar-test">Test: Japan Foundation Test for Basic Japanese</div>
      </div>

      <div class="topbar-center">
        <div class="timer-label">Test Time Remaining</div>
        <div class="timer">${formatTime(getTotalTimeLeftSec())}</div>

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


function banglaButtonHTML() {
  return `
    <div class="lang-buttons">
      <button class="lang-btn" id="banglaBtn">
        ${state.showBangla ? "✓ " : ""}Bangla
      </button>
    </div>
  `;
}

function promptHTML(q) {
  const main = q.promptEn ?? "";
  const sub = q.promptBn ?? "";
  return `
    <h1 class="prompt">${main}</h1>
    ${banglaButtonHTML()}
    ${state.showBangla ? `<div class="prompt-sub">${sub}</div>` : ``}
  `;
}

/** ===== Render question blocks by type ===== */
function renderChoicesText(q) {
  const chosen = state.answers[q.id];
  return `
    <div class="choices">
      ${q.choicesJa.map((c, i) => {
        const sel = chosen === i ? "selected" : "";
        return `<button class="choice ${sel}" data-choice="${i}">${c}</button>`;
      }).join("")}
    </div>
  `;
}

function renderChoicesImages(q) {
  const chosen = state.answers[q.id];
  return `
    <div class="img-choice-grid">
      ${q.choiceImages.map((src, i) => {
        const sel = chosen === i ? "selected" : "";
        return `
          <button class="img-choice ${sel}" data-choice="${i}">
            <img src="${src}" alt="choice ${i + 1}" />
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderTwoPartImageChoices(q) {
  const ans = state.answers[q.id];
  const partAnswers = ans?.partAnswers ?? [];

  return `
    ${q.parts.map((p, idx) => {
      const chosen = partAnswers[idx];
      return `
        <div class="part-block">
          <div class="part-title">${p.partLabel}</div>
          <div class="part-question">${p.questionJa}</div>
          <div class="img-choice-grid">
            ${p.choiceImages.map((src, i) => {
              const sel = chosen === i ? "selected" : "";
              return `
                <button class="img-choice ${sel}" data-part="${idx}" data-choice="${i}">
                  <img src="${src}" alt="choice ${i + 1}" />
                </button>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function renderTwoPartTextChoices(q, imageKey) {
  const ans = state.answers[q.id];
  const partAnswers = ans?.partAnswers ?? [];

  return `
    ${q[imageKey] ? `<div class="question-area"><img class="passage-img" src="${q[imageKey]}" alt="passage" /></div>` : ""}
    ${q.parts.map((p, idx) => {
      const chosen = partAnswers[idx];
      return `
        <div class="part-block">
          <div class="part-title">${p.partLabel} ${p.questionJa}</div>
          <div class="choices">
            ${p.choicesJa.map((c, i) => {
              const sel = chosen === i ? "selected" : "";
              return `<button class="choice ${sel}" data-part="${idx}" data-choice="${i}">${c}</button>`;
            }).join("")}
          </div>
        </div>
      `;
    }).join("")}
  `;
}

function questionBodyHTML(q) {
  switch (q.type) {
    case "mcq_image":
      return `
        <div class="question-area">
          <img class="illustration" src="${q.image}" alt="illustration" />
        </div>
        ${renderChoicesText(q)}
      `;

    case "mcq_sentence_blank":
      return `
        <div class="blue-box">
          <div class="jp-sentence">${q.sentenceJa}</div>
        </div>
        ${renderChoicesText(q)}
      `;

    case "mcq_kanji_reading":
      return `
        <div class="blue-box">
          <div class="jp-sentence">
            ${q.sentencePartsJa
              .map((p) => (p.underline ? `<span class="underline">${p.text}</span>` : p.text))
              .join("")}
          </div>
        </div>
        ${renderChoicesText(q)}
      `;

    case "mcq_dialog_with_image":
      return `
        <div class="dialog-row">
          <div class="dialog-text">
            ${q.dialogJa
              .map((line) => `<div class="dialog-line">${line.replace("［　　］", `<span class="blank-red"></span>`)}</div>`)
              .join("")}
          </div>
          <div class="dialog-img">
            <img src="${q.image}" alt="dialog image" />
          </div>
        </div>
        ${renderChoicesText(q)}
      `;

    case "mcq_illustrated_dialog":
      return `
        <div class="question-area">
          <img class="passage-img" src="${q.image}" alt="illustrated dialog" />
        </div>
        ${renderChoicesText(q)}
      `;

    case "mcq_listening_image_choices":
      return `
        <div style="margin:10px 0 12px;">
          <audio controls preload="auto">
            <source src="/audio/lc1.mp3" type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>  
        </div>
        ${q.stemImage ? `<div class="question-area"><img class="illustration" src="${q.stemImage}" alt="stem" /></div>` : ""}
        ${renderChoicesImages(q)}
      `;

    case "mcq_listening_two_part_image":
      return `
        <div style="margin:10px 0 12px;">
          <audio controls preload="auto">
            <source src="/audio/lc1.mp3" type="audio/mpeg" />
            Your browser does not support the audio element.
          </audio>  
        </div>
        ${q.stemImage ? `<div class="question-area"><img class="illustration" src="${q.stemImage}" alt="stem" /></div>` : ""}
        ${renderTwoPartImageChoices(q)}
      `;

    case "mcq_reading_passage_two_questions":
      return `
        ${renderTwoPartTextChoices(q, "passageImage")}
      `;

    case "mcq_reading_table_two_questions":
      return `
        ${renderTwoPartTextChoices(q, "tableImage")}
      `;

    default:
      return `<div>Unknown question type: ${q.type}</div>`;
  }
}

/** ===== Sidebar ===== */
function sidebarHTML() {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
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
  const activeVersion = getActiveTestVersion();
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Mock Test</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>• Sections: ${sections.map(s => `<b>${s.title}</b>`).join(" → ")}</p>
          <p>• Each section has a timer.</p>
          <p>• Answers are saved automatically.</p>
          ${
            state.linkId
              ? `<p style="margin-top:6px;"><b>Guest link active</b> (expires: ${state.linkExpiresAt ? new Date(state.linkExpiresAt).toLocaleString() : "—"})</p>`
              : ""
          }
          <p style="margin-top:6px;"><b>Test</b>: ${escapeHtml(activeVersion)}</p>
          ${
            authState.session
              ? `<p style="margin-top:6px;"><b>Logged in</b> (${escapeHtml(authState.session.user.email ?? "")})</p>`
              : ""
          }
        </div>

        <div class="intro-form" style="margin-top:16px; max-width:520px;">
          ${
            state.linkId
              ? ""
              : `
                <label class="form-label">Test</label>
                <select class="form-input" id="testSelect">
                  ${
                    testsState.list.length
                      ? testsState.list
                          .map(
                            (t) =>
                              `<option value="${escapeHtml(t.version)}" ${
                                t.version === activeVersion ? "selected" : ""
                              }>${escapeHtml(t.title || t.version)}</option>`
                          )
                          .join("")
                      : `<option value="${escapeHtml(TEST_VERSION)}">${escapeHtml(TEST_VERSION)}</option>`
                  }
                </select>
                ${
                  testsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testsState.error)}</div>`
                    : ""
                }
                ${
                  testsState.loaded && testsState.list.length === 0
                    ? `<div style="margin-top:6px;color:#666;">公開テストがありません。デフォルトを使用します。</div>`
                    : ""
                }
              `
          }

          <label class="form-label">Name（任意）</label>
          <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

          <label class="form-label" style="margin-top:10px;">ID（任意）</label>
          <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextBtn">Next</button>
          ${authState.session ? `<button class="nav-btn ghost" id="signOutBtn">Sign out</button>` : ``}
          ${!authState.session && !state.linkId ? `<button class="nav-btn ghost" id="loginNavBtn">Log in</button>` : ``}
          <button class="nav-btn ghost" id="resetBtn">Reset</button>
        </div>
      </main>

      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right"></div>
      </footer>
    </div>
  `;

  document.querySelector("#disabledBtn").disabled = true;

  const testSelect = document.querySelector("#testSelect");
  if (testSelect) {
    testSelect.addEventListener("change", () => {
      state.selectedTestVersion = testSelect.value;
      saveState();
      render();
    });
  }

  document.querySelector("#nextBtn").addEventListener("click", () => {
    // 入力を保存してから次へ
    const name = document.querySelector("#nameInput").value.trim();
    const id = document.querySelector("#idInput").value.trim();

    state.user = { name, id };
    state.phase = "sectionIntro";
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;

    saveState();
    render();
  });

  document.querySelector("#signOutBtn")?.addEventListener("click", () => supabase.auth.signOut());
  document.querySelector("#loginNavBtn")?.addEventListener("click", () => {
    state.phase = "login";
    saveState();
    render();
  });
  document.querySelector("#resetBtn").addEventListener("click", resetAll);
}

function renderTestSelect(app) {
  const activeVersion = getActiveTestVersion();
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Select Test</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>• Choose a mock test and start.</p>
          <p>• Answers are saved automatically.</p>
          ${
            authState.session
              ? `<p style="margin-top:6px;"><b>Logged in</b> (${escapeHtml(authState.session.user.email ?? "")})</p>`
              : ""
          }
        </div>

        <div class="intro-form" style="margin-top:16px; max-width:640px;">
          <label class="form-label">Test</label>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
            ${
              testsState.list.length
                ? testsState.list
                    .map(
                      (t) => `
                        <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid #ddd; border-radius:10px; background:#fff;">
                          <input type="radio" name="testSelect" value="${escapeHtml(t.version)}" ${
                            t.version === activeVersion ? "checked" : ""
                          } />
                          <div>
                            <div style="font-weight:600;">${escapeHtml(t.title || t.version)}</div>
                            <div style="font-size:12px;color:#666;">${escapeHtml(t.version)} • pass ${(Number(t.pass_rate ?? 0.6) * 100).toFixed(0)}%</div>
                          </div>
                        </label>
                      `
                    )
                    .join("")
                : `<div style="color:#666;">公開テストがありません。デフォルトを使用します。</div>`
            }
          </div>
          ${
            testsState.error
              ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testsState.error)}</div>`
              : ""
          }

          <label class="form-label" style="margin-top:14px;">Name（任意）</label>
          <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

          <label class="form-label" style="margin-top:10px;">ID（任意）</label>
          <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="startBtn">Start</button>
          <button class="nav-btn ghost" id="signOutBtn">Sign out</button>
        </div>
      </main>
    </div>
  `;

  document.querySelector("#startBtn").addEventListener("click", () => {
    const name = document.querySelector("#nameInput").value.trim();
    const id = document.querySelector("#idInput").value.trim();
    const selected = document.querySelector('input[name="testSelect"]:checked');
    if (selected) state.selectedTestVersion = selected.value;

    state.user = { name, id };
    state.phase = "sectionIntro";
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;

    saveState();
    render();
  });

  document.querySelector("#signOutBtn")?.addEventListener("click", () => supabase.auth.signOut());
}

function renderLinkInvalid(app) {
  app.innerHTML = `
    <div class="app">
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
  document.querySelector("#disabledBtn").disabled = true;
  document.querySelector("#backBtn").addEventListener("click", goIntro);
}

function renderSectionIntro(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);

  const isFirstSection = state.sectionIndex === 0;
  const btnLabel = isFirstSection ? "Start" : "Next";
  const hintLine = isFirstSection
    ? "When you press Start, the timer begins."
    : "Press Next to continue.";

  app.innerHTML = `
    <div class="app">
      ${topbarHTML({
        rightButtonLabel: "Ready",
        rightButtonId: "disabledBtn",
        hideTimer: true,              // ← Introではタイマー表示しない（あなたの希望）
      })}

      <main class="content" style="margin:12px;">
        <h1 class="prompt">${sec.title}</h1>

        <div style="line-height:1.7; margin-top:10px;">
          <p>• Questions in this section: <b>${secQs.length}</b></p>
          <p>• ${hintLine}</p>
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="goBtn">${btnLabel}</button>
        </div>
      </main>

      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right"></div>
      </footer>
    </div>
  `;

  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#goBtn").addEventListener("click", () => {
    if (isFirstSection) startTestTimer();   // ←最初だけ開始
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
  const q = getCurrentQuestion();

  app.innerHTML = `
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Finish Section", rightButtonId: "finishBtn" })}
      <div class="body">
        ${sidebarHTML()}
        <main class="content">
          ${promptHTML(q)}
          ${questionBodyHTML(q)}
        </main>
      </div>
      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right">
          <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
          <button class="nav-btn" id="nextBtn">Next ▶</button>
        </div>
      </footer>
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
    if (part == null) {
      btn.addEventListener("click", () => setSingleAnswer(q.id, choice));
    } else {
      btn.addEventListener("click", () => setPartAnswer(q.id, Number(part), choice));
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

  app.innerHTML = `
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Section ended", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">${sec.title} — Completed</h1>
        <p style="color:var(--muted);">Next: ${state.sectionIndex === sections.length - 1 ? "Results" : sections[state.sectionIndex + 1].title}</p>

        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextSectionBtn">${state.sectionIndex === sections.length - 1 ? "Go to Results" : "Next Section"}</button>
          <button class="nav-btn ghost" id="reviewBtn">Review this section</button>
        </div>
      </main>

      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right"></div>
      </footer>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#nextSectionBtn").addEventListener("click", () => {
  const nextSectionIndex = state.sectionIndex + 1;

  if (nextSectionIndex >= sections.length) {
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
  if (q.choicesJa?.[idx] != null) return q.choicesJa[idx];
  // 画像選択肢などchoicesJaが無い場合
  return `選択肢${Number(idx) + 1}`;
}

function getQuestionThumb(q) {
  // 表に出したい代表画像（あれば）
  return q.image || q.stemImage || q.passageImage || q.tableImage || "";
}

function pickChoiceImage(q, idx) {
  if (idx == null) return "";
  if (Array.isArray(q.choiceImages) && q.choiceImages[idx]) return q.choiceImages[idx];
  return "";
}
function pickPartChoiceImage(part, idx) {
  if (idx == null) return "";
  if (Array.isArray(part.choiceImages) && part.choiceImages[idx]) return part.choiceImages[idx];
  return "";
}

function getChoiceText(q, idx) {
  if (idx == null) return "";
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

  for (const q of questions) {
    // ===== parts（2問セット：LC-3など）=====
    if (q.parts?.length) {
      const ans = state.answers[q.id];
      q.parts.forEach((part, i) => {
        const chosenIdx = ans?.partAnswers?.[i];
        const correctIdx = part.answerIndex;

        rows.push({
          id: `${q.id}-${i + 1}`,
          thumb: q.image || q.stemImage || q.passageImage || q.tableImage || "",
          prompt: `${q.promptEn ?? ""} ${part.partLabel ?? ""} ${part.questionJa ?? ""}`.trim(),
          isCorrect: chosenIdx === correctIdx,

          chosen: getPartChoiceText(part, chosenIdx),
          correct: getPartChoiceText(part, correctIdx),

          chosenImg: pickPartChoiceImage(part, chosenIdx),
          correctImg: pickPartChoiceImage(part, correctIdx),
        });
      });
      continue;
    }

    // ===== 単問（Script/Vocabなど）=====
    const chosenIdx = state.answers[q.id];
    const correctIdx = q.answerIndex;

    // 問題文の表示テキスト（最低限）
    const promptText =
      q.type === "mcq_sentence_blank"
        ? (q.sentenceJa ?? q.promptEn ?? "")
        : q.type === "mcq_kanji_reading"
          ? (q.sentencePartsJa?.map((p) => p.text).join("") ?? q.promptEn ?? "")
          : q.type === "mcq_dialog_with_image"
            ? (q.dialogJa?.join(" / ") ?? q.promptEn ?? "")
            : (q.promptEn ?? "");

    rows.push({
      id: String(q.id),
      thumb: q.image || q.stemImage || q.passageImage || q.tableImage || "",
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





function renderResult(app) {
  const { correct, total } = scoreAll();
  const rows = buildResultRows(); // ★ results rows (chosenImg/correctImg を含む想定)
  const scoreRate = total === 0 ? 0 : correct / total;
  const passRate = getActivePassRate();
  const isPass = scoreRate >= passRate;

  // ★ Resultに入った瞬間にタイマーを止めたい場合（testEndAt方式を入れてるなら）
  // state.testEndAt = state.testEndAt ?? Date.now();
  // saveState();

  app.innerHTML = `
    <div class="app">
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
          <button class="btn btn-primary" id="takeAgainBtn">Take Again</button>
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

      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right"></div>
      </footer>
    </div>
  `;

  // topbar right button disable
  document.querySelector("#disabledBtn").disabled = true;

  // actions
  document.querySelector("#takeAgainBtn")?.addEventListener("click", resetAll);

  saveAttemptIfNeeded();
}




function render() {
  const app = document.querySelector("#app");
  if (!state.linkChecked || !authState.checked) return renderLoading(app);
  if (state.linkInvalid) return renderLinkInvalid(app);
  if (authState.session && authState.mustChangePassword) return renderSetPassword(app);
  if (!authState.session && !state.linkId) return renderLogin(app);
  if (authState.session && !state.linkId && state.phase === "intro") return renderTestSelect(app);
  if (state.phase === "login") return renderLogin(app);
  if (state.phase === "intro") return renderIntro(app);
  if (state.phase === "sectionIntro") return renderSectionIntro(app); // ←追加
  if (state.phase === "quiz") return renderQuiz(app);
  if (state.phase === "result") return renderResult(app);
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
    state.linkInvalid = false;
    state.linkChecked = true;
    saveState();
    return;
  }

  try {
    const { data, error } = await publicSupabase
      .from("exam_links")
      .select("id, test_version, expires_at")
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
    state.linkTestVersion = data.test_version;
    state.linkInvalid = false;
    state.linkChecked = true;
    state.phase = "intro";
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
});

Promise.all([checkLinkFromUrl(), refreshAuthState()]).finally(render);
fetchPublicTests().finally(render);
