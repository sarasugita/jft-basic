"use client";

import { useEffect, useMemo, useState } from "react";
import { logAdminEvent } from "../lib/adminDiagnostics";
import {
  readAdminConsoleDataCache,
  writeAdminConsoleDataCache,
} from "../lib/adminConsoleDataCache";
import {
  isAnalyticsExcludedStudent,
  getRowTimestamp,
} from "../lib/adminAnalyticsHelpers";

const SUPABASE_SAFE_PAGE_SIZE = 500;
const SUPABASE_IN_FILTER_CHUNK = 100;
const bangladeshDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

function normalizeLookupValue(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function getBangladeshDateKey(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const time = new Date(text);
  if (!Number.isFinite(time.getTime())) return "";
  const parts = bangladeshDateFormatter.formatToParts(time);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

function getRankingSessionDateValue(session) {
  return session?.starts_at || session?.ends_at || session?.created_at || "";
}

function getRankingSessionDateKey(session) {
  return getBangladeshDateKey(getRankingSessionDateValue(session));
}

function getRankingSessionTimestamp(session) {
  const value = getRankingSessionDateValue(session);
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isRankingRetakeSession(session) {
  return Boolean(session?.retake_source_session_id) || String(session?.title ?? "").trim().startsWith("[Retake]");
}

function isRankingSessionInPeriod(session, startIso, endIso) {
  const timestamp = getRankingSessionTimestamp(session);
  if (!timestamp) return false;
  const startTime = new Date(startIso).getTime();
  const endTime = new Date(endIso).getTime();
  return timestamp >= startTime && timestamp <= endTime;
}

function buildRankingPeriodSessions(testSessions, startIso, endIso) {
  return (testSessions ?? [])
    .filter((session) => session?.id && !isRankingRetakeSession(session) && isRankingSessionInPeriod(session, startIso, endIso))
    .sort((left, right) => {
      const timeDiff = getRankingSessionTimestamp(left) - getRankingSessionTimestamp(right);
      if (timeDiff !== 0) return timeDiff;
      return String(left?.title ?? left?.problem_set_id ?? left?.id ?? "").localeCompare(
        String(right?.title ?? right?.problem_set_id ?? right?.id ?? "")
      );
    });
}

function buildRankingSessionLookup(sessions) {
  const byId = new Map();

  (sessions ?? []).forEach((session) => {
    if (!session?.id) return;
    byId.set(session.id, session);
  });

  return { byId };
}

function getRankingAttemptSession(attempt, sessionLookup) {
  if (!attempt?.test_session_id) return null;
  return sessionLookup?.byId.get(attempt.test_session_id) ?? null;
}

function getRankingAttemptDisplayDateValue(attempt, sessionLookup) {
  const meta = attempt?.answers_json?.__meta ?? {};
  const importedDate = String(meta.imported_test_date ?? meta.imported_date_iso ?? meta.session_date ?? "").trim();
  if (importedDate) return importedDate;
  const session = getRankingAttemptSession(attempt, sessionLookup);
  return session?.starts_at || session?.ends_at || attempt?.ended_at || attempt?.created_at || attempt?.started_at || "";
}

function getRankingAttemptTimestamp(attempt, sessionLookup) {
  const value = getRankingAttemptDisplayDateValue(attempt, sessionLookup);
  if (!value) return getRowTimestamp(attempt);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? `${value}T00:00:00` : value;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : getRowTimestamp(attempt);
}

function getRankingAttemptDisplayDateKey(attempt, sessionLookup) {
  return getBangladeshDateKey(getRankingAttemptDisplayDateValue(attempt, sessionLookup));
}

function getRankingAttemptTitle(attempt, sessionLookup, tests = []) {
  const meta = attempt?.answers_json?.__meta ?? {};
  const importedTitle = String(meta.imported_test_title ?? meta.session_title ?? "").trim();
  if (importedTitle) return importedTitle;
  const session = getRankingAttemptSession(attempt, sessionLookup);
  if (session?.title) return session.title;
  const version = String(attempt?.test_version ?? "").trim();
  if (!version) return "Attempt";
  const fallbackTitle = String((tests ?? []).find((test) => test.version === version)?.title ?? "").trim();
  return fallbackTitle || version;
}

function shouldShowAttemptInRanking(attempt, sessionLookup) {
  if (!attempt) return false;
  if (!attempt.test_session_id) return true;
  return Boolean(getRankingAttemptSession(attempt, sessionLookup));
}

function chunkValues(values, size = SUPABASE_IN_FILTER_CHUNK) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchRankingRelevantAttempts({
  supabase,
  schoolId,
  studentId = null,
  sessionIds = [],
  testVersions = [],
}) {
  const baseSelect = "id, student_id, test_session_id, test_version, score_rate, correct, total, started_at, created_at, ended_at, answers_json";
  const mergedById = new Map();

  async function collectMatches(column, values) {
    for (const chunk of chunkValues(values.filter(Boolean))) {
      const result = await fetchAllPages((offset, pageSize) => {
        let query = supabase
          .from("attempts")
          .select(baseSelect)
          .eq("school_id", schoolId)
          .in(column, chunk)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (studentId) query = query.eq("student_id", studentId);
        return query;
      });
      if (result.error) return result;
      (result.data ?? []).forEach((row) => {
        if (row?.id) mergedById.set(row.id, row);
      });
    }
    return { data: Array.from(mergedById.values()), error: null };
  }

  const uniqueSessionIds = Array.from(new Set((sessionIds ?? []).filter(Boolean)));
  if (uniqueSessionIds.length) {
    const result = await collectMatches("test_session_id", uniqueSessionIds);
    if (result.error) return result;
  }

  const uniqueVersions = Array.from(new Set((testVersions ?? []).filter(Boolean)));
  if (uniqueVersions.length) {
    const result = await collectMatches("test_version", uniqueVersions);
    if (result.error) return result;
  }

  return { data: Array.from(mergedById.values()), error: null };
}

function buildRankingAttemptRow(session, attempt, sessionLookup, tests = []) {
  const scoreRate = Number(attempt?.score_rate ?? (attempt?.total ? attempt.correct / attempt.total : 0));
  const normalizedScore = Number.isFinite(scoreRate) ? scoreRate : 0;
  return {
    id: attempt?.id ?? `session:${session?.id ?? ""}`,
    test_session_id: session?.id ?? attempt?.test_session_id ?? null,
    test_version: String(attempt?.test_version ?? session?.problem_set_id ?? "").trim(),
    scoreRate: normalizedScore,
    correct: attempt?.correct ?? 0,
    total: attempt?.total ?? 0,
    ended_at: attempt?.ended_at ?? null,
    created_at: attempt?.created_at ?? null,
    scopeLabel: getSessionDisplayTitle(session, tests),
    displayDateValue: getRankingAttemptDisplayDateValue(attempt, sessionLookup) || getRankingSessionDateValue(session),
    absent: false,
  };
}

function buildRankingAbsentRow(session, tests = []) {
  return {
    id: `absent:${session?.id ?? ""}`,
    test_session_id: session?.id ?? null,
    test_version: String(session?.problem_set_id ?? "").trim(),
    scoreRate: 0,
    correct: null,
    total: null,
    ended_at: null,
    created_at: null,
    scopeLabel: getSessionDisplayTitle(session, tests),
    displayDateValue: getRankingSessionDateValue(session),
    absent: true,
  };
}

function findBestRankingAttemptForSession({
  session,
  attempts,
  usedAttemptIds,
  rankingSessionIds,
  sessionLookup,
  tests = [],
}) {
  const sessionTitle = normalizeLookupValue(getSessionDisplayTitle(session, tests));
  const sessionVersion = String(session?.problem_set_id ?? "").trim();
  const sessionDateKey = getRankingSessionDateKey(session);
  let bestAttempt = null;
  let bestScore = -1;

  for (const attempt of attempts) {
    if (!attempt?.id || usedAttemptIds.has(attempt.id)) continue;
    const attemptSession = getRankingAttemptSession(attempt, sessionLookup);
    if (attemptSession && isRankingRetakeSession(attemptSession)) continue;
    if (attempt?.test_session_id && rankingSessionIds.has(attempt.test_session_id) && attempt.test_session_id !== session?.id) {
      continue;
    }

    const attemptDateKey = getRankingAttemptDisplayDateKey(attempt, sessionLookup);
    if (sessionDateKey && attemptDateKey && sessionDateKey !== attemptDateKey) continue;
    if (sessionDateKey && !attemptDateKey) continue;

    let score = 0;
    if (sessionDateKey && attemptDateKey === sessionDateKey) score += 200;
    if (sessionVersion && String(attempt?.test_version ?? "").trim() === sessionVersion) score += 40;
    if (sessionTitle && normalizeLookupValue(getRankingAttemptTitle(attempt, sessionLookup, tests)) === sessionTitle) score += 80;

    if (score <= 0) continue;

    if (!bestAttempt) {
      bestAttempt = attempt;
      bestScore = score;
      continue;
    }

    const timeDiff = getRankingAttemptTimestamp(attempt, sessionLookup) - getRankingAttemptTimestamp(bestAttempt, sessionLookup);
    if (score > bestScore || (score === bestScore && timeDiff > 0)) {
      bestAttempt = attempt;
      bestScore = score;
    }
  }

  return bestAttempt;
}

function buildRankingSessionRowsForStudent({
  studentId,
  rankingSessions,
  attemptsList,
  sessionLookup,
  tests = [],
}) {
  const rankingSessionIds = new Set((rankingSessions ?? []).map((session) => session?.id).filter(Boolean));
  const relevantAttempts = (attemptsList ?? [])
    .filter((attempt) => attempt?.student_id === studentId)
    .filter((attempt) => shouldShowAttemptInRanking(attempt, sessionLookup))
    .filter((attempt) => {
      const session = getRankingAttemptSession(attempt, sessionLookup);
      return !isRankingRetakeSession(session);
    })
    .sort((left, right) => {
      const timeDiff = getRankingAttemptTimestamp(right, sessionLookup) - getRankingAttemptTimestamp(left, sessionLookup);
      if (timeDiff !== 0) return timeDiff;
      return String(right?.id ?? "").localeCompare(String(left?.id ?? ""));
    });

  const exactAttemptBySessionId = new Map();
  const fallbackAttempts = [];

  for (const attempt of relevantAttempts) {
    const attemptSessionId = String(attempt?.test_session_id ?? "").trim();
    if (attemptSessionId && rankingSessionIds.has(attemptSessionId)) {
      const existing = exactAttemptBySessionId.get(attemptSessionId);
      if (!existing || getRankingAttemptTimestamp(attempt, sessionLookup) >= getRankingAttemptTimestamp(existing, sessionLookup)) {
        exactAttemptBySessionId.set(attemptSessionId, attempt);
      }
      continue;
    }
    fallbackAttempts.push(attempt);
  }

  const usedAttemptIds = new Set(Array.from(exactAttemptBySessionId.values()).map((attempt) => attempt?.id).filter(Boolean));

  return (rankingSessions ?? []).map((session) => {
    const exactAttempt = exactAttemptBySessionId.get(session?.id) ?? null;
    const matchedAttempt = exactAttempt || findBestRankingAttemptForSession({
      session,
      attempts: fallbackAttempts,
      usedAttemptIds,
      rankingSessionIds,
      sessionLookup,
      tests,
    });

    if (matchedAttempt?.id) {
      usedAttemptIds.add(matchedAttempt.id);
      return buildRankingAttemptRow(session, matchedAttempt, sessionLookup, tests);
    }

    return buildRankingAbsentRow(session, tests);
  });
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
    const rankingSessions = buildRankingPeriodSessions(testSessions, startIso, endIso);
    const rankingSessionLookup = buildRankingSessionLookup(testSessions);
    const rankingSessionIds = rankingSessions.map((session) => session.id).filter(Boolean);
    const rankingVersions = rankingSessions.map((session) => session.problem_set_id).filter(Boolean);
    const { data: attemptsData, error: attemptsError } = await fetchRankingRelevantAttempts({
      supabase,
      schoolId: activeSchoolId,
      sessionIds: rankingSessionIds,
      testVersions: rankingVersions,
    });
    if (attemptsError) {
      console.error("ranking attempts fetch error:", attemptsError);
      setRankingMsg(`Refresh failed: ${attemptsError.message}`);
      setRankingRefreshingId("");
      return;
    }

    const studentMeta = new Map(
      rankingStudents.map((student) => [
        student.id,
        student.display_name || student.email || student.student_code || student.id
      ])
    );
    let rankings = [];
    let rankingSlotsCount = 0;
    if (rankingSessions.length) {
      rankingSlotsCount = rankingSessions.length;
      rankings = rankingStudents
        .map((student) => {
          const sessionRows = buildRankingSessionRowsForStudent({
            studentId: student.id,
            rankingSessions,
            attemptsList: attemptsData,
            sessionLookup: rankingSessionLookup,
            tests,
          });
          const sum = sessionRows.reduce((acc, item) => acc + Number(item.scoreRate || 0), 0);

          return {
            student_id: student.id,
            student_name: studentMeta.get(student.id) ?? student.id,
            average_rate: rankingSlotsCount ? sum / rankingSlotsCount : 0,
            usedAttempts: sessionRows,
          };
        })
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
    } else {
      rankings = [];
    }

    const rankingRates = rankings.map((item) => Number(item.average_rate)).filter((value) => Number.isFinite(value));
    logAdminEvent("Ranking refresh debug", {
      schoolId: activeSchoolId,
      periodId: period.id,
      label: nextLabel,
      rankingSessions: rankingSessions.length,
      attemptsFetched: attemptsData?.length ?? 0,
      studentsFetched: studentRows?.length ?? 0,
      rankingStudents: rankingStudents.length,
      latestAttemptRows: rankings.length,
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

    const startIso = new Date(`${startDate}T00:00:00`).toISOString();
    const endIso = new Date(`${endDate}T23:59:59.999`).toISOString();
    const rankingSessions = buildRankingPeriodSessions(testSessions, startIso, endIso);
    const sessionLookup = buildRankingSessionLookup(testSessions);
    const { data: attemptsData, error } = await fetchRankingRelevantAttempts({
      supabase,
      schoolId: activeSchoolId,
      studentId: entry.student_id,
      sessionIds: rankingSessions.map((session) => session.id).filter(Boolean),
      testVersions: rankingSessions.map((session) => session.problem_set_id).filter(Boolean),
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

    const usedAttempts = buildRankingSessionRowsForStudent({
      studentId: entry.student_id,
      rankingSessions,
      attemptsList: attemptsData,
      sessionLookup,
      tests,
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
