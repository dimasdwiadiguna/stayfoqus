import { describe, expect, it } from "vitest";

import { SHELL_ROUTES, isAppDocument } from "@/lib/pwa/shell";

/*
 * The bug this pins: every one of these was precached, Serwist registers the
 * precache route ahead of all runtime caching, so navigations were answered
 * from the cache and `middleware.ts` never ran — the access gate simply never
 * appeared on a device that had opened the app once.
 */
describe("what may be precached", () => {
  it("excludes every app route, so the server can answer navigations", () => {
    for (const route of ["/", ...SHELL_ROUTES]) {
      expect(isAppDocument(route)).toBe(true);
    }
  });

  it("keeps the offline fallback, which has to be there to be served", () => {
    expect(isAppDocument("/offline")).toBe(false);
  });

  it("keeps the static assets", () => {
    for (const asset of [
      "/icons/icon-192.png",
      "/icons/icon.svg",
      "/_next/static/chunks/main-abc123.js",
      "/_next/static/css/app.css",
      "/manifest.webmanifest",
    ]) {
      expect(isAppDocument(asset)).toBe(false);
    }
  });

  it("covers a route added later without anyone editing this file", () => {
    expect(isAppDocument("/statistik")).toBe(true);
  });
});
