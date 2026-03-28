"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import AdminConsoleTestingTabs from "./AdminConsoleTestingTabs";
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
    tests,
    fetchStudents,
    fetchTests,
    fetchTestSessions,
    fetchExamLinks,
    fetchAssets,
    runSearch,
    resultContext,
    previewOpen,
    attemptDetailOpen,
    sessionDetail,
    testingTabProps,
    resultsWorkspaceProps,
  } = context;

  useEffect(() => {
    if (!activeSchoolId) return;
    if (activeTab !== "model" && activeTab !== "daily") return;
    fetchTests();
    fetchTestSessions();
    fetchExamLinks();
    const isUploadTab =
      (activeTab === "model" && modelSubTab === "upload")
      || (activeTab === "daily" && dailySubTab === "upload");
    if (isUploadTab) {
      fetchAssets();
    }
  }, [
    activeSchoolId,
    activeTab,
    dailySubTab,
    modelSubTab,
  ]);

  useEffect(() => {
    if (!activeSchoolId || !session || !canUseAdminConsole) return;
    if (activeTab === "daily" && dailySubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("daily");
    }
    if (activeTab === "model" && modelSubTab === "results") {
      if (!students.length) fetchStudents();
      runSearch("mock");
    }
  }, [
    activeSchoolId,
    activeTab,
    canUseAdminConsole,
    dailySubTab,
    modelSubTab,
    session,
    students.length,
  ]);

  const resultsWorkspaceActive = Boolean(
    resultContext
    || previewOpen
    || attemptDetailOpen
    || sessionDetail.sessionId
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
