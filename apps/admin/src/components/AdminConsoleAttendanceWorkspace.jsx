"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useAttendanceWorkspaceState } from "./AdminConsoleAttendanceWorkspaceState";

function formatDateShortFn(d) {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length === 3) {
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    // Validate that day is between 1-31 to catch invalid dates like 3/32
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return `INVALID: ${month}/${day}`;
    }
    return `${month}/${day}`;
  }
  return "";
}

function formatWeekdayFn(d) {
  if (!d) return "";
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
}

export default function AdminConsoleAttendanceWorkspace() {
  const { activeSchoolId, supabase, session, students, fetchStudents, exportAttendanceGoogleSheetsCsv, importAttendanceGoogleSheetsCsv, formatRatePercent, formatDateTime, isAnalyticsExcludedStudent, attendanceSubTab, setAttendanceSubTab, openAttendanceDay: openAttendanceDayCtx } = useAdminConsoleWorkspaceContext();
  const [absenceApplicationFilter, setAbsenceApplicationFilter] = useState({
    studentId: "all",
    type: "all",
  });
  const [absenceApplicationFilterOpen, setAbsenceApplicationFilterOpen] = useState(false);
  const [attendanceFilterOpen, setAttendanceFilterOpen] = useState(false);

  const {
    attendanceMsg,
    attendanceDate,
    setAttendanceDate,
    openAttendanceDay,
    attendanceImportInputRef,
    attendanceFilter,
    setAttendanceFilter,
    fetchAttendanceDays,
    goToPreviousMonth,
    goToNextMonth,
    attendanceViewMonthLabel,
    hasNextMonthAttendance,
    attendanceSheetRefreshing,
    attendanceSheetNeedsInitialRefresh,
    setAttendanceSheetNeedsInitialRefresh,
    fetchAbsenceApplications,
    absenceApplications,
    decideAbsenceApplication,
    openDenyAbsenceApplication,
    closeDenyAbsenceApplication,
    confirmDenyAbsenceApplication,
    denyApplicationModal,
    setDenyApplicationModal,
    absenceApplicationsMsg,
    buildAttendanceStats,
    getAttendanceStatusClassName,
    deleteAttendanceDay,
    attendanceModalDay,
    // Memos from hook
    attendanceDayColumns,
    attendanceRangeColumns,
    attendanceEntriesByDay,
    attendanceFilteredStudents,
    attendanceDayRates,
    attendanceStudentRowsById,
    attendanceSheetHydrated,
  } = useAttendanceWorkspaceState({ supabase, activeSchoolId, session, students, attendanceSubTab, setAttendanceSubTab, isAnalyticsExcludedStudent, formatDateShort: formatDateShortFn, formatWeekday: formatWeekdayFn, openAttendanceDayCtx });

  useEffect(() => {
    setAbsenceApplicationFilter({
      studentId: "all",
      type: "all",
    });
    setAbsenceApplicationFilterOpen(false);
    setAttendanceFilterOpen(false);
  }, [activeSchoolId]);

  const absenceApplicationStudentOptions = useMemo(() => {
    const seen = new Map();
    (absenceApplications ?? []).forEach((application) => {
      const student = application?.profiles || {};
      const studentId = String(application?.student_id ?? "").trim();
      if (!studentId || seen.has(studentId)) return;
      const name = String(student.display_name || student.email || studentId || "Student").trim();
      const code = student.student_code ? ` (${student.student_code})` : "";
      seen.set(studentId, {
        value: studentId,
        label: `${name}${code}`,
      });
    });
    return Array.from(seen.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [absenceApplications]);

  const filteredAbsenceApplications = useMemo(() => {
    const selectedStudentId = absenceApplicationFilter.studentId;
    const selectedType = absenceApplicationFilter.type;
    return (absenceApplications ?? []).filter((application) => {
      if (selectedStudentId !== "all" && String(application?.student_id ?? "") !== selectedStudentId) {
        return false;
      }
      if (selectedType !== "all" && String(application?.type ?? "") !== selectedType) {
        return false;
      }
      return true;
    });
  }, [absenceApplications, absenceApplicationFilter.studentId, absenceApplicationFilter.type]);

  const hasAttendanceFilterValue = useMemo(() => (
    Boolean(
      attendanceFilter.minRate
      || attendanceFilter.minAbsences
      || attendanceFilter.startDate
      || attendanceFilter.endDate
    )
  ), [attendanceFilter.endDate, attendanceFilter.minAbsences, attendanceFilter.minRate, attendanceFilter.startDate]);

  const hasAbsenceApplicationFilterValue = useMemo(() => (
    Boolean(
      absenceApplicationFilter.studentId !== "all"
      || absenceApplicationFilter.type !== "all"
    )
  ), [absenceApplicationFilter.studentId, absenceApplicationFilter.type]);

  useEffect(() => {
    if (!activeSchoolId) return;
    if (attendanceSubTab === "sheet") {
      if (!students.length) {
        fetchStudents();
      }
      if (!attendanceSheetHydrated && !attendanceSheetRefreshing) {
        setAttendanceSheetNeedsInitialRefresh(false);
        fetchAttendanceDays({ force: true, initialRefresh: true });
      }
      return;
    }
    fetchAbsenceApplications();
  }, [activeSchoolId, attendanceSubTab, students.length, attendanceSheetHydrated, attendanceSheetRefreshing]);

  if (attendanceSubTab === "absence") {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div className="admin-title">Absence Applications</div>
            <div className="admin-subtitle">Review and approve/deny student applications.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className={`btn admin-icon-action-btn attendance-filter-toggle-btn ${absenceApplicationFilterOpen || hasAbsenceApplicationFilterValue ? "active" : ""}`}
              type="button"
              aria-label={absenceApplicationFilterOpen ? "Hide absence application filters" : "Show absence application filters"}
              aria-expanded={absenceApplicationFilterOpen}
              title={absenceApplicationFilterOpen ? "Hide filters" : hasAbsenceApplicationFilterValue ? "Show filters (active)" : "Show filters"}
              onClick={() => setAbsenceApplicationFilterOpen((current) => !current)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M4 5.5h12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="8" cy="5.5" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M4 10h12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="12.25" cy="10" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M4 14.5h12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="6.5" cy="14.5" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              {(absenceApplicationFilterOpen || hasAbsenceApplicationFilterValue) ? (
                <span className="attendance-filter-toggle-indicator" aria-hidden="true" />
              ) : null}
            </button>
            <button
              className="btn admin-icon-action-btn"
              aria-label="Refresh absence applications"
              title="Refresh absence applications"
              onClick={() => fetchAbsenceApplications()}
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
            </button>
          </div>
        </div>

        {absenceApplicationFilterOpen ? (
          <div style={{ marginTop: 18 }}>
            <div className="admin-form attendance-filter-box">
              <div className="field small">
                <label className="attendance-filter-label">Student Name</label>
                <select
                  value={absenceApplicationFilter.studentId}
                  onChange={(event) =>
                    setAbsenceApplicationFilter((current) => ({
                      ...current,
                      studentId: event.target.value,
                    }))
                  }
                >
                  <option value="all">All</option>
                  {absenceApplicationStudentOptions.map((student) => (
                    <option key={student.value} value={student.value}>
                      {student.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field small">
                <label className="attendance-filter-label">Type</label>
                <select
                  value={absenceApplicationFilter.type}
                  onChange={(event) =>
                    setAbsenceApplicationFilter((current) => ({
                      ...current,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="all">All</option>
                  <option value="excused">Excused Absence</option>
                  <option value="late">Late/Leave Early</option>
                </select>
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    setAbsenceApplicationFilter({
                      studentId: "all",
                      type: "all",
                    })
                  }
                >
                  Clear Filter
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Student</th>
                <th>Type</th>
                <th>Date</th>
                <th>Time</th>
                <th>Reason</th>
                <th>Catch Up</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredAbsenceApplications.map((a) => {
                const student = a.profiles || {};
                const name = student.display_name || student.email || a.student_id;
                const code = student.student_code ? ` (${student.student_code})` : "";
                const typeLabel = a.type === "excused" ? "Excused Absence" : "Late/Leave Early";
                const timeLabel =
                  a.type === "late"
                    ? `${a.late_type === "leave_early" ? "Leave" : "Arrive"}: ${a.time_value || "-"}`
                    : "";
                return (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.created_at)}</td>
                    <td>{name}{code}</td>
                    <td>{typeLabel}</td>
                    <td>{a.day_date}</td>
                    <td>{timeLabel}</td>
                        <td>{a.reason || ""}</td>
                        <td>{a.catch_up || ""}</td>
                        <td>{a.status}</td>
                        <td>
                          {a.status === "pending" ? (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button className="btn btn-primary" onClick={() => decideAbsenceApplication(a.id, "approved")}>
                                Approve
                              </button>
                              <button className="btn btn-danger" onClick={() => openDenyAbsenceApplication(a)}>
                                Deny
                              </button>
                            </div>
                          ) : (
                            "-"
                          )}
                    </td>
                  </tr>
                );
              })}
              {!absenceApplicationsMsg && absenceApplications.length > 0 && filteredAbsenceApplications.length === 0 ? (
                <tr>
                  <td colSpan={9}>No absence applications match the selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="admin-msg">{absenceApplicationsMsg}</div>
        {denyApplicationModal.open && typeof document !== "undefined"
          ? createPortal(
            <div
              className="admin-modal-overlay"
              onClick={closeDenyAbsenceApplication}
              role="presentation"
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">Deny Application</div>
                  <button
                    className="admin-modal-close"
                    type="button"
                    aria-label="Close"
                    onClick={closeDenyAbsenceApplication}
                    disabled={denyApplicationModal.saving}
                  >
                    ×
                  </button>
                </div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="admin-subtitle">
                    Comment is optional and will be shown to the student.
                  </div>
                  <div className="admin-help">
                    <div>
                      <strong>Student:</strong>{" "}
                      {String(denyApplicationModal.application?.profiles?.display_name || denyApplicationModal.application?.student_id || "Student")}
                    </div>
                    <div>
                      <strong>Date:</strong> {String(denyApplicationModal.application?.day_date || "")}
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="admin-help">Comment (optional)</span>
                    <textarea
                      value={denyApplicationModal.comment}
                      onChange={(e) =>
                        setDenyApplicationModal((current) => ({
                          ...current,
                          comment: e.target.value,
                        }))
                      }
                      rows={4}
                      placeholder="Add a note for the student, or leave blank."
                      style={{
                        width: "100%",
                        minHeight: 110,
                        resize: "vertical",
                        border: "1px solid var(--admin-control-border)",
                        borderRadius: 8,
                        padding: "10px 12px",
                        font: "inherit",
                        fontSize: 14,
                      }}
                      disabled={denyApplicationModal.saving}
                    />
                  </label>
                  {denyApplicationModal.msg ? (
                    <div className="admin-msg">{denyApplicationModal.msg}</div>
                  ) : null}
                </div>
                <div className="admin-modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <button className="btn" type="button" onClick={closeDenyAbsenceApplication} disabled={denyApplicationModal.saving}>
                    Cancel
                  </button>
                  <button className="btn btn-danger" type="button" onClick={confirmDenyAbsenceApplication} disabled={denyApplicationModal.saving}>
                    {denyApplicationModal.saving ? "Denying..." : "Deny"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
          : null}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "nowrap", marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flex: "0 0 auto" }}>
          <div>
            <label style={{ display: "block", fontWeight: 800, marginBottom: 6, color: "var(--admin-text)" }}>Date</label>
            <input
              type="date"
              value={attendanceDate}
              onChange={(e) => setAttendanceDate(e.target.value)}
              style={{
                width: 190,
                border: "1px solid var(--admin-control-border)",
                borderRadius: 6,
                padding: "10px 10px",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            />
          </div>
          <button className="btn btn-primary attendance-open-day-btn" type="button" onClick={() => {
            if (!attendanceDate) {
              alert("Please select a date first");
              return;
            }
            openAttendanceDay(attendanceDate, { confirmExisting: true }).catch((err) => {
              console.error("Open day error:", err);
              alert(`Failed to open day: ${err?.message || "Unknown error"}`);
            });
          }}>
            Open Day
          </button>
          <button
            className={`btn admin-icon-action-btn attendance-filter-toggle-btn ${attendanceFilterOpen || hasAttendanceFilterValue ? "active" : ""}`}
            type="button"
            aria-label={attendanceFilterOpen ? "Hide attendance filters" : "Show attendance filters"}
            aria-expanded={attendanceFilterOpen}
            title={attendanceFilterOpen ? "Hide filters" : hasAttendanceFilterValue ? "Show filters (active)" : "Show filters"}
            onClick={() => setAttendanceFilterOpen((current) => !current)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M4 5.5h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="5.5" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M4 10h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12.25" cy="10" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M4 14.5h12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="6.5" cy="14.5" r="1.7" fill="#fff" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            {(attendanceFilterOpen || hasAttendanceFilterValue) ? (
              <span className="attendance-filter-toggle-indicator" aria-hidden="true" />
            ) : null}
          </button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "nowrap", justifyContent: "flex-end", marginLeft: "auto", alignSelf: "flex-start", flex: "0 0 auto", alignItems: "center" }}>
          <button
            className="btn admin-icon-action-btn"
            type="button"
            aria-label="Refresh attendance sheet"
            title="Refresh attendance sheet"
            disabled={attendanceSheetRefreshing}
            aria-busy={attendanceSheetRefreshing}
            onClick={() => {
              if (!students.length) {
                fetchStudents();
              }
              fetchAttendanceDays({ force: true });
            }}
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
          </button>
          <button className="btn results-page-action-btn" type="button" onClick={exportAttendanceGoogleSheetsCsv}>
            <span className="results-page-action-icon" aria-hidden="true">↓</span>
            <span>Export CSV</span>
          </button>
          <button
            className="btn results-page-action-btn"
            type="button"
            onClick={() => attendanceImportInputRef.current?.click()}
          >
            <span className="results-page-action-icon" aria-hidden="true">↑</span>
            <span>Import CSV</span>
          </button>
          <input
            ref={attendanceImportInputRef}
            type="file"
            accept=".csv,.tsv"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              importAttendanceGoogleSheetsCsv(file);
            }}
          />
        </div>
      </div>

      {attendanceFilterOpen ? (
        <div style={{ marginTop: 18 }}>
          <div className="admin-form attendance-filter-box">
            <div className="field small">
              <label className="attendance-filter-label">Filter (Rate &lt;)</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 80"
                value={attendanceFilter.minRate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minRate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Filter (Unexcused ≥)</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 3"
                value={attendanceFilter.minAbsences}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minAbsences: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Range From</label>
              <input
                type="date"
                value={attendanceFilter.startDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">Range To</label>
              <input
                type="date"
                value={attendanceFilter.endDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, endDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label>&nbsp;</label>
              <button
                className="btn"
                type="button"
                onClick={() => setAttendanceFilter({ minRate: "", minAbsences: "", startDate: "", endDate: "" })}
              >
                Clear Filter
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 12, marginBottom: 3, minHeight: 38 }}>
        {attendanceSheetRefreshing ? (
          <div
            style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 8, color: "var(--admin-text)" }}
            aria-live="polite"
          >
            <svg width="16" height="16" viewBox="0 0 50 50" aria-hidden="true">
              <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="90 60" opacity="0.85">
                <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="0.9s" repeatCount="indefinite" />
              </circle>
            </svg>
            <span style={{ fontWeight: 600 }}>Loading...</span>
          </div>
        ) : null}
        <button
          className="attendance-month-nav-btn"
          type="button"
          aria-label="Previous month"
          title="Previous month"
          disabled={attendanceSheetRefreshing}
          aria-busy={attendanceSheetRefreshing}
          onClick={() => goToPreviousMonth()}
        >
          ◀
        </button>
        <div className="results-month-label">
          {attendanceViewMonthLabel || "—"}
        </div>
        {hasNextMonthAttendance ? (
          <button
            className="attendance-month-nav-btn"
            type="button"
            aria-label="Next month"
            title="Next month"
            disabled={attendanceSheetRefreshing}
            aria-busy={attendanceSheetRefreshing}
            onClick={() => goToNextMonth()}
          >
            ▶
          </button>
        ) : (
          <div style={{ width: 40 }} aria-hidden="true" />
        )}
      </div>

      {!attendanceSheetRefreshing && attendanceMsg ? (
        <div className="admin-msg" style={{ textAlign: "center", marginTop: 4, marginBottom: 8 }}>
          {attendanceMsg}
        </div>
      ) : null}

      <div className="attendance-table-header">
        <div className="admin-help">
          <span className="att-legend-item att-legend-present">P: Present</span>
          <span className="att-legend-item att-legend-late">L: Late/Leave Early</span>
          <span className="att-legend-item att-legend-excused">E: Excused Absence</span>
          <span className="att-legend-item att-legend-absent">A: Unexcused Absence</span>
          <span className="att-legend-item">N/A: Not Counted</span>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 0 }}>
        <table className="admin-table attendance-table">
          <thead>
            <tr>
              <th className="att-col-code att-sticky-1">Student<br />No.</th>
              <th className="att-col-name att-sticky-2">Student Name</th>
              <th className="att-col-rate att-sticky-3">Attendance<br />Rate</th>
              <th className="att-col-absent att-sticky-4">Unexcused<br />Absence</th>
              {attendanceDayColumns.map((d) => (
                <th key={d.id}>
                  <button className="link-btn" type="button" onClick={() => openAttendanceDay(d.day_date)}>
                    {d.label}
                  </button>
                  <div className="att-day-total">
                    {attendanceDayRates[d.id] == null ? "-" : formatRatePercent(attendanceDayRates[d.id])}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attendanceFilteredStudents.map((s) => {
              const rowStats = attendanceStudentRowsById?.[s.id];
              const perDay = rowStats?.perDayStatuses ?? attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "N/A");
              const stats = rowStats?.stats ?? buildAttendanceStats(perDay);
              const rate = rowStats?.rate ?? (stats.total ? (stats.present / stats.total) * 100 : null);
              return (
                <tr key={s.id}>
                  <td className="att-col-code att-sticky-1">{s.student_code ?? ""}</td>
                  <td className="att-col-name att-sticky-2">
                    <div className="student-list-name-cell">
                      {s.is_test_account ? (
                        <span className="student-test-account-badge" title="Test Account" aria-label="Test Account">
                          T
                        </span>
                      ) : null}
                      <span>{s.display_name ?? s.email ?? s.id}</span>
                    </div>
                  </td>
                  <td className="att-col-rate att-sticky-3">{rate == null ? "N/A" : `${rate.toFixed(2)}%`}</td>
                  <td className="att-col-absent att-sticky-4">{rowStats?.unexcused ?? stats.unexcused}</td>
                  {attendanceDayColumns.map((d) => {
                    const status = attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "N/A";
                    return (
                      <td key={`${s.id}-${d.id}`} className={`att-cell ${getAttendanceStatusClassName(status)}`}>
                        {status}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
