"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./super/SuperAdminShell";
import { preloadAdminConsole, preloadAdminConsoleCore } from "./adminConsoleLoader";

function emptyForm() {
  return {
    id: "",
    name: "",
    status: "active",
    start_date: "",
    end_date: "",
  };
}

function parseSeparatedRows(text, delimiter) {
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = false;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === delimiter) {
      row.push(current);
      current = "";
      continue;
    }
    if (char === "\n") {
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }
    if (char === "\r") continue;
    current += char;
  }

  row.push(current);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => String(cell ?? "").trim().length));
}

function detectDelimiter(text) {
  const firstLine = String(text ?? "").split(/\r?\n/)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseStudentCsv(text) {
  const rows = parseSeparatedRows(text, detectDelimiter(text));
  if (rows.length === 0) return [];

  const headers = rows[0].map((value) => String(value ?? "").trim().replace(/^\uFEFF/, "").toLowerCase());
  const emailIndex = headers.indexOf("email");
  const nameIndex = headers.indexOf("display_name");
  const studentCodeIndex = headers.indexOf("student_code");
  const tempPasswordIndex = headers.indexOf("temp_password");

  if (emailIndex === -1) {
    throw new Error("CSV must include 'email' header.");
  }

  const readCell = (row, index) => (index === -1 ? "" : String(row[index] ?? "").trim());

  return rows
    .slice(1)
    .map((row) => ({
      email: readCell(row, emailIndex).toLowerCase(),
      display_name: readCell(row, nameIndex),
      student_code: readCell(row, studentCodeIndex),
      temp_password: readCell(row, tempPasswordIndex),
    }))
    .filter((student) => student.email);
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
  const router = useRouter();
  const { supabase, invokeWithAuth } = useSuperAdmin();
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
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
  const [studentCsvFile, setStudentCsvFile] = useState(null);
  const [studentCsvInputKey, setStudentCsvInputKey] = useState(0);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const schoolsAbortController = new AbortController();

    async function loadSchools() {
      setLoading(true);
      setMsg("");
      const schoolsRes = await supabase
        .from("schools")
        .select("id, name, status, academic_year, term, start_date, end_date, created_at, updated_at")
        .order("created_at", { ascending: true })
        .abortSignal(schoolsAbortController.signal);

      if (cancelled) return;

      if (schoolsRes.error) {
        setMsg(`Failed to load schools: ${schoolsRes.error.message}`);
        setSchools([]);
        setLoading(false);
        return;
      }

      setSchools(schoolsRes.data ?? []);
      setLoading(false);
    }

    void loadSchools();
    return () => {
      cancelled = true;
      schoolsAbortController.abort();
    };
  }, [refreshNonce, supabase]);

  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      setMetricsLoading(true);
      const metricsRes = await supabase.rpc("super_school_metrics_summary", {
        p_date_from: null,
        p_date_to: null,
        p_test_type: "all",
      });

      if (cancelled) return;

      if (metricsRes.error) {
        setMsg((prev) => prev || metricsRes.error.message || "Failed to load school metrics.");
        setMetricsLoading(false);
        return;
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

      setMetrics({
        studentsBySchool,
        attendanceRateBySchool,
        dailyAverageBySchool,
        modelAverageBySchool,
      });
      setMetricsLoading(false);
    }

    const schedule = typeof window !== "undefined" && "requestIdleCallback" in window
      ? window.requestIdleCallback(() => {
          void loadMetrics();
        }, { timeout: 1000 })
      : window.setTimeout(() => {
          void loadMetrics();
        }, 150);

    return () => {
      cancelled = true;
      if (typeof window !== "undefined" && "cancelIdleCallback" in window && typeof schedule === "number") {
        window.cancelIdleCallback(schedule);
      } else {
        window.clearTimeout(schedule);
      }
    };
  }, [refreshNonce, supabase]);

  const filteredSchools = useMemo(() => {
    return schools.filter((school) => {
      const matchesSearch = school.name.toLowerCase().includes(search.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || school.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [schools, search, statusFilter]);

  function resetModalState() {
    setForm(emptyForm());
    setStudentCsvFile(null);
    setStudentCsvInputKey((value) => value + 1);
    setDeleteConfirmText("");
    setDeleteConfirmOpen(false);
  }

  function closeModal() {
    setModalOpen(false);
    resetModalState();
  }

  function openCreateModal() {
    resetModalState();
    setModalOpen(true);
    setMsg("");
  }

  function openEditModal(school) {
    setForm({
      id: school.id,
      name: school.name ?? "",
      status: school.status ?? "active",
      start_date: school.start_date ?? "",
      end_date: school.end_date ?? "",
    });
    setStudentCsvFile(null);
    setStudentCsvInputKey((value) => value + 1);
    setDeleteConfirmText("");
    setDeleteConfirmOpen(false);
    setModalOpen(true);
    setMsg("");
  }

  function prefetchSchoolAdmin(schoolId) {
    if (!schoolId) return;
    router.prefetch(`/super/schools/${schoolId}/admin`);
    const preloadContext = {
      pathname: `/super/schools/${schoolId}/admin`,
      role: "super_admin",
      schoolId,
      activeSchoolId: schoolId,
    };
    void Promise.all([
      preloadAdminConsole({
        ...preloadContext,
        source: "super-schools-prefetch-wrapper",
      }),
      preloadAdminConsoleCore({
        ...preloadContext,
        source: "super-schools-prefetch-core",
      }),
    ]).catch(() => {});
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
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      updated_at: new Date().toISOString(),
    };
    if (!payload.name) {
      setMsg("School name is required.");
      return;
    }
    if (payload.start_date && payload.end_date && payload.end_date < payload.start_date) {
      setMsg("End date must be the same as or after the start date.");
      return;
    }

    setSaving(true);
    setMsg("");
    const data = await invokeManageSchools(payload);
    if (!data) {
      setSaving(false);
      return;
    }

    let nextMessage = form.id ? "School updated." : "School created.";

    if (!form.id && studentCsvFile) {
      if (payload.status !== "active") {
        nextMessage = "School created. Student import was skipped because the school is inactive.";
      } else {
        let students = [];
        try {
          students = parseStudentCsv(await studentCsvFile.text());
        } catch (csvError) {
          students = null;
          nextMessage = `School created, but the student CSV could not be read: ${String(csvError?.message ?? csvError)}`;
        }

        if (students) {
          if (students.length === 0) {
            nextMessage = "School created. No students were imported because the CSV had no data rows.";
          } else {
            let inviteData;
            let inviteError;
            try {
              ({ data: inviteData, error: inviteError } = await invokeWithAuth("invite-students", {
                school_id: data.school?.id,
                students,
              }));
            } catch (invokeError) {
              inviteError = invokeError;
            }

            if (inviteError) {
              let inviteMessage = String(inviteError?.message ?? inviteError);
              try {
                if (inviteError?.context) {
                  const errorBody = await inviteError.context.json();
                  inviteMessage = errorBody?.detail
                    ? `${errorBody.error}: ${errorBody.detail}`
                    : errorBody?.error ?? inviteMessage;
                }
              } catch {
                inviteMessage = String(inviteError?.message ?? inviteError);
              }
              nextMessage = `School created, but student import failed: ${inviteMessage}`;
            } else if (inviteData?.error) {
              nextMessage = `School created, but student import failed: ${inviteData.error}`;
            } else {
              const results = Array.isArray(inviteData?.results) ? inviteData.results : [];
              const successCount = results.filter((result) => result?.ok).length;
              const failedResults = results.filter((result) => !result?.ok);
              if (failedResults.length > 0) {
                const firstError = failedResults[0]?.error ? ` First error: ${failedResults[0].error}` : "";
                nextMessage = `School created. Imported ${successCount} students; ${failedResults.length} failed.${firstError}`;
              } else {
                nextMessage = `School created. Imported ${successCount} students.`;
              }
            }
          }
        }
      }
    }

    setSaving(false);
    closeModal();
    setMsg(nextMessage);
    setRefreshNonce((value) => value + 1);
  }

  async function deleteSchool() {
    if (!form.id) return;
    if (deleteConfirmText !== "DELETE") {
      setMsg("Type DELETE to permanently remove this school.");
      return;
    }

    setDeleting(true);
    setMsg("");
    const data = await invokeManageSchools({
      action: "delete",
      school_id: form.id,
      confirm_text: deleteConfirmText,
    });
    setDeleting(false);
    if (!data) return;

    closeModal();
    const deletedUsers = Number(data?.summary?.deletedUserCount ?? 0);
    const preservedAdmins = Number(data?.summary?.preservedAdminCount ?? 0);
    setMsg(`School deleted permanently. Removed ${deletedUsers} users and preserved ${preservedAdmins} shared admins.`);
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
          {metricsLoading ? <div className="admin-help">Loading school metrics...</div> : null}
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
                        onMouseEnter={() => prefetchSchoolAdmin(school.id)}
                        onFocus={() => prefetchSchoolAdmin(school.id)}
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
                        <button className="btn super-inline-btn" onClick={() => openEditModal(school)}>
                          <span className="super-btn-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                              <path d="m12.5 7.5 4 4" />
                            </svg>
                          </span>
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
        <div className="admin-modal-overlay" onClick={closeModal}>
          <div className="admin-modal super-school-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header super-school-modal-header">
              <div className="admin-title">{form.id ? "Edit School" : "Create School"}</div>
              <button className="admin-modal-close super-school-modal-close" onClick={closeModal} aria-label="Close">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div className="super-school-modal-body">
              <div className="super-school-modal-field">
                <label>School Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <div className="super-school-modal-grid">
                <div className="super-school-modal-field">
                  <label>Start Date</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  />
                </div>
                <div className="super-school-modal-field">
                  <label>End Date</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  />
                </div>
              </div>

              {!form.id ? (
                <div className="super-school-modal-field">
                  <label>Add Students</label>
                  <div className="super-school-upload-row">
                    <label className="super-school-upload-trigger">
                      <input
                        key={studentCsvInputKey}
                        className="super-school-upload-input"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => setStudentCsvFile(event.target.files?.[0] ?? null)}
                      />
                      <span>{studentCsvFile ? "Replace csv file" : "Select csv file"}</span>
                    </label>
                    {studentCsvFile ? <div className="super-school-upload-name">{studentCsvFile.name}</div> : null}
                  </div>
                  <div className="super-school-upload-note">
                    required: email, display_name, student_code, temp_password
                  </div>
                </div>
              ) : null}

              <div className="super-school-modal-field super-school-status-field">
                <label>Status</label>
                <div className={`super-school-status-wrap ${form.status === "inactive" ? "inactive" : "active"}`}>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              {form.id ? (
                <>
                  <div className="super-school-action-row">
                    <button
                      className="btn btn-danger super-school-action-btn super-school-secondary-action"
                      disabled={saving || deleting}
                      onClick={() => setDeleteConfirmOpen((value) => !value)}
                    >
                      Delete School
                    </button>
                    <button className="btn btn-primary super-school-action-btn super-school-submit" disabled={saving || deleting} onClick={saveSchool}>
                      {saving ? "Saving..." : "Save School"}
                    </button>
                  </div>

                  {deleteConfirmOpen ? (
                    <div className="super-school-delete-panel">
                      <label>Type DELETE to permanently delete this school and its records</label>
                      <input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="DELETE"
                      />
                      <div className="super-school-delete-actions">
                        <button
                          className="btn btn-danger super-school-action-btn super-school-delete-btn"
                          disabled={deleting || deleteConfirmText !== "DELETE"}
                          onClick={deleteSchool}
                        >
                          {deleting ? "Deleting..." : "Confirm Delete"}
                        </button>
                        <button
                          className="btn super-school-action-btn super-school-delete-cancel"
                          disabled={deleting}
                          onClick={() => {
                            setDeleteConfirmOpen(false);
                            setDeleteConfirmText("");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              {!form.id ? (
                <button className="btn btn-primary super-school-submit" disabled={saving || deleting} onClick={saveSchool}>
                  {saving ? "Saving..." : "Create School"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
