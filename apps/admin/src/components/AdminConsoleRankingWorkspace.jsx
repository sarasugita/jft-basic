"use client";

import { Fragment, useEffect } from "react";
import { useAdminConsoleWorkspaceContext } from "./AdminConsoleWorkspaceContext";
import { useRankingWorkspaceState } from "./AdminConsoleRankingWorkspaceState";

export default function AdminConsoleRankingWorkspace() {
  const { supabase, activeSchoolId } = useAdminConsoleWorkspaceContext();
  const {
    rankingPeriods,
    rankingDrafts,
    rankingMsg,
    rankingRefreshingId,
    rankingRowCount,
    fetchRankingPeriods,
    addRankingPeriod,
    updateRankingDraft,
    saveRankingPeriodLabel,
    refreshRankingPeriod,
  } = useRankingWorkspaceState({ supabase, activeSchoolId });

  useEffect(() => {
    if (!activeSchoolId) return;
    fetchRankingPeriods();
  }, [activeSchoolId]);

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
                    return (
                      <Fragment key={`${period.id}-${idx + 1}`}>
                        <td>{entry?.student_name || "-"}</td>
                        <td>{entry ? `${(Number(entry.average_rate) * 100).toFixed(2)}%` : "-"}</td>
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
    </div>
  );
}
