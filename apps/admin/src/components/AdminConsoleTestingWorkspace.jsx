"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect } from "react";
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

  // Memoize recordAuditEvent to prevent unnecessary re-renders in the hook
  const memoizedRecordAuditEvent = useCallback(
    (eventObj) => recordAdminAuditEvent(supabase, eventObj),
    [supabase, recordAdminAuditEvent]
  );

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
    recordAuditEvent: memoizedRecordAuditEvent,
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

  // Create resultContext for the results workspace
  const resultContext = (() => {
    if (activeTab === "model" && modelSubTab === "results") {
      return { type: "mock", title: "Model Test Results", tests: hookState.modelTests };
    }
    if (activeTab === "daily" && dailySubTab === "results") {
      return { type: "daily", title: "Daily Test Results", tests: hookState.dailyTests };
    }
    return null;
  })();

  const resultsWorkspaceProps = {
    activeTab,
    modelSubTab,
    dailySubTab,
    canUseAdminConsole,
    resultContext,
    students,
    // Add context utilities
    supabase,
    formatDateTime,
    formatDateShort,
    formatRatePercent,
    getScoreRate,
    getTabLeftCount,
    runSearch,
    exportDailyGoogleSheetsCsv,
    exportModelGoogleSheetsCsv,
    // Include all hook state properties needed by AdminConsoleResultsWorkspace
    ...hookState,
  };

  const resultsWorkspaceActive = Boolean(
    (modelSubTab === "results" && activeTab === "model")
    || (dailySubTab === "results" && activeTab === "daily")
    || hookState.previewOpen
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
