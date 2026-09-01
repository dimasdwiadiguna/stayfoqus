import { contains, overlaps } from "@/lib/scheduling/intervals";
import { SNAP_MS } from "@/lib/scheduling/placement";
import type { FreeInterval, Interval, PrayerBlock } from "@/lib/scheduling/types";

/**
 * Moving a placement off a prayer block instead of through it.
 *
 * §5.3 makes prayer blocks busy for the scheduler and asks only for a
 * confirmation when the user places over one by hand. That confirmation is a
 * yes/no about breaking something the user does not actually want broken; the
 * useful question is *where else*. So before asking, the two obvious answers are
 * computed: keep the length, and either finish before the prayer starts or begin
 * after it ends.
 *
 * An answer is only offered when it genuinely fits — meaning it sits whole
 * inside one free interval, which already accounts for the availability window,
 * other agendas with their buffers, other prayers, and Google busy time. When
 * neither fits there is nothing to offer, and the caller falls back to §5.3's
 * plain confirmation.
 *
 * Pure, and framework-free, like the rest of `lib/scheduling/`.
 */

export interface PrayerAvoidance {
  /** The prayer block that is in the way — the first one, if several are. */
  prayer: PrayerBlock;
  /** Same length, finishing at or before the prayer starts. */
  earlier: Interval | null;
  /** Same length, starting at or after the prayer ends. */
  later: Interval | null;
}

/** Floors to the 5-minute grid the drag and the suggester both use. */
function snapDown(ms: number): number {
  return Math.floor(ms / SNAP_MS) * SNAP_MS;
}

function snapUp(ms: number): number {
  return Math.ceil(ms / SNAP_MS) * SNAP_MS;
}

/** True when the whole interval sits inside one free interval. */
function fitsFree(
  interval: Interval,
  free: readonly FreeInterval[],
  prayers: readonly PrayerBlock[],
): boolean {
  if (!free.some((slot) => contains(slot, interval))) return false;
  // The free map is built without prayer blocks in some call sites (the
  // calendar builds one for its header totals, for instance), so the prayers
  // are re-checked here rather than assumed.
  return !prayers.some((prayer) => overlaps(interval, prayer));
}

/**
 * The prayer a placement collides with, and the nearest legal way around it.
 * Returns `null` when the placement is already clear of every prayer block.
 */
export function avoidPrayer(
  interval: Interval,
  prayers: readonly PrayerBlock[],
  free: readonly FreeInterval[],
): PrayerAvoidance | null {
  const hit = prayers
    .filter((prayer) => overlaps(interval, prayer))
    .sort((a, b) => a.start - b.start)[0];
  if (!hit) return null;

  const duration = interval.end - interval.start;

  // Rounded *away* from the prayer on both sides: a 5-minute grid must never
  // be the reason a block clips the edge of a block it was moved to respect.
  const earlierEnd = snapDown(hit.start);
  const earlier: Interval = {
    start: earlierEnd - duration,
    end: earlierEnd,
  };

  const laterStart = snapUp(hit.end);
  const later: Interval = { start: laterStart, end: laterStart + duration };

  return {
    prayer: hit,
    earlier: fitsFree(earlier, free, prayers) ? earlier : null,
    later: fitsFree(later, free, prayers) ? later : null,
  };
}
