"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import { ADMIN_CONSOLE_IMPORT_TIMEOUT_MS, preloadAdminConsoleCore } from "./adminConsoleLoader";

const LazyAdminConsoleCore = dynamic(() => import("./AdminConsoleCore"), {
  loading: () => (
    <div className="admin-login">
      <h2>Loading...</h2>
    </div>
  ),
});

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

    return () => {
      cancelled = true;
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
    return <LazyAdminConsoleCore {...props} />;
  }

  if (coreError) {
    const fallbackHref = changeSchoolHref || homeHref || "/";
    const fallbackLabel = changeSchoolHref ? "BACK TO SCHOOLS" : homeLabel;

    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">{coreError}</div>
        <button
          className="admin-password-change-secondary"
          type="button"
          onClick={() => {
            setCoreError("");
            setCoreRetryNonce((value) => value + 1);
          }}
        >
          RETRY
        </button>
        <button
          className="admin-password-change-secondary"
          type="button"
          onClick={() => {
            window.location.assign(fallbackHref);
          }}
        >
          {fallbackLabel}
        </button>
      </div>
    );
  }

  if (!coreReady) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  return <LazyAdminConsoleCore key={coreRetryNonce} {...props} />;
}
