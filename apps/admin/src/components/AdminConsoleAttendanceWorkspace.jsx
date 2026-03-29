"use client";

import { useEffect } from "react";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useAttendanceWorkspaceState } from "./AdminConsoleAttendanceWorkspaceState";

function formatDateShortFn(d) {
  if (!d) return "";
  const date = new Date(`${d}T00:00:00Z`);
  if (isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatWeekdayFn(d) {
  if (!d) return "";
  const date = new Date(`${d}T00:00:00Z`);
  if (isNaN(date.getTime())) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[date.getUTCDay()] || "";
}

export default function AdminConsoleAttendanceWorkspace() {
  const { activeSchoolId, supabase, session, students, fetchStudents, exportAttendanceGoogleSheetsCsv, importAttendanceGoogleSheetsCsv, formatRatePercent, formatDateTime, isAnalyticsExcludedStudent, attendanceSubTab, setAttendanceSubTab, openAttendanceDay: openAttendanceDayCtx } = useAdminConsoleWorkspaceContext();

  const {
    attendanceMsg,
    attendanceDate,
    setAttendanceDate,
    openAttendanceDay,
    clearAllAttendanceValues,
    attendanceClearing,
    attendanceImportInputRef,
    attendanceFilter,
    setAttendanceFilter,
    fetchAttendanceDays,
    fetchAbsenceApplications,
    absenceApplications,
    decideAbsenceApplication,
    absenceApplicationsMsg,
    buildAttendanceStats,
    getAttendanceStatusClassName,
    // Memos from hook
    attendanceDayColumns,
    attendanceRangeColumns,
    attendanceEntriesByDay,
    attendanceFilteredStudents,
    attendanceDayRates,
  } = useAttendanceWorkspaceState({ supabase, activeSchoolId, session, students, attendanceSubTab, setAttendanceSubTab, isAnalyticsExcludedStudent, formatDateShort: formatDateShortFn, formatWeekday: formatWeekdayFn, openAttendanceDayCtx: openAttendanceDay });

  useEffect(() => {
    if (!activeSchoolId) return;
    if (attendanceSubTab === "sheet") {
      if (!students.length) {
        fetchStudents();
      }
      fetchAttendanceDays();
      return;
    }
    fetchAbsenceApplications();
  }, [activeSchoolId, attendanceSubTab, students.length]);

  if (attendanceSubTab === "absence") {
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div className="admin-title">Absence Applications</div>
            <div className="admin-subtitle">Review and approve/deny student applications.</div>
          </div>
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
              {absenceApplications.map((a) => {
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
                          <button className="btn btn-danger" onClick={() => decideAbsenceApplication(a.id, "denied")}>
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
            </tbody>
          </table>
        </div>
        <div className="admin-msg">{absenceApplicationsMsg}</div>
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
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "nowrap", justifyContent: "flex-end", marginLeft: "auto", alignSelf: "flex-start", flex: "0 0 auto" }}>
          <button className="btn results-page-action-btn" type="button" onClick={exportAttendanceGoogleSheetsCsv}>
            <span className="results-page-action-icon" aria-hidden="true">↓</span>
            <span>Export CSV</span>
          </button>
          <button
            className="btn btn-danger results-page-action-btn"
            type="button"
            onClick={clearAllAttendanceValues}
            disabled={attendanceClearing}
          >
            <span>{attendanceClearing ? "Clearing..." : "Clear All Attendance"}</span>
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

      <div className="attendance-table-header">
        <div className="admin-help">
          <span className="att-legend-item att-legend-present">P: Present</span>
          <span className="att-legend-item att-legend-late">L: Late/Leave Early</span>
          <span className="att-legend-item att-legend-excused">E: Excused Absence</span>
          <span className="att-legend-item att-legend-absent">A: Unexcused Absence</span>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 2 }}>
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
              const perDay = attendanceRangeColumns.map((d) => attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "");
              const stats = buildAttendanceStats(perDay);
              const rate = stats.total ? (stats.present / stats.total) * 100 : 0;
              return (
                <tr key={s.id}>
                  <td className="att-col-code att-sticky-1">{s.student_code ?? ""}</td>
                  <td className="att-col-name att-sticky-2">{s.display_name ?? s.email ?? s.id}</td>
                  <td className="att-col-rate att-sticky-3">{rate.toFixed(2)}%</td>
                  <td className="att-col-absent att-sticky-4">{stats.unexcused}</td>
                  {attendanceDayColumns.map((d) => {
                    const status = attendanceEntriesByDay?.[d.id]?.[s.id]?.status || "";
                    return (
                      <td key={`${s.id}-${d.id}`} className={`att-cell ${getAttendanceStatusClassName(status)}`}>
                        {status || ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-msg">{attendanceMsg}</div>
    </div>
  );
}
