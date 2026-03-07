"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./super/SuperAdminShell";

function emptyForm() {
  return {
    id: "",
    name: "",
    status: "active",
    academic_year: "",
    term: "",
    start_date: "",
    end_date: "",
  };
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function formatDate(value) {
  if (!value) return "N/A";
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : "N/A";
}

function computeSummary(schoolId, metrics) {
  return {
    students: metrics.studentsBySchool[schoolId] ?? 0,
    attendanceRate: metrics.attendanceRateBySchool[schoolId] ?? null,
    dailyAverage: metrics.dailyAverageBySchool[schoolId] ?? null,
    modelAverage: metrics.modelAverageBySchool[schoolId] ?? null,
  };
}

export default function SuperSchoolsPage() {
  const { supabase, invokeWithAuth } = useSuperAdmin();
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [metrics, setMetrics] = useState({
    studentsBySchool: {},
    attendanceRateBySchool: {},
    dailyAverageBySchool: {},
    modelAverageBySchool: {},
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg("");
      const [schoolsRes, metricsRes] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name, status, academic_year, term, start_date, end_date, created_at, updated_at")
          .order("created_at", { ascending: true }),
        supabase.rpc("super_school_metrics_summary", {
          p_date_from: null,
          p_date_to: null,
          p_test_type: "all",
        }),
      ]);

      if (cancelled) return;

      if (schoolsRes.error) {
        setMsg(`Failed to load schools: ${schoolsRes.error.message}`);
        setSchools([]);
        setLoading(false);
        return;
      }

      if (metricsRes.error) {
        setMsg(metricsRes.error.message || "Failed to load school metrics.");
      }

      const studentsBySchool = {};
      const attendanceRateBySchool = {};
      const dailyAverageBySchool = {};
      const modelAverageBySchool = {};
      for (const row of metricsRes.data ?? []) {
        studentsBySchool[row.school_id] = Number(row.student_count ?? 0);
        attendanceRateBySchool[row.school_id] = row.attendance_avg ?? null;
        dailyAverageBySchool[row.school_id] = row.daily_avg ?? null;
        modelAverageBySchool[row.school_id] = row.model_avg ?? null;
      }

      setSchools(schoolsRes.data ?? []);
      setMetrics({
        studentsBySchool,
        attendanceRateBySchool,
        dailyAverageBySchool,
        modelAverageBySchool,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce, supabase]);

  const filteredSchools = useMemo(() => {
    return schools.filter((school) => {
      const matchesSearch = school.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || school.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [schools, search, statusFilter]);

  function openCreateModal() {
    setForm(emptyForm());
    setModalOpen(true);
    setMsg("");
  }

  function openEditModal(school) {
    setForm({
      id: school.id,
      name: school.name ?? "",
      status: school.status ?? "active",
      academic_year: school.academic_year ?? "",
      term: school.term ?? "",
      start_date: school.start_date ?? "",
      end_date: school.end_date ?? "",
    });
    setModalOpen(true);
    setMsg("");
  }

  async function invokeManageSchools(payload) {
    let data;
    let error;
    try {
      ({ data, error } = await invokeWithAuth("manage-schools", payload));
    } catch (invokeError) {
      setMsg(`Save failed: ${String(invokeError.message ?? invokeError)}`);
      return null;
    }

    if (error) {
      let serverMessage = "";
      try {
        if (error.context) {
          const errorBody = await error.context.json();
          serverMessage = errorBody?.detail
            ? `${errorBody.error}: ${errorBody.detail}`
            : errorBody?.error ?? "";
        }
      } catch {
        serverMessage = "";
      }
      setMsg(`Save failed: ${serverMessage || error.message}`);
      return null;
    }

    if (data?.error) {
      setMsg(`Save failed: ${data.detail ? `${data.error}: ${data.detail}` : data.error}`);
      return null;
    }

    return data;
  }

  async function saveSchool() {
    const payload = {
      action: form.id ? "update" : "create",
      school_id: form.id || undefined,
      name: form.name.trim(),
      status: form.status,
      academic_year: form.academic_year.trim() || null,
      term: form.term.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) {
      setMsg("School name is required.");
      return;
    }

    setSaving(true);
    setMsg("");
    const data = await invokeManageSchools(payload);
    setSaving(false);
    if (!data) return;
    setModalOpen(false);
    setForm(emptyForm());
    setRefreshNonce((value) => value + 1);
  }

  async function toggleSchoolStatus(school) {
    setMsg("");
    const nextStatus = school.status === "active" ? "inactive" : "active";
    const data = await invokeManageSchools({
      action: "set_status",
      school_id: school.id,
      status: nextStatus,
    });
    if (!data) return;
    setRefreshNonce((value) => value + 1);
  }

  return (
    <div className="super-page-content">
      <section className="super-flat-section super-search-section">
        <div className="super-schools-filter-grid">
          <div className="field">
            <label>Search</label>
            <input
              type="search"
              placeholder="Search by school name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field small">
            <label>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </section>

      <section className="super-flat-section super-schools-list-section">
        <div className="super-schools-list-head">
          <div className="super-section-title">Schools List</div>
          <button className="btn btn-primary super-create-school-btn" onClick={openCreateModal}>
            <span className="super-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            Add New School
          </button>
        </div>

        <div className="admin-table-wrap super-schools-table-wrap">
          <table className="admin-table super-schools-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th>Enter</th>
                <th>School Name</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th style={{ width: 92 }}>Student<br />No.</th>
                <th>Attendance</th>
                <th>Model<br />Test Avg.</th>
                <th>Daily<br />Test Avg.</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.map((school) => {
                const summary = computeSummary(school.id, metrics);
                return (
                  <tr key={school.id}>
                    <td>
                      <Link
                        className="super-enter-btn"
                        href={`/super/schools/${school.id}/admin`}
                        aria-label={`Enter ${school.name}`}
                        title={`Enter ${school.name}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M9 6l6 6-6 6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    </td>
                    <td>
                      <div className="daily-name">{school.name}</div>
                    </td>
                    <td>{formatDate(school.start_date)}</td>
                    <td>{formatDate(school.end_date)}</td>
                    <td>{summary.students}</td>
                    <td>{formatPercent(summary.attendanceRate)}</td>
                    <td>{formatPercent(summary.modelAverage)}</td>
                    <td>{formatPercent(summary.dailyAverage)}</td>
                    <td>
                      <span className={`super-status ${school.status}`}>{school.status}</span>
                    </td>
                    <td>
                      <div className="super-row-actions">
                        <Link className="btn super-inline-btn" href={`/super/schools/${school.id}/admins`}>
                          <span className="super-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" stroke="none" />
                              <path d="M4 20a8 8 0 0 1 16 0Z" fill="currentColor" stroke="none" />
                            </svg>
                          </span>
                          Admin List
                        </Link>
                        <button className="super-edit-link" onClick={() => openEditModal(school)}>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              d="M4 20h4l10-10-4-4L4 16v4Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="m12.5 7.5 4 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && filteredSchools.length === 0 ? (
                <tr>
                  <td colSpan={10}>No schools found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {modalOpen ? (
        <div className="admin-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">{form.id ? "Edit School" : "Create School"}</div>
              <button className="admin-modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="admin-form" style={{ marginTop: 12 }}>
              <div className="field">
                <label>School Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive / Deactivated</option>
                </select>
                <div className="admin-help">Use this field to deactivate or reactivate the school.</div>
              </div>
              <div className="field small">
                <label>Academic Year</label>
                <input
                  value={form.academic_year}
                  onChange={(e) => setForm((prev) => ({ ...prev, academic_year: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Term</label>
                <input
                  value={form.term}
                  onChange={(e) => setForm((prev) => ({ ...prev, term: e.target.value }))}
                />
              </div>
              <div className="field small">
                <label>Start Date</label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                />
                <div className="admin-help">Optional.</div>
              </div>
              <div className="field small">
                <label>End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                />
                <div className="admin-help">Optional.</div>
              </div>
            </div>
            <div className="admin-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={saving} onClick={saveSchool}>
                {saving ? "Saving..." : (form.id ? "Save Changes" : "Create School")}
              </button>
              <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
