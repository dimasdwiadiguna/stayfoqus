/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistPlugin,
  SerwistGlobalConfig,
} from "serwist";
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

import { PAGES_CACHE, isAppDocument } from "@/lib/pwa/shell";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Map tiles for the place picker.
 *
 * The only part of this app that genuinely needs the network. Cached so an area
 * the user has already looked at still draws offline — dropping a pin near home
 * or the office is exactly the case worth covering, and it is also the case
 * most likely to be revisited.
 *
 * CacheFirst because tiles are immutable at a given z/x/y, and capped so a long
 * pan across a country cannot fill the origin's storage quota.
 */
const mapTiles: RuntimeCaching = {
  matcher: ({ url }) => url.hostname === "tile.openstreetmap.org",
  handler: new CacheFirst({
    cacheName: "osm-tiles",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 300,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
};

/**
 * Never store a redirect, or anything that is not a plain 200.
 *
 * The access gate answers a locked navigation with a redirect to `/gate`. Left
 * to itself, NetworkFirst would cache the resulting document under the URL that
 * was asked for, and the app would open to the lock screen offline with no way
 * through. A redirected response is also refused by the Cache API for a
 * navigation request, so this is correctness as much as policy.
 */
const onlyPlainDocuments: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) =>
    response.status === 200 && !response.redirected ? response : null,
};

/**
 * Navigations go to the network first, and fall back to the last good copy.
 *
 * This replaces precaching the app's documents. Precaching them was answering
 * every navigation from the cache — correct for an offline-first app, and fatal
 * for a server-side access gate, because the request never reached
 * `middleware.ts`. Network-first keeps the server in charge while online and
 * keeps the app openable offline, which is what §10 actually asks for.
 */
const appShell: RuntimeCaching = {
  matcher: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
  handler: new NetworkFirst({
    cacheName: PAGES_CACHE,
    // Long enough that a slow connection still gets the live page, short enough
    // that a dead one does not hold the app on a white screen.
    networkTimeoutSeconds: 8,
    plugins: [
      onlyPlainDocuments,
      new ExpirationPlugin({
        maxEntries: 16,
        maxAgeSeconds: 30 * 24 * 60 * 60,
      }),
    ],
  }),
};

const serwist = new Serwist({
  // Everything except the app's own documents — see `isAppDocument`.
  precacheEntries: (self.__SW_MANIFEST ?? []).filter((entry) =>
    !isAppDocument(typeof entry === "string" ? entry : entry.url),
  ),
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [appShell, mapTiles, ...defaultCache],
  fallbacks: {
    entries: [
      {
        // Reached only when the network is gone *and* this route has never been
        // opened online. The shell is warmed after boot (`lib/pwa/warm.ts`) so
        // that stays a narrow case.
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
