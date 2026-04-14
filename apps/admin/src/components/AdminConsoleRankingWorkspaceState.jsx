"use client";

import { useEffect, useMemo, useState } from "react";
import { logAdminEvent } from "../lib/adminDiagnostics";
import {
  readAdminConsoleDataCache,
  writeAdminConsoleDataCache,
} from "../lib/adminConsoleDataCache";
import {
  buildLatestAttemptMapByStudentAndScope,
  isAnalyticsExcludedStudent,
  getRowTimestamp,
} from "../lib/adminAnalyticsHelpers";

const SUPABASE_SAFE_PAGE_SIZE = 500;

async function fetchAllPages(buildPageQuery, pageSize = SUPABASE_SAFE_PAGE_SIZE) {
  const rows = [];
  let offset = 0;

  while (true) {
    const result = await buildPageQuery(offset, pageSize);
    if (result.error) return { data: null, error: result.error };

    const page = result.data ?? [];
    rows.push(...page);

    if (page.length < pageSize) {
      return { data: rows, error: null };
    }

    offset += pageSize;
  }
}

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

function normalizeRankingDraft(period, draft = {}) {
  return {
    label: draft.label ?? period?.label ?? "",
    start_date: draft.start_date ?? period?.start_date ?? "",
    end_date: draft.end_date ?? period?.end_date ?? "",
  };
}

function getSessionDisplayTitle(session, tests = []) {
  const sessionTitle = String(session?.title ?? "").trim();
  if (sessionTitle) return sessionTitle;
  const version = String(session?.problem_set_id ?? "").trim();
  if (!version) return "Session";
  const fallbackTitle = String((tests ?? []).find((test) => test.version === version)?.title ?? "").trim();
  return fallbackTitle || version;
}

function getRankingAttemptTimestamp(attempt) {
  return getRowTimestamp(attempt);
}

function isRankingAttemptInPeriod(attempt, startIso, endIso) {
  const timestamp = getRankingAttemptTimestamp(attempt);
  if (!timestamp) return false;
  const startTime = new Date(startIso).getTime();
  const endTime = new Date(endIso).getTime();
  return timestamp >= startTime && timestamp <= endTime;
}

async function fetchRankingPeriodAttempts({ supabase, schoolId, studentId = null, startIso, endIso }) {
  const baseSelect = "id, student_id, test_session_id, test_version, score_rate, correct, total, created_at, ended_at";

  const endedRows = await fetchAllPages((offset, pageSize) => {
    let query = supabase
      .from("attempts")
      .select(baseSelect)
      .eq("school_id", schoolId)
      .gte("ended_at", startIso)
      .lte("ended_at", endIso)
      .order("ended_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (studentId) query = query.eq("student_id", studentId);
    return query;
  });

  if (endedRows.error) return endedRows;

  const createdFallbackRows = await fetchAllPages((offset, pageSize) => {
    let query = supabase
      .from("attempts")
      .select(baseSelect)
      .eq("school_id", schoolId)
      .is("ended_at", null)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (studentId) query = query.eq("student_id", studentId);
    return query;
  });

  if (createdFallbackRows.error) return createdFallbackRows;

  const seenIds = new Set();
  const merged = [];
  for (const row of [...(endedRows.data ?? []), ...(createdFallbackRows.data ?? [])]) {
    if (!row?.id || seenIds.has(row.id)) continue;
    if (!isRankingAttemptInPeriod(row, startIso, endIso)) continue;
    seenIds.add(row.id);
    merged.push(row);
  }

  return { data: merged, error: null };
}

export function useRankingWorkspaceState({ supabase, activeSchoolId, session, testSessions = [], tests = [] }) {
  const cacheUserId = session?.user?.id ?? "";
  const cachedState = cacheUserId && activeSchoolId ? readAdminConsoleDataCache(cacheUserId, activeSchoolId) : null;
  const [rankingPeriods, setRankingPeriods] = useState(() => cachedState?.rankingPeriods ?? []);
  const [rankingMsg, setRankingMsg] = useState(() => cachedState?.rankingMsg ?? "");
  const [rankingLoaded, setRankingLoaded] = useState(false);
  const [rankingDrafts, setRankingDrafts] = useState(() => {
    const periods = cachedState?.rankingPeriods ?? [];
    const cachedDrafts = cachedState?.rankingDrafts ?? {};
    const drafts = {};
    periods.forEach((period) => {
      if (!period?.id) return;
      drafts[period.id] = normalizeRankingDraft(period, cachedDrafts[period.id]);
    });
    return drafts;
  });
  const [rankingRefreshingId, setRankingRefreshingId] = useState("");
  const [rankingDetailModal, setRankingDetailModal] = useState({
    open: false,
    loading: false,
    error: "",
    periodId: "",
    periodLabel: "",
    studentId: "",
    studentName: "",
    averageRate: null,
    rankPosition: null,
    startDate: "",
    endDate: "",
    usedAttempts: [],
  });

  useEffect(() => {
    if (!cacheUserId || !activeSchoolId) return;
    writeAdminConsoleDataCache(cacheUserId, activeSchoolId, {
      rankingPeriods,
      rankingMsg,
      rankingLoaded,
      rankingDrafts,
    });
  }, [activeSchoolId, cacheUserId, rankingDrafts, rankingLoaded, rankingMsg, rankingPeriods]);

  useEffect(() => {
    setRankingLoaded(false);
  }, [activeSchoolId, cacheUserId]);

  useEffect(() => {
    setRankingDetailModal((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, [activeSchoolId]);

  const rankingRowCount = useMemo(
    () => Math.max(0, ...rankingPeriods.map((period) => period.ranking_entries?.length ?? 0)),
    [rankingPeriods]
  );

  async function fetchRankingPeriods() {
    if (!activeSchoolId) {
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg("Select a school.");
      setRankingLoaded(false);
      return;
    }
    setRankingMsg("Loading...");
    const { data, error } = await supabase
      .from("ranking_periods")
      .select(`
        id,
        school_id,
        label,
        start_date,
        end_date,
        sort_order,
        updated_at,
        ranking_entries(id, student_id, student_name, average_rate, rank_position)
      `)
      .eq("school_id", activeSchoolId)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("ranking periods fetch error:", error);
      setRankingPeriods([]);
      setRankingDrafts({});
      setRankingMsg(`Load failed: ${error.message}`);
      setRankingLoaded(false);
      return;
    }
    const periods = data ?? [];
    const normalized = periods.map((period) => ({
      ...period,
      ranking_entries: [...(period.ranking_entries ?? [])].sort((a, b) => (a.rank_position ?? 0) - (b.rank_position ?? 0))
    }));
    setRankingPeriods(normalized);
    setRankingDrafts((prev) => {
      const nextDrafts = {};
      normalized.forEach((period) => {
        if (!period?.id) return;
        nextDrafts[period.id] = normalizeRankingDraft(period, prev[period.id]);
      });
      return nextDrafts;
    });
    setRankingMsg(normalized.length ? "" : "No ranking periods yet. Click Add Period.");
    setRankingLoaded(true);
  }

  function updateRankingDraft(periodId, field, value) {
    setRankingDrafts((prev) => ({
      ...prev,
      [periodId]: {
        label: prev[periodId]?.label ?? rankingPeriods.find((period) => period.id === periodId)?.label ?? "",
        start_date: prev[periodId]?.start_date ?? rankingPeriods.find((period) => period.id === periodId)?.start_date ?? "",
        end_date: prev[periodId]?.end_date ?? rankingPeriods.find((period) => period.id === periodId)?.end_date ?? "",
        [field]: value,
      }
    }));
  }

  async function saveRankingPeriodLabel(period) {
    if (!period?.id) return;
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
        }
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
      console.error("ranking period label update error:", error);
      setRankingMsg(`Save failed: ${error.message}`);
      return;
    }
    setRankingPeriods((prev) =>
      prev.map((item) => (item.id === period.id ? { ...item, label: nextLabel } : item))
    );
    setRankingDrafts((prev) => ({
      ...prev,
      [period.id]: {
        label: nextLabel,
        start_date: prev[period.id]?.start_date ?? period.start_date ?? "",
        end_date: prev[period.id]?.end_date ?? period.end_date ?? "",
      }
    }));
    setRankingMsg(`Saved ${nextLabel}.`);
  }

  async function addRankingPeriod() {
    if (!activeSchoolId) {
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
      console.error("ranking period create error:", error);
      setRankingMsg(`Add period failed: ${error.message}`);
      return;
    }
    setRankingMsg("");
    await fetchRankingPeriods();
  }

  async function refreshRankingPeriod(period) {
    if (!period?.id) return;
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
    logAdminEvent("Ranking refresh start", {
      schoolId: activeSchoolId,
      periodId: period.id,
      label: nextLabel,
      startDate: draft.start_date,
      endDate: draft.end_date,
    });
    const startIso = new Date(`${draft.start_date}T00:00:00`).toISOString();
    const endIso = new Date(`${draft.end_date}T23:59:59.999`).toISOString();
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
      console.error("ranking period update error:", periodError);
      setRankingMsg(`Refresh failed: ${periodError.message}`);
      setRankingRefreshingId("");
      return;
    }

    const { data: attemptsData, error: attemptsError } = await fetchRankingPeriodAttempts({
      supabase,
      schoolId: activeSchoolId,
      startIso,
      endIso,
    });
    if (attemptsError) {
      console.error("ranking attempts fetch error:", attemptsError);
      setRankingMsg(`Refresh failed: ${attemptsError.message}`);
      setRankingRefreshingId("");
      return;
    }

    const { data: studentRows, error: studentsError } = await supabase
      .from("profiles")
      .select("id, display_name, email, student_code, is_withdrawn, is_test_account")
      .eq("role", "student")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false });
    if (studentsError) {
      console.error("ranking students fetch error:", studentsError);
      setRankingMsg(`Refresh failed: ${studentsError.message}`);
      setRankingRefreshingId("");
      return;
    }
    const rankingStudents = (studentRows ?? []).filter((student) => !isAnalyticsExcludedStudent(student));

    const studentMeta = new Map(
      rankingStudents.map((student) => [
        student.id,
        student.display_name || student.email || student.student_code || student.id
      ])
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
        student_id: studentId,
        student_name: studentMeta.get(studentId) ?? studentId,
        average_rate: stats.count ? stats.sum / stats.count : 0,
      }))
      .sort((a, b) => {
        if (b.average_rate !== a.average_rate) return b.average_rate - a.average_rate;
        return String(a.student_name).localeCompare(String(b.student_name));
      })
      .map((item, index) => ({
        period_id: period.id,
        school_id: activeSchoolId,
        student_id: item.student_id,
        student_name: item.student_name,
        average_rate: item.average_rate,
        rank_position: index + 1,
      }));

    const rankingRates = rankings.map((item) => Number(item.average_rate)).filter((value) => Number.isFinite(value));
    logAdminEvent("Ranking refresh debug", {
      schoolId: activeSchoolId,
      periodId: period.id,
      label: nextLabel,
      attemptsFetched: attemptsData?.length ?? 0,
      studentsFetched: studentRows?.length ?? 0,
      rankingStudents: rankingStudents.length,
      latestAttemptRows: totalsByStudent.size,
      rankingsCount: rankings.length,
      minRate: rankingRates.length ? Math.min(...rankingRates) : null,
      maxRate: rankingRates.length ? Math.max(...rankingRates) : null,
      topRate: rankings[0]?.average_rate ?? null,
    });

    const { error: clearError } = await supabase
      .from("ranking_entries")
      .delete()
      .eq("period_id", period.id);
    if (clearError) {
      console.error("ranking entries clear error:", clearError);
      setRankingMsg(`Refresh failed: ${clearError.message}`);
      setRankingRefreshingId("");
      return;
    }
    if (rankings.length) {
      const { error: insertError } = await supabase
        .from("ranking_entries")
        .insert(rankings);
      if (insertError) {
        console.error("ranking entries insert error:", insertError);
        setRankingMsg(`Refresh failed: ${insertError.message}`);
        setRankingRefreshingId("");
        return;
      }
    }
    setRankingRefreshingId("");
    setRankingMsg(`Updated ${nextLabel}.`);
    logAdminEvent("Ranking refresh complete", {
      schoolId: activeSchoolId,
      periodId: period.id,
      label: nextLabel,
      rankingsCount: rankings.length,
    });
    await fetchRankingPeriods();
  }

  async function openRankingEntryDetail(period, entry) {
    if (!period?.id || !entry?.student_id) return;

    const draft = rankingDrafts[period.id] ?? normalizeRankingDraft(period);
    const periodLabel = String(period.label ?? draft.label ?? "Ranking period").trim() || "Ranking period";
    const startDate = String(period.start_date ?? draft.start_date ?? "").trim();
    const endDate = String(period.end_date ?? draft.end_date ?? "").trim();

    setRankingDetailModal({
      open: true,
      loading: true,
      error: "",
      periodId: period.id,
      periodLabel,
      studentId: entry.student_id,
      studentName: String(entry.student_name ?? "").trim() || entry.student_id,
      averageRate: Number(entry.average_rate ?? 0),
      rankPosition: Number(entry.rank_position ?? 0) || null,
      startDate,
      endDate,
      usedAttempts: [],
    });

    if (!startDate || !endDate) {
      setRankingDetailModal((prev) => ({
        ...prev,
        loading: false,
        error: "This period needs both start and end dates before we can load the score list.",
      }));
      return;
    }

    const { data: attemptsData, error } = await fetchRankingPeriodAttempts({
      supabase,
      schoolId: activeSchoolId,
      studentId: entry.student_id,
      startIso: new Date(`${startDate}T00:00:00`).toISOString(),
      endIso: new Date(`${endDate}T23:59:59.999`).toISOString(),
    });

    if (error) {
      console.error("ranking detail attempts fetch error:", error);
      setRankingDetailModal((prev) => ({
        ...prev,
        loading: false,
        error: `Load failed: ${error.message}`,
      }));
      return;
    }

    const testSessionsById = new Map((testSessions ?? []).map((item) => [item.id, item]));
    const usedAttempts = Array.from(buildLatestAttemptMapByStudentAndScope(attemptsData).values())
      .filter((attempt) => attempt?.student_id === entry.student_id)
      .sort((a, b) => {
        const timeDiff = getRowTimestamp(a) - getRowTimestamp(b);
        if (timeDiff !== 0) return timeDiff;
        return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
      })
      .map((attempt) => {
        const scoreRate = Number(attempt?.score_rate ?? (attempt?.total ? attempt.correct / attempt.total : 0));
        const sessionRecord = attempt?.test_session_id ? testSessionsById.get(attempt.test_session_id) ?? null : null;
        return {
          ...attempt,
          scoreRate: Number.isFinite(scoreRate) ? scoreRate : 0,
          scopeLabel: sessionRecord ? getSessionDisplayTitle(sessionRecord, tests) : (String(attempt?.test_version ?? "").trim() || "Attempt"),
        };
      });

    setRankingDetailModal((prev) => ({
      ...prev,
      loading: false,
      error: "",
      usedAttempts,
    }));
  }

  function closeRankingEntryDetail() {
    setRankingDetailModal({
      open: false,
      loading: false,
      error: "",
      periodId: "",
      periodLabel: "",
      studentId: "",
      studentName: "",
      averageRate: null,
      rankPosition: null,
      startDate: "",
      endDate: "",
      usedAttempts: [],
    });
  }

  async function deleteRankingPeriod(period) {
    if (!period?.id) return;
    const label = String(period.label ?? "Ranking period").trim() || "Ranking period";
    const ok = window.confirm(
      `Delete "${label}"?\n\nThis will also remove its saved ranking entries.`
    );
    if (!ok) return;

    setRankingRefreshingId(period.id);
    setRankingMsg("");
    const { error } = await supabase
      .from("ranking_periods")
      .delete()
      .eq("id", period.id)
      .eq("school_id", activeSchoolId);
    if (error) {
      console.error("ranking period delete error:", error);
      setRankingMsg(`Delete failed: ${error.message}`);
      setRankingRefreshingId("");
      return;
    }

    setRankingRefreshingId("");
    setRankingMsg(`Deleted ${label}.`);
    await fetchRankingPeriods();
  }

  return {
    rankingPeriods,
    rankingDrafts,
    rankingMsg,
    rankingLoaded,
    rankingRefreshingId,
    rankingRowCount,
    fetchRankingPeriods,
    updateRankingDraft,
    saveRankingPeriodLabel,
    addRankingPeriod,
    refreshRankingPeriod,
    deleteRankingPeriod,
    rankingDetailModal,
    openRankingEntryDetail,
    closeRankingEntryDetail,
  };
}
