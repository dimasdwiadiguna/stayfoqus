import { createAgenda } from "@/lib/agendas/repo";
import { newId } from "@/lib/db/mutations";
import type { Agenda, Place, Settings, Todo, UUID } from "@/lib/db/schema";
import {
  allocate,
  toSchedulable,
  type AllocationResult,
  type SchedulingWorld,
} from "@/lib/scheduling";
import { countersFor, type TodoCounters } from "@/lib/todos/derived";
import { depthOf, isBlocked, type TodoIndex } from "@/lib/todos/tree";

export interface AllocateDayInput {
  /** The todos the user picked. Only their unallocated remainder is placed. */
  picked: readonly Todo[];
  index: TodoIndex;
  counters: Map<UUID, TodoCounters>;
  /** Every agenda, not just the day's — the parent-ordering floor needs them. */
  agendas: readonly Agenda[];
  world: SchedulingWorld;
  places: ReadonlyMap<UUID, Place>;
  settings: Settings;
  now: number | null;
}

/**
 * Smart allocation for a single day, and the drafts it produces (§5.5).
 *
 * Two screens ask for this — the Hari Ini list and the planning wizard — and a
 * second copy of it is exactly how the two would come to disagree about
 * buffers or about the parent-ordering floor. The scheduling rules themselves
 * stay where they belong, in the pure module; this only assembles the call and
 * writes the drafts.
 */
export async function allocateDay(
  input: AllocateDayInput,
): Promise<AllocationResult> {
  const { picked, index, counters, agendas, world, places, settings, now } = input;

  const schedulable = picked.map((todo) =>
    toSchedulable(
      todo,
      countersFor(counters, todo.id).remainingToAllocate,
      isBlocked(index, todo),
      depthOf(index, todo.id),
    ),
  );

  // A parent must not start before its children — including children whose
  // agendas already exist outside this run (D-081).
  const existingEndByTodo = new Map<string, number>();
  for (const agenda of agendas) {
    if (agenda.status === "cancelled") continue;
    const end = new Date(agenda.end_at).getTime();
    existingEndByTodo.set(
      agenda.todo_id,
      Math.max(existingEndByTodo.get(agenda.todo_id) ?? -Infinity, end),
    );
  }

  const result = allocate({
    todos: schedulable,
    free: world.free,
    timeBlocks: world.timeBlocks,
    shape: world.shape,
    buffers: world.buffers,
    notBefore: now ?? undefined,
    existingEndByTodo,
    // Without these the allocator reserves the default buffer and the
    // reconciler then widens it, so drafts placed back to back would overlap
    // the moment they were applied.
    places,
    commuteSpeedKmh: settings.commute_speed_kmh,
    newId,
  });

  // §5.5 Step 5: everything lands as a draft, previewed on the calendar.
  for (const placement of result.placements) {
    await createAgenda(
      {
        id: placement.id,
        todo_id: placement.todoId,
        start_at: new Date(placement.start).toISOString(),
        end_at: new Date(placement.end).toISOString(),
        allocated_pomodoro: placement.pomodoros,
        status: "draft",
      },
      settings,
    );
  }

  return result;
}

/** True when nothing in the selection has anything left to place. */
export function nothingToAllocate(
  picked: readonly Todo[],
  counters: Map<UUID, TodoCounters>,
): boolean {
  return picked.every(
    (todo) => countersFor(counters, todo.id).remainingToAllocate === 0,
  );
}
