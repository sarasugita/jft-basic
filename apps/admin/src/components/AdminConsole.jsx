"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import {
  ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  getLoadedAdminConsoleCore,
  loadAdminConsoleCore,
  preloadAdminConsoleCore,
} from "./adminConsoleLoader";
import LoadableAdminModule from "./LoadableAdminModule";

function AdminConsoleStartupShell({
  schoolName,
  displayName,
  message = "Loading admin workspace...",
  errorMessage = "",
  onRetry = null,
  onBack = null,
  backLabel = "BACK",
}) {
  const navItems = [
    "Student List",
    "Attendance",
    "Model Test",
    "Daily Test",
    "Schedule & Record",
    "Ranking",
    "Announcements",
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
          {navItems.map((label, index) => (
            <button
              key={label}
              className={`admin-nav-item ${index === 0 ? "active" : ""}`}
              type="button"
              disabled
            >
              {label}
            </button>
          ))}
        </div>
        <div className="admin-sidebar-footer">
          <div className="admin-email">{displayName || "Loading user..."}</div>
        </div>
      </aside>

      <div className="admin-main">
        <div className="admin-wrap">
          <div className="admin-page-topbar">
            <div className="admin-page-topbar-title">Student List</div>
            <div className="admin-page-topbar-meta">
              <div className="admin-school-switcher admin-topbar-school-switcher">
                <label>School</label>
                <div className="admin-topbar-school-label">{schoolName || "Loading school..."}</div>
              </div>
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

          <div className="admin-panel admin-console-panel">
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
            ) : (
              <div className="admin-help" style={{ marginTop: 16 }}>
                Loading students workspace...
              </div>
            )}
          </div>
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

  const isManagedAuth = managedSession !== undefined || managedProfile !== undefined;
  const session = managedSession ?? null;
  const profile = managedProfile ?? null;
  const activeSchoolId = forcedSchoolScope?.id ?? profile?.school_id ?? null;
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
    let cancelled = false;
    let preloadTimeoutId = null;
    let preloadFrameId = null;

    if (!isConsoleReadyForCore) {
      setCoreReady(false);
      setCoreError("");
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
    pathname,
    profile,
    session,
  ]);

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

    return (
      <AdminConsoleStartupShell
        schoolName={forcedSchoolScope?.name ?? null}
        displayName={profile?.display_name?.trim() || session?.user?.email || "User"}
        errorMessage={coreError}
        onRetry={() => {
          setCoreError("");
          setCoreRetryNonce((value) => value + 1);
        }}
        onBack={() => {
          window.location.assign(fallbackHref);
        }}
        backLabel={fallbackLabel}
      />
    );
  }

  if (!coreReady) {
    return (
      <AdminConsoleStartupShell
        schoolName={forcedSchoolScope?.name ?? null}
        displayName={profile?.display_name?.trim() || session?.user?.email || "User"}
        message="Preparing the admin console shell and first workspace."
      />
    );
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
      moduleProps={props}
    />
  );
}
