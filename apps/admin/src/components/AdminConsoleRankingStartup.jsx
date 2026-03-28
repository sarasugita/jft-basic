"use client";

import { useMemo, useRef, useState } from "react";
import { createAdminSupabaseClient, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { logAdminEvent } from "../lib/adminDiagnostics";
import AdminConsoleRankingWorkspace from "./AdminConsoleRankingWorkspace";
import { AdminConsoleWorkspaceProvider } from "./AdminConsoleWorkspaceContext";

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
  const supabaseConfigError = getAdminSupabaseConfigError();
  const supabase = useMemo(
    () => (supabaseConfigError || !activeSchoolId ? null : createAdminSupabaseClient({ schoolScopeId: activeSchoolId })),
    [activeSchoolId, supabaseConfigError]
  );
  const [students, setStudents] = useState([]);
  const [rankingPeriods, setRankingPeriods] = useState([]);
  const [rankingDrafts, setRankingDrafts] = useState({});
  const [rankingMsg, setRankingMsg] = useState("");
  const [rankingRefreshingId, setRankingRefreshingId] = useState("");

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console ranking startup render start", {
      activeSchoolId,
      hasSupabaseClient: Boolean(supabase),
    });
  }

  async function fetchStudents() {
    if (supabaseConfigError) {
      setStudents([]);
      return;
    }
    if (!supabase || !activeSchoolId) {
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
    if (!supabase || !activeSchoolId) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg("Select a school.");
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
    if (!supabase || !period?.id) return;
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
    if (!supabase || !activeSchoolId) {
      setRankingMsg("Select a school.");
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
    if (!supabase || !period?.id || !activeSchoolId) return;
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

  const workspaceContextValue = {
    activeSchoolId,
    fetchRankingPeriods,
    students,
    fetchStudents,
    addRankingPeriod,
    rankingPeriods,
    rankingDrafts,
    updateRankingDraft,
    saveRankingPeriodLabel,
    rankingRefreshingId,
    refreshRankingPeriod,
    rankingRowCount,
    rankingMsg,
  };

  return (
    <AdminConsoleWorkspaceProvider value={workspaceContextValue}>
      <AdminConsoleRankingWorkspace />
    </AdminConsoleWorkspaceProvider>
  );
}
