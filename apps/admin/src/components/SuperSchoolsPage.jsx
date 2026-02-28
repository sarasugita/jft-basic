"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminSupabaseClient } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";

function emptyForm() {
  return {
    id: "",
    name: "",
    status: "active",
    academic_year: "",
    term: "",
  };
}

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return "N/A";
  return `${Math.round(value * 100)}%`;
}

function computeSummary(schoolId, metrics) {
  const students = metrics.studentsBySchool[schoolId] ?? 0;
  const testSessions = metrics.sessionsBySchool[schoolId] ?? 0;
  const averageScore = metrics.averageScoreBySchool[schoolId] ?? null;
  const attendanceRate = metrics.attendanceRateBySchool[schoolId] ?? null;
  return { students, testSessions, averageScore, attendanceRate };
}

export default function SuperSchoolsPage() {
  const router = useRouter();
  const supabase = useMemo(() => createAdminSupabaseClient(), []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [metrics, setMetrics] = useState({
    studentsBySchool: {},
    sessionsBySchool: {},
    averageScoreBySchool: {},
    attendanceRateBySchool: {},
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error("super getSession error:", error);
      syncAdminAuthCookie(data?.session ?? null);
      const nextSession = data?.session ?? null;
      setSession(nextSession);
      if (!nextSession) {
        router.replace("/");
        return;
      }
      const { data: nextProfile, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, display_name")
        .eq("id", nextSession.user.id)
        .single();
      if (profileError || !nextProfile) {
        console.error("super profile error:", profileError);
        router.replace("/");
        return;
      }
      setProfile(nextProfile);
      if (nextProfile.role !== "super_admin") {
        router.replace("/");
        return;
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      syncAdminAuthCookie(nextSession ?? null);
      setSession(nextSession ?? null);
      if (!nextSession) {
        setProfile(null);
        router.replace("/");
        return;
      }
      const { data: nextProfile } = await supabase
        .from("profiles")
        .select("id, role, display_name")
        .eq("id", nextSession.user.id)
        .single();
      setProfile(nextProfile ?? null);
      if (!nextProfile || nextProfile.role !== "super_admin") {
        router.replace("/");
      }
    });

    return () => listener.subscription.unsubscribe();
  }, [router, supabase]);

  useEffect(() => {
    if (!session || profile?.role !== "super_admin") return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg("");
      const [
        schoolsRes,
        studentsRes,
        sessionsRes,
        attemptsRes,
        attendanceRes,
      ] = await Promise.all([
        supabase
          .from("schools")
          .select("id, name, status, academic_year, term, created_at, updated_at")
          .order("created_at", { ascending: true }),
        supabase
          .from("profiles")
          .select("school_id")
          .eq("role", "student"),
        supabase
          .from("test_sessions")
          .select("school_id, id"),
        supabase
          .from("attempts")
          .select("school_id, score_rate, correct, total"),
        supabase
          .from("attendance_entries")
          .select("school_id, status"),
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

      const sessionsBySchool = {};
      for (const row of sessionsRes.data ?? []) {
        if (!row.school_id) continue;
        sessionsBySchool[row.school_id] = (sessionsBySchool[row.school_id] ?? 0) + 1;
      }

      const scoreAccumulator = {};
      for (const row of attemptsRes.data ?? []) {
        if (!row.school_id) continue;
        const score =
          typeof row.score_rate === "number"
            ? row.score_rate
            : (row.total ? Number(row.correct ?? 0) / Number(row.total) : null);
        if (score == null || Number.isNaN(score)) continue;
        const prev = scoreAccumulator[row.school_id] ?? { sum: 0, count: 0 };
        prev.sum += score;
        prev.count += 1;
        scoreAccumulator[row.school_id] = prev;
      }

      const averageScoreBySchool = {};
      for (const [schoolId, value] of Object.entries(scoreAccumulator)) {
        averageScoreBySchool[schoolId] = value.count ? value.sum / value.count : null;
      }

      const attendanceAccumulator = {};
      for (const row of attendanceRes.data ?? []) {
        if (!row.school_id) continue;
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
        sessionsBySchool,
        averageScoreBySchool,
        attendanceRateBySchool,
      });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [profile, refreshNonce, session, supabase]);

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

  if (!session || !profile) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div className="super-page">
      <div className="super-shell">
        <div className="super-hero admin-panel">
          <div>
            <div className="admin-chip">Super Admin</div>
            <h1 className="super-title">Schools</h1>
            <div className="admin-help">
              Search schools, update status, and enter a school-scoped admin context.
            </div>
          </div>
          <div className="admin-actions">
            <button className="btn btn-primary" onClick={openCreateModal}>Create School</button>
            <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        <div className="admin-panel" style={{ marginTop: 12 }}>
          <div className="admin-form">
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
                Attendance rate uses `P / total attendance entries`. Period shows academic year and term when available.
              </div>
            </div>
            <div className="admin-chip">{filteredSchools.length} schools</div>
          </div>

          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 1200 }}>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Status</th>
                  <th>Students</th>
                  <th>Test Sessions</th>
                  <th>Average Score</th>
                  <th>Attendance Rate</th>
                  <th>Period</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSchools.map((school) => {
                  const summary = computeSummary(school.id, metrics);
                  const period = [school.academic_year, school.term].filter(Boolean).join(" / ") || "N/A";
                  return (
                    <tr key={school.id}>
                      <td>
                        <div className="daily-name">{school.name}</div>
                        <div className="daily-code">{school.id}</div>
                      </td>
                      <td>
                        <span className={`super-status ${school.status}`}>{school.status}</span>
                      </td>
                      <td>{summary.students}</td>
                      <td>{summary.testSessions}</td>
                      <td>{formatPercent(summary.averageScore)}</td>
                      <td>{formatPercent(summary.attendanceRate)}</td>
                      <td>{period}</td>
                      <td>
                        <div className="admin-actions">
                          <Link className="btn btn-primary" href={`/super/schools/${school.id}/admin`}>
                            Enter
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
                    <td colSpan={8}>No schools found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
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
