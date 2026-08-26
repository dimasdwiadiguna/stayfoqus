import { MAX_POMODORO_PER_SESSION } from "@/lib/db/schema";
import type { SessionShape } from "@/lib/scheduling/types";

/**
 * §5.5 Step 3 — session geometry.
 *
 *   duration = n × focus_min + (n − 1) × short_break_min
 *
 * With the defaults (25/5) that gives 1→25m, 2→55m, 3→85m, 4→115m: the breaks
 * *between* pomodoros are part of the block, the trailing break is not.
 */
export function sessionDurationMin(
  pomodoros: number,
  shape: SessionShape,
): number {
  const n = Math.max(1, Math.floor(pomodoros));
  return n * shape.focusMin + (n - 1) * shape.shortBreakMin;
}

/** Largest session that fits in `availableMin`, or 0 if not even one does. */
export function largestSessionFitting(
  availableMin: number,
  shape: SessionShape,
  cap = MAX_POMODORO_PER_SESSION,
): number {
  for (let n = cap; n >= 1; n -= 1) {
    if (sessionDurationMin(n, shape) <= availableMin) return n;
  }
  return 0;
}

/**
 * Inverts `sessionDurationMin` — how many pomodoros a block of this length
 * represents. Used when the user resizes an agenda by dragging its edge (§8:
 * "snapping to whole pomodoro durations").
 */
export function pomodorosForDuration(
  durationMin: number,
  shape: SessionShape,
): number {
  let best = 1;
  let bestDelta = Infinity;
  for (let n = 1; n <= 16; n += 1) {
    const delta = Math.abs(sessionDurationMin(n, shape) - durationMin);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = n;
    }
  }
  return best;
}

/** The exact snap targets for a resize gesture, in minutes. */
export function sessionDurationLadder(
  shape: SessionShape,
  maxPomodoros = 8,
): number[] {
  return Array.from({ length: maxPomodoros }, (_, i) =>
    sessionDurationMin(i + 1, shape),
  );
}
