"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createAdminTrace,
  isAbortLikeError,
  logAdminEvent,
  logAdminRequestFailure,
} from "../lib/adminDiagnostics";
import { useSuperAdmin } from "./super/SuperAdminShell";
import {
  getLoadedAdminConsole,
  loadAdminConsole,
} from "./adminConsoleLoader";
import AdminConsoleBoundary from "./AdminConsoleBoundary";
import LoadableAdminModule from "./LoadableAdminModule";

export default function SchoolScopedAdminPage({
  schoolId,
  initialRouteState = null,
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  const { supabase, session, profile, loading: authLoading, startupError: authStartupError } = useSuperAdmin();
  const [school, setSchool] = useState(null);
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [adminConsoleRetryNonce, setAdminConsoleRetryNonce] = useState(0);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

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
      routerRef.current?.replace(target);
    }

    async function loadSchool() {
      const finishTrace = createAdminTrace("School scoped school fetch", {
        schoolId,
        userId: session.user.id,
        role: profile.role,
      });
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
            finishTrace("failed", {
              message: schoolError.message || "",
              code: schoolError.code || "",
              status: schoolError.status ?? null,
            });
            logAdminRequestFailure("School scoped school lookup failed", schoolError, {
              schoolId,
              userId: session.user.id,
            });
          } else {
            finishTrace("missing-row");
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
        finishTrace("success", {
          schoolRowId: schoolRow.id,
          schoolStatus: schoolRow.status ?? null,
        });
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          finishTrace("aborted", {
            message: error?.message ?? "",
          });
          logAdminRequestFailure("School scoped bootstrap aborted", error, {
            schoolId,
          });
          return;
        }
        finishTrace("threw", {
          message: error instanceof Error ? error.message : String(error ?? ""),
        });
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
  }, [profile?.id, profile?.role, schoolId, session?.user?.id, supabase]);

  useEffect(() => {
    if (!supabase || !session || !profile || !school) return;
    let cancelled = false;
    const schoolOptionsAbortController = new AbortController();

    async function loadSchoolOptions() {
      const finishTrace = createAdminTrace("School scoped school options fetch", {
        schoolId,
        userId: session.user.id,
      });
      try {
        const { data: schoolsData, error: schoolsError } = await supabase
          .from("schools")
          .select("id, name, status")
          .order("created_at", { ascending: true })
          .abortSignal(schoolOptionsAbortController.signal);

        if (cancelled) return;
        if (schoolsError) {
          finishTrace("failed", {
            message: schoolsError.message || "",
            code: schoolsError.code || "",
            status: schoolsError.status ?? null,
          });
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
        finishTrace("success", {
          optionCount: nextOptions.length,
        });
      } catch (error) {
        if (cancelled || isAbortLikeError(error)) {
          if (!cancelled) {
            finishTrace("aborted", {
              message: error?.message ?? "",
            });
          }
          return;
        }
        finishTrace("threw", {
          message: error instanceof Error ? error.message : String(error ?? ""),
        });
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
  }, [profile?.id, school?.id, schoolId, session?.user?.id, supabase]);

  useEffect(() => {
    if (!session || !profile || !school) return;
    logAdminEvent("School scoped ready for admin console", {
      schoolId,
      schoolRowId: school.id,
      role: profile.role,
      schoolOptionsCount: schoolOptions.length,
    });
  }, [profile?.id, profile?.role, school?.id, schoolId, schoolOptions.length, session?.user?.id]);

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
    <AdminConsoleBoundary
      context="school-scoped-admin"
      onRetry={() => {
        setAdminConsoleRetryNonce((value) => value + 1);
      }}
      onBack={() => routerRef.current?.replace("/super/schools")}
      backLabel="BACK TO SCHOOLS"
    >
      <LoadableAdminModule
        key={`${adminConsoleRetryNonce}:${schoolId}:${initialRouteState?.pathKey ?? "index"}`}
        importTarget="AdminConsole"
        loadModule={loadAdminConsole}
        getLoadedModule={getLoadedAdminConsole}
        context={{
          pathname: `/super/schools/${schoolId}/admin`,
          role: profile?.role ?? null,
          userId: session?.user?.id ?? null,
          schoolId,
          activeSchoolId: schoolId,
          attempt: adminConsoleRetryNonce,
          managedAuth: true,
          source: "school-scoped-mount",
        }}
        retryKey={adminConsoleRetryNonce}
        timeoutMs={30000}
        errorMessage="Failed to mount the admin console. Retry or go back to Schools."
        backLabel="BACK TO SCHOOLS"
        onBack={() => router.replace("/super/schools")}
        moduleProps={{
          forcedSchoolScope: school,
          changeSchoolHref: "/super/schools",
          homeHref: "/super/schools",
          homeLabel: "SuperAdmin Home",
          forcedSchoolOptions: schoolOptions,
          managedSession: session,
          managedProfile: profile,
          initialAdminTab: initialRouteState?.adminTab ?? "announcements",
          initialAttendanceSubTab: initialRouteState?.attendanceSubTab ?? "sheet",
          initialModelSubTab: initialRouteState?.modelSubTab ?? "results",
          initialDailySubTab: initialRouteState?.dailySubTab ?? "results",
        }}
        diagnosticsExtra={{
          adminTab: initialRouteState?.adminTab ?? "announcements",
          attendanceSubTab: initialRouteState?.attendanceSubTab ?? "sheet",
          modelSubTab: initialRouteState?.modelSubTab ?? "results",
          dailySubTab: initialRouteState?.dailySubTab ?? "results",
          schoolId,
          source: "school-scoped-mount",
        }}
      />
    </AdminConsoleBoundary>
  );
}
