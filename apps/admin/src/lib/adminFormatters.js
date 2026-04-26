"use client";

/**
 * Shared date/time formatting utilities for admin workspace state hooks.
 * Extracted from AdminConsoleCore.jsx during the per-workspace refactor.
 * All times are displayed / input in Bangladesh time (UTC+6).
 */

export const BD_OFFSET_MS = 6 * 60 * 60 * 1000;

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

export function toBangladeshInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bd = new Date(d.getTime() + BD_OFFSET_MS);
  return bd.toISOString().slice(0, 16);
}

export function fromBangladeshInput(value) {
  if (!value) return null;
  const parts = value.split("T");
  if (parts.length !== 2) return null;
  const [year, month, day] = parts[0].split("-").map((v) => Number(v));
  const [hour, minute] = parts[1].split(":").map((v) => Number(v));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 6, minute));
  return utc.toISOString();
}

/** Alias: formats an ISO timestamp as a Bangladesh datetime-local input value. */
export function formatDateTimeInput(iso) {
  return toBangladeshInput(iso);
}

export function getBangladeshDateInput(value) {
  if (!value) return "";
  const input = toBangladeshInput(value);
  return input ? input.slice(0, 10) : "";
}

function addBangladeshDateDays(dateInput, offsetDays) {
  const match = String(dateInput ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + Number(offsetDays || 0));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getUTCDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function formatBangladeshMonthDay(dateInput) {
  const match = String(dateInput ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${Number(match[2])}/${Number(match[3])}`;
}

function getBangladeshWeekdayIndex(dateInput) {
  const match = String(dateInput ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0));
  if (Number.isNaN(date.getTime())) return null;
  const weekday = date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    weekday: "short",
  });
  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return weekdayMap[weekday] ?? null;
}

export function getLatestCompletedSundayThursdayRange(referenceValue = new Date()) {
  const currentDate = getBangladeshDateInput(referenceValue);
  if (!currentDate) return null;
  const weekdayIndex = getBangladeshWeekdayIndex(currentDate);
  if (weekdayIndex == null) return null;

  const endOffset = weekdayIndex >= 5 ? -(weekdayIndex - 4) : -(weekdayIndex + 3);
  const endDate = addBangladeshDateDays(currentDate, endOffset);
  const startDate = addBangladeshDateDays(endDate, -4);
  if (!startDate || !endDate) return null;

  return {
    startDate,
    endDate,
    label: `${formatBangladeshMonthDay(startDate)}~${formatBangladeshMonthDay(endDate)}`,
  };
}

export function buildWeeklyReviewTitle(referenceValue = new Date()) {
  const range = getLatestCompletedSundayThursdayRange(referenceValue);
  return range?.label ? `Weekly Review (${range.label})` : "Weekly Review";
}
