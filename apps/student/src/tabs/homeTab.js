import { escapeHtml } from "../lib/escapeHtml";
import { formatTimeBdt, formatDateShort, getBdtDateKey } from "../lib/formatters";
import { state, saveState } from "../state/appState";
import { authState } from "../state/authState";
import { testSessionsState } from "../state/testsState";
import { announcementsState } from "../state/announcementsState";
import { issuedWarningsState } from "../state/warningsState";
import { fetchSessionAttemptOverrides } from "../state/sessionOverrideState";
import { ensureSessionQuestionsAvailable } from "../state/questionsState";
import {
  isSessionAttemptAvailabilityReady,
  hasRemainingAttemptsForSession,
  canAccessSession,
} from "../lib/sessionHelpers";
import { triggerRender } from "../lib/renderBus";

export function buildHomeTabHTML() {
  const homeWarningHtml = (() => {
    const warningLines = (issuedWarningsState.list ?? [])
      .filter((warning) => Array.isArray(warning.issues) && warning.issues.length > 0)
      .map((warning) => `${warning.title || "Warning"}: ${warning.issues.join(" / ")}`);
    if (!warningLines.length) return "";
    return `
      <div class="student-warning-title">Warning</div>
      <ul class="student-warning-list">
        ${warningLines.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}
      </ul>
    `;
  })();

  const homeHtml = (() => {
    if (!testSessionsState.loaded) {
      return `<div class="text-muted">Loading today's tests...</div>`;
    }
    const todayKey = getBdtDateKey(new Date());
    const sessions = (testSessionsState.list ?? [])
      .filter((s) => s?.starts_at && s.is_published)
      .filter((s) => getBdtDateKey(s.starts_at) === todayKey)
      .sort((a, b) => {
        const aTime = new Date(a.starts_at).getTime();
        const bTime = new Date(b.starts_at).getTime();
        if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
        if (!Number.isFinite(aTime)) return 1;
        if (!Number.isFinite(bTime)) return -1;
        return aTime - bTime;
      });
    const noTestsHtml = !sessions.length
      ? `<div class="text-muted">No tests scheduled for today.</div>`
      : "";
    const nowMs = Date.now();
    return `
      <section class="home-card">
        <div class="student-home-title">Today's Tests</div>
        <div class="student-home-list">
          ${sessions
            .map((session) => {
              const startLabel = formatTimeBdt(session.starts_at);
              const name = session.title || session.problem_set_id || "Test";
              const startMs = new Date(session.starts_at).getTime();
              const endMs = session.ends_at ? new Date(session.ends_at).getTime() : NaN;
              const attemptAvailabilityReady = isSessionAttemptAvailabilityReady();
              const alreadyTaken =
                attemptAvailabilityReady && !hasRemainingAttemptsForSession(session);
              const canStart =
                attemptAvailabilityReady &&
                Number.isFinite(startMs) &&
                Number.isFinite(endMs) &&
                nowMs >= startMs &&
                nowMs < endMs &&
                !alreadyTaken;
              return `
                <div class="student-home-card">
                  <div>
                    <div class="student-home-time">${escapeHtml(startLabel)}</div>
                    <div class="student-home-name">${escapeHtml(name)}</div>
                  </div>
                  <button
                    class="student-home-start ${canStart ? "" : "disabled"}"
                    data-session-id="${escapeHtml(session.id)}"
                    ${canStart ? "" : "disabled"}
                  >
                    ${attemptAvailabilityReady ? (alreadyTaken ? "Completed" : "Start") : "Checking..."}
                  </button>
                </div>
              `;
            })
            .join("")}
        </div>
        ${noTestsHtml}
      </section>
    `;
  })();

  const announcementHtml = (() => {
    if (!announcementsState.loaded) {
      return `<div class="text-muted">Loading announcements...</div>`;
    }
    if (announcementsState.error) {
      return `<div class="text-error">${escapeHtml(announcementsState.error)}</div>`;
    }
    if (!announcementsState.list.length) {
      return `<div class="text-muted">No announcements.</div>`;
    }
    return `
      <section class="home-card">
        <div class="student-home-title student-home-title-icon">
          <span class="student-home-title-icon-svg" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M6 8a6 6 0 1 1 12 0c0 4 2 5 2 7H4c0-2 2-3 2-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
          Announcements
        </div>
        <div class="student-announcement-list">
          ${announcementsState.list
            .map(
              (a) => `
                <div class="student-announcement-card">
                  <div class="student-announcement-title">${escapeHtml(a.title)}</div>
                  <div class="student-announcement-date">${escapeHtml(formatDateShort(a.publish_at || a.created_at))}</div>
                  <div class="student-announcement-body">${escapeHtml(a.body)}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  })();

  return `
    <div class="home-stack" style="max-width:900px;">
      ${homeWarningHtml ? `<section class="home-card student-warning">${homeWarningHtml}</section>` : ""}
      ${homeHtml}
      ${announcementHtml}
    </div>
  `;
}

export function bindHomeTabEvents(app) {
  app.querySelectorAll(".student-home-start").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const sessionId = btn.dataset.sessionId;
      if (!sessionId) return;
      const session = testSessionsState.list.find((s) => s.id === sessionId);
      if (!session?.starts_at) return;
      const startMs = new Date(session.starts_at).getTime();
      const endMs = session.ends_at ? new Date(session.ends_at).getTime() : NaN;
      const now = Date.now();
      if (!Number.isFinite(startMs) || now < startMs) return;
      if (!Number.isFinite(endMs) || now >= endMs) return;
      if (authState.session) {
        await fetchSessionAttemptOverrides({ force: true });
      }
      if (!canAccessSession(session)) return;
      if (!hasRemainingAttemptsForSession(session)) return;
      if (!(await ensureSessionQuestionsAvailable(session))) return;
      if (session?.problem_set_id) state.selectedTestVersion = session.problem_set_id;
      state.selectedTestSessionId = sessionId;
      state.phase = "sectionIntro";
      state.sectionIndex = 0;
      state.questionIndexInSection = 0;
      state.sectionStartAt = null;
      state.showBangla = false;
      saveState();
      triggerRender();
    });
  });

  setTimeout(() => {
    if (state.studentTab === "home") triggerRender();
  }, 30000);
}
