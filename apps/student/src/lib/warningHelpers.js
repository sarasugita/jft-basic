import { studentAttendanceState } from "../state/attendanceState";
import { studentResultsState } from "../state/resultsState";
import { testsState } from "../state/testsState";
import { getAttemptTestType, getScoreRateFromAttempt } from "./attemptHelpers";

export function normalizeStudentWarningCriteria(criteria = {}) {
  const normalizeNumber = (value) => {
    if (value === "" || value == null) return "";
    const number = Number(value);
    return Number.isFinite(number) ? number : "";
  };

  return {
    title: String(criteria.title ?? "").trim(),
    from: String(criteria.from ?? "").trim(),
    to: String(criteria.to ?? "").trim(),
    maxAttendance: normalizeNumber(criteria.maxAttendance),
    minUnexcused: normalizeNumber(criteria.minUnexcused),
    maxModelAvg: normalizeNumber(criteria.maxModelAvg),
    maxDailyAvg: normalizeNumber(criteria.maxDailyAvg),
  };
}

export function getCurrentStudentWarningIssues(criteria = {}) {
  const normalized = normalizeStudentWarningCriteria(criteria);
  const needsAttendance = normalized.maxAttendance !== "" || normalized.minUnexcused !== "";
  const needsResults = normalized.maxModelAvg !== "" || normalized.maxDailyAvg !== "";
  if (needsAttendance && !studentAttendanceState.loaded) return null;
  if (needsResults && !studentResultsState.loaded) return null;

  const attendanceRows = (studentAttendanceState.list ?? []).filter((row) => {
    const date = String(row?.day_date ?? "");
    if (!date) return false;
    if (normalized.from && date < normalized.from) return false;
    if (normalized.to && date > normalized.to) return false;
    return true;
  });
  const attendanceTotal = attendanceRows.length;
  const attendancePresent = attendanceRows.filter((row) => row.status === "P" || row.status === "L").length;
  const attendanceRate = attendanceTotal ? (attendancePresent / attendanceTotal) * 100 : null;
  const unexcused = attendanceRows.filter((row) => row.status === "A").length;

  const attempts = (studentResultsState.list ?? []).filter((attempt) => {
    const date = String(attempt?.created_at ?? "").slice(0, 10);
    if (!date) return false;
    if (normalized.from && date < normalized.from) return false;
    if (normalized.to && date > normalized.to) return false;
    return true;
  });
  const modelScores = [];
  const dailyScores = [];
  attempts.forEach((attempt) => {
    const type = getAttemptTestType(attempt, testsState.list);
    const rate = getScoreRateFromAttempt(attempt) * 100;
    if (type === "mock") modelScores.push(rate);
    if (type === "daily") dailyScores.push(rate);
  });
  const modelAvg = modelScores.length ? modelScores.reduce((sum, rate) => sum + rate, 0) / modelScores.length : null;
  const dailyAvg = dailyScores.length ? dailyScores.reduce((sum, rate) => sum + rate, 0) / dailyScores.length : null;

  const issues = [];
  if (normalized.maxAttendance !== "" && normalized.maxAttendance != null) {
    const value = attendanceRate ?? 0;
    if (value <= normalized.maxAttendance) issues.push(`Attendance ${value.toFixed(1)}% <= ${normalized.maxAttendance}%`);
  }
  if (normalized.minUnexcused !== "" && normalized.minUnexcused != null && unexcused >= normalized.minUnexcused) {
    issues.push(`Unexcused ${unexcused} >= ${normalized.minUnexcused}`);
  }
  if (normalized.maxModelAvg !== "" && normalized.maxModelAvg != null) {
    const value = modelAvg ?? 0;
    if (value <= normalized.maxModelAvg) issues.push(`Model Avg ${value.toFixed(1)}% <= ${normalized.maxModelAvg}%`);
  }
  if (normalized.maxDailyAvg !== "" && normalized.maxDailyAvg != null) {
    const value = dailyAvg ?? 0;
    if (value <= normalized.maxDailyAvg) issues.push(`Daily Avg ${value.toFixed(1)}% <= ${normalized.maxDailyAvg}%`);
  }
  return issues;
}
