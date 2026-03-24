// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";
import { fetchWithTimeout } from "./requestTimeout";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CLIENT_CACHE_KEY = "__jft_student_supabase_client__";

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase env vars. Check .env and restart vite.");
}

function getOrCreateBrowserSupabaseClient() {
  const globalScope = typeof window !== "undefined" ? window : globalThis;
  const cached = globalScope[CLIENT_CACHE_KEY];

  if (cached?.client && cached.url === supabaseUrl && cached.anonKey === supabaseAnonKey) {
    return cached.client;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
  globalScope[CLIENT_CACHE_KEY] = {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    client,
  };
  return client;
}

export const supabase = getOrCreateBrowserSupabaseClient();
export const publicSupabase = supabase;
