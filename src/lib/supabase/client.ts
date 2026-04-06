import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MISSING_SUPABASE_ENV_MESSAGE = "Missing Supabase env vars. Check .env.local and Vercel env vars.";

function createMissingEnvProxy() {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(MISSING_SUPABASE_ENV_MESSAGE);
      },
    }
  ) as SupabaseClient;
}

function createBrowserSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return createMissingEnvProxy();
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

export const supabase = createBrowserSupabaseClient();
