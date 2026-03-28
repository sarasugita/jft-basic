"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAdminDiagnosticsReport, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import { ADMIN_CONSOLE_IMPORT_TIMEOUT_MS } from "./adminConsoleLoader";

function resolveModuleExport(mod) {
  if (!mod) return null;
  return mod.default ?? mod;
}

function LoadingFallback({ label }) {
  return (
    <div className="admin-login">
      <h2>{label}</h2>
    </div>
  );
}

export default function LoadableAdminModule({
  importTarget,
  loadModule,
  getLoadedModule,
  context = {},
  moduleProps = {},
  loadingLabel = "Loading...",
  loadingFallback = null,
  errorTitle = "Startup Error",
  errorMessage = "Failed to load the admin console. Retry or go back and try again.",
  timeoutMs = ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  retryKey = 0,
  backLabel = "BACK",
  onBack = null,
  diagnosticsExtra = {},
}) {
  const stableContext = useMemo(() => ({
    pathname: context.pathname ?? "",
    role: context.role ?? null,
    userId: context.userId ?? null,
    schoolId: context.schoolId ?? null,
    activeSchoolId: context.activeSchoolId ?? context.schoolId ?? null,
    attempt: context.attempt ?? retryKey,
    managedAuth: context.managedAuth ?? null,
    source: context.source ?? "module-mount",
    importTarget,
  }), [
    context.activeSchoolId,
    context.attempt,
    context.managedAuth,
    context.pathname,
    context.role,
    context.schoolId,
    context.source,
    context.userId,
    importTarget,
    retryKey,
  ]);
  const renderTraceLoggedRef = useRef(false);
  const [LoadedComponent, setLoadedComponent] = useState(() => resolveModuleExport(getLoadedModule?.()));
  const [moduleError, setModuleError] = useState("");

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console module mount render start", {
      ...stableContext,
      moduleReady: Boolean(LoadedComponent),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console module mount first commit", {
      ...stableContext,
      moduleReady: Boolean(LoadedComponent),
    });
  }, [LoadedComponent, stableContext]);

  useEffect(() => {
    const initialComponent = resolveModuleExport(getLoadedModule?.());
    setLoadedComponent(() => initialComponent);
    setModuleError("");
    renderTraceLoggedRef.current = false;
  }, [getLoadedModule, retryKey]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;

    const cachedComponent = resolveModuleExport(getLoadedModule?.());
    if (cachedComponent) {
      if (LoadedComponent !== cachedComponent) {
        setLoadedComponent(() => cachedComponent);
      }
      return () => {
        cancelled = true;
      };
    }

    if (LoadedComponent) {
      return () => {
        cancelled = true;
      };
    }

    timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      logAdminEvent("Admin console module mount timeout", {
        ...stableContext,
        timeoutMs,
      });
      setModuleError("Admin console is taking too long to render. Retry or go back and try again.");
    }, timeoutMs);

    logAdminEvent("Admin console module mount requested", stableContext);

    void loadModule({
      ...stableContext,
      source: `${stableContext.source}-mount`,
    })
      .then((mod) => {
        if (cancelled) return;
        const NextComponent = resolveModuleExport(mod);
        logAdminEvent("Admin console module ready for render", stableContext);
        setLoadedComponent(() => NextComponent);
        setModuleError("");
      })
      .catch((error) => {
        if (cancelled) return;
        logAdminRequestFailure("Admin console module mount failed", error, stableContext);
        setModuleError(errorMessage);
      })
      .finally(() => {
        if (timeoutId != null) {
          window.clearTimeout(timeoutId);
        }
      });

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    LoadedComponent,
    errorMessage,
    getLoadedModule,
    loadModule,
    stableContext,
    timeoutMs,
  ]);

  if (moduleError) {
    return (
      <div className="admin-login">
        <h2>{errorTitle}</h2>
        <div className="admin-msg">{moduleError}</div>
        <button
          className="admin-password-change-secondary"
          type="button"
          onClick={() => {
            setModuleError("");
            setLoadedComponent(null);
            renderTraceLoggedRef.current = false;
          }}
        >
          RETRY
        </button>
        <button
          className="admin-password-change-secondary"
          type="button"
          onClick={async () => {
            const report = getAdminDiagnosticsReport({
              importTarget,
              source: stableContext.source,
              ...stableContext,
              ...diagnosticsExtra,
            });
            try {
              await navigator.clipboard.writeText(report);
            } catch {
              // Clipboard may be unavailable on some browsers.
            }
          }}
        >
          COPY DIAGNOSTICS
        </button>
        {onBack ? (
          <button
            className="admin-password-change-secondary"
            type="button"
            onClick={onBack}
          >
            {backLabel}
          </button>
        ) : null}
      </div>
    );
  }

  if (!LoadedComponent) {
    if (loadingFallback) {
      return typeof loadingFallback === "function"
        ? loadingFallback({ label: loadingLabel })
        : loadingFallback;
    }
    return <LoadingFallback label={loadingLabel} />;
  }

  return <LoadedComponent {...moduleProps} />;
}
