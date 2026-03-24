import { NextResponse } from "next/server";
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout, isTimeoutLikeError } from "./src/lib/requestTimeout";
import { ADMIN_AUTH_COOKIE } from "./src/lib/schoolScope";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function fetchJson(url, token) {
  let response;
  try {
    response = await fetchWithTimeout(
      url,
      {
        headers: {
          apikey: supabaseAnonKey ?? "",
          Authorization: `Bearer ${token}`,
        },
      },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    if (isTimeoutLikeError(error)) {
      console.error("[AdminAuth] Middleware upstream request timed out", {
        url,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      });
      return null;
    }
    throw error;
  }
  if (!response.ok) return null;
  return response.json();
}

function redirectToRoot(request, reason, details = {}) {
  console.info("[AdminAuth] Middleware redirect", {
    pathname: request.nextUrl.pathname,
    reason,
    ...details,
  });
  return NextResponse.redirect(new URL("/", request.url));
}

export async function middleware(request) {
  if (!request.nextUrl.pathname.startsWith("/super")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return redirectToRoot(request, "missing-admin-auth-cookie-or-config", {
      hasToken: Boolean(token),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasSupabaseAnonKey: Boolean(supabaseAnonKey),
    });
  }

  const user = await fetchJson(`${supabaseUrl}/auth/v1/user`, token);
  if (!user?.id) {
    return redirectToRoot(request, "auth-user-lookup-failed");
  }

  const profile = await fetchJson(
    `${supabaseUrl}/rest/v1/profiles?select=role,account_status&id=eq.${encodeURIComponent(user.id)}`,
    token
  );
  const role = Array.isArray(profile) ? profile[0]?.role : null;
  const accountStatus = Array.isArray(profile) ? profile[0]?.account_status : null;
  if (role !== "super_admin" || accountStatus !== "active") {
    return redirectToRoot(request, "profile-not-active-super-admin", {
      userId: user.id,
      role,
      accountStatus,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/super/:path*"],
};
