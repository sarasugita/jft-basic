import { escapeHtml } from "./escapeHtml";

export function renderLoadingIndicator(message = "Loading...") {
  return `
    <div class="student-loading-state" role="status" aria-live="polite" aria-busy="true">
      <span class="student-loading-spinner" aria-hidden="true"></span>
      <span class="student-loading-text">${escapeHtml(message)}</span>
    </div>
  `;
}
