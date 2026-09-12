"use client";

import { PAGES_CACHE, SHELL_ROUTES } from "@/lib/pwa/shell";

/**
 * Puts each tab's document in the cache the navigation route reads from.
 *
 * Needed because the app no longer precaches its documents (see
 * `lib/pwa/shell.ts`), and normal use would never fill the gap on its own:
 * tapping a tab is a client-side navigation in Next.js, so it fetches an RSC
 * payload and never the HTML. Without this, only the route the user happened to
 * cold-start on would open offline.
 *
 * Running it from the app shell rather than from the worker's `install` is
 * deliberate: this code only executes past the access gate, so every document
 * stored here is one the session was entitled to.
 */
export async function warmAppShell(): Promise<void> {
  if (typeof caches === "undefined") return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;

  try {
    const cache = await caches.open(PAGES_CACHE);

    await Promise.all(
      SHELL_ROUTES.map(async (route) => {
        try {
          const response = await fetch(route, { credentials: "same-origin" });
          // The same rule the worker applies: a redirect means the gate
          // answered, and caching that would strand the app on the lock screen.
          if (response.status !== 200 || response.redirected) return;
          await cache.put(route, response);
        } catch {
          // One route failing is not worth abandoning the rest.
        }
      }),
    );
  } catch {
    // Storage denied or quota exhausted. The app still works; it just opens to
    // the offline page on a cold start with no connection.
  }
}
