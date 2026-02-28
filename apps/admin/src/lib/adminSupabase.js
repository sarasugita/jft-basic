import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN_SCOPE_HEADER } from "./schoolScope";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase env vars for admin app.");
}

let defaultClient;
const scopedClients = new Map();

export function createAdminSupabaseClient({ schoolScopeId } = {}) {
  if (!schoolScopeId) {
    if (!defaultClient) {
      defaultClient = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");
    }
    return defaultClient;
  }

  if (scopedClients.has(schoolScopeId)) {
    return scopedClients.get(schoolScopeId);
  }

  const headers = schoolScopeId
    ? { [SUPER_ADMIN_SCOPE_HEADER]: schoolScopeId }
    : undefined;
  const client = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
    global: headers ? { headers } : undefined,
  });
  scopedClients.set(schoolScopeId, client);
  return client;
}
