import type { Agenda, PomodoroLog, Todo, UUID } from "@/lib/db/schema";

/**
 * §4.2 "Derived (computed, not stored)".
 *
 *   allocated_pomodoro   = Σ allocated across the todo's non-deleted agendas
 *   used_pomodoro        = count of completed focus logs across those agendas
 *   remaining_to_allocate = estimated − allocated
 *
 * Computed in one pass over the whole working set so a list of 500 todos does
 * not become quadratic.
 */

export interface TodoCounters {
  allocated: number;
  used: number;
  remainingToAllocate: number;
  /** Focus logs beyond the agenda's allocation (§5.6). */
  overtime: number;
  /** Non-deleted agendas whose end is still in the future. */
  futureAgendas: number;
  agendaCount: number;
}

export const EMPTY_COUNTERS: TodoCounters = {
  allocated: 0,
  used: 0,
  remainingToAllocate: 0,
  overtime: 0,
  futureAgendas: 0,
  agendaCount: 0,
};

/**
 * Only completed focus sessions count as used (§4.4, §5.6).
 *
 * `ended_at` is part of the test on purpose: a session still running has a row
 * but no end, and counting it would let the progress ring and the streak claim
 * a pomodoro the user has not finished.
 */
export function countsAsUsed(log: PomodoroLog): boolean {
  return (
    log.type === "focus" &&
    log.outcome === "completed" &&
    log.ended_at !== null &&
    !log.deleted_at
  );
}

export function computeCounters(
  todos: readonly Todo[],
  agendas: readonly Agenda[],
  logs: readonly PomodoroLog[],
  now: Date = new Date(),
): Map<UUID, TodoCounters> {
  const result = new Map<UUID, TodoCounters>();
  for (const todo of todos) {
    result.set(todo.id, { ...EMPTY_COUNTERS });
  }

  const agendaToTodo = new Map<UUID, UUID>();
  const nowMs = now.getTime();

  for (const agenda of agendas) {
    if (agenda.deleted_at) continue;
    // Cancelled agendas hold no claim on the estimate.
    if (agenda.status === "cancelled") continue;

    agendaToTodo.set(agenda.id, agenda.todo_id);
    const counters = result.get(agenda.todo_id);
    if (!counters) continue;

    counters.allocated += agenda.allocated_pomodoro;
    counters.agendaCount += 1;
    if (new Date(agenda.end_at).getTime() > nowMs) counters.futureAgendas += 1;
  }

  for (const log of logs) {
    if (!countsAsUsed(log)) continue;
    const todoId = log.todo_id ?? (log.agenda_id ? agendaToTodo.get(log.agenda_id) : undefined);
    if (!todoId) continue;
    const counters = result.get(todoId);
    if (!counters) continue;
    counters.used += 1;
    if (log.is_overtime) counters.overtime += 1;
  }

  for (const todo of todos) {
    const counters = result.get(todo.id)!;
    counters.remainingToAllocate = Math.max(
      0,
      todo.estimated_pomodoro - counters.allocated,
    );
  }

  return result;
}

export function countersFor(
  map: Map<UUID, TodoCounters>,
  todoId: UUID,
): TodoCounters {
  return map.get(todoId) ?? EMPTY_COUNTERS;
}

/** Pomodoro dot symbols for one agenda (§5.7). */
export type PomodoroDot = "empty" | "filled" | "running" | "overtime";

export function agendaDots(
  allocated: number,
  completed: number,
  running: boolean,
): PomodoroDot[] {
  const dots: PomodoroDot[] = [];
  const withinAllocation = Math.min(completed, allocated);

  for (let i = 0; i < withinAllocation; i += 1) dots.push("filled");

  // Anything completed past the allocation is overtime and keeps its own accent.
  for (let i = allocated; i < completed; i += 1) dots.push("overtime");

  if (running) dots.push(completed >= allocated ? "overtime" : "running");

  const placed = dots.length;
  for (let i = placed; i < allocated; i += 1) dots.push("empty");

  return dots;
}
