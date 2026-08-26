import type { IsoDate } from "@/lib/db/schema";
import { byStart } from "@/lib/scheduling/intervals";
import type {
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
  if (busy.source === "agenda" && busy.agendaId) {
    // The interval already spans core + buffers; each side presents the buffer
    // that faces outward from the agenda.
    const before: EdgeKind = {
      kind: "agenda",
      agendaId: busy.agendaId,
      buffer: busy.bufferBefore ?? { min: 0, type: "switch" },
    };
    const after: EdgeKind = {
      kind: "agenda",
      agendaId: busy.agendaId,
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
  options: { minimumMinutes?: number } = {},
): FreeInterval[] {
  const minMs = (options.minimumMinutes ?? 0) * 60_000;
  const blockers = busy.map(toBlocker).sort(byStart);
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
      });
    }
  }

  return out.sort(byStart);
}

/**
 * Removes a placed interval from the map, splitting the interval it landed in.
 * The allocator calls this after each placement (§5.5 Step 3: "update the
 * free-space map"), so later candidates see the space as taken.
 */
export function occupy(
  free: readonly FreeInterval[],
  placed: { start: number; end: number; edgeBefore: EdgeKind; edgeAfter: EdgeKind },
): FreeInterval[] {
  const out: FreeInterval[] = [];

  for (const interval of free) {
    if (placed.end <= interval.start || placed.start >= interval.end) {
      out.push(interval);
      continue;
    }

    if (placed.start > interval.start) {
      out.push({
        ...interval,
        end: placed.start,
        after: placed.edgeBefore,
      });
    }
    if (placed.end < interval.end) {
      out.push({
        ...interval,
        start: placed.end,
        before: placed.edgeAfter,
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
