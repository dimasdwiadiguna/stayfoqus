"use client";

import { expireConflictBadges, queueMissingGcalEvents } from "@/lib/agendas/repo";
import { readGcalConfig } from "@/lib/gcal/config";
import { pullGoogleCalendar } from "@/lib/gcal/pull";
import { runSync } from "@/lib/sync/engine";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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

/**
 * Google is only reachable through an authenticated session. Checking locally
 * first keeps a signed-out or local-only install from firing a 401 at the
 * server every five minutes — the request would be correct but the noise is not.
 */
async function canPull(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const supabase = getSupabase();
  if (!supabase) return false;
  // The master switch in Pengaturan — off means no timer traffic at all.
  if (!(await readGcalConfig()).enabled) return false;
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

async function runOnce(): Promise<void> {
  if (running) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  running = true;
  try {
    if (!(await canPull())) return;
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

/**
 * "Sinkronkan sekarang" — both directions, in the order that makes the result
 * legible: queue whatever Google is missing, drain the outbox so those writes
 * actually leave, then read Google back.
 */
export async function refreshGoogleCalendar(): Promise<void> {
  const config = await readGcalConfig();
  if (config.enabled && config.write_enabled) {
    const queued = await queueMissingGcalEvents();
    if (queued > 0) await runSync();
  }
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
