import "./style.css";
import { inject } from "@vercel/analytics";
import { questions } from "../../../packages/shared/questions.js";
import { supabase, publicSupabase } from "./supabaseClient";
import {
  STORAGE_KEY, SUPABASE_URL, TOTAL_TIME_SEC, SESSION_ATTEMPT_OVERRIDE_REFRESH_MS,
  TEST_VERSION, PASS_RATE_DEFAULT, PROFILE_SELECT_FIELDS, QUESTION_SELECT_BASE,
} from "./lib/constants";
import { escapeHtml } from "./lib/escapeHtml";
import {
  formatDateTime, formatTimeBdt, getBdtDateKey, formatDateShort, formatDateFull,
  formatWeekday, getContrastText, formatOrdinal, formatTime, formatYearsOfExperience,
} from "./lib/formatters";
import {
  isMissingTabLeftCountError, isMissingRetakeSessionFieldsError,
  isMissingSessionAttemptOverrideTableError, isMissingStudentWarningsTableError,
  getSupabaseErrorInfo, getErrorMessage, logSupabaseError, logUnexpectedError,
} from "./lib/errorHelpers";
import {
  hashString, shuffleWithSeed, normalizeStemKindValue, splitStemLines,
  splitStemLinesPreserveIndent, splitTextBoxStemLines, parseSpeakerStemLine,
  getAssetProbeTarget, isImageChoiceValue, isAudioAssetValue, splitAssetList,
  getStemMediaAssets, getEffectiveAnswerIndices, isChoiceCorrect,
} from "./lib/questionHelpers";
import {
  normalizeAttendanceStatusToken, getAttendanceStatusClassSuffix, buildAttendanceSummary,
} from "./lib/attendanceHelpers";
import {
  PROFILE_UPLOAD_BUCKET, PERSONAL_UPLOAD_FIELDS, CERTIFICATE_STATUS_OPTIONS, SEX_OPTIONS,
  calculateAge, getPersonalInfoPayload, formatPersonalInfoValue, getProfileUploads,
  getFileExtension, uploadProfileDocument, isImageUpload, renderPersonalInfoUpload,
} from "./lib/profileHelpers";
import { getSectionLabelLines, buildRadarSvg } from "./lib/radarChart";
import { setRenderCallback, triggerRender } from "./lib/renderBus";
import {
  getAttemptDedupKey, dedupeAttempts, getAttemptTimestamp,
  buildLatestAttemptMapByStudent, getScoreRateFromAttempt, getAttemptTest,
  getAttemptTestType, getAttemptCategory, getAttemptDateLabel, getAttemptTitle,
  getAttemptSession, shouldShowAnswers, buildAttemptDetailRows,
  buildAttemptScoreSummaryFromQuestions, buildResultRows, buildSectionSummary,
  buildMainSectionSummary, buildNestedSectionSummary, buildResultAttemptEntries,
  getVisibleAttemptScoreSummary, getAvailableSections, renderDetailTable,
} from "./lib/attemptHelpers";
import {
  getActiveTestVersion, getActiveTestSession, getActiveTestTitle,
  getActiveTestType, getSessionTestType, isRetakeSessionTitle,
  getRetakeBaseTitle, isRetakeSession, getSourceSessionForRetake,
  getBestAttemptForSession, canAccessSession, allowMultipleAttempts,
  getAttemptCountForSession, getExtraAttemptsForSession, hasAttemptForSession,
  isSessionAttemptAvailabilityReady, hasRemainingAttemptsForSession,
  getActivePassRate, getPassRateForVersion,
} from "./lib/sessionHelpers";
import {
  getCurrentSection, getSectionQuestions, getActiveSections, getCurrentQuestion,
  getQuestionProgress, getSectionTitle, getQuestionSectionLabel, getQuestionPrompt,
} from "./lib/sectionHelpers";
import {
  startTestTimer, getActiveTimeLimitSec, getTotalTimeLeftSec, countAnsweredAll,
  scoreAll, toggleBangla, setSingleAnswer, setPartAnswer, jumpToQuestionInSection,
  goPrevQuestion, goNextQuestionOrEnd, finishSection, goNextSectionOrResult,
} from "./lib/quizControls";
import {
  renderStemMarkup, renderUnderlines, renderSpeakerStemLines, banglaButtonHTML,
  promptBoxHTML, getChoices, isJapaneseText, renderChoicesText, renderChoicesImages,
  renderStemHTML, questionBodyHTML, renderQuestionBlock, renderQuestionGroupHTML,
  sidebarHTML,
} from "./lib/questionRenderers";
import { topbarHTML, renderAndSync, registerStudentMenu, focusWarningHTML, downloadText } from "./lib/uiHelpers";
import { normalizeStudentWarningCriteria, getCurrentStudentWarningIssues } from "./lib/warningHelpers";
import { hasLinkParam, checkLinkFromUrl } from "./lib/linkHelpers";
import { registerFocusWarning } from "./lib/focusWarning";
import {
  state, appBootstrapState, saveState,
  shouldBlockOnQuestions, resetAll, exitToHome, goIntro, setLinkStateRefreshCallback,
} from "./state/appState";
import {
  testsState, testSessionsState, fetchPublicTests, fetchTestSessions,
} from "./state/testsState";
import {
  questionsState, legacyQuestionMap, getAssetBaseUrl, resolveAssetUrl,
  normalizeQuestionAssets, mapDbQuestion, fetchQuestionRowsWithFallback,
  fetchQuestionsForVersion, ensureSessionQuestionsAvailable, ensureQuestionsLoaded,
  getQuestions, getChoiceDisplayOrder, getDisplayedChoices,
} from "./state/questionsState";
import {
  studentResultsState, resultDetailState, modelRankState,
  fetchStudentResults, fetchModelRanks,
  fetchQuestionsForDetail, fetchQuestionsForDetailWithOptions, refreshQuestionsForResultAttempts,
} from "./state/resultsState";
import {
  sessionAttemptOverrideState, fetchSessionAttemptOverrides,
} from "./state/sessionOverrideState";
import {
  studentAttendanceState, absenceApplicationsState,
  fetchStudentAttendance, fetchAbsenceApplications,
} from "./state/attendanceState";
import { rankingState, fetchStudentRanking } from "./state/rankingState";
import { studentSchoolState, fetchStudentSchool } from "./state/schoolState";
import { announcementsState, fetchAnnouncements } from "./state/announcementsState";
import { issuedWarningsState, fetchIssuedStudentWarnings } from "./state/warningsState";
import {
  authState, refreshAuthState, registerAuthStateListener,
} from "./state/authState";
import { buildHomeTabHTML, bindHomeTabEvents } from "./tabs/homeTab";
import { buildPersonalInfoTabHTML, bindPersonalInfoTabEvents } from "./tabs/personalInfoTab";
import { buildDailyResultsTabHTML, bindDailyResultsTabEvents } from "./tabs/dailyResultsTab";
import { buildModelResultsTabHTML, bindModelResultsTabEvents } from "./tabs/modelResultsTab";
import { buildRankingTabHTML, bindRankingTabEvents } from "./tabs/rankingTab";
import { buildAttendanceTabHTML, bindAttendanceTabEvents } from "./tabs/attendanceTab";
import { buildAttendanceHistoryTabHTML, bindAttendanceHistoryTabEvents } from "./tabs/attendanceHistoryTab";

let pendingAttemptSave = null;
let pendingAttemptSaveKey = "";
let lastHydratedResultsTab = "";

inject();

function renderLoading(app) {
  app.innerHTML = `
    <div class="app has-topbar app-result">
      ${topbarHTML({ rightButtonLabel: "Loading", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Loading...</h1>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
}

function renderQuestionLoadError(app) {
  const version = getActiveTestVersion();
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Unavailable", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Question set could not be loaded.</h1>
        <p style="margin-top:10px;color:#7a2e00;">${escapeHtml(questionsState.error || `No uploaded questions found for ${version || "this session"}.`)}</p>
        ${version ? `<p style="margin-top:6px;color:var(--muted);">Problem Set ID: ${escapeHtml(version)}</p>` : ""}
        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="backToTestSelectBtn">Back to Test Selection</button>
          <button class="nav-btn ghost" id="resetErrorStateBtn">Reset</button>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;
  document.querySelector("#backToTestSelectBtn")?.addEventListener("click", () => {
    goIntro();
  });
  document.querySelector("#resetErrorStateBtn")?.addEventListener("click", () => {
    resetAll();
  });
}


function renderLogin(app) {
  const isDaily = getActiveTestType() === "daily";
  const showGuest = hasLinkParam() && testsState.loaded && !isDaily;
  const emailPrefill = authState.session?.user?.email ?? "";
  app.innerHTML = `
    <div class="app">
      <main class="student-login-screen">
        <div class="student-login-card">
          <div class="student-login-header">
            <img class="student-login-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
          </div>
          <div class="student-login-divider"></div>
          <form id="studentLoginForm" class="student-login-form">
            <label class="student-login-label" for="email">Email</label>
            <input
              id="email"
              class="student-login-input"
              type="email"
              placeholder="example@gmail.com"
              value="${escapeHtml(emailPrefill)}"
            />

            <label class="student-login-label" for="password">Password</label>
            <div class="student-login-password">
              <input
                id="password"
                class="student-login-input student-login-password-input"
                type="password"
                placeholder="password"
              />
              <button class="student-login-toggle" type="button" id="studentLoginToggle" aria-label="Show password">
                ${eyeOffIcon()}
              </button>
            </div>

            <button class="student-login-submit" id="loginBtn" type="submit">LOGIN</button>
            ${
              showGuest
                ? `
                  <button class="student-login-guest" id="guestBtn" type="button">Take as Guest</button>
                  <p class="student-login-note">You can also take this test as a guest from this link.</p>
                `
                : ""
            }
          </form>

          <p id="msg" class="student-login-msg"></p>
        </div>
      </main>
    </div>
  `;

  const emailEl = app.querySelector("#email");
  const passEl = app.querySelector("#password");
  const msgEl = app.querySelector("#msg");
  const toggleEl = app.querySelector("#studentLoginToggle");

  toggleEl?.addEventListener("click", () => {
    const next = passEl.type === "password" ? "text" : "password";
    passEl.type = next;
    toggleEl.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });

  app.querySelector("#studentLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
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
    state.studentTab = "home";
    state.requireLogin = false;
    state.linkLoginRequired = false;
    state.phase = "intro";
    saveState();
  });

  if (showGuest) {
    app.querySelector("#guestBtn")?.addEventListener("click", () => {
      supabase.auth.signOut();
      state.requireLogin = false;
      state.linkLoginRequired = false;
      goIntro();
    });
  }
}

function eyeIcon() {
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M12 5c5.5 0 9.6 4.1 10.7 6.6.2.4.2.8 0 1.1C21.6 15.9 17.5 20 12 20S2.4 15.9 1.3 12.7c-.2-.4-.2-.8 0-1.1C2.4 9.1 6.5 5 12 5zm0 2.2c-4.1 0-7.4 2.9-8.4 4.9 1 2 4.3 4.9 8.4 4.9s7.4-2.9 8.4-4.9c-1-2-4.3-4.9-8.4-4.9zm0 1.8a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z"/>
    </svg>
  `;
}

function eyeOffIcon() {
  return `
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d="M3 4.3 4.3 3 21 19.7 19.7 21l-2.4-2.4c-1.6.8-3.4 1.4-5.3 1.4-5.5 0-9.6-4.1-10.7-6.6-.2-.4-.2-.8 0-1.1.7-1.7 2.3-3.6 4.6-4.9L3 4.3zm5 5 1.7 1.7a3.9 3.9 0 0 0 4.6 4.6l1.7 1.7c-1 .5-2.1.7-3.4.7a3.9 3.9 0 0 1-3.9-3.9c0-1.3.3-2.4.8-3.4zM12 7.2c1.2 0 2.3.3 3.2.8l-1.7 1.7a3.9 3.9 0 0 0-4.6 4.6L6.2 10c1.5-1.7 3.7-2.8 5.8-2.8zm9.2 4.8c-.5 1.1-1.4 2.4-2.8 3.5l-1.4-1.4c1-.8 1.7-1.7 2.1-2.1-.8-1.6-3.1-4.1-6.1-4.6l-1.8-1.8c4.2.4 7.5 3.2 8.5 4.7.2.4.2.8 0 1.1z"/>
    </svg>
  `;
}

function renderSetPassword(app) {
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <div style="max-width:420px;margin:20px auto;padding:20px;border:1px solid #ddd;border-radius:12px;background:#fff;">
          <h2 style="margin:0 0 6px;">Set New Password</h2>
          <p style="margin-top:0;line-height:1.6;">新しいパスワードを設定します。</p>

          <label>New Password</label>
          <div class="pass-field">
            <input id="newPass" type="password" class="pass-input" />
            <button class="pass-toggle" type="button" id="toggleNewPass" aria-label="Show password">
              ${eyeOffIcon()}
            </button>
          </div>

          <label>Confirm Password</label>
          <div class="pass-field">
            <input id="confirmPass" type="password" class="pass-input" />
            <button class="pass-toggle" type="button" id="toggleConfirmPass" aria-label="Show password">
              ${eyeOffIcon()}
            </button>
          </div>

          <button class="nav-btn" id="updateBtn" style="width:100%;">Update password</button>
          <p id="msg" style="color:#b00;margin-top:12px;min-height:20px;"></p>
        </div>
      </main>
    </div>
  `;
  const passEl = app.querySelector("#newPass");
  const confirmEl = app.querySelector("#confirmPass");
  const msgEl = app.querySelector("#msg");
  const toggleNew = app.querySelector("#toggleNewPass");
  const toggleConfirm = app.querySelector("#toggleConfirmPass");

  toggleNew?.addEventListener("click", () => {
    const next = passEl.type === "password" ? "text" : "password";
    passEl.type = next;
    toggleNew.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });
  toggleConfirm?.addEventListener("click", () => {
    const next = confirmEl.type === "password" ? "text" : "password";
    confirmEl.type = next;
    toggleConfirm.innerHTML = next === "text" ? eyeIcon() : eyeOffIcon();
  });
  app.querySelector("#updateBtn").addEventListener("click", async () => {
    msgEl.textContent = "";
    const password = passEl.value;
    const confirm = confirmEl.value;
    if (!password || password.length < 8) {
      msgEl.textContent = "8文字以上のパスワードを入力してください。";
      return;
    }
    if (password !== confirm) {
      msgEl.textContent = "パスワードが一致しません。";
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      msgEl.textContent = error.message;
      return;
    }
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", authState.session?.user?.id ?? "");
    if (profileError) {
      msgEl.textContent = profileError.message;
      return;
    }
    authState.mustChangePassword = false;
    if (authState.profile) authState.profile.force_password_change = false;
    state.phase = "intro";
    saveState();
    render();
  });
}


async function saveAttemptIfNeeded() {
  const statusEl = document.querySelector("#saveStatus");
  if (state.attemptSaved) {
    if (statusEl) statusEl.textContent = "Saved";
    return pendingAttemptSave;
  }

  const { correct, total } = scoreAll();
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId || null;
  const tabLeftCount = Math.max(
    0,
    Number(state.tabLeftCount ?? state.focusWarnings ?? 0)
  );
  const payload = {
    student_id: authState.session?.user?.id ?? null,
    display_name: state.user?.name?.trim() || null,
    student_code: state.user?.id?.trim() || null,
    test_version: getActiveTestVersion(),
    test_session_id: activeSessionId,
    correct,
    total,
    started_at: state.testStartAt ? new Date(state.testStartAt).toISOString() : null,
    ended_at: state.testEndAt ? new Date(state.testEndAt).toISOString() : new Date().toISOString(),
    answers_json: {
      ...(state.answers ?? {}),
      __meta: {
        tab_left_count: tabLeftCount,
      },
    },
    tab_left_count: tabLeftCount,
    link_id: state.linkId,
  };
  const saveKey = getAttemptDedupKey(payload);

  if (pendingAttemptSave && pendingAttemptSaveKey === saveKey) {
    if (statusEl) statusEl.textContent = "Saving...";
    return pendingAttemptSave;
  }

  if (statusEl) statusEl.textContent = "Saving...";
  pendingAttemptSaveKey = saveKey;
  pendingAttemptSave = (async () => {
    let { error } = await supabase.from("attempts").insert(payload);
    if (error && isMissingTabLeftCountError(error)) {
      const { tab_left_count, ...legacyPayload } = payload;
      ({ error } = await supabase.from("attempts").insert(legacyPayload));
    }
    if (error) {
      console.error("saveAttempt error:", error);
      if (statusEl) statusEl.textContent = `Save failed: ${error.message}`;
      return;
    }

    state.attemptSaved = true;
    studentResultsState.loaded = false;
    saveState();
    const currentStatusEl = document.querySelector("#saveStatus");
    if (currentStatusEl) currentStatusEl.textContent = "Saved";
  })().finally(() => {
    pendingAttemptSave = null;
    pendingAttemptSaveKey = "";
  });

  return pendingAttemptSave;
}

/** ===== UI helpers ===== */
/** ===== Renders ===== */
function renderIntro(app) {
  const activeSections = getActiveSections();
  const activeVersion = getActiveTestVersion();
  const activeTitle = getActiveTestTitle();
  const isGuest = !authState.session;
  const isDaily = getActiveTestType() === "daily";
  const visibleSessions = testSessionsState.list.filter((session) => canAccessSession(session));
  const activeSessionId = state.linkTestSessionId || state.selectedTestSessionId;
  const activeSession = activeSessionId
    ? testSessionsState.list.find((session) => session.id === activeSessionId)
    : null;
  const linkBlocked = Boolean(state.linkId && activeSession && !canAccessSession(activeSession));
  app.innerHTML = `
    <div class="app">
      <main class="content" style="margin:12px;">
        <h1 class="prompt test-title">${escapeHtml(activeTitle)}</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>• Sections: ${
            activeSections.length
              ? activeSections.map((s) => `<b>${s.title}</b>`).join(" → ")
              : "—"
          }</p>
          ${isDaily ? "" : `<p>• Each section has a timer.</p>`}
          <p>• Answers are saved automatically.</p>
          ${
            state.linkId
              ? `<p style="margin-top:6px;"><b>Guest link active</b> (expires: ${state.linkExpiresAt ? new Date(state.linkExpiresAt).toLocaleString() : "—"})</p>`
              : ""
          }
          ${isDaily ? "" : `<p style="margin-top:6px;"><b>Test</b>: ${escapeHtml(activeTitle)}</p>`}
          ${isDaily ? "" : (authState.session ? `<p style="margin-top:6px;"><b>Logged in</b> (${escapeHtml(authState.session.user.email ?? "")})</p>` : "")}
        </div>

        <div class="intro-form" style="margin-top:16px; max-width:520px;">
          ${
            state.linkId
              ? ""
              : `
                <label class="form-label">Test Session</label>
                <select class="form-input" id="testSelect">
                  ${
                    visibleSessions.length
                      ? visibleSessions
                          .map((t) => {
                            const label = `${t.title} (${t.problem_set_id})`;
                            return `<option value="${escapeHtml(t.id)}" ${
                              t.id === activeSessionId ? "selected" : ""
                            }>${escapeHtml(label)}</option>`;
                          })
                          .join("")
                      : `<option value="">No sessions</option>`
                  }
                </select>
                ${
                  testsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testsState.error)}</div>`
                    : ""
                }
                ${
                  questionsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(questionsState.error)}</div>`
                    : ""
                }
                ${
                  testSessionsState.error
                    ? `<div style="margin-top:6px;color:#b00;">${escapeHtml(testSessionsState.error)}</div>`
                    : ""
                }
                ${
                  testSessionsState.loaded && visibleSessions.length === 0
                    ? `<div style="margin-top:6px;color:#666;">公開テストがありません。</div>`
                    : ""
                }
              `
          }
          ${
            linkBlocked
              ? `<div style="margin-top:10px;color:#b00;">This retake session is available only to students who failed the original test.</div>`
              : ""
          }

          ${
            isGuest
              ? `
                ${
                  isDaily
                    ? ""
                    : `
                      <label class="form-label">Name（任意）</label>
                      <input class="form-input" id="nameInput" placeholder="e.g., Taro Yamada" value="${escapeHtml(state.user?.name ?? "")}" />

                      <label class="form-label" style="margin-top:10px;">ID（任意）</label>
                      <input class="form-input" id="idInput" placeholder="e.g., ID001" value="${escapeHtml(state.user?.id ?? "")}" />
                    `
                }
              `
              : `
                ${
                  isDaily
                    ? ""
                    : `
                      <label class="form-label">Name</label>
                      <div class="form-input readonly">${escapeHtml(state.user?.name ?? "")}</div>
                      <label class="form-label" style="margin-top:10px;">ID</label>
                      <div class="form-input readonly">${escapeHtml(state.user?.id ?? "")}</div>
                    `
                }
              `
          }
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextBtn">Next</button>
          ${!authState.session && !state.linkId ? `<button class="nav-btn ghost" id="loginNavBtn">Log in</button>` : ``}
          <button class="nav-btn ghost" id="resetBtn">Reset</button>
        </div>
      </main>
    </div>
  `;

  const disabledBtn = document.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;

  const testSelect = document.querySelector("#testSelect");
  if (testSelect) {
    testSelect.addEventListener("change", () => {
      state.selectedTestSessionId = testSelect.value;
      const session = testSessionsState.list.find((s) => s.id === testSelect.value);
      if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      saveState();
      render();
    });
  }

  document.querySelector("#nextBtn").addEventListener("click", async () => {
    if (isGuest) {
      const name = document.querySelector("#nameInput").value.trim();
      const id = document.querySelector("#idInput").value.trim();
      state.user = { name, id };
    }
    if (linkBlocked) {
      window.alert("You are not eligible to take this retake session.");
      return;
    }
    if (!state.linkId && !canAccessSession(activeSession)) {
      window.alert("You are not eligible to take this retake session.");
      return;
    }
    if (!(await ensureSessionQuestionsAvailable(activeSession))) {
      return;
    }
    state.phase = "sectionIntro";
    state.sectionIndex = 0;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;

    saveState();
    render();
  });

  document.querySelector("#signOutBtn")?.addEventListener("click", () => {
    supabase.auth.signOut();
    state.requireLogin = true;
    state.phase = "login";
    saveState();
    render();
  });
  document.querySelector("#loginNavBtn")?.addEventListener("click", () => {
    state.phase = "login";
    saveState();
    render();
  });
  document.querySelector("#resetBtn").addEventListener("click", resetAll);
}

function renderTestSelect(app) {
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
  const canStart = activeSections.length > 0;

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
  if ((showDailyResults || showModelResults) && studentResultsState.loaded && lastHydratedResultsTab !== activeTab) {
    lastHydratedResultsTab = activeTab;
    refreshQuestionsForResultAttempts(studentResultsState.list, { force: true }).finally(triggerRender);
  }
  if (!showDailyResults && !showModelResults) {
    lastHydratedResultsTab = "";
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
              <button class="student-menu-close" type="button" data-student-menu-close aria-label="Close menu">×</button>
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
            : `<div style="color:#666;">公開テストがありません。</div>`}
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
    document.querySelector("#startBtn")?.addEventListener("click", async () => {
      if (!canStart) return;
      if (isGuest) {
        const name = document.querySelector("#nameInput").value.trim();
        const id = document.querySelector("#idInput").value.trim();
        state.user = { name, id };
      }
      const selected = document.querySelector('input[name="testSelect"]:checked');
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
        window.alert("You are not eligible to take this retake session.");
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

  document.querySelector("#signOutBtn")?.addEventListener("click", () => {
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

function renderLinkInvalid(app) {
  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Not started", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">Link is invalid / expired</h1>
        <div style="line-height:1.7; margin-top:10px;">
          <p>このリンクは無効、または期限切れです。</p>
        </div>
        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="backBtn">Back</button>
        </div>
      </main>
    </div>
  `;
  const disabledBtn = document.querySelector("#disabledBtn");
  if (disabledBtn) disabledBtn.disabled = true;
  document.querySelector("#backBtn").addEventListener("click", goIntro);
}

function renderSectionIntro(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const questionCount = secQs.reduce((sum, g) => sum + (g.items?.length || 0), 0);
  const isDaily = getActiveTestType() === "daily";
  const activeTitle = getActiveTestTitle();
  const sectionTitle = isDaily && activeTitle ? activeTitle : sec.title;

  const isFirstSection = state.sectionIndex === 0;
  const btnLabel = isFirstSection ? "Start Exam (Fullscreen)" : "Next";
  const hintLine = isFirstSection
    ? "When you press Start, the timer begins."
    : "Press Next to continue.";

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({
        rightButtonLabel: "Ready",
        rightButtonId: "disabledBtn",
        hideTimer: true,              // ← Introではタイマー表示しない（あなたの希望）
      })}

      <main class="content" style="margin:12px;">
        ${focusWarningHTML()}
        <h1 class="prompt section-title">${escapeHtml(sectionTitle)}</h1>

        <div style="line-height:1.7; margin-top:10px;">
          <p>• Questions in this section: <b>${questionCount}</b></p>
          <p>• ${hintLine}</p>
        </div>

        <div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
          ${isFirstSection ? `<button class="nav-btn ghost" id="backHomeBtn">Back</button>` : ""}
          <button class="nav-btn" id="goBtn">${btnLabel}</button>
        </div>
      </main>
    </div>
  `;

  document.querySelector("#disabledBtn").disabled = true;

  if (isFirstSection) {
    document.querySelector("#backHomeBtn")?.addEventListener("click", () => {
      state.studentTab = "home";
      exitToHome();
    });
  }

  document.querySelector("#goBtn").addEventListener("click", async () => {
    if (isFirstSection) {
      try {
        await document.documentElement.requestFullscreen?.();
      } catch (e) {
        console.warn("fullscreen failed:", e);
      }
      startTestTimer();   // ←最初だけ開始
    }
    state.phase = "quiz";
    saveState();
    render();
  });
}


function renderQuiz(app) {

  if (getTotalTimeLeftSec() <= 0) {
  state.phase = "result"; // ★時間切れは即結果へ（好みでsectionEndでもOK）
  saveState();
  render();
  return;
}


  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const group = getCurrentQuestion();
  const isDaily = getActiveTestType() === "daily";
  const isLastQuestion = state.questionIndexInSection >= secQs.length - 1;
  const isLastSection = state.sectionIndex >= getActiveSections().length - 1;
  const finishLabel = isDaily ? "Finish Test" : "Finish Section";
  const nextLabel = isDaily
    ? (isLastQuestion ? "Finish Test ▶" : "Next ▶")
    : (isLastQuestion
        ? (isLastSection ? "Finish Test ▶" : "Finish Section ▶")
        : "Next ▶");

  app.innerHTML = `
    <div class="app has-topbar ${isDaily ? "" : "has-bottombar"}">
      ${topbarHTML({ rightButtonLabel: finishLabel, rightButtonId: "finishBtn" })}
      <div class="body">
        ${sidebarHTML()}
        <main class="content">
          ${focusWarningHTML()}
          ${renderQuestionGroupHTML(group)}
          ${
            isDaily
              ? `
                <div class="question-nav">
                  <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                  <button class="nav-btn ${isLastQuestion ? "danger" : ""}" id="nextBtn">${nextLabel}</button>
                </div>
              `
              : ""
          }
        </main>
      </div>
      ${
        isDaily
          ? ""
          : `
            <footer class="bottombar">
              <div class="bottom-left"><button class="icon-btn">⚙️</button><button class="icon-btn">▦</button></div>
              <div class="bottom-right">
                <button class="nav-btn ghost" id="backBtn" ${state.questionIndexInSection === 0 ? "disabled" : ""}>◀ Back</button>
                <button class="nav-btn ${isLastQuestion ? "danger" : ""}" id="nextBtn">${nextLabel}</button>
              </div>
            </footer>
          `
      }
    </div>
  `;

  // Bangla toggle
  document.querySelector("#banglaBtn")?.addEventListener("click", toggleBangla);

  // Sidebar step jump
  document.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToQuestionInSection(Number(btn.dataset.step)));
  });

  // Choice click (single)
  document.querySelectorAll("[data-choice]").forEach((btn) => {
    const part = btn.dataset.part;
    const choice = Number(btn.dataset.choice);
    const qid = btn.dataset.qid || "";
    if (!qid) return;
    if (part == null) {
      btn.addEventListener("click", () => setSingleAnswer(qid, choice));
    } else {
      btn.addEventListener("click", () => setPartAnswer(qid, Number(part), choice));
    }
  });

  // Nav
  document.querySelector("#backBtn")?.addEventListener("click", goPrevQuestion);
  document.querySelector("#nextBtn")?.addEventListener("click", goNextQuestionOrEnd);

  document.querySelector("#finishBtn")?.addEventListener("click", finishSection);
}

function renderSectionEnd(app) {
  const sec = getCurrentSection();
  const secQs = getSectionQuestions(sec.key);
  const activeSections = getActiveSections();

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Section ended", rightButtonId: "disabledBtn" })}
      <main class="content" style="margin:12px;">
        <h1 class="prompt">${sec.title} — Completed</h1>
        <p style="color:var(--muted);">Next: ${state.sectionIndex === activeSections.length - 1 ? "Results" : activeSections[state.sectionIndex + 1].title}</p>

        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
          <button class="nav-btn" id="nextSectionBtn">${state.sectionIndex === activeSections.length - 1 ? "Go to Results" : "Next Section"}</button>
          <button class="nav-btn ghost" id="reviewBtn">Review this section</button>
        </div>
      </main>
    </div>
  `;
  document.querySelector("#disabledBtn").disabled = true;

  document.querySelector("#nextSectionBtn").addEventListener("click", () => {
    const activeSectionsInner = getActiveSections();
    const nextSectionIndex = state.sectionIndex + 1;

    if (nextSectionIndex >= activeSectionsInner.length) {
      state.phase = "result";
      saveState();
      render();
      return;
    }

    state.sectionIndex = nextSectionIndex;
    state.questionIndexInSection = 0;
    state.sectionStartAt = null;
    state.showBangla = false;
    state.phase = "sectionIntro";

    saveState();
    render();
  });

  document.querySelector("#reviewBtn").addEventListener("click", () => {
    state.phase = "quiz";
    saveState();
    render();
  });
}

function renderResult(app) {
  const { correct, total } = scoreAll();
  const rows = buildResultRows(); // ★ results rows (chosenImg/correctImg を含む想定)
  const scoreRate = total === 0 ? 0 : correct / total;
  const passRate = getActivePassRate();
  const isPass = scoreRate >= passRate;
  const showExit = Boolean(authState.session);

  // ★ Resultに入った瞬間にタイマーを止めたい場合（testEndAt方式を入れてるなら）
  // state.testEndAt = state.testEndAt ?? Date.now();
  // saveState();

  app.innerHTML = `
    <div class="app has-topbar">
      ${topbarHTML({ rightButtonLabel: "Finished", rightButtonId: "disabledBtn", hideTimer: true })}
      <main class="result">
        <div class="result-summary">
          <h1>Result</h1>

          <div class="score-big">
            <span class="score-correct">${correct}</span>
            <span class="score-slash">/</span>
            <span class="score-total">${total}</span>
          </div>
          <div class="result-status" style="color:${isPass ? "#1a7f37" : "#b00"};">
            ${isPass ? "Pass" : "Fail"}
            <span class="result-status-rate"> (${(scoreRate * 100).toFixed(1)}%)</span>
          </div>
          <div class="result-threshold">Pass threshold: ${(passRate * 100).toFixed(0)}%</div>
          <div class="save-status" id="saveStatus"></div>

          <div class="finish-actions">
            ${showExit ? `<button class="btn btn-primary" id="exitTestBtn">Exit Test</button>` : ``}
          </div>
        </div>

        <div class="result-table-wrap">
          <table class="result-table">
            <thead>
              <tr>
                <th class="col-id">ID</th>
                <th class="col-question">Question</th>
                <th class="col-result">Result</th>
                <th class="col-choice">Chosen Answer</th>
                <th class="col-choice">Correct Answer</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr>
                  <td class="cell-id">${escapeHtml(r.id)}</td>

                  <td class="cell-prompt">
                    ${
                      r.stemAudios?.length || r.stemImages?.length
                        ? `
                          <div class="result-stem-media">
                            ${(r.stemAudios ?? [])
                              .map((src) => `<audio class="result-stem-audio" controls preload="none" src="${src}"></audio>`)
                              .join("")}
                            ${(r.stemImages ?? [])
                              .map((src) => `<img class="result-thumb" src="${src}" alt="q" />`)
                              .join("")}
                          </div>
                        `
                        : ""
                    }
                    <div class="prompt-text">${escapeHtml(r.prompt ?? "")}</div>
                  </td>

                  <td class="cell-judge">
                    <span class="badge ${r.isCorrect ? "ok" : "ng"}">
                      ${r.isCorrect ? "○" : "×"}
                    </span>
                  </td>

                  <td class="cell-choice">
                    ${
                      r.chosenImg
                        ? `<img class="result-choice-big" src="${r.chosenImg}" alt="chosen" />`
                        : `<div class="choice-text">${r.chosen ? escapeHtml(r.chosen) : "—"}</div>`

                    }
                  </td>

                  <td class="cell-choice">
                    ${
                      r.correctImg
                        ? `<img class="result-choice-big" src="${r.correctImg}" alt="correct" />`
                        : `<div class="choice-text">${escapeHtml(r.correct ?? "")}</div>`
                    }
                  </td>

                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;

  // topbar right button disable
  document.querySelector("#disabledBtn").disabled = true;

  // actions
  document.querySelector("#exitTestBtn")?.addEventListener("click", exitToHome);

  saveAttemptIfNeeded();
}


function render() {
  const app = document.querySelector("#app");
  if (appBootstrapState.loading && (!state.linkChecked || !authState.checked)) {
    renderAndSync(renderLoading, app);
    return;
  }
  if (state.linkInvalid) {
    renderAndSync(renderLinkInvalid, app);
    return;
  }
  if (authState.session && authState.mustChangePassword) {
    renderAndSync(renderSetPassword, app);
    return;
  }
  if (state.requireLogin || state.linkLoginRequired) {
    if (state.phase !== "login") {
      state.phase = "login";
      saveState();
    }
    renderAndSync(renderLogin, app);
    return;
  }
  if (!authState.session && !state.linkId) {
    renderAndSync(renderLogin, app);
    return;
  }

  const needsQuestions = shouldBlockOnQuestions();
  const activeVersion = getActiveTestVersion();
  const sessionsReady = testSessionsState.loaded || Boolean(state.linkId);
  const needsDynamicQuestions = Boolean(activeVersion);
  if (needsQuestions && sessionsReady && (testsState.loaded || needsDynamicQuestions)) {
    ensureQuestionsLoaded();
    if (!questionsState.loaded || questionsState.version !== activeVersion) {
      return renderLoading(app);
    }
    if (!getQuestions().length) {
      return renderQuestionLoadError(app);
    }
  }

  if (authState.session && !state.linkId && state.phase === "intro") {
    renderAndSync(renderTestSelect, app);
    return;
  }
  if (state.phase === "login") {
    renderAndSync(renderLogin, app);
    return;
  }
  if (state.phase === "intro") {
    renderAndSync(renderIntro, app);
    return;
  }
  if (state.phase === "sectionIntro") {
    renderAndSync(renderSectionIntro, app); // ←追加
    return;
  }
  if (state.phase === "quiz") {
    renderAndSync(renderQuiz, app);
    return;
  }
  if (state.phase === "result") {
    renderAndSync(renderResult, app);
  }
}

setRenderCallback(render);
setLinkStateRefreshCallback(checkLinkFromUrl);


setInterval(() => {
  // quiz中じゃなくても、topbarを表示する画面なら更新したいならここを調整OK
  const left = getTotalTimeLeftSec();
  const timerEl = document.querySelector(".timer");
  if (timerEl) timerEl.textContent = formatTime(left);

  if (state.phase !== "quiz") return;

  if (left <= 0) {
  state.testEndAt = state.testEndAt ?? Date.now();
  state.phase = "result";
  saveState();
  render();
  }
}, 1000);


registerAuthStateListener();

Promise.allSettled([checkLinkFromUrl(), refreshAuthState(), fetchPublicTests(), fetchTestSessions()])
  .finally(() => {
    appBootstrapState.loading = false;
    render();
  });

registerFocusWarning();
registerStudentMenu();
