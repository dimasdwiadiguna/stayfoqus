import { LOCAL_USER_ID, type Settings, type TimeBlock, type TimeBlockException } from "@/lib/db/schema";
import { defaultSettings } from "@/lib/db/seed";
import { instantAt } from "@/lib/time";
import type { AvailabilityWindowSpec, BufferSide, Interval } from "@/lib/scheduling/types";

export const JKT = "Asia/Jakarta";

/** Instant of a wall-clock time on a date in Asia/Jakarta. */
export function at(date: string, time: string): number {
  return instantAt(date, time, JKT).getTime();
}

export function span(date: string, from: string, to: string): Interval {
  return { start: at(date, from), end: at(date, to) };
}

export const sw = (min: number): BufferSide => ({ min, type: "switch" });
export const cm = (min: number): BufferSide => ({ min, type: "commute" });

export function windowSpec(
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  enabled = true,
): AvailabilityWindowSpec {
  return {
    dayOfWeek: dayOfWeek as AvailabilityWindowSpec["dayOfWeek"],
    startTime,
    endTime,
    enabled,
  };
}

/** Every day of the week gets the same window — keeps fixtures short. */
export function allDays(startTime: string, endTime: string): AvailabilityWindowSpec[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => windowSpec(d, startTime, endTime));
}

export function testSettings(overrides: Partial<Settings> = {}): Settings {
  const ts = "2026-08-01T00:00:00.000Z";
  return {
    id: "settings",
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    ...defaultSettings(),
    ...overrides,
  };
}

export function timeBlock(overrides: Partial<TimeBlock> = {}): TimeBlock {
  const ts = "2026-08-01T00:00:00.000Z";
  return {
    id: overrides.id ?? "tb-1",
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    name: "Blok",
    start_time: "09:00",
    end_time: "12:00",
    recurrence: "weekly",
    days_of_week: [1, 2, 3, 4, 5],
    specific_date: null,
    end_date: null,
    filter_category_ids: [],
    filter_tags: [],
    filter_priorities: [],
    color: "#7c9cff",
    enabled: true,
    ...overrides,
  };
}

export function timeBlockException(
  overrides: Partial<TimeBlockException> = {},
): TimeBlockException {
  const ts = "2026-08-01T00:00:00.000Z";
  return {
    id: overrides.id ?? "tbe-1",
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    time_block_id: "tb-1",
    date: "2026-08-26",
    action: "skipped",
    ...overrides,
  };
}

/** Renders an interval as "HH:mm–HH:mm" in Jakarta, for readable assertions. */
export function fmt(interval: Interval): string {
  const f = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-GB", {
      timeZone: JKT,
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${f(interval.start)}–${f(interval.end)}`;
}
