import { serwist } from "@serwist/next/config";

/**
 * Serwist runs in "configurator" mode rather than as a webpack plugin.
 *
 * Next.js 16 builds with Turbopack by default, and `@serwist/next`'s plugin
 * mode is webpack-only — it aborts the build. Configurator mode compiles the
 * service worker as a separate step after `next build` (see the `build` script)
 * and is Turbopack-agnostic.
 */
export default serwist.withNextConfig(() => ({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
}));
