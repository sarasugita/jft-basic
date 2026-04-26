import { escapeHtml } from "../lib/escapeHtml";
import { PASS_RATE_DEFAULT } from "../lib/constants";
import { getActiveSections } from "../lib/sectionHelpers";
import { canAccessSession, isSessionAttemptAvailabilityReady, hasRemainingAttemptsForSession } from "../lib/sessionHelpers";
import { getAttemptTestType } from "../lib/attemptHelpers";
import { state, saveState } from "../state/appState";
import { authState } from "../state/authState";
import { testsState, testSessionsState } from "../state/testsState";
import { questionsState, ensureSessionQuestionsAvailable } from "../state/questionsState";
import { fetchSessionAttemptOverrides } from "../state/sessionOverrideState";
import {
  studentResultsState, resultDetailState, modelRankState,
  fetchStudentResults, fetchModelRanks,
} from "../state/resultsState";
import { studentAttendanceState, absenceApplicationsState, fetchStudentAttendance, fetchAbsenceApplications } from "../state/attendanceState";
import { rankingState, fetchStudentRanking } from "../state/rankingState";
import { studentSchoolState, fetchStudentSchool } from "../state/schoolState";
import { announcementsState, fetchAnnouncements } from "../state/announcementsState";
import { issuedWarningsState, fetchIssuedStudentWarnings } from "../state/warningsState";
import { supabase } from "../supabaseClient";
import { triggerRender } from "../lib/renderBus";
import { buildHomeTabHTML, bindHomeTabEvents } from "../tabs/homeTab";
import { buildPersonalInfoTabHTML, bindPersonalInfoTabEvents } from "../tabs/personalInfoTab";
import { buildDailyResultsTabHTML, bindDailyResultsTabEvents } from "../tabs/dailyResultsTab";
import { buildModelResultsTabHTML, bindModelResultsTabEvents } from "../tabs/modelResultsTab";
import { buildRankingTabHTML, bindRankingTabEvents } from "../tabs/rankingTab";
import { buildAttendanceTabHTML, bindAttendanceTabEvents } from "../tabs/attendanceTab";
import { buildAttendanceHistoryTabHTML, bindAttendanceHistoryTabEvents } from "../tabs/attendanceHistoryTab";

const closeIconSvg = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
`;

export function renderTestSelect(app) {
  const activeSections = getActiveSections();
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId;
  const isGuest = !authState.session;
  const showTabs = Boolean(authState.session);
  const activeTab = showTabs ? state.studentTab : "take";
  const showHome = showTabs && activeTab === "home";
  const showPersonalInformation = showTabs && activeTab === "personalInformation";
  const showDailyResults = showTabs && activeTab === "dailyResults";
  const showModelResults = showTabs && activeTab === "modelResults";
  const showRanking = showTabs && activeTab === "ranking";
  const showAttendance = showTabs && activeTab === "attendance";
  const showAttendanceHistory = showTabs && activeTab === "attendanceHistory";
  const showTakeTest = !showTabs;
  const visibleSessions = (testSessionsState.list ?? []).filter((session) => canAccessSession(session));
  const canStart = activeSections.length > 0 && visibleSessions.length > 0;

  // --- Data prefetch triggers ---
  if (showAttendance && authState.session && !studentAttendanceState.loaded && !studentAttendanceState.loading) {
    fetchStudentAttendance().finally(triggerRender);
  }
  if ((showAttendance || showAttendanceHistory) && !absenceApplicationsState.loaded && !absenceApplicationsState.loading) {
    fetchAbsenceApplications().finally(triggerRender);
  }
  if (showHome && authState.session && !studentAttendanceState.loaded && !studentAttendanceState.loading) {
    fetchStudentAttendance().finally(triggerRender);
  }
  if (authState.session && !studentResultsState.loaded && !studentResultsState.loading) {
    fetchStudentResults().finally(triggerRender);
  }
  if (showHome && !announcementsState.loaded && !announcementsState.loading) {
    fetchAnnouncements().finally(triggerRender);
  }
  if (showHome && authState.session && authState.profile?.school_id && !issuedWarningsState.loaded && !issuedWarningsState.loading) {
    fetchIssuedStudentWarnings().finally(triggerRender);
  }
  if ((showDailyResults || showModelResults) && authState.session && !studentResultsState.loaded && !studentResultsState.loading) {
    fetchStudentResults().finally(triggerRender);
  }
  if (showTabs && authState.profile?.school_id && !studentSchoolState.loading && (!studentSchoolState.loaded || studentSchoolState.schoolId !== authState.profile.school_id)) {
    fetchStudentSchool().finally(triggerRender);
  }
  if (showRanking && authState.session && authState.profile?.school_id && !rankingState.loaded && !rankingState.loading) {
    fetchStudentRanking().finally(triggerRender);
  }
  if (showModelResults && studentResultsState.loaded && !modelRankState.loaded && !modelRankState.loading) {
    const modelAttempts = (studentResultsState.list ?? []).filter((a) => getAttemptTestType(a) === "mock");
    fetchModelRanks(modelAttempts).finally(triggerRender);
  }

  // --- Shared vars ---
  const welcomeName = (state.user?.name || authState.profile?.display_name || authState.session?.user?.email || "Student").trim();
  const menuEmail = String(authState.profile?.email || authState.session?.user?.email || "").trim();
  const menuSchoolName = String(studentSchoolState.name || "").trim();
  const authWarningHtml = authState.profileError
    ? `<section class="home-card"><div class="text-error">${escapeHtml(authState.profileError)}</div></section>`
    : "";

  const studentInfoHtml = showTabs
    ? `
        <header class="student-topbar">
          <div class="student-topbar-brand" id="studentLogoHome">
            <div class="student-topbar-title">
              <img class="student-topbar-logo" src="/branding/jft-navi-white.png" alt="JFT Navi" />
            </div>
          </div>
          <div class="student-topbar-spacer"></div>
          <span class="student-topbar-name">${escapeHtml(welcomeName)}</span>
          <button class="menu-btn student-menu-btn" id="studentMenuBtn" aria-expanded="false" aria-controls="studentMenu" aria-label="Open menu">☰</button>
        </header>
        <div class="student-menu-overlay" id="studentMenuOverlay" hidden>
          <nav class="student-menu-panel" id="studentMenu" aria-label="Student menu">
            <div class="student-menu-header">
              <button class="student-menu-close" type="button" data-student-menu-close aria-label="Close menu">${closeIconSvg}</button>
            </div>
            <button class="student-menu-item" data-student-tab="home">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5M6 10.5V20h12v-9.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Home
            </button>
            <button class="student-menu-item" data-student-tab="personalInformation">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-7 8a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Personal Information
            </button>
            <button class="student-menu-item" data-student-tab="dailyResults">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M7 4v3M17 4v3M4 9h16M5 12h6M5 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Daily Test Results
            </button>
            <button class="student-menu-item" data-student-tab="modelResults">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Model Test Results
            </button>
            <button class="student-menu-item" data-student-tab="ranking">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M5 19h14M7 17V9M12 17V5M17 17v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Ranking
            </button>
            <button class="student-menu-item" data-student-tab="attendance">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M4 6h16v12H4zM8 10h8M8 14h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              Attendance
            </button>
            <div class="student-menu-spacer"></div>
            <div class="student-menu-account">
              ${menuEmail ? `<div class="student-menu-account-line">${escapeHtml(menuEmail)}</div>` : ""}
              ${menuSchoolName ? `<div class="student-menu-account-line student-menu-account-school">${escapeHtml(menuSchoolName)}</div>` : ""}
            </div>
            <button class="student-menu-item student-menu-logout" id="signOutBtn">
              <span class="student-menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M9 6h6M9 18h6M14 6v12M5 12h10M5 12l3-3M5 12l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </span>
              Sign out
            </button>
          </nav>
        </div>
      `
    : "";

  // --- Build tab content ---
  let tabContent = "";
  if (showHome) {
    tabContent = buildHomeTabHTML();
  } else if (showPersonalInformation) {
    tabContent = buildPersonalInfoTabHTML();
  } else if (showDailyResults) {
    tabContent = buildDailyResultsTabHTML();
  } else if (showModelResults) {
    tabContent = buildModelResultsTabHTML();
  } else if (showRanking) {
    tabContent = buildRankingTabHTML();
  } else if (showAttendance) {
    tabContent = buildAttendanceTabHTML();
  } else if (showAttendanceHistory) {
    tabContent = buildAttendanceHistoryTabHTML();
  } else if (showTakeTest) {
    tabContent = `
      <h1 class="prompt section-title">Select Test</h1>
      <div style="line-height:1.7; margin-top:10px;">
        <p>• Choose a mock test and start.</p>
        <p>• Answers are saved automatically.</p>
      </div>
      <div class="intro-form" style="margin-top:16px; max-width:640px;">
        ${activeSections.length === 0 ? `<div style="color:#b00;margin-bottom:10px;">No questions available.</div>` : ""}
        <label class="form-label">Test Session</label>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:6px;">
          ${visibleSessions.length
            ? visibleSessions.map((t) => {
                const problemSet = testsState.list.find((ps) => ps.version === t.problem_set_id);
                const passRate = Number(problemSet?.pass_rate ?? PASS_RATE_DEFAULT);
                const attemptAvailabilityReady = isSessionAttemptAvailabilityReady();
                const alreadyTaken = attemptAvailabilityReady && !hasRemainingAttemptsForSession(t);
                return `
                  <label style="display:flex; align-items:center; gap:10px; padding:8px 10px; border:1px solid #ddd; border-radius:10px; background:#fff;">
                    <input type="radio" name="testSelect" value="${escapeHtml(t.id)}" ${t.id === activeSessionId ? "checked" : ""} ${attemptAvailabilityReady && alreadyTaken ? "disabled" : ""} ${attemptAvailabilityReady ? "" : "disabled"} />
                    <div>
                      <div style="font-weight:600;">${escapeHtml(t.title)}</div>
                      <div style="font-size:12px;color:#666;">${escapeHtml(t.problem_set_id)} • pass ${(passRate * 100).toFixed(0)}%</div>
                      ${!attemptAvailabilityReady
                        ? `<div style="font-size:12px;color:#666;margin-top:4px;">Checking attempts...</div>`
                        : alreadyTaken
                          ? `<div style="font-size:12px;color:#b00;margin-top:4px;">Already taken</div>`
                          : ""}
                    </div>
                  </label>
                `;
              }).join("")
            : `<div style="color:#666;">No test sessions are available.</div>`}
        </div>
        ${testsState.error ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testsState.error)}</div>` : ""}
        ${questionsState.error ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(questionsState.error)}</div>` : ""}
        ${testSessionsState.error ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testSessionsState.error)}</div>` : ""}
        ${isGuest ? `
          <label class="form-label" style="margin-top:14px;">Name（任意）</label>
          <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />
          <label class="form-label" style="margin-top:10px;">ID（任意）</label>
          <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
        ` : ""}
      </div>
      <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="nav-btn" id="startBtn" ${canStart ? "" : "disabled"}>Start</button>
      </div>
    `;
  }

  const plainContent = showHome || showPersonalInformation || showRanking || showAttendance || showAttendanceHistory;

  app.innerHTML = `
    <div class="app ${showTabs ? "has-student-topbar" : ""}">
      ${studentInfoHtml}
      <main class="content ${plainContent ? "home-content" : ""}" style="margin:12px;">
        ${showTakeTest
          ? tabContent
          : showHome
            ? `<div class="home-stack" style="max-width:900px;">${authWarningHtml}${tabContent}</div>`
            : `<div class="intro-form" style="margin-top:16px; max-width:900px;">${authWarningHtml}${tabContent}</div>`
        }
      </main>
    </div>
  `;

  // --- Bind tab-specific events ---
  if (showHome) {
    bindHomeTabEvents(app);
  } else if (showPersonalInformation) {
    bindPersonalInfoTabEvents(app);
  } else if (showDailyResults) {
    bindDailyResultsTabEvents(app);
  } else if (showModelResults) {
    bindModelResultsTabEvents(app);
  } else if (showRanking) {
    bindRankingTabEvents(app);
  } else if (showAttendance) {
    bindAttendanceTabEvents(app);
  } else if (showAttendanceHistory) {
    bindAttendanceHistoryTabEvents(app);
  } else if (showTakeTest) {
    app.querySelector("#startBtn")?.addEventListener("click", async () => {
      if (!canStart) return;
      if (isGuest) {
        const name = app.querySelector("#nameInput")?.value.trim() ?? "";
        const id = app.querySelector("#idInput")?.value.trim() ?? "";
        state.user = { name, id };
      }
      const selected = app.querySelector('input[name="testSelect"]:checked');
      let session = null;
      if (selected) {
        state.selectedTestSessionId = selected.value;
        session = testSessionsState.list.find((s) => s.id === selected.value);
        if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      }
      if (authState.session) {
        await fetchSessionAttemptOverrides({ force: true });
      }
      if (!canAccessSession(session)) {
        window.alert("You are not eligible to take this session.");
        return;
      }
      if (!hasRemainingAttemptsForSession(session)) {
        window.alert("You have already taken this test.");
        return;
      }
      if (!(await ensureSessionQuestionsAvailable(session))) {
        return;
      }
      state.phase = "sectionIntro";
      state.sectionIndex = 0;
      state.questionIndexInSection = 0;
      state.sectionStartAt = null;
      state.showBangla = false;
      saveState();
      triggerRender();
    });
  }

  // --- Shared event handlers ---
  app.querySelector("#studentLogoHome")?.addEventListener("click", () => {
    state.studentTab = "home";
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.subTab = "score";
    resultDetailState.sectionFilter = "";
    resultDetailState.wrongOnly = false;
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    resultDetailState.attempt = null;
    saveState();
    triggerRender();
  });

  app.querySelector("#signOutBtn")?.addEventListener("click", () => {
    resultDetailState.open = false;
    resultDetailState.mode = "";
    resultDetailState.subTab = "score";
    resultDetailState.sectionFilter = "";
    resultDetailState.wrongOnly = false;
    resultDetailState.popupOpen = false;
    resultDetailState.popupTitle = "";
    resultDetailState.popupRows = [];
    resultDetailState.attempt = null;
    supabase.auth.signOut();
    state.requireLogin = true;
    state.phase = "login";
    saveState();
    triggerRender();
  });
}
