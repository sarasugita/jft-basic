import { escapeHtml } from "../lib/escapeHtml";
import { formatDateFull } from "../lib/formatters";
import { authState } from "../state/authState";
import { rankingState } from "../state/rankingState";

export function buildRankingTabHTML() {
  if (!authState.session) {
    return `<div class="text-muted">Log in to see ranking.</div>`;
  }
  if (!authState.profile?.school_id) {
    return `<div class="text-error">${escapeHtml(authState.profileError || "School information is missing.")}</div>`;
  }
  if (rankingState.loading) {
    return `<div class="text-muted">Loading ranking...</div>`;
  }
  if (rankingState.error) {
    return `<div class="text-error">${escapeHtml(rankingState.error)}</div>`;
  }
  const periods = (rankingState.list ?? []).filter((p) => p.start_date && p.end_date);
  if (!periods.length) {
    return `<div class="text-muted">No ranking periods have been configured yet.</div>`;
  }
  return `
    <div class="student-ranking-list">
      ${periods
        .map((period) => {
          const currentEntry = period.currentEntry;
          const higherEntry = period.higherEntry;
          const lowerEntry = period.lowerEntry;
          return `
            <section class="home-card student-ranking-card">
              <div class="student-ranking-header">
                <div>
                  <div class="student-results-title">${escapeHtml(period.label || "Ranking")}</div>
                  <div class="student-info-subtitle">${escapeHtml(formatDateFull(period.start_date))} - ${escapeHtml(formatDateFull(period.end_date))}</div>
                </div>
              </div>
              ${
                currentEntry
                  ? `
                    <div class="student-ranking-main">
                      <div class="student-ranking-rank">#${currentEntry.rank_position}</div>
                      <div class="student-ranking-rate">${(Number(currentEntry.average_rate) * 100).toFixed(2)}%</div>
                    </div>
                    <div class="student-ranking-neighbors">
                      <div class="student-ranking-neighbor">
                        <div class="student-ranking-label">One rank higher</div>
                        <div class="student-ranking-name">${escapeHtml(higherEntry?.student_name || "-")}</div>
                      </div>
                      <div class="student-ranking-neighbor">
                        <div class="student-ranking-label">One rank lower</div>
                        <div class="student-ranking-name">${escapeHtml(lowerEntry?.student_name || "-")}</div>
                      </div>
                    </div>
                  `
                  : `<div class="text-muted">You are not ranked for this period yet.</div>`
              }
            </section>
          `;
        })
        .join("")}
    </div>
  `;
}

export function bindRankingTabEvents(_app) {
  // No interactive events needed for the ranking tab.
}
