/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

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

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [mapTiles, ...defaultCache],
  fallbacks: {
    entries: [
      {
        // The shell is a client-rendered SPA reading from IndexedDB, so any
        // navigation can be answered from the precached offline document.
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
