"use client";

import { useEffect, useMemo, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

export default function SuperTestsImportPage() {
  const { supabase } = useSuperAdmin();
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [testType, setTestType] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [questionSets, setQuestionSets] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setMsg("");
      const { data, error } = await supabase
        .from("question_sets")
        .select("id, title, test_type, version, visibility_scope, created_at")
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setQuestionSets([]);
        setMsg(`Question-set library is not ready yet: ${error.message}`);
        setLoading(false);
        return;
      }

      setQuestionSets(data ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const filteredQuestionSets = useMemo(() => {
    return questionSets.filter((item) => {
      const matchesType = testType === "all" || item.test_type === testType;
      const matchesVisibility = visibility === "all" || item.visibility_scope === visibility;
      return matchesType && matchesVisibility;
    });
  }, [questionSets, testType, visibility]);

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="super-toolbar">
          <div>
            <div className="admin-title">Question Set Library</div>
            <div className="admin-help">Global question-set upload and version management will live on this page.</div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setMsg("Upload workflow placeholder only. CSV and asset import wiring comes next.")}
          >
            Upload Question Set
          </button>
        </div>

        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>Test Type</label>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="model">Model</option>
            </select>
          </div>
          <div className="field small">
            <label>Visibility</label>
            <select value={visibility} onChange={(event) => setVisibility(event.target.value)}>
              <option value="all">All</option>
              <option value="global">Global</option>
              <option value="restricted">Restricted</option>
            </select>
          </div>
        </div>

        {msg ? <div className="admin-msg">{msg}</div> : null}

        <div className="admin-table-wrap" style={{ marginTop: 12 }}>
          <table className="admin-table" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>Title</th>
                <th>Test Type</th>
                <th>Version</th>
                <th>Visibility</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuestionSets.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td style={{ textTransform: "capitalize" }}>{item.test_type}</td>
                  <td>v{item.version}</td>
                  <td style={{ textTransform: "capitalize" }}>{item.visibility_scope}</td>
                  <td>{item.created_at ? new Date(item.created_at).toLocaleString() : "N/A"}</td>
                </tr>
              ))}
              {!loading && filteredQuestionSets.length === 0 ? (
                <tr>
                  <td colSpan={5}>No question sets to show yet.</td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={5}>Loading question sets...</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
