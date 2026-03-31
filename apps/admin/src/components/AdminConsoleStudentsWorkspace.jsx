"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo } from "react";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useStudentsWorkspaceState } from "./AdminConsoleStudentsWorkspaceState";

const LazyAdminConsoleResultsWorkspace = dynamic(() => import("./AdminConsoleResultsWorkspace"));

export default function AdminConsoleStudentsWorkspace() {
  const contextData = useAdminConsoleWorkspaceContext();
  const {
    activeSchoolId,
    session,
    canUseAdminConsole,
    supabase,
    students,
    testMetaByVersion,
    getScoreRate,
    fetchStudents,
    setInviteOpen,
    handleLoadStudentWarnings,
    studentWarningCounts,
    handleCsvFile,
    csvMsg,
    selectedStudent: contextSelectedStudent,
    setSelectedStudentId: setContextSelectedStudentId,
    exportStudentReportPdf,
    setReissueStudent,
    setReissuePassword,
    setReissueIssuedPassword,
    setReissueLoading,
    setReissueMsg,
    setReissueOpen,
    toggleTestAccount,
    toggleWithdrawn,
    deleteStudent,
    fetchStudentAttendance,
    fetchStudentAttempts,
    fetchStudentDetail,
    setStudentInfoForm: setCoreStudentInfoForm,
    getPersonalInfoForm,
    setStudentInfoUploadFiles: setCoreStudentInfoUploadFiles,
    setStudentInfoMsg: setCoreStudentInfoMsg,
    setStudentInfoOpen: setCoreStudentInfoOpen,
    hasStudentDetailFields,
    formatDateFull,
    calculateAge,
    formatYearsOfExperience,
    PERSONAL_UPLOAD_FIELDS,
    renderProfileUpload,
    getProfileUploads,
    studentModelCategorySummaryRows,
    studentModelAttempts,
    sectionTitles,
    renderTwoLineHeader,
    getAttemptEffectivePassRate,
    studentAttemptSummaryById,
    attemptCanOpenDetail,
    openAttemptDetail,
    getAttemptTitle,
    getAttemptDisplayDateValue,
    getTabLeftCount,
    selectedAttempt,
    attemptDetailOpen,
    setAttemptDetailOpen,
    setSelectedAttemptObj,
    attemptDetailSource,
    setAttemptDetailSource,
    attemptQuestionsLoading,
    attemptQuestionsError,
    attemptDetailTab,
    setAttemptDetailTab,
    selectedAttemptRows,
    selectedAttemptScoreRate,
    selectedAttemptUsesImportedSummary,
    selectedAttemptUsesImportedModelSummary,
    selectedAttemptMainSectionSummary,
    selectedAttemptIsPass,
    selectedAttemptIsModel,
    selectedAttemptNestedSectionSummary,
    selectedAttemptPassRate,
    selectedAttemptSectionSummary,
    selectedAttemptQuestionSectionsFiltered,
    attemptDetailSectionRefs,
    attemptDetailWrongOnly,
    setAttemptDetailWrongOnly,
    exportSelectedAttemptCsv,
    deleteAttempt: deleteAttemptRecord,
    studentDailyCategorySummaryRows,
    studentDailyAttemptsByCategory,
    studentAttendancePrevMonthKey,
    selectedStudentAttendanceMonth,
    studentAttendanceMonthOptions,
    studentAttendanceNextMonthKey,
    studentAttendancePie,
    attendanceSummary,
    filteredStudentAttendance,
    formatDateShort,
    formatWeekday,
    formatDateTime,
    summarizeWarningCriteria,
    getDefaultStudentWarningForm,
    issueStudentWarning: issueStudentWarningCtx,
    deleteStudentWarning: deleteStudentWarningCtx,
    studentWarningPreviewStudent,
    studentWarningPreviewEntries,
    studentWarningIssueOpen,
    setStudentWarningIssueOpen,
    studentWarningIssueSaving,
    setStudentWarningIssueSaving,
    studentWarningIssueMsg,
    setStudentWarningIssueMsg,
    studentWarningDeletingId,
    setStudentWarningDeletingId,
    studentWarningForm,
    setStudentWarningForm,
    selectedStudentWarning,
    setSelectedStudentWarning,
    studentWarningPreviewStudentId,
    setStudentWarningPreviewStudentId,
  } = contextData;

  // Use the Students workspace state hook
  const {
    studentMsg,
    selectedStudentId,
    setSelectedStudentId,
    selectedStudentDetail,
    setSelectedStudentDetail,
    selectedStudentTab,
    setSelectedStudentTab,
    studentAttempts,
    setStudentAttempts,
    studentAttemptsMsg,
    setStudentAttemptsMsg,
    studentAttemptRanks,
    setStudentAttemptRanks,
    studentAttendance,
    setStudentAttendance,
    studentAttendanceMsg,
    setStudentAttendanceMsg,
    studentAttendanceRange,
    setStudentAttendanceRange,
    studentInfoOpen,
    setStudentInfoOpen,
    studentInfoSaving,
    setStudentInfoSaving,
    studentInfoMsg,
    setStudentInfoMsg,
    studentInfoForm,
    setStudentInfoForm,
    studentInfoUploadFiles,
    setStudentInfoUploadFiles,
    studentListFilters,
    setStudentListFilters,
    studentListLoading,
    studentListMetricsLoaded,
    studentDetailOpen,
    setStudentDetailOpen,
    studentDetailLoading,
    setStudentDetailLoading,
    studentDetailMsg,
    studentReportExporting,
    setStudentReportExporting,
    studentAttendanceMonthKey,
    setStudentAttendanceMonthKey,
    studentWarnings,
    setStudentWarnings,
    studentWarningsLoading,
    studentWarningsLoaded,
    studentWarningsMsg,
    setStudentWarningsMsg,
    studentListRows,
    fetchStudentListMetrics,
    openStudentWarningsModalFn,
    openStudentDetailFn,
    normalizeStudentNumberInput,
    getStudentDisplayName,
  } = useStudentsWorkspaceState({
    supabase,
    activeSchoolId,
    session,
    students,
    testMetaByVersion,
    getScoreRate,
    fetchStudentDetail,
    setStudentWarningForm,
    setStudentWarningIssueMsg,
    setStudentWarningIssueOpen,
  });

  const selectedStudent = useMemo(() => {
    if (!selectedStudentId) return null;
    const selectedStudentSummary = students.find((student) => student.id === selectedStudentId) ?? null;
    if (contextSelectedStudent?.id === selectedStudentId) {
      return { ...(selectedStudentSummary ?? {}), ...contextSelectedStudent };
    }
    if (selectedStudentDetail?.id === selectedStudentId) {
      return { ...(selectedStudentSummary ?? {}), ...selectedStudentDetail };
    }
    return selectedStudentSummary;
  }, [contextSelectedStudent, selectedStudentDetail, selectedStudentId, students]);

  // Wrapper for loading metrics (since handleLoadStudentMetrics from context references old fetchStudentListMetrics)
  const loadMetrics = useCallback(() => {
    if (studentListLoading) return;
    fetchStudentListMetrics();
  }, [studentListLoading, fetchStudentListMetrics]);

  useEffect(() => {
    if (!activeSchoolId || !session || !canUseAdminConsole) return;
    fetchStudents();
  }, [activeSchoolId, canUseAdminConsole, session]);

  useEffect(() => {
    setContextSelectedStudentId(selectedStudentId || "");
  }, [selectedStudentId, setContextSelectedStudentId]);

  return (
    <div style={{ marginBottom: 12 }}>
      {!studentDetailOpen ? (
        <>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div className="admin-title">Student List</div>
              <button className="btn btn-primary student-list-primary-btn" onClick={() => setInviteOpen(true)}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span>Add New Student</span>
              </button>
              <button
                className="btn student-list-primary-btn student-warning-launch-btn"
                onClick={() => openStudentWarningsModalFn(getDefaultStudentWarningForm)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span>Warnings</span>
              </button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
              <button
                className="btn student-list-primary-btn"
                type="button"
                onClick={() => void loadMetrics()}
                disabled={studentListLoading}
                aria-label={studentListLoading ? "Loading metrics" : studentListMetricsLoaded ? "Refresh metrics" : "Load metrics"}
                title={studentListLoading ? "Loading metrics..." : studentListMetricsLoaded ? "Refresh metrics" : "Load metrics"}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M16 10a6 6 0 1 1-1.76-4.24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M16 4.5v3.75h-3.75"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{studentListLoading ? "Loading Metrics..." : studentListMetricsLoaded ? "Refresh Metrics" : "Load Metrics"}</span>
              </button>
              <button
                className="btn student-list-primary-btn"
                type="button"
                onClick={() => void handleLoadStudentWarnings()}
                disabled={studentWarningsLoading}
                aria-label={studentWarningsLoading ? "Loading warnings" : studentWarningsLoaded ? "Refresh warnings" : "Load warnings"}
                title={studentWarningsLoading ? "Loading warnings..." : studentWarningsLoaded ? "Refresh warnings" : "Load warnings"}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M16 10a6 6 0 1 1-1.76-4.24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M16 4.5v3.75h-3.75"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{studentWarningsLoading ? "Loading Warnings..." : studentWarningsLoaded ? "Refresh Warnings" : "Load Warnings"}</span>
              </button>
            </div>
          </div>

          <div className="attendance-filter-box" style={{ marginTop: 14 }}>
            <div className="admin-form" style={{ marginTop: 0 }}>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />(Attendance Rate ≤)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g. 80"
                  value={studentListFilters.maxAttendance}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, maxAttendance: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />(Unexcused ≥)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="e.g. 3"
                  value={studentListFilters.minUnexcused}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, minUnexcused: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />(Model Avg Rate ≥)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g. 60"
                  value={studentListFilters.minModelAvg}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, minModelAvg: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />(Daily Avg Rate ≥)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g. 60"
                  value={studentListFilters.minDailyAvg}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, minDailyAvg: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />Date From</label>
                <input
                  type="date"
                  value={studentListFilters.from}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, from: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label className="student-list-filter-label">Filter<br />Date To</label>
                <input
                  type="date"
                  value={studentListFilters.to}
                  onChange={(e) => setStudentListFilters((s) => ({ ...s, to: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <div className="admin-table-wrap" style={{ marginTop: 10 }}>
            <table className="admin-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th>Student<br />No.</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Attendance<br />Rate</th>
                  <th>Unexcused<br />Absence</th>
                  <th>Model Avg<br />Rate</th>
                  <th>Daily Avg<br />Rate</th>
                </tr>
              </thead>
              <tbody>
                {studentListRows.map((row) => {
                  const s = row.student;
                  const rateLabel = row.attendanceRate == null ? "-" : `${row.attendanceRate.toFixed(1)}%`;
                  const modelLabel = row.modelAvg == null ? "-" : `${row.modelAvg.toFixed(1)}%`;
                  const dailyLabel = row.dailyAvg == null ? "-" : `${row.dailyAvg.toFixed(1)}%`;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => {
                        void openStudentDetailFn(s.id);
                      }}
                      className={s.is_withdrawn ? "row-withdrawn" : ""}
                    >
                      <td>{s.student_code ?? ""}</td>
                      <td>
                        <div className="student-list-name-cell">
                          <span>{s.display_name ?? ""}</span>
                          {studentWarningCounts[s.id] ? (
                            <button
                              type="button"
                              className="student-warning-badge student-warning-badge-btn"
                              title={`${studentWarningCounts[s.id]} warning(s) issued`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setStudentWarningPreviewStudentId(s.id);
                              }}
                            >
                              !
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td>{s.email ?? ""}</td>
                      <td>{rateLabel}</td>
                      <td>{row.unexcused ?? 0}</td>
                      <td>{modelLabel}</td>
                      <td>{dailyLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!studentListMetricsLoaded && !studentListLoading ? (
            <div className="admin-help" style={{ marginTop: 6 }}>
              Metrics are not loaded yet. Click <b>Load Metrics</b> to calculate attendance and test averages.
            </div>
          ) : null}
          {!studentWarningsLoaded && !studentWarningsLoading ? (
            <div className="admin-help" style={{ marginTop: 6 }}>
              Warnings are not loaded yet. Click <b>Load Warnings</b> to show warning badges and warning history.
            </div>
          ) : null}
          {studentListLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading metrics...</div> : null}
          {studentWarningsLoading ? <div className="admin-help" style={{ marginTop: 6 }}>Loading warnings...</div> : null}
          <div className="admin-msg">{studentMsg}</div>

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="admin-help">
              CSV: <b>email,display_name,student_code,temp_password</b>
            </div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => handleCsvFile(e.target.files?.[0])}
            />
            <div className="admin-help">{csvMsg}</div>
          </div>
        </>
      ) : null}

      {selectedStudentId && studentDetailOpen ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="admin-icon-btn"
                  onClick={() => {
                    setSelectedStudentId("");
                    setStudentDetailOpen(false);
                  }}
                  aria-label="Back"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                    <path
                      d="m15 6-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="admin-title">
                  {selectedStudent?.display_name ?? ""} {selectedStudent?.student_code ? `(${selectedStudent.student_code})` : ""}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn student-detail-action-btn"
                onClick={exportStudentReportPdf}
                disabled={studentReportExporting || studentDetailLoading}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M10 3v8m0 0 3-3m-3 3-3-3M4 13.5v1.25C4 15.44 4.56 16 5.25 16h9.5c.69 0 1.25-.56 1.25-1.25V13.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {studentReportExporting ? "Exporting..." : "Export PDF"}
              </button>
              <button
                className="btn student-detail-action-btn"
                onClick={() => {
                  if (!selectedStudent) return;
                  setReissueStudent(selectedStudent);
                  setReissuePassword("");
                  setReissueIssuedPassword("");
                  setReissueLoading(false);
                  setReissueMsg("");
                  setReissueOpen(true);
                }}
              >
                Reissue Temp Pass
              </button>
              <div className="student-detail-toggle-card">
                <span className="student-detail-toggle-label">Test Account</span>
                <label className="daily-session-create-switch" aria-label="Test Account">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedStudent?.is_test_account)}
                    onChange={(event) => {
                      if (!selectedStudent) return;
                      toggleTestAccount(selectedStudent, event.target.checked);
                    }}
                  />
                  <span className="daily-session-create-switch-slider" />
                </label>
              </div>
              <button
                className={`btn student-detail-action-btn ${selectedStudent?.is_withdrawn ? "btn-withdrawn" : ""}`}
                onClick={() => {
                  if (!selectedStudent) return;
                  toggleWithdrawn(selectedStudent, !selectedStudent.is_withdrawn);
                }}
              >
                {selectedStudent?.is_withdrawn ? "Withdrawn" : "Withdraw"}
              </button>
              <button
                className="btn btn-danger student-detail-action-btn"
                onClick={() => {
                  if (!selectedStudent) return;
                  deleteStudent(selectedStudent.id, selectedStudent.email);
                }}
              >
                Delete
              </button>
            </div>
          </div>

          <div className="student-detail-tab-row">
            <div className="admin-top-tabs student-detail-tabs">
              <button className={`admin-top-tab ${selectedStudentTab === "information" ? "active" : ""}`} onClick={() => setSelectedStudentTab("information")}>
                Information
              </button>
              <button
                className={`admin-top-tab ${selectedStudentTab === "attendance" ? "active" : ""}`}
                onClick={() => {
                  setSelectedStudentTab("attendance");
                  fetchStudentAttendance(selectedStudentId);
                }}
              >
                Attendance
              </button>
              <button
                className={`admin-top-tab ${selectedStudentTab === "daily" ? "active" : ""}`}
                onClick={() => {
                  setSelectedStudentTab("daily");
                  fetchStudentAttempts(selectedStudentId);
                }}
              >
                Daily Test
              </button>
              <button
                className={`admin-top-tab ${selectedStudentTab === "model" ? "active" : ""}`}
                onClick={() => {
                  setSelectedStudentTab("model");
                  fetchStudentAttempts(selectedStudentId);
                }}
              >
                Model Test
              </button>
            </div>
          </div>

          {selectedStudentTab === "information" ? (
            <div className="student-info-panel" style={{ marginTop: 12 }}>
              <div className="student-info-panel-header">
                <div>
                  <div className="admin-title">Personal Information</div>
                  <div className="admin-subtitle">Shared student profile data visible from both student and admin portals.</div>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={studentDetailLoading || !hasStudentDetailFields(selectedStudent)}
                  onClick={() => {
                    setCoreStudentInfoForm(getPersonalInfoForm(selectedStudent));
                    setCoreStudentInfoUploadFiles({});
                    setCoreStudentInfoMsg("");
                    setCoreStudentInfoOpen(true);
                  }}
                >
                  Edit Information
                </button>
              </div>
              {studentDetailLoading ? <div className="admin-help" style={{ marginTop: 10 }}>Loading full student details...</div> : null}
              {studentDetailMsg ? <div className="admin-msg">{studentDetailMsg}</div> : null}
              <div className="student-info-grid admin-student-info-grid">
                {[
                  { label: "Full Name", value: selectedStudent?.display_name || "-" },
                  { label: "Email", value: selectedStudent?.email || "-" },
                  { label: "Student No.", value: selectedStudent?.student_code || "-" },
                  { label: "Phone Number", value: selectedStudent?.phone_number || "-" },
                  {
                    label: "Date of Birth",
                    value: selectedStudent?.date_of_birth
                      ? `${formatDateFull(selectedStudent.date_of_birth)}${calculateAge(selectedStudent.date_of_birth) != null ? ` • Age ${calculateAge(selectedStudent.date_of_birth)}` : ""}`
                      : "-"
                  },
                  { label: "Sex", value: selectedStudent?.sex || "-" },
                  { label: "Current Working Facility", value: selectedStudent?.current_working_facility || "-" },
                  { label: "Years of Experience", value: formatYearsOfExperience(selectedStudent?.years_of_experience) || "-" },
                  { label: "Nursing Certificate", value: selectedStudent?.nursing_certificate || "-" },
                  { label: "Certificate Status", value: selectedStudent?.nursing_certificate_status || "-" },
                  { label: "BNMC Registration Number", value: selectedStudent?.bnmc_registration_number || "-" },
                  {
                    label: "BNMC Registration Expiry Date",
                    value: selectedStudent?.bnmc_registration_expiry_date
                      ? formatDateFull(selectedStudent.bnmc_registration_expiry_date)
                      : "-"
                  },
                  { label: "Passport Number", value: selectedStudent?.passport_number || "-" },
                  ...PERSONAL_UPLOAD_FIELDS.map((field) => ({
                    label: field.label,
                    value: renderProfileUpload(getProfileUploads(selectedStudent?.profile_uploads)[field.key], field.label),
                    wide: true,
                  })),
                ].map((item) => (
                  <div key={item.label} className={`student-info-row ${item.wide ? "student-info-row-wide" : ""}`}>
                    <div className="student-info-label">{item.label}</div>
                    <div className="student-info-value">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedStudentTab === "model" ? (
            <>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Average Score</th>
                      <th>Average Rate</th>
                      <th>Pass</th>
                      <th>Fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentModelCategorySummaryRows.length ? studentModelCategorySummaryRows.map((row) => (
                      <tr key={`student-model-summary-${row.category}`}>
                        <td>{row.category}</td>
                        <td>{row.averageScoreLabel}</td>
                        <td>{row.averageRateLabel}</td>
                        <td>{row.passCount}</td>
                        <td>{row.failCount}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5}>No model test records.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 980 }}>
                  <thead>
                    <tr>
                      <th>Test</th>
                      <th>Date</th>
                      <th>Total Score</th>
                      <th>Rate</th>
                      <th>P/F</th>
                      <th>Class Rank</th>
                      {sectionTitles.map((title) => (
                        <th key={`sec-${title}`} className="admin-table-compact">
                          {renderTwoLineHeader(title)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {studentModelAttempts.map((a) => {
                      const score = `${a.correct}/${a.total}`;
                      const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                      const passRate = getAttemptEffectivePassRate(a);
                      const passed = getScoreRate(a) >= passRate;
                      const rankInfo = studentAttemptRanks[a.id];
                      const summary = studentAttemptSummaryById[a.id] || {};
                      return (
                        <tr key={`student-model-${a.id}`} onClick={() => openAttemptDetail(a)}>
                          <td>{getAttemptTitle(a)}</td>
                          <td>{formatDateFull(getAttemptDisplayDateValue(a))}</td>
                          <td>{score}</td>
                          <td>{rate}</td>
                          <td><span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span></td>
                          <td>{rankInfo ? `${rankInfo.rank}/${rankInfo.total}` : "-"}</td>
                          {sectionTitles.map((title) => {
                            const s = summary[title];
                            return (
                              <td key={`${a.id}-${title}`} className="admin-table-compact">
                                {s ? `${s.correct}/${s.total}` : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="admin-msg">{studentAttemptsMsg}</div>
            </>
          ) : null}

          {selectedStudentTab === "daily" ? (
            <>
              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Average Score</th>
                      <th>Average Rate</th>
                      <th>Pass</th>
                      <th>Fail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentDailyCategorySummaryRows.length ? studentDailyCategorySummaryRows.map((row) => (
                      <tr key={`student-daily-summary-${row.category}`}>
                        <td>{row.category}</td>
                        <td>{row.averageScoreLabel}</td>
                        <td>{row.averageRateLabel}</td>
                        <td>{row.passCount}</td>
                        <td>{row.failCount}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5}>No daily test records.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {studentDailyAttemptsByCategory.map(([category, items]) => (
                <div key={`daily-${category}`} style={{ marginTop: 12 }}>
                  <div className="admin-subtitle" style={{ fontWeight: 900 }}>{category}</div>
                  <div className="admin-table-wrap" style={{ marginTop: 8 }}>
                    <table className="admin-table" style={{ minWidth: 820 }}>
                      <thead>
                        <tr>
                          <th>Test</th>
                          <th>Date</th>
                          <th>Score</th>
                          <th>Rate</th>
                          <th>P/F</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((a) => {
                          const score = `${a.correct}/${a.total}`;
                          const rate = `${(getScoreRate(a) * 100).toFixed(1)}%`;
                          const passRate = getAttemptEffectivePassRate(a);
                          const passed = getScoreRate(a) >= passRate;
                          return (
                            <tr key={`student-daily-${a.id}`} onClick={() => openAttemptDetail(a)}>
                              <td>{getAttemptTitle(a)}</td>
                              <td>{formatDateFull(getAttemptDisplayDateValue(a))}</td>
                              <td>{score}</td>
                              <td>{rate}</td>
                              <td><span className={passed ? "pf-pass" : "pf-fail"}>{passed ? "Pass" : "Fail"}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <div className="admin-msg">{studentAttemptsMsg}</div>
            </>
          ) : null}

          {selectedStudentTab === "attendance" ? (
            <>
              <div className="student-attendance-summary-section" style={{ marginTop: 10 }}>
                <div className="student-attendance-summary-top">
                  <div className="student-attendance-pie-panel">
                    <div className="student-attendance-month-bar">
                      <button
                        className="student-attendance-month-nav"
                        type="button"
                        onClick={() => studentAttendancePrevMonthKey && setStudentAttendanceMonthKey(studentAttendancePrevMonthKey)}
                        disabled={!studentAttendancePrevMonthKey}
                        aria-label="Previous month"
                      >
                        ‹
                      </button>
                      <div className="student-attendance-month-label">
                        <select
                          className="student-attendance-month-select"
                          value={selectedStudentAttendanceMonth.key}
                          onChange={(e) => setStudentAttendanceMonthKey(e.target.value)}
                        >
                          {studentAttendanceMonthOptions.map((option) => (
                            <option key={`student-attendance-month-${option.key}`} value={option.key}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        className="student-attendance-month-nav"
                        type="button"
                        onClick={() => studentAttendanceNextMonthKey && setStudentAttendanceMonthKey(studentAttendanceNextMonthKey)}
                        disabled={!studentAttendanceNextMonthKey}
                        aria-label="Next month"
                      >
                        ›
                      </button>
                    </div>

                    <div className="student-attendance-pie-wrap">
                      <div className="student-attendance-pie" style={{ "--pie-bg": `conic-gradient(${studentAttendancePie.pieStops})` }}>
                        <div className="student-attendance-pie-labels">
                          {studentAttendancePie.pieLabels.map((item) => (
                            <span
                              key={`student-attendance-pie-${item.key}`}
                              className="student-attendance-pie-label"
                              style={{ "--x": `${item.x.toFixed(1)}px`, "--y": `${item.y.toFixed(1)}px` }}
                            >
                              {item.label}
                            </span>
                          ))}
                        </div>
                        <div className="student-attendance-pie-center">
                          <div className="student-attendance-rate">{studentAttendancePie.rateValue.toFixed(1)}%</div>
                          <div className="student-attendance-rate-label">Attendance Rate</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="admin-table-wrap">
                    <table className="admin-table" style={{ minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Overall</th>
                          {attendanceSummary.months.map((m) => (
                            <th key={m.key}>{m.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Attendance %</td>
                          <td>{attendanceSummary.overall.rate == null ? "N/A" : `${attendanceSummary.overall.rate.toFixed(2)}%`}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-rate`}>{m.stats.rate == null ? "N/A" : `${m.stats.rate.toFixed(2)}%`}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Total Days</td>
                          <td>{attendanceSummary.overall.total || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-total`}>{m.stats.total || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Present (P)</td>
                          <td>{attendanceSummary.overall.present || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-present`}>{m.stats.present || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Late/Left Early (L)</td>
                          <td>{attendanceSummary.overall.late || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-late`}>{m.stats.late || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Excused Absence (E)</td>
                          <td>{attendanceSummary.overall.excused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-excused`}>{m.stats.excused || "-"}</td>
                          ))}
                        </tr>
                        <tr>
                          <td>Unexcused Absence (A)</td>
                          <td>{attendanceSummary.overall.unexcused || "-"}</td>
                          {attendanceSummary.months.map((m) => (
                            <td key={`${m.key}-unexcused`}>{m.stats.unexcused || "-"}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="admin-form" style={{ marginTop: 10 }}>
                <div className="field small">
                  <label>From</label>
                  <input type="date" value={studentAttendanceRange.from} onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, from: e.target.value }))} />
                </div>
                <div className="field small">
                  <label>To</label>
                  <input type="date" value={studentAttendanceRange.to} onChange={(e) => setStudentAttendanceRange((s) => ({ ...s, to: e.target.value }))} />
                </div>
                <div className="field small">
                  <label>&nbsp;</label>
                  <button className="btn" type="button" onClick={() => setStudentAttendanceRange({ from: "", to: "" })}>
                    Clear
                  </button>
                </div>
              </div>

              <div className="admin-table-wrap" style={{ marginTop: 10 }}>
                <table className="admin-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudentAttendance.map((r, idx) => (
                      <tr key={`att-row-${idx}`}>
                        <td>{`${formatDateShort(r.day_date)} (${formatWeekday(r.day_date)})`}</td>
                        <td>{r.status}</td>
                        <td>{r.comment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-msg">{studentAttendanceMsg}</div>
            </>
          ) : null}
        </div>
      ) : null}

      {studentWarningIssueOpen ? (
        <div className="admin-modal-overlay" onClick={() => setStudentWarningIssueOpen(false)}>
          <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">Warnings</div>
              <button className="admin-modal-close" onClick={() => setStudentWarningIssueOpen(false)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="student-warning-history" style={{ marginTop: 10 }}>
              <div className="student-warning-history-head">
                <div className="admin-title" style={{ fontSize: 18 }}>Issued Warnings</div>
                {studentWarningsLoading ? <div className="admin-help">Loading warnings...</div> : null}
              </div>
              <div className="student-warning-history-list">
                {studentWarnings.map((warning) => {
                  const summary = summarizeWarningCriteria(warning.criteria);
                  return (
                    <button key={warning.id} type="button" className="student-warning-card" onClick={() => setSelectedStudentWarning(warning)}>
                      <div className="student-warning-card-title">{warning.title || "Warning"}</div>
                      <div className="student-warning-card-meta">
                        {formatDateTime(warning.created_at)} · {warning.student_count || warning.recipients?.length || 0} student{(warning.student_count || warning.recipients?.length || 0) === 1 ? "" : "s"}
                      </div>
                      <div className="student-warning-card-summary">
                        {(summary.length ? summary : ["No criteria summary"]).join(" / ")}
                      </div>
                    </button>
                  );
                })}
                {!studentWarningsLoading && !studentWarnings.length ? (
                  <div className="admin-help">No warnings issued yet.</div>
                ) : null}
              </div>
              {studentWarningsMsg ? <div className="admin-msg">{studentWarningsMsg}</div> : null}
            </div>
            <div className="admin-title" style={{ fontSize: 18, marginTop: 14 }}>Create Warning</div>
            <div className="admin-form" style={{ marginTop: 10, gridTemplateColumns: "1fr" }}>
              <div className="field">
                <label>Title (optional)</label>
                <input value={studentWarningForm.title} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Warning title" />
              </div>
              <div className="field">
                <label>Date From</label>
                <input type="date" value={studentWarningForm.from} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, from: e.target.value }))} />
              </div>
              <div className="field">
                <label>Date To</label>
                <input type="date" value={studentWarningForm.to} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, to: e.target.value }))} />
              </div>
              <div className="field">
                <label>Attendance % (≤)</label>
                <input type="number" min="0" max="100" value={studentWarningForm.maxAttendance} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxAttendance: e.target.value }))} />
              </div>
              <div className="field">
                <label>Unexcused (≥)</label>
                <input type="number" min="0" value={studentWarningForm.minUnexcused} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, minUnexcused: e.target.value }))} />
              </div>
              <div className="field">
                <label>Model Avg % (≤)</label>
                <input type="number" min="0" max="100" value={studentWarningForm.maxModelAvg} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxModelAvg: e.target.value }))} />
              </div>
              <div className="field">
                <label>Daily Avg % (≤)</label>
                <input type="number" min="0" max="100" value={studentWarningForm.maxDailyAvg} onChange={(e) => setStudentWarningForm((prev) => ({ ...prev, maxDailyAvg: e.target.value }))} />
              </div>
            </div>
            <div className="admin-help" style={{ marginTop: 10 }}>
              Students are included if they match any selected warning threshold.
            </div>
            {studentWarningIssueMsg ? <div className="admin-msg">{studentWarningIssueMsg}</div> : null}
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={issueStudentWarningCtx} disabled={studentWarningIssueSaving}>
                {studentWarningIssueSaving ? "Issuing..." : "Issue Warning"}
              </button>
              <button className="btn" onClick={() => setStudentWarningForm(getDefaultStudentWarningForm(studentListFilters))}>
                Reset
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedStudentWarning ? (
        <div className="admin-modal-overlay" onClick={() => setSelectedStudentWarning(null)}>
          <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <div className="admin-title">{selectedStudentWarning.title || "Warning"}</div>
                <div className="admin-help" style={{ marginTop: 6 }}>
                  {formatDateTime(selectedStudentWarning.created_at)} · {selectedStudentWarning.student_count || selectedStudentWarning.recipients?.length || 0} student{(selectedStudentWarning.student_count || selectedStudentWarning.recipients?.length || 0) === 1 ? "" : "s"}
                </div>
              </div>
              <button className="admin-modal-close" onClick={() => setSelectedStudentWarning(null)} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="admin-help" style={{ marginTop: 10 }}>
              {(summarizeWarningCriteria(selectedStudentWarning.criteria).length
                ? summarizeWarningCriteria(selectedStudentWarning.criteria)
                : ["No criteria summary"]
              ).join(" / ")}
            </div>
            <div className="admin-table-wrap" style={{ marginTop: 12 }}>
              <table className="admin-table" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Student<br />No.</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedStudentWarning.recipients ?? []).map((recipient) => {
                    const student = students.find((item) => item.id === recipient.student_id) ?? null;
                    return (
                      <tr key={`warning-recipient-${recipient.id}`}>
                        <td>{student?.student_code ?? ""}</td>
                        <td>{student?.display_name ?? recipient.student_id}</td>
                        <td>{student?.email ?? ""}</td>
                        <td>{(recipient.issues ?? []).join(" / ") || "-"}</td>
                      </tr>
                    );
                  })}
                  {!(selectedStudentWarning.recipients ?? []).length ? (
                    <tr><td colSpan={4}>No recipients found.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
              <button
                className="btn btn-danger"
                onClick={() => deleteStudentWarningCtx(selectedStudentWarning)}
                disabled={studentWarningDeletingId === selectedStudentWarning.id}
              >
                {studentWarningDeletingId === selectedStudentWarning.id ? "Deleting..." : "Delete Warning"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {studentWarningPreviewStudentId ? (
        <div className="admin-modal-overlay" onClick={() => setStudentWarningPreviewStudentId("")}>
          <div className="admin-modal invite-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <div className="admin-title">Applied Warnings</div>
                <div className="admin-help" style={{ marginTop: 6 }}>
                  {studentWarningPreviewStudent?.display_name || studentWarningPreviewStudent?.email || studentWarningPreviewStudentId}
                </div>
              </div>
              <button className="admin-modal-close" onClick={() => setStudentWarningPreviewStudentId("")} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="student-warning-history-list" style={{ marginTop: 12 }}>
              {studentWarningPreviewEntries.map(({ warning, recipient }) => {
                const summary = summarizeWarningCriteria(warning.criteria);
                return (
                  <button
                    key={`student-warning-preview-${warning.id}-${recipient.id}`}
                    type="button"
                    className="student-warning-card"
                    onClick={() => {
                      setStudentWarningPreviewStudentId("");
                      setSelectedStudentWarning(warning);
                    }}
                  >
                    <div className="student-warning-card-title">{warning.title || "Warning"}</div>
                    <div className="student-warning-card-meta">{formatDateTime(warning.created_at)}</div>
                    <div className="student-warning-card-summary">
                      {(recipient.issues ?? []).join(" / ") || (summary.length ? summary.join(" / ") : "No criteria summary")}
                    </div>
                  </button>
                );
              })}
              {!studentWarningPreviewEntries.length ? (
                <div className="admin-help">No warnings found for this student.</div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {attemptDetailOpen ? (
        <LazyAdminConsoleResultsWorkspace
          supabase={supabase}
          resultContext={null}
          sessionDetail={{ type: "", sessionId: "" }}
          students={students}
          testMetaByVersion={testMetaByVersion}
          attemptCanOpenDetail={attemptCanOpenDetail}
          openAttemptDetail={openAttemptDetail}
          formatDateTime={formatDateTime}
          getAttemptTitle={getAttemptTitle}
          getTabLeftCount={getTabLeftCount}
          getScoreRate={getScoreRate}
          renderTwoLineHeader={renderTwoLineHeader}
          attemptDetailOpen={attemptDetailOpen}
          selectedAttempt={selectedAttempt}
          selectedAttemptRows={selectedAttemptRows}
          selectedAttemptScoreRate={selectedAttemptScoreRate}
          studentAttemptRanks={studentAttemptRanks}
          attemptDetailSource={attemptDetailSource}
          selectedAttemptUsesImportedSummary={selectedAttemptUsesImportedSummary}
          selectedAttemptUsesImportedModelSummary={selectedAttemptUsesImportedModelSummary}
          selectedAttemptMainSectionSummary={selectedAttemptMainSectionSummary}
          setAttemptDetailOpen={setAttemptDetailOpen}
          setSelectedAttemptObj={setSelectedAttemptObj}
          setAttemptDetailSource={setAttemptDetailSource}
          attemptQuestionsLoading={attemptQuestionsLoading}
          attemptQuestionsError={attemptQuestionsError}
          attemptDetailTab={attemptDetailTab}
          setAttemptDetailTab={setAttemptDetailTab}
          selectedAttemptIsPass={selectedAttemptIsPass}
          selectedAttemptIsModel={selectedAttemptIsModel}
          selectedAttemptNestedSectionSummary={selectedAttemptNestedSectionSummary}
          selectedAttemptPassRate={selectedAttemptPassRate}
          selectedAttemptSectionSummary={selectedAttemptSectionSummary}
          selectedAttemptQuestionSectionsFiltered={selectedAttemptQuestionSectionsFiltered}
          attemptDetailSectionRefs={attemptDetailSectionRefs}
          attemptDetailWrongOnly={attemptDetailWrongOnly}
          setAttemptDetailWrongOnly={setAttemptDetailWrongOnly}
          exportSelectedAttemptCsv={exportSelectedAttemptCsv}
          deleteAttempt={deleteAttemptRecord}
          previewOpen={false}
        />
      ) : null}
    </div>
  );
}
