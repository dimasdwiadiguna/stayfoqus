"use client";

import { getDb } from "@/lib/db/client";
import {
  createRow,
  nowIso,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "@/lib/db/mutations";
import type {
  Agenda,
  IsoDate,
  IsoWeek,
  Priority,
  Todo,
  TodoStatus,
  UUID,
} from "@/lib/db/schema";
import { buildTodoIndex, canNest, descendantsOf, findDependencyCycle } from "@/lib/todos/tree";
import { planCompletion, suggestedReported } from "@/lib/todos/completion";
import { localDate } from "@/lib/time";

export interface NewTodoInput {
  title: string;
  notes?: string | null;
  category_id?: UUID | null;
  priority?: Priority;
  tags?: string[];
  due_date?: IsoDate | null;
  estimated_pomodoro?: number;
  parent_id?: UUID | null;
  focus_week?: IsoWeek | null;
  status?: TodoStatus;
}

/**
 * IndexedDB cannot index `null`, so root-level siblings (`parent_id === null`)
 * are never reachable through the `parent_id` index and must be filtered in
 * memory. Nested siblings still use the index.
 */
async function siblingsOf(parentId: UUID | null): Promise<Todo[]> {
  const db = getDb();
  const rows =
    parentId === null
      ? (await db.todos.toArray()).filter((t) => !t.parent_id)
      : await db.todos.where("parent_id").equals(parentId).toArray();
  return rows.filter((t) => !t.deleted_at);
}

async function nextSortOrder(parentId: UUID | null): Promise<number> {
  const live = await siblingsOf(parentId);
  return live.length ? Math.max(...live.map((t) => t.sort_order)) + 1 : 0;
}

export async function createTodo(input: NewTodoInput): Promise<Todo> {
  return createRow("todos", {
    title: input.title.trim(),
    notes: input.notes ?? null,
    category_id: input.category_id ?? null,
    priority: input.priority ?? 4,
    tags: input.tags ?? [],
    due_date: input.due_date ?? null,
    estimated_pomodoro: Math.max(1, input.estimated_pomodoro ?? 1),
    parent_id: input.parent_id ?? null,
    blocked_by: [],
    status: input.status ?? "inbox",
    completed_at: null,
    focus_week: input.focus_week ?? null,
    sort_order: await nextSortOrder(input.parent_id ?? null),
  });
}

export type SaveDependenciesResult =
  | { ok: true }
  | { ok: false; cycle: Todo[] };

/**
 * §4.2: "Prevent cycles: validate on save, reject with a message naming the
 * cycle." Validation happens here rather than in the sheet so every caller —
 * detail sheet, quick edit, future import — is covered by the same check.
 */
export async function setDependencies(
  todoId: UUID,
  blockedBy: UUID[],
): Promise<SaveDependenciesResult> {
  const all = await getDb().todos.toArray();
  const index = buildTodoIndex(all.filter((t) => !t.deleted_at));
  const cycle = findDependencyCycle(index, todoId, blockedBy);
  if (cycle) return { ok: false, cycle };
  await updateRow("todos", todoId, { blocked_by: blockedBy });
  return { ok: true };
}

export async function updateTodo(
  todoId: UUID,
  patch: Partial<Omit<Todo, "id" | "user_id" | "created_at" | "updated_at" | "deleted_at" | "dirty">>,
) {
  return updateRow("todos", todoId, patch);
}

export type ReparentResult = { ok: true } | { ok: false; reason: string };

export async function reparentTodo(
  todoId: UUID,
  parentId: UUID | null,
  sortOrder?: number,
): Promise<ReparentResult> {
  const all = (await getDb().todos.toArray()).filter((t) => !t.deleted_at);
  const index = buildTodoIndex(all);
  const check = canNest(index, todoId, parentId);
  if (!check.ok) return { ok: false, reason: check.reason };
  await updateRow("todos", todoId, {
    parent_id: parentId,
    sort_order: sortOrder ?? (await nextSortOrder(parentId)),
  });
  return { ok: true };
}

/** Persists a new sibling ordering after a drag-reorder (§8). */
export async function reorderSiblings(orderedIds: UUID[]): Promise<void> {
  const db = getDb();
  for (const [i, todoId] of orderedIds.entries()) {
    const row = await db.todos.get(todoId);
    if (!row || row.sort_order === i) continue;
    await updateRow("todos", todoId, { sort_order: i });
  }
}

/* ------------------------------------------------------------------ */
/* completion                                                          */
/* ------------------------------------------------------------------ */

export interface CompleteTodoOptions {
  /** §5.9: also remove the todo's future `planned` agendas. */
  removeFutureAgendas?: boolean;
}

export async function completeTodo(
  todoId: UUID,
  options: CompleteTodoOptions = {},
): Promise<void> {
  const db = getDb();
  const futureAgendas = options.removeFutureAgendas
    ? (await db.agendas.where("todo_id").equals(todoId).toArray()).filter(
        (a) => !a.deleted_at && a.status === "planned" && new Date(a.end_at) > new Date(),
      )
    : [];

  await updateRow("todos", todoId, {
    status: "done",
    completed_at: nowIso(),
  });

  for (const agenda of futureAgendas) {
    await softDeleteRow("agendas", agenda.id);
  }
}

export async function uncompleteTodo(todoId: UUID): Promise<void> {
  await updateRow("todos", todoId, { status: "active", completed_at: null });
}

/** Everything the completion prompt needs to open with a sensible number. */
export async function completionContext(todoId: UUID): Promise<{
  suggested: number;
  alreadyToday: number;
} | null> {
  const db = getDb();
  const todo = await db.todos.get(todoId);
  if (!todo) return null;

  const agendas = (await db.agendas.where("todo_id").equals(todoId).toArray()).filter(
    (a) => !a.deleted_at,
  );
  const logs = await logsForTodo(todoId, agendas.map((a) => a.id));

  const settings = await db.settings.toArray();
  const timezone = settings[0]?.timezone ?? "Asia/Jakarta";
  const today = localDate(new Date(), timezone);

  const plan = planCompletion({
    todo,
    agendas,
    logs,
    reported: 0,
    today,
    toLocalDate: (instant) => localDate(instant, timezone),
    now: Date.now(),
  });

  return {
    suggested: suggestedReported({ todo, agendas, logs }),
    alreadyToday: plan.alreadyToday,
  };
}

async function logsForTodo(todoId: UUID, agendaIds: UUID[]) {
  const db = getDb();
  const all = await db.pomodoro_logs.toArray();
  const ids = new Set(agendaIds);
  return all.filter(
    (log) =>
      !log.deleted_at &&
      (log.todo_id === todoId || (log.agenda_id !== null && ids.has(log.agenda_id))),
  );
}

/**
 * Completes a todo and records how many pomodoros it actually took.
 *
 * The reported number has to move *both* of today's figures — completed and
 * planned — so the plan may create or top up an agenda for today as well as
 * writing the logs. See `lib/todos/completion.ts` for why.
 */
export async function completeTodoWithPomodoro(
  todoId: UUID,
  reported: number,
  options: CompleteTodoOptions = {},
): Promise<void> {
  const db = getDb();
  const todo = await db.todos.get(todoId);
  if (!todo) return;

  const settingsRow = (await db.settings.toArray())[0];
  const timezone = settingsRow?.timezone ?? "Asia/Jakarta";
  const focusMin = settingsRow?.pomodoro_focus_min ?? 25;
  const shortBreakMin = settingsRow?.pomodoro_short_break_min ?? 5;

  const agendas = (await db.agendas.where("todo_id").equals(todoId).toArray()).filter(
    (a) => !a.deleted_at,
  );
  const logs = await logsForTodo(todoId, agendas.map((a) => a.id));
  const now = Date.now();
  const today = localDate(new Date(now), timezone);

  const plan = planCompletion({
    todo,
    agendas,
    logs,
    reported,
    today,
    toLocalDate: (instant) => localDate(instant, timezone),
    now,
  });

  let targetAgendaId: UUID | null = plan.topUpAgendaId;

  if (plan.createAgenda) {
    // Placed so it *ends* now: the work is finished, and an agenda running into
    // the future would immediately look like something still to do.
    const n = plan.createAgenda.allocated;
    const durationMs = (n * focusMin + Math.max(0, n - 1) * shortBreakMin) * 60_000;
    const created = await createRow("agendas", {
      todo_id: todoId,
      title_override: null,
      start_at: new Date(now - durationMs).toISOString(),
      end_at: new Date(now).toISOString(),
      allocated_pomodoro: n,
      buffer_before_min: 0,
      buffer_before_type: "switch",
      buffer_after_min: 0,
      buffer_after_type: "switch",
      status: "done",
      outside_window: false,
      gcal_event_id: null,
      gcal_synced_at: null,
      gcal_conflict: false,
    });
    targetAgendaId = created.id;
  } else if (plan.topUpAgendaId) {
    await updateRow("agendas", plan.topUpAgendaId, {
      allocated_pomodoro: plan.topUpAllocatedTo,
    });
  } else {
    targetAgendaId =
      agendas
        .filter(
          (a) =>
            a.status !== "cancelled" &&
            a.status !== "draft" &&
            localDate(a.start_at, timezone) === today,
        )
        .sort((a, b) => a.start_at.localeCompare(b.start_at))
        .pop()?.id ?? null;
  }

  for (let i = 0; i < plan.logsToAdd; i += 1) {
    const endedAt = now - i * focusMin * 60_000;
    await createRow("pomodoro_logs", {
      agenda_id: targetAgendaId,
      todo_id: todoId,
      started_at: new Date(endedAt - focusMin * 60_000).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      duration_sec: focusMin * 60,
      type: "focus",
      outcome: "completed",
      is_overtime: false,
    });
  }

  await completeTodo(todoId, options);
}

/** Future `planned` agendas for a todo — drives the §5.9 prompt. */
export async function futurePlannedAgendas(todoId: UUID): Promise<Agenda[]> {
  const now = new Date();
  const rows = await getDb().agendas.where("todo_id").equals(todoId).toArray();
  return rows.filter(
    (a) => !a.deleted_at && a.status === "planned" && new Date(a.end_at) > now,
  );
}

/** Incomplete children of a todo — drives the §4.2 soft warning. */
export async function incompleteChildren(todoId: UUID): Promise<Todo[]> {
  const rows = await getDb().todos.where("parent_id").equals(todoId).toArray();
  return rows.filter((t) => !t.deleted_at && t.status !== "done");
}

/* ------------------------------------------------------------------ */
/* deletion                                                            */
/* ------------------------------------------------------------------ */

export type DeleteChildrenMode = "cascade" | "promote";

/**
 * §4.2: "Deleting a parent asks whether to delete or promote children to the
 * parent's level." Both branches run as one transaction so the undo toast can
 * restore a coherent state.
 */
export async function deleteTodo(
  todoId: UUID,
  mode: DeleteChildrenMode = "cascade",
): Promise<{ affected: UUID[]; promoted: UUID[] }> {
  const db = getDb();
  const all = (await db.todos.toArray()).filter((t) => !t.deleted_at);
  const index = buildTodoIndex(all);
  const target = index.byId.get(todoId);
  const descendants = descendantsOf(index, todoId);

  if (mode === "promote") {
    const directChildren = descendants.filter((d) => d.parent_id === todoId);
    for (const child of directChildren) {
      await updateRow("todos", child.id, { parent_id: target?.parent_id ?? null });
    }
    await softDeleteRow("todos", todoId);
    return { affected: [todoId], promoted: directChildren.map((c) => c.id) };
  }

  const affected = [todoId, ...descendants.map((d) => d.id)];
  for (const rowId of affected) {
    await softDeleteRow("todos", rowId);
  }
  return { affected, promoted: [] };
}

/** Undo for `deleteTodo` — restores the same rows in one go. */
export async function restoreTodos(
  affected: UUID[],
  promoted: { id: UUID; parent_id: UUID | null }[] = [],
): Promise<void> {
  for (const rowId of affected) await restoreRow("todos", rowId);
  for (const p of promoted) await updateRow("todos", p.id, { parent_id: p.parent_id });
}

/* ------------------------------------------------------------------ */
/* weekly plan                                                         */
/* ------------------------------------------------------------------ */

export async function setFocusWeek(todoId: UUID, week: IsoWeek | null) {
  await updateRow("todos", todoId, { focus_week: week });
}
