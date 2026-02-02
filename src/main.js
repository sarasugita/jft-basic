import "./style.css";
import { questions, sections } from "./data/questions.js";

const STORAGE_KEY = "jft_mock_state_v3";

const TOTAL_TIME_SEC = 60 * 60; // 60分

const defaultState = {
  phase: "intro",
  sectionIndex: 0,
  questionIndexInSection: 0,
  answers: {},
  showBangla: false,

  testStartAt: null,   // ★追加：テスト開始時刻

  user: { name: "", id: "" },
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
  saveState();
  render();
}

function goIntro() {
  state.phase = "intro";
  state.sectionIndex = 0;
  state.questionIndexInSection = 0;
  state.showBangla = false;
  state.testStartAt = null; // ★全体タイマーを戻す
  saveState();
  render();
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
  if (!state.testStartAt) return TOTAL_TIME_SEC;
  const elapsed = Math.floor((Date.now() - state.testStartAt) / 1000);
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
function exportJSON() {
  const payload = {
    exportedAt: new Date().toISOString(),
    answers: state.answers,
    score: scoreAll(),
  };
  downloadText("jft-mock-result.json", JSON.stringify(payload, null, 2), "application/json");
}
function exportCSV() {
  const rows = [];
  rows.push(["questionId", "sectionKey", "part", "chosenIndex", "correctIndex", "isCorrect"].join(","));

  for (const q of questions) {
    if (q.parts?.length) {
      const ans = state.answers[q.id];
      q.parts.forEach((p, i) => {
        const chosen = ans?.partAnswers?.[i];
        const isCorrect = chosen === p.answerIndex ? "1" : "0";
        rows.push([q.id, q.sectionKey, String(i + 1), chosen ?? "", p.answerIndex, isCorrect].join(","));
      });
    } else {
      const chosen = state.answers[q.id];
      const isCorrect = chosen === q.answerIndex ? "1" : "0";
      rows.push([q.id, q.sectionKey, "", chosen ?? "", q.answerIndex, isCorrect].join(","));
    }
  }

  downloadText("jft-mock-result.csv", rows.join("\n"), "text/csv");
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
  app.innerHTML = `
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Not started", rightButtonId: "disabledBtn" })}

      <main class="content" style="margin:12px;">
        <h1 class="prompt">Mock Test</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>• Sections: ${sections.map(s => `<b>${s.title}</b>`).join(" → ")}</p>
          <p>• Each section has a timer.</p>
          <p>• Answers are saved automatically.</p>
        </div>

        <div class="intro-form" style="margin-top:16px; max-width:520px;">
          <label class="form-label">Name（任意）</label>
          <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

          <label class="form-label" style="margin-top:10px;">ID（任意）</label>
          <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextBtn">Next</button>
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

  document.querySelector("#resetBtn").addEventListener("click", resetAll);
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

function renderResult(app) {
  const { correct, total } = scoreAll();

  app.innerHTML = `
    <div class="app">
      ${topbarHTML({ rightButtonLabel: "Finished", rightButtonId: "disabledBtn" })}
      <main class="result">
        <h1>Result</h1>
        <p class="result-line"><b>${correct}</b> / ${total} correct</p>

        <div class="finish-actions">
          <button class="btn" id="exportCsvBtn">Export CSV</button>
          <button class="btn" id="exportJsonBtn">Export JSON</button>
          <button class="btn btn-primary" id="takeAgainBtn">Take Again</button>
        </div>

      </main>

      <footer class="bottombar">
        <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
        <div class="bottom-right"></div>
      </footer>
    </div>
  `;


  document.querySelector("#exportJsonBtn")?.addEventListener("click", exportJSON);
  document.querySelector("#exportCsvBtn")?.addEventListener("click", exportCSV);
  document.querySelector("#takeAgainBtn")?.addEventListener("click", resetAll);
  document.querySelector("#disabledBtn").disabled = true;

}

function render() {
  const app = document.querySelector("#app");
  if (state.phase === "intro") return renderIntro(app);
  if (state.phase === "sectionIntro") return renderSectionIntro(app); // ←追加
  if (state.phase === "quiz") return renderQuiz(app);
  if (state.phase === "result") return renderResult(app);
}


setInterval(() => {
  // quiz中じゃなくても、topbarを表示する画面なら更新したいならここを調整OK
  const timerEl = document.querySelector(".timer");
  if (timerEl) timerEl.textContent = formatTime(getTotalTimeLeftSec());

  if (state.phase !== "quiz") return;

  if (getTotalTimeLeftSec() <= 0) {
    state.phase = "result";
    saveState();
    render();
  }
}, 1000);


render();
