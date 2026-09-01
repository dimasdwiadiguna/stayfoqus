import type { CalendarEvent, EventException, IsoDate, UUID } from "@/lib/db/schema";
import { dateRange, dayOfWeek, instantAt, minutesFromMidnight } from "@/lib/time";
import { byStart, overlaps } from "@/lib/scheduling/intervals";
import type { BufferSide, Interval } from "@/lib/scheduling/types";

/**
 * Events — a commitment that is not a todo.
 *
 * Not in the brief: everything it puts on the calendar descends from a todo, is
 * computed (prayers, windows, time blocks), or is mirrored from another Google
 * calendar. An event is the fourth thing — entered by hand as the deliberate
 * stand-in for the Google sync, so that hours which are genuinely spoken for
 * stop being handed out by the allocator.
 *
 * Expansion follows `expandTimeBlocks` closely, because the storage shape is
 * the same (wall-clock times plus a recurrence) and that shape is already
 * tested. Two differences are deliberate, and both are noted below.
 *
 * Pure and framework-free, like the rest of `lib/scheduling/` (§13).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EventInstance extends Interval {
  /** The local date the event *starts* on. */
  date: IsoDate;
  eventId: UUID;
  title: string;
  location: string | null;
  bufferBefore: BufferSide;
  bufferAfter: BufferSide;
  /**
   * This occurrence was skipped (§4.7's idea, applied to events).
   *
   * Returned rather than dropped: the editor is only reachable by tapping the
   * block on the calendar, so a skipped occurrence that vanished could never be
   * un-skipped once its undo toast expired. Callers that reason about *time*
   * — the busy map, the ticker — filter these out; the calendar draws them as
   * a ghost that can be tapped to bring the occurrence back.
   */
  skipped: boolean;
}

function sideBefore(event: CalendarEvent): BufferSide {
  return { min: event.buffer_before_min, type: event.buffer_before_type };
}

function sideAfter(event: CalendarEvent): BufferSide {
  return { min: event.buffer_after_min, type: event.buffer_after_type };
}

/**
 * Expands recurrence into concrete occurrences over a date range, honouring
 * per-date skips.
 *
 * `end_time` at or before `start_time` means the event ends on the *following*
 * day. `expandTimeBlocks` skips such a row instead, and rightly: a time block
 * is a rule about a window, and a window that wraps midnight is a mistake. An
 * event is a thing that happens, and 21:00–00:30 happens.
 */
export function expandEvents(
  events: readonly CalendarEvent[],
  exceptions: readonly EventException[],
  from: IsoDate,
  to: IsoDate,
  timezone: string,
): EventInstance[] {
  const skipped = new Set(
    exceptions
      .filter((e) => !e.deleted_at && e.action === "skipped")
      .map((e) => `${e.event_id}|${e.date}`),
  );

  const out: EventInstance[] = [];

  for (const event of events) {
    if (event.deleted_at || !event.enabled) continue;

    const dates =
      event.recurrence === "once"
        ? event.specific_date &&
          event.specific_date >= from &&
          event.specific_date <= to
          ? [event.specific_date]
          : []
        : dateRange(from, to).filter((d) => event.days_of_week.includes(dayOfWeek(d)));

    const wrapsMidnight =
      minutesFromMidnight(event.end_time) <= minutesFromMidnight(event.start_time);

    for (const date of dates) {
      if (event.end_date && date > event.end_date) continue;

      const start = instantAt(date, event.start_time, timezone).getTime();
      const end =
        instantAt(date, event.end_time, timezone).getTime() +
        (wrapsMidnight ? DAY_MS : 0);

      out.push({
        date,
        eventId: event.id,
        title: event.title,
        location: event.location,
        bufferBefore: sideBefore(event),
        bufferAfter: sideAfter(event),
        skipped: skipped.has(`${event.id}|${date}`),
        start,
        end,
      });
    }
  }

  return out.sort(byStart);
}

/** The occurrences that actually consume time. */
export function activeEvents(
  instances: readonly EventInstance[],
): EventInstance[] {
  return instances.filter((e) => !e.skipped);
}

/**
 * The event a placement collides with, if any — the first one it hits.
 *
 * Drives both the soft confirmation on a manual drop and the live ring while a
 * block is being dragged, so the two can never disagree about what is in the
 * way. Skipped occurrences are not in the way.
 */
export function overlappingEvent(
  interval: Interval,
  instances: readonly EventInstance[],
): EventInstance | null {
  return (
    activeEvents(instances)
      .filter((event) => overlaps(interval, event))
      .sort(byStart)[0] ?? null
  );
}
