import { describe, expect, it } from "vitest";

import {
  completedTodayFor,
  planCompletion,
  suggestedReported,
} from "@/lib/todos/completion";
import { localDate } from "@/lib/time";

import { makeAgenda, makeLog, makeTodo } from "./fixtures";

const JKT = "Asia/Jakarta";
const TODAY = "2026-08-26";
const NOW = Date.parse("2026-08-26T10:00:00.000Z");
const toLocalDate = (instant: string) => localDate(instant, JKT);

/** 09:00 Jakarta on the given date. */
const onDay = (date: string) => `${date}T02:00:00.000Z`;

function plan(
  reported: number,
  {
    todo = makeTodo({ id: "t", estimated_pomodoro: 3 }),
    agendas = [],
    logs = [],
  }: {
    todo?: ReturnType<typeof makeTodo>;
    agendas?: ReturnType<typeof makeAgenda>[];
    logs?: ReturnType<typeof makeLog>[];
  } = {},
) {
  return planCompletion({
    todo,
    agendas,
    logs,
    reported,
    today: TODAY,
    toLocalDate,
    now: NOW,
  });
}

describe("counting what is already credited today", () => {
  it("counts completed focus logs attached through the agenda", () => {
    const agendas = [makeAgenda({ id: "a", todo_id: "t", start_at: onDay(TODAY) })];
    const logs = [
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
    ];
    expect(
      completedTodayFor({
        todo: makeTodo({ id: "t" }),
        agendas,
        logs,
        today: TODAY,
        toLocalDate,
      }),
    ).toBe(2);
  });

  it("counts an untethered log through todo_id", () => {
    expect(
      completedTodayFor({
        todo: makeTodo({ id: "t" }),
        agendas: [],
        logs: [makeLog({ agenda_id: null, todo_id: "t", started_at: onDay(TODAY) })],
        today: TODAY,
        toLocalDate,
      }),
    ).toBe(1);
  });

  it("ignores logs from other days", () => {
    expect(
      completedTodayFor({
        todo: makeTodo({ id: "t" }),
        agendas: [],
        logs: [
          makeLog({ agenda_id: null, todo_id: "t", started_at: onDay("2026-08-25") }),
        ],
        today: TODAY,
        toLocalDate,
      }),
    ).toBe(0);
  });

  it("ignores aborted and in-flight sessions", () => {
    expect(
      completedTodayFor({
        todo: makeTodo({ id: "t" }),
        agendas: [],
        logs: [
          makeLog({ todo_id: "t", started_at: onDay(TODAY), outcome: "aborted" }),
          makeLog({ todo_id: "t", started_at: onDay(TODAY), ended_at: null }),
        ],
        today: TODAY,
        toLocalDate,
      }),
    ).toBe(0);
  });
});

describe("the pre-filled answer", () => {
  it("uses what the timer already recorded when there is any", () => {
    const agendas = [makeAgenda({ id: "a", todo_id: "t" })];
    const logs = [makeLog({ agenda_id: "a" }), makeLog({ agenda_id: "a" })];
    expect(
      suggestedReported({
        todo: makeTodo({ id: "t", estimated_pomodoro: 5 }),
        agendas,
        logs,
      }),
    ).toBe(2);
  });

  it("falls back to the estimate when nothing was tracked", () => {
    expect(
      suggestedReported({
        todo: makeTodo({ id: "t", estimated_pomodoro: 4 }),
        agendas: [],
        logs: [],
      }),
    ).toBe(4);
  });
});

describe("planning the write", () => {
  it("creates an agenda today when the todo has none", () => {
    const result = plan(3);
    expect(result).toMatchObject({
      logsToAdd: 3,
      createAgenda: { allocated: 3 },
      topUpAgendaId: null,
      alreadyToday: 0,
    });
  });

  it("raises today's allocation instead of adding a second block", () => {
    const agendas = [
      makeAgenda({
        id: "a",
        todo_id: "t",
        start_at: onDay(TODAY),
        allocated_pomodoro: 1,
      }),
    ];
    const result = plan(4, { agendas });
    expect(result.createAgenda).toBeNull();
    expect(result.topUpAgendaId).toBe("a");
    expect(result.topUpAllocatedTo).toBe(4);
    expect(result.logsToAdd).toBe(4);
  });

  it("leaves the allocation alone when today already covers the answer", () => {
    const agendas = [
      makeAgenda({
        id: "a",
        todo_id: "t",
        start_at: onDay(TODAY),
        allocated_pomodoro: 6,
      }),
    ];
    const result = plan(2, { agendas });
    expect(result.topUpAgendaId).toBeNull();
    expect(result.createAgenda).toBeNull();
    expect(result.logsToAdd).toBe(2);
  });

  it("only writes the shortfall when the timer already ran today", () => {
    const agendas = [
      makeAgenda({
        id: "a",
        todo_id: "t",
        start_at: onDay(TODAY),
        allocated_pomodoro: 3,
      }),
    ];
    const logs = [
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
    ];
    const result = plan(3, { agendas, logs });
    expect(result.alreadyToday).toBe(2);
    expect(result.logsToAdd).toBe(1);
  });

  it("writes nothing when the answer is already fully credited", () => {
    const agendas = [
      makeAgenda({
        id: "a",
        todo_id: "t",
        start_at: onDay(TODAY),
        allocated_pomodoro: 2,
      }),
    ];
    const logs = [
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
      makeLog({ agenda_id: "a", started_at: onDay(TODAY) }),
    ];
    const result = plan(2, { agendas, logs });
    expect(result.logsToAdd).toBe(0);
    expect(result.createAgenda).toBeNull();
    expect(result.topUpAgendaId).toBeNull();
  });

  it("accepts zero — a todo finished without any pomodoro", () => {
    const result = plan(0);
    expect(result.logsToAdd).toBe(0);
    expect(result.createAgenda).toBeNull();
  });

  it("ignores an agenda on another day when deciding where to put today's work", () => {
    const agendas = [
      makeAgenda({
        id: "old",
        todo_id: "t",
        start_at: onDay("2026-08-24"),
        allocated_pomodoro: 5,
      }),
    ];
    const result = plan(2, { agendas });
    expect(result.createAgenda).toEqual({ allocated: 2 });
    expect(result.topUpAgendaId).toBeNull();
  });

  it("tops up the latest agenda of the day, accounting for the others", () => {
    const agendas = [
      makeAgenda({
        id: "early",
        todo_id: "t",
        start_at: `${TODAY}T01:00:00.000Z`,
        allocated_pomodoro: 1,
      }),
      makeAgenda({
        id: "late",
        todo_id: "t",
        start_at: `${TODAY}T06:00:00.000Z`,
        allocated_pomodoro: 1,
      }),
    ];
    const result = plan(5, { agendas });
    expect(result.topUpAgendaId).toBe("late");
    // The early agenda already contributes 1, so the late one carries 4.
    expect(result.topUpAllocatedTo).toBe(4);
  });

  it("ignores drafts and cancelled agendas", () => {
    const agendas = [
      makeAgenda({
        id: "d",
        todo_id: "t",
        start_at: onDay(TODAY),
        allocated_pomodoro: 9,
        status: "draft",
      }),
    ];
    const result = plan(2, { agendas });
    expect(result.createAgenda).toEqual({ allocated: 2 });
  });
});
