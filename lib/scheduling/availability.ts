import type { IsoDate } from "@/lib/db/schema";
import { dateRange, dayOfWeek, instantAt, minutesFromMidnight } from "@/lib/time";
import { byStart } from "@/lib/scheduling/intervals";
import type {
  AvailabilityWindowSpec,
  Interval,
  WindowInstance,
} from "@/lib/scheduling/types";

/**
 * §4.5 / §5.1 — availability windows.
 *
 * Multiple windows per day are allowed. A window whose end time is not after
 * its start is dropped rather than wrapping past midnight: the editor rejects
 * that input, and silently spanning two days would surprise the scheduler.
 */
export function resolveWindows(
  specs: readonly AvailabilityWindowSpec[],
  from: IsoDate,
  to: IsoDate,
  timezone: string,
): WindowInstance[] {
  const out: WindowInstance[] = [];

  for (const date of dateRange(from, to)) {
    const dow = dayOfWeek(date);
    for (const spec of specs) {
      if (!spec.enabled) continue;
      if (spec.dayOfWeek !== dow) continue;
      if (minutesFromMidnight(spec.endTime) <= minutesFromMidnight(spec.startTime)) {
        continue;
      }
      out.push({
        date,
        dayOfWeek: dow,
        start: instantAt(date, spec.startTime, timezone).getTime(),
        end: instantAt(date, spec.endTime, timezone).getTime(),
      });
    }
  }

  return out.sort(byStart);
}

/**
 * Total schedulable minutes in the windows, before obstacles are subtracted.
 * Used by the Weekly Plan capacity meter (§7.3) as its gross figure.
 */
export function windowMinutes(windows: readonly WindowInstance[]): number {
  return windows.reduce((sum, w) => sum + (w.end - w.start) / 60_000, 0);
}

/** True when the interval lies entirely inside some availability window (§5.1). */
export function isInsideWindow(
  interval: Interval,
  windows: readonly WindowInstance[],
): boolean {
  return windows.some((w) => w.start <= interval.start && interval.end <= w.end);
}
