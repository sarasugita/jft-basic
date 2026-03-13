import { createClient } from "@supabase/supabase-js";
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

  if (!schoolScopeId) {
    if (!defaultClient) {
      defaultClient = createClient(supabaseUrl, supabaseAnonKey);
    }
    return defaultClient;
  }

  if (scopedClients.has(schoolScopeId)) {
    return scopedClients.get(schoolScopeId);
  }

  const headers = schoolScopeId
    ? { [SUPER_ADMIN_SCOPE_HEADER]: schoolScopeId }
    : undefined;
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: headers ? { headers } : undefined,
  });
  scopedClients.set(schoolScopeId, client);
  return client;
}
