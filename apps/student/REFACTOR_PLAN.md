# Student App Refactor Plan

## Background

The student app (`src/main.js`) is a 6,182-line monolithic vanilla JS file with 195 top-level functions, 14+ global state objects, and no module boundaries. The largest single function `renderTestSelect` spans ~1,900 lines (lines 3461–5365) and renders the entire student panel.

The admin app was previously refactored into a modular Next.js + React workspace structure. This plan applies the same domain split to the student app — without changing the stack (stays Vite + vanilla JS).

---

## Target Directory Structure

```
apps/student/src/
  main.js                    ← bootstrap + router (~80 lines)
  supabaseClient.js          ← unchanged
  requestTimeout.js          ← unchanged
  style.css                  ← unchanged

  state/
    appState.js              ← defaultState, loadState, saveState, resetAll, exitToHome, goIntro
    authState.js             ← authState, refreshAuthState, registerAuthStateListener
    testsState.js            ← testsState, testSessionsState, fetchPublicTests, fetchTestSessions
    resultsState.js          ← studentResultsState, resultDetailState, modelRankState, fetchers
    attendanceState.js       ← studentAttendanceState, absenceApplicationsState, fetchers
    rankingState.js          ← rankingState, fetchStudentRanking
    schoolState.js           ← studentSchoolState, fetchStudentSchool
    announcementsState.js    ← announcementsState, fetchAnnouncements
    warningsState.js         ← issuedWarningsState, fetchIssuedStudentWarnings
    questionsState.js        ← questionsState, fetchQuestionsForVersion, ensureQuestionsLoaded
    sessionOverrideState.js  ← sessionAttemptOverrideState, fetchSessionAttemptOverrides
    index.js                 ← resetSessionScopedState coordinator

  tabs/
    homeTab.js               ← buildHtml() + wireEvents(app)
    personalInfoTab.js       ← buildHtml() + wireEvents(app)
    dailyResultsTab.js       ← buildHtml() + wireEvents(app)
    modelResultsTab.js       ← buildHtml() + wireEvents(app)  [largest, ~1000 lines]
    rankingTab.js            ← buildHtml() + wireEvents(app)
    attendanceTab.js         ← buildHtml() + wireEvents(app)
    attendanceHistoryTab.js  ← buildHtml() + wireEvents(app)

  pages/
    loginPage.js             ← renderLogin, eyeIcon, eyeOffIcon
    setPasswordPage.js       ← renderSetPassword
    introPage.js             ← renderIntro
    testSelectPage.js        ← thin orchestrator (~100 lines)
    quizPage.js              ← renderQuiz, renderSectionIntro, renderSectionEnd
    resultPage.js            ← renderResult
    linkInvalidPage.js       ← renderLinkInvalid
    index.js                 ← re-exports all pages

  lib/
    renderBus.js             ← setRenderCallback / triggerRender
    constants.js             ← TOTAL_TIME_SEC, TEST_VERSION, PASS_RATE_DEFAULT, etc.
    escapeHtml.js            ← escapeHtml
    formatters.js            ← formatDateTime, formatTimeBdt, formatDateShort, formatDateFull, etc.
    questionHelpers.js       ← hashString, shuffleWithSeed, mapDbQuestion, asset resolvers, etc.
    questionRenderers.js     ← renderStemHTML, renderChoicesText, questionBodyHTML, etc.
    attemptHelpers.js        ← buildResultRows, dedupeAttempts, getScoreRateFromAttempt, etc.
    sectionHelpers.js        ← getCurrentSection, getCurrentQuestion, getQuestionProgress, etc.
    sessionHelpers.js        ← getActiveTestVersion, canAccessSession, hasRemainingAttempts, etc.
    profileHelpers.js        ← calculateAge, getPersonalInfoPayload, uploadProfileDocument, etc.
    attendanceHelpers.js     ← normalizeAttendanceStatusToken, buildAttendanceSummary, etc.
    warningHelpers.js        ← normalizeStudentWarningCriteria, getCurrentStudentWarningIssues
    quizControls.js          ← startTestTimer, setSingleAnswer, goNextQuestion, scoreAll, etc.
    uiHelpers.js             ← topbarHTML, registerStudentMenu, syncTopbarHeight, etc.
    linkHelpers.js           ← hasLinkParam, checkLinkFromUrl
    radarChart.js            ← buildRadarSvg, getSectionLabelLines
    focusWarning.js          ← registerFocusWarning
    errorHelpers.js          ← getSupabaseErrorInfo, logSupabaseError, feature-flag checks
```

---

## The Core Architectural Problem: Shared Mutable State

All 14 state objects live in the same module scope — every function mutates them directly. After splitting, state modules export objects by reference (JS passes objects by reference, so mutations are visible to all importers).

### The Render Bus Pattern

`render()` lives in `main.js` but is called from everywhere (fetch callbacks, timers, event handlers). Importing `render` from `main.js` into state modules creates circular imports. Solution:

```js
// lib/renderBus.js
let renderFn = null;
export const setRenderCallback = (fn) => { renderFn = fn; };
export const triggerRender = () => renderFn?.();
```

`main.js` calls `setRenderCallback(render)` once at startup. All other modules call `triggerRender()`.

---

## Dependency Map

```
main.js
  └── state/authState, state/testsState, state/questionsState
      lib/renderBus, lib/linkHelpers, lib/focusWarning, lib/uiHelpers
      pages/index

pages/*
  └── state/* (reads), lib/escapeHtml, lib/formatters, lib/questionRenderers
      lib/uiHelpers, tabs/* (testSelectPage only)

tabs/*
  └── state/* (reads + writes), lib/escapeHtml, lib/formatters
      lib/attemptHelpers, lib/attendanceHelpers, lib/profileHelpers
      lib/sessionHelpers, lib/sectionHelpers, lib/radarChart

state/*
  └── supabaseClient, lib/errorHelpers, lib/questionHelpers
      lib/attemptHelpers (dedupeAttempts), lib/renderBus

lib/*
  └── supabaseClient (fetchHelpers only)
      lib/escapeHtml (questionRenderers, formatters)
      lib/questionHelpers (questionRenderers)
      shared/questions.js (sectionHelpers, questionHelpers)
```

---

## Key Risks

| Risk | Mitigation |
|---|---|
| `resetSessionScopedState` touches 10 state objects | Coordinator in `state/index.js` — imports all slices |
| `render()` called everywhere — circular imports | Render bus pattern (Phase 0, done first) |
| `renderTestSelect` is 1,900 lines | Do Phase 4 last, after all deps are clean modules |
| Timer interval calls `render` on expiry | Move to `lib/quizControls.js`, use `triggerRender` |
| `legacyQuestionMap` IIFE at module level | Move to `lib/questionHelpers.js` as module-level const |
| `renderDetailTable` local closure shared by 2 tabs | Promote to `lib/attemptHelpers.js` before tab split |
| `AUTH_SUBSCRIPTION_KEY` HMR guard | Preserve when moving `registerAuthStateListener` to `state/authState.js` |

---

## Phases

### Phase 0 — Directory skeleton + render bus
- Create all directories
- Create `lib/renderBus.js`
- Verify `vite build` still passes

### Phase 1 — Pure utility libraries (no state deps)
Extract stateless pure functions — safest phase, zero behavior risk.

| File | Functions |
|---|---|
| `lib/escapeHtml.js` | `escapeHtml` |
| `lib/formatters.js` | `formatDateTime`, `formatTimeBdt`, `formatDateShort`, `formatDateFull`, `formatWeekday`, `formatTime`, `formatOrdinal`, `getBdtDateKey`, `formatYearsOfExperience`, `formatSubSectionLabel`, `getContrastText` |
| `lib/errorHelpers.js` | `getSupabaseErrorInfo`, `getErrorMessage`, `logSupabaseError`, `logUnexpectedError`, `isMissingTabLeftCountError`, `isMissingRetakeSessionFieldsError`, `isMissingSessionAttemptOverrideTableError`, `isMissingStudentWarningsTableError` |
| `lib/questionHelpers.js` | `hashString`, `shuffleWithSeed`, `normalizeStemKindValue`, `splitAssetList`, `splitStemLines`, `splitStemLinesPreserveIndent`, `splitTextBoxStemLines`, `parseSpeakerStemLine`, `getAssetProbeTarget`, `isImageChoiceValue`, `isAudioAssetValue`, `getStemMediaAssets`, `getEffectiveAnswerIndices`, `isChoiceCorrect`, `legacyQuestionMap` (IIFE), `mapDbQuestion`, `resolveAssetUrl`, `getAssetBaseUrl`, `normalizeQuestionAssets`, `fetchQuestionRowsWithFallback` |
| `lib/attendanceHelpers.js` | `normalizeAttendanceStatusToken`, `getAttendanceStatusClassSuffix`, `buildAttendanceSummary` |
| `lib/profileHelpers.js` | `calculateAge`, `getPersonalInfoPayload`, `getProfileUploads`, `formatPersonalInfoValue`, `renderPersonalInfoUpload`, `isImageUpload`, `uploadProfileDocument`, `getFileExtension` + constants |
| `lib/radarChart.js` | `getSectionLabelLines`, `buildRadarSvg` |

**Test checkpoint**: full quiz flow end-to-end.

### Phase 2 — State modules (one at a time)
Move each state object + its fetchers. Replace `.finally(render)` with `.finally(triggerRender)`.

**Order** (least to most dependent):
1. `state/questionsState.js`
2. `state/testsState.js`
3. `state/sessionOverrideState.js`
4. `state/resultsState.js`
5. `state/attendanceState.js`
6. `state/rankingState.js`
7. `state/schoolState.js`
8. `state/announcementsState.js`
9. `state/warningsState.js`
10. `state/authState.js`
11. `state/appState.js`
12. `state/index.js` (resetSessionScopedState coordinator)

**Test checkpoint**: login/logout cycle, session persistence on refresh, test loading.

### Phase 3 — Helpers with state dependencies

| File | Functions |
|---|---|
| `lib/sessionHelpers.js` | `getActiveTestVersion`, `getActiveTestSession`, `getActiveTestTitle`, `getActiveTestType`, `getSessionTestType`, `isRetakeSession`, `isRetakeSessionTitle`, `getRetakeBaseTitle`, `getSourceSessionForRetake`, `getBestAttemptForSession`, `canAccessSession`, `allowMultipleAttempts`, `getAttemptCountForSession`, `getExtraAttemptsForSession`, `hasAttemptForSession`, `isSessionAttemptAvailabilityReady`, `hasRemainingAttemptsForSession`, `getActivePassRate`, `getPassRateForVersion` |
| `lib/sectionHelpers.js` | `getCurrentSection`, `getSectionQuestions`, `getActiveSections`, `getCurrentQuestion`, `getQuestionProgress`, `getSectionTitle`, `getQuestionSectionLabel`, `getQuestionPrompt` |
| `lib/attemptHelpers.js` | `getAttemptDedupKey`, `dedupeAttempts`, `getAttemptTimestamp`, `buildLatestAttemptMapByStudent`, `getScoreRateFromAttempt`, `buildAttemptScoreSummaryFromQuestions`, `getVisibleAttemptScoreSummary`, `getAttemptTest`, `getAttemptTestType`, `getAttemptCategory`, `getAttemptDateLabel`, `getAttemptTitle`, `getAttemptSession`, `buildResultAttemptEntries`, `shouldShowAnswers`, `buildAttemptDetailRows`, `buildResultRows`, `buildSectionSummary`, `buildMainSectionSummary`, `buildNestedSectionSummary`, `getAvailableSections`, `renderDetailTable` (promoted from renderTestSelect local closure) |
| `lib/warningHelpers.js` | `normalizeStudentWarningCriteria`, `getCurrentStudentWarningIssues` |
| `lib/quizControls.js` | `startTestTimer`, `getActiveTimeLimitSec`, `getTotalTimeLeftSec`, `countAnsweredAll`, `scoreAll`, `toggleBangla`, `setSingleAnswer`, `setPartAnswer`, `jumpToQuestionInSection`, `goPrevQuestion`, `goNextQuestionOrEnd`, `finishSection`, `goNextSectionOrResult` |
| `lib/questionRenderers.js` | `renderStemMarkup`, `renderUnderlines`, `renderSpeakerStemLines`, `renderStemHTML`, `renderChoicesText`, `renderChoicesImages`, `questionBodyHTML`, `promptBoxHTML`, `renderQuestionBlock`, `renderQuestionGroupHTML`, `banglaButtonHTML`, `focusWarningHTML`, `sidebarHTML`, `getChoiceDisplayOrder`, `getDisplayedChoices`, `getChoices`, `isJapaneseText` |
| `lib/uiHelpers.js` | `topbarHTML`, `syncTopbarHeight`, `renderAndSync`, `renderCandidateLabel`, `setStudentMenuOpen`, `closeStudentMenu`, `registerStudentMenu`, `downloadText` |
| `lib/linkHelpers.js` | `hasLinkParam`, `checkLinkFromUrl` |
| `lib/focusWarning.js` | `registerFocusWarning` |

**Test checkpoint**: quiz navigation, timer, answer persistence, focus warning counter.

### Phase 4 — Tab modules
Each tab exports `buildHtml()` (pure string builder) and `wireEvents(app)` (DOM event binding).

**Order** (simplest to most complex):
1. `tabs/rankingTab.js`
2. `tabs/attendanceHistoryTab.js`
3. `tabs/homeTab.js`
4. `tabs/attendanceTab.js`
5. `tabs/dailyResultsTab.js`
6. `tabs/personalInfoTab.js`
7. `tabs/modelResultsTab.js` (largest)

**Test checkpoint**: all 7 tabs render identically; attendance submission; personal info save; result detail drill-down; back navigation.

### Phase 5 — Page modules
**Order** (most isolated first):
1. `pages/loginPage.js` + `pages/setPasswordPage.js`
2. `pages/introPage.js`
3. `pages/quizPage.js`
4. `pages/resultPage.js`
5. `pages/linkInvalidPage.js`
6. `pages/testSelectPage.js` (orchestrator, depends on all tabs)
7. `pages/index.js` (re-exports)

After this phase, `testSelectPage.js` becomes ~100 lines:
```js
function renderTestSelect(app) {
  triggerDataFetches();          // based on active tab
  const tabModule = getActiveTabModule();
  app.innerHTML = topbarHTML() + menuHTML() + tabModule.buildHtml();
  wireSharedHandlers(app);       // signOut, menu tab switching
  tabModule.wireEvents(app);
}
```

**Test checkpoint**: full E2E quiz flow; guest link flow; password change; sign-out.

### Phase 6 — Slim main.js to bootstrap + router
`main.js` becomes ~80 lines: imports, `render()` switch statement, `setRenderCallback(render)`, and startup sequence.

**Test checkpoint**: full regression; bundle size check; Vite HMR works per-file in dev.

---

## Test Checkpoints Summary

| Phase | Verify |
|---|---|
| 1 | Quiz flow end-to-end |
| 2 | Login/logout, session persistence, test loading |
| 3 | Quiz nav, timer, answer save, focus warnings |
| 4 | All 7 tabs + forms + detail views |
| 5 | Full E2E, guest links, password change, sign-out |
| 6 | Full regression + bundle size + HMR in dev |
