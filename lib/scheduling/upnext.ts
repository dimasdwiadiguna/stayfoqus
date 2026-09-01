import type { Agenda, PrayerKey, UUID } from "@/lib/db/schema";
import { activeEvents, type EventInstance } from "@/lib/scheduling/events";
import { byStart } from "@/lib/scheduling/intervals";
import type { BufferSide, Interval, PrayerBlock } from "@/lib/scheduling/types";

/**
 * What the day is actually made of, from the point of view of "what am I doing
 * now, and what is next".
 *
 * Not the same set of things the calendar draws. The calendar shows every
 * constraint it has; this answers a question about the next few minutes, so it
 * carries only what a person is *in* or about to be in.
 *
 * Pure and framework-free, like the rest of `lib/scheduling/` (§13).
 */

const MINUTE = 60_000;

export type ActivityKind = "agenda" | "event" | "prayer" | "commute";

export interface Activity extends Interval {
  kind: ActivityKind;
  /** Stable identity — a React key, and the last tie-break in the ordering. */
  key: string;
  /** The agenda this is, or the agenda a commute belongs to. */
  agendaId?: UUID;
  /** The event this is, or the event a commute belongs to. */
  eventId?: UUID;
  /** An event's own title — it has no todo to borrow one from. */
  title?: string;
  prayerKey?: PrayerKey;
  /** Commute only: which side of its block it sits on. */
  side?: "before" | "after";
}

/**
 * Turns agendas and prayer blocks into the stream of things that happen.
 *
 * Three judgements are encoded here rather than in the component that shows
 * them:
 *
 * 1. **A `switch` buffer is never an activity.** It is time for the head to
 *    catch up, and the block on either side of it already says so. A
 *    **`commute`** buffer is: travelling somewhere is a thing you are doing,
 *    and it is the one you most need warning about. That distinction is exactly
 *    the one §5.2 draws between the two types. It holds for events as well as
 *    agendas — the rule is about the buffer, not about what owns it.
 * 2. **A `draft` is not a commitment** and a `cancelled` one is not happening,
 *    so neither appears.
 * 3. **A skipped event occurrence does not happen**, and a **`done` agenda is
 *    over**, even if the clock is still inside it —
 *    announcing work you have already finished as "now" is worse than saying
 *    nothing. This also keeps the retroactive agenda D-084 creates, which ends
 *    at the current instant, out of the way.
 */
export function buildActivities(input: {
  agendas: readonly Agenda[];
  events: readonly EventInstance[];
  prayers: readonly PrayerBlock[];
}): Activity[] {
  const out: Activity[] = [];

  /** Only a commute becomes an activity of its own — see (1) above. */
  const pushCommute = (
    key: string,
    buffer: BufferSide,
    side: "before" | "after",
    at: number,
    owner: Pick<Activity, "agendaId" | "eventId" | "title">,
  ) => {
    if (buffer.type !== "commute" || buffer.min <= 0) return;
    out.push({
      kind: "commute",
      key,
      side,
      ...owner,
      start: side === "before" ? at - buffer.min * MINUTE : at,
      end: side === "before" ? at : at + buffer.min * MINUTE,
    });
  };

  for (const agenda of input.agendas) {
    if (agenda.deleted_at) continue;
    if (
      agenda.status === "draft" ||
      agenda.status === "cancelled" ||
      agenda.status === "done"
    ) {
      continue;
    }

    const start = new Date(agenda.start_at).getTime();
    const end = new Date(agenda.end_at).getTime();

    pushCommute(
      `commute-before-${agenda.id}`,
      { min: agenda.buffer_before_min, type: agenda.buffer_before_type },
      "before",
      start,
      { agendaId: agenda.id },
    );

    out.push({
      kind: "agenda",
      key: `agenda-${agenda.id}`,
      agendaId: agenda.id,
      start,
      end,
    });

    pushCommute(
      `commute-after-${agenda.id}`,
      { min: agenda.buffer_after_min, type: agenda.buffer_after_type },
      "after",
      end,
      { agendaId: agenda.id },
    );
  }

  // Events, by exactly the same rules — a commitment you did not turn into a
  // todo is still a thing you are in, and its commute is still a journey.
  for (const event of activeEvents(input.events)) {
    const owner = { eventId: event.eventId, title: event.title };
    const stamp = `${event.eventId}-${event.start}`;

    pushCommute(`commute-before-${stamp}`, event.bufferBefore, "before", event.start, owner);

    out.push({
      kind: "event",
      key: `event-${stamp}`,
      ...owner,
      start: event.start,
      end: event.end,
    });

    pushCommute(`commute-after-${stamp}`, event.bufferAfter, "after", event.end, owner);
  }

  for (const prayer of input.prayers) {
    out.push({
      kind: "prayer",
      key: `prayer-${prayer.key}-${prayer.start}`,
      prayerKey: prayer.key,
      start: prayer.start,
      end: prayer.end,
    });
  }

  return out.sort((a, b) => byStart(a, b) || (a.key < b.key ? -1 : 1));
}

export interface NowNext {
  current: Activity | null;
  next: Activity | null;
}

/**
 * What is running, and what comes after it.
 *
 * Activities overlap routinely — a prayer block lands inside an agenda the user
 * placed over it, a commute buffer abuts the agenda it belongs to. `current` is
 * therefore the one that started **most recently**: it is the thing just
 * stepped into, and the one whose ending is the next thing to happen. Ties fall
 * through to the earlier end and then to the key, so the answer is stable
 * across renders and across devices (the determinism D-062 established).
 */
export function nowAndNext(
  activities: readonly Activity[],
  now: number,
): NowNext {
  let current: Activity | null = null;
  let next: Activity | null = null;

  for (const activity of activities) {
    if (activity.start <= now && now < activity.end) {
      if (
        !current ||
        activity.start > current.start ||
        (activity.start === current.start &&
          (activity.end < current.end ||
            (activity.end === current.end && activity.key < current.key)))
      ) {
        current = activity;
      }
      continue;
    }

    if (activity.start > now) {
      if (
        !next ||
        activity.start < next.start ||
        (activity.start === next.start &&
          (activity.end < next.end ||
            (activity.end === next.end && activity.key < next.key)))
      ) {
        next = activity;
      }
    }
  }

  return { current, next };
}
