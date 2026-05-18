"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../lib/i18n";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useAttendanceWorkspaceState } from "./AdminConsoleAttendanceWorkspaceState";
import AdminStatusMessage from "./AdminStatusMessage";
import AdminLoadingState from "./AdminLoadingState";

function formatDateShortFn(d, lang = "en") {
  if (!d) return "";
  const parts = d.split("-");
  if (parts.length === 3) {
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    // Validate that day is between 1-31 to catch invalid dates like 3/32
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return `INVALID: ${month}/${day}`;
    }
    if (lang === "ja") {
      return `${month}/${day}`;
    }
    return `${month}/${day}`;
  }
  return "";
}

function formatWeekdayFn(d, lang = "en") {
  if (!d) return "";
  const date = new Date(`${d}T00:00:00`);
  if (isNaN(date.getTime())) return "";
  if (lang === "ja") {
    return date.toLocaleDateString("ja-JP", { timeZone: "Asia/Dhaka", weekday: "short" });
  }
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
}

export default function AdminConsoleAttendanceWorkspace() {
  const { lang, t } = useLanguage();
  const {
    activeSchoolId,
    supabase,
    session,
    students,
    fetchStudents,
    exportAttendanceGoogleSheetsCsv,
    importAttendanceGoogleSheetsCsv,
    formatRatePercent,
    formatDateTime,
    isAnalyticsExcludedStudent,
    attendanceSubTab,
    setAttendanceSubTab,
    openAttendanceDay: openAttendanceDayCtx,
    setAttendancePendingApplicationCount,
  } = useAdminConsoleWorkspaceContext();
  const [absenceApplicationFilter, setAbsenceApplicationFilter] = useState({
    studentId: "all",
    type: "all",
    dayDate: "",
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
  } = useAttendanceWorkspaceState({
    supabase,
    activeSchoolId,
    session,
    students,
    attendanceSubTab,
    setAttendanceSubTab,
    isAnalyticsExcludedStudent,
    formatDateShort: (d) => formatDateShortFn(d, lang),
    formatWeekday: (d) => formatWeekdayFn(d, lang),
    openAttendanceDayCtx,
  });

  useEffect(() => {
    setAbsenceApplicationFilter({
      studentId: "all",
      type: "all",
      dayDate: "",
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
    const selectedDayDate = absenceApplicationFilter.dayDate;
    return (absenceApplications ?? []).filter((application) => {
      if (selectedStudentId !== "all" && String(application?.student_id ?? "") !== selectedStudentId) {
        return false;
      }
      if (selectedType !== "all" && String(application?.type ?? "") !== selectedType) {
        return false;
      }
      if (selectedDayDate && String(application?.day_date ?? "") !== selectedDayDate) {
        return false;
      }
      return true;
    });
  }, [absenceApplications, absenceApplicationFilter.dayDate, absenceApplicationFilter.studentId, absenceApplicationFilter.type]);

  useEffect(() => {
    if (typeof setAttendancePendingApplicationCount !== "function") return;
    const pendingCount = (absenceApplications ?? []).filter(
      (application) => String(application?.status ?? "").toLowerCase() === "pending"
    ).length;
    setAttendancePendingApplicationCount(pendingCount);
  }, [absenceApplications, setAttendancePendingApplicationCount]);

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
      || absenceApplicationFilter.dayDate
    )
  ), [absenceApplicationFilter.dayDate, absenceApplicationFilter.studentId, absenceApplicationFilter.type]);

  const displayedAttendanceViewMonthLabel = useMemo(() => {
    if (lang !== "ja") return attendanceViewMonthLabel;
    const match = String(attendanceViewMonthLabel ?? "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return attendanceViewMonthLabel;
    return `${match[1]}/${Number(match[2])}`;
  }, [attendanceViewMonthLabel, lang]);

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
            <div className="admin-title">{t("Absence Applications")}</div>
            <div className="admin-subtitle">{t("Review and approve/deny student applications.")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className={`btn admin-icon-action-btn attendance-filter-toggle-btn ${absenceApplicationFilterOpen || hasAbsenceApplicationFilterValue ? "active" : ""}`}
              type="button"
              aria-label={absenceApplicationFilterOpen ? t("Hide absence application filters") : t("Show absence application filters")}
              aria-expanded={absenceApplicationFilterOpen}
              title={absenceApplicationFilterOpen ? t("Hide filters") : hasAbsenceApplicationFilterValue ? t("Show filters (active)") : t("Show filters")}
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
              aria-label={t("Refresh absence applications")}
              title={t("Refresh absence applications")}
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
                <label className="attendance-filter-label">{t("Student Name")}</label>
                <select
                  value={absenceApplicationFilter.studentId}
                  onChange={(event) =>
                    setAbsenceApplicationFilter((current) => ({
                      ...current,
                      studentId: event.target.value,
                    }))
                  }
                >
                  <option value="all">{t("All")}</option>
                  {absenceApplicationStudentOptions.map((student) => (
                    <option key={student.value} value={student.value}>
                      {student.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field small">
                <label className="attendance-filter-label">{t("Type")}</label>
                <select
                  value={absenceApplicationFilter.type}
                  onChange={(event) =>
                    setAbsenceApplicationFilter((current) => ({
                      ...current,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="all">{t("All")}</option>
                  <option value="excused">{t("Excused Absence")}</option>
                  <option value="late">{t("Late/Leave Early")}</option>
                </select>
              </div>
              <div className="field small">
                <label className="attendance-filter-label">{t("Date")}</label>
                <input
                  type="date"
                  value={absenceApplicationFilter.dayDate}
                  onChange={(event) =>
                    setAbsenceApplicationFilter((current) => ({
                      ...current,
                      dayDate: event.target.value,
                    }))
                  }
                />
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
                      dayDate: "",
                    })
                  }
                >
                  {t("Clear Filter")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>{t("Submitted")}</th>
                <th>{t("Student")}</th>
                <th>{t("Type")}</th>
                <th>{t("Date")}</th>
                <th>{t("Time")}</th>
                <th>{t("Reason")}</th>
                <th>{t("Catch Up")}</th>
                <th>{t("Status")}</th>
                <th>{t("Action")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredAbsenceApplications.map((a) => {
                const student = a.profiles || {};
                const name = student.display_name || student.email || a.student_id;
                const code = student.student_code ? ` (${student.student_code})` : "";
                const typeLabel = a.type === "excused" ? t("Excused Absence") : t("Late/Leave Early");
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
                                {t("Approve")}
                              </button>
                              <button className="btn btn-danger" onClick={() => openDenyAbsenceApplication(a)}>
                                {t("Deny")}
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
                  <td colSpan={9}>{t("No absence applications match the selected filters.")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <AdminStatusMessage message={absenceApplicationsMsg} />
        {denyApplicationModal.open && typeof document !== "undefined"
          ? createPortal(
            <div
              className="admin-modal-overlay"
              onClick={closeDenyAbsenceApplication}
              role="presentation"
            >
              <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
                <div className="admin-modal-header">
                  <div className="admin-title">{t("Deny Application")}</div>
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
                    {t("Comment is optional and will be shown to the student.")}
                  </div>
                  <div className="admin-help">
                    <div>
                      <strong>{t("Student:")}</strong>{" "}
                      {String(denyApplicationModal.application?.profiles?.display_name || denyApplicationModal.application?.student_id || "Student")}
                    </div>
                    <div>
                      <strong>{t("Date:")}</strong> {String(denyApplicationModal.application?.day_date || "")}
                    </div>
                  </div>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span className="admin-help">{t("Comment (optional)")}</span>
                    <textarea
                      value={denyApplicationModal.comment}
                      onChange={(e) =>
                        setDenyApplicationModal((current) => ({
                          ...current,
                          comment: e.target.value,
                        }))
                      }
                      rows={4}
                      placeholder={t("Add a note for the student, or leave blank.")}
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
                  <AdminStatusMessage message={denyApplicationModal.msg} />
                </div>
                <div className="admin-modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <button className="btn" type="button" onClick={closeDenyAbsenceApplication} disabled={denyApplicationModal.saving}>
                    {t("Cancel")}
                  </button>
                  <button className="btn btn-danger" type="button" onClick={confirmDenyAbsenceApplication} disabled={denyApplicationModal.saving}>
                    {denyApplicationModal.saving ? t("Denying...") : t("Deny")}
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
            <label style={{ display: "block", fontWeight: 800, marginBottom: 6, color: "var(--admin-text)" }}>{t("Date")}</label>
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
              alert(t("Please select a date first"));
              return;
            }
            openAttendanceDay(attendanceDate, { confirmExisting: true }).catch((err) => {
              console.error("Open day error:", err);
              alert(`${t("Failed to open day:")} ${err?.message || "Unknown error"}`);
            });
          }}>
            {t("Open Day")}
          </button>
          <button
            className={`btn admin-icon-action-btn attendance-filter-toggle-btn ${attendanceFilterOpen || hasAttendanceFilterValue ? "active" : ""}`}
            type="button"
            aria-label={attendanceFilterOpen ? t("Hide attendance filters") : t("Show attendance filters")}
            aria-expanded={attendanceFilterOpen}
            title={attendanceFilterOpen ? t("Hide filters") : hasAttendanceFilterValue ? t("Show filters (active)") : t("Show filters")}
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
            aria-label={t("Refresh attendance sheet")}
            title={t("Refresh attendance sheet")}
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
            <span>{t("Export CSV")}</span>
          </button>
          <button
            className="btn results-page-action-btn"
            type="button"
            onClick={() => attendanceImportInputRef.current?.click()}
          >
            <span className="results-page-action-icon" aria-hidden="true">↑</span>
            <span>{t("Import CSV")}</span>
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
              <label className="attendance-filter-label">{t("Filter (Rate <)")}</label>
              <input
                type="number"
                min="0"
                max="100"
                placeholder={t("e.g. 80")}
                value={attendanceFilter.minRate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minRate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">{t("Filter (Unexcused ≥)")}</label>
              <input
                type="number"
                min="0"
                placeholder={t("e.g. 3")}
                value={attendanceFilter.minAbsences}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, minAbsences: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">{t("Range From")}</label>
              <input
                type="date"
                value={attendanceFilter.startDate}
                onChange={(e) => setAttendanceFilter((s) => ({ ...s, startDate: e.target.value }))}
              />
            </div>
            <div className="field small">
              <label className="attendance-filter-label">{t("Range To")}</label>
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
                {t("Clear Filter")}
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
            <AdminLoadingState compact label={t("Loading...")} className="admin-loading-state-inline-left" />
          </div>
        ) : null}
        <button
          className="attendance-month-nav-btn"
          type="button"
          aria-label={t("Previous month")}
          title={t("Previous month")}
          disabled={attendanceSheetRefreshing}
          aria-busy={attendanceSheetRefreshing}
          onClick={() => goToPreviousMonth()}
        >
          ◀
        </button>
        <div className="results-month-label">
          {displayedAttendanceViewMonthLabel || "—"}
        </div>
        {hasNextMonthAttendance ? (
          <button
            className="attendance-month-nav-btn"
            type="button"
            aria-label={t("Next month")}
            title={t("Next month")}
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
        <AdminStatusMessage
          message={attendanceMsg}
          style={{ textAlign: "center", marginTop: 4, marginBottom: 8 }}
        />
      ) : null}

      <div className="attendance-table-header">
        <div className="admin-help">
          <span className="att-legend-item att-legend-present">{t("P: Present")}</span>
          <span className="att-legend-item att-legend-late">{t("L: Late/Leave Early")}</span>
          <span className="att-legend-item att-legend-excused">{t("E: Excused Absence")}</span>
          <span className="att-legend-item att-legend-absent">{t("A: Unexcused Absence")}</span>
          <span className="att-legend-item">{t("N/A: Not Counted")}</span>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 0 }}>
        <table className="admin-table attendance-table">
          <thead>
            <tr>
              <th className="att-col-code att-sticky-1">
                <span className="att-col-head-main">{t("Student No.")}</span>
                <span className="att-col-head-sub">{t("School ID")}</span>
              </th>
              <th className="att-col-name att-sticky-2">{t("Student Name")}</th>
              <th className="att-col-rate att-sticky-3">
                <span className="att-col-head-main">{t("Attendance Rate")}</span>
                <span className="att-col-head-sub">{t("P+L / Counted Days")}</span>
              </th>
              <th className="att-col-absent att-sticky-4">
                <span className="att-col-head-main">{t("Unexcused Absence")}</span>
                <span className="att-col-head-sub">{t("Count (A)")}</span>
              </th>
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
                        <span className="student-test-account-badge" title={t("Test Account")} aria-label={t("Test Account")}>
                          T
                        </span>
                      ) : null}
                      <span>{s.display_name ?? s.email ?? s.id}</span>
                    </div>
                  </td>
                  <td className="att-col-rate att-sticky-3">{rate == null ? t("N/A") : `${rate.toFixed(2)}%`}</td>
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
