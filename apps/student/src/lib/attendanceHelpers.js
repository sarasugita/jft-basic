export function normalizeAttendanceStatusToken(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return "";
  const compact = raw.replace(/\s+/g, "");
  if (compact === "NA" || compact === "N/A") return "N/A";
  return compact;
}

export function getAttendanceStatusClassSuffix(value) {
  const token = normalizeAttendanceStatusToken(value);
  const suffixMap = {
    P: "p",
    L: "l",
    E: "e",
    A: "a",
    "N/A": "na",
    W: "w",
  };
  return suffixMap[token] || "";
}

export function buildAttendanceSummary(list) {
  const monthKeys = Array.from(
    new Set(
      list
        .map((r) => String(r.day_date || ""))
        .filter(Boolean)
        .map((d) => d.slice(0, 7))
    )
  ).sort();

  const calc = (rows) => {
    const countedRows = rows.filter((row) => ["P", "L", "E", "A"].includes(normalizeAttendanceStatusToken(row.status)));
    const total = countedRows.length;
    const present = countedRows.filter((r) => {
      const status = normalizeAttendanceStatusToken(r.status);
      return status === "P" || status === "L";
    }).length;
    const late = countedRows.filter((r) => normalizeAttendanceStatusToken(r.status) === "L").length;
    const excused = countedRows.filter((r) => normalizeAttendanceStatusToken(r.status) === "E").length;
    const unexcused = countedRows.filter((r) => normalizeAttendanceStatusToken(r.status) === "A").length;
    const rate = total ? (present / total) * 100 : null;
    return { total, present, late, excused, unexcused, rate };
  };

  const overall = calc(list);
  const months = monthKeys.map((key, idx) => {
    const rows = list.filter((r) => String(r.day_date || "").startsWith(key));
    const stats = calc(rows);
    const parts = key.split("-");
    const labelMonth = parts.length === 2
      ? new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString(undefined, { month: "short" })
      : key;
    return {
      key,
      label: `Month ${idx + 1} (${labelMonth})`,
      stats
    };
  });

  return { overall, months };
}
