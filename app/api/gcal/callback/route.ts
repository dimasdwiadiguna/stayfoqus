import { NextResponse } from "next/server";

import {
  currentUserId,
  exchangeCode,
  saveNewCredentials,
} from "@/lib/gcal/server";
import { describeGoogleError } from "@/lib/gcal/scopes";

export const dynamic = "force-dynamic";

/**
 * OAuth redirect target. Exchanges the code for tokens and stores them
 * server-side; the refresh token never crosses into the browser (§3.3).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const returnTo = decodeURIComponent(url.searchParams.get("state") ?? "/settings");
  const target = new URL(returnTo, site);

  /*
   * Failures leave with their reason attached. Until now they left with a code
   * — `error:exchange_failed` — that nothing in the app read, so a connect that
   * failed looked exactly like one that had never been attempted: back on
   * Pengaturan, still disconnected, no explanation anywhere.
   */
  const fail = (reason: string) => {
    target.searchParams.set("gcal_error", reason.slice(0, 400));
    return NextResponse.redirect(target);
  };

  const error = url.searchParams.get("error");
  if (error) return fail(error);

  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");

  const userId = await currentUserId();
  if (!userId) return fail("not_signed_in");

  try {
    const tokens = await exchangeCode(code);
    await saveNewCredentials(userId, tokens);
    target.searchParams.set("gcal", "connected");
  } catch (err) {
    console.error("[foqus] gcal callback failed", err);
    return fail(describeGoogleError(err));
  }

  return NextResponse.redirect(target);
}
