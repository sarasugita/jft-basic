"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useRankingWorkspaceState } from "./AdminConsoleRankingWorkspaceState";

const bangladeshDateTimeOptions = {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
};

export default function AdminConsoleRankingWorkspace() {
  const { supabase, activeSchoolId, session, testSessions, tests } = useAdminConsoleWorkspaceContext();
  const {
    rankingPeriods,
    rankingDrafts,
    rankingMsg,
    rankingLoaded,
    rankingRefreshingId,
    rankingRowCount,
    rankingDetailModal,
    fetchRankingPeriods,
    addRankingPeriod,
    updateRankingDraft,
    saveRankingPeriodLabel,
    refreshRankingPeriod,
    deleteRankingPeriod,
    openRankingEntryDetail,
    closeRankingEntryDetail,
  } = useRankingWorkspaceState({ supabase, activeSchoolId, session, testSessions, tests });
  const [hoveredRankingPair, setHoveredRankingPair] = useState(null);
  const rankingHoverClearTimerRef = useRef(null);

  useEffect(() => () => {
    if (rankingHoverClearTimerRef.current) {
      window.clearTimeout(rankingHoverClearTimerRef.current);
    }
  }, []);

  function setRankingPairHover(periodId, rowIndex) {
    if (rankingHoverClearTimerRef.current) {
      window.clearTimeout(rankingHoverClearTimerRef.current);
      rankingHoverClearTimerRef.current = null;
    }
    setHoveredRankingPair({ periodId, rowIndex });
  }

  function clearRankingPairHover() {
    if (rankingHoverClearTimerRef.current) {
      window.clearTimeout(rankingHoverClearTimerRef.current);
    }
    rankingHoverClearTimerRef.current = window.setTimeout(() => {
      setHoveredRankingPair(null);
      rankingHoverClearTimerRef.current = null;
    }, 60);
  }

  useEffect(() => {
    if (!activeSchoolId) return;
    if (!rankingLoaded) {
      fetchRankingPeriods();
    }
  }, [activeSchoolId, fetchRankingPeriods, rankingLoaded]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="admin-title">Ranking</div>
          <button className="btn btn-primary admin-compact-action-btn admin-upload-cta-btn" type="button" onClick={addRankingPeriod}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M10 5v10M5 10h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Add Period
          </button>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 12 }}>
        <table className="admin-table ranking-table" style={{ minWidth: Math.max(420, 160 + rankingPeriods.length * 260) }}>
          <thead>
            <tr>
              <th rowSpan={2}>Rank</th>
              {rankingPeriods.map((period) => {
                const draft = rankingDrafts[period.id] ?? { label: period.label ?? "", start_date: "", end_date: "" };
                return (
                  <th key={period.id} colSpan={2}>
                    <div className="ranking-period-head">
                      <input
                        type="text"
                        value={draft.label}
                        onChange={(e) => updateRankingDraft(period.id, "label", e.target.value)}
                        onBlur={() => saveRankingPeriodLabel(period)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        placeholder="Period name"
                        aria-label={`Name for ${period.label}`}
                        className="admin-input"
                        style={{ minWidth: 0, width: "100%" }}
                      />
                      <button
                        className="btn btn-primary admin-icon-action-btn ranking-refresh-btn"
                        type="button"
                        aria-label={`Refresh ${draft.label || period.label || "ranking period"}`}
                        title={rankingRefreshingId === period.id ? "Refreshing..." : "Refresh period"}
                        onClick={() => refreshRankingPeriod(period)}
                        disabled={rankingRefreshingId === period.id}
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
                      <button
                        className="btn btn-danger admin-icon-action-btn ranking-delete-btn"
                        type="button"
                        aria-label={`Delete ${draft.label || period.label || "ranking period"}`}
                        title="Delete period"
                        onClick={() => deleteRankingPeriod(period)}
                        disabled={rankingRefreshingId === period.id}
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path
                            d="M6 6.5h8M8 6.5V5.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v1.3M7.5 6.5l.4 8m4.2-8-.4 8M5.8 6.5l.5 8.3c0 .7.6 1.2 1.3 1.2h4.8c.7 0 1.2-.5 1.3-1.2l.5-8.3"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                    <div className="ranking-period-range">
                      <input
                        type="date"
                        value={draft.start_date}
                        onChange={(e) => updateRankingDraft(period.id, "start_date", e.target.value)}
                      />
                      <span>to</span>
                      <input
                        type="date"
                        value={draft.end_date}
                        onChange={(e) => updateRankingDraft(period.id, "end_date", e.target.value)}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
            <tr>
              {rankingPeriods.map((period) => (
                <Fragment key={`cols-${period.id}`}>
                  <th>Student</th>
                  <th>Average %</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rankingPeriods.length && rankingRowCount ? (
              Array.from({ length: rankingRowCount }, (_, idx) => (
                <tr key={`ranking-row-${idx + 1}`}>
                  <td>{idx + 1}</td>
                  {rankingPeriods.map((period) => {
                    const entry = period.ranking_entries?.[idx] ?? null;
                    const isPairHovered = hoveredRankingPair?.periodId === period.id && hoveredRankingPair?.rowIndex === idx;
                    return (
                      <Fragment key={`${period.id}-${idx + 1}`}>
                        <td
                          className={isPairHovered ? "ranking-entry-cell is-hovered" : "ranking-entry-cell"}
                          onMouseEnter={() => setRankingPairHover(period.id, idx)}
                          onMouseLeave={clearRankingPairHover}
                        >
                          {entry ? (
                            <button
                              type="button"
                              className="ranking-entry-button"
                              onClick={() => openRankingEntryDetail(period, entry)}
                              title="View scores used for this ranking"
                            >
                              {entry.student_name || "-"}
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td
                          className={isPairHovered ? "ranking-entry-cell is-hovered" : "ranking-entry-cell"}
                          onMouseEnter={() => setRankingPairHover(period.id, idx)}
                          onMouseLeave={clearRankingPairHover}
                        >
                          {entry ? (
                            <button
                              type="button"
                              className="ranking-entry-button ranking-entry-button-average"
                              onClick={() => openRankingEntryDetail(period, entry)}
                              title="View scores used for this ranking"
                            >
                              {(Number(entry.average_rate) * 100).toFixed(2)}%
                            </button>
                          ) : (
                            "-"
                          )}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={Math.max(1, 1 + rankingPeriods.length * 2)} className="ranking-empty-cell">
                  {rankingPeriods.length ? "Press Refresh to calculate the configured periods." : "No ranking periods yet. Click Add Period."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="admin-msg">{rankingMsg}</div>
      {rankingDetailModal.open ? (
        <div className="admin-modal-overlay" onClick={closeRankingEntryDetail}>
          <div className="admin-modal ranking-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">Ranking Details</div>
              <button className="admin-modal-close" onClick={closeRankingEntryDetail} aria-label="Close">
                ×
              </button>
            </div>
            <div className="ranking-detail-summary">
              <div><strong>Period:</strong> {rankingDetailModal.periodLabel || "-"}</div>
              <div><strong>Student:</strong> {rankingDetailModal.studentName || "-"}</div>
              <div><strong>Rank:</strong> {rankingDetailModal.rankPosition != null ? `#${rankingDetailModal.rankPosition}` : "-"}</div>
              <div><strong>Average:</strong> {Number.isFinite(rankingDetailModal.averageRate) ? `${(rankingDetailModal.averageRate * 100).toFixed(2)}%` : "-"}</div>
              <div><strong>Range:</strong> {rankingDetailModal.startDate && rankingDetailModal.endDate ? `${rankingDetailModal.startDate} to ${rankingDetailModal.endDate}` : "-"}</div>
            </div>
            {rankingDetailModal.loading ? (
              <div className="ranking-detail-state">Loading scores...</div>
            ) : rankingDetailModal.error ? (
              <div className="ranking-detail-state ranking-detail-error">{rankingDetailModal.error}</div>
            ) : rankingDetailModal.usedAttempts.length ? (
              <div className="admin-table-wrap ranking-detail-table-wrap" style={{ marginTop: 12 }}>
                <table className="admin-table ranking-detail-table">
                  <thead>
                    <tr>
                      <th>Scope</th>
                      <th>Score</th>
                      <th>Correct / Total</th>
                      <th>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingDetailModal.usedAttempts.map((attempt) => {
                      const scopeLabel = attempt.scopeLabel || attempt.test_session_id || attempt.test_version || "Attempt";
                      const scoreText = attempt.absent ? "(absent)" : `${(Number(attempt.scoreRate ?? 0) * 100).toFixed(2)}%`;
                      const totalText = attempt.absent ? "-" : `${attempt.correct ?? 0} / ${attempt.total ?? 0}`;
                      const completedAtRaw = attempt.ended_at || attempt.created_at || "";
                      const completedAt = attempt.absent
                        ? "-"
                        : (completedAtRaw ? new Date(completedAtRaw).toLocaleString("en-GB", bangladeshDateTimeOptions) : "-");
                      return (
                        <tr key={attempt.id}>
                          <td>{scopeLabel}</td>
                          <td>{scoreText}</td>
                          <td>{totalText}</td>
                          <td>{completedAt}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ranking-detail-state">No scores were found in this period for this student.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
