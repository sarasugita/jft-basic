"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import AdminConsoleTestingTabs from "./AdminConsoleTestingTabs";
import { useTestingWorkspaceState } from "./AdminConsoleTestingWorkspaceState";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";

const LazyAdminConsoleResultsWorkspace = dynamic(() => import("./AdminConsoleResultsWorkspace"));

export default function AdminConsoleTestingWorkspace() {
  const context = useAdminConsoleWorkspaceContext();
  const {
    activeTab,
    activeSchoolId,
    session,
    canUseAdminConsole,
    dailySubTab,
    modelSubTab,
    students,
    fetchStudents,
    runSearch,
    supabase,
    isAnalyticsExcludedStudent,
    getScoreRate,
    getTabLeftCount,
    formatDateTime,
    formatDateShort,
    getStudentBaseUrl,
    copyLink,
    formatRatePercent,
    exportDailyGoogleSheetsCsv,
    exportModelGoogleSheetsCsv,
    recordAdminAuditEvent,
  } = context;

  // Get CSV parsers from context
  const {
    parseQuestionCsv,
    parseDailyCsv,
  } = context;

  // Initialize testing workspace state hook
  const hookState = useTestingWorkspaceState({
    supabase,
    activeSchoolId,
    session,
    students,
    activeTab,
    modelSubTab,
    dailySubTab,
    parseQuestionCsv,
    parseDailyCsv,
    recordAuditEvent: recordAdminAuditEvent,
    isAnalyticsExcludedStudent,
    getScoreRate,
    getTabLeftCount,
    formatDateTime,
    formatDateShort,
    getStudentBaseUrl,
    copyLink,
    formatRatePercent,
    runSearch,
    exportDailyGoogleSheetsCsv,
    exportModelGoogleSheetsCsv,
    fetchStudents,
  });

  // Extract testing tab and results workspace props from hook state
  const testingTabProps = {
    activeTab,
    modelSubTab,
    dailySubTab,
    // Include all hook state properties needed by AdminConsoleTestingTabs
    ...hookState,
  };

  const resultsWorkspaceProps = {
    activeTab,
    modelSubTab,
    dailySubTab,
    canUseAdminConsole,
    // Include all hook state properties needed by AdminConsoleResultsWorkspace
    ...hookState,
  };

  const resultsWorkspaceActive = Boolean(
    hookState.previewOpen
    || hookState.sessionDetail?.sessionId
  );

  return (
    <>
      <AdminConsoleTestingTabs {...testingTabProps} />
      {resultsWorkspaceActive ? (
        <LazyAdminConsoleResultsWorkspace {...resultsWorkspaceProps} />
      ) : null}
    </>
  );
}
