import { describe, expect, it } from "vitest";

import { agendaDots, computeCounters, countersFor } from "@/lib/todos/derived";

import { makeAgenda, makeLog, makeTodo } from "./fixtures";

const NOW = new Date("2026-08-03T06:00:00.000Z");

describe("derived counters (§4.2)", () => {
  it("sums allocation across a todo's agendas", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 8 });
    const agendas = [
      makeAgenda({ todo_id: "t", allocated_pomodoro: 3 }),
      makeAgenda({ todo_id: "t", allocated_pomodoro: 2 }),
    ];
    const counters = countersFor(computeCounters([todo], agendas, [], NOW), "t");
    expect(counters.allocated).toBe(5);
    expect(counters.remainingToAllocate).toBe(3);
  });

  it("excludes deleted and cancelled agendas from allocation", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 5 });
    const agendas = [
      makeAgenda({ todo_id: "t", allocated_pomodoro: 2 }),
      makeAgenda({ todo_id: "t", allocated_pomodoro: 2, deleted_at: "2026-08-02T00:00:00.000Z" }),
      makeAgenda({ todo_id: "t", allocated_pomodoro: 2, status: "cancelled" }),
    ];
    expect(countersFor(computeCounters([todo], agendas, [], NOW), "t").allocated).toBe(2);
  });

  it("never reports negative remaining when over-allocated", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 1 });
    const agendas = [makeAgenda({ todo_id: "t", allocated_pomodoro: 4 })];
    expect(
      countersFor(computeCounters([todo], agendas, [], NOW), "t").remainingToAllocate,
    ).toBe(0);
  });

  it("counts only completed focus logs as used (§4.4)", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 4 });
    const agenda = makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 4 });
    const logs = [
      makeLog({ agenda_id: "a" }),
      makeLog({ agenda_id: "a" }),
      makeLog({ agenda_id: "a", outcome: "aborted" }),
      makeLog({ agenda_id: "a", type: "short_break" }),
    ];
    expect(countersFor(computeCounters([todo], [agenda], logs, NOW), "t").used).toBe(2);
  });

  it("attributes an untethered log through its todo_id", () => {
    const todo = makeTodo({ id: "t" });
    const logs = [makeLog({ agenda_id: null, todo_id: "t" })];
    expect(countersFor(computeCounters([todo], [], logs, NOW), "t").used).toBe(1);
  });

  it("tracks overtime logs separately", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 1 });
    const agenda = makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 1 });
    const logs = [
      makeLog({ agenda_id: "a" }),
      makeLog({ agenda_id: "a", is_overtime: true }),
    ];
    const counters = countersFor(computeCounters([todo], [agenda], logs, NOW), "t");
    expect(counters.used).toBe(2);
    expect(counters.overtime).toBe(1);
  });

  it("counts agendas that end in the future", () => {
    const todo = makeTodo({ id: "t" });
    const agendas = [
      makeAgenda({ todo_id: "t", end_at: "2026-08-03T05:00:00.000Z" }),
      makeAgenda({ todo_id: "t", end_at: "2026-08-03T09:00:00.000Z" }),
    ];
    expect(countersFor(computeCounters([todo], agendas, [], NOW), "t").futureAgendas).toBe(1);
  });
});

describe("pomodoro dot symbols (§5.7)", () => {
  it("renders the worked example: allocated 4, 2 done, 1 running", () => {
    expect(agendaDots(4, 2, true)).toEqual([
      "filled",
      "filled",
      "running",
      "empty",
    ]);
  });

  it("renders an untouched allocation as all empty", () => {
    expect(agendaDots(3, 0, false)).toEqual(["empty", "empty", "empty"]);
  });

  it("renders a fully used allocation as all filled", () => {
    expect(agendaDots(2, 2, false)).toEqual(["filled", "filled"]);
  });

  it("marks completed sessions past the allocation as overtime", () => {
    expect(agendaDots(2, 4, false)).toEqual([
      "filled",
      "filled",
      "overtime",
      "overtime",
    ]);
  });

  it("marks a session running past the allocation as overtime", () => {
    expect(agendaDots(2, 2, true)).toEqual(["filled", "filled", "overtime"]);
  });
});

describe("in-flight sessions (§5.6)", () => {
  it("does not count a focus session that is still running", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agenda = makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2 });
    const logs = [
      makeLog({ agenda_id: "a" }),
      // Open row: written when the session starts, closed when it finishes.
      makeLog({ agenda_id: "a", ended_at: null, outcome: "aborted", duration_sec: 0 }),
    ];
    expect(countersFor(computeCounters([todo], [agenda], logs, NOW), "t").used).toBe(1);
  });
});
