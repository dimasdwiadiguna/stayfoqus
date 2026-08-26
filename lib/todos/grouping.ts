import type { Category, IsoDate, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { addDays } from "@/lib/time";
import { childrenOf, type TodoIndex } from "@/lib/todos/tree";

export type GroupMode = "category" | "due" | "priority";

export interface TaskFilter {
  tags: string[];
  showDone: boolean;
  query: string;
}

export const EMPTY_FILTER: TaskFilter = { tags: [], showDone: false, query: "" };

export interface TaskGroup {
  key: string;
  label: string;
  /** Hex colour for the group's dot, when the grouping has one. */
  color?: string;
  todos: Todo[];
}

function matchesFilter(todo: Todo, filter: TaskFilter): boolean {
  if (!filter.showDone && todo.status === "done") return false;
  if (todo.status === "archived") return false;
  if (filter.tags.length && !filter.tags.some((tag) => todo.tags.includes(tag))) {
    return false;
  }
  if (filter.query) {
    const q = filter.query.toLowerCase();
    const haystack = `${todo.title} ${todo.notes ?? ""} ${todo.tags.join(" ")}`;
    if (!haystack.toLowerCase().includes(q)) return false;
  }
  return true;
}

/**
 * A todo is kept when it matches, or when any descendant matches — otherwise
 * filtering by a tag would hide the parent that gives a subtask its context.
 */
function subtreeMatches(
  index: TodoIndex,
  todo: Todo,
  filter: TaskFilter,
): boolean {
  if (matchesFilter(todo, filter)) return true;
  return childrenOf(index, todo.id).some((c) => subtreeMatches(index, c, filter));
}

/** Roots of the visible forest, in sort order. */
export function visibleRoots(index: TodoIndex, filter: TaskFilter): Todo[] {
  return childrenOf(index, null).filter((todo) =>
    subtreeMatches(index, todo, filter),
  );
}

export function visibleChildren(
  index: TodoIndex,
  todoId: UUID,
  filter: TaskFilter,
): Todo[] {
  return childrenOf(index, todoId).filter((c) => subtreeMatches(index, c, filter));
}

/* ------------------------------------------------------------------ */
/* grouping                                                            */
/* ------------------------------------------------------------------ */

const UNGROUPED = "__none__";

function dueBucket(due: IsoDate | null, today: IsoDate): {
  key: string;
  label: string;
  order: number;
} {
  if (!due) return { key: "none", label: t.tasks.noDueDate, order: 4 };
  if (due < today) return { key: "overdue", label: t.tasks.overdue, order: 0 };
  if (due === today) return { key: "today", label: t.common.today, order: 1 };
  if (due <= addDays(today, 7)) {
    return { key: "week", label: t.tasks.thisWeek, order: 2 };
  }
  return { key: "later", label: t.tasks.later, order: 3 };
}

/**
 * Groups the *root* todos only. Subtasks stay nested under their parent
 * wherever the parent lands, which keeps the hierarchy readable regardless of
 * the grouping the user picked.
 */
export function groupTodos(
  roots: readonly Todo[],
  mode: GroupMode,
  categories: readonly Category[],
  today: IsoDate,
): TaskGroup[] {
  if (mode === "category") {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const buckets = new Map<string, TaskGroup>();

    for (const cat of categories) {
      buckets.set(cat.id, { key: cat.id, label: cat.name, color: cat.color, todos: [] });
    }
    buckets.set(UNGROUPED, { key: UNGROUPED, label: t.tasks.noCategory, todos: [] });

    for (const todo of roots) {
      const key = todo.category_id && byId.has(todo.category_id)
        ? todo.category_id
        : UNGROUPED;
      buckets.get(key)!.todos.push(todo);
    }
    return [...buckets.values()].filter((g) => g.todos.length > 0);
  }

  if (mode === "priority") {
    const labels: Record<number, string> = {
      1: t.priority.p1,
      2: t.priority.p2,
      3: t.priority.p3,
      4: t.priority.p4,
    };
    const colors: Record<number, string> = {
      1: "var(--p1)",
      2: "var(--p2)",
      3: "var(--p3)",
      4: "var(--p4)",
    };
    const buckets = new Map<number, TaskGroup>();
    for (const todo of roots) {
      const existing = buckets.get(todo.priority);
      if (existing) existing.todos.push(todo);
      else {
        buckets.set(todo.priority, {
          key: `p${todo.priority}`,
          label: labels[todo.priority] ?? "",
          color: colors[todo.priority],
          todos: [todo],
        });
      }
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, group]) => group);
  }

  const buckets = new Map<string, TaskGroup & { order: number }>();
  for (const todo of roots) {
    const bucket = dueBucket(todo.due_date, today);
    const existing = buckets.get(bucket.key);
    if (existing) existing.todos.push(todo);
    else {
      buckets.set(bucket.key, {
        key: bucket.key,
        label: bucket.label,
        order: bucket.order,
        todos: [todo],
      });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.order - b.order)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      todos: bucket.todos,
    }));
}

/** Every tag in use, for the filter chip row. */
export function allTags(todos: readonly Todo[]): string[] {
  const seen = new Set<string>();
  for (const todo of todos) for (const tag of todo.tags) seen.add(tag);
  return [...seen].sort((a, b) => a.localeCompare(b, "id"));
}
