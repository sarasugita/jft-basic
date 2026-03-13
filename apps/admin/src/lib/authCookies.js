import { ADMIN_AUTH_COOKIE } from "./schoolScope";

export function syncAdminAuthCookie(session) {
  if (typeof document === "undefined") return;
  const token = session?.access_token ?? "";
  if (!token) {
    document.cookie = `${ADMIN_AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  const expiresAtMs = Number(session?.expires_at ?? 0) * 1000;
  const maxAgeSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : 3600;
  document.cookie = `${ADMIN_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}
