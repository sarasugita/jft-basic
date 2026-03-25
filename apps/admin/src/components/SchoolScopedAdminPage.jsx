"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import { useSuperAdmin } from "./super/SuperAdminShell";

const LazyAdminConsole = dynamic(() => import("./AdminConsole"), {
  loading: () => (
    <div className="admin-login">
      <h2>Loading...</h2>
    </div>
  ),
});

export default function SchoolScopedAdminPage({ schoolId }) {
  const router = useRouter();
  const { supabase, session, profile, loading: authLoading, startupError: authStartupError } = useSuperAdmin();
  const [school, setSchool] = useState(null);
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startupError, setStartupError] = useState("");

  useEffect(() => {
    if (!supabase || !session || !profile) return;
    let mounted = true;
    const loadAbortController = new AbortController();

    function redirect(target, reason, extra = {}) {
      logAdminEvent("School scoped page redirect", {
        target,
        reason,
        schoolId,
        ...extra,
      });
      router.replace(target);
    }

    async function loadSchool() {
      setLoading(true);
      setStartupError("");

      try {
        const { data: schoolRow, error: schoolError } = await supabase
          .from("schools")
          .select("id, name, status")
          .eq("id", schoolId)
          .single()
          .abortSignal(loadAbortController.signal);

        if (!mounted) return;
        if (schoolError || !schoolRow) {
          if (schoolError) {
            logAdminRequestFailure("School scoped school lookup failed", schoolError, {
              schoolId,
              userId: session.user.id,
            });
          }
          setSchool(null);
          setSchoolOptions([]);
          redirect("/super/schools", "school-not-found", {
            userId: session.user.id,
          });
          return;
        }

        setSchool(schoolRow);
        setSchoolOptions([
          {
            school_id: schoolRow.id,
            school_name: schoolRow.name ?? schoolRow.id,
            school_status: schoolRow.status ?? null,
          },
        ]);
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("School scoped bootstrap aborted", error, {
            schoolId,
          });
          return;
        }
        logAdminRequestFailure("School scoped bootstrap failed", error, {
          schoolId,
          userId: session.user.id,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to load school admin page.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadSchool();
    return () => {
      mounted = false;
      loadAbortController.abort();
    };
  }, [profile, router, schoolId, session, supabase]);

  useEffect(() => {
    if (!supabase || !session || !profile || !school) return;
    let cancelled = false;
    const schoolOptionsAbortController = new AbortController();

    async function loadSchoolOptions() {
      try {
        const { data: schoolsData, error: schoolsError } = await supabase
          .from("schools")
          .select("id, name, status")
          .order("created_at", { ascending: true })
          .abortSignal(schoolOptionsAbortController.signal);

        if (cancelled) return;
        if (schoolsError) {
          logAdminRequestFailure("School scoped school options lookup failed", schoolsError, {
            schoolId,
            userId: session.user.id,
          });
          return;
        }

        const nextOptions = (schoolsData ?? []).map((row) => ({
          school_id: row.id,
          school_name: row.name ?? row.id,
          school_status: row.status ?? null,
        }));
        setSchoolOptions(nextOptions.length ? nextOptions : [
          {
            school_id: school.id,
            school_name: school.name ?? school.id,
            school_status: school.status ?? null,
          },
        ]);
      } catch (error) {
        if (cancelled || isAbortLikeError(error)) {
          return;
        }
        logAdminRequestFailure("School scoped school options lookup failed", error, {
          schoolId,
          userId: session.user.id,
        });
      }
    }

    void loadSchoolOptions();
    return () => {
      cancelled = true;
      schoolOptionsAbortController.abort();
    };
  }, [profile, school, schoolId, session, supabase]);

  if (startupError) {
    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">{startupError}</div>
      </div>
    );
  }

  if (authStartupError) {
    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">{authStartupError}</div>
      </div>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!session || !profile || !school) {
    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">Admin session is not ready. Refresh the page.</div>
      </div>
    );
  }

  return (
    <LazyAdminConsole
      forcedSchoolScope={school}
      changeSchoolHref="/super/schools"
      homeHref="/super/schools"
      homeLabel="SuperAdmin Home"
      forcedSchoolOptions={schoolOptions}
      managedSession={session}
      managedProfile={profile}
    />
  );
}
