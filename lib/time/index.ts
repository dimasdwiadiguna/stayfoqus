import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import type { DayOfWeek, HHmm, IsoDate, IsoWeek } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

/**
 * The single timezone boundary (§13).
 *
 * Everything is stored as a UTC instant. A "local date" or "local time" only
 * has meaning together with the user's configured timezone, so every function
 * here takes it explicitly — there is no ambient local time in this codebase.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** "2026-08-26" for the given instant in the user's timezone. */
export function localDate(instant: Date | string, timezone: string): IsoDate {
  return formatInTimeZone(new Date(instant), timezone, "yyyy-MM-dd");
}

/** "14:05" for the given instant in the user's timezone. */
export function localTime(instant: Date | string, timezone: string): HHmm {
  return formatInTimeZone(new Date(instant), timezone, "HH:mm");
}

/**
 * The UTC instant of a wall-clock time on a local date.
 * This is the only correct way to turn "Monday 04:00 in Asia/Jakarta" into a
 * timestamp — it survives DST transitions, which naive arithmetic does not.
 */
export function instantAt(
  date: IsoDate,
  time: HHmm,
  timezone: string,
): Date {
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

export function startOfLocalDay(date: IsoDate, timezone: string): Date {
  return instantAt(date, "00:00", timezone);
}

/** Exclusive end of the local day — i.e. the start of the next one. */
export function endOfLocalDay(date: IsoDate, timezone: string): Date {
  return startOfLocalDay(addDays(date, 1), timezone);
}

/** Minutes from local midnight, matching how availability windows are stored. */
export function minutesFromMidnight(time: HHmm): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutesToHHmm(minutes: number): HHmm {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* calendar-date arithmetic (no timezone involved)                     */
/* ------------------------------------------------------------------ */

/**
 * Adds days to an ISO date. Uses UTC internally purely as a calendar — no
 * instant is implied, so DST cannot shift the result.
 */
export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday, matching `availability_windows.day_of_week`. */
export function dayOfWeek(date: IsoDate): DayOfWeek {
  return new Date(`${date}T00:00:00Z`).getUTCDay() as DayOfWeek;
}

export function isFriday(date: IsoDate): boolean {
  return dayOfWeek(date) === 5;
}

/* ------------------------------------------------------------------ */
/* ISO weeks                                                           */
/* ------------------------------------------------------------------ */

/** ISO-8601 week identifier, e.g. "2026-W35". Weeks start on Monday. */
export function isoWeekOf(date: IsoDate): IsoWeek {
  const d = new Date(`${date}T00:00:00Z`);
  // Shift to the Thursday of this ISO week; its year is the ISO week-year.
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** Monday of the given ISO week. */
export function isoWeekStart(week: IsoWeek): IsoDate {
  const [yearPart = "1970", weekPart = "W01"] = week.split("-");
  const year = Number(yearPart);
  const weekNumber = Number(weekPart.replace("W", ""));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day);
  week1Monday.setUTCDate(week1Monday.getUTCDate() + (weekNumber - 1) * 7);
  return week1Monday.toISOString().slice(0, 10);
}

export function isoWeekDates(week: IsoWeek): IsoDate[] {
  const start = isoWeekStart(week);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function addWeeks(week: IsoWeek, delta: number): IsoWeek {
  return isoWeekOf(addDays(isoWeekStart(week), delta * 7));
}

/* ------------------------------------------------------------------ */
/* presentation (Bahasa Indonesia)                                     */
/* ------------------------------------------------------------------ */

export function formatDayLabel(date: IsoDate, timezone: string, today?: IsoDate): string {
  const ref = today ?? localDate(new Date(), timezone);
  if (date === ref) return t.common.today;
  if (date === addDays(ref, 1)) return t.common.tomorrow;
  if (date === addDays(ref, -1)) return t.common.yesterday;
  return formatDateShort(date);
}

export function formatDateShort(date: IsoDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  const month = t.months.short[d.getUTCMonth()] ?? "";
  return `${d.getUTCDate()} ${month}`;
}

export function formatDateFull(date: IsoDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = t.days.long[d.getUTCDay()] ?? "";
  const month = t.months.long[d.getUTCMonth()] ?? "";
  return `${weekday}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

export function formatDateWithWeekday(date: IsoDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = t.days.short[d.getUTCDay()] ?? "";
  return `${weekday} ${d.getUTCDate()} ${t.months.short[d.getUTCMonth()] ?? ""}`;
}

export function formatTimeRange(
  startAt: string,
  endAt: string,
  timezone: string,
): string {
  return `${localTime(startAt, timezone)}–${localTime(endAt, timezone)}`;
}

/** "1j 25m" / "25m" — compact duration for headers and chips. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  if (rest === 0) return `${h}j`;
  return `${h}j ${rest}m`;
}

export function formatHoursDecimal(minutes: number): string {
  return (Math.max(0, minutes) / 60).toFixed(1).replace(".", ",");
}

/** Wall-clock minutes since local midnight for an instant — timeline geometry. */
export function minutesIntoLocalDay(
  instant: Date | string,
  date: IsoDate,
  timezone: string,
): number {
  const dayStart = startOfLocalDay(date, timezone).getTime();
  return (new Date(instant).getTime() - dayStart) / MINUTE_MS;
}

export { toZonedTime };

/**
 * A countdown, in clock style: `1:12:05` over an hour, `12:05` under one.
 *
 * Clock style rather than "1j 12m 5d" because the ticker refreshes every
 * second: the digits have to stay in the same places, and a unit-suffixed form
 * changes width as the numbers shrink. Pair it with `tabular-nums`.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
