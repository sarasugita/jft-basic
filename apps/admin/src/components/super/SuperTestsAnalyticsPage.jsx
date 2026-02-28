"use client";

import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

function toDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 29);
  return {
    from: toDateInput(from),
    to: toDateInput(now),
  };
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Math.round(Number(value) * 100)}%`;
}

export default function SuperTestsAnalyticsPage() {
  const { supabase } = useSuperAdmin();
  const [filters, setFilters] = useState({
    schoolId: "all",
    testType: "all",
    ...defaultRange(),
  });
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [schoolRows, setSchoolRows] = useState([]);
  const [performanceRows, setPerformanceRows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchools() {
      const { data } = await supabase.from("schools").select("id, name").order("name", { ascending: true });
      if (cancelled) return;
      setSchools(data ?? []);
    }

    loadSchools();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      setLoading(true);
      setMsg("");

      const schoolIdParam = filters.schoolId === "all" ? null : filters.schoolId;

      const [summaryRes, performanceRes] = await Promise.all([
        supabase.rpc("super_school_metrics_summary", {
          p_date_from: filters.from || null,
          p_date_to: filters.to || null,
          p_test_type: filters.testType,
        }),
        supabase.rpc("super_question_set_performance", {
          p_date_from: filters.from || null,
          p_date_to: filters.to || null,
          p_school_id: schoolIdParam,
          p_test_type: filters.testType,
        }),
      ]);

      if (cancelled) return;

      if (summaryRes.error || performanceRes.error) {
        setMsg(summaryRes.error?.message || performanceRes.error?.message || "Failed to load analytics.");
        setSchoolRows([]);
        setPerformanceRows([]);
        setLoading(false);
        return;
      }

      const schoolMap = Object.fromEntries((schools ?? []).map((school) => [school.id, school.name]));
      const nextSchoolRows = (summaryRes.data ?? [])
        .filter((row) => filters.schoolId === "all" || row.school_id === filters.schoolId)
        .map((row) => ({
          ...row,
          school_name: schoolMap[row.school_id] ?? row.school_id,
        }));

      const nextPerformanceRows = (performanceRes.data ?? [])
        .filter((row) => filters.schoolId === "all" || row.school_id === filters.schoolId)
        .map((row) => ({
          ...row,
          school_name: row.school_id ? schoolMap[row.school_id] ?? row.school_id : "All schools",
        }));

      setSchoolRows(nextSchoolRows);
      setPerformanceRows(nextPerformanceRows);
      setLoading(false);
    }

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [filters, schools, supabase]);

  const visiblePerformanceRows = useMemo(() => performanceRows.slice(0, 50), [performanceRows]);

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="admin-title">Analytics Filters</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Real aggregate data is shown below. Question-level accuracy for the new question-set runtime remains a TODO.
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>Date From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>Date To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>School</label>
            <select
              value={filters.schoolId}
              onChange={(event) => setFilters((prev) => ({ ...prev, schoolId: event.target.value }))}
            >
              <option value="all">All schools</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
          <div className="field small">
            <label>Test Type</label>
            <select
              value={filters.testType}
              onChange={(event) => setFilters((prev) => ({ ...prev, testType: event.target.value }))}
            >
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="model">Model</option>
            </select>
          </div>
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </div>

      <div className="admin-panel">
        <div className="admin-title">School Comparison</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Student count is all-time. Test counts and averages use the selected date range and test-type filter.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>School</th>
                <th>Student Count</th>
                <th>Tests Taken</th>
                <th>Avg Score (Daily)</th>
                <th>Avg Score (Model)</th>
                <th>Attendance Avg</th>
              </tr>
            </thead>
            <tbody>
              {schoolRows.map((row) => (
                <tr key={row.school_id}>
                  <td>{row.school_name}</td>
                  <td>{row.student_count ?? 0}</td>
                  <td>{row.tests_taken ?? 0}</td>
                  <td>{formatPercent(row.daily_avg)}</td>
                  <td>{formatPercent(row.model_avg)}</td>
                  <td>{formatPercent(row.attendance_avg)}</td>
                </tr>
              ))}
              {!loading && schoolRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No school analytics found for the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading analytics...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-title">Question Set Performance</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          New question-set runtime data appears here when attempts are linked. Legacy tests are shown as fallback.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>School</th>
                <th>Test Type</th>
                <th>Attempts</th>
                <th>Avg Score</th>
              </tr>
            </thead>
            <tbody>
              {visiblePerformanceRows.map((row) => (
                <tr key={`${row.entity_id}-${row.school_id ?? "all"}`}>
                  <td>{row.title}</td>
                  <td>{row.source_type}</td>
                  <td>{row.school_name}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.normalized_test_type ?? "N/A"}</td>
                  <td>{row.attempts_count ?? 0}</td>
                  <td>{formatPercent(row.avg_score)}</td>
                </tr>
              ))}
              {!loading && visiblePerformanceRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No question-set performance rows found for the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading question-set performance...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="super-placeholder-block">
        <div className="admin-title">Question Accuracy</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          TODO: expose per-question accuracy once the new question-set runtime stores question-level result facts in a
          queryable form. The filters and layout are already in place.
        </div>
      </div>
    </div>
  );
}
