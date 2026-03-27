import { createClient } from "@supabase/supabase-js";
import { processLock } from "@supabase/auth-js";
import { logAdminRequestFailure } from "./adminDiagnostics";
import { fetchWithTimeout } from "./requestTimeout";
import { SUPER_ADMIN_SCOPE_HEADER } from "./schoolScope";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const adminSupabaseConfigError = !supabaseUrl || !supabaseAnonKey
  ? "Admin app is missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
  : "";

if (adminSupabaseConfigError) {
  console.error(adminSupabaseConfigError);
}

let defaultClient;
const scopedClients = new Map();

const isBrowser = typeof window !== "undefined";

async function instrumentedAdminFetch(input, init) {
  const url = typeof input === "string" ? input : input?.url ?? "";
  const method = init?.method || (typeof input === "string" ? "GET" : input?.method) || "GET";
  const headers = new Headers(init?.headers || (typeof input === "string" ? undefined : input?.headers));
  const schoolScopeId = headers.get(SUPER_ADMIN_SCOPE_HEADER) || null;

  try {
    const response = await fetchWithTimeout(input, init);
    if (response.ok) {
      return response;
    }

    let payload = null;
    try {
      const text = await response.clone().text();
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { message: text };
        }
      }
    } catch {
      payload = null;
    }

    logAdminRequestFailure("Supabase HTTP request failed", payload, {
      url,
      method,
      schoolScopeId,
      status: response.status,
    });
    return response;
  } catch (error) {
    logAdminRequestFailure("Supabase network request failed", error, {
      url,
      method,
      schoolScopeId,
    });
    throw error;
  }
}

function applySchoolScopeHeader(builder, schoolScopeId) {
  if (!schoolScopeId || !builder) {
    return builder;
  }
  if (typeof builder.setHeader === "function") {
    return builder.setHeader(SUPER_ADMIN_SCOPE_HEADER, schoolScopeId);
  }
  if (builder.headers) {
    const nextHeaders = new Headers(builder.headers);
    nextHeaders.set(SUPER_ADMIN_SCOPE_HEADER, schoolScopeId);
    builder.headers = nextHeaders;
  }
  return builder;
}

function mergeScopedHeaders(headers, schoolScopeId) {
  if (!schoolScopeId) return headers;
  return {
    ...(headers ?? {}),
    [SUPER_ADMIN_SCOPE_HEADER]: schoolScopeId,
  };
}

function createScopedFacade(baseClient, schoolScopeId) {
  return {
    ...baseClient,
    auth: baseClient.auth,
    realtime: baseClient.realtime,
    functions: {
      ...baseClient.functions,
      invoke(functionName, options = {}) {
        return baseClient.functions.invoke(functionName, {
          ...options,
          headers: mergeScopedHeaders(options.headers, schoolScopeId),
        });
      },
    },
    storage: {
      ...baseClient.storage,
      from(bucketId) {
        const bucket = baseClient.storage.from(bucketId);
        bucket.headers = mergeScopedHeaders(bucket.headers, schoolScopeId);
        return bucket;
      },
    },
    from(relation) {
      return applySchoolScopeHeader(baseClient.from(relation), schoolScopeId);
    },
    rpc(fn, args = {}, options = {}) {
      return applySchoolScopeHeader(baseClient.rpc(fn, args, options), schoolScopeId);
    },
  };
}

export function getAdminSupabaseConfig() {
  return {
    supabaseUrl: supabaseUrl ?? "",
    supabaseAnonKey: supabaseAnonKey ?? "",
  };
}

export function getAdminSupabaseConfigError() {
  return adminSupabaseConfigError;
}

export function createAdminSupabaseClient({ schoolScopeId } = {}) {
  if (adminSupabaseConfigError) {
    throw new Error(adminSupabaseConfigError);
  }

  if (!defaultClient) {
    defaultClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: isBrowser,
        detectSessionInUrl: isBrowser,
        persistSession: isBrowser,
        ...(isBrowser ? { lock: processLock, lockAcquireTimeout: 30000 } : {}),
      },
      global: {
        fetch: instrumentedAdminFetch,
      },
    });
  }

  if (!schoolScopeId) {
    return defaultClient;
  }

  if (!scopedClients.has(schoolScopeId)) {
    scopedClients.set(schoolScopeId, createScopedFacade(defaultClient, schoolScopeId));
  }

  return scopedClients.get(schoolScopeId);
}
