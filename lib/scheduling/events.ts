import type {
  Agenda,
  CalendarEvent,
  EventException,
  IsoDate,
  UUID,
} from "@/lib/db/schema";
import { dateRange, dayOfWeek, instantAt, minutesFromMidnight } from "@/lib/time";
import {
  agendaStops,
  eventStopKey,
  resolveCommute,
  type CommuteAssignment,
  type CommuteContext,
  type CommuteStop,
} from "@/lib/scheduling/commute";
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
  /** The coordinate this occurrence happens at, when there is one. */
  placeId: UUID | null;
  bufferBefore: BufferSide;
  bufferAfter: BufferSide;
  /**
   * How the journey to this occurrence was worked out, when it was.
   *
   * Present only when `bufferBefore` is a computed commute — the sheet uses it
   * to say "Rumah → Kantor" rather than just a number.
   */
  commute: CommuteAssignment | null;
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
 * What `expandEvents` needs in order to compute each occurrence's commute.
 *
 * Optional: without it the expansion behaves exactly as it did before, and the
 * stored buffers are used as written.
 */
export interface EventCommuteContext extends CommuteContext {
  /** The other blocks on these days — waypoints in the same chain. */
  agendas: readonly Agenda[];
  /** What a `before` buffer falls back to when no journey is charged. */
  defaultBefore: BufferSide;
  timezone: string;
}

/**
 * Expands recurrence into concrete occurrences over a date range, honouring
 * per-date skips.
 *
 * `end_time` at or before `start_time` means the event ends on the *following*
 * day. `expandTimeBlocks` skips such a row instead, and rightly: a time block
 * is a rule about a window, and a window that wraps midnight is a mistake. An
 * event is a thing that happens, and 21:00–00:30 happens.
 *
 * ## Why the commute is computed here rather than stored
 *
 * An agenda is a concrete instant, so its commute is a fact about that
 * placement and is written onto the row (`applyCommuteMoves`). An event is a
 * *rule* — wall-clock time plus a recurrence — and two of its occurrences can
 * be reached from completely different places: Tuesday you are already at the
 * office, Friday you leave from home. One number on the shared row would be
 * wrong on most days, so it is derived per occurrence instead, right here where
 * the occurrence itself is made. Both paths call the same `resolveCommute`, so
 * an agenda and an event on the same day cannot disagree about the chain.
 */
export function expandEvents(
  events: readonly CalendarEvent[],
  exceptions: readonly EventException[],
  from: IsoDate,
  to: IsoDate,
  timezone: string,
  commuteCtx?: EventCommuteContext,
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
        placeId: event.place_id,
        bufferBefore: sideBefore(event),
        bufferAfter: sideAfter(event),
        commute: null,
        skipped: skipped.has(`${event.id}|${date}`),
        start,
        end,
      });
    }
  }

  const expanded = out.sort(byStart);
  return commuteCtx ? withCommute(expanded, events, commuteCtx) : expanded;
}

/**
 * Rewrites each occurrence's `before` buffer with the journey to it.
 *
 * Only occurrences whose event is still `commute_auto` are touched — typing a
 * buffer by hand takes the row out of the estimate's hands for good, until the
 * user asks for it back.
 *
 * A skipped occurrence still takes part in the chain's *ordering* but must not
 * move you: you did not go. It is excluded from the stops for that reason, so
 * the occurrence after it is measured from wherever you actually were.
 */
function withCommute(
  instances: readonly EventInstance[],
  events: readonly CalendarEvent[],
  ctx: EventCommuteContext,
): EventInstance[] {
  const autoByEvent = new Map(events.map((e) => [e.id, e.commute_auto !== 0] as const));

  const stops: CommuteStop[] = [
    ...agendaStops(ctx.agendas, ctx.timezone),
    ...instances
      .filter((instance) => !instance.skipped)
      .map((instance) => ({
        key: eventStopKey(instance.eventId, instance.date),
        date: instance.date,
        start: instance.start,
        placeId: instance.placeId,
      })),
  ];

  const assignments = resolveCommute(stops, ctx);

  return instances.map((instance) => {
    if (!autoByEvent.get(instance.eventId)) return instance;

    const commute = assignments.get(eventStopKey(instance.eventId, instance.date));
    if (!commute || commute.minutes <= 0) {
      return { ...instance, bufferBefore: ctx.defaultBefore, commute: null };
    }

    return {
      ...instance,
      bufferBefore: { min: commute.minutes, type: "commute" as const },
      commute,
    };
  });
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
