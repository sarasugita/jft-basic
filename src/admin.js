import "./style.css";
import "./admin.css";
import { questions, sections } from "./data/questions.js";
import { supabase } from "./supabaseClient.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
          isCorrect: chosenIdx === correctIdx,
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
      isCorrect: chosenIdx === correctIdx,
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

let appState = {
  session: null,
  profile: null,
  attempts: [],
  selectedAttempt: null,
};

async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("getSession error:", error);
    return null;
  }
  return data.session ?? null;
}

async function fetchMyProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("id, role, display_name").eq("id", userId).single();
  if (error) {
    console.error("fetch profile error:", error);
    return null;
  }
  return data;
}

function renderLogin() {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="admin-login">
      <h2>Admin Login</h2>
      <div class="admin-help">メールとパスワードでログインします（admin権限のユーザーのみ閲覧可）。</div>

      <div style="margin-top:12px;">
        <label>Email</label>
        <input id="email" type="email" placeholder="admin@example.com" />
      </div>

      <div style="margin-top:10px;">
        <label>Password</label>
        <input id="password" type="password" placeholder="••••••••" />
      </div>

      <div class="admin-actions" style="margin-top:14px;">
        <button class="btn btn-primary" id="loginBtn" style="min-width: 160px;">Log in</button>
      </div>

      <div class="admin-msg" id="msg"></div>
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
  });
}

function renderUnauthorized(profile) {
  const app = document.querySelector("#app");
  app.innerHTML = `
    <div class="admin-login">
      <h2>Unauthorized</h2>
      <div class="admin-help">
        このユーザーは admin 権限ではありません。<br/>
        role: <b>${escapeHtml(profile?.role ?? "unknown")}</b>
      </div>
      <div class="admin-actions" style="margin-top:14px;">
        <button class="btn" id="signOutBtn">Sign out</button>
      </div>
    </div>
  `;
  app.querySelector("#signOutBtn").addEventListener("click", () => supabase.auth.signOut());
}

function renderAdmin() {
  const app = document.querySelector("#app");
  const userEmail = appState.session?.user?.email ?? "";
  const role = appState.profile?.role ?? "";

  app.innerHTML = `
    <div class="admin-wrap">
      <div class="admin-top">
        <div>
          <div class="admin-title">Admin Panel</div>
          <div class="admin-help">受験結果（attempts）を検索・詳細表示・CSV出力できます。</div>
        </div>
        <div class="admin-meta">
          <span class="admin-chip">user: ${escapeHtml(userEmail)}</span>
          <span class="admin-chip">role: ${escapeHtml(role)}</span>
          <div class="admin-actions">
            <button class="btn" id="refreshBtn">Refresh</button>
            <button class="btn" id="exportSummaryBtn">Export CSV (Summary)</button>
            <button class="btn" id="exportDetailBtn">Export CSV (Detail)</button>
            <button class="btn" id="signOutBtn">Sign out</button>
          </div>
        </div>
      </div>

      <div class="admin-panel">
        <form class="admin-form" id="filterForm">
          <div class="field">
            <label>Student Code（部分一致）</label>
            <input id="fCode" placeholder="ID001" />
          </div>
          <div class="field">
            <label>Display Name（部分一致）</label>
            <input id="fName" placeholder="Taro" />
          </div>
          <div class="field small">
            <label>From（created_at）</label>
            <input id="fFrom" type="date" />
          </div>
          <div class="field small">
            <label>To（created_at）</label>
            <input id="fTo" type="date" />
          </div>
          <div class="field small">
            <label>Limit</label>
            <select id="fLimit">
              <option value="50">50</option>
              <option value="200" selected>200</option>
              <option value="500">500</option>
              <option value="1000">1000</option>
            </select>
          </div>
          <div class="field small">
            <label>&nbsp;</label>
            <button class="btn btn-primary" id="searchBtn" type="submit">Search</button>
          </div>
        </form>

        <div class="admin-grid" style="margin-top:12px;">
          <div>
            <div class="admin-kpi" id="kpi"></div>
            <div style="margin-top:12px;" class="admin-table-wrap">
              <table class="admin-table">
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
                <tbody id="tbody"></tbody>
              </table>
            </div>
            <div class="admin-msg" id="listMsg"></div>
          </div>

          <div>
            <div class="admin-panel" style="padding:12px;">
              <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                <h3 style="margin:0;">Attempt Detail</h3>
                <div class="admin-actions">
                  <button class="btn" id="exportSelectedBtn" type="button">Export CSV (Selected)</button>
                </div>
              </div>
              <div class="admin-help muted" id="detailHint" style="margin-top:6px;">左の一覧から選択してください。</div>
              <div class="admin-detail" id="detail"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  app.querySelector("#signOutBtn").addEventListener("click", () => supabase.auth.signOut());
  app.querySelector("#refreshBtn").addEventListener("click", () => runSearch());
  app.querySelector("#filterForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch();
  });

  app.querySelector("#exportSummaryBtn").addEventListener("click", () => exportSummaryCsv(appState.attempts));
  app.querySelector("#exportDetailBtn").addEventListener("click", () => exportDetailCsv(appState.attempts));
  app.querySelector("#exportSelectedBtn").addEventListener("click", () => {
    if (!appState.selectedAttempt) return;
    exportSelectedAttemptCsv(appState.selectedAttempt);
  });

  runSearch();
}

function renderKpi(attempts) {
  const kpi = document.querySelector("#kpi");
  if (!kpi) return;
  const count = attempts.length;
  const avgRate =
    count === 0
      ? 0
      : attempts.reduce((acc, a) => acc + Number(a.score_rate ?? 0), 0) / Math.max(1, count);
  const maxRate = count === 0 ? 0 : Math.max(...attempts.map((a) => Number(a.score_rate ?? 0)));

  kpi.innerHTML = `
    <div class="box"><div class="label">Attempts</div><div class="value">${count}</div></div>
    <div class="box"><div class="label">Avg rate</div><div class="value">${(avgRate * 100).toFixed(1)}%</div></div>
    <div class="box"><div class="label">Max rate</div><div class="value">${(maxRate * 100).toFixed(1)}%</div></div>
  `;
}

function renderAttemptsTable(attempts) {
  const tbody = document.querySelector("#tbody");
  const msg = document.querySelector("#listMsg");
  if (!tbody) return;

  if (msg) msg.textContent = "";
  tbody.innerHTML = attempts
    .map((a) => {
      const created = formatDateTime(a.created_at);
      const score = `${a.correct}/${a.total}`;
      const rate = `${(Number(a.score_rate ?? 0) * 100).toFixed(1)}%`;
      const id = a.id;
      return `
        <tr data-attempt-id="${escapeHtml(id)}">
          <td>${escapeHtml(created)}</td>
          <td>${escapeHtml(a.display_name ?? "")}</td>
          <td>${escapeHtml(a.student_code ?? "")}</td>
          <td>${escapeHtml(score)}</td>
          <td>${escapeHtml(rate)}</td>
          <td>${escapeHtml(a.test_version ?? "")}</td>
          <td style="white-space:nowrap;">${escapeHtml(id)}</td>
        </tr>
      `;
    })
    .join("");

  tbody.querySelectorAll("tr[data-attempt-id]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = tr.getAttribute("data-attempt-id");
      const attempt = appState.attempts.find((x) => x.id === id);
      if (!attempt) return;
      appState.selectedAttempt = attempt;
      renderAttemptDetail(attempt);
    });
  });
}

function renderAttemptDetail(attempt) {
  const detail = document.querySelector("#detail");
  const hint = document.querySelector("#detailHint");
  if (!detail) return;
  if (hint) hint.textContent = "";

  const rows = buildAttemptDetailRows(attempt.answers_json);
  const summary = `
    <div class="admin-help">
      <b>${escapeHtml(attempt.display_name ?? "")}</b>
      (${escapeHtml(attempt.student_code ?? "")})<br/>
      created: ${escapeHtml(formatDateTime(attempt.created_at))}<br/>
      score: <b>${escapeHtml(attempt.correct)}/${escapeHtml(attempt.total)}</b>
      (${escapeHtml((Number(attempt.score_rate ?? 0) * 100).toFixed(1))}%)
    </div>
  `;

  const table = `
    <div class="admin-table-wrap" style="margin-top:10px;">
      <table class="admin-table" style="min-width: 860px;">
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
          ${rows
            .map(
              (r) => `
            <tr>
              <td style="white-space:nowrap;">${escapeHtml(r.qid)}</td>
              <td style="white-space:nowrap;">${escapeHtml(r.section)}</td>
              <td>${escapeHtml(r.prompt)}</td>
              <td>${escapeHtml(r.chosen)}</td>
              <td>${escapeHtml(r.correct)}</td>
              <td style="text-align:center;">${r.isCorrect ? "○" : "×"}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  detail.innerHTML = summary + table;
}

async function runSearch() {
  const msg = document.querySelector("#listMsg");
  if (msg) msg.textContent = "Loading...";

  const code = document.querySelector("#fCode")?.value?.trim() ?? "";
  const name = document.querySelector("#fName")?.value?.trim() ?? "";
  const fromDate = document.querySelector("#fFrom")?.value ?? "";
  const toDate = document.querySelector("#fTo")?.value ?? "";
  const limit = Number(document.querySelector("#fLimit")?.value ?? 200);

  let query = supabase
    .from("attempts")
    .select(
      "id, display_name, student_code, test_version, correct, total, score_rate, started_at, ended_at, created_at, answers_json",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (code) query = query.ilike("student_code", `%${code}%`);
  if (name) query = query.ilike("display_name", `%${name}%`);
  if (fromDate) query = query.gte("created_at", new Date(`${fromDate}T00:00:00`).toISOString());
  if (toDate) query = query.lte("created_at", new Date(`${toDate}T23:59:59`).toISOString());

  const { data, error } = await query;
  if (error) {
    console.error("attempts fetch error:", error);
    if (msg) msg.textContent = `Load failed: ${error.message}`;
    appState.attempts = [];
    renderKpi([]);
    renderAttemptsTable([]);
    return;
  }

  appState.attempts = data ?? [];
  renderKpi(appState.attempts);
  renderAttemptsTable(appState.attempts);

  if (msg) msg.textContent = appState.attempts.length === 0 ? "No results." : "";
}

function exportSummaryCsv(attempts) {
  const rows = [
    ["attempt_id", "created_at", "display_name", "student_code", "test_version", "correct", "total", "score_rate"],
    ...attempts.map((a) => [
      a.id,
      a.created_at,
      a.display_name ?? "",
      a.student_code ?? "",
      a.test_version ?? "",
      a.correct ?? 0,
      a.total ?? 0,
      a.score_rate ?? 0,
    ]),
  ];
  downloadText(`attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
}

function exportDetailCsv(attempts) {
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
      "is_correct",
    ],
  ];

  for (const a of attempts) {
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
        d.isCorrect ? 1 : 0,
      ]);
    }
  }

  downloadText(`attempts_detail_${Date.now()}.csv`, toCsv(rows), "text/csv");
}

function exportSelectedAttemptCsv(attempt) {
  const details = buildAttemptDetailRows(attempt.answers_json);
  const rows = [
    ["question_id", "section", "prompt", "chosen", "correct", "is_correct"],
    ...details.map((d) => [d.qid, d.section, d.prompt, d.chosen, d.correct, d.isCorrect ? 1 : 0]),
  ];
  downloadText(`attempt_${attempt.id}_detail.csv`, toCsv(rows), "text/csv");
}

async function boot() {
  appState.session = await getSession();
  if (!appState.session) {
    renderLogin();
    return;
  }

  appState.profile = await fetchMyProfile(appState.session.user.id);
  if (!appState.profile) {
    renderUnauthorized({ role: "unknown" });
    return;
  }

  if (appState.profile.role !== "admin") {
    renderUnauthorized(appState.profile);
    return;
  }

  renderAdmin();
}

supabase.auth.onAuthStateChange((_event, session) => {
  appState.session = session ?? null;
  appState.profile = null;
  appState.attempts = [];
  appState.selectedAttempt = null;
  boot();
});

boot();

