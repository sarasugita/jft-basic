"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createAdminSupabaseClient, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { createAdminTrace, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

const DAILY_RECORD_COMMENT_FIELDS =
  "id, student_id, comment, profiles:student_id(display_name, student_code)";

function getTodayDateInput() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(dateString, months) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

function getWeekdayNumber(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.getDay();
}

function formatDateFull(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatWeekday(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function formatMonthYear(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})/);
  if (!match) return String(value);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
  });
}

function resolveDailyRecordHoliday(dateString, explicitValue) {
  const fallbackWeekend = (() => {
    const weekday = getWeekdayNumber(dateString);
    return weekday === 5;
  })();
  return explicitValue == null ? fallbackWeekend : Boolean(explicitValue);
}

function getEmptyDailyRecordPlanDraft() {
  return {
    mini_test_1: "",
    mini_test_2: "",
    special_test_1: "",
  };
}

function summarizeDailyRecordContent(value) {
  if (!value) return "-";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const textbookEntries = Array.isArray(parsed?.textbook_entries) ? parsed.textbook_entries : [];
      const textbookSummary = textbookEntries
        .filter((entry) => Array.isArray(entry?.cando_ids) && entry.cando_ids.length)
        .map((entry) => {
          const book = String(entry.book ?? "").trim();
          const lesson = String(entry.lesson ?? "").trim();
          const candoIds = Array.from(entry.cando_ids).join(", ");
          return `${book} Lesson ${lesson}: Can-do ${candoIds}`;
        });
      const freeWriting = String(parsed?.free_writing ?? "").trim();
      return [...textbookSummary, freeWriting].filter(Boolean).join(" | ") || "-";
    } catch {
      return value.trim() || "-";
    }
  }
  return "-";
}

function summarizeDailyRecordComments(record) {
  const comments = record?.daily_record_student_comments ?? [];
  if (!comments.length) return "-";
  const names = comments
    .map((item) => item?.profiles?.display_name || item?.profiles?.student_code || "")
    .filter(Boolean)
    .slice(0, 3);
  const suffix = comments.length > names.length ? ` +${comments.length - names.length}` : "";
  return `${comments.length} comment${comments.length > 1 ? "s" : ""}${names.length ? `: ${names.join(", ")}${suffix}` : ""}`;
}

function buildDailyRecordPlanDrafts(records) {
  const drafts = {};
  (records ?? []).forEach((record) => {
    if (!record?.record_date) return;
    drafts[record.record_date] = {
      mini_test_1: record.mini_test_1 ?? "",
      mini_test_2: record.mini_test_2 ?? "",
      special_test_1: record.special_test_1 ?? "",
    };
  });
  return drafts;
}

export default function AdminConsoleDailyRecordStartup({
  activeSchoolId,
  onOpenFullConsole = null,
}) {
  const renderTraceLoggedRef = useRef(false);
  const supabaseConfigError = getAdminSupabaseConfigError();
  const supabase = useMemo(
    () => (supabaseConfigError || !activeSchoolId ? null : createAdminSupabaseClient({ schoolScopeId: activeSchoolId })),
    [activeSchoolId, supabaseConfigError]
  );
  const dailyRecordDatePickerRef = useRef(null);
  const dailyRecordTableWrapRef = useRef(null);
  const [students] = useState([]);
  const [dailyRecords, setDailyRecords] = useState([]);
  const [dailyRecordsMsg, setDailyRecordsMsg] = useState("");
  const [dailyRecordDate, setDailyRecordDate] = useState(() => getTodayDateInput());
  const [dailyRecordDatePickerOpen, setDailyRecordDatePickerOpen] = useState(false);
  const [dailyRecordCalendarMonth, setDailyRecordCalendarMonth] = useState(() => getTodayDateInput().slice(0, 7));
  const [dailyRecordPlanDrafts, setDailyRecordPlanDrafts] = useState({});
  const [dailyRecordPlanSavingDate, setDailyRecordPlanSavingDate] = useState("");
  const [dailyRecordHolidaySavingDate, setDailyRecordHolidaySavingDate] = useState("");

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console daily record startup render start", {
      activeSchoolId,
      hasSupabaseClient: Boolean(supabase),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console daily record startup first commit", {
      activeSchoolId,
      hasSupabaseClient: Boolean(supabase),
    });
  }, [activeSchoolId, supabase]);

  useEffect(() => {
    if (!activeSchoolId) return;
    void fetchDailyRecords();
  }, [activeSchoolId]);

  async function fetchDailyRecords() {
    if (supabaseConfigError) {
      setDailyRecords([]);
      setDailyRecordsMsg(supabaseConfigError);
      return;
    }

    if (!supabase || !activeSchoolId) {
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordHolidaySavingDate("");
      setDailyRecordsMsg("Select a school.");
      return;
    }

    const finishTrace = createAdminTrace("Admin console daily record startup fetch", {
      activeSchoolId,
    });

    setDailyRecordsMsg("Loading...");

    let result = await supabase
      .from("daily_records")
      .select(`
        id,
        school_id,
        record_date,
        is_holiday,
        todays_content,
        mini_test_1,
        mini_test_2,
        special_test_1,
        special_test_2,
        created_at,
        updated_at,
        daily_record_student_comments(${DAILY_RECORD_COMMENT_FIELDS})
      `)
      .eq("school_id", activeSchoolId)
      .order("record_date", { ascending: false })
      .limit(180);

    if (result.error && String(result.error.message ?? "").includes("is_holiday")) {
      result = await supabase
        .from("daily_records")
        .select(`
          id,
          school_id,
          record_date,
          todays_content,
          mini_test_1,
          mini_test_2,
          special_test_1,
          special_test_2,
          created_at,
          updated_at,
          daily_record_student_comments(${DAILY_RECORD_COMMENT_FIELDS})
        `)
        .eq("school_id", activeSchoolId)
        .order("record_date", { ascending: false })
        .limit(180);
    }

    const { data, error } = result;
    if (error) {
      finishTrace("failed", {
        message: error.message || "",
        code: error.code || "",
        status: error.status ?? null,
      });
      logAdminRequestFailure("Admin console daily record startup fetch failed", error, {
        activeSchoolId,
      });
      setDailyRecords([]);
      setDailyRecordPlanDrafts({});
      setDailyRecordHolidaySavingDate("");
      setDailyRecordsMsg(`Load failed: ${error.message}`);
      return;
    }

    const list = data ?? [];
    finishTrace("success", {
      count: list.length,
    });
    setDailyRecords(list);
    setDailyRecordPlanDrafts(buildDailyRecordPlanDrafts(list));
    setDailyRecordHolidaySavingDate("");
    setDailyRecordsMsg(list.length ? "" : "No daily records yet. The next 2 months are shown below for planning.");
  }

  const scheduleRecordRows = useMemo(() => {
    const today = getTodayDateInput();
    const planningEnd = addMonths(today, 2);
    const dateSet = new Set();
    for (let date = today; date && date <= planningEnd; date = addDays(date, 1)) {
      dateSet.add(date);
    }
    (dailyRecords ?? []).forEach((record) => {
      if (record?.record_date) dateSet.add(record.record_date);
    });
    return Array.from(dateSet)
      .sort((left, right) => left.localeCompare(right))
      .map((recordDate) => {
        const record = (dailyRecords ?? []).find((item) => item.record_date === recordDate) ?? null;
        const draft = {
          ...getEmptyDailyRecordPlanDraft(),
          ...(record
            ? {
                mini_test_1: record.mini_test_1 ?? "",
                mini_test_2: record.mini_test_2 ?? "",
                special_test_1: record.special_test_1 ?? "",
              }
            : {}),
          ...(dailyRecordPlanDrafts[recordDate] ?? {}),
        };
        return { recordDate, record, draft };
      });
  }, [dailyRecordPlanDrafts, dailyRecords]);

  const scheduleRecordDisplayByDate = useMemo(() => {
    const displayMap = {};
    scheduleRecordRows.forEach(({ recordDate, record, draft }) => {
      displayMap[recordDate] = {
        isConfirmed: false,
        isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
        mini_test_1: draft.mini_test_1,
        mini_test_2: draft.mini_test_2,
        special_test_1: draft.special_test_1,
      };
    });
    return displayMap;
  }, [scheduleRecordRows]);

  const dailyRecordSelectableDates = useMemo(() => {
    const today = getTodayDateInput();
    return scheduleRecordRows
      .map(({ recordDate, record }) => ({
        recordDate,
        isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
      }))
      .filter((item) => item.recordDate >= today && !item.isHoliday)
      .map((item) => item.recordDate);
  }, [scheduleRecordRows]);

  const dailyRecordSelectableDateSet = useMemo(
    () => new Set(dailyRecordSelectableDates),
    [dailyRecordSelectableDates]
  );

  const dailyRecordCalendarMonths = useMemo(() => {
    const today = getTodayDateInput();
    const optionMap = new Map(
      scheduleRecordRows.map(({ recordDate, record }) => [
        recordDate,
        {
          isVisible: recordDate >= today,
          isHoliday: resolveDailyRecordHoliday(recordDate, record?.is_holiday),
        },
      ])
    );
    const monthKeys = Array.from(
      new Set(
        Array.from(optionMap.entries())
          .filter(([, value]) => value.isVisible)
          .map(([recordDate]) => recordDate.slice(0, 7))
      )
    ).sort();

    return monthKeys.map((monthKey) => {
      const monthStart = `${monthKey}-01`;
      const leadingBlankCount = getWeekdayNumber(monthStart) ?? 0;
      const monthDates = [];
      for (let date = monthStart; date.slice(0, 7) === monthKey; date = addDays(date, 1)) {
        const option = optionMap.get(date);
        monthDates.push({
          recordDate: date,
          dayNumber: Number(date.slice(-2)),
          isVisible: Boolean(option?.isVisible),
          isHoliday: Boolean(option?.isHoliday),
          isSelectable: Boolean(option?.isVisible) && !option?.isHoliday,
        });
      }

      const cells = [
        ...Array.from({ length: leadingBlankCount }, () => null),
        ...monthDates,
      ];
      while (cells.length % 7 !== 0) cells.push(null);

      return {
        monthKey,
        label: formatMonthYear(monthStart),
        weeks: Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7)),
      };
    });
  }, [scheduleRecordRows]);

  const dailyRecordCalendarMonthKeys = useMemo(
    () => dailyRecordCalendarMonths.map((month) => month.monthKey),
    [dailyRecordCalendarMonths]
  );

  const dailyRecordActiveCalendarMonth = useMemo(
    () => dailyRecordCalendarMonths.find((month) => month.monthKey === dailyRecordCalendarMonth)
      ?? dailyRecordCalendarMonths[0]
      ?? null,
    [dailyRecordCalendarMonth, dailyRecordCalendarMonths]
  );

  useEffect(() => {
    if (!dailyRecordSelectableDates.length) return;
    if (dailyRecordSelectableDateSet.has(dailyRecordDate)) return;
    setDailyRecordDate(dailyRecordSelectableDates[0]);
  }, [dailyRecordDate, dailyRecordSelectableDates, dailyRecordSelectableDateSet]);

  useEffect(() => {
    if (!dailyRecordCalendarMonthKeys.length) return;
    if (dailyRecordCalendarMonthKeys.includes(dailyRecordCalendarMonth)) return;
    const selectedMonth = dailyRecordDate.slice(0, 7);
    setDailyRecordCalendarMonth(
      dailyRecordCalendarMonthKeys.includes(selectedMonth)
        ? selectedMonth
        : dailyRecordCalendarMonthKeys[0]
    );
  }, [dailyRecordCalendarMonth, dailyRecordCalendarMonthKeys, dailyRecordDate]);

  useEffect(() => {
    if (!dailyRecordDatePickerOpen || !dailyRecordCalendarMonthKeys.length) return;
    const selectedMonth = dailyRecordDate.slice(0, 7);
    setDailyRecordCalendarMonth(
      dailyRecordCalendarMonthKeys.includes(selectedMonth)
        ? selectedMonth
        : dailyRecordCalendarMonthKeys[0]
    );
  }, [dailyRecordDate, dailyRecordDatePickerOpen, dailyRecordCalendarMonthKeys]);

  useEffect(() => {
    if (!dailyRecordDatePickerOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!dailyRecordDatePickerRef.current?.contains(event.target)) {
        setDailyRecordDatePickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [dailyRecordDatePickerOpen]);

  function updateDailyRecordPlanDraft(recordDate, field, value) {
    setDailyRecordPlanDrafts((previous) => ({
      ...previous,
      [recordDate]: {
        ...getEmptyDailyRecordPlanDraft(),
        ...(previous[recordDate] ?? {}),
        [field]: value,
      },
    }));
  }

  async function saveDailyRecordPlan(recordDate) {
    if (!activeSchoolId || !recordDate || !supabase) return;
    setDailyRecordPlanSavingDate(recordDate);
    setDailyRecordsMsg("");
    const draft = {
      ...getEmptyDailyRecordPlanDraft(),
      ...(dailyRecordPlanDrafts[recordDate] ?? {}),
    };
    const existingRecord = dailyRecords.find((item) => item.record_date === recordDate) ?? null;
    const payload = {
      school_id: activeSchoolId,
      record_date: recordDate,
      mini_test_1: draft.mini_test_1.trim() || null,
      mini_test_2: draft.mini_test_2.trim() || null,
      special_test_1: draft.special_test_1.trim() || null,
      special_test_2: null,
      updated_at: new Date().toISOString(),
    };
    const result = existingRecord?.id
      ? await supabase.from("daily_records").update(payload).eq("id", existingRecord.id)
      : await supabase.from("daily_records").insert({ ...payload, todays_content: null });
    if (result.error) {
      logAdminRequestFailure("Admin console daily record startup save plan failed", result.error, {
        activeSchoolId,
        recordDate,
      });
      setDailyRecordsMsg(`Save failed: ${result.error.message}`);
      setDailyRecordPlanSavingDate("");
      return;
    }
    setDailyRecordPlanSavingDate("");
    setDailyRecordsMsg(`Saved plan for ${recordDate}.`);
    await fetchDailyRecords();
  }

  async function saveDailyRecordHoliday(recordDate, nextHoliday) {
    if (!activeSchoolId || !recordDate || !supabase) return;
    setDailyRecordHolidaySavingDate(recordDate);
    setDailyRecordsMsg("");
    const existingRecord = dailyRecords.find((item) => item.record_date === recordDate) ?? null;
    const payload = {
      school_id: activeSchoolId,
      record_date: recordDate,
      is_holiday: nextHoliday,
      updated_at: new Date().toISOString(),
    };
    const result = existingRecord?.id
      ? await supabase.from("daily_records").update(payload).eq("id", existingRecord.id)
      : await supabase.from("daily_records").insert({
          ...payload,
          todays_content: null,
          mini_test_1: null,
          mini_test_2: null,
          special_test_1: null,
          special_test_2: null,
        });
    if (result.error) {
      logAdminRequestFailure("Admin console daily record startup save holiday failed", result.error, {
        activeSchoolId,
        recordDate,
      });
      setDailyRecordsMsg(`Save failed: ${result.error.message}`);
      setDailyRecordHolidaySavingDate("");
      return;
    }
    await fetchDailyRecords();
    setDailyRecordsMsg(`${recordDate} marked as ${nextHoliday ? "holiday" : "school day"}.`);
  }

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
                <button className="btn btn-primary attendance-open-day-btn" type="button" onClick={() => onOpenFullConsole?.()}>
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
                    onOpenFullConsole?.();
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
                  <td>{summarizeDailyRecordContent(record?.todays_content)}</td>
                  <td>{summarizeDailyRecordComments(record)}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      value={draft.mini_test_1}
                      onChange={(event) => updateDailyRecordPlanDraft(recordDate, "mini_test_1", event.target.value)}
                      placeholder="-"
                    />
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      value={draft.mini_test_2}
                      onChange={(event) => updateDailyRecordPlanDraft(recordDate, "mini_test_2", event.target.value)}
                      placeholder="-"
                    />
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      value={draft.special_test_1}
                      onChange={(event) => updateDailyRecordPlanDraft(recordDate, "special_test_1", event.target.value)}
                      placeholder="-"
                    />
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={dailyRecordPlanSavingDate === recordDate}
                      onClick={() => saveDailyRecordPlan(recordDate)}
                    >
                      {dailyRecordPlanSavingDate === recordDate ? "Saving..." : "Save"}
                    </button>
                  </td>
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
