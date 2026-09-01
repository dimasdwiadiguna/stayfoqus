import { describe, expect, it } from "vitest";

import {
  agendasImplyTodoDone,
  isDayCleared,
  shouldPromptTodoDone,
  summariseDay,
} from "@/lib/agendas/coupling";
import { makeAgenda, makeLog, makeTodo } from "@/lib/todos/__tests__/fixtures";

const NOW = Date.parse("2026-08-26T10:00:00.000Z");

const past = { start_at: "2026-08-26T02:00:00.000Z", end_at: "2026-08-26T03:00:00.000Z" };
const future = { start_at: "2026-08-27T02:00:00.000Z", end_at: "2026-08-27T03:00:00.000Z" };

describe("§5.9 — prompting that a todo is finished", () => {
  it("prompts when the allocation is used up and nothing is scheduled ahead", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
    ];
    const logs = [makeLog({ agenda_id: "a" }), makeLog({ agenda_id: "a" })];
    expect(shouldPromptTodoDone({ todo, agendas, logs, now: NOW })).toBe(true);
  });

  it("does not prompt while a future agenda remains", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
      makeAgenda({ id: "b", todo_id: "t", allocated_pomodoro: 2, status: "planned", ...future }),
    ];
    const logs = [makeLog({ agenda_id: "a" }), makeLog({ agenda_id: "a" })];
    expect(shouldPromptTodoDone({ todo, agendas, logs, now: NOW })).toBe(false);
  });

  it("does not prompt while an agenda is still awaiting review", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 4 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
      makeAgenda({ id: "b", todo_id: "t", allocated_pomodoro: 2, status: "missed", ...past }),
    ];
    const logs = [makeLog({ agenda_id: "a" }), makeLog({ agenda_id: "a" })];
    expect(shouldPromptTodoDone({ todo, agendas, logs, now: NOW })).toBe(false);
  });

  it("does not prompt when pomodoros remain unused", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 4 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 4, status: "partial", ...past }),
    ];
    const logs = [makeLog({ agenda_id: "a" })];
    expect(shouldPromptTodoDone({ todo, agendas, logs, now: NOW })).toBe(false);
  });

  it("does not prompt when the estimate is not fully allocated", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 6 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
    ];
    const logs = [makeLog({ agenda_id: "a" }), makeLog({ agenda_id: "a" })];
    expect(shouldPromptTodoDone({ todo, agendas, logs, now: NOW })).toBe(false);
  });

  it("does not prompt for a todo that is already done", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 1, status: "done" });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 1, status: "done", ...past }),
    ];
    expect(
      shouldPromptTodoDone({ todo, agendas, logs: [makeLog({ agenda_id: "a" })], now: NOW }),
    ).toBe(false);
  });

  it("does not prompt when no agenda has been resolved", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 1 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 1, status: "cancelled", ...past }),
    ];
    expect(shouldPromptTodoDone({ todo, agendas, logs: [], now: NOW })).toBe(false);
  });
});

describe("§9 — day cleared", () => {
  it("is true when every agenda today is done or partial", () => {
    expect(
      isDayCleared([
        makeAgenda({ status: "done" }),
        makeAgenda({ status: "partial" }),
      ]),
    ).toBe(true);
  });

  it("is false while one is still planned", () => {
    expect(
      isDayCleared([makeAgenda({ status: "done" }), makeAgenda({ status: "planned" })]),
    ).toBe(false);
  });

  it("is false when a missed agenda has not been reviewed", () => {
    expect(
      isDayCleared([makeAgenda({ status: "done" }), makeAgenda({ status: "missed" })]),
    ).toBe(false);
  });

  it("ignores drafts and cancelled agendas", () => {
    expect(
      isDayCleared([
        makeAgenda({ status: "done" }),
        makeAgenda({ status: "draft" }),
        makeAgenda({ status: "cancelled" }),
      ]),
    ).toBe(true);
  });

  it("is false on an empty day — nothing was cleared", () => {
    expect(isDayCleared([])).toBe(false);
  });
});

describe("§9 — day summary", () => {
  it("counts completed focus pomodoros and finds the top category", () => {
    const todos = new Map([
      ["t1", makeTodo({ id: "t1", category_id: "kerja" })],
      ["t2", makeTodo({ id: "t2", category_id: "riset" })],
    ]);
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t1", allocated_pomodoro: 2 }),
      makeAgenda({ id: "b", todo_id: "t2", allocated_pomodoro: 5 }),
    ];
    const logs = [
      makeLog({ agenda_id: "a" }),
      makeLog({ agenda_id: "b" }),
      makeLog({ agenda_id: "b", outcome: "aborted" }),
    ];

    const summary = summariseDay(agendas, logs, todos);
    expect(summary.pomodoroTotal).toBe(2);
    expect(summary.topCategoryId).toBe("riset");
    expect(summary.agendaCount).toBe(2);
  });

  it("reports no top category when nothing is categorised", () => {
    const todos = new Map([["t1", makeTodo({ id: "t1", category_id: null })]]);
    const summary = summariseDay(
      [makeAgenda({ todo_id: "t1" })],
      [],
      todos,
    );
    expect(summary.topCategoryId).toBeNull();
    expect(summary.pomodoroTotal).toBe(0);
  });
});

describe("agendas that imply the todo is finished", () => {
  it("completes a todo whose every agenda is done", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 3 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
      makeAgenda({ id: "b", todo_id: "t", allocated_pomodoro: 1, status: "done", ...past }),
    ];
    expect(agendasImplyTodoDone({ todo, agendas })).toBe(true);
  });

  it("waits while one agenda is still planned", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 1, status: "done", ...past }),
      makeAgenda({ id: "b", todo_id: "t", allocated_pomodoro: 1, status: "planned", ...future }),
    ];
    expect(agendasImplyTodoDone({ todo, agendas })).toBe(false);
  });

  it("does not treat a partial agenda as finished", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "partial", ...past }),
    ];
    expect(agendasImplyTodoDone({ todo, agendas })).toBe(false);
  });

  it("ignores drafts and cancelled rows on both sides of the question", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 2 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
      makeAgenda({ id: "b", todo_id: "t", allocated_pomodoro: 4, status: "draft", ...future }),
      makeAgenda({ id: "c", todo_id: "t", allocated_pomodoro: 4, status: "cancelled", ...future }),
    ];
    expect(agendasImplyTodoDone({ todo, agendas })).toBe(true);
  });

  it("holds back while the estimate is larger than anything scheduled", () => {
    // D-070 point 3: four pomodoros of this todo have never been planned, so
    // running the two that were is not finishing it.
    const todo = makeTodo({ id: "t", estimated_pomodoro: 6 });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 2, status: "done", ...past }),
    ];
    expect(agendasImplyTodoDone({ todo, agendas })).toBe(false);
  });

  it("says nothing about a todo with no agendas, or one already done", () => {
    const todo = makeTodo({ id: "t", estimated_pomodoro: 1 });
    expect(agendasImplyTodoDone({ todo, agendas: [] })).toBe(false);

    const done = makeTodo({ id: "t", estimated_pomodoro: 1, status: "done" });
    const agendas = [
      makeAgenda({ id: "a", todo_id: "t", allocated_pomodoro: 1, status: "done", ...past }),
    ];
    expect(agendasImplyTodoDone({ todo: done, agendas })).toBe(false);
  });
});
