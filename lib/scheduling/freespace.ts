import type { IsoDate, UUID } from "@/lib/db/schema";
import type { CommuteStop } from "@/lib/scheduling/commute";
import { byStart } from "@/lib/scheduling/intervals";
import type {
  BufferSide,
  BusyInterval,
  EdgeKind,
  FreeInterval,
  WindowInstance,
} from "@/lib/scheduling/types";

/**
 * §5.5 Step 1 — the free-space map.
 *
 * "For each day in range: start with the availability windows, then subtract
 * prayer blocks, existing non-draft agendas *with their buffers*, and
 * gcal_busy_cache intervals. Result: a list of free intervals per day."
 *
 * Each resulting interval records what sits on either side of it. That is what
 * lets the placement check apply §5.2's typed-buffer rule correctly: an
 * agenda's own buffer is already carved out here, so a candidate owes only the
 * shortfall between that and the composed `required_gap` (see `buffers.ts`).
 */

/** An obstacle to subtract, carrying the edge it presents to either side. */
interface Blocker {
  start: number;
  end: number;
  /** Edge shown to free space that *ends* where this blocker starts. */
  edgeBefore: EdgeKind;
  /** Edge shown to free space that *starts* where this blocker ends. */
  edgeAfter: EdgeKind;
}

function toBlocker(busy: BusyInterval): Blocker {
  const ownerId = busy.ownerId ?? busy.agendaId;
  if ((busy.source === "agenda" || busy.source === "event") && ownerId) {
    // The interval already spans core + buffers; each side presents the buffer
    // that faces outward from the block. An event composes exactly like an
    // agenda — §5.2 is about two buffered things meeting, not about todos.
    const before: EdgeKind = {
      kind: "buffered",
      owner: busy.source,
      ownerId,
      buffer: busy.bufferBefore ?? { min: 0, type: "switch" },
    };
    const after: EdgeKind = {
      kind: "buffered",
      owner: busy.source,
      ownerId,
      buffer: busy.bufferAfter ?? { min: 0, type: "switch" },
    };
    return { start: busy.start, end: busy.end, edgeBefore: before, edgeAfter: after };
  }

  const obstacle: EdgeKind = {
    kind: "obstacle",
    obstacle: busy.source === "prayer" ? "prayer" : "gcal_busy",
  };
  return {
    start: busy.start,
    end: busy.end,
    edgeBefore: obstacle,
    edgeAfter: obstacle,
  };
}

const WINDOW_EDGE: EdgeKind = { kind: "window" };

export interface FreeSpaceOptions {
  minimumMinutes?: number;
  /**
   * Where each day begins, for `FreeInterval.originPlaceId`. Omit and every
   * interval reports `null`, i.e. no journey is ever charged — which is exactly
   * the behaviour before places existed.
   */
  homePlaceId?: UUID | null;
  /**
   * The day's committed blocks, in the same shape the commute reconciler folds
   * over. Passing the *same* stops is what keeps the space the suggester
   * reserves identical to the buffer the row is later given.
   */
  stops?: readonly CommuteStop[];
}

/**
 * Subtracts every blocker from every window and returns the surviving gaps.
 *
 * Blockers may overlap each other and may extend past the window; both are
 * normal (a buffer legitimately spills past the window edge, §5.2). The sweep
 * therefore tracks a running cursor rather than assuming disjoint inputs.
 */
export function buildFreeSpace(
  windows: readonly WindowInstance[],
  busy: readonly BusyInterval[],
  options: FreeSpaceOptions = {},
): FreeInterval[] {
  const minMs = (options.minimumMinutes ?? 0) * 60_000;
  const blockers = busy.map(toBlocker).sort(byStart);
  const home = options.homePlaceId ?? null;

  // Grouped by date and ordered, so the origin lookup is the same fold as
  // `resolveCommute`: walk the day from home, and only a stop with a known
  // location moves you.
  const stopsByDate = new Map<IsoDate, CommuteStop[]>();
  for (const stop of options.stops ?? []) {
    if (!stop.placeId) continue;
    const bucket = stopsByDate.get(stop.date);
    if (bucket) bucket.push(stop);
    else stopsByDate.set(stop.date, [stop]);
  }
  for (const bucket of stopsByDate.values()) bucket.sort((a, b) => a.start - b.start);

  const originAt = (date: IsoDate, instant: number): UUID | null => {
    let last = home;
    for (const stop of stopsByDate.get(date) ?? []) {
      if (stop.start > instant) break;
      last = stop.placeId;
    }
    return last;
  };

  const out: FreeInterval[] = [];

  for (const window of [...windows].sort(byStart)) {
    let cursor = window.start;
    let leadingEdge: EdgeKind = WINDOW_EDGE;

    for (const blocker of blockers) {
      if (blocker.end <= cursor) continue;
      if (blocker.start >= window.end) break;

      if (blocker.start > cursor) {
        const end = Math.min(blocker.start, window.end);
        if (end - cursor >= minMs && end > cursor) {
          out.push({
            date: window.date,
            start: cursor,
            end,
            before: leadingEdge,
            after: blocker.edgeBefore,
            originPlaceId: originAt(window.date, cursor),
          });
        }
      }

      if (blocker.end > cursor) {
        cursor = blocker.end;
        leadingEdge = blocker.edgeAfter;
      }
      if (cursor >= window.end) break;
    }

    if (cursor < window.end && window.end - cursor >= minMs) {
      out.push({
        date: window.date,
        start: cursor,
        end: window.end,
        before: leadingEdge,
        after: WINDOW_EDGE,
        originPlaceId: originAt(window.date, cursor),
      });
    }
  }

  return out.sort(byStart);
}

export interface Placement {
  /** Core start of the placed agenda, without buffers. */
  start: number;
  /** Core end of the placed agenda, without buffers. */
  end: number;
  agendaId: UUID;
  bufferBefore: BufferSide;
  bufferAfter: BufferSide;
  /** Where the placement happens, if anywhere. It becomes the new origin. */
  placeId?: UUID | null;
}

/**
 * Removes a placed agenda from the map, splitting the interval it landed in.
 * The allocator calls this after each placement (§5.5 Step 3: "update the
 * free-space map"), so later candidates see the space as taken.
 *
 * The removed span is the agenda's *footprint* — core plus both buffers —
 * exactly as `buildFreeSpace` treats an existing agenda. Removing only the core
 * would leave the surviving edges claiming a buffer that was never carved out,
 * and the next placement would butt straight up against this one.
 */
export function occupy(
  free: readonly FreeInterval[],
  placed: Placement,
): FreeInterval[] {
  const footprintStart = placed.start - placed.bufferBefore.min * 60_000;
  const footprintEnd = placed.end + placed.bufferAfter.min * 60_000;

  const edgeBefore: EdgeKind = {
    kind: "buffered",
    owner: "agenda",
    ownerId: placed.agendaId,
    buffer: placed.bufferBefore,
  };
  const edgeAfter: EdgeKind = {
    kind: "buffered",
    owner: "agenda",
    ownerId: placed.agendaId,
    buffer: placed.bufferAfter,
  };

  const out: FreeInterval[] = [];

  for (const interval of free) {
    if (footprintEnd <= interval.start || footprintStart >= interval.end) {
      out.push(interval);
      continue;
    }

    if (footprintStart > interval.start) {
      out.push({ ...interval, end: footprintStart, after: edgeBefore });
    }
    if (footprintEnd < interval.end) {
      out.push({
        ...interval,
        start: footprintEnd,
        before: edgeAfter,
        // Placing something somewhere puts you there: what follows is reached
        // from the placement, not from wherever the interval used to start.
        originPlaceId: placed.placeId ?? interval.originPlaceId,
      });
    }
  }

  return out.sort(byStart);
}

/** Groups free intervals by their local date, preserving chronological order. */
export function freeByDate(
  free: readonly FreeInterval[],
): Map<IsoDate, FreeInterval[]> {
  const map = new Map<IsoDate, FreeInterval[]>();
  for (const interval of free) {
    const bucket = map.get(interval.date);
    if (bucket) bucket.push(interval);
    else map.set(interval.date, [interval]);
  }
  return map;
}

/** Total free minutes — the net figure behind the capacity meter (§7.3). */
export function freeMinutes(free: readonly FreeInterval[]): number {
  return free.reduce((sum, i) => sum + (i.end - i.start) / 60_000, 0);
}
