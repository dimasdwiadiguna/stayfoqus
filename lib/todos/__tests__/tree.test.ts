import { describe, expect, it } from "vitest";

import {
  blockersOf,
  buildTodoIndex,
  canNest,
  depthOf,
  descendantsOf,
  findDependencyCycle,
  isBlocked,
  subtreeHeight,
} from "@/lib/todos/tree";

import { makeTodo } from "./fixtures";

describe("hierarchy (§4.2)", () => {
  const root = makeTodo({ id: "r" });
  const child = makeTodo({ id: "c", parent_id: "r" });
  const grandchild = makeTodo({ id: "g", parent_id: "c" });
  const index = buildTodoIndex([root, child, grandchild]);

  it("counts depth from the root", () => {
    expect(depthOf(index, "r")).toBe(1);
    expect(depthOf(index, "c")).toBe(2);
    expect(depthOf(index, "g")).toBe(3);
  });

  it("measures subtree height", () => {
    expect(subtreeHeight(index, "r")).toBe(2);
    expect(subtreeHeight(index, "c")).toBe(1);
    expect(subtreeHeight(index, "g")).toBe(0);
  });

  it("lists descendants", () => {
    expect(descendantsOf(index, "r").map((t) => t.id).sort()).toEqual(["c", "g"]);
    expect(descendantsOf(index, "g")).toEqual([]);
  });

  it("treats an orphan as a root so it never disappears", () => {
    const orphan = makeTodo({ id: "o", parent_id: "missing" });
    const idx = buildTodoIndex([orphan]);
    expect(depthOf(idx, "o")).toBe(1);
    expect(idx.childrenOf.get(null)?.map((t) => t.id)).toEqual(["o"]);
  });

  it("rejects nesting past depth 3", () => {
    const leaf = makeTodo({ id: "leaf" });
    const idx = buildTodoIndex([root, child, grandchild, leaf]);
    expect(canNest(idx, "leaf", "c")).toEqual({ ok: true });
    expect(canNest(idx, "leaf", "g")).toEqual({ ok: false, reason: "max-depth" });
  });

  it("accounts for the moved node's own subtree", () => {
    // Moving `c` (height 1) under another root keeps the tree at depth 3: ok.
    const other = makeTodo({ id: "r2" });
    const idx = buildTodoIndex([root, child, grandchild, other]);
    expect(canNest(idx, "c", "r2")).toEqual({ ok: true });

    // But moving `r` (height 2) under a root would make a 4-level tree.
    expect(canNest(idx, "r", "r2")).toEqual({ ok: false, reason: "max-depth" });
  });

  it("rejects self-parenting and descendant-parenting", () => {
    expect(canNest(index, "r", "r")).toEqual({ ok: false, reason: "self" });
    expect(canNest(index, "r", "g")).toEqual({ ok: false, reason: "descendant" });
  });

  it("always allows promotion to root", () => {
    expect(canNest(index, "g", null)).toEqual({ ok: true });
  });
});

describe("dependencies (§4.2)", () => {
  it("blocks while any blocker is not done", () => {
    const a = makeTodo({ id: "a", status: "active" });
    const b = makeTodo({ id: "b", blocked_by: ["a"] });
    let index = buildTodoIndex([a, b]);
    expect(isBlocked(index, b)).toBe(true);
    expect(blockersOf(index, b).map((t) => t.id)).toEqual(["a"]);

    index = buildTodoIndex([{ ...a, status: "done" }, b]);
    expect(isBlocked(index, b)).toBe(false);
  });

  it("ignores blockers that were deleted", () => {
    const a = makeTodo({ id: "a", deleted_at: "2026-08-02T00:00:00.000Z" });
    const b = makeTodo({ id: "b", blocked_by: ["a"] });
    const index = buildTodoIndex([a, b]);
    expect(isBlocked(index, b)).toBe(false);
  });

  it("ignores blockers that no longer exist", () => {
    const b = makeTodo({ id: "b", blocked_by: ["gone"] });
    const index = buildTodoIndex([b]);
    expect(isBlocked(index, b)).toBe(false);
  });

  it("detects a direct cycle", () => {
    const a = makeTodo({ id: "a", blocked_by: ["b"] });
    const b = makeTodo({ id: "b" });
    const index = buildTodoIndex([a, b]);
    const cycle = findDependencyCycle(index, "b", ["a"]);
    expect(cycle?.map((t) => t.id)).toEqual(["b", "a", "b"]);
  });

  it("detects a transitive cycle", () => {
    const a = makeTodo({ id: "a", blocked_by: ["b"] });
    const b = makeTodo({ id: "b", blocked_by: ["c"] });
    const c = makeTodo({ id: "c" });
    const index = buildTodoIndex([a, b, c]);
    expect(findDependencyCycle(index, "c", ["a"])?.map((t) => t.id)).toEqual([
      "c",
      "a",
      "b",
      "c",
    ]);
  });

  it("detects self-dependency", () => {
    const a = makeTodo({ id: "a" });
    const index = buildTodoIndex([a]);
    expect(findDependencyCycle(index, "a", ["a"])).not.toBeNull();
  });

  it("allows a diamond, which is not a cycle", () => {
    const base = makeTodo({ id: "base" });
    const left = makeTodo({ id: "left", blocked_by: ["base"] });
    const right = makeTodo({ id: "right", blocked_by: ["base"] });
    const top = makeTodo({ id: "top" });
    const index = buildTodoIndex([base, left, right, top]);
    expect(findDependencyCycle(index, "top", ["left", "right"])).toBeNull();
  });
});
