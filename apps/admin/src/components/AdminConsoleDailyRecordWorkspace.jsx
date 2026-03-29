"use client";

import { useEffect } from "react";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useDailyRecordWorkspaceState } from "./AdminConsoleDailyRecordWorkspaceState";

function formatDateFull(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatWeekday(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date.getTime())) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[date.getUTCDay()] || "";
}

export default function AdminConsoleDailyRecordWorkspace() {
  const {
    activeSchoolId,
    supabase,
    session,
    students,
    fetchStudents,
    testSessions,
  } = useAdminConsoleWorkspaceContext();

  const {
    dailyRecordDatePickerRef,
    dailyRecordDatePickerOpen,
    setDailyRecordDatePickerOpen,
    dailyRecordDate,
    setDailyRecordDate,
    dailyRecordActiveCalendarMonth,
    dailyRecordCalendarMonthKeys,
    setDailyRecordCalendarMonth,
    openDailyRecordModal,
    closeDailyRecordModal,
    dailyRecordModalOpen,
    setDailyRecordModalOpen,
    dailyRecordSaving,
    dailyRecordForm,
    setDailyRecordForm,
    dailyRecordTableWrapRef,
    scheduleRecordRows,
    scheduleRecordDisplayByDate,
    resolveDailyRecordHoliday,
    dailyRecordHolidaySavingDate,
    saveDailyRecordHoliday,
    summarizeDailyRecordContent,
    summarizeDailyRecordComments,
    updateDailyRecordPlanDraft,
    saveDailyRecordPlan,
    dailyRecordPlanSavingDate,
    dailyRecordsMsg,
    fetchDailyRecords,
    saveDailyRecord,
  } = useDailyRecordWorkspaceState({ supabase, activeSchoolId, session, testSessions });

  useEffect(() => {
    if (!activeSchoolId) return;
    fetchDailyRecords();
    if (!students.length) {
      fetchStudents();
    }
  }, [activeSchoolId, students.length]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="admin-title">Schedule & Record</div>
          <div className="attendance-control-row" style={{ marginTop: 0 }}>
            <div className="admin-form">
              <div className="field">
                <label>Date</label>
                <div className="daily-record-date-picker" ref={dailyRecordDatePickerRef}>
                  <button
                    className="daily-record-date-picker-trigger"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={dailyRecordDatePickerOpen}
                    onClick={() => setDailyRecordDatePickerOpen((open) => !open)}
                  >
                    <span>
                      {dailyRecordDate
                        ? `${formatDateFull(dailyRecordDate)}${formatWeekday(dailyRecordDate) ? ` (${formatWeekday(dailyRecordDate)})` : ""}`
                        : "Select date"}
                    </span>
                    <span aria-hidden="true">▾</span>
                  </button>
                  {dailyRecordDatePickerOpen ? (
                    <div className="daily-record-date-picker-panel" role="dialog" aria-label="Select record date">
                      {dailyRecordActiveCalendarMonth ? (
                        <div className="daily-record-date-picker-month">
                          <div className="daily-record-date-picker-nav">
                            <button
                              type="button"
                              className="daily-record-date-picker-nav-btn"
                              disabled={dailyRecordCalendarMonthKeys[0] === dailyRecordActiveCalendarMonth.monthKey}
                              onClick={() => {
                                const currentIndex = dailyRecordCalendarMonthKeys.indexOf(dailyRecordActiveCalendarMonth.monthKey);
                                if (currentIndex > 0) setDailyRecordCalendarMonth(dailyRecordCalendarMonthKeys[currentIndex - 1]);
                              }}
                              aria-label="Previous month"
                            >
                              ‹
                            </button>
                            <div className="daily-record-date-picker-month-label">{dailyRecordActiveCalendarMonth.label}</div>
                            <button
                              type="button"
                              className="daily-record-date-picker-nav-btn"
                              disabled={dailyRecordCalendarMonthKeys[dailyRecordCalendarMonthKeys.length - 1] === dailyRecordActiveCalendarMonth.monthKey}
                              onClick={() => {
                                const currentIndex = dailyRecordCalendarMonthKeys.indexOf(dailyRecordActiveCalendarMonth.monthKey);
                                if (currentIndex >= 0 && currentIndex < dailyRecordCalendarMonthKeys.length - 1) {
                                  setDailyRecordCalendarMonth(dailyRecordCalendarMonthKeys[currentIndex + 1]);
                                }
                              }}
                              aria-label="Next month"
                            >
                              ›
                            </button>
                          </div>
                          <div className="daily-record-date-picker-weekdays">
                            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
                              <span key={`daily-record-weekday-${label}`}>{label}</span>
                            ))}
                          </div>
                          <div className="daily-record-date-picker-grid">
                            {dailyRecordActiveCalendarMonth.weeks.flat().map((cell, index) => {
                              if (!cell) {
                                return <span key={`daily-record-empty-${dailyRecordActiveCalendarMonth.monthKey}-${index}`} className="daily-record-date-cell-empty" />;
                              }
                              const isSelected = cell.recordDate === dailyRecordDate;
                              const className = [
                                "daily-record-date-picker-day",
                                cell.isHoliday ? "is-holiday" : "",
                                cell.isSelectable ? "is-selectable" : "",
                                isSelected ? "is-selected" : "",
                              ].filter(Boolean).join(" ");
                              return (
                                <button
                                  key={cell.recordDate}
                                  type="button"
                                  className={className}
                                  disabled={!cell.isSelectable}
                                  onClick={() => {
                                    setDailyRecordDate(cell.recordDate);
                                    setDailyRecordDatePickerOpen(false);
                                  }}
                                  title={cell.isHoliday ? "Holiday" : formatDateFull(cell.recordDate)}
                                >
                                  {cell.dayNumber}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="field small">
                <label>&nbsp;</label>
                <button className="btn btn-primary attendance-open-day-btn" type="button" onClick={() => {
                  if (!dailyRecordDate) {
                    alert("Please select a date first");
                    return;
                  }
                  try {
                    openDailyRecordModal(null, dailyRecordDate);
                  } catch (err) {
                    console.error("Open record error:", err);
                    alert(`Failed to open record: ${err?.message || "Unknown error"}`);
                  }
                }}>
                  Open Record
                </button>
              </div>
            </div>
          </div>
        </div>
        <button
          className="btn admin-icon-action-btn"
          aria-label="Refresh daily records"
          title="Refresh daily records"
          onClick={() => fetchDailyRecords()}
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

      <div className="admin-table-wrap" style={{ marginTop: 8, maxHeight: "70vh" }} ref={dailyRecordTableWrapRef}>
        <table className="admin-table daily-record-table" style={{ minWidth: 1360 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th className="daily-record-holiday-head">Holiday</th>
              <th>Today&apos;s Content</th>
              <th>Student Comments</th>
              <th>Test 1</th>
              <th>Test 2</th>
              <th>Test 3</th>
              <th>Save Plan</th>
            </tr>
          </thead>
          <tbody>
            {scheduleRecordRows.map(({ recordDate, record, draft }) => {
              const display = scheduleRecordDisplayByDate[recordDate] ?? {
                isConfirmed: false,
                isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
                mini_test_1: draft.mini_test_1,
                mini_test_2: draft.mini_test_2,
                special_test_1: draft.special_test_1,
              };
              const weekdayLabel = formatWeekday(recordDate);
              return (
                <tr
                  key={record?.id ?? recordDate}
                  data-daily-record-date={recordDate}
                  className={display.isHoliday ? "daily-record-holiday-row" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={(event) => {
                    if (event.target.closest("input, textarea, select, button, a, label")) return;
                    openDailyRecordModal(record, recordDate);
                  }}
                >
                  <td className="daily-record-date-cell">
                    {`${formatDateFull(recordDate)}${weekdayLabel ? ` (${weekdayLabel})` : ""}`}
                  </td>
                  <td className="daily-record-holiday-cell" onClick={(event) => event.stopPropagation()}>
                    <label className="daily-session-create-switch daily-record-holiday-switch" aria-label={`Mark ${recordDate} as holiday`}>
                      <input
                        type="checkbox"
                        checked={display.isHoliday}
                        disabled={dailyRecordHolidaySavingDate === recordDate}
                        onChange={(event) => saveDailyRecordHoliday(recordDate, event.target.checked)}
                      />
                      <span className="daily-session-create-switch-slider" />
                    </label>
                  </td>
                  {display.isHoliday ? (
                    <td colSpan={5} className="daily-record-holiday-summary">
                      {dailyRecordHolidaySavingDate === recordDate ? "Saving..." : "Holiday"}
                    </td>
                  ) : (
                    <>
                      <td>
                        {record?.todays_content
                          ? (() => {
                              const summary = summarizeDailyRecordContent(record.todays_content);
                              return summary.length > 140 ? `${summary.slice(0, 140)}...` : summary;
                            })()
                          : "-"}
                      </td>
                      <td>{record ? summarizeDailyRecordComments(record) : "-"}</td>
                      <td>
                        {display.isConfirmed ? (
                          <span>{display.mini_test_1}</span>
                        ) : (
                          <input
                            className="daily-record-plan-input"
                            value={display.mini_test_1}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_1", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        {display.isConfirmed ? (
                          <span>{display.mini_test_2}</span>
                        ) : (
                          <input
                            className="daily-record-plan-input"
                            value={display.mini_test_2}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_2", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        {display.isConfirmed ? (
                          <span>{display.special_test_1}</span>
                        ) : (
                          <input
                            className="daily-record-plan-input"
                            value={display.special_test_1}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_1", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => saveDailyRecordPlan(recordDate)}
                          disabled={display.isConfirmed || dailyRecordPlanSavingDate === recordDate}
                        >
                          {display.isConfirmed ? "Confirmed" : dailyRecordPlanSavingDate === recordDate ? "Saving..." : "Save Plan"}
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-msg">{dailyRecordsMsg}</div>
    </div>
  );
}
