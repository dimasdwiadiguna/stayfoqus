import type { Agenda, Todo, UUID } from "@/lib/db/schema";
import { childrenOf, descendantsOf, type TodoIndex } from "@/lib/todos/tree";

/**
 * A parent todo may not start before its children.
 *
 * The scheduler enforces this structurally (deeper todos are placed first, and
 * a parent's floor is its last child's end — see `lib/scheduling/allocate.ts`).
 * Manual scheduling needs the same answer from the other direction: given a
 * todo, what is the earliest instant it may legally start?
 *
 * Pure, so both the suggestion list and the drag check read one rule.
 */

/** Latest end among a todo's descendants' live agendas, or -Infinity. */
export function earliestStartFor(
  index: TodoIndex,
  todoId: UUID,
  agendas: readonly Agenda[],
): number {
  const descendants = descendantsOf(index, todoId);
  if (descendants.length === 0) return -Infinity;

  const ids = new Set(descendants.map((d) => d.id));
  let latest = -Infinity;

  for (const agenda of agendas) {
    if (agenda.deleted_at) continue;
    if (agenda.status === "cancelled") continue;
    if (!ids.has(agenda.todo_id)) continue;
    latest = Math.max(latest, new Date(agenda.end_at).getTime());
  }
  return latest;
}

/**
 * The descendants whose agendas would end after `start` — i.e. the reason a
 * placement is illegal. Named so the message can list them.
 */
export function childrenBlockingStart(
  index: TodoIndex,
  todoId: UUID,
  agendas: readonly Agenda[],
  start: number,
): Todo[] {
  const descendants = descendantsOf(index, todoId);
  const byId = new Map(descendants.map((d) => [d.id, d]));
  const offenders = new Map<UUID, Todo>();

  for (const agenda of agendas) {
    if (agenda.deleted_at || agenda.status === "cancelled") continue;
    const child = byId.get(agenda.todo_id);
    if (!child) continue;
    if (new Date(agenda.end_at).getTime() > start) offenders.set(child.id, child);
  }
  return [...offenders.values()];
}

/** True when the todo has children at all — cheap pre-check for the UI. */
export function hasChildren(index: TodoIndex, todoId: UUID): boolean {
  return childrenOf(index, todoId).length > 0;
}
