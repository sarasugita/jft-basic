"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { syncAdminAuthCookie } from "../lib/authCookies";
import { logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import {
  ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  getLoadedAdminConsoleAnnouncementsStartup,
  getLoadedAdminConsoleCore,
  loadAdminConsoleAnnouncementsStartup,
  loadAdminConsoleCore,
  preloadAdminConsoleCore,
} from "./adminConsoleLoader";
import LoadableAdminModule from "./LoadableAdminModule";
import LoadableAdminWorkspace from "./LoadableAdminWorkspace";

const ADMIN_SCHOOL_SCOPE_STORAGE_KEY = "jft_admin_school_scope";
const DIRECT_STARTUP_WORKSPACE_CONFIG = {
  announcements: {
    importTarget: "AdminConsoleAnnouncementsStartup",
    loadModule: loadAdminConsoleAnnouncementsStartup,
    getLoadedModule: getLoadedAdminConsoleAnnouncementsStartup,
    loadingLabel: "Loading announcements...",
    errorMessage: "Failed to load announcements. Retry or switch tabs and try again.",
  },
};
const ADMIN_SUPABASE_CONFIG_ERROR = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

function getAdminPageTitle(activeTab) {
  if (activeTab === "announcements") return "Announcements";
  if (activeTab === "attendance") return "Attendance";
  if (activeTab === "model") return "Model Test";
  if (activeTab === "daily") return "Daily Test";
  if (activeTab === "dailyRecord") return "Schedule & Record";
  if (activeTab === "ranking") return "Ranking";
  return "Student List";
}

function normalizeSchoolAssignments(rows) {
  return Array.isArray(rows)
    ? rows
        .filter((row) => row?.school_id)
        .map((row) => ({
          school_id: row.school_id,
          school_name: row.school_name ?? row.school_id,
          school_status: row.school_status ?? null,
          is_primary: Boolean(row.is_primary),
        }))
    : [];
}

function AdminConsoleStartupFrame({
  schoolName,
  displayName,
  activeTab = "dailyRecord",
  onSelectTab = null,
  schoolSelector = null,
  changeSchoolHref = "",
  onSignOut = null,
  children,
}) {
  const navItems = [
    { key: "announcements", label: "Announcements" },
    { key: "students", label: "Student List" },
    { key: "attendance", label: "Attendance" },
    { key: "model", label: "Model Test" },
    { key: "daily", label: "Daily Test" },
    { key: "dailyRecord", label: "Schedule & Record" },
    { key: "ranking", label: "Ranking" },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-head">
          <div className="admin-brand">
            <div className="admin-brand-text">
              <div className="admin-brand-title">
                <img className="admin-brand-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
              </div>
              <div className="admin-brand-sub">Admin Console</div>
            </div>
          </div>
        </div>
        <div className="admin-nav" aria-hidden="true">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`admin-nav-item ${activeTab === item.key ? "active" : ""}`}
              type="button"
              onClick={() => onSelectTab?.(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-email">{displayName || "Loading user..."}</div>
          {onSignOut ? (
            <button className="admin-nav-item logout" type="button" onClick={onSignOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-wrap">
          <div className="admin-page-topbar">
            <div className="admin-page-topbar-title">{getAdminPageTitle(activeTab)}</div>
            <div className="admin-page-topbar-meta">
              {schoolSelector || (
                <div className="admin-school-switcher admin-topbar-school-switcher">
                  <label>School</label>
                  <div className="admin-topbar-school-label">{schoolName || "Loading school..."}</div>
                </div>
              )}
              {changeSchoolHref ? (
                <button
                  className="btn admin-topbar-link"
                  type="button"
                  onClick={() => {
                    window.location.assign(changeSchoolHref);
                  }}
                >
                  Change school
                </button>
              ) : null}
              <div className="admin-page-topbar-console">Admin Console</div>
              <div className="admin-page-topbar-user">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" />
                  <path d="M4 20a8 8 0 0 1 16 0Z" fill="currentColor" />
                </svg>
                <span>{displayName || "Loading user..."}</span>
              </div>
            </div>
          </div>

          <div className="admin-panel admin-console-panel">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminConsole(props) {
  const pathname = usePathname();
  const {
    forcedSchoolScope = null,
    changeSchoolHref = null,
    homeHref = "/",
    homeLabel = "Admin Home",
    managedSession = undefined,
    managedProfile = undefined,
  } = props;
  const renderTraceLoggedRef = useRef(false);
  const [coreReady, setCoreReady] = useState(false);
  const [coreError, setCoreError] = useState("");
  const [coreRetryNonce, setCoreRetryNonce] = useState(0);
  const [startupTab, setStartupTab] = useState("announcements");
  const [legacyCoreRequested, setLegacyCoreRequested] = useState(false);
  const [schoolAssignments, setSchoolAssignments] = useState([]);
  const [schoolScopeId, setSchoolScopeId] = useState(null);

  const isManagedAuth = managedSession !== undefined || managedProfile !== undefined;
  const session = managedSession ?? null;
  const profile = managedProfile ?? null;
  const supabaseConfigError = ADMIN_SUPABASE_CONFIG_ERROR;
  const activeSchoolId = forcedSchoolScope?.id ?? schoolScopeId ?? profile?.school_id ?? null;
  const activeSchoolName = forcedSchoolScope?.name
    ?? schoolAssignments.find((assignment) => assignment.school_id === activeSchoolId)?.school_name
    ?? activeSchoolId
    ?? "";
  const isConsoleReadyForCore = Boolean(
    session
      && profile
      && profile.account_status === "active"
      && !profile.force_password_change
      && (profile.role === "admin" || profile.role === "super_admin")
      && activeSchoolId
  );

  const baseContext = {
    pathname,
    role: profile?.role ?? null,
    userId: session?.user?.id ?? null,
    schoolId: activeSchoolId,
    activeSchoolId,
    attempt: coreRetryNonce,
    managedAuth: isManagedAuth,
  };
  const directStartupWorkspace = DIRECT_STARTUP_WORKSPACE_CONFIG[startupTab] ?? null;

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console render start", baseContext);
  }

  useEffect(() => {
    logAdminEvent("Admin console first commit", baseContext);
  }, [activeSchoolId, coreRetryNonce, isManagedAuth, pathname, profile?.role, session?.user?.id]);

  useEffect(() => {
    if (!isConsoleReadyForCore) return;
    logAdminEvent("Admin console managed auth ready", baseContext);
  }, [activeSchoolId, coreRetryNonce, isConsoleReadyForCore, pathname, profile?.role, session?.user?.id]);

  useEffect(() => {
    if (!profile) {
      setSchoolAssignments([]);
      setSchoolScopeId(null);
      return;
    }

    if (forcedSchoolScope?.id) {
      setSchoolScopeId(forcedSchoolScope.id);
      return;
    }

    if (profile.role !== "admin") {
      setSchoolAssignments([]);
      setSchoolScopeId(profile.school_id ?? null);
      return;
    }

    if (supabaseConfigError || !session?.user?.id) {
      setSchoolAssignments([]);
      setSchoolScopeId(profile.school_id ?? null);
      return;
    }

    let mounted = true;

    async function loadSchoolAssignments() {
      const selectStoredScope = (assignments) => {
        const storedScope = typeof window !== "undefined"
          ? window.localStorage.getItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY)
          : null;
        const validStoredScope = assignments.some((assignment) => assignment.school_id === storedScope);
        return validStoredScope
          ? storedScope
          : profile.school_id ?? assignments[0]?.school_id ?? null;
      };

      let createAdminSupabaseClient = null;
      try {
        ({ createAdminSupabaseClient } = await import("../lib/adminSupabase"));
      } catch (error) {
        logAdminRequestFailure("Admin console failed to load supabase module", error, {
          pathname,
          role: profile.role,
          userId: session.user.id,
          schoolId: profile.school_id ?? null,
          activeSchoolId: profile.school_id ?? null,
          managedAuth: isManagedAuth,
        });
        if (!mounted) return;
        setSchoolAssignments(
          profile.school_id
            ? [{ school_id: profile.school_id, school_name: "Current School", is_primary: true }]
            : []
        );
        setSchoolScopeId(profile.school_id ?? null);
        return;
      }

      const baseSupabase = createAdminSupabaseClient();

      const { data: rpcSchoolOptionsData, error: rpcSchoolOptionsError } = await baseSupabase.rpc(
        "get_admin_school_options"
      );
      const rpcAssignments = normalizeSchoolAssignments(rpcSchoolOptionsData);
      if (!rpcSchoolOptionsError && rpcAssignments.length > 0) {
        if (!mounted) return;
        setSchoolAssignments(rpcAssignments);
        setSchoolScopeId(selectStoredScope(rpcAssignments));
        return;
      }

      const { data: schoolOptionsData, error: schoolOptionsError } = await baseSupabase.functions.invoke(
        "get-admin-school-options",
        { body: {} }
      );
      const functionAssignments = normalizeSchoolAssignments(schoolOptionsData?.schools);
      if (!schoolOptionsError && functionAssignments.length > 0) {
        if (!mounted) return;
        setSchoolAssignments(functionAssignments);
        setSchoolScopeId(selectStoredScope(functionAssignments));
        return;
      }

      const { data: assignments, error: assignmentsError } = await baseSupabase
        .from("admin_school_assignments")
        .select("school_id, is_primary")
        .eq("admin_user_id", session.user.id)
        .order("is_primary", { ascending: false });

      if (assignmentsError) {
        if (!mounted) return;
        setSchoolAssignments(
          profile.school_id
            ? [{ school_id: profile.school_id, school_name: "Current School", is_primary: true }]
            : []
        );
        setSchoolScopeId(profile.school_id ?? null);
        return;
      }

      const schoolIds = Array.from(
        new Set([profile.school_id, ...(assignments ?? []).map((row) => row.school_id)].filter(Boolean))
      );

      const schoolRows = await Promise.all(
        schoolIds.map(async (id) => {
          const schoolClient = createAdminSupabaseClient({ schoolScopeId: id });
          const { data } = await schoolClient
            .from("schools")
            .select("id, name, status")
            .eq("id", id)
            .maybeSingle();
          return data ?? null;
        })
      );

      if (!mounted) return;
      const schoolMap = Object.fromEntries(schoolRows.filter(Boolean).map((row) => [row.id, row]));
      const normalizedAssignments = schoolIds.map((id) => ({
        school_id: id,
        school_name: schoolMap[id]?.name ?? id,
        school_status: schoolMap[id]?.status ?? null,
        is_primary: id === profile.school_id || (assignments ?? []).some((row) => row.school_id === id && row.is_primary),
      }));
      setSchoolAssignments(normalizedAssignments);
      setSchoolScopeId(selectStoredScope(normalizedAssignments));
    }

    void loadSchoolAssignments();

    return () => {
      mounted = false;
    };
  }, [forcedSchoolScope?.id, isManagedAuth, pathname, profile, session?.user?.id, supabaseConfigError]);

  useEffect(() => {
    if (forcedSchoolScope?.id || profile?.role !== "admin") return;
    if (typeof window === "undefined") return;
    if (schoolScopeId) {
      window.localStorage.setItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY, schoolScopeId);
      return;
    }
    window.localStorage.removeItem(ADMIN_SCHOOL_SCOPE_STORAGE_KEY);
  }, [forcedSchoolScope?.id, profile?.role, schoolScopeId]);

  useEffect(() => {
    if (!isConsoleReadyForCore) {
      setLegacyCoreRequested(false);
      setStartupTab("announcements");
      setCoreReady(false);
      setCoreError("");
    }
  }, [isConsoleReadyForCore]);

  useEffect(() => {
    let cancelled = false;
    let preloadTimeoutId = null;
    let preloadFrameId = null;

    if (!isConsoleReadyForCore || !legacyCoreRequested) {
      return () => {
        cancelled = true;
      };
    }

    setCoreReady(false);
    setCoreError("");

    const payload = {
      pathname,
      role: profile.role,
      userId: session.user.id,
      schoolId: activeSchoolId,
      activeSchoolId,
      attempt: coreRetryNonce,
      managedAuth: isManagedAuth,
    };

    const startPreload = () => {
      void preloadAdminConsoleCore(
        {
          ...payload,
          source: "core-preload",
        },
        { timeoutMs: ADMIN_CONSOLE_IMPORT_TIMEOUT_MS }
      )
        .then(() => {
          if (cancelled) return;
          setCoreReady(true);
          setCoreError("");
        })
        .catch((error) => {
          if (cancelled) return;
          logAdminRequestFailure("Admin console core preload failed", error, payload);
          setCoreReady(false);
          if (String(error?.code ?? "") === "admin-console-import-timeout") {
            setCoreError("Admin console is taking too long to load. Retry or go back and try again.");
            return;
          }
          setCoreError("Failed to load the admin console. Retry or go back and try again.");
        });
    };

    preloadFrameId = window.requestAnimationFrame(() => {
      preloadTimeoutId = window.setTimeout(startPreload, 0);
    });

    return () => {
      cancelled = true;
      if (preloadFrameId != null) {
        window.cancelAnimationFrame(preloadFrameId);
      }
      if (preloadTimeoutId != null) {
        window.clearTimeout(preloadTimeoutId);
      }
    };
  }, [
    activeSchoolId,
    coreRetryNonce,
    isConsoleReadyForCore,
    isManagedAuth,
    legacyCoreRequested,
    pathname,
    profile,
    session,
  ]);

  useEffect(() => {
    let cancelled = false;
    let idleCallbackId = null;
    let timeoutId = null;

    if (!isConsoleReadyForCore || legacyCoreRequested || coreReady || getLoadedAdminConsoleCore()) {
      return () => {
        cancelled = true;
      };
    }

    const payload = {
      pathname,
      role: profile.role,
      userId: session.user.id,
      schoolId: activeSchoolId,
      activeSchoolId,
      attempt: coreRetryNonce,
      managedAuth: isManagedAuth,
    };

    const startWarmPreload = () => {
      void preloadAdminConsoleCore(
        {
          ...payload,
          source: "core-shell-idle-preload",
        },
        { timeoutMs: ADMIN_CONSOLE_IMPORT_TIMEOUT_MS }
      )
        .then(() => {
          if (cancelled) return;
          setCoreReady(true);
        })
        .catch((error) => {
          if (cancelled) return;
          logAdminRequestFailure("Admin console shell idle preload failed", error, payload);
        });
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleCallbackId = window.requestIdleCallback(
        () => {
          timeoutId = window.setTimeout(startWarmPreload, 150);
        },
        { timeout: 2500 }
      );
    } else {
      timeoutId = window.setTimeout(startWarmPreload, 1200);
    }

    return () => {
      cancelled = true;
      if (idleCallbackId != null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeSchoolId,
    coreReady,
    coreRetryNonce,
    isConsoleReadyForCore,
    isManagedAuth,
    legacyCoreRequested,
    pathname,
    profile,
    session,
  ]);

  function openLegacyCore(nextTab = "announcements") {
    if (isConsoleReadyForCore) {
      void preloadAdminConsoleCore(
        {
          pathname,
          role: profile.role,
          userId: session.user.id,
          schoolId: activeSchoolId,
          activeSchoolId,
          attempt: coreRetryNonce,
          managedAuth: isManagedAuth,
          source: "core-user-intent-preload",
        },
        { timeoutMs: ADMIN_CONSOLE_IMPORT_TIMEOUT_MS }
      )
        .then(() => {
          setCoreReady(true);
        })
        .catch((error) => {
          logAdminRequestFailure("Admin console user intent preload failed", error, {
            pathname,
            role: profile.role,
            userId: session.user.id,
            schoolId: activeSchoolId,
            activeSchoolId,
            attempt: coreRetryNonce,
            managedAuth: isManagedAuth,
          });
        });
    }
    setStartupTab(nextTab);
    setLegacyCoreRequested(true);
  }

  async function handleSignOut() {
    if (supabaseConfigError) {
      window.location.assign(homeHref || "/");
      return;
    }
    try {
      const { createAdminSupabaseClient } = await import("../lib/adminSupabase");
      const baseSupabase = createAdminSupabaseClient();
      await baseSupabase.auth.signOut({ scope: "local" });
    } finally {
      syncAdminAuthCookie(null);
      window.location.assign(homeHref || "/");
    }
  }

  const startupSchoolSelector = forcedSchoolScope?.id && profile?.role === "super_admin"
    ? (
      <div className="admin-school-switcher admin-topbar-school-switcher">
        <label>School</label>
        <div className="admin-topbar-school-label">{forcedSchoolScope.name || activeSchoolName || "Loading school..."}</div>
      </div>
    )
    : !forcedSchoolScope?.id && profile?.role === "admin"
      ? (
        <div className="admin-school-switcher admin-topbar-school-switcher">
          <label htmlFor="admin-startup-school-switcher">School</label>
          {schoolAssignments.length > 1 ? (
            <select
              id="admin-startup-school-switcher"
              value={activeSchoolId ?? ""}
              onChange={(event) => setSchoolScopeId(event.target.value || null)}
            >
              {schoolAssignments.map((assignment) => (
                <option key={assignment.school_id} value={assignment.school_id}>
                  {assignment.school_name}
                </option>
              ))}
            </select>
          ) : (
            <div className="admin-topbar-school-label">
              {schoolAssignments[0]?.school_name ?? activeSchoolName ?? "Loading school..."}
            </div>
          )}
        </div>
      )
      : null;

  function renderLegacyLoadingFrame({
    message,
    errorMessage = "",
    onRetry = null,
    onBack = null,
    backLabel = "BACK",
  }) {
    return (
      <AdminConsoleStartupFrame
        schoolName={activeSchoolName}
        displayName={profile?.display_name?.trim() || session?.user?.email || "User"}
        activeTab={startupTab}
        schoolSelector={startupSchoolSelector}
        changeSchoolHref={changeSchoolHref && profile?.role !== "super_admin" ? changeSchoolHref : ""}
        onSignOut={handleSignOut}
        onSelectTab={(nextTab) => {
          if (DIRECT_STARTUP_WORKSPACE_CONFIG[nextTab]) {
            setStartupTab(nextTab);
            return;
          }
          setStartupTab(nextTab);
          openLegacyCore(nextTab);
        }}
      >
        <div className="admin-title">{errorMessage ? "Startup Error" : "Opening Admin Console"}</div>
        <div className="admin-help" style={{ marginTop: 10 }}>
          {errorMessage || message}
        </div>
        <div className="admin-help" style={{ marginTop: 6 }}>
          The shell is ready. The selected workspace is still loading.
        </div>
        {errorMessage ? (
          <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {typeof onRetry === "function" ? (
              <button className="btn btn-primary" type="button" onClick={onRetry}>
                Retry
              </button>
            ) : null}
            {typeof onBack === "function" ? (
              <button className="btn" type="button" onClick={onBack}>
                {backLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </AdminConsoleStartupFrame>
    );
  }

  if (!isConsoleReadyForCore) {
    return (
      <LoadableAdminModule
        importTarget="AdminConsoleCore"
        loadModule={loadAdminConsoleCore}
        getLoadedModule={getLoadedAdminConsoleCore}
        context={{
          ...baseContext,
          source: "core-unmanaged-mount",
        }}
        timeoutMs={ADMIN_CONSOLE_IMPORT_TIMEOUT_MS}
        errorMessage="Failed to mount the admin console core. Retry or go back and try again."
        backLabel={changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel}
        onBack={() => {
          window.location.assign(changeSchoolHref || homeHref || "/");
        }}
        moduleProps={props}
      />
    );
  }

  if (coreError) {
    const fallbackHref = changeSchoolHref || homeHref || "/";
    const fallbackLabel = changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel;

    return renderLegacyLoadingFrame({
      errorMessage: coreError,
      onRetry: () => {
        setCoreError("");
        setCoreRetryNonce((value) => value + 1);
      },
      onBack: () => {
        window.location.assign(fallbackHref);
      },
      backLabel: fallbackLabel,
    });
  }

  if (!legacyCoreRequested) {
    return (
      <AdminConsoleStartupFrame
        schoolName={activeSchoolName}
        displayName={profile?.display_name?.trim() || session?.user?.email || "User"}
        activeTab={startupTab}
        schoolSelector={startupSchoolSelector}
        changeSchoolHref={changeSchoolHref && profile?.role !== "super_admin" ? changeSchoolHref : ""}
        onSignOut={handleSignOut}
        onSelectTab={(nextTab) => {
          if (DIRECT_STARTUP_WORKSPACE_CONFIG[nextTab]) {
            setStartupTab(nextTab);
            return;
          }
          openLegacyCore(nextTab);
        }}
      >
        {directStartupWorkspace ? (
          <LoadableAdminWorkspace
            importTarget={directStartupWorkspace.importTarget}
            loadModule={directStartupWorkspace.loadModule}
            getLoadedModule={directStartupWorkspace.getLoadedModule}
            context={{
              ...baseContext,
              source: "startup-workspace",
            }}
            moduleProps={{
              activeSchoolId,
              onOpenFullConsole: () => openLegacyCore(startupTab),
            }}
            loadingLabel={directStartupWorkspace.loadingLabel}
            errorTitle="Workspace Error"
            errorMessage={directStartupWorkspace.errorMessage}
          />
        ) : null}
      </AdminConsoleStartupFrame>
    );
  }

  if (!coreReady) {
    return renderLegacyLoadingFrame({
      message: `Preparing the ${getAdminPageTitle(startupTab)} workspace in the full admin console.`,
    });
  }

  return (
    <LoadableAdminModule
      key={coreRetryNonce}
      importTarget="AdminConsoleCore"
      loadModule={loadAdminConsoleCore}
      getLoadedModule={getLoadedAdminConsoleCore}
      context={{
          ...baseContext,
          source: "core-managed-mount",
        }}
      retryKey={coreRetryNonce}
      timeoutMs={ADMIN_CONSOLE_IMPORT_TIMEOUT_MS}
      errorMessage="Failed to mount the admin console core. Retry or go back and try again."
      backLabel={changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel}
      onBack={() => {
        window.location.assign(changeSchoolHref || homeHref || "/");
        }}
      moduleProps={{
        ...props,
        initialAdminTab: startupTab,
      }}
    />
  );
}
