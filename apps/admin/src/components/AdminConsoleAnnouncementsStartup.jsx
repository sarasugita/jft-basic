"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logAdminEvent } from "../lib/adminDiagnostics";
import AdminConsoleAnnouncementsWorkspace from "./AdminConsoleAnnouncementsWorkspace";
import { AdminConsoleWorkspaceProvider } from "./AdminConsoleWorkspaceContext";

const BD_OFFSET_MS = 6 * 60 * 60 * 1000;
const ADMIN_SUPABASE_CONFIG_ERROR = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

function formatDateTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
}

function toBangladeshInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const bdDate = new Date(date.getTime() + BD_OFFSET_MS);
  return bdDate.toISOString().slice(0, 16);
}

function fromBangladeshInput(value) {
  if (!value) return null;
  const parts = value.split("T");
  if (parts.length !== 2) return null;
  const [year, month, day] = parts[0].split("-").map((segment) => Number(segment));
  const [hour, minute] = parts[1].split(":").map((segment) => Number(segment));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 6, minute)).toISOString();
}

function formatDateTimeInput(iso) {
  return toBangladeshInput(iso);
}

export default function AdminConsoleAnnouncementsStartup({ activeSchoolId }) {
  const renderTraceLoggedRef = useRef(false);
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const supabaseRef = useRef(null);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementMsg, setAnnouncementMsg] = useState("");
  const [announcementCreateOpen, setAnnouncementCreateOpen] = useState(false);
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: formatDateTimeInput(new Date()),
    end_at: "",
  });
  const [editingAnnouncementId, setEditingAnnouncementId] = useState("");
  const [editingAnnouncementForm, setEditingAnnouncementForm] = useState({
    title: "",
    body: "",
    publish_at: "",
    end_at: "",
  });

  useEffect(() => {
    supabaseRef.current = null;
  }, [activeSchoolId]);

  const getSupabaseClient = useCallback(async () => {
    if (supabaseConfigError) {
      throw new Error(supabaseConfigError);
    }
    if (!activeSchoolId) {
      throw new Error("Select a school.");
    }
    if (supabaseRef.current) {
      return supabaseRef.current;
    }
    const { createAdminSupabaseClient } = await import("../lib/adminSupabase");
    const client = createAdminSupabaseClient({ schoolScopeId: activeSchoolId });
    supabaseRef.current = client;
    return client;
  }, [activeSchoolId, supabaseConfigError]);

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console announcements startup render start", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }

  async function fetchAnnouncements() {
    if (supabaseConfigError) {
      setAnnouncements([]);
      setAnnouncementMsg(supabaseConfigError);
      return;
    }
    setAnnouncementMsg("Loading...");
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAnnouncements([]);
      setAnnouncementMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .eq("school_id", activeSchoolId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      setAnnouncements([]);
      setAnnouncementMsg(`Load failed: ${error.message}`);
      return;
    }
    setAnnouncements(data ?? []);
    setAnnouncementMsg(data?.length ? "" : "No announcements.");
  }

  async function createAnnouncement() {
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAnnouncementMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    setAnnouncementMsg("");
    const title = announcementForm.title.trim();
    const body = announcementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const payload = {
      title,
      body,
      publish_at: announcementForm.publish_at ? fromBangladeshInput(announcementForm.publish_at) : new Date().toISOString(),
      end_at: announcementForm.end_at ? fromBangladeshInput(announcementForm.end_at) : null,
    };
    const { error } = await supabase.from("announcements").insert(payload);
    if (error) {
      setAnnouncementMsg(`Create failed: ${error.message}`);
      return;
    }
    setAnnouncementForm({
      title: "",
      body: "",
      publish_at: formatDateTimeInput(new Date()),
      end_at: "",
    });
    setAnnouncementCreateOpen(false);
    setAnnouncementMsg("Announcement created.");
    await fetchAnnouncements();
  }

  async function deleteAnnouncement(id) {
    if (!id) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAnnouncementMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    if (!window.confirm("Delete this announcement?")) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      setAnnouncementMsg(`Delete failed: ${error.message}`);
      return;
    }
    await fetchAnnouncements();
  }

  function startEditAnnouncement(announcement) {
    if (!announcement?.id) return;
    setAnnouncementMsg("");
    setEditingAnnouncementId(announcement.id);
    setEditingAnnouncementForm({
      title: announcement.title ?? "",
      body: announcement.body ?? "",
      publish_at: formatDateTimeInput(announcement.publish_at),
      end_at: announcement.end_at ? formatDateTimeInput(announcement.end_at) : "",
    });
  }

  function cancelEditAnnouncement() {
    setEditingAnnouncementId("");
    setEditingAnnouncementForm({
      title: "",
      body: "",
      publish_at: "",
      end_at: "",
    });
  }

  function openCreateAnnouncementModal() {
    setAnnouncementMsg("");
    setAnnouncementForm((current) => ({
      ...current,
      publish_at: current.publish_at || formatDateTimeInput(new Date()),
    }));
    setAnnouncementCreateOpen(true);
  }

  function closeCreateAnnouncementModal() {
    setAnnouncementCreateOpen(false);
  }

  async function saveAnnouncementEdits() {
    if (!editingAnnouncementId) return;
    let supabase = null;
    try {
      supabase = await getSupabaseClient();
    } catch (error) {
      setAnnouncementMsg(error instanceof Error ? error.message : "Failed to load school context.");
      return;
    }
    const title = editingAnnouncementForm.title.trim();
    const body = editingAnnouncementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const payload = {
      title,
      body,
      publish_at: editingAnnouncementForm.publish_at
        ? fromBangladeshInput(editingAnnouncementForm.publish_at)
        : new Date().toISOString(),
      end_at: editingAnnouncementForm.end_at ? fromBangladeshInput(editingAnnouncementForm.end_at) : null,
    };
    const { error } = await supabase
      .from("announcements")
      .update(payload)
      .eq("id", editingAnnouncementId);
    if (error) {
      setAnnouncementMsg(`Update failed: ${error.message}`);
      return;
    }
    cancelEditAnnouncement();
    setAnnouncementMsg("Announcement updated.");
    await fetchAnnouncements();
  }

  const workspaceContextValue = {
    activeSchoolId,
    fetchAnnouncements,
    announcements,
    announcementMsg,
    formatDateTime,
    startEditAnnouncement,
    deleteAnnouncement,
    announcementCreateOpen,
    closeCreateAnnouncementModal,
    announcementForm,
    setAnnouncementForm,
    createAnnouncement,
    editingAnnouncementId,
    cancelEditAnnouncement,
    editingAnnouncementForm,
    setEditingAnnouncementForm,
    saveAnnouncementEdits,
    openCreateAnnouncementModal,
  };

  return (
    <AdminConsoleWorkspaceProvider value={workspaceContextValue}>
      <AdminConsoleAnnouncementsWorkspace />
    </AdminConsoleWorkspaceProvider>
  );
}
