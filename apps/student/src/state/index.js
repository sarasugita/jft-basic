import { state } from "./appState";
import { questionsState } from "./questionsState";
import { studentResultsState, resultDetailState, modelRankState } from "./resultsState";
import { studentAttendanceState, absenceApplicationsState } from "./attendanceState";
import { rankingState } from "./rankingState";
import { sessionAttemptOverrideState } from "./sessionOverrideState";
import { issuedWarningsState } from "./warningsState";

export function resetSessionScopedState() {
  // Reset quiz-panel tracking
  state.studentPanelUserId = "";

  // Questions
  questionsState.loaded = false;
  questionsState.loading = false;
  questionsState.version = "";
  questionsState.updatedAt = "";
  questionsState.list = [];
  questionsState.error = "";

  // Results
  studentResultsState.userId = "";
  studentResultsState.loaded = false;
  studentResultsState.loading = false;
  studentResultsState.list = [];
  studentResultsState.error = "";

  // Attendance
  studentAttendanceState.userId = "";
  studentAttendanceState.loaded = false;
  studentAttendanceState.loading = false;
  studentAttendanceState.list = [];
  studentAttendanceState.error = "";

  // Ranking
  rankingState.userId = "";
  rankingState.loaded = false;
  rankingState.loading = false;
  rankingState.list = [];
  rankingState.error = "";

  // Session overrides
  sessionAttemptOverrideState.userId = "";
  sessionAttemptOverrideState.loaded = false;
  sessionAttemptOverrideState.loading = false;
  sessionAttemptOverrideState.map = {};
  sessionAttemptOverrideState.error = "";
  sessionAttemptOverrideState.lastFetchedAt = 0;

  // Absence applications
  absenceApplicationsState.loaded = false;
  absenceApplicationsState.loading = false;
  absenceApplicationsState.list = [];
  absenceApplicationsState.error = "";

  // Warnings
  issuedWarningsState.loaded = false;
  issuedWarningsState.loading = false;
  issuedWarningsState.list = [];
  issuedWarningsState.error = "";

  // Model ranks
  modelRankState.loading = false;
  modelRankState.loaded = false;
  modelRankState.map = {};
  modelRankState.totalMap = {};
}

export function syncScopedStateForUser(currentUserId) {
  if (!currentUserId) return;
  let didResetUserScopedState = false;

  if (studentResultsState.userId !== currentUserId) {
    didResetUserScopedState = true;
    studentResultsState.userId = currentUserId;
    studentResultsState.loaded = false;
    studentResultsState.loading = false;
    studentResultsState.list = [];
    studentResultsState.error = "";
  }

  if (studentAttendanceState.userId !== currentUserId) {
    didResetUserScopedState = true;
    studentAttendanceState.userId = currentUserId;
    studentAttendanceState.loaded = false;
    studentAttendanceState.loading = false;
    studentAttendanceState.list = [];
    studentAttendanceState.error = "";
  }

  if (rankingState.userId !== currentUserId) {
    didResetUserScopedState = true;
    rankingState.userId = currentUserId;
    rankingState.loaded = false;
    rankingState.loading = false;
    rankingState.list = [];
    rankingState.error = "";
  }

  if (sessionAttemptOverrideState.userId !== currentUserId) {
    didResetUserScopedState = true;
    sessionAttemptOverrideState.userId = currentUserId;
    sessionAttemptOverrideState.loaded = false;
    sessionAttemptOverrideState.loading = false;
    sessionAttemptOverrideState.map = {};
    sessionAttemptOverrideState.error = "";
    sessionAttemptOverrideState.lastFetchedAt = 0;
  }

  if (didResetUserScopedState) {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.subTab = "score";
    resultDetailState.sectionFilter = "";
    resultDetailState.wrongOnly = false;
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    resultDetailState.attempt = null;
  }
}
