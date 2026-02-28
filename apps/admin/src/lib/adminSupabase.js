import { createClient } from "@supabase/supabase-js";
import { SUPER_ADMIN_SCOPE_HEADER } from "./schoolScope";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase env vars for admin app.");
}

export function createAdminSupabaseClient({ schoolScopeId } = {}) {
  const headers = schoolScopeId
    ? { [SUPER_ADMIN_SCOPE_HEADER]: schoolScopeId }
    : undefined;
  return createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
    global: headers ? { headers } : undefined,
  });
}
