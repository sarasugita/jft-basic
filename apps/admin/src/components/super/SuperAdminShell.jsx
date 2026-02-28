"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createAdminSupabaseClient } from "../../lib/adminSupabase";
import { syncAdminAuthCookie } from "../../lib/authCookies";

const SuperAdminContext = createContext(null);

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
          <svg viewBox="0 0 24 24" className="admin-brand-icon" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor"></circle>
            <path d="M6.3 11.1 16.8 7.4 14 17.9 11.7 12.3 6.3 11.1Z" fill="currentColor"></path>
          </svg>
          <span>JFT Navi</span>
        </div>
        <div className="admin-brand-sub">Super Admin Console</div>
      </div>
    </div>
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

function SuperSidebar({ pathname, email, onNavigate, onSignOut }) {
  const [openGroups, setOpenGroups] = useState(() => buildOpenGroups(pathname));

  useEffect(() => {
    setOpenGroups(buildOpenGroups(pathname));
  }, [pathname]);

  return (
    <aside className="admin-sidebar">
      <Brand />
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
              onClick={() => setOpenGroups(buildOpenGroups(item.href))}
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
  const supabase = useMemo(() => createAdminSupabaseClient(), []);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  async function getAccessToken() {
    const { data: sessionData } = await supabase.auth.getSession();
    let accessToken = sessionData?.session?.access_token ?? null;
    const expiresAt = sessionData?.session?.expires_at ?? 0;

    if (!accessToken || expiresAt * 1000 < Date.now() + 60_000) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        throw new Error(refreshError.message || "Failed to refresh session");
      }
      accessToken = refreshed?.session?.access_token ?? null;
    }

    if (!accessToken) {
      throw new Error("Please log in again.");
    }

    return accessToken;
  }

  async function invokeWithAuth(functionName, body) {
    const accessToken = await getAccessToken();

    console.log("[EdgeInvoke]", functionName, "token?", !!accessToken);

    if (body instanceof FormData) {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${functionName}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        },
        body,
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!response.ok) {
        return {
          data: null,
          error: {
            message: data?.error || data?.message || text || `Failed to call ${functionName}`,
          },
        };
      }

      return { data, error: null };
    }

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: body ?? {},
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return { data, error };
  }

  useEffect(() => {
    let mounted = true;

    async function loadProfile(nextSession) {
      try {
        if (!nextSession) {
          if (mounted) {
            setSession(null);
            setProfile(null);
            setLoading(false);
          }
          router.replace("/");
          return;
        }

        const { data: nextProfile, error } = await supabase
          .from("profiles")
          .select("id, role, display_name, account_status")
          .eq("id", nextSession.user.id)
          .single();

        if (!mounted) return;

        if (error || !nextProfile || nextProfile.role !== "super_admin" || nextProfile.account_status !== "active") {
          setSession(null);
          setProfile(null);
          syncAdminAuthCookie(null);
          setLoading(false);
          router.replace("/");
          return;
        }

        setProfile(nextProfile);
        setLoading(false);
      } catch (error) {
        if (!mounted) return;
        console.error("super shell loadProfile error:", error);
        setLoading(false);
      }
    }

    async function bootstrap() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error("super shell getSession error:", error);
        syncAdminAuthCookie(data?.session ?? null);
        if (!mounted) return;
        const nextSession = data?.session ?? null;
        setSession(nextSession);
        await loadProfile(nextSession);
      } catch (error) {
        if (!mounted) return;
        console.error("super shell bootstrap error:", error);
        setLoading(false);
      }
    }

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      syncAdminAuthCookie(nextSession ?? null);
      if (!mounted) return;
      setSession(nextSession ?? null);
      await loadProfile(nextSession ?? null);
    });

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        bootstrap();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      mounted = false;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      listener.subscription.unsubscribe();
    };
  }, [router, supabase]);

  if (isScopedAdminConsolePath(pathname)) {
    return children;
  }

  if (loading) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!session || !profile) {
    return null;
  }

  const pageMeta = getPageMeta(pathname);

  return (
    <SuperAdminContext.Provider value={{ supabase, session, profile, invokeWithAuth }}>
      <div className="admin-shell">
        <SuperSidebar
          pathname={pathname}
          email={session.user.email}
          onNavigate={router.push}
          onSignOut={() => supabase.auth.signOut()}
        />
        <div className="admin-main">
          <div className="admin-wrap">
            <div className="admin-panel super-layout-top">
              <div>
                <div className="admin-chip">Super Admin</div>
                <div className="super-layout-title">{pageMeta.title}</div>
                <div className="admin-help">{pageMeta.description}</div>
              </div>
              <div className="admin-meta">
                <div className="admin-chip">Role: {profile.role}</div>
                {profile.display_name ? <div className="admin-chip">{profile.display_name}</div> : null}
              </div>
            </div>
            {children}
          </div>
        </div>
      </div>
    </SuperAdminContext.Provider>
  );
}
