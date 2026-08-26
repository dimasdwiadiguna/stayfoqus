"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared "current instant", ticking once a minute.
 *
 * One module-level timer serves every subscriber, so the calendar's now-line,
 * the missed-agenda detector and the day header cannot disagree about the time.
 * `useSyncExternalStore` keeps it out of render (no `Date.now()` during render)
 * and gives hydration a stable server snapshot.
 */

const TICK_MS = 30_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const listener of listeners) listener();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => current;
/** Server render has no clock; `null` renders the now-line as absent. */
const getServerSnapshot = () => null;

export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Non-reactive read for event handlers, which must not re-render anything. */
export function readNow(): number {
  return Date.now();
}
