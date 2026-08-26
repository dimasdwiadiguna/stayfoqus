import type { Interval } from "@/lib/scheduling/types";

/** Shared interval helpers. Half-open: [start, end). */

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(outer: Interval, inner: Interval): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

export function durationMin(interval: Interval): number {
  return (interval.end - interval.start) / 60_000;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return start < end ? { start, end } : null;
}

export function byStart(a: Interval, b: Interval): number {
  return a.start - b.start || a.end - b.end;
}

/** Merges overlapping and touching intervals into a minimal covering set. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort(byStart);
  const out: Interval[] = [{ ...sorted[0]! }];

  for (const current of sorted.slice(1)) {
    const last = out[out.length - 1]!;
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      out.push({ ...current });
    }
  }
  return out;
}

/** Total minutes covered by a set of possibly overlapping intervals. */
export function coveredMinutes(intervals: readonly Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + durationMin(i), 0);
}
