/**
 * The app-shell documents, and the cache they live in.
 *
 * Shared by the service worker and the client warm-up below, which have to
 * agree on the cache name or the warm-up fills a cache nothing reads.
 * Serwist uses an explicitly supplied `cacheName` verbatim — it only prefixes
 * the ones it names itself — so this string is the whole contract.
 */
export const PAGES_CACHE = "pages";

/**
 * Every route that can be a cold start. Listed rather than derived because the
 * service worker has no router to ask, and a route missing from here degrades
 * to the offline page rather than breaking anything.
 */
export const SHELL_ROUTES = [
  "/tasks",
  "/calendar",
  "/today",
  "/week",
  "/settings",
] as const;

/**
 * A precache entry that is one of the app's own HTML documents.
 *
 * These must *not* be precached. Serwist registers the precache route before
 * every runtime route (`Serwist.ts`: the `PrecacheRoute` goes in at
 * construction, ahead of `runtimeCaching`), so a precached `/tasks` is answered
 * from the cache and the request never reaches the server — which means
 * `middleware.ts` never runs and the access gate never appears.
 *
 * The extension test rather than a hardcoded list: a route added later has no
 * file extension either, so it is covered without anyone remembering to come
 * back here. `/offline` is the exception — it is the navigation fallback, and a
 * fallback that is not precached cannot be served when nothing else can.
 */
export function isAppDocument(url: string): boolean {
  if (url === "/offline") return false;
  return !/\.[a-z0-9]+$/i.test(url);
}
