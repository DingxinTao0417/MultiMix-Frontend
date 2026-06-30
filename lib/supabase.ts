import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
const authMode = process.env.NEXT_PUBLIC_MULTIMIX_AUTH_MODE || "";
const useSupabaseAuth = authMode !== "local";

export const supabase = useSupabaseAuth && supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        flowType: "pkce",
      },
    })
  : null;

export const isSupabaseConfigured = Boolean(supabase);
