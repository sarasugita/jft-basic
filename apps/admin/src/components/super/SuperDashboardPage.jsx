"use client";

import { useEffect, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";
import AdminLoadingState from "../AdminLoadingState";

function MetricCard({ label, value, help }) {
  return (
    <div className="super-metric-card">
      <div className="super-metric-label">{label}</div>
      <div className="super-metric-value">{value}</div>
      <div className="admin-help">{help}</div>
    </div>
  );
}

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

export default function SuperDashboardPage() {
  const { supabase } = useSuperAdmin();
  const [filters, setFilters] = useState(defaultRange);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({
    total_schools: null,
    total_students: null,
    total_tests_taken: null,
    avg_score: null,
    attendance_avg: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg("");
      const { data, error } = await supabase.rpc("super_dashboard_metrics", {
        p_date_from: filters.from || null,
        p_date_to: filters.to || null,
      });

      if (cancelled) return;

      if (error) {
        setMsg(error.message || "Failed to load dashboard metrics.");
        setStats({
          total_schools: null,
          total_students: null,
          total_tests_taken: null,
          avg_score: null,
          attendance_avg: null,
        });
        setLoading(false);
        return;
      }

      setStats(data?.[0] ?? {
        total_schools: null,
        total_students: null,
        total_tests_taken: null,
        avg_score: null,
        attendance_avg: null,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [filters, supabase]);

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <div className="admin-title">Date Range</div>
            <div className="admin-help">Default range is the last 30 days.</div>
          </div>
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
        </div>
      </div>

      <div className="admin-grid super-metrics-grid">
        <MetricCard
          label="Total schools"
          value={loading ? <AdminLoadingState compact label="Loading..." /> : stats.total_schools ?? "N/A"}
          help="All registered schools."
        />
        <MetricCard
          label="Total students"
          value={loading ? <AdminLoadingState compact label="Loading..." /> : stats.total_students ?? "N/A"}
          help="Student profiles across every school."
        />
        <MetricCard
          label="Total tests taken"
          value={loading ? <AdminLoadingState compact label="Loading..." /> : stats.total_tests_taken ?? "N/A"}
          help="Attempts recorded inside the selected range."
        />
        <MetricCard
          label="Avg score"
          value={loading ? <AdminLoadingState compact label="Loading..." /> : formatPercent(stats.avg_score)}
          help="Overall average score across recorded attempts."
        />
      </div>

      <div className="admin-panel" style={{ marginTop: 12 }}>
        <div className="admin-title">Global Summary</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Attendance average is calculated from attendance entries where `P` counts as present.
        </div>
        <div className="admin-kpi" style={{ marginTop: 12 }}>
          <div className="box">
            <div className="label">Attendance Avg</div>
            <div className="value">{loading ? <AdminLoadingState compact label="Loading..." /> : formatPercent(stats.attendance_avg)}</div>
          </div>
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </div>
    </div>
  );
}
