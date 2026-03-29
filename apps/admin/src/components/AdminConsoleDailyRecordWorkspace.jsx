"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useDailyRecordWorkspaceState } from "./AdminConsoleDailyRecordWorkspaceState";

// Constants for candos
const IRODORI_CANDO_BY_BOOK = {
  starter: {
    "1": ["1", "2", "3", "4"],
    "2": ["5", "6", "7"],
    "3": ["8", "9", "10", "11"],
    "4": ["12", "13", "14", "15"],
    "5": ["16", "17", "18", "19", "20"],
    "6": ["21", "22", "23", "24", "25"],
    "7": ["26", "27", "28", "29", "30"],
    "8": ["31", "32", "33", "34"],
    "9": ["35", "36", "37", "38"],
    "10": ["39", "40", "41", "42", "43"],
    "11": ["44", "45", "46", "47"],
    "12": ["48", "49", "50", "51"],
    "13": ["52", "53", "54", "55", "56"],
    "14": ["57", "58", "59", "60"],
    "15": ["61", "62", "63", "64", "65"],
    "16": ["66", "67", "68", "69", "70"],
    "17": ["71", "72", "73", "74", "75"],
    "18": ["76", "77", "78", "79"],
  },
  beginner_1: {
    "1": ["1", "2", "3"],
    "2": ["4", "5", "6", "7"],
    "3": ["8", "9", "10"],
    "4": ["11", "12", "13"],
    "5": ["14", "15", "16"],
    "6": ["17", "18", "19"],
    "7": ["20", "21", "22", "23"],
    "8": ["24", "25", "26"],
    "9": ["27", "28", "29", "30"],
    "10": ["31", "32", "33", "34"],
    "11": ["35", "36", "37", "38"],
    "12": ["39", "40", "41", "42"],
    "13": ["43", "44", "45", "46", "47"],
    "14": ["48", "49", "50", "51"],
    "15": ["51", "52", "53", "54", "55", "56"],
    "16": ["57", "58", "59", "60"],
    "17": ["61", "62", "63", "64"],
    "18": ["65", "66", "67", "68", "69"],
  },
  beginner_2: {
    "1": ["1", "2", "3", "4"],
    "2": ["5", "6", "7", "8"],
    "3": ["9", "10", "11", "12", "13"],
    "4": ["14", "15", "16", "17", "18"],
    "5": ["19", "20", "21", "22"],
    "6": ["23", "24", "25", "26", "27"],
    "7": ["28", "29", "30", "31"],
    "8": ["33", "34", "35", "36", "37"],
    "9": ["38", "39", "40", "41", "42"],
    "10": ["43", "44", "45", "46"],
    "11": ["47", "48", "49", "50"],
    "12": ["51", "52", "53", "54"],
    "13": ["55", "56", "57", "58", "59"],
    "14": ["60", "61", "62", "63"],
    "15": ["64", "65", "66", "67"],
    "16": ["68", "69", "70", "71", "72"],
    "17": ["73", "74", "75"],
    "18": ["76", "77", "78"],
  },
};

function formatDateFull(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", year: "numeric", month: "long", day: "numeric" });
}

function formatWeekday(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", weekday: "short" });
}

function getIrodoriCanDoOptions(book, lesson) {
  return IRODORI_CANDO_BY_BOOK?.[book]?.[String(lesson)] ?? [];
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
    updateDailyRecordComment,
    updateDailyRecordTextbookEntry,
    toggleDailyRecordCanDo,
    addDailyRecordTextbookEntry,
    removeDailyRecordTextbookEntry,
    addDailyRecordCommentRow,
    removeDailyRecordCommentRow,
  } = useDailyRecordWorkspaceState({ supabase, activeSchoolId, session, testSessions });

  useEffect(() => {
    if (!activeSchoolId) return;
    fetchDailyRecords();
    if (!students.length) {
      fetchStudents();
    }
  }, [activeSchoolId, students.length]);

  useEffect(() => {
    // Scroll to today's date in the table
    if (!dailyRecordTableWrapRef.current) return;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const todayRow = dailyRecordTableWrapRef.current.querySelector(`[data-daily-record-date="${todayStr}"]`);
    if (todayRow) {
      todayRow.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scheduleRecordRows]);

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

      {dailyRecordModalOpen && typeof document !== "undefined" ? createPortal((
        <div
          className="admin-modal-overlay"
          onClick={() => closeDailyRecordModal()}
        >
          <div className="admin-modal daily-record-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">
                Daily Record - {dailyRecordForm?.record_date ? formatDateFull(dailyRecordForm.record_date) : "New Record"}
              </div>
              <button
                className="admin-modal-close"
                aria-label="Close"
                onClick={() => closeDailyRecordModal()}
              >
                ×
              </button>
            </div>

            <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontWeight: "bold", marginBottom: "8px" }}>Today's Content</label>

                  <div style={{ marginBottom: "12px" }}>
                    <div style={{ marginBottom: "8px" }}>
                      <label style={{ fontSize: "13px", color: "#333" }}>Textbook Entries</label>
                    </div>
                    {(dailyRecordForm?.textbook_entries ?? []).map((entry) => {
                      const candoOptions = getIrodoriCanDoOptions(entry.book || "starter", entry.lesson || "1");
                      return (
                        <div key={entry.tempId} style={{ marginBottom: "12px", padding: "12px", border: "1px solid #e0e0e0", borderRadius: "4px", backgroundColor: "#f9f9f9" }}>
                          <div style={{ display: "flex", gap: "12px", marginBottom: "8px", alignItems: "flex-end" }}>
                            <div>
                              <label style={{ fontSize: "12px", color: "#666" }}>Book</label>
                              <select
                                value={entry.book || "starter"}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { book: e.target.value })}
                                style={{ padding: "6px", border: "1px solid #ccc", borderRadius: "4px", minWidth: "140px" }}
                              >
                                <option value="starter">Starter</option>
                                <option value="beginner_1">Beginner 1</option>
                                <option value="beginner_2">Beginner 2</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: "12px", color: "#666" }}>Lesson</label>
                              <select
                                value={entry.lesson || "1"}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { lesson: e.target.value })}
                                style={{ padding: "6px", border: "1px solid #ccc", borderRadius: "4px", minWidth: "120px" }}
                              >
                                {Array.from({ length: 18 }, (_, i) => String(i + 1)).map((lessonNum) => (
                                  <option key={lessonNum} value={lessonNum}>Lesson {lessonNum}</option>
                                ))}
                              </select>
                            </div>
                            {dailyRecordForm.textbook_entries.length > 1 && (
                              <button
                                className="btn btn-danger"
                                onClick={() => removeDailyRecordTextbookEntry(entry.tempId)}
                                type="button"
                                style={{ padding: "6px 12px" }}
                              >
                                Remove
                              </button>
                            )}
                          </div>

                          {candoOptions.length > 0 && (
                            <div>
                              <label style={{ fontSize: "12px", color: "#666", marginBottom: "6px", display: "block" }}>Can-do Goals</label>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                                {candoOptions.map((candoId) => {
                                  const isSelected = (entry.cando_ids || []).includes(candoId);
                                  return (
                                    <label key={candoId} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleDailyRecordCanDo(entry.tempId, candoId)}
                                      />
                                      <span style={{ fontSize: "13px" }}>{candoId}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button
                      className="btn"
                      onClick={() => addDailyRecordTextbookEntry()}
                      type="button"
                      style={{ marginTop: "8px" }}
                    >
                      + Add Textbook Entry
                    </button>
                  </div>

                  <div>
                    <label style={{ fontSize: "13px", color: "#333", marginBottom: "6px", display: "block" }}>Other Content Covered</label>
                    <textarea
                      value={dailyRecordForm?.free_writing || ""}
                      onChange={(e) => setDailyRecordForm((prev) => ({ ...prev, free_writing: e.target.value }))}
                      placeholder="Additional content, activities, notes, etc."
                      style={{ width: "100%", minHeight: "80px", padding: "8px", border: "1px solid #ccc", borderRadius: "4px", fontFamily: "inherit", fontSize: "inherit" }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
                <div style={{ marginBottom: "8px" }}>
                  <label style={{ fontWeight: "bold" }}>Student Comments</label>
                </div>
                {(dailyRecordForm?.comments ?? []).map((comment) => (
                  <div key={comment.tempId} style={{ marginBottom: "8px", display: "flex", gap: "8px", alignItems: "center" }}>
                    <select
                      value={comment.student_id || ""}
                      onChange={(e) => updateDailyRecordComment(comment.tempId, { student_id: e.target.value })}
                      style={{ padding: "6px", border: "1px solid #ccc", borderRadius: "4px", minWidth: "160px" }}
                    >
                      <option value="">Select student...</option>
                      {(students ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name || s.email || s.id}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={comment.comment || ""}
                      onChange={(e) => updateDailyRecordComment(comment.tempId, { comment: e.target.value })}
                      placeholder="Enter comment..."
                      style={{ flex: 1, padding: "6px", border: "1px solid #ccc", borderRadius: "4px" }}
                    />
                    {dailyRecordForm.comments.length > 1 && (
                      <button
                        className="btn btn-danger"
                        onClick={() => removeDailyRecordCommentRow(comment.tempId)}
                        type="button"
                        style={{ padding: "6px 10px" }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="btn"
                  onClick={() => addDailyRecordCommentRow()}
                  type="button"
                  style={{ marginTop: "8px" }}
                >
                  + Add Comment
                </button>
              </div>

              <div style={{ padding: "12px 16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button className="btn btn-primary" onClick={() => saveDailyRecord()} disabled={dailyRecordSaving} type="button">
                  {dailyRecordSaving ? "Saving..." : "Save Record"}
                </button>
                <button className="btn" onClick={() => closeDailyRecordModal()} disabled={dailyRecordSaving} type="button">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
