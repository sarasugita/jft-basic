"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createAdminSupabaseClient } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";

function emptyForm() {
  return {
    id: "",
    email: "",
    display_name: "",
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
  const supabase = useMemo(() => createAdminSupabaseClient(), []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [school, setSchool] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [tempPassword, setTempPassword] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("school admins session error:", error);
      syncAdminAuthCookie(data?.session ?? null);
      const nextSession = data?.session ?? null;
      if (!mounted) return;
      setSession(nextSession);
      if (!nextSession) {
        router.replace("/");
        return;
      }

      const { data: nextProfile } = await supabase
        .from("profiles")
        .select("id, role, account_status")
        .eq("id", nextSession.user.id)
        .single();
      if (!mounted) return;
      setProfile(nextProfile ?? null);
      if (!nextProfile || nextProfile.role !== "super_admin" || nextProfile.account_status !== "active") {
        router.replace("/");
        return;
      }

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
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, email, role, account_status, created_at")
      .eq("school_id", schoolId)
      .eq("role", "admin")
      .order("created_at", { ascending: true });
    if (error) {
      setAdmins([]);
      setMsg(`Failed to load admins: ${error.message}`);
      return;
    }
    setAdmins(data ?? []);
  }

  useEffect(() => {
    if (!session || !school || profile?.role !== "super_admin" || profile?.account_status !== "active") return;
    reloadAdmins();
  }, [profile, school, schoolId, session, supabase]);

  function openCreateModal() {
    setForm(emptyForm());
    setTempPassword("");
    setModalOpen(true);
    setMsg("");
  }

  function openEditModal(admin) {
    setForm({
      id: admin.id,
      email: admin.email ?? "",
      display_name: admin.display_name ?? "",
    });
    setTempPassword("");
    setModalOpen(true);
    setMsg("");
  }

  async function invokeManage(payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) {
      setMsg("Session expired. Please log in again.");
      return null;
    }
    const { data, error } = await supabase.functions.invoke("manage-school-admins", {
      body: payload,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) {
      setMsg(`Action failed: ${error.message}`);
      return null;
    }
    if (data?.error) {
      setMsg(`Action failed: ${data.error}`);
      return null;
    }
    return data;
  }

  async function saveAdmin() {
    if (!form.email.trim()) {
      setMsg("Email is required.");
      return;
    }

    setSaving(true);
    setMsg("");
    const payload = form.id
      ? {
          action: "update",
          school_id: schoolId,
          user_id: form.id,
          email: form.email.trim(),
          display_name: form.display_name.trim() || null,
        }
      : {
          action: "create",
          school_id: schoolId,
          email: form.email.trim(),
          display_name: form.display_name.trim() || null,
        };
    const result = await invokeManage(payload);
    setSaving(false);
    if (!result) return;
    setModalOpen(false);
    setForm(emptyForm());
    setTempPassword(result.temp_password ?? "");
    setMsg(
      result.temp_password
        ? `Admin created. Temporary password: ${result.temp_password}`
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

  return (
    <div className="super-page">
      <div className="super-shell">
        <div className="super-hero admin-panel">
          <div>
            <div className="admin-chip">School Admin Management</div>
            <h1 className="super-title">{school.name}</h1>
            <div className="admin-help">
              Onboarding method: temporary password with forced password change on first login.
            </div>
          </div>
          <div className="admin-actions">
            <Link className="btn" href="/super/schools">Back to Schools</Link>
            <button className="btn btn-primary" onClick={openCreateModal}>Create Admin</button>
          </div>
        </div>

        <div className="admin-panel" style={{ marginTop: 12 }}>
          {msg ? <div className="admin-msg">{msg}</div> : null}
          {tempPassword ? (
            <div className="admin-help" style={{ marginTop: 8 }}>
              Last issued temporary password: <strong>{tempPassword}</strong>
            </div>
          ) : null}
          <div className="admin-table-wrap" style={{ marginTop: 12 }}>
            <table className="admin-table" style={{ minWidth: 960 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Last login</th>
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
                    <td>{admin.role}</td>
                    <td>N/A</td>
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
      </div>

      {modalOpen ? (
        <div className="admin-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div className="admin-title">{form.id ? "Edit Admin" : "Create Admin"}</div>
              <button className="admin-modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="admin-form" style={{ marginTop: 12 }}>
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
            </div>
            <div className="admin-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" disabled={saving} onClick={saveAdmin}>
                {saving ? "Saving..." : (form.id ? "Save Changes" : "Create Admin")}
              </button>
              <button className="btn" onClick={() => setModalOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
