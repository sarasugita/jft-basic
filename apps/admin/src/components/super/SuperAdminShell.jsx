"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createAdminSupabaseClient,
  getAdminSupabaseConfig,
  getAdminSupabaseConfigError,
} from "../../lib/adminSupabase";
import { isAbortLikeError, logAdminEvent, logAdminRequestFailure } from "../../lib/adminDiagnostics";
import { syncAdminAuthCookie } from "../../lib/authCookies";

const SuperAdminContext = createContext(null);
const ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY = "jft_admin_sidebar_collapsed_v1";

const superNav = [
  {
    label: "Dashboard",
    href: "/super/dashboard",
    icon: (
      <svg viewBox="0 0 24 24" className="admin-nav-svg">
        <path d="M4 13h6v7H4zM14 4h6v16h-6zM4 4h6v5H4zM14 14h6v6h-6z" />
      </svg>
    ),
  },
  {
    label: "Schools",
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
    label: "Tests Management",
    icon: (
      <svg viewBox="0 0 24 24" className="admin-nav-svg">
        <path d="M7 4h10l3 3v13H7z" />
        <path d="M17 4v4h4" />
        <path d="M10 12h7M10 16h7M10 8h3" />
      </svg>
    ),
    children: [
      { label: "Import Questions", href: "/super/tests/import" },
      { label: "Analytics", href: "/super/tests/analytics" },
    ],
  },
  {
    label: "Audit / Logs",
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

function isActivePath(pathname, href) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isScopedAdminConsolePath(pathname) {
  return /^\/super\/schools\/[^/]+\/admin(?:\/.*)?$/.test(pathname ?? "");
}

function getPageMeta(pathname) {
  if (pathname === "/super/dashboard") {
    return {
      title: "Dashboard",
      description: "Global system overview across schools, tests, and activity.",
    };
  }
  if (pathname === "/super/schools") {
    return {
      title: "Schools",
      description: "Manage schools, review metrics, and enter school-scoped admin mode.",
    };
  }
  if (/^\/super\/schools\/[^/]+\/admins$/.test(pathname ?? "")) {
    return {
      title: "School Admins",
      description: "Manage school-level admin accounts for the selected school.",
    };
  }
  if (pathname === "/super/tests/import") {
    return {
      title: "Import Questions",
      description: "Manage the global question-set library for daily and model tests.",
    };
  }
  if (pathname === "/super/tests/analytics") {
    return {
      title: "Analytics",
      description: "Cross-school test analytics workspace for filters, comparisons, and trends.",
    };
  }
  if (pathname === "/super/audit") {
    return {
      title: "Audit / Logs",
      description: "Operational audit history and system events will live here.",
    };
  }

  return {
    title: "Super Admin",
    description: "Global administration workspace.",
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

function buildOpenGroups(pathname) {
  const groups = {};
  for (const item of superNav) {
    if (item.children?.length) {
      groups[item.label] = item.children.some((child) => isActivePath(pathname, child.href));
    }
  }
  return groups;
}

function SuperSidebar({ pathname, email, onNavigate, onSignOut, sidebarCollapsed, onToggleSidebar }) {
  const [openGroups, setOpenGroups] = useState(() => buildOpenGroups(pathname));

  useEffect(() => {
    setOpenGroups(buildOpenGroups(pathname));
  }, [pathname]);

  return (
    <aside className={`admin-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
      <div className="admin-sidebar-head">
        <Brand />
        <button
          className="admin-sidebar-toggle"
          type="button"
          aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <svg viewBox="0 0 24 24" className="admin-sidebar-toggle-icon" aria-hidden="true">
            {sidebarCollapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
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
                    const next = buildOpenGroups("");
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
                setOpenGroups(buildOpenGroups(item.href));
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
        <button className="admin-nav-item logout" onClick={onSignOut}>
          Sign out
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY);
    setSidebarCollapsed(stored === "1");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSE_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

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
          pathname,
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

    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
      },
      body: isFormData ? body : JSON.stringify(body ?? {}),
    });

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
      return {
        data: null,
        error: {
          message: result.data?.error || result.data?.message || result.text || `Failed to call ${functionName}`,
          status: result.response.status,
        },
      };
    }

    return { data: result.data, error: null };
  }

  useEffect(() => {
    if (bypassShellAuth) {
      setLoading(false);
      setStartupError("");
      return;
    }
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

    function redirectToLogin(reason, extra = {}) {
      logAdminEvent("Super shell redirecting to login", {
        reason,
        pathname,
        ...extra,
      });
      router.replace("/");
    }

    async function loadProfile(nextSession, reason) {
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
          return;
        }

        const { data: nextProfile, error } = await supabase
          .from("profiles")
          .select("id, role, display_name, account_status")
          .eq("id", nextSession.user.id)
          .single()
          .abortSignal(profileAbortController.signal);

        if (!mounted) return;

        if (error) {
          logAdminRequestFailure("Super shell profile lookup failed", error, {
            pathname,
            reason,
            userId: nextSession.user.id,
          });
          setSession(nextSession);
          setProfile(null);
          setStartupError(error.message || "Failed to load admin profile.");
          setLoading(false);
          return;
        }

        if (!nextProfile || nextProfile.role !== "super_admin" || nextProfile.account_status !== "active") {
          setSession(null);
          setProfile(null);
          syncAdminAuthCookie(null);
          setStartupError("Super admin access is required.");
          setLoading(false);
          redirectToLogin("super-admin-profile-required", {
            source: reason,
            userId: nextSession.user.id,
            role: nextProfile?.role ?? null,
            accountStatus: nextProfile?.account_status ?? null,
          });
          return;
        }

        setSession(nextSession);
        setProfile(nextProfile);
        setStartupError("");
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("Super shell profile lookup aborted", error, {
            pathname,
            reason,
            userId: nextSession?.user?.id ?? null,
          });
          setStartupError("Session restore was interrupted. Please open the page again.");
          setLoading(false);
          return;
        }
        logAdminRequestFailure("Super shell profile lookup threw", error, {
          pathname,
          reason,
          userId: nextSession?.user?.id ?? null,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to load admin profile.");
        setLoading(false);
      }
    }

    async function bootstrap(reason) {
      setLoading(true);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          logAdminRequestFailure("Super shell getSession failed", error, {
            pathname,
            reason,
          });
        }
        syncAdminAuthCookie(data?.session ?? null);
        if (!mounted) return;
        const nextSession = data?.session ?? null;
        setSession(nextSession);
        await loadProfile(nextSession, reason);
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          logAdminRequestFailure("Super shell bootstrap aborted", error, {
            pathname,
            reason,
          });
          setStartupError("Session restore was interrupted. Please open the page again.");
          setLoading(false);
          return;
        }
        logAdminRequestFailure("Super shell bootstrap failed", error, {
          pathname,
          reason,
        });
        setStartupError(error instanceof Error ? error.message : "Failed to bootstrap admin session.");
        setLoading(false);
      }
    }

    bootstrap("initial");

    const { data: listener } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      logAdminEvent("Super shell auth event", {
        event,
        pathname,
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
        return;
      }
      setSession(nextSession ?? null);
      await loadProfile(nextSession ?? null, `auth:${event}`);
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        bootstrap("visibilitychange");
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      mounted = false;
      if (profileAbortController) {
        profileAbortController.abort();
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      listener.subscription.unsubscribe();
    };
  }, [bypassShellAuth, pathname, router, supabase, supabaseConfigError]);

  if (bypassShellAuth) {
    return children;
  }

  if (loading) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (startupError) {
    return (
      <div className="admin-login">
        <h2>Startup Error</h2>
        <div className="admin-msg">{startupError}</div>
      </div>
    );
  }

  if (!session || !profile) {
    return null;
  }

  const pageMeta = getPageMeta(pathname);
  const displayName = profile.display_name?.trim() || session.user.email || "User";
  function handleSidebarNavigate(href) {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false);
    }
    router.push(href);
  }

  return (
    <SuperAdminContext.Provider value={{ supabase, session, profile, invokeWithAuth }}>
      <div className="admin-shell">
        <SuperSidebar
          pathname={pathname}
          email={session.user.email}
          onNavigate={handleSidebarNavigate}
          onSignOut={() => supabase.auth.signOut()}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
        />
        <div className="admin-main">
          <div className="admin-wrap">
            <div className="super-page-topbar">
              <div className="super-page-topbar-title">{pageMeta.title}</div>
              <div className="super-page-topbar-meta">
                <div className="super-page-topbar-console">Superadmin Console</div>
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
    </SuperAdminContext.Provider>
  );
}
