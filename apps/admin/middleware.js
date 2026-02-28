import { NextResponse } from "next/server";
import { ADMIN_AUTH_COOKIE } from "./src/lib/schoolScope";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      apikey: supabaseAnonKey ?? "",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function middleware(request) {
  if (!request.nextUrl.pathname.startsWith("/super")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_AUTH_COOKIE)?.value;
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const user = await fetchJson(`${supabaseUrl}/auth/v1/user`, token);
  if (!user?.id) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const profile = await fetchJson(
    `${supabaseUrl}/rest/v1/profiles?select=role,account_status&id=eq.${encodeURIComponent(user.id)}`,
    token
  );
  const role = Array.isArray(profile) ? profile[0]?.role : null;
  const accountStatus = Array.isArray(profile) ? profile[0]?.account_status : null;
  if (role !== "super_admin" || accountStatus !== "active") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/super/:path*"],
};
