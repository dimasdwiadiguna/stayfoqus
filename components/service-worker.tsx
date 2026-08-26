"use client";

import * as React from "react";

/**
 * Registers the Serwist-generated worker. Kept out of `next.config` because
 * Serwist runs in configurator mode (see `serwist.config.mjs`) and therefore
 * injects no registration code of its own.
 */
export function ServiceWorkerRegistrar() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[foqus] service worker failed", err));
    };

    // Registering after load keeps the worker off the critical path of the
    // first paint, which matters on a cold mobile start.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
