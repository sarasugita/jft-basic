import { ADMIN_AUTH_COOKIE } from "./schoolScope";

export function syncAdminAuthCookie(session) {
  if (typeof document === "undefined") return;
  const token = session?.access_token ?? "";
  if (!token) {
    document.cookie = `${ADMIN_AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }
  document.cookie = `${ADMIN_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=3600; SameSite=Lax`;
}
