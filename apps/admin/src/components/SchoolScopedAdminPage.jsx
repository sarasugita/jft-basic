"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminConsole from "./AdminConsole";
import { createAdminSupabaseClient, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";
import { isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";

export default function SchoolScopedAdminPage({ schoolId }) {
  const router = useRouter();
  const supabaseConfigError = getAdminSupabaseConfigError();
  const supabase = useMemo(() => (supabaseConfigError ? null : createAdminSupabaseClient()), [supabaseConfigError]);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [school, setSchool] = useState(null);
  const [schoolOptions, setSchoolOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState("");

  useEffect(() => {
    if (supabaseConfigError) {
      setStartupError(supabaseConfigError);
      setLoading(false);
      return;
    }
    if (!supabase) return;
    let mounted = true;
    let loadAbortController = null;

    function redirect(target, reason, extra = {}) {
      logAdminEvent("School scoped page redirect", {
        target,
        reason,
        schoolId,
        ...extra,
      });
      router.replace(target);
    }

    async function load(reason) {
      if (loadAbortController) {
        loadAbortController.abort();
      }
      loadAbortController = new AbortController();
      setLoading(true);

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          logAdminRequestFailure("School scoped getSession failed", error, {
            schoolId,
            reason,
          });
        }
        syncAdminAuthCookie(data?.session ?? null);

        const nextSession = data?.session ?? null;
        if (!mounted) return;
        setSession(nextSession);
        setStartupError("");

        if (!nextSession) {
          setProfile(null);
          setSchool(null);
          setSchoolOptions([]);
          redirect("/", "no-session", { source: reason });
          return;
        }

        const { data: nextProfile, error: profileError } = await supabase
          .from("profiles")
          .select("id, role, account_status")
          .eq("id", nextSession.user.id)
          .single()
          .abortSignal(loadAbortController.signal);

        if (!mounted) return;
        if (profileError) {
          logAdminRequestFailure("School scoped profile lookup failed", profileError, {
            schoolId,
            reason,
            userId: nextSession.user.id,
          });
          setProfile(null);
          setStartupError(profileError.message || "Failed to load admin profile.");
          return;
        }

        setProfile(nextProfile ?? null);
        if (!nextProfile || nextProfile.role !== "super_admin" || nextProfile.account_status !== "active") {
          redirect("/", "super-admin-profile-required", {
            source: reason,
            userId: nextSession.user.id,
            role: nextProfile?.role ?? null,
            accountStatus: nextProfile?.account_status ?? null,
          });
          return;
        }

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
              reason,
              userId: nextSession.user.id,
            });
          }
          setSchool(null);
          redirect("/super/schools", "school-not-found", {
            source: reason,
            userId: nextSession.user.id,
          });
          return;
        }
        setSchool(schoolRow);

        const { data: schoolsData, error: schoolsError } = await supabase
          .from("schools")
          .select("id, name, status")
          .order("created_at", { ascending: true })
          .abortSignal(loadAbortController.signal);

        if (!mounted) return;
        if (schoolsError) {
          logAdminRequestFailure("School scoped school options lookup failed", schoolsError, {
            schoolId,
            reason,
            userId: nextSession.user.id,
          });
          setSchoolOptions([]);
          return;
        }

        setSchoolOptions(
          (schoolsData ?? []).map((row) => ({
            school_id: row.id,
            school_name: row.name ?? row.id,
            school_status: row.status ?? null,
          })),
        );
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("School scoped bootstrap aborted", error, {
            schoolId,
            reason,
          });
          setStartupError("Session restore was interrupted. Please open the admin page again.");
          return;
        }
        logAdminRequestFailure("School scoped bootstrap failed", error, {
          schoolId,
          reason,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to load school admin page.");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load("initial");

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      logAdminEvent("School scoped auth event", {
        event,
        schoolId,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id ?? null,
      });
      syncAdminAuthCookie(nextSession ?? null);
      if (!mounted || event === "INITIAL_SESSION") {
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        setSession(nextSession ?? null);
        return;
      }
      await load(`auth:${event}`);
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        load("visibilitychange");
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      mounted = false;
      if (loadAbortController) {
        loadAbortController.abort();
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      listener.subscription.unsubscribe();
    };
  }, [router, schoolId, supabase, supabaseConfigError]);

  if (startupError) {
    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">{startupError}</div>
      </div>
    );
  }

  if (loading || !session || !profile || !school) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <AdminConsole
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
