"use client";

import { useEffect, useState } from "react";
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

export default function SuperAuditPage() {
  const { supabase } = useSuperAdmin();
  const [filters, setFilters] = useState({
    entityType: "all",
    schoolId: "all",
    ...defaultRange(),
  });
  const [logs, setLogs] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

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

    async function loadLogs() {
      setLoading(true);
      setMsg("");
      let query = supabase
        .from("audit_logs")
        .select("id, actor_user_id, actor_role, actor_email, action_type, entity_type, entity_id, school_id, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
      if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);
      if (filters.entityType !== "all") query = query.eq("entity_type", filters.entityType);
      if (filters.schoolId !== "all") query = query.eq("school_id", filters.schoolId);

      const { data, error } = await query;

      if (cancelled) return;

      if (error) {
        setLogs([]);
        setMsg(error.message || "Failed to load audit logs.");
        setLoading(false);
        return;
      }

      setLogs(data ?? []);
      setLoading(false);
    }

    loadLogs();
    return () => {
      cancelled = true;
    };
  }, [filters, supabase]);

  const schoolMap = Object.fromEntries((schools ?? []).map((school) => [school.id, school.name]));

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="admin-title">Audit / Logs</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Basic audit capture is enabled for school, school-admin, and question-set mutations.
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
            <label>Entity Type</label>
            <select
              value={filters.entityType}
              onChange={(event) => setFilters((prev) => ({ ...prev, entityType: event.target.value }))}
            >
              <option value="all">All</option>
              <option value="school">School</option>
              <option value="admin">Admin</option>
              <option value="question_set">Question Set</option>
              <option value="question_set_version">Question Set Version</option>
              <option value="question_set_visibility">Question Set Visibility</option>
            </select>
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
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </div>

      <div className="admin-panel">
        <div className="admin-table-wrap">
          <table className="admin-table" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>School</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString() : "N/A"}</td>
                  <td>
                    <div>{row.actor_email || row.actor_user_id || "N/A"}</div>
                    <div className="daily-code">{row.actor_role || "N/A"}</div>
                  </td>
                  <td>{row.action_type}</td>
                  <td>
                    <div>{row.entity_type}</div>
                    <div className="daily-code">{row.entity_id}</div>
                  </td>
                  <td>{row.school_id ? schoolMap[row.school_id] ?? row.school_id : "N/A"}</td>
                  <td>
                    <pre className="super-audit-meta">{JSON.stringify(row.metadata ?? {}, null, 2)}</pre>
                  </td>
                </tr>
              ))}
              {!loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No audit logs found for the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading audit logs...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
