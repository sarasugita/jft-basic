"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createAdminSupabaseClient,
  getAdminSupabaseConfig,
  getAdminSupabaseConfigError,
} from "../../lib/adminSupabase";
import { createAdminTrace, isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../../lib/adminDiagnostics";
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from "../../lib/requestTimeout";
import { syncAdminAuthCookie } from "../../lib/authCookies";
import AdminLoadingState from "../AdminLoadingState";
import { useLanguage } from "../../lib/i18n";

const SuperAdminContext = createContext(null);
const ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY = "jft_admin_sidebar_collapsed_v1";
const MOBILE_SIDEBAR_BREAKPOINT_PX = 900;
const PROFILE_LOOKUP_RETRY_DELAYS_MS = [400, 1200];

function waitForRetry(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function buildSuperNav(t) {
  return [
    {
      label: t("Dashboard"),
      href: "/super/dashboard",
      icon: (
        <svg viewBox="0 0 24 24" className="admin-nav-svg">
          <path d="M4 13h6v7H4zM14 4h6v16h-6zM4 4h6v5H4zM14 14h6v6h-6z" />
        </svg>
      ),
    },
    {
      label: t("Schools List"),
      href: "/super/schools",
      icon: (
        <svg viewBox="0 0 24 24" className="admin-nav-svg">
          <path d="M3 20h18" />
          <path d="M6 20V8l6-4 6 4v12" />
          <path d="M9 12h.01M15 12h.01M9 16h.01M15 16h.01" />
        </svg>
      ),
    },
    {
      label: t("Tests Management"),
      icon: (
        <svg viewBox="0 0 24 24" className="admin-nav-svg">
          <path d="M7 4h10l3 3v13H7z" />
          <path d="M17 4v4h4" />
          <path d="M10 12h7M10 16h7M10 8h3" />
        </svg>
      ),
      children: [
        { label: t("Import Questions"), href: "/super/tests/import" },
        { label: t("Analytics"), href: "/super/tests/analytics" },
      ],
    },
    {
      label: t("Audit / Logs"),
      href: "/super/audit",
      icon: (
        <svg viewBox="0 0 24 24" className="admin-nav-svg">
          <path d="M8 4h8" />
          <path d="M9 2h6v4H9z" />
          <path d="M6 6h12v16H6z" />
          <path d="M9 11h6M9 15h6" />
        </svg>
      ),
    },
  ];
}

function isActivePath(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isScopedAdminConsolePath(pathname) {
  return /^\/super\/schools\/[^/]+\/admin(?:\/.*)?$/.test(pathname ?? "");
}

function getPageMeta(pathname, t) {
  if (pathname === "/super/dashboard") {
    return {
      title: t("Dashboard"),
      description: t("Global system overview across schools, tests, and activity."),
    };
  }
  if (pathname === "/super/schools") {
    return {
      title: t("Schools List"),
      description: t("Manage schools, review metrics, and enter school-scoped admin mode."),
    };
  }
  if (/^\/super\/schools\/[^/]+\/admins$/.test(pathname ?? "")) {
    return {
      title: t("School Admins"),
      description: t("Manage school-level admin accounts for the selected school."),
    };
  }
  if (pathname === "/super/tests/import") {
    return {
      title: t("Upload Question Sets"),
      description: t("Manage the global question-set library for daily and model tests."),
    };
  }
  if (pathname === "/super/tests/analytics") {
    return {
      title: t("Analytics"),
      description: t("Cross-school test analytics workspace for filters, comparisons, and trends."),
    };
  }
  if (/^\/super\/tests\/analytics\/[^/]+$/.test(pathname ?? "")) {
    return {
      title: t("Question Set Comparison"),
      description: t("School-by-school and question-by-question comparison for a selected question set."),
    };
  }
  if (pathname === "/super/audit") {
    return {
      title: t("Audit / Logs"),
      description: t("Operational audit history and system events will live here."),
    };
  }

  return {
    title: t("Super Admin"),
    description: t("Global administration workspace."),
  };
}

function Brand() {
  return (
    <div className="admin-brand">
      <div className="admin-brand-text">
        <div className="admin-brand-title">
          <img className="admin-brand-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
        </div>
        <div className="admin-brand-sub">Super Admin Console</div>
      </div>
    </div>
  );
}

function UserBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor" />
      <path d="M4 20a8 8 0 0 1 16 0Z" fill="currentColor" />
    </svg>
  );
}

function buildOpenGroups(pathname, superNav) {
  const groups = {};
  for (const item of superNav) {
    if (item.children?.length) {
      groups[item.label] = item.children.some((child) => isActivePath(pathname, child.href));
    }
  }
  return groups;
}

function SuperSidebar({
  pathname,
  email,
  onNavigate,
  onSignOut,
  sidebarCollapsed,
  onToggleSidebar,
  isMobileViewport,
  mobileSidebarOpen,
  onCloseMobileSidebar,
}) {
  const { lang, setLang, t } = useLanguage();
  const superNav = buildSuperNav(t);
  const [openGroups, setOpenGroups] = useState(() => buildOpenGroups(pathname, superNav));

  useEffect(() => {
    setOpenGroups(buildOpenGroups(pathname, superNav));
  }, [pathname, lang]);

  const sidebarToggleLabel = isMobileViewport
    ? t("Close menu")
    : sidebarCollapsed
      ? t("Expand menu")
      : t("Collapse menu");

  return (
    <aside
      id="super-admin-sidebar"
      className={`admin-sidebar ${sidebarCollapsed ? "collapsed" : ""} ${mobileSidebarOpen ? "mobile-open" : ""}`}
      aria-hidden={isMobileViewport ? !mobileSidebarOpen : undefined}
    >
      <div className="admin-sidebar-head">
        <Brand />
        <button
          className="admin-sidebar-toggle"
          type="button"
          aria-label={sidebarToggleLabel}
          aria-expanded={isMobileViewport ? mobileSidebarOpen : !sidebarCollapsed}
          onClick={isMobileViewport ? onCloseMobileSidebar : onToggleSidebar}
        >
          <svg viewBox="0 0 24 24" className="admin-sidebar-toggle-icon" aria-hidden="true">
            {isMobileViewport ? <path d="M6 6l12 12M18 6 6 18" /> : sidebarCollapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
          </svg>
        </button>
      </div>
      <div className="admin-nav">
        {superNav.map((item) => {
          if (item.children?.length) {
            const open = Boolean(openGroups[item.label]);
                return (
                    <div key={item.label} className={`admin-nav-group ${open ? "active" : ""}`}>
                <button
                  type="button"
                  className={`admin-nav-item admin-group-toggle ${open ? "active" : ""}`}
                  onClick={() => {
                    const next = buildOpenGroups("", superNav);
                    next[item.label] = true;
                    setOpenGroups(next);
                    const firstChildHref = item.children[0]?.href;
                    if (firstChildHref && !isActivePath(pathname, firstChildHref)) {
                      onNavigate(firstChildHref);
                    }
                  }}
                >
                  <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
                  {item.label}
                  <span className={`admin-nav-arrow ${open ? "open" : ""}`}>▾</span>
                </button>
                {open ? (
                  <div className="admin-subnav">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`admin-subnav-item ${isActivePath(pathname, child.href) ? "active" : ""}`}
                        onClick={(event) => {
                          event.preventDefault();
                          onNavigate(child.href);
                        }}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`admin-nav-item ${isActivePath(pathname, item.href) ? "active" : ""}`}
              onClick={(event) => {
                event.preventDefault();
                setOpenGroups(buildOpenGroups(item.href, superNav));
                onNavigate(item.href);
              }}
            >
              <span className="admin-nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
      <div className="admin-sidebar-footer">
        <div className="admin-email">{email}</div>
        <div className="admin-lang-toggle" role="group" aria-label={t("Language")}>
          <button
            className={`admin-lang-toggle-opt ${lang === "en" ? "active" : ""}`}
            onClick={() => setLang("en")}
            type="button"
          >
            EN
          </button>
          <button
            className={`admin-lang-toggle-opt ${lang === "ja" ? "active" : ""}`}
            onClick={() => setLang("ja")}
            type="button"
          >
            日本語
          </button>
        </div>
        <button className="admin-nav-item logout" aria-label={t("Sign out")} onClick={onSignOut}>
          <span className="admin-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="admin-nav-svg">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
}

export function useSuperAdmin() {
  const value = useContext(SuperAdminContext);
  if (!value) {
    throw new Error("useSuperAdmin must be used inside SuperAdminShell.");
  }
  return value;
}

export default function SuperAdminShell({ children }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const bypassShellAuth = isScopedAdminConsolePath(pathname);
  const supabaseConfigError = getAdminSupabaseConfigError();
  const { supabaseUrl, supabaseAnonKey } = getAdminSupabaseConfig();
  const supabase = useMemo(() => (supabaseConfigError ? null : createAdminSupabaseClient()), [supabaseConfigError]);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState("");
  const profileRef = useRef(null);
  const pathnameRef = useRef(pathname);
  const routerRef = useRef(router);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY);
    setSidebarCollapsed(stored === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_SIDEBAR_BREAKPOINT_PX}px)`);
    const syncViewport = () => {
      const mobile = mediaQuery.matches;
      setIsMobileViewport(mobile);
      if (!mobile) {
        setMobileSidebarOpen(false);
      }
    };

    syncViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }

    mediaQuery.addListener(syncViewport);
    return () => mediaQuery.removeListener(syncViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    setMobileSidebarOpen(false);
  }, [isMobileViewport, pathname]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isMobileViewport && mobileSidebarOpen) {
      document.body.classList.add("admin-mobile-menu-open");
      return () => {
        document.body.classList.remove("admin-mobile-menu-open");
      };
    }
    document.body.classList.remove("admin-mobile-menu-open");
    return undefined;
  }, [isMobileViewport, mobileSidebarOpen]);

  async function getAccessToken(forceRefresh = false) {
    if (!supabase) {
      throw new Error(supabaseConfigError || "Admin client is unavailable.");
    }
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData?.session?.access_token ?? null;
    const expiresAt = sessionData?.session?.expires_at ?? 0;

    if (forceRefresh || !accessToken || expiresAt * 1000 < Date.now() + 60_000) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        logAdminRequestFailure("Super shell refreshSession failed", refreshError, {
          pathname: pathnameRef.current,
        });
        throw new Error(refreshError.message || "Failed to refresh session");
      }
      accessToken = refreshed?.session?.access_token ?? null;
    }

    if (!accessToken) {
      throw new Error("Please log in again.");
    }

    return accessToken;
  }

  async function invokeEdgeFunction(functionName, body, accessToken, options = {}) {
    const isFormData = body instanceof FormData;
    if (isFormData && typeof options.onUploadProgress === "function") {
      const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${supabaseUrl}/functions/v1/${functionName}`);
        xhr.timeout = DEFAULT_REQUEST_TIMEOUT_MS;
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.setRequestHeader("apikey", supabaseAnonKey);
        xhr.upload.onprogress = (event) => {
          options.onUploadProgress({
            loaded: event.loaded,
            total: event.total,
            lengthComputable: event.lengthComputable,
          });
        };
        xhr.onerror = () => reject(new Error(`Failed to call ${functionName}`));
        xhr.ontimeout = () => reject(new Error(`Request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`));
        xhr.onload = () => {
          const text = xhr.responseText ?? "";
          let data = null;
          try {
            data = text ? JSON.parse(text) : null;
          } catch {
            data = text;
          }
          resolve({
            response: {
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
            },
            data,
            text,
          });
        };
        xhr.send(body);
      });
      return response;
    }

    const response = await fetchWithTimeout(
      `${supabaseUrl}/functions/v1/${functionName}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: supabaseAnonKey,
          ...(isFormData ? {} : { "Content-Type": "application/json" }),
        },
        body: isFormData ? body : JSON.stringify(body ?? {}),
      },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    return { response, data, text };
  }

  async function invokeWithAuth(functionName, body, options = {}) {
    if (supabaseConfigError) {
      return { data: null, error: { message: supabaseConfigError } };
    }

    const execute = async (forceRefresh = false) => {
      const accessToken = await getAccessToken(forceRefresh);
      console.log("[EdgeInvoke]", functionName, "token?", !!accessToken, "forceRefresh?", forceRefresh);
      return invokeEdgeFunction(functionName, body, accessToken, options);
    };

    let result = await execute(false);
    const failureText = `${result.data?.error ?? result.data?.message ?? result.text ?? ""}`;
    const shouldRetry = result.response.status === 401 || /invalid jwt/i.test(failureText);

    if (shouldRetry) {
      result = await execute(true);
    }

    if (!result.response.ok) {
      logAdminRequestFailure("Super shell edge function invoke failed", result.data, {
        functionName,
        status: result.response.status,
      });
      const errorContext = {
        status: result.response.status,
        async json() {
          return result.data;
        },
        async text() {
          return result.text;
        },
      };
      return {
        data: null,
        error: {
          message: result.data?.error || result.data?.message || result.text || `Failed to call ${functionName}`,
          detail: result.data?.detail ?? "",
          code: result.data?.code ?? "",
          hint: result.data?.hint ?? "",
          status: result.response.status,
          context: errorContext,
        },
      };
    }

    return { data: result.data, error: null };
  }

  useEffect(() => {
    if (supabaseConfigError) {
      setSession(null);
      setProfile(null);
      setStartupError(supabaseConfigError);
      setLoading(false);
      return;
    }
    if (!supabase) return;
    let mounted = true;
    let profileAbortController = null;
    let authEventTimeout = null;

    function redirectToLogin(reason, extra = {}) {
      logAdminEvent("Super shell redirecting to login", {
        reason,
        pathname: pathnameRef.current,
        ...extra,
      });
      routerRef.current?.replace("/");
    }

    function redirectToPasswordChange(reason, extra = {}) {
      logAdminEvent("Super shell redirecting for password change", {
        reason,
        pathname: pathnameRef.current,
        ...extra,
      });
      routerRef.current?.replace("/");
    }

    async function loadProfile(nextSession, reason) {
      const finishTrace = createAdminTrace("Super shell profile lookup", {
        pathname: pathnameRef.current,
        reason,
        userId: nextSession?.user?.id ?? null,
      });
      if (profileAbortController) {
        profileAbortController.abort();
      }
      profileAbortController = new AbortController();

      try {
        if (!nextSession) {
          if (mounted) {
            setSession(null);
            setProfile(null);
            setStartupError("");
            setLoading(false);
          }
          redirectToLogin("no-session", { source: reason });
          return { ok: false, status: "no-session" };
        }

        const initialResult = await supabase
          .from("profiles")
          .select("id, role, display_name, account_status, force_password_change")
          .eq("id", nextSession.user.id)
          .single()
          .abortSignal(profileAbortController.signal);

        let resolvedProfile = initialResult.data ?? null;
        let resolvedError = initialResult.error ?? null;

        for (
          let attempt = 0;
          resolvedError && attempt < PROFILE_LOOKUP_RETRY_DELAYS_MS.length;
          attempt += 1
        ) {
          logAdminRequestFailure("Super shell profile lookup retrying", resolvedError, {
            pathname: pathnameRef.current,
            reason,
            userId: nextSession.user.id,
            attempt: attempt + 1,
          });
          await waitForRetry(PROFILE_LOOKUP_RETRY_DELAYS_MS[attempt]);
          if (!mounted) return;

          const retryResult = await supabase
            .from("profiles")
            .select("id, role, display_name, account_status, force_password_change")
            .eq("id", nextSession.user.id)
            .single()
            .abortSignal(profileAbortController.signal);
          resolvedProfile = retryResult.data ?? null;
          resolvedError = retryResult.error ?? null;
        }

        if (!mounted) return;

        if (resolvedError) {
          finishTrace("failed", {
            message: resolvedError.message || "",
            code: resolvedError.code || "",
            status: resolvedError.status ?? null,
          });
          logAdminRequestFailure("Super shell profile lookup failed", resolvedError, {
            pathname: pathnameRef.current,
            reason,
            userId: nextSession.user.id,
          });
          setSession(nextSession);
          setProfile(null);
          setStartupError(error.message || "Failed to load admin profile.");
          setLoading(false);
          return { ok: false, status: "lookup-failed" };
        }

        if (!resolvedProfile || resolvedProfile.role !== "super_admin" || resolvedProfile.account_status !== "active") {
          finishTrace("rejected", {
            role: resolvedProfile?.role ?? null,
            accountStatus: resolvedProfile?.account_status ?? null,
          });
          setSession(null);
          setProfile(null);
          syncAdminAuthCookie(null);
          setStartupError("Super admin access is required.");
          setLoading(false);
          redirectToLogin("super-admin-profile-required", {
            source: reason,
            userId: nextSession.user.id,
            role: resolvedProfile?.role ?? null,
            accountStatus: resolvedProfile?.account_status ?? null,
          });
          return { ok: false, status: "profile-rejected" };
        }

        if (resolvedProfile.force_password_change) {
          finishTrace("force-password-change", {
            role: resolvedProfile.role,
          });
          setSession(nextSession);
          setProfile(null);
          setStartupError("");
          setLoading(true);
          redirectToPasswordChange("force-password-change-required", {
            source: reason,
            userId: nextSession.user.id,
          });
          return { ok: false, status: "force-password-change" };
        }

        setSession(nextSession);
        setProfile(resolvedProfile);
        setStartupError("");
        setLoading(false);
        finishTrace("success", {
          role: resolvedProfile.role,
        });
        return { ok: true, status: "success", profile: resolvedProfile };
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          finishTrace("aborted", {
            message: error?.message ?? "",
          });
          logAdminRequestFailure("Super shell profile lookup aborted", error, {
            pathname: pathnameRef.current,
            reason,
            userId: nextSession?.user?.id ?? null,
          });
          setLoading(false);
          return { ok: false, status: "aborted" };
        }
        finishTrace("threw", {
          message: error instanceof Error ? error.message : String(error ?? ""),
        });
        logAdminRequestFailure("Super shell profile lookup threw", error, {
          pathname: pathnameRef.current,
          reason,
          userId: nextSession?.user?.id ?? null,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to load admin profile.");
        setLoading(false);
        return { ok: false, status: "threw" };
      }
    }

    async function bootstrap(reason) {
      const finishTrace = createAdminTrace("Super shell bootstrap", {
        pathname: pathnameRef.current,
        reason,
      });
      setLoading(true);
      try {
        const finishGetSessionTrace = createAdminTrace("Super shell getSession", {
          pathname: pathnameRef.current,
          reason,
        });
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          finishGetSessionTrace("failed", {
            message: error.message || "",
            code: error.code || "",
            status: error.status ?? null,
          });
          logAdminRequestFailure("Super shell getSession failed", error, {
            pathname: pathnameRef.current,
            reason,
          });
        } else {
          finishGetSessionTrace("success", {
            hasSession: Boolean(data?.session),
            userId: data?.session?.user?.id ?? null,
          });
        }
        syncAdminAuthCookie(data?.session ?? null);
        if (!mounted) return;
        const nextSession = data?.session ?? null;
        setSession(nextSession);
        const profileResult = await loadProfile(nextSession, reason);
        if (profileResult?.ok) {
          finishTrace("success", {
            hasSession: Boolean(nextSession),
            userId: nextSession?.user?.id ?? null,
          });
        } else {
          finishTrace("completed-without-profile", {
            hasSession: Boolean(nextSession),
            userId: nextSession?.user?.id ?? null,
            profileStatus: profileResult?.status ?? "unknown",
          });
        }
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          finishTrace("aborted", {
            message: error?.message ?? "",
          });
          logAdminRequestFailure("Super shell bootstrap aborted", error, {
            pathname: pathnameRef.current,
            reason,
          });
          setLoading(false);
          return;
        }
        finishTrace("failed", {
          message: error instanceof Error ? error.message : String(error ?? ""),
        });
        logAdminRequestFailure("Super shell bootstrap failed", error, {
          pathname: pathnameRef.current,
          reason,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to bootstrap admin session.");
        setLoading(false);
      }
    }

    bootstrap("initial");

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logAdminEvent("Super shell auth event", {
        event,
        pathname: pathnameRef.current,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id ?? null,
      });
      syncAdminAuthCookie(nextSession ?? null);
      if (!mounted) return;
      if (event === "INITIAL_SESSION") {
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        setSession(nextSession ?? null);
        setLoading(false);
        if (!profileRef.current && nextSession) {
          if (authEventTimeout) clearTimeout(authEventTimeout);
          authEventTimeout = setTimeout(() => {
            void loadProfile(nextSession, `auth:${event}`);
          }, 0);
        }
        return;
      }
      setSession(nextSession ?? null);
      if (authEventTimeout) clearTimeout(authEventTimeout);
      authEventTimeout = setTimeout(() => {
        void loadProfile(nextSession ?? null, `auth:${event}`);
      }, 0);
    });

    return () => {
      mounted = false;
      if (profileAbortController) {
        profileAbortController.abort();
      }
      if (authEventTimeout) {
        clearTimeout(authEventTimeout);
      }
      listener.subscription.unsubscribe();
    };
  }, [supabase, supabaseConfigError]);

  const contextValue = useMemo(() => ({
    supabase,
    session,
    profile,
    invokeWithAuth,
    loading,
    startupError,
  }), [invokeWithAuth, loading, profile, session, startupError, supabase]);

  async function handleStartupRecovery() {
    if (!supabase) {
      router.replace("/");
      return;
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      logAdminRequestFailure("Super shell startup recovery sign-out failed", error, {
        pathname: pathnameRef.current,
      });
    } finally {
      syncAdminAuthCookie(null);
      setSession(null);
      setProfile(null);
      setStartupError("");
      setLoading(false);
      routerRef.current?.replace("/");
    }
  }

  let content = null;
  if (bypassShellAuth) {
    content = children;
  } else if (loading) {
    content = (
      <AdminLoadingState centered label={t("Loading...")} />
    );
  } else if (startupError) {
    content = (
      <div className="admin-login">
        <h2>{t("Startup Error")}</h2>
        <div className="admin-msg">{startupError}</div>
        <button
          className="admin-password-change-secondary"
          type="button"
          onClick={() => {
            void handleStartupRecovery();
          }}
        >
          {t("SIGN OUT AND RETRY")}
        </button>
      </div>
    );
  } else if (session && profile) {
    const pageMeta = getPageMeta(pathname, t);
    const displayName = profile.display_name?.trim() || session.user.email || "User";
    function handleSidebarNavigate(href) {
      if (sidebarCollapsed) {
        setSidebarCollapsed(false);
      }
      if (isMobileViewport) {
        setMobileSidebarOpen(false);
      }
      router.push(href);
    }

    content = (
      <div className={`admin-shell ${mobileSidebarOpen ? "mobile-sidebar-open" : ""}`}>
        <SuperSidebar
          pathname={pathname}
          email={session.user.email}
          onNavigate={handleSidebarNavigate}
          onSignOut={() => supabase.auth.signOut()}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          isMobileViewport={isMobileViewport}
          mobileSidebarOpen={mobileSidebarOpen}
          onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
        />
        <button
          type="button"
          className={`admin-mobile-sidebar-backdrop ${mobileSidebarOpen ? "visible" : ""}`}
          aria-label={t("Close menu")}
          onClick={() => setMobileSidebarOpen(false)}
        />
        <div className="admin-main">
          <div className="admin-wrap">
            <div className="super-page-topbar">
              <div className="super-page-topbar-title-row">
                <button
                  type="button"
                  className="admin-mobile-menu-toggle"
                  aria-label={mobileSidebarOpen ? t("Close menu") : t("Open menu")}
                  aria-controls="super-admin-sidebar"
                  aria-expanded={mobileSidebarOpen}
                  onClick={() => setMobileSidebarOpen((current) => !current)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {mobileSidebarOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
                  </svg>
                </button>
                <div className="super-page-topbar-title">{pageMeta.title}</div>
              </div>
              <div className="super-page-topbar-meta">
                <div className="super-page-topbar-console">{t("Superadmin Console")}</div>
                <div className="super-page-topbar-user">
                  <UserBadgeIcon />
                  <span>{displayName}</span>
                </div>
              </div>
            </div>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <SuperAdminContext.Provider value={contextValue}>
      {content}
    </SuperAdminContext.Provider>
  );
}
