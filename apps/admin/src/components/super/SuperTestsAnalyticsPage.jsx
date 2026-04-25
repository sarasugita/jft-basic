"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSuperAdmin } from "./SuperAdminShell";
import AdminLoadingState from "../AdminLoadingState";

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

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Math.round(Number(value) * 100)}%`;
}

function formatVersionLabel(row) {
  const label = String(row?.version_label ?? "").trim();
  if (label) return label;
  const version = Number(row?.version ?? 0);
  return version > 0 ? `v${version}` : "v?";
}

export default function SuperTestsAnalyticsPage() {
  const { supabase } = useSuperAdmin();
  const router = useRouter();
  const [filters, setFilters] = useState({
    schoolId: "all",
    testType: "all",
    ...defaultRange(),
  });
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [schoolRows, setSchoolRows] = useState([]);
  const [questionSetRows, setQuestionSetRows] = useState([]);

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

    async function loadAnalytics() {
      setLoading(true);
      setMsg("");

      let questionSetsQuery = supabase
        .from("question_sets")
        .select("id, title, version_label, version, test_type, status, visibility_scope, created_at")
        .order("title", { ascending: true })
        .order("version", { ascending: false });

      if (filters.testType !== "all") {
        questionSetsQuery = questionSetsQuery.eq("test_type", filters.testType);
      }

      const [summaryRes, questionSetsRes, accessRes, questionCountsRes] = await Promise.all([
        supabase.rpc("super_school_metrics_summary", {
          p_date_from: filters.from || null,
          p_date_to: filters.to || null,
          p_test_type: filters.testType,
        }),
        questionSetsQuery,
        supabase.from("question_set_school_access").select("question_set_id, school_id"),
        supabase.from("question_set_questions").select("question_set_id"),
      ]);

      if (cancelled) return;

      if (summaryRes.error || questionSetsRes.error || accessRes.error || questionCountsRes.error) {
        setMsg(
          summaryRes.error?.message
            || questionSetsRes.error?.message
            || accessRes.error?.message
            || questionCountsRes.error?.message
            || "Failed to load analytics.",
        );
        setSchoolRows([]);
        setQuestionSetRows([]);
        setLoading(false);
        return;
      }

      const schoolMap = Object.fromEntries((schools ?? []).map((school) => [school.id, school.name]));
      const nextSchoolRows = (summaryRes.data ?? [])
        .filter((row) => filters.schoolId === "all" || row.school_id === filters.schoolId)
        .map((row) => ({
          ...row,
          school_name: schoolMap[row.school_id] ?? row.school_id,
        }));

      const accessByQuestionSet = {};
      for (const row of accessRes.data ?? []) {
        if (!accessByQuestionSet[row.question_set_id]) accessByQuestionSet[row.question_set_id] = [];
        accessByQuestionSet[row.question_set_id].push(row.school_id);
      }

      const questionCountBySet = {};
      for (const row of questionCountsRes.data ?? []) {
        if (!row?.question_set_id) continue;
        questionCountBySet[row.question_set_id] = (questionCountBySet[row.question_set_id] ?? 0) + 1;
      }

      const nextQuestionSetRows = (questionSetsRes.data ?? [])
        .filter((row) => {
          if (filters.schoolId === "all") return true;
          if (row.visibility_scope === "global") return true;
          return (accessByQuestionSet[row.id] ?? []).includes(filters.schoolId);
        })
        .map((row) => ({
          ...row,
          question_count: questionCountBySet[row.id] ?? 0,
          visible_school_count:
            row.visibility_scope === "global"
              ? schools.length
              : (accessByQuestionSet[row.id] ?? []).length,
        }));

      setSchoolRows(nextSchoolRows);
      setQuestionSetRows(nextQuestionSetRows);
      setLoading(false);
    }

    loadAnalytics();
    return () => {
      cancelled = true;
    };
  }, [filters, schools, supabase]);

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="admin-title">Analytics Filters</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          School comparison uses aggregate metrics. Click a question set below to open its school and question accuracy breakdown.
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
          <div className="field small">
            <label>Test Type</label>
            <select
              value={filters.testType}
              onChange={(event) => setFilters((prev) => ({ ...prev, testType: event.target.value }))}
            >
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="model">Model</option>
            </select>
          </div>
        </div>
        {msg ? <div className="admin-msg">{msg}</div> : null}
      </div>

      <div className="admin-panel">
        <div className="admin-title">School Comparison</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Student count is all-time. Test counts and averages use the selected date range and test-type filter.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>School</th>
                <th>Student Count</th>
                <th>Tests Taken</th>
                <th>Avg Score (Daily)</th>
                <th>Avg Score (Model)</th>
                <th>Attendance Avg</th>
              </tr>
            </thead>
            <tbody>
              {schoolRows.map((row) => (
                <tr key={row.school_id}>
                  <td>{row.school_name}</td>
                  <td>{row.student_count ?? 0}</td>
                  <td>{row.tests_taken ?? 0}</td>
                  <td>{formatPercent(row.daily_avg)}</td>
                  <td>{formatPercent(row.model_avg)}</td>
                  <td>{formatPercent(row.attendance_avg)}</td>
                </tr>
              ))}
              {!loading && schoolRows.length === 0 ? (
                <tr>
                  <td colSpan={6}>No school analytics found for the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={6}><AdminLoadingState compact label="Loading analytics..." /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-panel">
        <div className="admin-title">Question Set Performance</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Rows below are question sets from the shared library. Click one to open its comparison page.
        </div>
        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Ver.</th>
                <th>Type</th>
                <th>Status</th>
                <th>Visibility</th>
                <th>Questions</th>
                <th>Schools</th>
              </tr>
            </thead>
            <tbody>
              {questionSetRows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => router.push(`/super/tests/analytics/${row.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td>{row.title}</td>
                  <td>{formatVersionLabel(row)}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.test_type}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.status}</td>
                  <td style={{ textTransform: "capitalize" }}>{row.visibility_scope}</td>
                  <td>{row.question_count ?? 0}</td>
                  <td>{row.visible_school_count ?? 0}</td>
                </tr>
              ))}
              {!loading && questionSetRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>No question sets found for the selected filters.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={7}><AdminLoadingState compact label="Loading question sets..." /></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
