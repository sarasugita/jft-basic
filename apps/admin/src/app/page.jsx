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

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [filters, setFilters] = useState({
    code: "",
    name: "",
    from: "",
    to: "",
    limit: 200
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");

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
  }, [session, profile]);

  async function runSearch() {
    setLoading(true);
    setMsg("Loading...");
    const { code, name, from, to, limit } = filters;

    let query = supabase
      .from("attempts")
      .select(
        "id, display_name, student_code, test_version, correct, total, score_rate, started_at, ended_at, created_at, answers_json"
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

  function exportSummaryCsv(list) {
    const rows = [
      ["attempt_id", "created_at", "display_name", "student_code", "test_version", "correct", "total", "score_rate"],
      ...list.map((a) => [
        a.id,
        a.created_at,
        a.display_name ?? "",
        a.student_code ?? "",
        a.test_version ?? "",
        a.correct ?? 0,
        a.total ?? 0,
        a.score_rate ?? 0
      ])
    ];
    downloadText(`attempts_summary_${Date.now()}.csv`, toCsv(rows), "text/csv");
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
      count === 0 ? 0 : attempts.reduce((acc, a) => acc + Number(a.score_rate ?? 0), 0) / Math.max(1, count);
    const maxRate = count === 0 ? 0 : Math.max(...attempts.map((a) => Number(a.score_rate ?? 0)));
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
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>

      <div className="admin-panel">
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
                    const rate = `${(Number(a.score_rate ?? 0) * 100).toFixed(1)}%`;
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
                    {(Number(selectedAttempt.score_rate ?? 0) * 100).toFixed(1)}%)
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

