import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

/** Request-scoped client that reads the caller's session from cookies. */
export async function getServerSupabase(): Promise<SupabaseClient | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — the middleware refreshes
          // the session cookie instead, so this is safe to swallow.
        }
      },
    },
  });
}

/**
 * Service-role client. Used only by `/api/gcal/*` to read the Google refresh
 * token, which RLS hides from every client-side role (§3.3).
 */
export function getServiceSupabase(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isSupabaseConfigured() || !key) return null;
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
