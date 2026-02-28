"use client";

import { useEffect, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

function MetricCard({ label, value, help }) {
  return (
    <div className="super-metric-card">
      <div className="super-metric-label">{label}</div>
      <div className="super-metric-value">{value}</div>
      <div className="admin-help">{help}</div>
    </div>
  );
}

export default function SuperDashboardPage() {
  const { supabase } = useSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState({
    schools: null,
    students: null,
    attempts: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg("");

      const [schoolsRes, studentsRes, attemptsRes] = await Promise.all([
        supabase.from("schools").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student"),
        supabase.from("attempts").select("id", { count: "exact", head: true }),
      ]);

      if (cancelled) return;

      const errors = [schoolsRes.error, studentsRes.error, attemptsRes.error].filter(Boolean);
      if (errors.length) {
        setMsg(errors[0].message || "Failed to load dashboard metrics.");
      }

      setStats({
        schools: schoolsRes.count ?? null,
        students: studentsRes.count ?? null,
        attempts: attemptsRes.count ?? null,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <div className="super-page-content">
      <div className="admin-grid super-metrics-grid">
        <MetricCard
          label="Total schools"
          value={loading ? "..." : stats.schools ?? "N/A"}
          help="All schools currently registered in the platform."
        />
        <MetricCard
          label="Total students"
          value={loading ? "..." : stats.students ?? "N/A"}
          help="Student profiles across all schools."
        />
        <MetricCard
          label="Total tests taken"
          value={loading ? "..." : stats.attempts ?? "N/A"}
          help="Attempt records captured across the system."
        />
        <MetricCard
          label="Avg score"
          value="Coming soon"
          help="Global scoring summary will be wired after the new test flows settle."
        />
      </div>

      <div className="admin-panel" style={{ marginTop: 12 }}>
        <div className="admin-title">Global Summary</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          This dashboard is the global entry point for cross-school operations. More metrics will be added once the
          question-set and test-instance runtime is fully connected.
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </div>
    </div>
  );
}
