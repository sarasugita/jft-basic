"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Helper functions

function normalizeStudentNumberInput(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

function getStudentDisplayName(student) {
  return student?.display_name ?? student?.email ?? student?.id ?? "";
}

function getRowTimestamp(row) {
  const value = row?.ended_at || row?.created_at || row?.started_at || null;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getAttemptScopeKey(attempt) {
  if (attempt?.test_session_id) return `session:${attempt.test_session_id}`;
  if (attempt?.test_version) return `version:${attempt.test_version}`;
  return `attempt:${attempt?.id ?? getRowTimestamp(attempt)}`;
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

function isMissingTabLeftCountError(error) {
  const text = `${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`;
  return /tab_left_count/i.test(text) && /does not exist/i.test(text);
}

function buildStudentMetricRows(sortedStudents, attendanceMap, attemptsList, testMetaByVersion, getScoreRate) {
  const byStudent = new Map();
  Array.from(buildLatestAttemptMapByStudentAndScope(attemptsList).values()).forEach((attempt) => {
    if (!attempt?.student_id) return;
    const list = byStudent.get(attempt.student_id) || [];
    list.push(attempt);
    byStudent.set(attempt.student_id, list);
  });

  return (sortedStudents ?? []).map((student) => {
    const attendance = attendanceMap?.[student.id] || { total: 0, present: 0, unexcused: 0, rate: null };
    const studentAttempts = byStudent.get(student.id) || [];
    const modelScores = [];
    const dailyScores = [];
    studentAttempts.forEach((attempt) => {
      const meta = testMetaByVersion?.[attempt.test_version];
      if (!meta?.type) return;
      const rate = getScoreRate(attempt) * 100;
      if (meta.type === "mock") modelScores.push(rate);
      if (meta.type === "daily") dailyScores.push(rate);
    });
    return {
      student,
      attendanceRate: attendance.rate,
      unexcused: attendance.unexcused ?? 0,
      modelAvg: modelScores.length ? modelScores.reduce((acc, rate) => acc + rate, 0) / modelScores.length : null,
      dailyAvg: dailyScores.length ? dailyScores.reduce((acc, rate) => acc + rate, 0) / dailyScores.length : null,
    };
  });
}

export function useStudentsWorkspaceState({ supabase, activeSchoolId, session, students, testMetaByVersion, getScoreRate, fetchStudentDetail, setStudentWarningForm, setStudentWarningIssueMsg, setStudentWarningIssueOpen }) {
  // Student list state
  const [studentMsg, setStudentMsg] = useState("");
  const [studentTempMap, setStudentTempMap] = useState({});
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [selectedStudentTab, setSelectedStudentTab] = useState("information");

  // Student detail view state
  const [studentAttempts, setStudentAttempts] = useState([]);
  const [studentAttemptsMsg, setStudentAttemptsMsg] = useState("");
  const [studentAttemptRanks, setStudentAttemptRanks] = useState({});
  const [studentAttendance, setStudentAttendance] = useState([]);
  const [studentAttendanceMsg, setStudentAttendanceMsg] = useState("");
  const [studentAttendanceRange, setStudentAttendanceRange] = useState({ from: "", to: "" });

  // Student info edit state
  const [studentInfoOpen, setStudentInfoOpen] = useState(false);
  const [studentInfoSaving, setStudentInfoSaving] = useState(false);
  const [studentInfoMsg, setStudentInfoMsg] = useState("");
  const [studentInfoForm, setStudentInfoForm] = useState({});
  const [studentInfoUploadFiles, setStudentInfoUploadFiles] = useState({});

  // Student list filters and metrics
  const [studentListFilters, setStudentListFilters] = useState({
    from: "",
    to: "",
    maxAttendance: "",
    minUnexcused: "",
    minModelAvg: "",
    minDailyAvg: ""
  });
  const [studentListAttendanceMap, setStudentListAttendanceMap] = useState({});
  const [studentListAttempts, setStudentListAttempts] = useState([]);
  const [studentListLoading, setStudentListLoading] = useState(false);
  const [studentListMetricsLoaded, setStudentListMetricsLoaded] = useState(false);

  // Student detail modal state
  const [studentDetailOpen, setStudentDetailOpen] = useState(false);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);
  const [studentDetailMsg, setStudentDetailMsg] = useState("");
  const [studentReportExporting, setStudentReportExporting] = useState(false);
  const [studentAttendanceMonthKey, setStudentAttendanceMonthKey] = useState("__all__");

  // Student warnings state - Note: studentWarningForm, setStudentWarningForm, and warning issue/delete operations stay in context
  // to ensure context functions can access the current form state
  const [studentWarnings, setStudentWarnings] = useState([]);
  const [studentWarningsLoading, setStudentWarningsLoading] = useState(false);
  const [studentWarningsLoaded, setStudentWarningsLoaded] = useState(false);
  const [studentWarningsMsg, setStudentWarningsMsg] = useState("");

  // Reset state when activeSchoolId changes
  useEffect(() => {
    if (!activeSchoolId) {
      setStudentMsg("");
      setSelectedStudentId("");
      setSelectedStudentDetail(null);
      setStudentListAttendanceMap({});
      setStudentListAttempts([]);
      setStudentListMetricsLoaded(false);
      setStudentWarnings([]);
      setStudentWarningsLoaded(false);
    }
  }, [activeSchoolId]);

  // Fetch student list metrics
  const fetchStudentListMetrics = useCallback(async () => {
    if (!activeSchoolId) {
      setStudentListAttendanceMap({});
      setStudentListAttempts([]);
      setStudentListMetricsLoaded(false);
      setStudentListLoading(false);
      return;
    }
    setStudentListLoading(true);
    const { from, to } = studentListFilters;
    let daysQuery = supabase
      .from("attendance_days")
      .select("id, day_date")
      .eq("school_id", activeSchoolId);
    if (from) daysQuery = daysQuery.gte("day_date", from);
    if (to) daysQuery = daysQuery.lte("day_date", to);
    const { data: daysData, error: daysError } = await daysQuery;
    if (daysError) {
      console.error("student list attendance days error:", daysError);
      setStudentListAttendanceMap({});
    } else {
      const dayIds = (daysData ?? []).map((d) => d.id);
      if (!dayIds.length) {
        setStudentListAttendanceMap({});
      } else {
        const { data: entriesData, error: entriesError } = await supabase
          .from("attendance_entries")
          .select("day_id, student_id, status")
          .in("day_id", dayIds);
        if (entriesError) {
          console.error("student list attendance entries error:", entriesError);
          setStudentListAttendanceMap({});
        } else {
          const map = {};
          (entriesData ?? []).forEach((row) => {
            if (!row?.student_id) return;
            const stats = map[row.student_id] || { total: 0, present: 0, unexcused: 0 };
            if (row.status) stats.total += 1;
            if (row.status === "P" || row.status === "L") stats.present += 1;
            if (row.status === "A") stats.unexcused += 1;
            map[row.student_id] = stats;
          });
          Object.keys(map).forEach((id) => {
            const stats = map[id];
            stats.rate = stats.total ? (stats.present / stats.total) * 100 : null;
          });
          setStudentListAttendanceMap(map);
        }
      }
    }

    const buildStudentListAttemptsQuery = (fields) => {
      let attemptsQuery = supabase
        .from("attempts")
        .select(fields)
        .eq("school_id", activeSchoolId)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (from) attemptsQuery = attemptsQuery.gte("created_at", new Date(`${from}T00:00:00`).toISOString());
      if (to) attemptsQuery = attemptsQuery.lte("created_at", new Date(`${to}T23:59:59`).toISOString());
      return attemptsQuery;
    };
    let { data: attemptsData, error: attemptsError } = await buildStudentListAttemptsQuery(
      "id, student_id, test_version, correct, total, score_rate, created_at, ended_at, tab_left_count"
    );
    if (attemptsError && isMissingTabLeftCountError(attemptsError)) {
      ({ data: attemptsData, error: attemptsError } = await buildStudentListAttemptsQuery(
        "id, student_id, test_version, correct, total, score_rate, created_at, ended_at"
      ));
    }
    if (attemptsError) {
      console.error("student list attempts error:", attemptsError);
      setStudentListAttempts([]);
    } else {
      setStudentListAttempts(attemptsData ?? []);
    }
    setStudentListMetricsLoaded(true);
    setStudentListLoading(false);
  }, [activeSchoolId, supabase, studentListFilters]);

  // Open warnings modal
  const openStudentWarningsModalFn = useCallback((getDefaultStudentWarningForm) => {
    setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters));
    setStudentWarningIssueMsg("");
    setStudentWarningIssueOpen(true);
  }, [studentListFilters]);

  // Open student detail view
  const openStudentDetailFn = useCallback(async (studentId) => {
    if (!studentId) return;
    setSelectedStudentId(studentId);
    setSelectedStudentTab("information");
    setStudentAttendance([]);
    setStudentAttendanceMsg("");
    setStudentAttendanceRange({ from: "", to: "" });
    setStudentDetailOpen(true);
    if (selectedStudentDetail?.id !== studentId) {
      setSelectedStudentDetail(null);
    }
    if (fetchStudentDetail) {
      await fetchStudentDetail(studentId);
    }
  }, [selectedStudentDetail?.id, fetchStudentDetail]);

  // Memos for derived data
  const sortedStudents = useMemo(() => {
    const list = [...(students ?? [])];
    const codeNum = (code) => {
      const m = String(code ?? "").match(/(\d+)/);
      return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
    };
    list.sort((a, b) => {
      const aNum = codeNum(a.student_code);
      const bNum = codeNum(b.student_code);
      if (aNum !== bNum) return aNum - bNum;
      const aCode = String(a.student_code ?? "");
      const bCode = String(b.student_code ?? "");
      if (aCode !== bCode) return aCode.localeCompare(bCode);
      const aName = String(a.display_name ?? "");
      const bName = String(b.display_name ?? "");
      if (aName !== bName) return aName.localeCompare(bName);
      return String(a.email ?? "").localeCompare(String(b.email ?? ""));
    });
    return list;
  }, [students]);

  const studentListRows = useMemo(() => {
    const rows = buildStudentMetricRows(sortedStudents, studentListAttendanceMap, studentListAttempts, testMetaByVersion, getScoreRate);

    const maxAttendance =
      studentListFilters.maxAttendance === "" ? null : Number(studentListFilters.maxAttendance);
    const minUnexcused =
      studentListFilters.minUnexcused === "" ? null : Number(studentListFilters.minUnexcused);
    const minModelAvg =
      studentListFilters.minModelAvg === "" ? null : Number(studentListFilters.minModelAvg);
    const minDailyAvg =
      studentListFilters.minDailyAvg === "" ? null : Number(studentListFilters.minDailyAvg);

    return rows.filter((row) => {
      if (maxAttendance != null) {
        const rate = row.attendanceRate ?? 0;
        if (rate > maxAttendance) return false;
      }
      if (minUnexcused != null && row.unexcused < minUnexcused) return false;
      if (minModelAvg != null) {
        const value = row.modelAvg ?? 0;
        if (value < minModelAvg) return false;
      }
      if (minDailyAvg != null) {
        const value = row.dailyAvg ?? 0;
        if (value < minDailyAvg) return false;
      }
      return true;
    });
  }, [
    sortedStudents,
    studentListAttendanceMap,
    studentListAttempts,
    studentListFilters,
    testMetaByVersion,
    getScoreRate
  ]);

  return {
    // State
    studentMsg,
    setStudentMsg,
    studentTempMap,
    setStudentTempMap,
    selectedStudentId,
    setSelectedStudentId,
    selectedStudentDetail,
    setSelectedStudentDetail,
    selectedStudentTab,
    setSelectedStudentTab,
    studentAttempts,
    setStudentAttempts,
    studentAttemptsMsg,
    setStudentAttemptsMsg,
    studentAttemptRanks,
    setStudentAttemptRanks,
    studentAttendance,
    setStudentAttendance,
    studentAttendanceMsg,
    setStudentAttendanceMsg,
    studentAttendanceRange,
    setStudentAttendanceRange,
    studentInfoOpen,
    setStudentInfoOpen,
    studentInfoSaving,
    setStudentInfoSaving,
    studentInfoMsg,
    setStudentInfoMsg,
    studentInfoForm,
    setStudentInfoForm,
    studentInfoUploadFiles,
    setStudentInfoUploadFiles,
    studentListFilters,
    setStudentListFilters,
    studentListAttendanceMap,
    studentListAttempts,
    studentListLoading,
    studentListMetricsLoaded,
    studentDetailOpen,
    setStudentDetailOpen,
    studentDetailLoading,
    setStudentDetailLoading,
    studentDetailMsg,
    setStudentDetailMsg,
    studentReportExporting,
    setStudentReportExporting,
    studentAttendanceMonthKey,
    setStudentAttendanceMonthKey,
    studentWarnings,
    setStudentWarnings,
    studentWarningsLoading,
    setStudentWarningsLoading,
    studentWarningsLoaded,
    setStudentWarningsLoaded,
    studentWarningsMsg,
    setStudentWarningsMsg,
    // Functions
    fetchStudentListMetrics,
    openStudentWarningsModalFn,
    openStudentDetailFn,
    // Memos
    sortedStudents,
    studentListRows,
    // Helpers
    normalizeStudentNumberInput,
    getStudentDisplayName,
  };
}
