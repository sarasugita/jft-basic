"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
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

function DailyRecordPlanTextarea({ value, onChange, placeholder }) {
  const textareaRef = useRef(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return undefined;

    const syncHeight = () => {
      const styles = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 18;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
      const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
      const minHeight = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom;
      const maxHeight = (lineHeight * 2) + paddingTop + paddingBottom + borderTop + borderBottom;

      textarea.style.height = "auto";
      const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${Math.max(nextHeight, minHeight)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    };

    syncHeight();

    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(syncHeight);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      className="daily-record-plan-input"
      value={value}
      rows={1}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
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
    tests,
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
    dailyRecordsLoaded,
    saveDailyRecord,
    updateDailyRecordComment,
    updateDailyRecordTextbookEntry,
    toggleDailyRecordCanDo,
    addDailyRecordTextbookEntry,
    removeDailyRecordTextbookEntry,
    addDailyRecordCommentRow,
    removeDailyRecordCommentRow,
    dailyRecordTomorrowSessions,
    dailyRecordAnnouncementTitleDraft,
    setDailyRecordAnnouncementTitleDraft,
    dailyRecordAnnouncementDraft,
    setDailyRecordAnnouncementDraft,
  } = useDailyRecordWorkspaceState({ supabase, activeSchoolId, session, testSessions, tests });

  useEffect(() => {
    if (!activeSchoolId) return;
    if (!dailyRecordsLoaded) {
      fetchDailyRecords();
    }
    if (!students.length) {
      fetchStudents();
    }
  }, [activeSchoolId, dailyRecordsLoaded, students.length]);

  useEffect(() => {
    // Auto-populate announcement fields when the upcoming sessions change
    if (!dailyRecordModalOpen || !dailyRecordTomorrowSessions?.targetDate) return;

    const regularSessions = dailyRecordTomorrowSessions.regular ?? [];
    const retakeSessions = dailyRecordTomorrowSessions.retake ?? [];

    if (regularSessions.length === 0 && retakeSessions.length === 0) return;

    const targetDate = dailyRecordTomorrowSessions.targetDate;
    const formattedDate = formatDateFull(targetDate);
    const title = `Exam Schedule (${targetDate})`;

    // Build announcement body with numbered test sessions
    let sessionsList = regularSessions.map((session, idx) => {
      const startTime = session.starts_at ? new Date(session.starts_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }) : "TBD";
      return `${idx + 1}. ${session.title} - ${startTime}`;
    }).join("\n");

    if (retakeSessions.length > 0) {
      const retakeList = retakeSessions.map((session, idx) => {
        const startTime = session.starts_at ? new Date(session.starts_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }) : "TBD";
        return `R${idx + 1}. ${session.title} - ${startTime}`;
      }).join("\n");
      sessionsList += `\n\nRetakes:\n${retakeList}`;
    }

    const body = `The following tests are scheduled for ${formattedDate}:\n\n${sessionsList}`;

    setDailyRecordAnnouncementTitleDraft(title);
    setDailyRecordAnnouncementDraft(body);
  }, [dailyRecordModalOpen, dailyRecordTomorrowSessions]);

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

  const hasTomorrowSessions = ((dailyRecordTomorrowSessions?.regular ?? []).length + (dailyRecordTomorrowSessions?.retake ?? []).length) > 0;

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
                            {dailyRecordActiveCalendarMonth.weeks.map((week, weekIndex) => (
                              <div key={`week-${weekIndex}`} className="daily-record-calendar-week">
                                {week.map((cell, dayIndex) => {
                                  if (!cell) {
                                    return <span key={`empty-${weekIndex}-${dayIndex}`} className="daily-record-date-cell-empty" />;
                                  }
                                  const isSelected = cell.recordDate === dailyRecordDate;
                                  const className = [
                                    "daily-record-date-picker-day",
                                    cell.isFromOtherMonth ? "is-other-month" : "",
                                    cell.isHoliday ? "is-holiday" : "",
                                    cell.isSelectable ? "is-selectable" : "",
                                    isSelected ? "is-selected" : "",
                                  ].filter(Boolean).join(" ");
                                  return (
                                    <button
                                      key={`${cell.recordDate}-${dayIndex}`}
                                      type="button"
                                      className={className}
                                      disabled={!cell.isSelectable}
                                      onClick={() => {
                                        if (cell.recordDate) {
                                          setDailyRecordDate(cell.recordDate);
                                          setDailyRecordDatePickerOpen(false);
                                        }
                                      }}
                                      title={cell.isHoliday ? "Holiday" : (cell.recordDate ? formatDateFull(cell.recordDate) : "")}
                                    >
                                      {cell.dayNumber}
                                    </button>
                                  );
                                })}
                              </div>
                            ))}
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
              <th>Daily Test 1</th>
              <th>Daily Test 2</th>
              <th>Model Test 1</th>
              <th>Model Test 2</th>
              <th>Save Plan</th>
            </tr>
          </thead>
          <tbody>
            {scheduleRecordRows.map(({ recordDate, record, draft }) => {
              const display = scheduleRecordDisplayByDate[recordDate] ?? {
                hasRecord: Boolean(record),
                isPastDate: false,
                isConfirmed: false,
                isFullyLocked: false,
                isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
                mini_test_1: draft.mini_test_1,
                mini_test_2: draft.mini_test_2,
                special_test_1: draft.special_test_1,
                special_test_2: draft.special_test_2,
                lockedMiniTest1: false,
                lockedMiniTest2: false,
                lockedSpecialTest1: false,
                lockedSpecialTest2: false,
              };
              const rowIsLocked = Boolean(display.hasRecord || display.isPastDate || display.isFullyLocked);
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
                    <td colSpan={7} className="daily-record-holiday-summary">
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
                        {rowIsLocked || display.lockedMiniTest1 ? (
                          <span className="daily-record-plan-text">{display.mini_test_1}</span>
                        ) : (
                          <DailyRecordPlanTextarea
                            value={display.mini_test_1}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_1", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        {rowIsLocked || display.lockedMiniTest2 ? (
                          <span className="daily-record-plan-text">{display.mini_test_2}</span>
                        ) : (
                          <DailyRecordPlanTextarea
                            value={display.mini_test_2}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "mini_test_2", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        {rowIsLocked || display.lockedSpecialTest1 ? (
                          <span className="daily-record-plan-text">{display.special_test_1}</span>
                        ) : (
                          <DailyRecordPlanTextarea
                            value={display.special_test_1}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_1", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        {rowIsLocked || display.lockedSpecialTest2 ? (
                          <span className="daily-record-plan-text">{display.special_test_2}</span>
                        ) : (
                          <DailyRecordPlanTextarea
                            value={display.special_test_2}
                            onChange={(e) => updateDailyRecordPlanDraft(recordDate, "special_test_2", e.target.value)}
                            placeholder="Plan"
                          />
                        )}
                      </td>
                      <td>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => saveDailyRecordPlan(recordDate)}
                          disabled={rowIsLocked || dailyRecordPlanSavingDate === recordDate}
                        >
                          {display.hasRecord
                            ? "Saved"
                            : display.isPastDate
                              ? "Locked"
                              : dailyRecordPlanSavingDate === recordDate
                                ? "Saving..."
                                : "Save Plan"}
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
          className="admin-modal-overlay daily-record-modal-overlay"
          onClick={() => closeDailyRecordModal()}
        >
          <div className="admin-modal daily-record-modal daily-record-modal-shell" onClick={(e) => e.stopPropagation()}>
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

            <div className="daily-record-modal-body" style={{ maxHeight: "calc(100vh - 110px)", overflowY: "auto" }}>
              <section className="daily-record-modal-section">
                <div className="daily-record-modal-section-head">
                  <div className="daily-record-modal-section-title">Today's Content</div>
                  <button
                    className="btn"
                    onClick={() => addDailyRecordTextbookEntry()}
                    type="button"
                  >
                    Add Textbook Entry
                  </button>
                </div>

                <div>
                  <label style={{ display: "block", fontWeight: 800 }}>Textbook Entries</label>
                  <div className="daily-record-textbook-list">
                    {(dailyRecordForm?.textbook_entries ?? []).map((entry) => {
                      const candoOptions = getIrodoriCanDoOptions(entry.book || "starter", entry.lesson || "1");
                      return (
                        <div key={entry.tempId} className="daily-record-textbook-row">
                          <div className="daily-record-textbook-row-head">
                            {dailyRecordForm.textbook_entries.length > 1 ? (
                              <button
                                className="daily-record-textbook-remove-icon"
                                onClick={() => removeDailyRecordTextbookEntry(entry.tempId)}
                                type="button"
                                aria-label="Remove textbook entry"
                              >
                                ×
                              </button>
                            ) : null}
                          </div>

                          <div className="daily-record-textbook-grid">
                            <div>
                              <label>Book</label>
                              <select
                                value={entry.book || "starter"}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { book: e.target.value })}
                              >
                                <option value="starter">Starter</option>
                                <option value="beginner_1">Beginner 1</option>
                                <option value="beginner_2">Beginner 2</option>
                              </select>
                            </div>
                            <div>
                              <label>Lesson</label>
                              <select
                                value={entry.lesson || "1"}
                                onChange={(e) => updateDailyRecordTextbookEntry(entry.tempId, { lesson: e.target.value })}
                              >
                                {Array.from({ length: 18 }, (_, i) => String(i + 1)).map((lessonNum) => (
                                  <option key={lessonNum} value={lessonNum}>Lesson {lessonNum}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {candoOptions.length > 0 ? (
                            <div className="daily-record-cando-wrap">
                              <label>Can-do Goals</label>
                              <div className="daily-record-cando-list">
                                {candoOptions.map((candoId) => {
                                  const isSelected = (entry.cando_ids || []).includes(candoId);
                                  return (
                                    <label key={candoId} className="daily-record-cando-option">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleDailyRecordCanDo(entry.tempId, candoId)}
                                      />
                                      <span>{candoId}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="daily-record-comments-section">
                  <div className="daily-record-comments-header">
                    <div className="daily-record-modal-section-title">Other Content Covered</div>
                  </div>
                  <textarea
                    className="daily-record-other-content"
                    value={dailyRecordForm?.free_writing || ""}
                    onChange={(e) => setDailyRecordForm((prev) => ({ ...prev, free_writing: e.target.value }))}
                    placeholder="Additional content, activities, notes, etc."
                  />
                </div>
              </section>

              <section className="daily-record-modal-section">
                <div className="daily-record-comments-header">
                  <div className="daily-record-modal-section-title">Student Comments</div>
                  <button
                    className="btn"
                    onClick={() => addDailyRecordCommentRow()}
                    type="button"
                  >
                    Add Comment
                  </button>
                </div>

                <div className="daily-record-comments-list">
                  {(dailyRecordForm?.comments ?? []).map((comment) => (
                    <div key={comment.tempId} className="daily-record-comment-row">
                      <div className="daily-record-comment-row-head">
                        {dailyRecordForm.comments.length > 1 ? (
                          <button
                            className="daily-record-textbook-remove-icon"
                            onClick={() => removeDailyRecordCommentRow(comment.tempId)}
                            type="button"
                            aria-label="Remove comment"
                          >
                            ×
                          </button>
                        ) : null}
                      </div>

                      <div className="daily-record-comment-fields">
                        <div>
                          <label>Student</label>
                          <select
                            value={comment.student_id || ""}
                            onChange={(e) => updateDailyRecordComment(comment.tempId, { student_id: e.target.value })}
                          >
                            <option value="">Select student...</option>
                            {(students ?? []).map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.display_name || s.email || s.id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label>Comment</label>
                          <textarea
                            value={comment.comment || ""}
                            onChange={(e) => updateDailyRecordComment(comment.tempId, { comment: e.target.value })}
                            placeholder="Enter comment..."
                            rows={3}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {hasTomorrowSessions ? (
                <section className="daily-record-modal-section">
                  <div className="daily-record-upcoming-grid">
                    <div>
                      <div className="daily-record-upcoming-label">{dailyRecordTomorrowSessions?.label || "Tomorrow's Exams"}</div>
                      <div className="daily-record-upcoming-list">
                        {(dailyRecordTomorrowSessions.regular ?? []).map((session, idx) => {
                          const startTime = session.starts_at
                            ? new Date(session.starts_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false })
                            : "TBD";
                          return (
                            <div key={session.id} className="daily-record-upcoming-item">
                              <span>{`${idx + 1}. ${session.title}`}</span>
                              <strong>{startTime}</strong>
                            </div>
                          );
                        })}
                        {(dailyRecordTomorrowSessions.retake ?? []).map((session, idx) => {
                          const startTime = session.starts_at
                            ? new Date(session.starts_at).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false })
                            : "TBD";
                          return (
                            <div key={session.id} className="daily-record-upcoming-item">
                              <span>{`R${idx + 1}. ${session.title}`}</span>
                              <strong>{startTime}</strong>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="daily-record-upcoming-label">Announcement to Students</div>
                      <div className="daily-record-announcement-box">
                        <div className="daily-record-announcement-fields">
                          <div>
                            <label>Subject</label>
                            <input
                              className="daily-record-announcement-title"
                              type="text"
                              value={dailyRecordAnnouncementTitleDraft || ""}
                              onChange={(e) => setDailyRecordAnnouncementTitleDraft(e.target.value)}
                              placeholder="Announcement subject..."
                            />
                          </div>
                          <div>
                            <label>Message</label>
                            <textarea
                              className="daily-record-announcement-draft"
                              value={dailyRecordAnnouncementDraft || ""}
                              onChange={(e) => setDailyRecordAnnouncementDraft(e.target.value)}
                              placeholder="Announcement message..."
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              <div className="daily-record-modal-actions">
                <button className="btn" onClick={() => closeDailyRecordModal()} disabled={dailyRecordSaving} type="button">
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => saveDailyRecord()} disabled={dailyRecordSaving} type="button">
                  {dailyRecordSaving ? "Saving..." : "Save Record"}
                </button>
                {hasTomorrowSessions ? (
                  <button className="btn btn-success" onClick={() => saveDailyRecord({ announcementAction: "send" })} disabled={dailyRecordSaving} type="button">
                    {dailyRecordSaving ? "Saving..." : "Save Record & Send Announcement"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </div>
  );
}
