import { NextResponse } from "next/server";

import {
  GOOGLE_SCOPES,
  currentUserId,
  googleClientConfig,
} from "@/lib/gcal/server";

export const dynamic = "force-dynamic";

/**
 * §6.1 — incremental authorization, requested *after* login rather than during
 * it. Redirects to Google's consent screen for the calendar scopes only;
 * `include_granted_scopes` keeps whatever Supabase Auth already obtained.
 */
export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const config = googleClientConfig();
  if (!config) {
    return NextResponse.json({ error: "google_not_configured" }, { status: 501 });
  }

  const returnTo = new URL(request.url).searchParams.get("return_to") ?? "/settings";

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // `offline` + `consent` is what makes Google return a refresh token.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: encodeURIComponent(returnTo),
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  );
}
