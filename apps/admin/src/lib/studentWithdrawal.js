export function normalizeYmdDate(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

export function getTodayYmd() {
  const now = new Date();
  if (Number.isNaN(now.getTime())) return "";
  return now.toISOString().slice(0, 10);
}

export function getStudentWithdrawalDate(student) {
  return normalizeYmdDate(student?.withdrawal_date);
}

export function isStudentWithdrawnEffectiveOnDate(student, dayDate) {
  if (!student?.is_withdrawn) return false;
  const withdrawalDate = getStudentWithdrawalDate(student);
  if (!withdrawalDate) return true;
  const normalizedDayDate = normalizeYmdDate(dayDate);
  if (!normalizedDayDate) return true;
  return normalizedDayDate > withdrawalDate;
}

export function getAttendanceStatusForSummary(student, dayDate, rawStatus) {
  if (isStudentWithdrawnEffectiveOnDate(student, dayDate)) {
    return "W";
  }
  return String(rawStatus ?? "").trim();
}

export function getAttendanceStatusForDisplay(student, dayDate, rawStatus) {
  const normalizedStatus = String(rawStatus ?? "").trim();
  if (normalizedStatus) return normalizedStatus;
  return isStudentWithdrawnEffectiveOnDate(student, dayDate) ? "W" : "";
}

export function mapAttendanceRowsForSummary(rows, student) {
  return (rows ?? []).map((row) => ({
    ...row,
    status: getAttendanceStatusForSummary(student, row?.day_date, row?.status),
  }));
}
