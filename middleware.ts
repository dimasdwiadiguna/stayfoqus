import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { gatePassword, isOpenPath } from "@/lib/gate/config";
import { GATE_COOKIE, verifyToken } from "@/lib/gate/token";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Two jobs, in this order.
 *
 * 1. **The access gate.** FOQUS is a single-user app deployed to a public URL.
 *    Without this, anyone who knows the URL reads the whole calendar. The gate
 *    is a server-side boundary rather than a screen in front of the app: a
 *    locked visitor never receives a page *or* an API response, so there is
 *    nothing to click past.
 *
 * 2. **The Supabase session refresh.** `@supabase/ssr` keeps the session in
 *    cookies, and only a request that touches `getUser()` renews an expiring
 *    access token. Without it the Google Calendar route handlers — which read
 *    the caller's session server-side — start failing with 401 an hour after
 *    the tab was opened, even though the browser still believes it is signed in.
 *
 * An installed PWA keeps working offline while locked out, because the service
 * worker answers from its precache and never reaches this code. That is the
 * intended trade: the gate protects the deployment, not the device, and the
 * data on the device is already the user's own.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const password = gatePassword();
  if (password && !isOpenPath(pathname)) {
    const unlocked = await verifyToken(
      password,
      request.cookies.get(GATE_COOKIE)?.value,
    );

    if (!unlocked) {
      // An API caller gets a status it can act on; a browser gets the door.
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "locked" }, { status: 401 });
      }

      const gate = request.nextUrl.clone();
      gate.pathname = "/gate";
      gate.search = "";
      const next = `${pathname}${request.nextUrl.search}`;
      if (next !== "/" && !next.startsWith("/gate")) {
        gate.searchParams.set("next", next);
      }
      return NextResponse.redirect(gate);
    }
  }

  return refreshSupabaseSession(request);
}

/**
 * Passes the request through, renewing the Supabase session cookies on the way.
 * A no-op in local-only mode, and never fatal: a Supabase outage must not take
 * the whole app down when every screen reads from IndexedDB anyway.
 */
async function refreshSupabaseSession(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  try {
    await supabase.auth.getUser();
  } catch {
    // Offline, or Supabase unreachable. The cookies stay as they were.
  }

  return response;
}

export const config = {
  /*
   * Everything except the assets the browser fetches on its own behalf. The
   * service worker and the manifest are excluded here as well as in
   * `isOpenPath` so a locked deployment can still be installed and still
   * answers from its precache.
   */
  matcher: [
    "/((?!_next/static|_next/image|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)",
  ],
};
