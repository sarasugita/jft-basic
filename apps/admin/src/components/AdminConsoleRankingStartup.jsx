"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { logAdminEvent } from "../lib/adminDiagnostics";

const ADMIN_SUPABASE_CONFIG_ERROR = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

function getRankingDrafts(periods) {
  const drafts = {};
  (periods ?? []).forEach((period) => {
    if (!period?.id) return;
    drafts[period.id] = {
      label: period.label ?? "",
      start_date: period.start_date ?? "",
      end_date: period.end_date ?? "",
    };
  });
  return drafts;
}

function isAnalyticsExcludedStudent(student) {
  return Boolean(student?.is_withdrawn || student?.is_test_account);
}

function getRowTimestamp(row) {
  const endedTime = row?.ended_at ? new Date(row.ended_at).getTime() : NaN;
  if (Number.isFinite(endedTime)) return endedTime;
  const createdTime = row?.created_at ? new Date(row.created_at).getTime() : NaN;
  if (Number.isFinite(createdTime)) return createdTime;
  return 0;
}

function getAttemptScopeKey(attempt) {
  return `${attempt?.test_session_id || ""}::${attempt?.test_version || ""}`;
}

function buildLatestAttemptMapByStudentAndScope(attemptsList, getScopeKey = getAttemptScopeKey) {
  const map = new Map();
  for (const attempt of attemptsList ?? []) {
    if (!attempt?.student_id) continue;
    const scopeKey = getScopeKey(attempt);
    const key = `${attempt.student_id}::${scopeKey}`;
    const existing = map.get(key);
    if (!existing || getRowTimestamp(attempt) >= getRowTimestamp(existing)) {
      map.set(key, attempt);
    }
  }
  return map;
}

export default function AdminConsoleRankingStartup({ activeSchoolId }) {
  const renderTraceLoggedRef = useRef(false);
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const supabaseRef = useRef(null);
  const [students, setStudents] = useState([]);
  const [rankingPeriods, setRankingPeriods] = useState([]);
  const [rankingDrafts, setRankingDrafts] = useState({});
  const [rankingMsg, setRankingMsg] = useState("");
  const [rankingRefreshingId, setRankingRefreshingId] = useState("");

  useEffect(() => {
    supabaseRef.current = null;
  }, [activeSchoolId]);

  const getSupabaseClient = useCallback(async () => {
    if (supabaseConfigError) {
      throw new Error(supabaseConfigError);
    }
    if (!activeSchoolId) {
      throw new Error("Select a school.");
    }
    if (supabaseRef.current) {
      return supabaseRef.current;
    }
    const { createAdminSupabaseClient } = await import("../lib/adminSupabase");
    const client = createAdminSupabaseClient({ schoolScopeId: activeSchoolId });
    supabaseRef.current = client;
    return client;
  }, [activeSchoolId, supabaseConfigError]);

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console ranking startup render start", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }

  useEffect(() => {
    if (!activeSchoolId) return;
    void fetchRankingPeriods();
    if (!students.length) {
      void fetchStudents();
    }
  }, [activeSchoolId, students.length]);

  async function fetchStudents() {
    if (supabaseConfigError) {
      setStudents([]);
      return;
    }
    if (!activeSchoolId) {
      setStudents([]);
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch {
      setStudents([]);
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, student_code, is_withdrawn, is_test_account")
      .eq("role", "student")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false });
    if (error) {
      setStudents([]);
      return;
    }
    setStudents(data ?? []);
  }

  async function fetchRankingPeriods() {
    if (supabaseConfigError) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg(supabaseConfigError);
      return;
    }
    if (!activeSchoolId) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg("Select a school.");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    setRankingMsg("Loading...");
    const { data, error } = await supabase
      .from("ranking_periods")
      .select("id, label, start_date, end_date, sort_order, ranking_entries(id, student_id, student_name, average_rate, rank_position)")
      .eq("school_id", activeSchoolId)
      .order("sort_order", { ascending: true });
    if (error) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg(`Load failed: ${error.message}`);
      return;
    }
    const periods = (data ?? []).map((period) => ({
      ...period,
      ranking_entries: [...(period.ranking_entries ?? [])].sort((a, b) => (a.rank_position ?? 0) - (b.rank_position ?? 0)),
    }));
    setRankingPeriods(periods);
    setRankingDrafts(getRankingDrafts(periods));
    setRankingMsg(periods.length ? "" : "No ranking periods yet. Click Add Period.");
  }

  function updateRankingDraft(periodId, field, value) {
    setRankingDrafts((prev) => ({
      ...prev,
      [periodId]: {
        label: prev[periodId]?.label ?? "",
        start_date: prev[periodId]?.start_date ?? "",
        end_date: prev[periodId]?.end_date ?? "",
        [field]: value,
      },
    }));
  }

  async function saveRankingPeriodLabel(period) {
    if (!period?.id) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setRankingMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const draft = rankingDrafts[period.id] ?? { label: "", start_date: "", end_date: "" };
    const nextLabel = String(draft.label ?? "").trim();
    const currentLabel = String(period.label ?? "").trim();
    if (!nextLabel) {
      setRankingMsg("Period name is required.");
      setRankingDrafts((prev) => ({
        ...prev,
        [period.id]: {
          label: currentLabel,
          start_date: prev[period.id]?.start_date ?? period.start_date ?? "",
          end_date: prev[period.id]?.end_date ?? period.end_date ?? "",
        },
      }));
      return;
    }
    if (nextLabel === currentLabel) return;
    const { error } = await supabase
      .from("ranking_periods")
      .update({
        label: nextLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id);
    if (error) {
      setRankingMsg(`Save failed: ${error.message}`);
      return;
    }
    setRankingPeriods((prev) => prev.map((item) => (item.id === period.id ? { ...item, label: nextLabel } : item)));
    setRankingDrafts((prev) => ({
      ...prev,
      [period.id]: {
        label: nextLabel,
        start_date: prev[period.id]?.start_date ?? period.start_date ?? "",
        end_date: prev[period.id]?.end_date ?? period.end_date ?? "",
      },
    }));
    setRankingMsg(`Saved ${nextLabel}.`);
  }

  async function addRankingPeriod() {
    if (!activeSchoolId) {
      setRankingMsg("Select a school.");
      return;
    }
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setRankingMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const nextSortOrder = (rankingPeriods ?? []).reduce((max, period) => Math.max(max, Number(period.sort_order ?? -1)), -1) + 1;
    const nextLabel = `Period ${nextSortOrder + 1}`;
    const { error } = await supabase
      .from("ranking_periods")
      .insert({
        school_id: activeSchoolId,
        label: nextLabel,
        sort_order: nextSortOrder,
      });
    if (error) {
      setRankingMsg(`Add period failed: ${error.message}`);
      return;
    }
    setRankingMsg("");
    await fetchRankingPeriods();
  }

  async function refreshRankingPeriod(period) {
    if (!period?.id || !activeSchoolId) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setRankingMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const draft = rankingDrafts[period.id] ?? { label: "", start_date: "", end_date: "" };
    const nextLabel = String(draft.label ?? "").trim();
    if (!nextLabel) {
      setRankingMsg("Period name is required.");
      return;
    }
    if (!draft.start_date || !draft.end_date) {
      setRankingMsg(`Set both start and end dates for ${nextLabel}.`);
      return;
    }
    setRankingRefreshingId(period.id);
    setRankingMsg("");
    const { error: periodError } = await supabase
      .from("ranking_periods")
      .update({
        label: nextLabel,
        start_date: draft.start_date,
        end_date: draft.end_date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", period.id);
    if (periodError) {
      setRankingMsg(`Refresh failed: ${periodError.message}`);
      setRankingRefreshingId("");
      return;
    }

    const { data: attemptsData, error: attemptsError } = await supabase
      .from("attempts")
      .select("student_id, test_session_id, test_version, score_rate, correct, total, created_at, ended_at")
      .eq("school_id", activeSchoolId)
      .gte("created_at", new Date(`${draft.start_date}T00:00:00`).toISOString())
      .lte("created_at", new Date(`${draft.end_date}T23:59:59`).toISOString());
    if (attemptsError) {
      setRankingMsg(`Refresh failed: ${attemptsError.message}`);
      setRankingRefreshingId("");
      return;
    }

    let rankingStudents = students.filter((student) => !isAnalyticsExcludedStudent(student));
    if (!rankingStudents.length) {
      const { data: studentRows, error: studentsError } = await supabase
        .from("profiles")
        .select("id, display_name, email, student_code, is_withdrawn, is_test_account")
        .eq("role", "student")
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false });
      if (studentsError) {
        setRankingMsg(`Refresh failed: ${studentsError.message}`);
        setRankingRefreshingId("");
        return;
      }
      rankingStudents = (studentRows ?? []).filter((student) => !isAnalyticsExcludedStudent(student));
      setStudents(studentRows ?? []);
    }

    const studentMeta = new Map(
      rankingStudents.map((student) => [student.id, student.display_name || student.email || student.student_code || student.id])
    );
    const totalsByStudent = new Map();
    Array.from(buildLatestAttemptMapByStudentAndScope(attemptsData).values()).forEach((row) => {
      if (!row?.student_id || !studentMeta.has(row.student_id)) return;
      const rate = Number(row.score_rate ?? (row.total ? row.correct / row.total : 0));
      if (!Number.isFinite(rate)) return;
      const current = totalsByStudent.get(row.student_id) ?? { sum: 0, count: 0 };
      current.sum += rate;
      current.count += 1;
      totalsByStudent.set(row.student_id, current);
    });

    const rankings = Array.from(totalsByStudent.entries())
      .map(([studentId, stats]) => ({
        period_id: period.id,
        school_id: activeSchoolId,
        student_id: studentId,
        student_name: studentMeta.get(studentId) ?? studentId,
        average_rate: stats.count ? stats.sum / stats.count : 0,
      }))
      .sort((a, b) => {
        if (b.average_rate !== a.average_rate) return b.average_rate - a.average_rate;
        return String(a.student_name).localeCompare(String(b.student_name));
      })
      .map((item, index) => ({
        ...item,
        rank_position: index + 1,
      }));

    const { error: clearError } = await supabase.from("ranking_entries").delete().eq("period_id", period.id);
    if (clearError) {
      setRankingMsg(`Refresh failed: ${clearError.message}`);
      setRankingRefreshingId("");
      return;
    }
    if (rankings.length) {
      const { error: insertError } = await supabase.from("ranking_entries").insert(rankings);
      if (insertError) {
        setRankingMsg(`Refresh failed: ${insertError.message}`);
        setRankingRefreshingId("");
        return;
      }
    }

    setRankingRefreshingId("");
    setRankingMsg(`Updated ${nextLabel}.`);
    await fetchRankingPeriods();
  }

  const rankingRowCount = Math.max(0, ...rankingPeriods.map((period) => period.ranking_entries?.length ?? 0));

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="admin-title">Ranking</div>
          <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" type="button" onClick={addRankingPeriod}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 5v10M5 10h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Add Period
          </button>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 12 }}>
        <table className="admin-table ranking-table" style={{ minWidth: Math.max(420, 160 + rankingPeriods.length * 260) }}>
          <thead>
            <tr>
              <th rowSpan={2}>Rank</th>
              {rankingPeriods.map((period) => {
                const draft = rankingDrafts[period.id] ?? { label: period.label ?? "", start_date: "", end_date: "" };
                return (
                  <th key={period.id} colSpan={2}>
                    <div className="ranking-period-head">
                      <input
                        type="text"
                        value={draft.label}
                        onChange={(e) => updateRankingDraft(period.id, "label", e.target.value)}
                        onBlur={() => saveRankingPeriodLabel(period)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder="Period name"
                        aria-label={`Name for ${period.label}`}
                        className="admin-input"
                        style={{ minWidth: 0, width: "100%" }}
                      />
                      <button
                        className="btn btn-primary admin-icon-action-btn ranking-refresh-btn"
                        type="button"
                        aria-label={`Refresh ${draft.label || period.label || "ranking period"}`}
                        title={rankingRefreshingId === period.id ? "Refreshing..." : "Refresh period"}
                        onClick={() => refreshRankingPeriod(period)}
                        disabled={rankingRefreshingId === period.id}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d="M16 10a6 6 0 1 1-1.76-4.24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                          <path
                            d="M16 4.5v3.75h-3.75"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="ranking-period-range">
                      <input
                        type="date"
                        value={draft.start_date}
                        onChange={(e) => updateRankingDraft(period.id, "start_date", e.target.value)}
                      />
                      <span>to</span>
                      <input
                        type="date"
                        value={draft.end_date}
                        onChange={(e) => updateRankingDraft(period.id, "end_date", e.target.value)}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
            <tr>
              {rankingPeriods.map((period) => (
                <Fragment key={`cols-${period.id}`}>
                  <th>Student</th>
                  <th>Average %</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rankingPeriods.length && rankingRowCount ? (
              Array.from({ length: rankingRowCount }, (_, idx) => (
                <tr key={`ranking-row-${idx + 1}`}>
                  <td>{idx + 1}</td>
                  {rankingPeriods.map((period) => {
                    const entry = period.ranking_entries?.[idx] ?? null;
                    return (
                      <Fragment key={`${period.id}-${idx + 1}`}>
                        <td>{entry?.student_name || "-"}</td>
                        <td>{entry ? `${(Number(entry.average_rate) * 100).toFixed(2)}%` : "-"}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={Math.max(1, 1 + rankingPeriods.length * 2)} className="ranking-empty-cell">
                  {rankingPeriods.length ? "Press Refresh to calculate the configured periods." : "No ranking periods yet. Click Add Period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-msg">{rankingMsg}</div>
    </div>
  );
}
