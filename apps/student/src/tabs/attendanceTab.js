import { escapeHtml } from "../lib/escapeHtml";
import { formatDateShort, formatWeekday } from "../lib/formatters";
import { renderLoadingIndicator } from "../lib/loadingIndicator";
import { buildAttendanceSummary, getAttendanceStatusClassSuffix } from "../lib/attendanceHelpers";
import { state, saveState } from "../state/appState";
import { authState } from "../state/authState";
import { studentAttendanceState } from "../state/attendanceState";
import { supabase } from "../supabaseClient";
import { triggerRender } from "../lib/renderBus";

const closeIconSvg = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
`;

export function buildAttendanceTabHTML() {
  if (!authState.session) {
    return `<div class="text-muted">Log in to see attendance.</div>`;
  }
  if (studentAttendanceState.loading) {
    return renderLoadingIndicator("Loading attendance...");
  }
  if (studentAttendanceState.error) {
    return `<div class="text-error">${escapeHtml(studentAttendanceState.error)}</div>`;
  }
  if (!studentAttendanceState.list.length) {
    return `<div class="text-muted">No attendance records.</div>`;
  }

  const summary = buildAttendanceSummary(studentAttendanceState.list);
  const monthList = [{ key: "__all__", label: "All period" }, ...summary.months];
  let selectedMonthKey = state.attendanceMonthKey || "__all__";
  if (!monthList.some((m) => m.key === selectedMonthKey)) {
    selectedMonthKey = monthList[monthList.length - 1]?.key || "__all__";
    state.attendanceMonthKey = selectedMonthKey;
    saveState();
  }
  const selectedIndex = Math.max(
    0,
    monthList.findIndex((m) => m.key === selectedMonthKey)
  );
  const selectedMonth =
    monthList[selectedIndex] || monthList[monthList.length - 1] || { key: "__all__", label: "All period" };
  const prevMonthKey = monthList[selectedIndex - 1]?.key || "";
  const nextMonthKey = monthList[selectedIndex + 1]?.key || "";
  const monthLabel = (() => {
    if (selectedMonth.key === "__all__") return "All period";
    const parts = selectedMonth.key.split("-");
    if (parts.length !== 2) return selectedMonth.key;
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  })();
  const monthRows =
    selectedMonth.key === "__all__"
      ? studentAttendanceState.list
      : studentAttendanceState.list.filter((r) =>
          String(r.day_date || "").startsWith(selectedMonth.key)
        );
  const stats = selectedMonth.key === "__all__" ? summary.overall : selectedMonth.stats;
  const pCount = Math.max(0, (stats.present || 0) - (stats.late || 0));
  const lCount = stats.late || 0;
  const eCount = stats.excused || 0;
  const aCount = stats.unexcused || 0;
  const totalCount = pCount + lCount + eCount + aCount;
  const rateValue = totalCount ? ((pCount + lCount) / totalCount) * 100 : 0;
  const segments = [
    { label: "P", name: "Present", value: pCount, color: "#22c55e" },
    { label: "L", name: "Late/Leave Early", value: lCount, color: "#2563eb" },
    { label: "E", name: "Excused Absence", value: eCount, color: "#f59e0b" },
    { label: "A", name: "Unexcused Absence", value: aCount, color: "#ef4444" }
  ];
  let acc = 0;
  const pieStops = totalCount
    ? segments
        .map((s) => {
          const start = acc;
          const portion = (s.value / totalCount) * 100;
          acc += portion;
          return `${s.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
        })
        .join(", ")
    : "#e5e7eb 0% 100%";
  let angleAcc = 0;
  const pieLabels = totalCount
    ? segments
        .map((s) => {
          if (!s.value) return "";
          const portion = (s.value / totalCount) * 360;
          const mid = angleAcc + portion / 2;
          angleAcc += portion;
          const rad = (mid - 90) * (Math.PI / 180);
          const x = Math.cos(rad) * 78;
          const y = Math.sin(rad) * 78;
          return `
            <span class="attendance-pie-label" style="--x:${x.toFixed(1)}px; --y:${y.toFixed(1)}px;">${s.label}</span>
          `;
        })
        .join("")
    : "";

  return `
    <div class="home-stack">
      <section class="home-card">
        <div class="student-application-header">
          <div class="student-home-title student-home-title-icon">
            <span class="student-home-title-icon-svg" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="m14 6 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            Submit Application
          </div>
          <button class="student-application-view" type="button" data-student-tab="attendanceHistory">History →</button>
        </div>
        <div class="student-application-actions">
          <button class="btn app-btn app-btn-excused" id="openExcusedApp">Excused Absence</button>
          <button class="btn app-btn app-btn-late" id="openLateApp">Late / Leave Early</button>
        </div>
      </section>
      <section class="home-card attendance-record-card">
        <div class="attendance-month-bar">
          <button class="attendance-month-nav" type="button" data-att-month-target="${escapeHtml(prevMonthKey)}" ${prevMonthKey ? "" : "disabled"} aria-label="Previous month">
            ‹
          </button>
          <div class="attendance-month-label">
            <select class="attendance-month-select" id="attendanceMonthSelect">
              ${monthList
                .map((m) => {
                  const label = m.key === "__all__" ? "All period" : (() => {
                    const parts = m.key.split("-");
                    if (parts.length !== 2) return m.key;
                    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
                    return dt.toLocaleDateString(undefined, { year: "numeric", month: "long" });
                  })();
                  return `<option value="${escapeHtml(m.key)}" ${m.key === selectedMonth.key ? "selected" : ""}>${escapeHtml(label)}</option>`;
                })
                .join("")}
            </select>
          </div>
          <button class="attendance-month-nav" type="button" data-att-month-target="${escapeHtml(nextMonthKey)}" ${nextMonthKey ? "" : "disabled"} aria-label="Next month">
            ›
          </button>
        </div>
        <div class="attendance-pie-wrap">
          <div class="attendance-pie" style="--pie-bg: conic-gradient(${pieStops});">
            <div class="attendance-pie-labels">
              ${pieLabels}
            </div>
            <div class="attendance-pie-center">
              <div class="attendance-rate">${rateValue.toFixed(1)}%</div>
              <div class="attendance-rate-label">Attendance Rate</div>
            </div>
          </div>
          <div class="attendance-legend">
            ${segments
              .map(
                (s) => `
                  <div class="attendance-legend-item">
                    <span class="attendance-legend-dot" style="background:${s.color};"></span>
                    <span>${s.name}: ${s.value}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </div>
        <div class="detail-title" style="margin-top: 12px;">Daily Records</div>
        <div class="detail-table-wrap">
          <table class="detail-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Status</th>
                <th>Comment</th>
              </tr>
            </thead>
            <tbody>
              ${monthRows
                .map(
                  (r) => `
                    <tr>
                      <td>${escapeHtml(`${formatDateShort(r.day_date)} (${formatWeekday(r.day_date)})`)}</td>
                      <td><span class="attendance-status status-${escapeHtml(getAttendanceStatusClassSuffix(r.status))}">${escapeHtml(r.status ?? "")}</span></td>
                      <td>${escapeHtml(r.comment ?? "")}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
    <div class="student-modal-overlay" id="excusedAppModal" hidden>
      <div class="student-modal" role="dialog" aria-modal="true" aria-labelledby="excusedTitle">
        <div class="student-modal-header">
          <div class="student-modal-title" id="excusedTitle">Excused Absence</div>
          <button class="student-modal-close" type="button" id="excusedClose" aria-label="Close">${closeIconSvg}</button>
        </div>
        <div class="student-modal-body">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="excusedDate" />
          <label class="form-label" style="margin-top:10px;">Reason</label>
          <textarea class="form-input" id="excusedReason" rows="3"></textarea>
          <label class="form-label" style="margin-top:10px;">What will you do to catch up?</label>
          <textarea class="form-input" id="excusedCatchUp" rows="3"></textarea>
          <div class="admin-msg" id="excusedMsg" style="margin-top:8px;"></div>
        </div>
        <div class="student-modal-actions">
          <button class="btn btn-primary" id="excusedSubmit">Submit</button>
        </div>
      </div>
    </div>
    <div class="student-modal-overlay" id="lateAppModal" hidden>
      <div class="student-modal" role="dialog" aria-modal="true" aria-labelledby="lateTitle">
        <div class="student-modal-header">
          <div class="student-modal-title" id="lateTitle">Late / Leave Early</div>
          <button class="student-modal-close" type="button" id="lateClose" aria-label="Close">${closeIconSvg}</button>
        </div>
        <div class="student-modal-body">
          <label class="form-label">Date</label>
          <input class="form-input" type="date" id="lateDate" />
          <label class="form-label" style="margin-top:10px;">Type</label>
          <select class="form-input" id="lateType">
            <option value="late">Late</option>
            <option value="leave_early">Leave Early</option>
          </select>
          <label class="form-label" style="margin-top:10px;" id="lateTimeLabel">Arrival Time</label>
          <input class="form-input" type="time" id="lateTime" />
          <label class="form-label" style="margin-top:10px;">Reason</label>
          <textarea class="form-input" id="lateReason" rows="3"></textarea>
          <label class="form-label" style="margin-top:10px;">What will you do to catch up?</label>
          <textarea class="form-input" id="lateCatchUp" rows="3"></textarea>
          <div class="admin-msg" id="lateMsg" style="margin-top:8px;"></div>
        </div>
        <div class="student-modal-actions">
          <button class="btn btn-primary" id="lateSubmit">Submit</button>
        </div>
      </div>
    </div>
  `;
}

export function bindAttendanceTabEvents(app) {
  const excusedModal = app.querySelector("#excusedAppModal");
  const lateModal = app.querySelector("#lateAppModal");

  app.querySelector("#attendanceMonthSelect")?.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLSelectElement)) return;
    state.attendanceMonthKey = event.target.value;
    saveState();
    triggerRender();
  });

  app.querySelectorAll("[data-att-month-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextKey = btn.getAttribute("data-att-month-target");
      if (!nextKey) return;
      state.attendanceMonthKey = nextKey;
      saveState();
      triggerRender();
    });
  });

  app.querySelector("#openExcusedApp")?.addEventListener("click", () => {
    if (excusedModal) excusedModal.hidden = false;
  });

  app.querySelector("#openLateApp")?.addEventListener("click", () => {
    if (lateModal) lateModal.hidden = false;
  });

  app.querySelector("#excusedClose")?.addEventListener("click", () => {
    if (excusedModal) excusedModal.hidden = true;
  });

  app.querySelector("#lateClose")?.addEventListener("click", () => {
    if (lateModal) lateModal.hidden = true;
  });

  app.querySelector("#lateType")?.addEventListener("change", (e) => {
    const val = e.target.value;
    const label = app.querySelector("#lateTimeLabel");
    if (label) label.textContent = val === "leave_early" ? "Leave Time" : "Arrival Time";
  });

  app.querySelector("#excusedSubmit")?.addEventListener("click", async () => {
    const date = app.querySelector("#excusedDate")?.value;
    const reason = app.querySelector("#excusedReason")?.value?.trim();
    const catchUp = app.querySelector("#excusedCatchUp")?.value?.trim();
    const msg = app.querySelector("#excusedMsg");
    if (msg) msg.textContent = "";
    if (!date || !reason) {
      if (msg) msg.textContent = "Date and reason are required.";
      return;
    }
    const { error } = await supabase.from("absence_applications").insert({
      student_id: authState.session?.user?.id ?? null,
      type: "excused",
      day_date: date,
      reason,
      catch_up: catchUp || null,
      status: "pending"
    });
    if (error) {
      if (msg) msg.textContent = `Submit failed: ${error.message}`;
      return;
    }
    if (msg) msg.textContent = "Submitted.";
    if (excusedModal) excusedModal.hidden = true;
  });

  app.querySelector("#lateSubmit")?.addEventListener("click", async () => {
    const date = app.querySelector("#lateDate")?.value;
    const type = app.querySelector("#lateType")?.value || "late";
    const timeValue = app.querySelector("#lateTime")?.value;
    const reason = app.querySelector("#lateReason")?.value?.trim();
    const catchUp = app.querySelector("#lateCatchUp")?.value?.trim();
    const msg = app.querySelector("#lateMsg");
    if (msg) msg.textContent = "";
    if (!date || !timeValue || !reason) {
      if (msg) msg.textContent = "Date, time, and reason are required.";
      return;
    }
    const { error } = await supabase.from("absence_applications").insert({
      student_id: authState.session?.user?.id ?? null,
      type: "late",
      late_type: type,
      time_value: timeValue,
      day_date: date,
      reason,
      catch_up: catchUp || null,
      status: "pending"
    });
    if (error) {
      if (msg) msg.textContent = `Submit failed: ${error.message}`;
      return;
    }
    if (msg) msg.textContent = "Submitted.";
    if (lateModal) lateModal.hidden = true;
  });

  excusedModal?.addEventListener("click", (e) => {
    if (e.target === excusedModal) excusedModal.hidden = true;
  });

  lateModal?.addEventListener("click", (e) => {
    if (e.target === lateModal) lateModal.hidden = true;
  });
}
