import { NextResponse } from "next/server";

import { currentUserId, exchangeCode, storeCredentials } from "@/lib/gcal/server";

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

  const error = url.searchParams.get("error");
  if (error) {
    target.searchParams.set("gcal", `error:${error}`);
    return NextResponse.redirect(target);
  }

  const code = url.searchParams.get("code");
  if (!code) {
    target.searchParams.set("gcal", "error:missing_code");
    return NextResponse.redirect(target);
  }

  const userId = await currentUserId();
  if (!userId) {
    target.searchParams.set("gcal", "error:not_signed_in");
    return NextResponse.redirect(target);
  }

  try {
    const tokens = await exchangeCode(code);
    await storeCredentials(userId, tokens);
    target.searchParams.set("gcal", "connected");
  } catch (err) {
    console.error("[foqus] gcal callback failed", err);
    target.searchParams.set("gcal", "error:exchange_failed");
  }

  return NextResponse.redirect(target);
}
