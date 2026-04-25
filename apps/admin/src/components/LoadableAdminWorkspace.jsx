"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAdminDiagnosticsReport, logAdminEvent, logAdminRequestFailure } from "../lib/adminDiagnostics";
import { ADMIN_CONSOLE_IMPORT_TIMEOUT_MS } from "./adminConsoleLoader";
import AdminLoadingState from "./AdminLoadingState";

function resolveModuleExport(mod) {
  if (!mod) return null;
  return mod.default ?? mod;
}

function WorkspaceLoadingFallback({ label }) {
  return (
    <AdminLoadingState compact label={label} />
  );
}

export default function LoadableAdminWorkspace({
  importTarget,
  loadModule,
  getLoadedModule,
  context = {},
  moduleProps = {},
  loadingLabel = "Loading workspace...",
  errorTitle = "Workspace Error",
  errorMessage = "Failed to load this workspace. Retry or switch tabs and try again.",
  timeoutMs = ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  retryKey = 0,
  onBack = null,
  backLabel = "Back",
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
    source: context.source ?? "workspace-mount",
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
  const [workspaceError, setWorkspaceError] = useState("");

  if (!renderTraceLoggedRef.current) {
    renderTraceLoggedRef.current = true;
    logAdminEvent("Admin console workspace render start", {
      ...stableContext,
      workspaceReady: Boolean(LoadedComponent),
    });
  }

  useEffect(() => {
    logAdminEvent("Admin console workspace first commit", {
      ...stableContext,
      workspaceReady: Boolean(LoadedComponent),
    });
  }, [LoadedComponent, stableContext]);

  useEffect(() => {
    const initialComponent = resolveModuleExport(getLoadedModule?.());
    setLoadedComponent(() => initialComponent);
    setWorkspaceError("");
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
      logAdminEvent("Admin console workspace timeout", {
        ...stableContext,
        timeoutMs,
      });
      setWorkspaceError("This workspace is taking too long to render. Retry or switch tabs and come back.");
    }, timeoutMs);

    logAdminEvent("Admin console workspace mount requested", stableContext);

    void loadModule({
      ...stableContext,
      source: `${stableContext.source}-mount`,
    })
      .then((mod) => {
        if (cancelled) return;
        const NextComponent = resolveModuleExport(mod);
        logAdminEvent("Admin console workspace ready for render", stableContext);
        setLoadedComponent(() => NextComponent);
        setWorkspaceError("");
      })
      .catch((error) => {
        if (cancelled) return;
        logAdminRequestFailure("Admin console workspace mount failed", error, stableContext);
        setWorkspaceError(errorMessage);
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

  if (workspaceError) {
    return (
      <div className="admin-panel" style={{ marginTop: 16 }}>
        <div className="admin-title">{errorTitle}</div>
        <div className="admin-msg">{workspaceError}</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setWorkspaceError("");
              setLoadedComponent(null);
              renderTraceLoggedRef.current = false;
            }}
          >
            Retry
          </button>
          <button
            className="btn"
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
            Copy Diagnostics
          </button>
          {typeof onBack === "function" ? (
            <button className="btn" type="button" onClick={onBack}>
              {backLabel}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!LoadedComponent) {
    return <WorkspaceLoadingFallback label={loadingLabel} />;
  }

  return <LoadedComponent {...moduleProps} />;
}
