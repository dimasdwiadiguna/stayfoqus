import type { Agenda, PrayerKey, UUID } from "@/lib/db/schema";
import { byStart } from "@/lib/scheduling/intervals";
import type { Interval, PrayerBlock } from "@/lib/scheduling/types";

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

export type ActivityKind = "agenda" | "prayer" | "commute";

export interface Activity extends Interval {
  kind: ActivityKind;
  /** Stable identity — a React key, and the last tie-break in the ordering. */
  key: string;
  /** The agenda this is, or the agenda a commute belongs to. */
  agendaId?: UUID;
  prayerKey?: PrayerKey;
  /** Commute only: which side of its agenda it sits on. */
  side?: "before" | "after";
}

/**
 * Turns agendas and prayer blocks into the stream of things that happen.
 *
 * Three judgements are encoded here rather than in the component that shows
 * them:
 *
 * 1. **A `switch` buffer is never an activity.** It is time for the head to
 *    catch up, and the agenda on either side of it already says so. A
 *    **`commute`** buffer is: travelling somewhere is a thing you are doing,
 *    and it is the one you most need warning about. That distinction is exactly
 *    the one §5.2 draws between the two types.
 * 2. **A `draft` is not a commitment** and a `cancelled` one is not happening,
 *    so neither appears.
 * 3. **A `done` agenda is over**, even if the clock is still inside it —
 *    announcing work you have already finished as "now" is worse than saying
 *    nothing. This also keeps the retroactive agenda D-084 creates, which ends
 *    at the current instant, out of the way.
 */
export function buildActivities(input: {
  agendas: readonly Agenda[];
  prayers: readonly PrayerBlock[];
}): Activity[] {
  const out: Activity[] = [];

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

    if (agenda.buffer_before_type === "commute" && agenda.buffer_before_min > 0) {
      out.push({
        kind: "commute",
        key: `commute-before-${agenda.id}`,
        agendaId: agenda.id,
        side: "before",
        start: start - agenda.buffer_before_min * MINUTE,
        end: start,
      });
    }

    out.push({
      kind: "agenda",
      key: `agenda-${agenda.id}`,
      agendaId: agenda.id,
      start,
      end,
    });

    if (agenda.buffer_after_type === "commute" && agenda.buffer_after_min > 0) {
      out.push({
        kind: "commute",
        key: `commute-after-${agenda.id}`,
        agendaId: agenda.id,
        side: "after",
        start: end,
        end: end + agenda.buffer_after_min * MINUTE,
      });
    }
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
