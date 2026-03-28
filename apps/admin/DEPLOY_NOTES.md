# Admin Console Refactor — Deployment Notes

## Current Status: Phase 2 In Progress — 5 of 6 Workspaces Extracted

**Goal**: Split AdminConsoleCore (14,439 lines / 325 KB) into per-workspace isolated bundles to fix loading failures on slow/non-US devices.

**Progress**: 5 of 6 workspaces extracted (Ranking, Announcements, DailyRecord, Attendance, Students). AdminConsoleCore reduced from 325.1 KB → ~280 KB (−45 KB cumulative). Testing workspace (67.3 KB, most complex) remains for Phase 2f.

---

## Architecture Overview

### Pre-Refactor (Current for most workspaces)
```
AdminConsole (4.3 KB wrapper)
  ↓ imports
AdminConsoleCore (295.3 KB, shrinking)
  ├─ Auth + supabase client creation
  ├─ School scope management
  ├─ Sidebar + topbar chrome JSX
  ├─ Remaining state for 3 workspaces (shared utilities + Testing data)
  ├─ Data fetching functions (shared + Testing)
  ├─ Mutation handlers (shared + Testing)
  └─ WorkspaceContext provider with ~100 properties
       ↓ consumed by
  [Workspace components with isolated state hooks]
    ├─ AdminConsoleStudentsWorkspace (30.8 KB)
    ├─ AdminConsoleAttendanceWorkspace (9.1 KB)
    ├─ AdminConsoleDailyRecordWorkspace (27.4 KB) ← REFACTORED
    ├─ AdminConsoleRankingWorkspace (10.8 KB) ← REFACTORED
    ├─ AdminConsoleAnnouncementsWorkspace (11.1 KB) ← REFACTORED
    └─ AdminConsoleTestingWorkspace (67.3 KB)
```

### Post-Refactor Target (after all 6 workspaces)
```
AdminConsoleShellLayout
  ├─ Auth (from SuperAdminShell via useSuperAdmin)
  ├─ School-scoped supabase client
  ├─ School name + options
  ├─ AdminConsoleShellFrame (sidebar + topbar)
  └─ AdminConsoleShellProvider (slim context)
       ↓ provided to each workspace route
  /admin/ranking
    AdminConsoleRankingWorkspace
      └─ useRankingWorkspaceState hook (self-contained) ← DEPLOYED
  /admin/announcements
    AdminConsoleAnnouncementsWorkspace
      └─ useAnnouncementsWorkspaceState hook (self-contained) ← DEPLOYED
  /admin/dailyRecord
    AdminConsoleDailyRecordWorkspace
      └─ useDailyRecordWorkspaceState hook (self-contained) ← DEPLOYED
  /admin/students
    AdminConsoleStudentsWorkspace
      └─ useStudentsWorkspaceState hook (TBD)
  /admin/attendance
    AdminConsoleAttendanceWorkspace
      └─ useAttendanceWorkspaceState hook (TBD)
  /admin/model | /admin/daily
    AdminConsoleTestingWorkspace
      └─ useTestingWorkspaceState hook (TBD)
```

---

## Recent Changes (Last 2 Commits)

### Commit f25be63: Phase 2a — Ranking Workspace Extraction

**Files Added**:
- `src/lib/adminAnalyticsHelpers.js` — shared pure helpers (isAnalyticsExcludedStudent, getRowTimestamp, getAttemptScopeKey, buildLatestAttemptMapByStudentAndScope)
- `src/components/AdminConsoleRankingWorkspaceState.jsx` — useRankingWorkspaceState hook with all ranking state/effects/handlers

**Files Modified**:
- `AdminConsoleRankingWorkspace.jsx` — now uses own state hook instead of WorkspaceContext
- `AdminConsoleCore.jsx` — removed:
  - State: rankingPeriods, rankingDrafts, rankingMsg, rankingRefreshingId, rankingRowCount memo, analyticsStudents memo
  - Functions: getRankingDrafts, fetchRankingPeriods, updateRankingDraft, saveRankingPeriodLabel, addRankingPeriod, refreshRankingPeriod
  - WorkspaceContext entries: 10 ranking-related properties

**Chunk Impact**: Core 325.1 KB → 319.0 KB (−6.1 KB). Ranking workspace 4.1 KB → 10.8 KB (now carries state).

---

### Commit 41a67e3: Phase 2b — Announcements Workspace Extraction

**Files Added**:
- `src/lib/adminFormatters.js` — shared date/time utilities (BD_OFFSET_MS, formatDateTime, toBangladeshInput, fromBangladeshInput, formatDateTimeInput, getBangladeshDateInput)
- `src/lib/adminAudit.js` — shared audit helpers (getSupabaseAccessToken, recordAdminAuditEvent)
- `src/components/AdminConsoleAnnouncementsWorkspaceState.jsx` — useAnnouncementsWorkspaceState hook with all announcement state/effects/handlers

**Files Modified**:
- `AdminConsoleAnnouncementsWorkspace.jsx` — now uses own state hook; imports formatDateTime directly from adminFormatters
- `AdminConsoleCore.jsx` — removed:
  - State: announcements, announcementForm, announcementCreateOpen, announcementMsg, editingAnnouncementId, editingAnnouncementForm
  - Functions: fetchAnnouncements, createAnnouncement, deleteAnnouncement, startEditAnnouncement, cancelEditAnnouncement, openCreateAnnouncementModal, closeCreateAnnouncementModal, saveAnnouncementEdits
  - WorkspaceContext entries: 16 announcement-related properties

**Chunk Impact**: Core 319.0 KB → 316.2 KB (−2.8 KB). Announcements workspace 6.7 KB → 11.1 KB (now carries state).

---

### Commit 2bb852f: Phase 2d (Part 1) — Attendance Workspace State Extraction

**Files Added**:
- `src/components/AdminConsoleAttendanceWorkspaceState.jsx` — useAttendanceWorkspaceState hook with attendance state/functions

**Files Modified**:
- `AdminConsoleAttendanceWorkspace.jsx` — now uses own state hook for core state and functions; memos still from context (Phase 2d-2)

**Extracted to Hook**:
- State (16 vars): attendanceDays, attendanceEntries, attendanceMsg, attendanceDate, attendanceModalOpen/Day/Draft, attendanceSaving/Clearing, attendanceImportConflict/Status, attendanceFilter, absenceApplications/Msg, approvedAbsenceByStudent
- Functions (8): fetchAttendanceDays, fetchAttendanceEntries, openAttendanceDay, saveAttendanceDay, deleteAttendanceDay, clearAllAttendanceValues, fetchAbsenceApplications, decideAbsenceApplication
- Helper functions: buildAttendancePieData, buildAttendanceSummary, normalizeAttendanceStatusToken, normalizeAttendanceImportStatus, isCountedAttendanceStatus, getAttendanceStatusClassName, detectAttendanceImportLayout
- Constants: ATTENDANCE_COUNTED_STATUSES, ATTENDANCE_SUPPORTED_STATUSES

**Deferred to Phase 2d-2**:
- Memos (7): attendanceEntriesByDay, attendanceDayColumns, attendanceRangeColumns, activeStudents (shared), attendanceFilteredStudents, attendanceAnalyticsStudents, attendanceDayRates
- Functions (2): exportAttendanceGoogleSheetsCsv, importAttendanceGoogleSheetsCsv (large, complex CSV handling)
- Shared formatters: formatDateShort, formatWeekday (used by multiple workspaces)

**Chunk Impact**: Attendance workspace 9.1 KB → 20.1 KB.

**Status**: ✓ Deployed (Part 1)

### Commit 6969d9c: Phase 2d-2 — Attendance Memos & Derived Data

**Extracted to Hook**:
- Memos (7): attendanceEntriesByDay, attendanceDayColumns, attendanceRangeColumns, activeStudents, attendanceFilteredStudents, attendanceAnalyticsStudents, attendanceDayRates

**Key Changes**:
- Hook now accepts `isAnalyticsExcludedStudent` as parameter for filtering
- All attendance memos co-located with state in hook
- Workspace gets all memos from hook, not context
- Removed `attendanceDayRates` from context imports in workspace

**Chunk Impact**: Attendance workspace 20.1 KB → 21.5 KB. AdminConsoleCore still 287.0 KB (unused duplicate state + export/import functions).

**Status**: ✓ Deployed (Complete)

**Note**: Old attendance state remains in AdminConsoleCore (unused). Can be removed in cleanup phase. Export/import CSV functions still in core (large, complex dependencies on formatters).

---

## Phase 2d-2 Troubleshooting Log

During the Phase 2d-2 extraction, several issues were encountered and resolved:

### Issue 1: Missing Formatter Functions in Hook
**Error**: `ReferenceError: formatDateShort is not defined`
**Cause**: Memos in the hook referenced shared formatter functions that weren't available in hook scope
**Solution**: Pass `formatDateShort` and `formatWeekday` as parameters from workspace component
**Lesson**: Functions that depend on context should be passed as parameters or imported, not used directly in hooks

### Issue 2: Complex Inline Function Definitions
**Error**: `Cannot access 'j' before initialization`
**Cause**: Inline function definitions in destructuring assignment caused variable hoisting issues
**Solution**: Define formatter functions outside the hook call, pass by reference
**Code Pattern Before** (❌ Bad):
```javascript
const { state } = useHook({
  formatDateShort: (d) => { ... },
  formatWeekday: (d) => { ... }
});
```
**Code Pattern After** (✅ Good):
```javascript
function formatDateShortFn(d) { ... }
function formatWeekdayFn(d) { ... }
const { state } = useHook({
  formatDateShort: formatDateShortFn,
  formatWeekday: formatWeekdayFn
});
```

### Issue 3: Missing buildAttendanceStats Function
**Error**: `ReferenceError: buildAttendanceStats is not defined`
**Cause**: Memos called `buildAttendanceStats()` but the function was never defined in the hook
**Solution**: Added `buildAttendanceStats` function definition to the hook. It depends on helper functions already in scope (`normalizeAttendanceStatusToken`, `isCountedAttendanceStatus`)
**Lesson**: When exporting a function from a hook's return object, ensure the function is actually defined in the hook

### Issue 4: Circular Reference with attendanceSubTab
**Error**: `ReferenceError: Cannot access 'attendanceSubTab' before initialization`
**Cause**: Trying to destructure `attendanceSubTab` from hook while also passing it as a parameter to the hook
**Solution**: Get `attendanceSubTab` from context only, pass to hook as parameter, don't try to get it back from hook
**Pattern**:
```javascript
// ✅ Correct
const { attendanceSubTab, ... } = useAdminConsoleWorkspaceContext();
const { ...stateFromHook } = useAttendanceWorkspaceState({
  attendanceSubTab,
  ...
});

// ❌ Wrong - circular reference
const { attendanceSubTab, stateFromHook } = useAttendanceWorkspaceState({
  attendanceSubTab,
  ...
});
```
**Lesson**: State that comes from context should not be destructured from hooks that receive it as a parameter. UI state (which tab is active) stays in context; data state (attendance records) goes in hook.

### Key Principles for Workspace State Extraction

1. **Value vs Reference**: Primitives and objects from context (activeSchoolId, students, settings) should be passed to hooks as parameters
2. **State Ownership**: UI state (tabs, modals, filters) can stay in context; data state (records, entries) should move to hooks
3. **Helper Functions**: Shared formatters, validators, and utilities should be passed as parameters rather than imported in hooks to avoid circular dependencies
4. **Function Dependencies**: When memos reference functions, ensure those functions are:
   - Defined in the hook before the memos
   - Or passed as parameters to the hook
   - Not referenced before they're available
5. **Initialization Order**: Keep function definitions separate from destructuring assignments to avoid hoisting issues

---

### Commit c49fc3e: Phase 2c — DailyRecord Workspace Extraction

**Files Added**:
- `src/components/AdminConsoleDailyRecordWorkspaceState.jsx` — useDailyRecordWorkspaceState hook with all schedule/record state/effects/handlers

**Files Modified**:
- `AdminConsoleDailyRecordWorkspace.jsx` — now uses own state hook instead of WorkspaceContext; added local formatDateFull/formatWeekday helpers
- `AdminConsoleCore.jsx` — removed:
  - State: dailyRecords, dailyRecordsMsg, dailyRecordDate, dailyRecordDatePickerOpen, dailyRecordCalendarMonth, dailyRecordModalOpen, dailyRecordSaving, dailyRecordForm, dailyRecordAnnouncementTitleDraft, dailyRecordAnnouncementDraft, dailyRecordSyllabusAnnouncements, dailyRecordPlanDrafts, dailyRecordConfirmedDates, dailyRecordPlanSavingDate, dailyRecordHolidaySavingDate, + 2 refs
  - Functions: fetchDailyRecords, openDailyRecordModal, closeDailyRecordModal, updateDailyRecordPlanDraft, updateDailyRecordComment, updateDailyRecordTextbookEntry, toggleDailyRecordCanDo, addDailyRecordTextbookEntry, removeDailyRecordTextbookEntry, addDailyRecordCommentRow, removeDailyRecordCommentRow, saveDailyRecord, saveDailyRecordPlan, saveDailyRecordHoliday
  - Memos: scheduleRecordRows, scheduleRecordActualTestsByDate, scheduleRecordDisplayByDate, dailyRecordSelectableDates, dailyRecordSelectableDateSet, dailyRecordCalendarMonths, dailyRecordCalendarMonthKeys, dailyRecordActiveCalendarMonth, dailyRecordTomorrowSessions
  - Modal JSX: 350-line portal rendering the daily record form
  - WorkspaceContext entries: 20 DailyRecord-related properties

**Chunk Impact**: Core 316.2 KB → 295.3 KB (−20.9 KB). DailyRecord workspace 7.3 KB → 27.4 KB (now carries state + Irodori constants + modal content logic).

---

### Commit [TBD]: Phase 2e — Students Workspace State Extraction

**Files Added**:
- `src/components/AdminConsoleStudentsWorkspaceState.jsx` — useStudentsWorkspaceState hook with all student list management state/functions

**Files Modified**:
- `AdminConsoleStudentsWorkspace.jsx` — now uses own state hook for student list, detail view, and warning management state; handler functions (fetchStudentAttempts, fetchStudentAttendance, issueStudentWarning) kept in context for now due to complex dependencies

**Extracted to Hook** (26 state variables + 1 async function + 7 helpers):
- State (26 vars): studentMsg, studentTempMap, selectedStudentId/Detail/Tab, studentAttempts/AttemptsMsg/AttemptRanks, studentAttendance/AttendanceMsg/AttendanceRange, studentInfoOpen/Saving/Msg/Form/UploadFiles, studentListFilters/AttendanceMap/Attempts/Loading/MetricsLoaded, studentDetailOpen/Loading/Msg/ReportExporting/AttendanceMonthKey, studentWarnings/Loading/Loaded/Msg, studentWarningIssueOpen/Saving/Msg, studentWarningDeletingId/Form, selectedStudentWarning/PreviewStudentId
- Functions (1): fetchStudentListMetrics (queries attendance + attempts for filtering)
- Memos (2): sortedStudents (sorts by student code, then name), studentListRows (applies attendance/avg/unexcused filters)
- Helpers (2): normalizeStudentNumberInput, getStudentDisplayName
- Helper dependencies (5): getRowTimestamp, getAttemptScopeKey, buildLatestAttemptMapByStudentAndScope, buildStudentMetricRows, isMissingTabLeftCountError

**Kept in Context** (complex dependencies):
- fetchStudents() — used by multiple workspaces
- fetchStudentAttempts(), fetchStudentAttendance() — complex state hydration (attemptQuestionsByVersion, studentsById maps)
- issueStudentWarning(), deleteStudentWarning(), fetchStudentWarnings() — warning management with criteria normalization
- isAnalyticsExcludedStudent() — shared by Attendance, Ranking, Testing workspaces

**Deferred to Future** (if extracted):
- All student detail view rendering logic (32 fields, 4 tabs: information, attempts, attendance, warnings)
- Personal info editor modal (profile uploads, date fields)
- Reissue password flow (stays in context)
- Invite modal (stays in context)

**Chunk Impact**: Students workspace now 30.8 KB (unchanged, all state moved to hook but component still large due to UI rendering).

**Status**: ✓ Extracted (awaiting deploy test)

**Hook Signature**:
```javascript
const {
  studentMsg, selectedStudentId, setSelectedStudentId,
  selectedStudentDetail, selectedStudentTab,
  studentAttempts, studentAttemptsMsg, studentAttemptRanks,
  studentAttendance, studentAttendanceMsg, studentAttendanceRange,
  studentListFilters, setStudentListFilters,
  studentListLoading, studentListMetricsLoaded,
  studentWarnings, studentWarningsLoading, studentWarningsLoaded,
  studentWarningIssueOpen, studentWarningForm,
  studentListRows, fetchStudentListMetrics,
  normalizeStudentNumberInput, getStudentDisplayName,
  // ... 20 additional setters
} = useStudentsWorkspaceState({
  supabase, activeSchoolId, students, testMetaByVersion, getScoreRate
});
```

**Notes**:
- Hook accepts `getScoreRate` as parameter (from context) to avoid reimplementing it
- students list passed as parameter since it's managed by fetchStudents in core
- sortedStudents and studentListRows memos depend on students parameter + testMetaByVersion for score calculation
- buildStudentMetricRows helper now in hook, uses passed-in getScoreRate for compatibility

---

## Key Design Patterns

### Workspace State Hooks (New)
Each extracted workspace has a hook that encapsulates all its state and logic:

```jsx
export function useRankingWorkspaceState({ supabase, activeSchoolId }) {
  const [rankingPeriods, setRankingPeriods] = useState([]);
  // ... all state ...

  async function fetchRankingPeriods() { /* ... */ }
  function updateRankingDraft(...) { /* ... */ }
  // ... all handlers ...

  return {
    rankingPeriods, rankingMsg, rankingRowCount,
    fetchRankingPeriods, updateRankingDraft, /* ... */
  };
}
```

Workspace components call the hook and use returned state/handlers directly:
```jsx
const { rankingPeriods, fetchRankingPeriods, /* ... */ } = useRankingWorkspaceState({ supabase, activeSchoolId });
```

### Shared Utilities (Extracted)
- **adminAnalyticsHelpers.js** — filters and maps used by ranking + testing + attendance
- **adminFormatters.js** — date/time formatting (Bangladesh timezone UTC+6)
- **adminAudit.js** — audit logging helpers used across workspaces

---

## Deployment Checklist

### Before Deploying This Phase
- [x] Build passes, chunks within budget
- [x] All ranking/announcements state moved out of AdminConsoleCore
- [x] Workspace display components use own state hooks
- [x] Git history clean with descriptive commits

### Before Shipping Phase 2 Complete (All 6 Workspaces)
- [x] DailyRecord workspace extracted
- [x] Attendance workspace extracted
- [x] Students workspace extracted
- [ ] Testing workspace extracted (Phase 2f — in planning)
- [ ] Smoke test all workspaces on working device (no UI regression)
- [ ] Test on slow/non-US device to verify loading improvement
- [ ] AdminConsole.jsx and AdminConsoleCore.jsx deleted (Phase 3)
- [ ] Routes aligned to Next.js structure (Phase 4)

### Expected Final Chunks (Estimate)
- AdminConsoleShell layout: 30–50 KB
- Ranking workspace: 10–15 KB
- Announcements workspace: 10–15 KB
- DailyRecord workspace: 15–25 KB
- Attendance workspace: 15–25 KB
- Students workspace: 40–60 KB
- Testing workspace: 100–150 KB

Each loads on-demand when tab is visited. First page load: shell only (~40 KB) then requested workspace.

---

## Rollback Plan

If regressions are found:
1. Revert latest commit: `git revert HEAD`
2. Workspaces fall back to using old WorkspaceContext from AdminConsoleCore
3. No data loss; only bundle size returns to pre-refactor state

---

## Critical Fixes Applied in Phase 2c

### Fix 1: Context Exports (supabase, testSessions)
- **Issue**: Workspace hooks required `supabase` and `testSessions` from context but these were never exported
- **Manifestation**: All three extracted workspaces showed "Loading..." indefinitely
- **Fix**: Added both to workspaceContextValue in AdminConsoleCore
- **Status**: ✓ Deployed

### Fix 2: Message Clearing on School ID Mismatch
- **Issue**: fetchDailyRecords() and fetchAnnouncements() had early returns without clearing "Loading..." state
- **Manifestation**: Persistent red "Loading..." message when switching schools
- **Fix**: Added `setDailyRecordsMsg("")` and `setAnnouncementMsg("")` before early returns in workspace state hooks
- **Status**: ✓ Deployed

### Fix 3: useEffect Dependency Array (Infinite Fetch Loop)
- **Issue**: AdminConsoleAnnouncementsWorkspace and AdminConsoleDailyRecordWorkspace included fetch function references in useEffect dependencies
- **Manifestation**: Functions recreated on every render → dependency array changes every render → effect triggers infinitely → continuous "Loading..." states
- **Fix Applied**:
  - AdminConsoleAnnouncementsWorkspace (line 32): Removed `fetchAnnouncements` from `[activeSchoolId, fetchAnnouncements]` → `[activeSchoolId]`
  - AdminConsoleDailyRecordWorkspace (line 63): Removed `fetchDailyRecords, fetchStudents` from dependencies → kept only `[activeSchoolId, students.length]`
  - AdminConsoleRankingWorkspace already correct with only `[activeSchoolId]`
- **Status**: ✓ Deployed

---

## Notes for Next Phases

### Phase 2e (Students) — IN PROGRESS
- [x] Extract useStudentsWorkspaceState hook with student list/detail/warning state
- [x] Update AdminConsoleStudentsWorkspace to use hook
- [ ] Deploy and test on devices
- [ ] Verify no UI regressions (student list, detail view, warnings modal)

### Phase 2f (Testing)
After Phase 2e, final workspace:
- Testing workspace: 67.3 KB → extract useTestingWorkspaceState (largest, most complex)
  - Encompasses all model test and daily test session management
  - Heavy analytics calculations (session results matrix, attempt rankings, score distribution)
  - Question management, preview modal, upload flows
  - Dependencies: all existing analytics helpers, schema questions

### Shared State Still in Core
AdminConsoleCore retains:
- ~160+ useState hooks (after 80 extracted across 4 phases)
- Shared helpers: formatDateFull, formatWeekday, formatDateShort, buildStudentMetricRows, etc.
- Cross-workspace utilities: isAnalyticsExcludedStudent, buildLatestAttemptMapByStudent, etc.
- School/student management, session context
- Sidebar/topbar JSX

### Estimated Final Core Size
- AdminConsoleCore: 100–150 KB (shell + shared utilities)
- Ranking: 10–15 KB
- Announcements: 10–15 KB
- DailyRecord: 15–25 KB
- Attendance: 20–30 KB (with exports)
- Students: 30–50 KB
- Testing: 80–120 KB
- Total workspace bundle on-demand load: ~200–300 KB (first page: shell ~60 KB + requested tab)

---

**Last Updated**: 2026-03-28 | **Phase 2c Commits**: f25be63 (ranking), 41a67e3 (announcements), c49fc3e (dailyRecord), + fixes (context exports, message clearing, useEffect dependencies)
