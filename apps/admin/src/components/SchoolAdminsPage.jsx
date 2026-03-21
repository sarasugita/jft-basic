"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSuperAdmin } from "./super/SuperAdminShell";

function generateTempPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function emptyForm() {
  return {
    id: "",
    email: "",
    display_name: "",
    temp_password: generateTempPassword(),
    existing_admin_id: "",
  };
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString();
}

export default function SchoolAdminsPage({ schoolId }) {
  const router = useRouter();
  const { supabase, invokeWithAuth } = useSuperAdmin();
  const [school, setSchool] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState("create");
  const [form, setForm] = useState(emptyForm());
  const [tempPassword, setTempPassword] = useState("");
  const [copyMsg, setCopyMsg] = useState("");
  const [existingAdmins, setExistingAdmins] = useState([]);
  const [existingAdminsLoading, setExistingAdminsLoading] = useState(false);

  const assignedAdminIds = useMemo(() => admins.map((admin) => admin.id), [admins]);

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      const { data: schoolRow, error: schoolError } = await supabase
        .from("schools")
        .select("id, name, status")
        .eq("id", schoolId)
        .single();
      if (!mounted) return;
      if (schoolError || !schoolRow) {
        router.replace("/super/schools");
        return;
      }
      setSchool(schoolRow);
      setLoading(false);
    }

    loadContext();
    return () => {
      mounted = false;
    };
  }, [router, schoolId, supabase]);

  async function reloadAdmins() {
    const { data: assignments, error: assignmentError } = await supabase
      .from("admin_school_assignments")
      .select("admin_user_id, school_id, is_primary, created_at")
      .eq("school_id", schoolId)
      .order("created_at", { ascending: true });
    if (assignmentError) {
      setAdmins([]);
      setMsg(`Failed to load admins: ${assignmentError.message}`);
      return;
    }

    const adminIds = Array.from(new Set((assignments ?? []).map((row) => row.admin_user_id).filter(Boolean)));
    if (adminIds.length === 0) {
      setAdmins([]);
      return;
    }

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, email, role, school_id, account_status, created_at")
      .in("id", adminIds)
      .eq("role", "admin")
      .order("created_at", { ascending: true });
    if (profileError) {
      setAdmins([]);
      setMsg(`Failed to load admins: ${profileError.message}`);
      return;
    }

    const primarySchoolIds = Array.from(
      new Set((profiles ?? []).map((profile) => profile.school_id).filter(Boolean)),
    );
    let schoolNameMap = {};
    if (primarySchoolIds.length > 0) {
      const { data: schoolsData } = await supabase
        .from("schools")
        .select("id, name")
        .in("id", primarySchoolIds);
      schoolNameMap = Object.fromEntries((schoolsData ?? []).map((row) => [row.id, row.name]));
    }

    const assignmentMap = new Map((assignments ?? []).map((row) => [row.admin_user_id, row]));
    const list = (profiles ?? []).map((profile) => {
      const assignment = assignmentMap.get(profile.id);
      const isPrimaryForThisSchool = profile.school_id === schoolId;
      return {
        ...profile,
        assignment_created_at: assignment?.created_at ?? null,
        is_primary_for_school: isPrimaryForThisSchool,
        primary_school_name: schoolNameMap[profile.school_id] ?? "N/A",
      };
    });
    setAdmins(list);
  }

  useEffect(() => {
    if (!school) return;
    reloadAdmins();
  }, [school, schoolId, supabase]);

  async function loadExistingAdmins() {
    setExistingAdminsLoading(true);
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, email, role, school_id, account_status, created_at")
      .eq("role", "admin")
      .order("created_at", { ascending: true });

    if (profileError) {
      setExistingAdmins([]);
      setMsg(`Failed to load existing admins: ${profileError.message}`);
      setExistingAdminsLoading(false);
      return;
    }

    const filtered = (profiles ?? []).filter((profile) => !assignedAdminIds.includes(profile.id));
    const schoolIds = Array.from(new Set(filtered.map((profile) => profile.school_id).filter(Boolean)));
    let schoolMap = {};
    if (schoolIds.length > 0) {
      const { data: schoolsData } = await supabase
        .from("schools")
        .select("id, name")
        .in("id", schoolIds);
      schoolMap = Object.fromEntries((schoolsData ?? []).map((row) => [row.id, row.name]));
    }

    setExistingAdmins(
      filtered.map((profile) => ({
        ...profile,
        primary_school_name: schoolMap[profile.school_id] ?? "N/A",
      })),
    );
    setExistingAdminsLoading(false);
  }

  function openCreateModal() {
    setModalMode("create");
    setForm(emptyForm());
    setTempPassword("");
    setCopyMsg("");
    setModalOpen(true);
    setMsg("");
  }

  function openEditModal(admin) {
    setModalMode("edit");
    setForm({
      id: admin.id,
      email: admin.email ?? "",
      display_name: admin.display_name ?? "",
      temp_password: "",
      existing_admin_id: "",
    });
    setTempPassword("");
    setCopyMsg("");
    setModalOpen(true);
    setMsg("");
  }

  async function openAssignModal() {
    setModalMode("assign");
    setForm({
      id: "",
      email: "",
      display_name: "",
      temp_password: "",
      existing_admin_id: "",
    });
    setTempPassword("");
    setCopyMsg("");
    setModalOpen(true);
    setMsg("");
    await loadExistingAdmins();
  }

  async function copyTempPassword() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopyMsg("Copied.");
    } catch {
      setCopyMsg("Copy failed.");
    }
  }

  async function invokeManage(payload) {
    let data;
    let error;
    try {
      ({ data, error } = await invokeWithAuth("manage-school-admins", payload));
    } catch (invokeError) {
      setMsg(`Action failed: ${String(invokeError.message ?? invokeError)}`);
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
      setMsg(`Action failed: ${serverMessage || error.message}`);
      return null;
    }
    if (data?.error) {
      setMsg(`Action failed: ${data.error}`);
      return null;
    }
    return data;
  }

  async function saveAdmin() {
    if (modalMode === "assign") {
      if (!form.existing_admin_id) {
        setMsg("Select an existing admin.");
        return;
      }
    } else if (!form.email.trim()) {
      setMsg("Email is required.");
      return;
    }

    setSaving(true);
    setMsg("");
    const payload =
      modalMode === "edit"
        ? {
            action: "update",
            school_id: schoolId,
            user_id: form.id,
            email: form.email.trim(),
            display_name: form.display_name.trim() || null,
          }
        : modalMode === "assign"
        ? {
            action: "attach_existing",
            school_id: schoolId,
            user_id: form.existing_admin_id,
          }
        : {
            action: "create",
            school_id: schoolId,
            email: form.email.trim(),
            display_name: form.display_name.trim() || null,
            temp_password: form.temp_password.trim(),
          };

    const result = await invokeManage(payload);
    setSaving(false);
    if (!result) return;
    setModalOpen(false);
    setForm(emptyForm());
    setTempPassword(result.temp_password ?? "");
    setCopyMsg("");
    setMsg(
      result.temp_password
        ? `Admin created. Temporary password: ${result.temp_password}`
        : modalMode === "assign"
        ? "Existing admin added to this school."
        : "Admin updated."
    );
    await reloadAdmins();
  }

  async function toggleAdminStatus(admin) {
    setMsg("");
    const nextStatus = admin.account_status === "active" ? "disabled" : "active";
    const result = await invokeManage({
      action: "set_status",
      school_id: schoolId,
      user_id: admin.id,
      account_status: nextStatus,
    });
    if (!result) return;
    setMsg(`Admin ${nextStatus === "active" ? "enabled" : "disabled"}.`);
    await reloadAdmins();
  }

  if (loading || !school) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  const selectedExistingAdmin = existingAdmins.find((admin) => admin.id === form.existing_admin_id) ?? null;
  const modalTitle =
    modalMode === "assign" ? "Add Existing Admin" : modalMode === "edit" ? "Edit Admin" : "Create Admin";
  const modalActionLabel =
    modalMode === "assign" ? "Add Admin to School" : modalMode === "edit" ? "Save Changes" : "Create Admin";

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <Link
              className="btn super-school-admin-back-link"
              href="/super/schools"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18 }}>
                <path
                  d="m15 6-6 6 6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Back to Schools</span>
            </Link>
            <div className="super-inline-title" style={{ marginTop: 0 }}>{school.name}</div>
            <div className="admin-help">
              New admins receive a temporary password and must change it on first login.
            </div>
          </div>
          <div className="admin-actions">
            <button className="btn" onClick={openAssignModal}>Add Existing Admin</button>
            <button className="btn btn-primary" onClick={openCreateModal}>Create Admin</button>
          </div>
        </div>

        {msg ? <div className="admin-msg">{msg}</div> : null}
        {tempPassword ? (
          <div className="admin-help" style={{ marginTop: 8 }}>
            Last issued temporary password: <strong>{tempPassword}</strong>
            <button className="btn" style={{ marginLeft: 8 }} onClick={copyTempPassword}>
              Copy
            </button>
            {copyMsg ? <span style={{ marginLeft: 8 }}>{copyMsg}</span> : null}
          </div>
        ) : null}
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 1080 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Access</th>
                <th>Primary School</th>
                <th>Created at</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => (
                <tr key={admin.id}>
                  <td>{admin.display_name || "N/A"}</td>
                  <td>{admin.email || "N/A"}</td>
                  <td>
                    <span className={`super-status ${admin.account_status === "active" ? "active" : "inactive"}`}>
                      {admin.account_status}
                    </span>
                  </td>
                  <td>{admin.is_primary_for_school ? "Primary" : "Shared"}</td>
                  <td>{admin.primary_school_name || "N/A"}</td>
                  <td>{formatDateTime(admin.created_at)}</td>
                  <td>
                    <div className="admin-actions">
                      <button className="btn" onClick={() => openEditModal(admin)}>Edit</button>
                      <button className="btn" onClick={() => toggleAdminStatus(admin)}>
                        {admin.account_status === "active" ? "Disable" : "Enable"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {admins.length === 0 ? (
                <tr>
                  <td colSpan={7}>No school admins yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen ? (
        <div className="admin-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">{modalTitle}</div>
              <button className="admin-modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>

            {modalMode === "assign" ? (
              <>
                <div className="admin-form super-school-admin-form" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>Existing Admin</label>
                    <select
                      value={form.existing_admin_id}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, existing_admin_id: event.target.value }))
                      }
                    >
                      <option value="">Select an admin</option>
                      {existingAdmins.map((admin) => (
                        <option key={admin.id} value={admin.id}>
                          {admin.display_name || admin.email || admin.id}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="admin-help" style={{ marginTop: 10 }}>
                  {existingAdminsLoading
                    ? "Loading available admins..."
                    : "Select an existing admin from another school to add them here as a shared admin."}
                </div>
              </>
            ) : (
              <>
                <div className="admin-form super-school-admin-form" style={{ marginTop: 12 }}>
                  <div className="field">
                    <label>Name</label>
                    <input
                      value={form.display_name}
                      onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
                    />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                    />
                  </div>
                  {modalMode === "create" ? (
                    <div className="field">
                      <label>Temporary Password</label>
                      <input
                        placeholder="Leave blank to auto-generate"
                        value={form.temp_password}
                        onChange={(event) => setForm((prev) => ({ ...prev, temp_password: event.target.value }))}
                      />
                      <div className="admin-help">Optional. The server will generate one if empty.</div>
                    </div>
                  ) : null}
                </div>
                {modalMode === "create" ? (
                  <div className="super-school-admin-modal-actions" style={{ marginTop: 10, justifyContent: "flex-start" }}>
                    <button
                      className="btn"
                      onClick={() => setForm((prev) => ({ ...prev, temp_password: generateTempPassword() }))}
                    >
                      Regenerate Temp Password
                    </button>
                  </div>
                ) : null}
              </>
            )}

            <div className="super-school-admin-modal-actions" style={{ marginTop: 16 }}>
              <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || existingAdminsLoading} onClick={saveAdmin}>
                {saving ? "Saving..." : modalActionLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
