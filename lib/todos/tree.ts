import { MAX_TODO_DEPTH, type Todo, type UUID } from "@/lib/db/schema";

/**
 * Pure hierarchy and dependency logic for todos (§4.2).
 * No Dexie, no React — the caller supplies the todo set.
 */

export interface TodoIndex {
  byId: Map<UUID, Todo>;
  childrenOf: Map<UUID | null, Todo[]>;
}

export function buildTodoIndex(todos: readonly Todo[]): TodoIndex {
  const byId = new Map<UUID, Todo>();
  const childrenOf = new Map<UUID | null, Todo[]>();

  for (const todo of todos) byId.set(todo.id, todo);

  for (const todo of todos) {
    // A todo whose parent is missing (deleted, or not yet pulled) is treated as
    // a root so it can never disappear from the list.
    const parent =
      todo.parent_id && byId.has(todo.parent_id) ? todo.parent_id : null;
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(todo);
    else childrenOf.set(parent, [todo]);
  }

  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
  }

  return { byId, childrenOf };
}

export function childrenOf(index: TodoIndex, parentId: UUID | null): Todo[] {
  return index.childrenOf.get(parentId) ?? [];
}

/** 1 for a root todo, 2 for its child, 3 for a grandchild. */
export function depthOf(index: TodoIndex, todoId: UUID): number {
  let depth = 1;
  let current = index.byId.get(todoId);
  const seen = new Set<UUID>([todoId]);

  while (current?.parent_id) {
    const parent = index.byId.get(current.parent_id);
    // Defensive: a corrupt cycle in parent_id must not hang the UI.
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    current = parent;
  }
  return depth;
}

/** Deepest level below `todoId`, counted from that node (0 = no children). */
export function subtreeHeight(index: TodoIndex, todoId: UUID): number {
  const kids = childrenOf(index, todoId);
  if (kids.length === 0) return 0;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(index, k.id)));
}

export function descendantsOf(index: TodoIndex, todoId: UUID): Todo[] {
  const out: Todo[] = [];
  const stack = [...childrenOf(index, todoId)];
  const seen = new Set<UUID>();
  while (stack.length) {
    const node = stack.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    stack.push(...childrenOf(index, node.id));
  }
  return out;
}

export type NestResult =
  | { ok: true }
  | { ok: false; reason: "max-depth" | "self" | "descendant" };

/**
 * Can `todoId` be re-parented under `parentId`?
 *
 * §4.2 caps the tree at 3 levels. The check must account for the moved node's
 * *own* subtree: dropping a two-level branch under a root is fine, dropping it
 * under a child is not.
 */
export function canNest(
  index: TodoIndex,
  todoId: UUID,
  parentId: UUID | null,
): NestResult {
  if (parentId === null) return { ok: true };
  if (parentId === todoId) return { ok: false, reason: "self" };

  const descendants = descendantsOf(index, todoId);
  if (descendants.some((d) => d.id === parentId)) {
    return { ok: false, reason: "descendant" };
  }

  const newDepth = depthOf(index, parentId) + 1;
  if (newDepth + subtreeHeight(index, todoId) > MAX_TODO_DEPTH) {
    return { ok: false, reason: "max-depth" };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* dependencies                                                        */
/* ------------------------------------------------------------------ */

/** §4.2: a todo is blocked if any todo it waits on is not `done`. */
export function blockersOf(index: TodoIndex, todo: Todo): Todo[] {
  return todo.blocked_by
    .map((depId) => index.byId.get(depId))
    .filter((dep): dep is Todo => Boolean(dep) && dep!.status !== "done" && !dep!.deleted_at);
}

export function isBlocked(index: TodoIndex, todo: Todo): boolean {
  return blockersOf(index, todo).length > 0;
}

/**
 * Detects a dependency cycle that would be created by giving `todoId` the
 * dependency set `blockedBy` (§4.2: "reject with a message naming the cycle").
 *
 * Returns the cycle as an ordered list of todos starting and ending at
 * `todoId`, or null when the graph stays acyclic.
 */
export function findDependencyCycle(
  index: TodoIndex,
  todoId: UUID,
  blockedBy: readonly UUID[],
): Todo[] | null {
  const edges = (nodeId: UUID): readonly UUID[] =>
    nodeId === todoId ? blockedBy : (index.byId.get(nodeId)?.blocked_by ?? []);

  // Depth-first walk from each proposed dependency back toward `todoId`.
  // The path we carry is the human-readable cycle the UI names.
  const visited = new Set<UUID>();

  const walk = (nodeId: UUID, path: UUID[]): UUID[] | null => {
    if (nodeId === todoId) return [...path, todoId];
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);

    for (const next of edges(nodeId)) {
      const found = walk(next, [...path, nodeId]);
      if (found) return found;
    }
    return null;
  };

  for (const dep of blockedBy) {
    if (dep === todoId) return [index.byId.get(todoId)!, index.byId.get(todoId)!].filter(Boolean);
    const cycle = walk(dep, [todoId]);
    if (cycle) {
      return cycle
        .map((cid) => index.byId.get(cid))
        .filter((t): t is Todo => Boolean(t));
    }
  }
  return null;
}
