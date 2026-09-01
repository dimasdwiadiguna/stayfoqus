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

interface Clock {
  current: number;
  timer: ReturnType<typeof setInterval> | null;
  listeners: Set<() => void>;
  subscribe: (onChange: () => void) => () => void;
  getSnapshot: () => number;
}

/** One clock per interval, shared by everyone who asks for that interval. */
const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  const existing = clocks.get(intervalMs);
  if (existing) return existing;

  const clock: Clock = {
    current: Date.now(),
    timer: null,
    listeners: new Set(),
    subscribe(onChange) {
      clock.listeners.add(onChange);
      if (!clock.timer) {
        clock.current = Date.now();
        clock.timer = setInterval(() => {
          clock.current = Date.now();
          for (const listener of clock.listeners) listener();
        }, intervalMs);
      }
      return () => {
        clock.listeners.delete(onChange);
        if (clock.listeners.size === 0 && clock.timer) {
          clearInterval(clock.timer);
          clock.timer = null;
        }
      };
    },
    getSnapshot: () => clock.current,
  };

  clocks.set(intervalMs, clock);
  return clock;
}

/** Server render has no clock; `null` renders the now-line as absent. */
const getServerSnapshot = () => null;

export function useNow(): number | null {
  return useTick(TICK_MS);
}

/**
 * A shared clock at any interval.
 *
 * `useNow()`'s 30 seconds is right for almost everything — the now-line, the
 * missed-agenda detector, the day header — and one clock keeps them from
 * disagreeing (D-066). The ticker is the exception: it shows a countdown in
 * seconds, so it subscribes at 1000 ms. Everyone asking for the same interval
 * still shares a single timer, and a timer with no subscribers stops.
 */
export function useTick(intervalMs: number): number | null {
  const clock = clockFor(intervalMs);
  return useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    getServerSnapshot,
  );
}

/** Non-reactive read for event handlers, which must not re-render anything. */
export function readNow(): number {
  return Date.now();
}
