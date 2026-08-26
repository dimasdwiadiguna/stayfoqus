"use client";

import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";

import { getDb } from "@/lib/db/client";
import type { Agenda, Category, PomodoroLog, Todo, UUID } from "@/lib/db/schema";
import { computeCounters, type TodoCounters } from "@/lib/todos/derived";
import { buildTodoIndex, type TodoIndex } from "@/lib/todos/tree";

const EMPTY: never[] = [];

function live<T>(rows: T[] | undefined): T[] {
  return rows ?? EMPTY;
}

export function useCategories(): Category[] {
  const rows = useLiveQuery(
    () => getDb().categories.orderBy("sort_order").toArray(),
    [],
  );
  return React.useMemo(() => live(rows).filter((c) => !c.deleted_at), [rows]);
}

export function useTodos(): Todo[] {
  const rows = useLiveQuery(() => getDb().todos.toArray(), []);
  return React.useMemo(() => live(rows).filter((t) => !t.deleted_at), [rows]);
}

export function useAgendas(): Agenda[] {
  const rows = useLiveQuery(() => getDb().agendas.toArray(), []);
  return React.useMemo(() => live(rows).filter((a) => !a.deleted_at), [rows]);
}

export function usePomodoroLogs(): PomodoroLog[] {
  const rows = useLiveQuery(() => getDb().pomodoro_logs.toArray(), []);
  return React.useMemo(() => live(rows).filter((l) => !l.deleted_at), [rows]);
}

export interface TaskData {
  todos: Todo[];
  categories: Category[];
  agendas: Agenda[];
  logs: PomodoroLog[];
  index: TodoIndex;
  counters: Map<UUID, TodoCounters>;
  categoryById: Map<UUID, Category>;
}

/**
 * One place that assembles the working set every task-facing screen needs.
 * Derived counters (§4.2) are computed once per data change rather than per
 * row, so a long list stays linear.
 */
export function useTaskData(): TaskData {
  const todos = useTodos();
  const categories = useCategories();
  const agendas = useAgendas();
  const logs = usePomodoroLogs();

  return React.useMemo(() => {
    const index = buildTodoIndex(todos);
    const counters = computeCounters(todos, agendas, logs);
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    return { todos, categories, agendas, logs, index, counters, categoryById };
  }, [todos, categories, agendas, logs]);
}

/** Agendas belonging to one todo, newest first. */
export function useAgendasForTodo(todoId: UUID | null): Agenda[] {
  const rows = useLiveQuery(
    () => (todoId ? getDb().agendas.where("todo_id").equals(todoId).toArray() : []),
    [todoId],
  );
  return React.useMemo(
    () =>
      live(rows)
        .filter((a) => !a.deleted_at)
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [rows],
  );
}
