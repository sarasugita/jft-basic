"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAdminTrace, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

const STUDENT_LIST_SELECT_FIELDS = [
  "id",
  "email",
  "display_name",
  "student_code",
  "phone_number",
  "created_at",
  "is_withdrawn",
  "is_test_account",
].join(", ");

const ADMIN_SUPABASE_CONFIG_ERROR = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

function formatDateShort(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default function AdminConsoleStudentsStartup({
  activeSchoolId,
  onOpenFullConsole = null,
}) {
  const renderTraceLoggedRef = useRef(false);
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const supabaseRef = useRef(null);
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsMsg, setStudentsMsg] = useState("");
  const [filters, setFilters] = useState({
    code: "",
    name: "",
    email: "",
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
    logAdminEvent("Admin console students startup render start", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console students startup first commit", {
      activeSchoolId,
      hasSupabaseClient: !supabaseConfigError && Boolean(activeSchoolId),
    });
  }, [activeSchoolId, supabaseConfigError]);

  useEffect(() => {
    let cancelled = false;

    async function loadStudents() {
      if (supabaseConfigError) {
        setStudents([]);
        setStudentsMsg(supabaseConfigError);
        return;
      }

      if (!activeSchoolId) {
        setStudents([]);
        setStudentsMsg("Select a school.");
        return;
      }

      const finishTrace = createAdminTrace("Admin console students startup fetch", {
        activeSchoolId,
      });

      setStudentsLoading(true);
      setStudentsMsg("");

      try {
        const supabase = await getSupabaseClient();
        const { data, error } = await supabase
          .from("profiles")
          .select(STUDENT_LIST_SELECT_FIELDS)
          .eq("role", "student")
          .eq("school_id", activeSchoolId)
          .order("created_at", { ascending: false })
          .limit(500);

        if (cancelled) return;

        if (error) {
          finishTrace("failed", {
            message: error.message || "",
            code: error.code || "",
            status: error.status ?? null,
          });
          logAdminRequestFailure("Admin console students startup fetch failed", error, {
            activeSchoolId,
          });
          setStudents([]);
          setStudentsMsg(`Load failed: ${error.message}`);
          return;
        }

        const list = data ?? [];
        finishTrace("success", {
          count: list.length,
        });
        setStudents(list);
        setStudentsMsg(list.length ? "" : "No students.");
      } catch (error) {
        if (cancelled) return;
        finishTrace("failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        logAdminRequestFailure("Admin console students startup fetch threw", error, {
          activeSchoolId,
        });
        setStudents([]);
        setStudentsMsg(error instanceof Error ? error.message : "Failed to load students.");
      } finally {
        if (!cancelled) {
          setStudentsLoading(false);
        }
      }
    }

    void loadStudents();

    return () => {
      cancelled = true;
    };
  }, [activeSchoolId, getSupabaseClient, supabaseConfigError]);

  const filteredStudents = useMemo(() => {
    const codeNeedle = filters.code.trim().toLowerCase();
    const nameNeedle = filters.name.trim().toLowerCase();
    const emailNeedle = filters.email.trim().toLowerCase();

    return students.filter((student) => {
      if (codeNeedle && !String(student.student_code ?? "").toLowerCase().includes(codeNeedle)) return false;
      if (nameNeedle && !String(student.display_name ?? "").toLowerCase().includes(nameNeedle)) return false;
      if (emailNeedle && !String(student.email ?? "").toLowerCase().includes(emailNeedle)) return false;
      return true;
    });
  }, [filters.code, filters.email, filters.name, students]);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="admin-title">Student List</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {typeof onOpenFullConsole === "function" ? (
            <button
              className="btn btn-primary"
              type="button"
              onClick={onOpenFullConsole}
            >
              Open Full Console
            </button>
          ) : null}
          <button
            className="btn"
            type="button"
            onClick={() => {
              setStudents([]);
              setStudentsMsg("");
              setStudentsLoading(false);
              renderTraceLoggedRef.current = false;
              setFilters({ code: "", name: "", email: "" });
            }}
          >
            Reset Filters
          </button>
        </div>
      </div>

      {typeof onOpenFullConsole === "function" ? (
        <div className="admin-help" style={{ marginTop: 10 }}>
          Need student details, warnings, exports, or edit actions? Open the full console for the complete student workspace.
        </div>
      ) : null}

      <div className="attendance-filter-box" style={{ marginTop: 14 }}>
        <div className="admin-form" style={{ marginTop: 0 }}>
          <div className="field small">
            <label className="student-list-filter-label">Filter<br />Student No.</label>
            <input
              value={filters.code}
              onChange={(event) => setFilters((current) => ({ ...current, code: event.target.value }))}
              placeholder="e.g. 1024"
            />
          </div>
          <div className="field small">
            <label className="student-list-filter-label">Filter<br />Name</label>
            <input
              value={filters.name}
              onChange={(event) => setFilters((current) => ({ ...current, name: event.target.value }))}
              placeholder="Student name"
            />
          </div>
          <div className="field small">
            <label className="student-list-filter-label">Filter<br />Email</label>
            <input
              value={filters.email}
              onChange={(event) => setFilters((current) => ({ ...current, email: event.target.value }))}
              placeholder="student@example.com"
            />
          </div>
          <div className="field small">
            <label className="student-list-filter-label">Loaded</label>
            <div className="admin-help" style={{ marginTop: 10 }}>
              {studentsLoading ? "Loading..." : `${filteredStudents.length} shown / ${students.length} total`}
            </div>
          </div>
        </div>
      </div>

      <div className="admin-table-wrap" style={{ marginTop: 10 }}>
        <table className="admin-table" style={{ minWidth: 960 }}>
          <thead>
            <tr>
              <th>Student<br />No.</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Test<br />Account</th>
              <th>Withdrawn</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.map((student) => (
              <tr key={student.id} className={student.is_withdrawn ? "row-withdrawn" : ""}>
                <td>{student.student_code ?? ""}</td>
                <td>{student.display_name ?? ""}</td>
                <td>{student.email ?? ""}</td>
                <td>{student.phone_number ?? ""}</td>
                <td>{student.is_test_account ? "Yes" : "No"}</td>
                <td>{student.is_withdrawn ? "Yes" : "No"}</td>
                <td>{formatDateShort(student.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {studentsLoading ? (
        <div className="admin-help" style={{ marginTop: 10 }}>
          Loading students...
        </div>
      ) : null}

      {studentsMsg ? (
        <div className="admin-msg" style={{ marginTop: 10 }}>
          {studentsMsg}
        </div>
      ) : null}
    </div>
  );
}
