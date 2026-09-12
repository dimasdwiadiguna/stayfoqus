"use client";

import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
} from "@/lib/supabase/env";

/**
 * Which sign-in providers the Supabase project actually has switched on.
 *
 * `signInWithOAuth` builds the authorize URL on the client and then navigates
 * to it — there is no request for it to fail on, so a provider that is not
 * enabled in the dashboard cannot be detected before the redirect. What the
 * user gets instead is GoTrue's raw JSON in the address bar:
 *
 *   {"code":400,"error_code":"validation_failed",
 *    "msg":"Unsupported provider: provider is not enabled"}
 *
 * GoTrue publishes its own configuration at `/auth/v1/settings`, so the app can
 * simply ask first and say what is wrong in Indonesian instead.
 */

export type AuthProbe =
  | { status: "not-configured" }
  | { status: "unreachable"; detail: string }
  | { status: "ok"; googleEnabled: boolean };

/** The one field this app needs out of GoTrue's settings document. */
export function googleEnabledFrom(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const external = (payload as { external?: unknown }).external;
  if (typeof external !== "object" || external === null) return false;
  return (external as Record<string, unknown>).google === true;
}

export async function probeAuthProviders(): Promise<AuthProbe> {
  if (!isSupabaseConfigured()) return { status: "not-configured" };

  try {
    const res = await fetch(
      `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/settings`,
      // The anon key is required even though the document is public.
      { headers: { apikey: SUPABASE_ANON_KEY } },
    );
    if (!res.ok) return { status: "unreachable", detail: `HTTP ${res.status}` };
    return { status: "ok", googleEnabled: googleEnabledFrom(await res.json()) };
  } catch (err) {
    return {
      status: "unreachable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
