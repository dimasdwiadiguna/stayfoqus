import type { Agenda, IsoDate, PomodoroLog, Todo, UUID } from "@/lib/db/schema";
import { countsAsUsed } from "@/lib/todos/derived";

/**
 * Recording the pomodoros a todo actually took, at the moment it is completed.
 *
 * Not in the brief. §4.4 assumes every pomodoro arrives through the timer, and
 * §5.8 only back-fills them when reviewing a *missed agenda*. But work
 * routinely gets done away from the app — on paper, in a meeting, before the
 * todo was ever scheduled — and completing it then left today's counters
 * claiming nothing had happened.
 *
 * Asking on completion closes that gap. The requirement is that the answer
 * moves **both** of today's numbers: completed *and* planned. That is what
 * makes this more than writing logs — a log alone raises "used" and leaves the
 * progress ring reading 3/0, which is worse than not asking.
 *
 * So the plan below always ensures there is an agenda *today* whose allocation
 * covers the reported total, and attaches the logs to it. Pure, so the
 * arithmetic is testable without a database.
 */

export interface CompletionPlanInput {
  todo: Todo;
  /** Every non-deleted agenda belonging to this todo. */
  agendas: readonly Agenda[];
  /** Every non-deleted pomodoro log for those agendas, or for the todo. */
  logs: readonly PomodoroLog[];
  /** How many pomodoros the user says the todo took, in total. */
  reported: number;
  /** Today, in the user's timezone. */
  today: IsoDate;
  /** Maps an instant to the user's local date. Injected to stay pure. */
  toLocalDate: (instant: string) => IsoDate;
  now: number;
}

export interface CompletionPlan {
  /** Completed focus logs to write, all dated today. */
  logsToAdd: number;
  /**
   * An existing agenda today to raise the allocation of, so today's *planned*
   * count covers the reported work.
   */
  topUpAgendaId: UUID | null;
  topUpAllocatedTo: number;
  /** When no agenda exists today, create one covering the reported work. */
  createAgenda: { allocated: number } | null;
  /** Already-logged pomodoros for this todo today — shown as context. */
  alreadyToday: number;
}

/** Pomodoros already credited to this todo, today. */
export function completedTodayFor(
  input: Pick<CompletionPlanInput, "todo" | "agendas" | "logs" | "today" | "toLocalDate">,
): number {
  const agendaIds = new Set(
    input.agendas.filter((a) => !a.deleted_at).map((a) => a.id),
  );

  return input.logs.filter((log) => {
    if (!countsAsUsed(log)) return false;
    const mine =
      log.todo_id === input.todo.id ||
      (log.agenda_id !== null && agendaIds.has(log.agenda_id));
    if (!mine) return false;
    return input.toLocalDate(log.started_at) === input.today;
  }).length;
}

/**
 * A sensible pre-fill for the prompt.
 *
 * If the timer already ran for this todo, that count is the honest answer and
 * the user only adjusts it. Otherwise fall back to the estimate — the number
 * they themselves put on the work.
 */
export function suggestedReported(
  input: Pick<CompletionPlanInput, "todo" | "agendas" | "logs">,
): number {
  const agendaIds = new Set(
    input.agendas.filter((a) => !a.deleted_at).map((a) => a.id),
  );
  const logged = input.logs.filter(
    (log) =>
      countsAsUsed(log) &&
      (log.todo_id === input.todo.id ||
        (log.agenda_id !== null && agendaIds.has(log.agenda_id))),
  ).length;

  return logged > 0 ? logged : Math.max(0, input.todo.estimated_pomodoro);
}

export function planCompletion(input: CompletionPlanInput): CompletionPlan {
  const reported = Math.max(0, Math.floor(input.reported));
  const alreadyToday = completedTodayFor(input);

  // Only the shortfall is written. Re-completing a todo, or completing one the
  // timer already tracked, must not double-count.
  const logsToAdd = Math.max(0, reported - alreadyToday);

  const live = input.agendas.filter(
    (a) => !a.deleted_at && a.status !== "cancelled" && a.status !== "draft",
  );
  const todays = live.filter((a) => input.toLocalDate(a.start_at) === input.today);

  // Today's planned count must cover today's completed count, or the progress
  // ring would read more used than allocated.
  const neededAllocation = alreadyToday + logsToAdd;

  if (todays.length === 0) {
    return {
      logsToAdd,
      topUpAgendaId: null,
      topUpAllocatedTo: 0,
      createAgenda: neededAllocation > 0 ? { allocated: neededAllocation } : null,
      alreadyToday,
    };
  }

  const allocatedToday = todays.reduce((sum, a) => sum + a.allocated_pomodoro, 0);
  if (allocatedToday >= neededAllocation) {
    return {
      logsToAdd,
      topUpAgendaId: null,
      topUpAllocatedTo: 0,
      createAgenda: null,
      alreadyToday,
    };
  }

  // Raise the last agenda of the day rather than adding another block: the work
  // happened, the calendar should not gain an entry the user never scheduled.
  const target = todays.reduce((latest, a) =>
    a.start_at > latest.start_at ? a : latest,
  );
  const others = allocatedToday - target.allocated_pomodoro;

  return {
    logsToAdd,
    topUpAgendaId: target.id,
    topUpAllocatedTo: Math.max(
      target.allocated_pomodoro,
      neededAllocation - others,
    ),
    createAgenda: null,
    alreadyToday,
  };
}
