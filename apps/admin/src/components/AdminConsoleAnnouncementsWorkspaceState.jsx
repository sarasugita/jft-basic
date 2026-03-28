"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateTimeInput, fromBangladeshInput } from "../lib/adminFormatters";
import { recordAdminAuditEvent } from "../lib/adminAudit";

export function useAnnouncementsWorkspaceState({ supabase, activeSchoolId, session }) {
  const activeSchoolIdRef = useRef(activeSchoolId);
  useEffect(() => {
    activeSchoolIdRef.current = activeSchoolId;
  }, [activeSchoolId]);

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

  async function fetchAnnouncements() {
    const schoolIdSnapshot = activeSchoolIdRef.current;
    if (!schoolIdSnapshot) {
      setAnnouncements([]);
      setAnnouncementMsg("");
      return;
    }
    setAnnouncementMsg("Loading...");
    const { data, error } = await supabase
      .from("announcements")
      .select("id, title, body, publish_at, end_at, created_at")
      .eq("school_id", schoolIdSnapshot)
      .order("created_at", { ascending: false })
      .limit(200);
    if (schoolIdSnapshot !== activeSchoolIdRef.current) return;
    if (error) {
      console.error("announcements fetch error:", error);
      setAnnouncements([]);
      setAnnouncementMsg(`Load failed: ${error.message}`);
      return;
    }
    setAnnouncements(data ?? []);
    setAnnouncementMsg(data?.length ? "" : "No announcements.");
  }

  async function createAnnouncement() {
    setAnnouncementMsg("");
    const title = announcementForm.title.trim();
    const body = announcementForm.body.trim();
    if (!title || !body) {
      setAnnouncementMsg("Title and message are required.");
      return;
    }
    const publishAt = announcementForm.publish_at
      ? fromBangladeshInput(announcementForm.publish_at)
      : new Date().toISOString();
    const endAt = announcementForm.end_at ? fromBangladeshInput(announcementForm.end_at) : null;
    const payload = {
      title,
      body,
      publish_at: publishAt,
      end_at: endAt,
      created_by: session?.user?.id ?? null,
    };
    const { error } = await supabase.from("announcements").insert(payload);
    if (error) {
      console.error("announcement create error:", error);
      setAnnouncementMsg(`Create failed: ${error.message}`);
      return;
    }
    setAnnouncementForm({ title: "", body: "", publish_at: formatDateTimeInput(new Date()), end_at: "" });
    setAnnouncementCreateOpen(false);
    setAnnouncementMsg("Announcement created.");
    await recordAdminAuditEvent(supabase, {
      actionType: "create",
      entityType: "announcement",
      entityId: title,
      summary: `Created announcement "${title}".`,
      metadata: { title, publish_at: publishAt, end_at: endAt },
      schoolId: activeSchoolId,
    });
    fetchAnnouncements();
  }

  async function deleteAnnouncement(id) {
    if (!id) return;
    const ok = window.confirm("Delete this announcement?");
    if (!ok) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) {
      console.error("announcement delete error:", error);
      setAnnouncementMsg(`Delete failed: ${error.message}`);
      return;
    }
    fetchAnnouncements();
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
    setEditingAnnouncementForm({ title: "", body: "", publish_at: "", end_at: "" });
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
      console.error("announcement update error:", error);
      setAnnouncementMsg(`Update failed: ${error.message}`);
      return;
    }
    cancelEditAnnouncement();
    setAnnouncementMsg("Announcement updated.");
    fetchAnnouncements();
  }

  return {
    announcements,
    announcementMsg,
    announcementCreateOpen,
    announcementForm,
    setAnnouncementForm,
    editingAnnouncementId,
    editingAnnouncementForm,
    setEditingAnnouncementForm,
    fetchAnnouncements,
    createAnnouncement,
    deleteAnnouncement,
    startEditAnnouncement,
    cancelEditAnnouncement,
    openCreateAnnouncementModal,
    closeCreateAnnouncementModal,
    saveAnnouncementEdits,
  };
}
