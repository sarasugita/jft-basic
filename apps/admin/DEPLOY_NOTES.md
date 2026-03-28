# Admin Console Refactor — Deployment Notes

## Current Status: Phase 2 In Progress

**Goal**: Split AdminConsoleCore (14,439 lines / 325 KB) into per-workspace isolated bundles to fix loading failures on slow/non-US devices.

**Progress**: 2 of 6 workspaces extracted. AdminConsoleCore reduced from 325.1 KB → 316.2 KB (−8.9 KB).

---

## Architecture Overview

### Pre-Refactor (Current for most workspaces)
```
AdminConsole (4.3 KB wrapper)
  ↓ imports
AdminConsoleCore (316.2 KB, shrinking)
  ├─ Auth + supabase client creation
  ├─ School scope management
  ├─ Sidebar + topbar chrome JSX
  ├─ ALL state for all 6 workspaces (203 useState vars)
  ├─ ALL data fetching functions
  ├─ ALL mutation handlers
  └─ WorkspaceContext provider with ~200 properties
       ↓ consumed by
  [Workspace components] (thin display layers)
    ├─ AdminConsoleStudentsWorkspace (30.8 KB)
    ├─ AdminConsoleAttendanceWorkspace (9.1 KB)
    ├─ AdminConsoleDailyRecordWorkspace (7.3 KB)
    ├─ AdminConsoleRankingWorkspace (10.8 KB) ← REFACTORED
    ├─ AdminConsoleAnnouncementsWorkspace (11.0 KB) ← REFACTORED
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
  /admin/students
    AdminConsoleStudentsWorkspace
      └─ useStudentsWorkspaceState hook (TBD)
  /admin/attendance
    AdminConsoleAttendanceWorkspace
      └─ useAttendanceWorkspaceState hook (TBD)
  /admin/daily-record
    AdminConsoleDailyRecordWorkspace
      └─ useDailyRecordWorkspaceState hook (TBD)
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

**Chunk Impact**: Core 319.0 KB → 316.2 KB (−2.8 KB). Announcements workspace 6.7 KB → 11.0 KB (now carries state).

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

## Notes for Next Phase (DailyRecord)

AdminConsoleCore still contains:
- 203 useState hooks total (removed 16 so far)
- Daily record state: dailyRecords, dailyRecordForm, dailyRecordDate, dailyRecordModalOpen, dailyRecordPlanDrafts, dailyRecordConfirmedDates, dailyRecordSyllabusAnnouncements, dailyRecordHolidaySavingDate, dailyRecordPlanSavingDate
- Daily record functions: fetchDailyRecords, openDailyRecordModal, closeDailyRecordModal, updateDailyRecordPlanDraft, saveDailyRecordPlan, saveDailyRecordHoliday, etc.
- Will extract in Phase 2c following same pattern as ranking/announcements

Shared dependency: `getTodayDateInput`, `addDays`, `addMonths` — already extracted to adminFormatters or kept in AdminConsoleCore if used by other workspaces.

---

**Last Updated**: 2026-03-28 | **Commits**: f25be63 (ranking), 41a67e3 (announcements)
