import { escapeHtml } from "../lib/escapeHtml";
import { formatDateShort } from "../lib/formatters";
import { renderLoadingIndicator } from "../lib/loadingIndicator";
import { state, saveState } from "../state/appState";
import { authState } from "../state/authState";
import { absenceApplicationsState, fetchAbsenceApplications } from "../state/attendanceState";
import { triggerRender } from "../lib/renderBus";

const closeIconSvg = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
  </svg>
`;

export function buildAttendanceHistoryTabHTML() {
  if (!authState.session) {
    return `<div class="text-muted">Log in to see attendance history.</div>`;
  }
  const isRefreshing = absenceApplicationsState.loading;

  const bodyHtml = absenceApplicationsState.loading
    ? renderLoadingIndicator("Loading applications...")
    : absenceApplicationsState.error
      ? `<div class="text-error">${escapeHtml(absenceApplicationsState.error)}</div>`
      : absenceApplicationsState.list.length
        ? `
          <div class="detail-table-wrap">
            <table class="detail-table application-history-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                ${absenceApplicationsState.list
                  .map((a) => {
                    const typeLabel =
                      a.type === "excused"
                        ? "Excused Absence"
                        : a.late_type === "leave_early"
                          ? "Leave Early"
                          : "Late";
                    const status = a.status || "pending";
                    const statusLabel =
                      status === "approved"
                        ? "Approved"
                        : status === "denied"
                          ? "Denied"
                          : "Pending";
                    const statusClass =
                      status === "approved"
                        ? "application-status-approved"
                        : status === "denied"
                          ? "application-status-denied"
                          : "application-status-pending";
                    const statusIcon =
                      status === "approved"
                        ? `<svg viewBox="0 0 24 24"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
                        : status === "denied"
                          ? `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6l-12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`
                          : `<svg viewBox="0 0 24 24"><path d="M12 7v6l4 2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
                    return `
                      <tr class="application-history-row" data-app-id="${escapeHtml(a.id)}">
                        <td>
                          <div class="application-history-status ${statusClass}">
                            <span class="application-status-icon">${statusIcon}</span>
                            <span>${statusLabel}</span>
                          </div>
                        </td>
                        <td>${escapeHtml(a.day_date)}</td>
                        <td>${escapeHtml(typeLabel)}</td>
                        <td>${escapeHtml(formatDateShort(a.created_at))}</td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        : `<div class="text-muted">No applications yet.</div>`;

  return `
    <section class="application-history card">
      <div class="application-history-header">
        <button class="application-history-back" type="button" id="attendanceHistoryBack" aria-label="Back">
          <svg viewBox="0 0 24 24">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <h2 class="student-home-title">Application History</h2>
        <button class="application-history-refresh" type="button" id="attendanceHistoryRefresh" aria-label="Refresh history" ${isRefreshing ? "disabled" : ""}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M16 10a6 6 0 1 1-1.76-4.24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <path
              d="M16 4.5v3.75h-3.75"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      ${bodyHtml}
    </section>
    <div class="student-modal-overlay" id="applicationDetailModal" hidden>
      <div class="student-modal" role="dialog" aria-modal="true" aria-labelledby="applicationDetailTitle">
        <div class="student-modal-header">
          <div class="student-modal-title" id="applicationDetailTitle">Application Details</div>
          <button class="student-modal-close" type="button" id="applicationDetailClose" aria-label="Close">${closeIconSvg}</button>
        </div>
        <div class="student-modal-body" id="applicationDetailBody"></div>
      </div>
    </div>
  `;
}

export function bindAttendanceHistoryTabEvents(app) {
  const detailModal = app.querySelector("#applicationDetailModal");
  const detailBody = app.querySelector("#applicationDetailBody");

  app.querySelector("#attendanceHistoryBack")?.addEventListener("click", () => {
    state.studentTab = "attendance";
    saveState();
    triggerRender();
  });

  app.querySelector("#attendanceHistoryRefresh")?.addEventListener("click", () => {
    const refresh = fetchAbsenceApplications();
    triggerRender();
    refresh.finally(triggerRender);
  });

  app.querySelector("#applicationDetailClose")?.addEventListener("click", () => {
    if (detailModal) detailModal.hidden = true;
  });

  detailModal?.addEventListener("click", (e) => {
    if (e.target === detailModal) detailModal.hidden = true;
  });

  app.querySelectorAll(".application-history-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.getAttribute("data-app-id");
      const appItem = absenceApplicationsState.list.find((a) => a.id === id);
      if (!appItem || !detailBody || !detailModal) return;
      const typeLabel =
        appItem.type === "excused"
          ? "Excused Absence"
          : appItem.late_type === "leave_early"
            ? "Leave Early"
            : "Late";
      const statusLabel =
        appItem.status === "approved"
          ? "Approved"
          : appItem.status === "denied"
            ? "Denied"
            : "Pending";
      const timeLabel =
        appItem.type === "excused"
          ? ""
          : appItem.late_type === "leave_early"
            ? "Leave Time"
            : "Arrival Time";
      detailBody.innerHTML = `
        <div class="application-detail-row">
          <div class="application-detail-label">Status</div>
          <div class="application-detail-value">${escapeHtml(statusLabel)}</div>
        </div>
        <div class="application-detail-row">
          <div class="application-detail-label">Date</div>
          <div class="application-detail-value">${escapeHtml(appItem.day_date || "")}</div>
        </div>
        <div class="application-detail-row">
          <div class="application-detail-label">Type</div>
          <div class="application-detail-value">${escapeHtml(typeLabel)}</div>
        </div>
        ${
          timeLabel
            ? `
              <div class="application-detail-row">
                <div class="application-detail-label">${escapeHtml(timeLabel)}</div>
                <div class="application-detail-value">${escapeHtml(appItem.time_value || "")}</div>
              </div>
            `
            : ""
        }
        <div class="application-detail-row">
          <div class="application-detail-label">Reason</div>
          <div class="application-detail-value">${escapeHtml(appItem.reason || "")}</div>
        </div>
        <div class="application-detail-row">
          <div class="application-detail-label">Catch Up</div>
          <div class="application-detail-value">${escapeHtml(appItem.catch_up || "")}</div>
        </div>
        ${
          appItem.admin_comment
            ? `
              <div class="application-detail-row">
                <div class="application-detail-label">Admin Comment</div>
                <div class="application-detail-value">${escapeHtml(appItem.admin_comment || "")}</div>
              </div>
            `
            : ""
        }
      `;
      detailModal.hidden = false;
    });
  });
}
