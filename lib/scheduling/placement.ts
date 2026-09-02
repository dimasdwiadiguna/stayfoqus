import type { IsoDate } from "@/lib/db/schema";
import { edgePaddingMin } from "@/lib/scheduling/buffers";
import { commuteBufferFor, type CommutePricing } from "@/lib/scheduling/commute";
import { satisfiesTimeBlocks } from "@/lib/scheduling/timeblocks";
import { sessionDurationMin } from "@/lib/scheduling/session";
import type {
  DefaultBuffers,
  FreeInterval,
  SchedulableTodo,
  SessionShape,
  TimeBlockInstance,
} from "@/lib/scheduling/types";

const MINUTE = 60_000;

/**
 * Slot suggestions snap to 5-minute boundaries, matching the drag granularity
 * in §8. Alignment is computed on the epoch, which coincides with local
 * 5-minute boundaries for every timezone whose offset is a multiple of five
 * minutes — i.e. everywhere except Nepal (+05:45) and Chatham (+12:45), where
 * suggestions land on :00/:15/:30/:45 of a five-minute grid instead. Harmless.
 */
export const SNAP_MS = 5 * MINUTE;

function snapUp(ms: number): number {
  return Math.ceil(ms / SNAP_MS) * SNAP_MS;
}

export interface PlacementCandidate {
  start: number;
  end: number;
  date: IsoDate;
  pomodoros: number;
  interval: FreeInterval;
}

/**
 * The earliest legal start for a session of `durationMin` inside `interval`.
 *
 * Each edge charges the shortfall between what the neighbouring agenda already
 * reserved and the composed `required_gap` from §5.2 — see `buffers.ts`. A
 * window edge and a prayer/busy edge charge nothing.
 *
 * With `commute`, the candidate's own `before` side becomes the journey from
 * wherever the interval starts to where the work happens, instead of the user's
 * default. Nothing else changes: the §5.2 composition is untouched.
 */
export function earliestStartIn(
  interval: FreeInterval,
  durationMin: number,
  buffers: DefaultBuffers,
  notBefore = -Infinity,
  snap = true,
  commute?: CommutePricing,
): number | null {
  const before = commuteBufferFor(interval.originPlaceId, commute, buffers.before);
  const padStart = edgePaddingMin(interval.before, before) * MINUTE;
  const padEnd = edgePaddingMin(interval.after, buffers.after) * MINUTE;

  const lowerBound = Math.max(interval.start + padStart, notBefore);
  const start = snap ? snapUp(lowerBound) : lowerBound;
  const end = start + durationMin * MINUTE;

  return end <= interval.end - padEnd ? start : null;
}

export interface SuggestOptions {
  todo: Pick<SchedulableTodo, "categoryId" | "tags" | "priority">;
  free: readonly FreeInterval[];
  timeBlocks: readonly TimeBlockInstance[];
  buffers: DefaultBuffers;
  shape: SessionShape;
  /** Session size to place. Smaller sizes are tried when this one won't fit. */
  pomodoros: number;
  limit?: number;
  /** Never suggest a slot starting before this instant (usually "now"). */
  notBefore?: number;
  /** At most one suggestion per free interval, so the three spread out. */
  onePerInterval?: boolean;
  /** Where the work happens, so the journey to it is reserved as well. */
  commute?: CommutePricing;
}

/**
 * The slot-suggestion function behind both the "Jadwalkan" sheet (§8) and the
 * missed-agenda reschedule chips (§5.8): the nearest valid slots, in time
 * order, honouring availability, buffers, prayer blocks, busy time and time
 * blocks — the same constraints smart allocation obeys.
 */
export function suggestSlots(options: SuggestOptions): PlacementCandidate[] {
  const {
    todo,
    free,
    timeBlocks,
    buffers,
    shape,
    pomodoros,
    limit = 3,
    notBefore = -Infinity,
    onePerInterval = true,
    commute,
  } = options;

  const out: PlacementCandidate[] = [];

  for (const interval of free) {
    if (out.length >= limit) break;
    if (interval.end <= notBefore) continue;

    // Try the requested size first, then progressively smaller ones (§5.5).
    for (let n = Math.max(1, pomodoros); n >= 1; n -= 1) {
      const duration = sessionDurationMin(n, shape);
      let cursor = notBefore;

      // Within one interval, step forward past any time block the todo does
      // not match rather than abandoning the interval outright.
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const start = earliestStartIn(
          interval,
          duration,
          buffers,
          cursor,
          true,
          commute,
        );
        if (start === null) break;

        const candidate = { start, end: start + duration * MINUTE };
        if (satisfiesTimeBlocks(todo, candidate, timeBlocks)) {
          out.push({
            ...candidate,
            date: interval.date,
            pomodoros: n,
            interval,
          });
          break;
        }

        const blocking = timeBlocks
          .filter((b) => b.start < candidate.end && candidate.start < b.end)
          .sort((a, b) => a.end - b.end)[0];
        if (!blocking) break;
        cursor = blocking.end;
      }

      if (out.length > 0 && out[out.length - 1]!.interval === interval) break;
    }

    if (!onePerInterval && out.length < limit) continue;
  }

  return out.slice(0, limit);
}
