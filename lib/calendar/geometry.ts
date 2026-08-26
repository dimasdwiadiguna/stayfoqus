import type { IsoDate } from "@/lib/db/schema";
import { MINUTE_MS, startOfLocalDay } from "@/lib/time";

/**
 * Timeline geometry. Pure: the calendar renders from these numbers and the
 * drag handlers invert them, so a block always lands where it looks like it is.
 */

/**
 * Vertical density of the day column: 24 h ≈ 2160 px, scrollable.
 * Chosen so a single-pomodoro block (25 min) is ~38 px tall — enough to carry
 * its title, its time range and the §5.7 dot row without truncation.
 */
export const PX_PER_MIN = 1.5;

/** §8: drag-to-move snaps to 5-minute increments. */
export const MOVE_SNAP_MIN = 5;

export const HOUR_HEIGHT = 60 * PX_PER_MIN;
export const DAY_HEIGHT = 24 * HOUR_HEIGHT;

export function minutesToPx(minutes: number): number {
  return minutes * PX_PER_MIN;
}

export function pxToMinutes(px: number): number {
  return px / PX_PER_MIN;
}

/** Offset in pixels from the top of the day column for an instant. */
export function topFor(
  instant: Date | string | number,
  date: IsoDate,
  timezone: string,
): number {
  const dayStart = startOfLocalDay(date, timezone).getTime();
  const ms = typeof instant === "number" ? instant : new Date(instant).getTime();
  return minutesToPx((ms - dayStart) / MINUTE_MS);
}

/** Height in pixels for a duration between two instants. */
export function heightFor(
  start: Date | string | number,
  end: Date | string | number,
): number {
  const a = typeof start === "number" ? start : new Date(start).getTime();
  const b = typeof end === "number" ? end : new Date(end).getTime();
  return minutesToPx((b - a) / MINUTE_MS);
}

export function snapMinutes(minutes: number, step = MOVE_SNAP_MIN): number {
  return Math.round(minutes / step) * step;
}

/** Instant for a pixel offset in the day column, snapped to `step` minutes. */
export function instantForPx(
  px: number,
  date: IsoDate,
  timezone: string,
  step = MOVE_SNAP_MIN,
): number {
  const dayStart = startOfLocalDay(date, timezone).getTime();
  return dayStart + snapMinutes(pxToMinutes(px), step) * MINUTE_MS;
}

/**
 * Lays out overlapping blocks side by side.
 *
 * Overlaps are expected — a manually placed agenda may sit over a prayer block,
 * and §5.1 explicitly allows placements the scheduler would not make. Rather
 * than hide one behind the other, columns are assigned greedily by start time.
 */
export interface LaidOut<T> {
  item: T;
  column: number;
  columns: number;
}

export function layoutOverlaps<T extends { start: number; end: number }>(
  items: readonly T[],
): LaidOut<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: LaidOut<T>[] = [];

  let cluster: LaidOut<T>[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = cluster.reduce((max, c) => Math.max(max, c.column + 1), 1);
    for (const entry of cluster) entry.columns = columns;
    result.push(...cluster);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length > 0) flush();

    // First column whose last block has already ended.
    const used = new Set(
      cluster.filter((c) => c.item.end > item.start).map((c) => c.column),
    );
    let column = 0;
    while (used.has(column)) column += 1;

    cluster.push({ item, column, columns: 1 });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length > 0) flush();

  return result;
}
