/**
 * Gate configuration, read from the environment.
 *
 * `FOQUS_ACCESS_PASSWORD` is a *secret*, not a setting: it never reaches the
 * browser and there is deliberately no UI to change it. Leave it unset and the
 * gate is off entirely, which is what keeps `npm run dev` frictionless.
 */

export function gatePassword(): string | null {
  const password = process.env.FOQUS_ACCESS_PASSWORD?.trim();
  return password && password.length > 0 ? password : null;
}

export function gateEnabled(): boolean {
  return gatePassword() !== null;
}

/**
 * Paths the gate must never hold back.
 *
 * The service worker, the manifest and the icons are fetched by the browser
 * before any human has typed anything — gating them would break installing the
 * PWA and leave the app unable to register its own service worker.
 */
const OPEN_PREFIXES = [
  "/gate",
  "/api/gate",
  "/_next/",
  "/icons/",
  "/offline",
];

const OPEN_EXACT = new Set([
  "/sw.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/robots.txt",
]);

export function isOpenPath(pathname: string): boolean {
  if (OPEN_EXACT.has(pathname)) return true;
  return OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
