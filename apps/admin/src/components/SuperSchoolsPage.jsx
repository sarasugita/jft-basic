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
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString();
}

function getWindowEnd(school) {
  if (!school?.end_date) return new Date();
  const end = new Date(`${school.end_date}T23:59:59`);
  return Number.isNaN(end.getTime()) ? new Date() : end;
}

function isWithinSchoolWindow(isoValue, school) {
  if (!school?.start_date) return true;
  const valueDate = new Date(isoValue);
  const start = new Date(`${school.start_date}T00:00:00`);
  const end = getWindowEnd(school);
  if (Number.isNaN(valueDate.getTime()) || Number.isNaN(start.getTime())) return false;
  return valueDate >= start && valueDate <= end;
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
  const { supabase } = useSuperAdmin();
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
      const [
        schoolsRes,
        studentsRes,
        attemptsRes,
        testsRes,
        attendanceEntriesRes,
        attendanceDaysRes,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name, status, academic_year, term, start_date, end_date, created_at, updated_at")
          .order("created_at", { ascending: true }),
        supabase
          .from("profiles")
          .select("school_id")
          .eq("role", "student"),
        supabase
          .from("attempts")
          .select("school_id, test_version, score_rate, correct, total, created_at"),
        supabase
          .from("tests")
          .select("school_id, version, type"),
        supabase
          .from("attendance_entries")
          .select("school_id, status, day_id"),
        supabase
          .from("attendance_days")
          .select("id, school_id, day_date"),
      ]);

      if (cancelled) return;

      if (schoolsRes.error) {
        setMsg(`Failed to load schools: ${schoolsRes.error.message}`);
        setSchools([]);
        setLoading(false);
        return;
      }

      const studentsBySchool = {};
      for (const row of studentsRes.data ?? []) {
        if (!row.school_id) continue;
        studentsBySchool[row.school_id] = (studentsBySchool[row.school_id] ?? 0) + 1;
      }

      const schoolsById = Object.fromEntries((schoolsRes.data ?? []).map((school) => [school.id, school]));
      const testsByVersion = Object.fromEntries(
        (testsRes.data ?? []).map((test) => [test.version, { type: test.type, school_id: test.school_id }])
      );

      const dailyAccumulator = {};
      const modelAccumulator = {};
      for (const row of attemptsRes.data ?? []) {
        if (!row.school_id) continue;
        const school = schoolsById[row.school_id];
        if (!school || !isWithinSchoolWindow(row.created_at ?? new Date().toISOString(), school)) continue;
        const testMeta = testsByVersion[row.test_version];
        if (!testMeta) continue;
        const score =
          typeof row.score_rate === "number"
            ? row.score_rate
            : (row.total ? Number(row.correct ?? 0) / Number(row.total) : null);
        if (score == null || Number.isNaN(score)) continue;
        const target =
          testMeta.type === "daily"
            ? dailyAccumulator
            : testMeta.type === "mock"
              ? modelAccumulator
              : null;
        if (!target) continue;
        const prev = target[row.school_id] ?? { sum: 0, count: 0 };
        prev.sum += score;
        prev.count += 1;
        target[row.school_id] = prev;
      }

      const dailyAverageBySchool = {};
      for (const [schoolId, value] of Object.entries(dailyAccumulator)) {
        dailyAverageBySchool[schoolId] = value.count ? value.sum / value.count : null;
      }

      const modelAverageBySchool = {};
      for (const [schoolId, value] of Object.entries(modelAccumulator)) {
        modelAverageBySchool[schoolId] = value.count ? value.sum / value.count : null;
      }

      const attendanceDayMap = Object.fromEntries(
        (attendanceDaysRes.data ?? []).map((day) => [day.id, day])
      );
      const attendanceAccumulator = {};
      for (const row of attendanceEntriesRes.data ?? []) {
        if (!row.school_id) continue;
        const school = schoolsById[row.school_id];
        const day = attendanceDayMap[row.day_id];
        if (!school || !day) continue;
        if (!isWithinSchoolWindow(`${day.day_date}T12:00:00`, school)) continue;
        const prev = attendanceAccumulator[row.school_id] ?? { present: 0, total: 0 };
        prev.total += 1;
        if (row.status === "P") prev.present += 1;
        attendanceAccumulator[row.school_id] = prev;
      }

      const attendanceRateBySchool = {};
      for (const [schoolId, value] of Object.entries(attendanceAccumulator)) {
        attendanceRateBySchool[schoolId] = value.total ? value.present / value.total : null;
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

  async function saveSchool() {
    const payload = {
      name: form.name.trim(),
      status: form.status,
      academic_year: form.academic_year.trim() || null,
      term: form.term.trim() || null,
      start_date: form.start_date || new Date().toISOString().slice(0, 10),
      end_date: form.end_date || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) {
      setMsg("School name is required.");
      return;
    }

    setSaving(true);
    setMsg("");
    const query = form.id
      ? supabase.from("schools").update(payload).eq("id", form.id)
      : supabase.from("schools").insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      setMsg(`Save failed: ${error.message}`);
      return;
    }
    setModalOpen(false);
    setForm(emptyForm());
    setRefreshNonce((value) => value + 1);
  }

  async function toggleSchoolStatus(school) {
    setMsg("");
    const nextStatus = school.status === "active" ? "inactive" : "active";
    const { error } = await supabase
      .from("schools")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", school.id);
    if (error) {
      setMsg(`Status update failed: ${error.message}`);
      return;
    }
    setRefreshNonce((value) => value + 1);
  }

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <div className="admin-title">Schools Controls</div>
            <div className="admin-help">
              Search schools, update status, and enter a school-scoped admin context.
            </div>
          </div>
          <button className="btn btn-primary" onClick={openCreateModal}>Create School</button>
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
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
      </div>

      <div className="admin-panel" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="admin-title">Schools List</div>
            <div className="admin-help">
              Aggregation window defaults to school `start_date` through `end_date`, or today if `end_date` is empty.
            </div>
          </div>
          <div className="admin-chip">{filteredSchools.length} schools</div>
        </div>

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <th>Enter</th>
                <th>School</th>
                <th>Attendance Rate</th>
                <th>Daily Test</th>
                <th>Model Test</th>
                <th>Student No.</th>
                <th>Start Date</th>
                <th>End Date</th>
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
                      <div className="daily-code">
                        {[school.academic_year, school.term].filter(Boolean).join(" / ") || school.id}
                      </div>
                    </td>
                    <td>{formatPercent(summary.attendanceRate)}</td>
                    <td>{formatPercent(summary.dailyAverage)}</td>
                    <td>{formatPercent(summary.modelAverage)}</td>
                    <td>{summary.students}</td>
                    <td>{formatDate(school.start_date)}</td>
                    <td>{formatDate(school.end_date)}</td>
                    <td>
                      <span className={`super-status ${school.status}`}>{school.status}</span>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <Link className="btn" href={`/super/schools/${school.id}/admins`}>
                          Admin List
                        </Link>
                        <button className="btn" onClick={() => openEditModal(school)}>Edit</button>
                        <button className="btn" onClick={() => toggleSchoolStatus(school)}>
                          {school.status === "active" ? "Disable" : "Enable"}
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
      </div>

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
                  <option value="inactive">Inactive</option>
                </select>
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
              </div>
              <div className="field small">
                <label>End Date</label>
                <input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                />
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
