import {
  MAX_POMODORO_PER_SESSION,
  MAX_SESSIONS_PER_TODO_PER_DAY,
  type IsoDate,
  type UUID,
} from "@/lib/db/schema";
import { edgePaddingMin } from "@/lib/scheduling/buffers";
import { occupy } from "@/lib/scheduling/freespace";
import { sessionDurationMin } from "@/lib/scheduling/session";
import { satisfiesTimeBlocks } from "@/lib/scheduling/timeblocks";
import type {
  DefaultBuffers,
  FreeInterval,
  SchedulableTodo,
  SessionShape,
  TimeBlockInstance,
} from "@/lib/scheduling/types";

/**
 * §5.5 — smart allocation. Deterministic greedy.
 *
 * The determinism matters: running it twice on the same inputs must produce
 * byte-identical output, or the draft preview would shuffle under the user
 * between renders. Every ordering is total (the `created_at` tiebreaker in
 * Step 2 is what makes it so) and no randomness is used anywhere.
 */

const MINUTE = 60_000;

export interface AllocationOptions {
  todos: readonly SchedulableTodo[];
  free: readonly FreeInterval[];
  timeBlocks: readonly TimeBlockInstance[];
  shape: SessionShape;
  buffers: DefaultBuffers;
  /** Never place anything before this instant (usually "now"). */
  notBefore?: number;
  /**
   * Latest end of an *already scheduled* agenda per todo id. Seeds the
   * parent-after-children rule with agendas that exist outside this run.
   */
  existingEndByTodo?: ReadonlyMap<UUID, number>;
  /** Generates the id for each draft agenda. */
  newId: () => UUID;
}

export interface DraftPlacement {
  id: UUID;
  todoId: UUID;
  date: IsoDate;
  start: number;
  end: number;
  pomodoros: number;
}

export interface UnfitTodo {
  todo: SchedulableTodo;
  /** Pomodoros that could not be placed anywhere in range. */
  remaining: number;
}

export interface AllocationResult {
  placements: DraftPlacement[];
  /** §5.5 Step 4 — "Never silently spill into the following week." */
  unfit: UnfitTodo[];
}

/**
 * The earliest instant a parent todo may start: after everything scheduled
 * beneath it, including agendas that already exist rather than only the ones
 * this run placed.
 *
 * Exported because the manual scheduling paths enforce the same rule — the
 * suggestion list and the drag confirmation both read it.
 */
export function earliestStartForParent(
  todoId: UUID,
  childEndsByParent: ReadonlyMap<UUID, number>,
): number {
  return childEndsByParent.get(todoId) ?? -Infinity;
}

/**
 * §5.5 Step 2 — the candidate order, strictly:
 *   1. dependencies satisfied (blocked todos are excluded entirely)
 *   2. earliest due_date first, nulls last
 *   3. highest priority first (P1 → P4)
 *   4. largest remaining_to_allocate first
 *   5. created_at ascending — the tiebreaker that guarantees determinism
 *
 * Ahead of all of it sits one structural rule: **a parent may not start before
 * its children**. Deeper todos are therefore considered first, so that by the
 * time a parent is placed, everything beneath it already has a home and the
 * parent's earliest legal start is known. Within a depth level the §5.5 order
 * is untouched.
 */
export function sortCandidates(
  todos: readonly SchedulableTodo[],
): SchedulableTodo[] {
  return todos
    .filter((todo) => !todo.blocked && todo.remainingToAllocate > 0)
    .slice()
    .sort((a, b) => {
      if (a.depth !== b.depth) return b.depth - a.depth;
      if (a.dueDate !== b.dueDate) {
        if (a.dueDate === null) return 1;
        if (b.dueDate === null) return -1;
        return a.dueDate < b.dueDate ? -1 : 1;
      }
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.remainingToAllocate !== b.remainingToAllocate) {
        return b.remainingToAllocate - a.remainingToAllocate;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      // Final guard: ids are unique, so the order is total even for rows that
      // were created inside the same millisecond.
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Tries to place one session of `pomodoros` for `todo` in the earliest free
 * interval that fits. Returns null when nothing in the map can take it.
 */
function placeOne(
  todo: SchedulableTodo,
  pomodoros: number,
  free: readonly FreeInterval[],
  timeBlocks: readonly TimeBlockInstance[],
  shape: SessionShape,
  buffers: DefaultBuffers,
  notBefore: number,
  perDay: Map<IsoDate, number>,
): { start: number; end: number; interval: FreeInterval } | null {
  const durationMs = sessionDurationMin(pomodoros, shape) * MINUTE;

  for (const interval of free) {
    // §5.5 Step 3: "Cap: at most 2 sessions for the same todo per day."
    if ((perDay.get(interval.date) ?? 0) >= MAX_SESSIONS_PER_TODO_PER_DAY) continue;
    if (interval.end <= notBefore) continue;

    const padStart = edgePaddingMin(interval.before, buffers.before) * MINUTE;
    const padEnd = edgePaddingMin(interval.after, buffers.after) * MINUTE;

    let cursor = Math.max(interval.start + padStart, notBefore);
    const limit = interval.end - padEnd;

    // Step forward past any time block this todo does not match, rather than
    // abandoning the whole interval (§5.4: the slot is only closed to
    // *non-matching* todos).
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const end = cursor + durationMs;
      if (end > limit) break;

      const candidate = { start: cursor, end };
      if (satisfiesTimeBlocks(todo, candidate, timeBlocks)) {
        return { ...candidate, interval };
      }

      const blocking = timeBlocks
        .filter((b) => b.start < end && cursor < b.end)
        .sort((a, b) => a.end - b.end)[0];
      if (!blocking) break;
      cursor = blocking.end;
    }
  }

  return null;
}

/**
 * Runs the whole greedy pass (§5.5 Steps 2–4).
 *
 * Placements are returned as *drafts*; promoting them to `planned` and writing
 * them to Google is Step 5's job, and belongs to the UI.
 */
export function allocate(options: AllocationOptions): AllocationResult {
  const {
    todos,
    timeBlocks,
    shape,
    buffers,
    notBefore = -Infinity,
    newId,
  } = options;

  let free: FreeInterval[] = [...options.free];
  const placements: DraftPlacement[] = [];
  const unfit: UnfitTodo[] = [];

  /**
   * Latest end scheduled for each todo, seeded with agendas that already exist
   * and updated as this run places more. `childEnds` rolls that up to parents.
   */
  const latestEnd = new Map<UUID, number>(options.existingEndByTodo ?? []);
  const childEnds = new Map<UUID, number>();

  const recordEnd = (todo: SchedulableTodo, end: number) => {
    latestEnd.set(todo.id, Math.max(latestEnd.get(todo.id) ?? -Infinity, end));
    if (todo.parentId) {
      childEnds.set(
        todo.parentId,
        Math.max(childEnds.get(todo.parentId) ?? -Infinity, end),
      );
    }
  };

  // Seed the roll-up from pre-existing agendas.
  for (const todo of todos) {
    const existing = options.existingEndByTodo?.get(todo.id);
    if (existing !== undefined && todo.parentId) {
      childEnds.set(
        todo.parentId,
        Math.max(childEnds.get(todo.parentId) ?? -Infinity, existing),
      );
    }
  }

  for (const todo of sortCandidates(todos)) {
    let remaining = todo.remainingToAllocate;
    const perDay = new Map<IsoDate, number>();

    // A parent never starts before its children have finished.
    const floor = Math.max(
      notBefore,
      earliestStartForParent(todo.id, childEnds),
    );

    while (remaining > 0) {
      // §5.5 Step 3: session size = min(remaining, 4), minimum 1.
      const desired = Math.min(remaining, MAX_POMODORO_PER_SESSION);

      let placed: { start: number; end: number; interval: FreeInterval } | null = null;
      let placedSize = 0;

      // "Try progressively smaller session sizes (4→3→2→1) before giving up."
      for (let size = desired; size >= 1; size -= 1) {
        placed = placeOne(
          todo,
          size,
          free,
          timeBlocks,
          shape,
          buffers,
          floor,
          perDay,
        );
        if (placed) {
          placedSize = size;
          break;
        }
      }

      if (!placed) break;

      const id = newId();
      placements.push({
        id,
        todoId: todo.id,
        date: placed.interval.date,
        start: placed.start,
        end: placed.end,
        pomodoros: placedSize,
      });

      perDay.set(placed.interval.date, (perDay.get(placed.interval.date) ?? 0) + 1);
      remaining -= placedSize;
      recordEnd(todo, placed.end);

      // §5.5 Step 3: "On placement … update the free-space map." The new draft
      // presents its own buffers to whatever is placed next to it.
      free = occupy(free, {
        start: placed.start,
        end: placed.end,
        agendaId: id,
        bufferBefore: buffers.before,
        bufferAfter: buffers.after,
      });
    }

    if (remaining > 0) unfit.push({ todo, remaining });
  }

  // Chronological output makes the draft preview readable and the result
  // stable regardless of the order candidates were considered in.
  placements.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  return { placements, unfit };
}
