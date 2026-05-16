"use client";

import { useEffect, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";
import AdminLoadingState from "../AdminLoadingState";
import { useLanguage } from "../../lib/i18n";

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

function toTitleCase(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function translateAuditSummaryText(value, t) {
  const summary = String(value ?? "").trim();
  if (!summary) return summary;

  const patterns = [
    [/^Created announcement "(.+)"\.$/, (_match, title) => `お知らせ「${title}」を${t("Created")}しました。`],
    [/^Saved attendance for (.+)\.$/, (_match, date) => `${date}の${t("Attendance")}を${t("Saved")}しました。`],
    [/^Deleted attendance day (.+)\.$/, (_match, date) => `${date}の${t("Attendance Day")}を${t("Deleted")}しました。`],
    [/^Cleared all attendance data\.$/, () => `すべての${t("Attendance")}データを${t("Cleared")}しました。`],
    [/^Deleted test session "(.+)"\.$/, (_match, label) => `テストセッション「${label}」を${t("Deleted")}しました。`],
    [/^Created model retake session "(.+)" for (.+)\.$/, (_match, title, problemSet) => `模擬テスト再試験セッション「${title}」（${problemSet}）を${t("Created")}しました。`],
    [/^Created model test session "(.+)" for (.+)\.$/, (_match, title, problemSet) => `模擬テストセッション「${title}」（${problemSet}）を${t("Created")}しました。`],
    [/^Created daily retake session "(.+)" in (.+)\.$/, (_match, title, category) => `小テスト再試験セッション「${title}」（${category}）を${t("Created")}しました。`],
    [/^Created daily test session "(.+)" in (.+)\.$/, (_match, title, category) => `小テストセッション「${title}」（${category}）を${t("Created")}しました。`],
    [/^Invited (\d+) student(?:s)?(?: \((\d+) failed\))?\.$/, (_match, okCount, ngCount) => {
      const extra = ngCount ? `（${ngCount}件失敗）` : "";
      return `${okCount}人の${t("Student")}を${t("Invited")}しました${extra}。`;
    }],
    [/^Imported (\d+) daily set(?:s)?(?: in (.+))?\.$/, (_match, count, category) => {
      const suffix = category ? `（${category}）` : "";
      return `${count}件の${t("Daily Test")}セットを${t("Imported")}しました${suffix}。`;
    }],
    [/^Imported attendance for (\d+) day(?:s)? \((\d+) entries\)\.$/, (_match, days, entries) => {
      return `${days}日分の${t("Attendance")}（${entries}件）を${t("Imported")}しました。`;
    }],
    [/^(Approved|Denied) absence application for (.+)\.$/, (_match, verdict, target) => {
      const action = verdict === "Approved" ? t("Approved") : t("Denied");
      return `${target}の${t("Absence Application")}を${action}しました。`;
    }],
    [/^(Marked withdrawn|Removed withdrawn status): (.+)$/, (_match, action, target) => {
      const label = action === "Marked withdrawn" ? "退学扱いに変更" : "退学扱いを解除";
      return `${target}を${label}しました。`;
    }],
    [/^(Marked test account|Removed test account): (.+)$/, (_match, action, target) => {
      const label = action === "Marked test account" ? "テストアカウントに設定" : "テストアカウント設定を解除";
      return `${target}を${label}しました。`;
    }],
    [/^Saved daily record for (.+?)( and sent syllabus announcement| and updated syllabus announcement)?\.$/, (_match, date, suffix = "") => {
      const extra = suffix.includes("sent") ? "。あわせてお知らせを送信しました" : suffix.includes("updated") ? "。あわせてお知らせを更新しました" : "";
      return `${date}の${t("Daily Record")}を${t("Saved")}しました${extra}。`;
    }],
    [/^Updated manual daily result for (.+)\.$/, (_match, target) => `${target}の手動${t("Daily Test")}結果を${t("Updated")}しました。`],
    [/^Saved manual daily result for (.+)\.$/, (_match, target) => `${target}の手動${t("Daily Test")}結果を${t("Saved")}しました。`],
    [/^Cleared manual daily result for (.+)\.$/, (_match, target) => `${target}の手動${t("Daily Test")}結果を${t("Cleared")}しました。`],
    [/^Created manual daily results column "(.+)"\.$/, (_match, title) => `手動${t("Daily Test")}結果列「${title}」を${t("Created")}しました。`],
  ];

  for (const [pattern, replacer] of patterns) {
    const next = summary.replace(pattern, replacer);
    if (next !== summary) return next;
  }

  return summary
    .replace(/\bmodel retake session\b/gi, "模擬テスト再試験セッション")
    .replace(/\bmodel test session\b/gi, "模擬テストセッション")
    .replace(/\bdaily retake session\b/gi, "小テスト再試験セッション")
    .replace(/\bdaily test session\b/gi, "小テストセッション")
    .replace(/\bmodel test\b/gi, "模擬テスト")
    .replace(/\bdaily test\b/gi, "小テスト")
    .replace(/\bquestion set\b/gi, "問題セット")
    .replace(/\battendance day\b/gi, "出席日")
    .replace(/\battendance\b/gi, "出席")
    .replace(/\bannouncement\b/gi, "お知らせ")
    .replace(/\bstudent\b/gi, "学生")
    .replace(/\btest account\b/gi, "テストアカウント")
    .replace(/\bwithdrawn status\b/gi, "退学扱い")
    .replace(/\bwithdrawn\b/gi, "退学")
    .replace(/\bcreated\b/gi, "作成")
    .replace(/\bupdated\b/gi, "更新")
    .replace(/\bdeleted\b/gi, "削除")
    .replace(/\bsaved\b/gi, "保存")
    .replace(/\bimported\b/gi, "インポート")
    .replace(/\binvited\b/gi, "招待")
    .replace(/\bapproved\b/gi, "承認")
    .replace(/\bdenied\b/gi, "却下")
    .replace(/\bcleared\b/gi, "クリア")
    .replace(/\bmarked\b/gi, "変更")
    .replace(/\bremoved\b/gi, "解除")
    .replace(/\bmanual daily result\b/gi, "手動小テスト結果")
    .replace(/\bdaily set\b/gi, "小テストセット")
    .replace(/\bdaily record\b/gi, "日次記録");
}

function translateAuditAction(value, t) {
  const key = String(value ?? "").trim().toLowerCase();
  const mapping = {
    create: t("Created"),
    update: t("Updated"),
    delete: t("Deleted"),
    import: t("Imported"),
    invite: t("Invited"),
    approve: t("Approved"),
    deny: t("Denied"),
    save: t("Saved"),
    clear: t("Cleared"),
    enable: t("Enabled"),
    disable: t("Disabled"),
    reissue: t("Reissued"),
    issue: t("Issued"),
    mark: t("Marked"),
    remove: t("Removed"),
  };
  return mapping[key] || toTitleCase(value);
}

function translateAuditEntity(value, t) {
  const key = String(value ?? "").trim().toLowerCase();
  const mapping = {
    school: t("School"),
    admin: t("Admin"),
    question_set: t("Question Set"),
    question_set_version: t("Question Set Version"),
    question_set_visibility: t("Question Set Visibility"),
    test_session: t("Test Session"),
    daily_record: t("Daily Record"),
    attendance_day: t("Attendance Day"),
    attendance_import: t("Attendance Import"),
    question_import: t("Question Import"),
    results_import: t("Results Import"),
    announcement: t("Announcement"),
    student: t("Student"),
    absence_application: t("Absence Application"),
  };
  return mapping[key] || toTitleCase(value);
}

function buildAuditSummary(row, t) {
  const summary = String(row?.metadata?.summary ?? "").trim();
  if (summary) return translateAuditSummaryText(summary, t);

  const actionLabel = translateAuditAction(row?.action_type || "updated", t);
  const entityLabel = translateAuditEntity(row?.entity_type || "record", t);
  const targetLabel = String(
    row?.metadata?.title
    ?? row?.metadata?.name
    ?? row?.metadata?.email
    ?? row?.entity_id
    ?? ""
  ).trim();
  return `${actionLabel} ${entityLabel}${targetLabel ? `: ${targetLabel}` : ""}`;
}

function formatAuditDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  const uiLang = typeof document !== "undefined" ? document.documentElement.lang : "en";
  return date.toLocaleString(uiLang === "ja" ? "ja-JP" : "en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function SuperAuditPage() {
  const { supabase } = useSuperAdmin();
  const { t } = useLanguage();
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
        setMsg(error.message || t("Failed to load audit logs."));
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
        <div className="admin-help">
          {t("Concise audit history for super admin and admin actions that affect other users.")}
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>{t("Date From")}</label>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>{t("Date To")}</label>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))}
            />
          </div>
          <div className="field small">
            <label>{t("Entity Type")}</label>
            <select
              value={filters.entityType}
              onChange={(event) => setFilters((prev) => ({ ...prev, entityType: event.target.value }))}
            >
              <option value="all">{t("All")}</option>
              <option value="school">{t("School")}</option>
              <option value="admin">{t("Admin")}</option>
              <option value="question_set">{t("Question Set")}</option>
              <option value="question_set_version">{t("Question Set Version")}</option>
              <option value="question_set_visibility">{t("Question Set Visibility")}</option>
              <option value="test_session">{t("Test Session")}</option>
              <option value="daily_record">{t("Daily Record")}</option>
              <option value="attendance_day">{t("Attendance Day")}</option>
              <option value="attendance_import">{t("Attendance Import")}</option>
              <option value="question_import">{t("Question Import")}</option>
              <option value="results_import">{t("Results Import")}</option>
              <option value="announcement">{t("Announcement")}</option>
              <option value="student">{t("Student")}</option>
              <option value="absence_application">{t("Absence Application")}</option>
            </select>
          </div>
          <div className="field small">
            <label>{t("School")}</label>
            <select
              value={filters.schoolId}
              onChange={(event) => setFilters((prev) => ({ ...prev, schoolId: event.target.value }))}
            >
              <option value="all">{t("All schools")}</option>
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
                <th>{t("Time")}</th>
                <th>{t("Actor")}</th>
                <th>{t("Activity")}</th>
                <th>{t("School")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <tr key={row.id}>
                  <td>{formatAuditDateTime(row.created_at)}</td>
                  <td>
                    <div>{row.actor_email || row.actor_user_id || "N/A"}</div>
                    <div className="daily-code">{row.actor_role || "N/A"}</div>
                  </td>
                  <td>
                    <div>{buildAuditSummary(row, t)}</div>
                  </td>
                  <td>{row.school_id ? schoolMap[row.school_id] ?? row.school_id : t("Global")}</td>
                </tr>
              ))}
              {!loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={4}>{t("No audit logs found for the selected filters.")}</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={4}><AdminLoadingState compact label={t("Loading audit logs...")} /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
