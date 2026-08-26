"use client";

import { expireConflictBadges } from "@/lib/agendas/repo";
import { pullGoogleCalendar } from "@/lib/gcal/pull";

/**
 * §6.3 sync triggers: app foreground, manual pull-to-refresh, and every
 * 5 minutes while the app is open and online.
 *
 * Deliberately *not* webhooks or push channels — §6.3 rules those out for
 * Phase 1 because they need a stable public endpoint and renewal logic.
 */
const PERIODIC_MS = 5 * 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runOnce(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  running = true;
  try {
    await pullGoogleCalendar();
    await expireConflictBadges();
  } catch (err) {
    // A Google outage must never break the app: everything the UI reads is
    // already in IndexedDB.
    console.warn("[foqus] gcal pull failed", err);
  } finally {
    running = false;
  }
}

/** Manual pull-to-refresh. */
export async function refreshGoogleCalendar(): Promise<void> {
  await runOnce();
}

export function startGcalEngine(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const onVisible = () => {
    if (document.visibilityState === "visible") void runOnce();
  };
  const onOnline = () => void runOnce();

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  timer = setInterval(() => void runOnce(), PERIODIC_MS);

  void runOnce();

  return () => {
    started = false;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    if (timer) clearInterval(timer);
  };
}
