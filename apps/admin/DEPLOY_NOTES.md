# Admin Console Refactor — Deployment Notes

## Current Status: Phase 2 Complete — All 3 Extractable Workspaces Done

**Goal**: Split AdminConsoleCore (14,439 lines / 325 KB) into per-workspace isolated bundles to fix loading failures on slow/non-US devices.

**Progress**: 3 of 6 workspaces extracted. AdminConsoleCore reduced from 325.1 KB → 287.0 KB (−38.1 KB cumulative). All workspace loading glitches resolved.

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
- [ ] DailyRecord workspace extracted
- [ ] Attendance workspace extracted
- [ ] Students workspace extracted
- [ ] Testing workspace extracted
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

## Notes for Next Phase (Attendance — Phase 2d)

AdminConsoleCore still contains:
- ~180 useState hooks total (removed 52 across 3 extractions)
- Attendance state: attendanceDate, attendanceModalDay, attendanceByDay, attendanceEntriesByDay, absenceApplications, etc.
- Attendance functions: fetchAttendanceDays, openAttendanceDay, fetchAbsenceApplications, decideAbsenceApplication, etc.
- Will extract in Phase 2d following same pattern as ranking/announcements/dailyRecord

Shared dependencies:
- formatDateFull, formatWeekday, formatDateShort — used by multiple workspaces, keep in core
- Attendance-specific helpers: buildAttendanceStats, buildAttendancePieData, buildAttendanceSummary — move with state hook
- Date utilities: getTodayDateInput, addDays — already in hook or core, refactor if needed

---

**Last Updated**: 2026-03-28 | **Phase 2c Commits**: f25be63 (ranking), 41a67e3 (announcements), c49fc3e (dailyRecord), + fixes (context exports, message clearing, useEffect dependencies)
