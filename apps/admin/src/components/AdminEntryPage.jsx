"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createAdminSupabaseClient, getAdminSupabaseConfigError } from "../lib/adminSupabase";
import { syncAdminAuthCookie } from "../lib/authCookies";
import {
  createAdminTrace,
  getAdminDiagnosticsReport,
  isAbortLikeError,
  logAdminEvent,
  logAdminRequestFailure,
} from "../lib/adminDiagnostics";
import {
  ADMIN_CONSOLE_IMPORT_TIMEOUT_MS,
  getLoadedAdminConsole,
  loadAdminConsole,
  preloadAdminConsole,
  preloadAdminConsoleCore,
} from "./adminConsoleLoader";
import AdminConsoleBoundary from "./AdminConsoleBoundary";
import LoadableAdminModule from "./LoadableAdminModule";

function PasswordVisibilityIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4.3 4.3 3 21 19.7 19.7 21l-2.4-2.4c-1.6.8-3.4 1.4-5.3 1.4-5.5 0-9.6-4.1-10.7-6.6-.2-.4-.2-.8 0-1.1.7-1.7 2.3-3.6 4.6-4.9L3 4.3zm5 5 1.7 1.7a3.9 3.9 0 0 0 4.6 4.6l1.7 1.7c-1 .5-2.1.7-3.4.7a3.9 3.9 0 0 1-3.9-3.9c0-1.3.3-2.4.8-3.4zM12 7.2c1.2 0 2.3.3 3.2.8l-1.7 1.7a3.9 3.9 0 0 0-4.6 4.6L6.2 10c1.5-1.7 3.7-2.8 5.8-2.8zm9.2 4.8c-.5 1.1-1.4 2.4-2.8 3.5l-1.4-1.4c1-.8 1.7-1.7 2.1-2.1-.8-1.6-3.1-4.1-6.1-4.6l-1.8-1.8c4.2.4 7.5 3.2 8.5 4.7.2.4.2.8 0 1.1z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5c5.5 0 9.6 4.1 10.7 6.6.2.4.2.8 0 1.1C21.6 15.9 17.5 20 12 20S2.4 15.9 1.3 12.7c-.2-.4-.2-.8 0-1.1C2.4 9.1 6.5 5 12 5zm0 2.2c-4.1 0-7.4 2.9-8.4 4.9 1 2 4.3 4.9 8.4 4.9s7.4-2.9 8.4-4.9c-1-2-4.3-4.9-8.4-4.9zm0 1.8a3.9 3.9 0 1 1 0 7.8 3.9 3.9 0 0 1 0-7.8z" />
    </svg>
  );
}

function normalizeAdminLoginErrorMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return "Login failed.";
  if (
    /cannot coerce the result to a single json object/i.test(text)
    || /json object requested.*multiple \(or no\) rows/i.test(text)
  ) {
    return "This account is missing an admin profile. Please contact the system administrator.";
  }
  return text;
}

function isAllowedAdminProfile(profile) {
  return Boolean(
    profile
      && profile.account_status === "active"
      && ["admin", "super_admin"].includes(profile.role)
  );
}

const PROFILE_LOOKUP_RETRY_DELAYS_MS = [400, 1200];

function waitForRetry(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export default function AdminEntryPage() {
  const router = useRouter();
  const supabaseConfigError = getAdminSupabaseConfigError();
  const supabase = useMemo(() => (supabaseConfigError ? null : createAdminSupabaseClient()), [supabaseConfigError]);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginMsg, setLoginMsg] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showPasswordChangePassword, setShowPasswordChangePassword] = useState(false);
  const [showPasswordChangeConfirmPassword, setShowPasswordChangeConfirmPassword] = useState(false);
  const [passwordChangeForm, setPasswordChangeForm] = useState({
    password: "",
    confirmPassword: "",
  });
  const [passwordChangeMsg, setPasswordChangeMsg] = useState("");
  const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
  const loginValidationInFlightRef = useRef(false);
  const [adminConsoleRetryNonce, setAdminConsoleRetryNonce] = useState(0);
  const [adminConsoleReady, setAdminConsoleReady] = useState(false);
  const [adminConsoleError, setAdminConsoleError] = useState("");

  useEffect(() => {
    if (supabaseConfigError) {
      setAuthReady(true);
      setLoginMsg(supabaseConfigError);
      return;
    }
    if (!supabase) return;
    let mounted = true;
    let loadAbortController = null;
    let authEventTimeout = null;

    async function loadProfileForSession(nextSession, reason) {
      if (!nextSession?.user?.id) {
        setProfile(null);
        setProfileLoading(false);
        return null;
      }

      if (loadAbortController) {
        loadAbortController.abort();
      }
      loadAbortController = new AbortController();
      setProfileLoading(true);
      const finishProfileTrace = createAdminTrace("Admin entry profile lookup", {
        reason,
        userId: nextSession.user.id,
      });

      try {
        let nextProfile = null;
        let profileError = null;
        let resolved = false;

        for (let attempt = 0; attempt <= PROFILE_LOOKUP_RETRY_DELAYS_MS.length; attempt += 1) {
          const result = await supabase
            .from("profiles")
            .select("id, role, display_name, school_id, account_status, force_password_change")
            .eq("id", nextSession.user.id)
            .maybeSingle()
            .abortSignal(loadAbortController.signal);

          nextProfile = result.data ?? null;
          profileError = result.error ?? null;

          if (!profileError) {
            resolved = true;
            break;
          }

          if (attempt < PROFILE_LOOKUP_RETRY_DELAYS_MS.length) {
            logAdminRequestFailure("Admin entry profile lookup retrying", profileError, {
              reason,
              userId: nextSession.user.id,
              attempt: attempt + 1,
            });
            await waitForRetry(PROFILE_LOOKUP_RETRY_DELAYS_MS[attempt]);
            if (!mounted) return null;
          }
        }

        if (!mounted) return null;
        if (!resolved && profileError) {
          finishProfileTrace("failed", {
            code: profileError.code ?? "",
            message: profileError.message ?? "",
          });
          logAdminRequestFailure("Admin entry profile lookup failed", profileError, {
            reason,
            userId: nextSession.user.id,
          });
          setProfile(null);
          setLoginMsg(normalizeAdminLoginErrorMessage(profileError.message));
          return null;
        }

        if (!isAllowedAdminProfile(nextProfile)) {
          finishProfileTrace("rejected", {
            role: nextProfile?.role ?? null,
            accountStatus: nextProfile?.account_status ?? null,
          });
          logAdminEvent("Admin entry rejected profile", {
            reason,
            userId: nextSession.user.id,
            role: nextProfile?.role ?? null,
            accountStatus: nextProfile?.account_status ?? null,
          });
          await supabase.auth.signOut({ scope: "local" });
          syncAdminAuthCookie(null);
          if (!mounted) return null;
          setSession(null);
          setProfile(null);
          setLoginMsg("Invalid login credentials");
          return null;
        }

        setProfile(nextProfile);
        setLoginMsg("");
        finishProfileTrace("success", {
          role: nextProfile?.role ?? null,
          forcePasswordChange: Boolean(nextProfile?.force_password_change),
        });
        return nextProfile;
      } catch (error) {
        if (!mounted) return null;
        if (isAbortLikeError(error)) {
          finishProfileTrace("aborted");
          logAdminRequestFailure("Admin entry profile lookup aborted", error, {
            reason,
            userId: nextSession.user.id,
          });
          return null;
        }
        finishProfileTrace("failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        logAdminRequestFailure("Admin entry profile lookup threw", error, {
          reason,
          userId: nextSession.user.id,
        });
        setProfile(null);
        setLoginMsg(error instanceof Error ? error.message : "Failed to load admin profile.");
        return null;
      } finally {
        if (mounted) {
          setProfileLoading(false);
        }
      }
    }

    async function bootstrap(reason) {
      setAuthReady(false);
      const finishBootstrapTrace = createAdminTrace("Admin entry bootstrap", { reason });
      const finishSessionTrace = createAdminTrace("Admin entry getSession", { reason });
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          finishSessionTrace("failed", {
            code: error.code ?? "",
            message: error.message ?? "",
          });
          logAdminRequestFailure("Admin entry getSession failed", error, { reason });
        } else {
          finishSessionTrace("success", {
            hasSession: Boolean(data?.session),
            userId: data?.session?.user?.id ?? null,
          });
        }

        const nextSession = data?.session ?? null;
        syncAdminAuthCookie(nextSession);
        if (!mounted) return;

        setSession(nextSession);
        if (!nextSession) {
          setProfile(null);
          setProfileLoading(false);
          setLoginMsg("");
          finishBootstrapTrace("success", {
            hasSession: false,
            userId: null,
          });
          return;
        }

        await loadProfileForSession(nextSession, reason);
        finishBootstrapTrace("success", {
          hasSession: true,
          userId: nextSession.user.id,
        });
      } catch (error) {
        if (!mounted) return;
        if (isAbortLikeError(error)) {
          finishSessionTrace("aborted");
          finishBootstrapTrace("aborted");
          logAdminRequestFailure("Admin entry bootstrap aborted", error, { reason });
          return;
        }
        finishSessionTrace("failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        finishBootstrapTrace("failed", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        logAdminRequestFailure("Admin entry bootstrap failed", error, { reason });
        setLoginMsg(error instanceof Error ? error.message : "Failed to restore admin session.");
      } finally {
        if (mounted) {
          setAuthReady(true);
        }
      }
    }

    void bootstrap("initial");

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      logAdminEvent("Admin entry auth event", {
        event,
        hasSession: Boolean(nextSession),
        userId: nextSession?.user?.id ?? null,
      });
      syncAdminAuthCookie(nextSession ?? null);
      if (!mounted || event === "INITIAL_SESSION") {
        return;
      }
      if (!nextSession) {
        setSession(null);
        setProfile(null);
        setProfileLoading(false);
        setAuthReady(true);
        loginValidationInFlightRef.current = false;
        return;
      }
      if (loginValidationInFlightRef.current && event === "SIGNED_IN") {
        return;
      }
      setSession(nextSession);
      if (authEventTimeout) clearTimeout(authEventTimeout);
      authEventTimeout = setTimeout(() => {
        void loadProfileForSession(nextSession, `auth:${event}`).finally(() => {
          if (mounted) setAuthReady(true);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      if (loadAbortController) {
        loadAbortController.abort();
      }
      if (authEventTimeout) {
        clearTimeout(authEventTimeout);
      }
      listener.subscription.unsubscribe();
    };
  }, [supabase, supabaseConfigError]);

  useEffect(() => {
    if (authReady && session && !profile && !profileLoading) {
      logAdminEvent("Admin entry unresolved profile state", {
        userId: session.user?.id ?? null,
        hasSession: true,
        loginMsg: loginMsg || "",
      });
    }
  }, [authReady, loginMsg, profile, profileLoading, session]);

  useEffect(() => {
    if (!session || !profile) return;
    if (
      profile.role === "super_admin"
      && profile.account_status === "active"
      && !profile.force_password_change
    ) {
      router.replace("/super/schools");
    }
  }, [profile, router, session]);

  useEffect(() => {
    let cancelled = false;

    if (!session || !profile) {
      setAdminConsoleReady(false);
      setAdminConsoleError("");
      return () => {
        cancelled = true;
      };
    }

    const shouldPreload = (
      profile.role === "admin"
      && profile.account_status === "active"
      && !profile.force_password_change
    );

    if (!shouldPreload) {
      setAdminConsoleReady(false);
      setAdminConsoleError("");
      return () => {
        cancelled = true;
      };
    }

    setAdminConsoleReady(false);
    setAdminConsoleError("");

    const preloadContext = {
      pathname: "/",
      role: profile.role,
      userId: session.user.id,
      schoolId: profile.school_id ?? null,
      activeSchoolId: profile.school_id ?? null,
      attempt: adminConsoleRetryNonce,
      managedAuth: true,
    };

    void Promise.all([
      preloadAdminConsole(
        {
          ...preloadContext,
          source: "admin-entry-preload-wrapper",
        },
        { timeoutMs: ADMIN_CONSOLE_IMPORT_TIMEOUT_MS }
      ),
      preloadAdminConsoleCore(
        {
          ...preloadContext,
          source: "admin-entry-preload-core",
        },
        { timeoutMs: ADMIN_CONSOLE_IMPORT_TIMEOUT_MS }
      ),
    ])
      .then(() => {
        if (cancelled) return;
        setAdminConsoleReady(true);
        setAdminConsoleError("");
      })
      .catch((error) => {
        if (cancelled) return;
        logAdminRequestFailure("Admin entry admin console preload failed", error, {
          pathname: "/",
          role: profile.role,
          userId: session.user.id,
          schoolId: profile.school_id ?? null,
          attempt: adminConsoleRetryNonce,
        });
        if (String(error?.code ?? "") === "admin-console-import-timeout") {
          setAdminConsoleError("Admin console is taking too long to load. Retry or sign out and try again.");
          return;
        }
        setAdminConsoleError("Failed to load the admin console. Retry or sign out and try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [
    adminConsoleRetryNonce,
    profile,
    session,
  ]);

  async function handleStartupRecovery() {
    if (!supabase) {
      setSession(null);
      setProfile(null);
      setProfileLoading(false);
      setAuthReady(true);
      router.replace("/");
      return;
    }

    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (error) {
      logAdminRequestFailure("Admin entry startup recovery sign-out failed", error);
    } finally {
      syncAdminAuthCookie(null);
      loginValidationInFlightRef.current = false;
      setSession(null);
      setProfile(null);
      setProfileLoading(false);
      setAuthReady(true);
      setLoginMsg("");
      router.replace("/");
    }
  }

  async function handleLogin() {
    if (!supabase) {
      setLoginMsg(supabaseConfigError || "Admin client is unavailable.");
      return;
    }
    setLoginMsg("");
    const { email, password } = loginForm;
    if (!email || !password) {
      setLoginMsg("Email / Password を入力してください。");
      return;
    }

    loginValidationInFlightRef.current = true;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      loginValidationInFlightRef.current = false;
      setLoginMsg(normalizeAdminLoginErrorMessage(error.message));
      return;
    }

    try {
      const finishLoginTrace = createAdminTrace("Admin entry login profile validation", {
        email,
      });
      const nextSession = data?.session ?? null;
      const userId = nextSession?.user?.id ?? data?.user?.id ?? "";
      if (!nextSession || !userId) {
        finishLoginTrace("failed", {
          reason: "missing-session",
        });
        await supabase.auth.signOut({ scope: "local" });
        syncAdminAuthCookie(null);
        setSession(null);
        setProfile(null);
        setLoginMsg("Invalid login credentials");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("id, role, display_name, school_id, account_status, force_password_change")
        .eq("id", userId)
        .maybeSingle();

      if (profileError || !isAllowedAdminProfile(profileData)) {
        finishLoginTrace("failed", {
          reason: profileError ? "profile-error" : "profile-rejected",
          message: profileError?.message ?? "",
          role: profileData?.role ?? null,
          accountStatus: profileData?.account_status ?? null,
        });
        await supabase.auth.signOut({ scope: "local" });
        syncAdminAuthCookie(null);
        setSession(null);
        setProfile(null);
        setLoginMsg("Invalid login credentials");
        return;
      }

      syncAdminAuthCookie(nextSession);
      setProfile(profileData);
      setSession(nextSession);
      setAuthReady(true);
      setLoginMsg("");
      finishLoginTrace("success", {
        role: profileData?.role ?? null,
        forcePasswordChange: Boolean(profileData?.force_password_change),
      });
    } catch (caughtError) {
      const nextSession = data?.session ?? null;
      if (isAbortLikeError(caughtError)) {
        logAdminRequestFailure("Admin entry login profile validation aborted", caughtError, {
          email,
          userId: nextSession?.user?.id ?? data?.user?.id ?? null,
        });
        if (nextSession) {
          syncAdminAuthCookie(nextSession);
          setSession(nextSession);
          setProfile(null);
          setProfileLoading(false);
          setAuthReady(true);
          setLoginMsg("Admin profile validation was interrupted. Please wait a moment or use Sign out and retry.");
        } else {
          setLoginMsg("Login was interrupted. Please try again.");
        }
        return;
      }

      logAdminRequestFailure("Admin entry login profile validation failed", caughtError, {
        email,
        userId: nextSession?.user?.id ?? data?.user?.id ?? null,
      });
      await supabase.auth.signOut({ scope: "local" });
      syncAdminAuthCookie(null);
      setSession(null);
      setProfile(null);
      setLoginMsg(caughtError instanceof Error ? caughtError.message : "Login failed.");
    } finally {
      loginValidationInFlightRef.current = false;
    }
  }

  async function handlePasswordChange() {
    if (!supabase || !session) return;
    setPasswordChangeMsg("");
    const nextPassword = passwordChangeForm.password;
    const confirmPassword = passwordChangeForm.confirmPassword;
    if (!nextPassword || !confirmPassword) {
      setPasswordChangeMsg("Enter and confirm the new password.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordChangeMsg("Passwords do not match.");
      return;
    }
    if (nextPassword.length < 8) {
      setPasswordChangeMsg("Password must be at least 8 characters.");
      return;
    }

    setPasswordChangeLoading(true);
    const { error: authError } = await supabase.auth.updateUser({
      password: nextPassword,
      data: { force_password_change: false },
    });
    if (authError) {
      setPasswordChangeMsg(authError.message);
      setPasswordChangeLoading(false);
      return;
    }

    const { error: profileError } = await supabase
      .from("profiles")
      .update({ force_password_change: false })
      .eq("id", session.user.id);
    if (profileError) {
      setPasswordChangeMsg(profileError.message);
      setPasswordChangeLoading(false);
      return;
    }

    setProfile((prev) => (prev ? { ...prev, force_password_change: false } : prev));
    setPasswordChangeForm({ password: "", confirmPassword: "" });
    setPasswordChangeMsg("");
    setPasswordChangeLoading(false);
  }

  if (!authReady) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="admin-login-screen">
        <div className="admin-login admin-login-card">
          <div className="admin-login-header">
            <img className="admin-login-logo" src="/branding/jft-navi-color.png" alt="JFT Navi" />
            <h1 className="admin-login-title">Admin Panel Login</h1>
          </div>
          <div className="admin-login-divider" />
          <form
            className="admin-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleLogin();
            }}
          >
            <label className="admin-login-label" htmlFor="adminLoginEmail">Username</label>
            <input
              id="adminLoginEmail"
              className="admin-login-input"
              type="email"
              autoComplete="username"
              placeholder="example@gmail.com"
              value={loginForm.email}
              onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
            />
            <label className="admin-login-label" htmlFor="adminLoginPassword">Password</label>
            <div className="admin-login-password">
              <input
                id="adminLoginPassword"
                className="admin-login-input admin-login-input-password"
                type={showLoginPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="password"
                value={loginForm.password}
                onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showLoginPassword ? "Hide password" : "Show password"}
                onClick={() => setShowLoginPassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showLoginPassword} />
              </button>
            </div>
            <button className="admin-login-submit" type="submit">LOGIN</button>
          </form>
          <div className={`admin-login-msg ${loginMsg ? "visible" : ""}`}>{loginMsg || "\u00a0"}</div>
        </div>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="admin-login">
        <h2>Loading...</h2>
      </div>
    );
  }

  if (!profile) {
    const unresolvedProfile = Boolean(session) && !loginMsg;
    return (
      <div className="admin-login">
        <h2>{loginMsg || unresolvedProfile ? "Startup Error" : "Loading..."}</h2>
        {(loginMsg || unresolvedProfile) ? (
          <div className="admin-msg">
            {loginMsg || "The admin session was restored, but the admin profile could not be loaded. Sign out and try again."}
          </div>
        ) : null}
        {(loginMsg || unresolvedProfile) ? (
          <button
            className="admin-password-change-secondary"
            type="button"
            onClick={() => {
              void handleStartupRecovery();
            }}
          >
            SIGN OUT AND RETRY
          </button>
        ) : null}
      </div>
    );
  }

  if (profile.account_status === "active" && profile.force_password_change) {
    return (
      <div className="admin-login-screen">
        <div className="admin-login admin-login-card admin-password-card">
          <div className="admin-password-change-head">
            <h2 className="admin-password-change-title">Set New Password</h2>
            <p className="admin-password-change-copy">
              This account must set a new password before continuing.
            </p>
            <p className="admin-password-change-note">Use at least 8 characters for your new password.</p>
          </div>
          <form
            className="admin-login-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handlePasswordChange();
            }}
          >
            <label className="admin-login-label" htmlFor="adminPasswordChangeNew">New Password</label>
            <div className="admin-login-password">
              <input
                id="adminPasswordChangeNew"
                className="admin-login-input admin-login-input-password"
                type={showPasswordChangePassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="new password"
                value={passwordChangeForm.password}
                onChange={(event) => setPasswordChangeForm((current) => ({ ...current, password: event.target.value }))}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showPasswordChangePassword ? "Hide password" : "Show password"}
                onClick={() => setShowPasswordChangePassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showPasswordChangePassword} />
              </button>
            </div>

            <label className="admin-login-label" htmlFor="adminPasswordChangeConfirm">Confirm Password</label>
            <div className="admin-login-password">
              <input
                id="adminPasswordChangeConfirm"
                className="admin-login-input admin-login-input-password"
                type={showPasswordChangeConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="confirm password"
                value={passwordChangeForm.confirmPassword}
                onChange={(event) => setPasswordChangeForm((current) => ({ ...current, confirmPassword: event.target.value }))}
              />
              <button
                className="admin-login-toggle"
                type="button"
                aria-label={showPasswordChangeConfirmPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPasswordChangeConfirmPassword((current) => !current)}
              >
                <PasswordVisibilityIcon visible={showPasswordChangeConfirmPassword} />
              </button>
            </div>

            <button className="admin-login-submit" type="submit" disabled={passwordChangeLoading}>
              {passwordChangeLoading ? "SAVING..." : "UPDATE PASSWORD"}
            </button>
            <button
              className="admin-password-change-secondary"
              type="button"
              onClick={() => supabase.auth.signOut()}
            >
              SIGN OUT
            </button>
          </form>
          <div className={`admin-login-msg ${passwordChangeMsg ? "visible" : ""}`}>
            {passwordChangeMsg || "\u00a0"}
          </div>
        </div>
      </div>
    );
  }

  if (
    profile.role === "super_admin"
    && profile.account_status === "active"
  ) {
    return (
      <div className="admin-login">
        <h2>Redirecting...</h2>
      </div>
    );
  }

  if (
    profile.role === "admin"
    && profile.account_status === "active"
    && !profile.force_password_change
  ) {
    if (adminConsoleError) {
      return (
        <div className="admin-login">
          <h2>Startup Error</h2>
          <div className="admin-msg">{adminConsoleError}</div>
          <button
            className="admin-password-change-secondary"
            type="button"
            onClick={() => {
              setAdminConsoleError("");
              setAdminConsoleRetryNonce((value) => value + 1);
            }}
          >
            RETRY
          </button>
          <button
            className="admin-password-change-secondary"
            type="button"
            onClick={async () => {
              const report = getAdminDiagnosticsReport({
                source: "admin-entry-startup-error",
                schoolId: profile?.school_id ?? null,
                role: profile?.role ?? null,
              });
              try {
                await navigator.clipboard.writeText(report);
              } catch (error) {
                logAdminRequestFailure("Admin entry diagnostics copy failed", error, {
                  role: profile?.role ?? null,
                  schoolId: profile?.school_id ?? null,
                });
              }
            }}
          >
            COPY DIAGNOSTICS
          </button>
          <button
            className="admin-password-change-secondary"
            type="button"
            onClick={() => {
              void handleStartupRecovery();
            }}
          >
            SIGN OUT AND RETRY
          </button>
        </div>
      );
    }

    if (!adminConsoleReady) {
      return (
        <div className="admin-login">
          <h2>Loading...</h2>
        </div>
      );
    }
  }

  return (
    <AdminConsoleBoundary
      context="admin-entry"
      onRetry={() => setAdminConsoleRetryNonce((value) => value + 1)}
      onBack={() => {
        void handleStartupRecovery();
      }}
      backLabel="SIGN OUT AND RETRY"
    >
      <LoadableAdminModule
        key={adminConsoleRetryNonce}
        importTarget="AdminConsole"
        loadModule={loadAdminConsole}
        getLoadedModule={getLoadedAdminConsole}
        context={{
          pathname: "/",
          role: profile?.role ?? null,
          userId: session?.user?.id ?? null,
          schoolId: profile?.school_id ?? null,
          activeSchoolId: profile?.school_id ?? null,
          attempt: adminConsoleRetryNonce,
          managedAuth: true,
          source: "admin-entry-mount",
        }}
        retryKey={adminConsoleRetryNonce}
        timeoutMs={ADMIN_CONSOLE_IMPORT_TIMEOUT_MS}
        errorMessage="Failed to mount the admin console. Retry or sign out and try again."
        backLabel="SIGN OUT AND RETRY"
        onBack={() => {
          void handleStartupRecovery();
        }}
        diagnosticsExtra={{
          schoolId: profile?.school_id ?? null,
          role: profile?.role ?? null,
          source: "admin-entry-mount",
        }}
        moduleProps={{
          homeHref: "/",
          managedSession: session,
          managedProfile: profile,
        }}
      />
    </AdminConsoleBoundary>
  );
}
