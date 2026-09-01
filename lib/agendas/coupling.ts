import type { Agenda, PomodoroLog, Todo, UUID } from "@/lib/db/schema";
import { countsAsUsed } from "@/lib/todos/derived";

/**
 * §5.9 — agenda ↔ todo status coupling. Pure, so the rule is testable.
 *
 * "Completing an agenda does **not** auto-complete its todo. But: when an
 * agenda is completed and that todo has no remaining allocation and no future
 * agendas, prompt once: *'Todo [judul] sudah selesai?'*"
 */
export function shouldPromptTodoDone(input: {
  todo: Todo;
  /** Every non-deleted agenda for this todo. */
  agendas: readonly Agenda[];
  /** Every non-deleted pomodoro log for this todo's agendas. */
  logs: readonly PomodoroLog[];
  now: number;
}): boolean {
  const { todo, agendas, logs, now } = input;

  if (todo.status === "done" || todo.status === "archived") return false;
  if (todo.deleted_at) return false;

  const live = agendas.filter((a) => !a.deleted_at && a.status !== "cancelled");
  if (live.length === 0) return false;

  // At least one agenda must have just been resolved, or there is nothing to
  // prompt about.
  const resolved = live.some((a) => a.status === "done" || a.status === "partial");
  if (!resolved) return false;

  // "no future agendas"
  const hasFuture = live.some(
    (a) =>
      new Date(a.end_at).getTime() > now &&
      (a.status === "planned" || a.status === "draft"),
  );
  if (hasFuture) return false;

  // Nothing still awaiting review either — a missed agenda is not "finished".
  const hasUnreviewed = live.some((a) => a.status === "planned" || a.status === "missed");
  if (hasUnreviewed) return false;

  // "no remaining allocation": every pomodoro the user allocated has been used.
  const allocated = live.reduce((sum, a) => sum + a.allocated_pomodoro, 0);
  const used = logs.filter(countsAsUsed).length;
  if (used < allocated) return false;

  // And the estimate itself must be covered, or there is work left to schedule.
  return allocated >= todo.estimated_pomodoro;
}

/**
 * The other direction: the agendas say the todo is finished.
 *
 * §5.9 is explicit that "completing an agenda does not auto-complete its todo",
 * and offers a one-tap prompt instead. Requested change (D-094): when *every*
 * agenda a todo has is marked done, the todo is done too — there is nothing
 * left the prompt could usefully ask. The answer is written rather than
 * requested, and made reversible with an undo toast instead.
 *
 * Three things this deliberately does not treat as finished:
 *
 * - a `partial` agenda — the work was explicitly reported as unfinished;
 * - a `draft` — it was never a commitment, so it neither blocks nor completes;
 * - a todo whose `estimated_pomodoro` exceeds what its agendas allocate. That
 *   is D-070's third clarification, and it still holds: a todo estimated at 6
 *   with 2 scheduled has four pomodoros of work nobody has planned yet, and
 *   declaring it done because those 2 ran would be wrong.
 */
export function agendasImplyTodoDone(input: {
  todo: Todo;
  /** Every non-deleted agenda for this todo. */
  agendas: readonly Agenda[];
}): boolean {
  const { todo, agendas } = input;

  if (todo.status === "done" || todo.status === "archived") return false;
  if (todo.deleted_at) return false;

  const live = agendas.filter(
    (a) => !a.deleted_at && a.status !== "cancelled" && a.status !== "draft",
  );
  if (live.length === 0) return false;
  if (!live.every((a) => a.status === "done")) return false;

  const allocated = live.reduce((sum, a) => sum + a.allocated_pomodoro, 0);
  return allocated >= todo.estimated_pomodoro;
}

/** §9 — "all of today's agendas have been reviewed". */
export function isDayCleared(
  agendasToday: readonly Agenda[],
): boolean {
  const live = agendasToday.filter(
    (a) => !a.deleted_at && a.status !== "cancelled" && a.status !== "draft",
  );
  if (live.length === 0) return false;
  return live.every(
    (a) => a.status === "done" || a.status === "partial",
  );
}

export interface DaySummary {
  pomodoroTotal: number;
  topCategoryId: UUID | null;
  agendaCount: number;
}

/** Numbers for the "Hari Selesai" screen (§9). */
export function summariseDay(
  agendasToday: readonly Agenda[],
  logsToday: readonly PomodoroLog[],
  todosById: Map<UUID, Todo>,
): DaySummary {
  const pomodoroTotal = logsToday.filter(countsAsUsed).length;

  const perCategory = new Map<UUID, number>();
  for (const agenda of agendasToday) {
    const todo = todosById.get(agenda.todo_id);
    if (!todo?.category_id) continue;
    perCategory.set(
      todo.category_id,
      (perCategory.get(todo.category_id) ?? 0) + agenda.allocated_pomodoro,
    );
  }

  let topCategoryId: UUID | null = null;
  let best = 0;
  for (const [categoryId, count] of perCategory) {
    if (count > best) {
      best = count;
      topCategoryId = categoryId;
    }
  }

  return {
    pomodoroTotal,
    topCategoryId,
    agendaCount: agendasToday.filter((a) => !a.deleted_at).length,
  };
}
