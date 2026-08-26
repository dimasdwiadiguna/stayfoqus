import { describe, expect, it } from "vitest";

import {
  childrenBlockingStart,
  earliestStartFor,
  hasChildren,
} from "@/lib/todos/ordering";
import { buildTodoIndex } from "@/lib/todos/tree";

import { makeAgenda, makeTodo } from "./fixtures";

const parent = makeTodo({ id: "p" });
const childA = makeTodo({ id: "a", parent_id: "p" });
const childB = makeTodo({ id: "b", parent_id: "p" });
const grandchild = makeTodo({ id: "g", parent_id: "a" });
const index = buildTodoIndex([parent, childA, childB, grandchild]);

const T = (hhmm: string) => Date.parse(`2026-08-26T${hhmm}:00.000Z`);
const at = (todoId: string, from: string, to: string, extra = {}) =>
  makeAgenda({
    todo_id: todoId,
    start_at: `2026-08-26T${from}:00.000Z`,
    end_at: `2026-08-26T${to}:00.000Z`,
    ...extra,
  });

describe("a parent may not start before its children", () => {
  it("has no floor when the todo has no children", () => {
    expect(earliestStartFor(index, "b", [at("b", "02:00", "03:00")])).toBe(
      -Infinity,
    );
  });

  it("takes the latest end among direct children", () => {
    const agendas = [at("a", "02:00", "03:00"), at("b", "04:00", "05:00")];
    expect(earliestStartFor(index, "p", agendas)).toBe(T("05:00"));
  });

  it("includes grandchildren", () => {
    const agendas = [at("a", "02:00", "03:00"), at("g", "06:00", "07:00")];
    expect(earliestStartFor(index, "p", agendas)).toBe(T("07:00"));
  });

  it("ignores deleted and cancelled agendas", () => {
    const agendas = [
      at("a", "02:00", "03:00"),
      at("b", "08:00", "09:00", { deleted_at: "2026-08-20T00:00:00.000Z" }),
      at("b", "10:00", "11:00", { status: "cancelled" }),
    ];
    expect(earliestStartFor(index, "p", agendas)).toBe(T("03:00"));
  });

  it("names the children that block a given start", () => {
    const agendas = [at("a", "02:00", "03:00"), at("b", "04:00", "05:00")];
    expect(
      childrenBlockingStart(index, "p", agendas, T("03:30")).map((c) => c.id),
    ).toEqual(["b"]);
    expect(childrenBlockingStart(index, "p", agendas, T("05:00"))).toEqual([]);
  });

  it("reports whether a todo has children at all", () => {
    expect(hasChildren(index, "p")).toBe(true);
    expect(hasChildren(index, "b")).toBe(false);
  });
});
