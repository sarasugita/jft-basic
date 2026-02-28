"use client";

import { useEffect, useState } from "react";
import { useSuperAdmin } from "./SuperAdminShell";

function PlaceholderBlock({ title, body }) {
  return (
    <div className="super-placeholder-block">
      <div className="admin-title">{title}</div>
      <div className="admin-help" style={{ marginTop: 6 }}>{body}</div>
      <div className="super-placeholder-chart">Coming soon</div>
    </div>
  );
}

export default function SuperTestsAnalyticsPage() {
  const { supabase } = useSuperAdmin();
  const [schoolId, setSchoolId] = useState("all");
  const [testType, setTestType] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [schools, setSchools] = useState([]);

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

  return (
    <div className="super-page-content">
      <div className="admin-panel">
        <div className="admin-title">Analytics Filters</div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          Structure is in place; charting and heavier analytics logic will be added once the test runtime migration is complete.
        </div>
        <div className="admin-form" style={{ marginTop: 12 }}>
          <div className="field small">
            <label>Date From</label>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </div>
          <div className="field small">
            <label>Date To</label>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </div>
          <div className="field small">
            <label>School</label>
            <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)}>
              <option value="all">All schools</option>
              {schools.map((school) => (
                <option key={school.id} value={school.id}>{school.name}</option>
              ))}
            </select>
          </div>
          <div className="field small">
            <label>Test Type</label>
            <select value={testType} onChange={(event) => setTestType(event.target.value)}>
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="model">Model</option>
            </select>
          </div>
        </div>
      </div>

      <div className="super-placeholder-grid" style={{ marginTop: 12 }}>
        <PlaceholderBlock
          title="Score Distribution"
          body="Distribution by score band for the selected school, date range, and test type."
        />
        <PlaceholderBlock
          title="Question Accuracy"
          body="Question-set and question-level accuracy surfaces will be added here."
        />
        <PlaceholderBlock
          title="School Comparison"
          body="Cross-school comparison for daily vs model performance will live in this section."
        />
      </div>
    </div>
  );
}
