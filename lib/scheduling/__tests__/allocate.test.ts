import { describe, expect, it } from "vitest";

import { allocate, sortCandidates } from "@/lib/scheduling/allocate";
import { resolveWindows } from "@/lib/scheduling/availability";
import { buildFreeSpace } from "@/lib/scheduling/freespace";
import { expandTimeBlocks } from "@/lib/scheduling/timeblocks";
import type {
  BusyInterval,
  SchedulableTodo,
} from "@/lib/scheduling/types";

import { JKT, allDays, at, fmt, sw, timeBlock } from "./helpers";

const SHAPE = { focusMin: 25, shortBreakMin: 5 };
const BUFFERS = { before: sw(0), after: sw(10) };

/** 2026-08-26 is a Wednesday; the range below runs Wed → Fri. */
const MON = "2026-08-24";
const WED = "2026-08-26";
const THU = "2026-08-27";
const FRI = "2026-08-28";

let seq = 0;
const newId = () => `draft-${String(++seq).padStart(3, "0")}`;
const resetIds = () => {
  seq = 0;
};

function todo(overrides: Partial<SchedulableTodo> = {}): SchedulableTodo {
  return {
    id: "t1",
    title: "Todo",
    categoryId: null,
    tags: [],
    priority: 4,
    dueDate: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    remainingToAllocate: 1,
    blocked: false,
    parentId: null,
    depth: 1,
    ...overrides,
  };
}

function freeFor(from: string, to: string, busy: BusyInterval[] = []) {
  return buildFreeSpace(resolveWindows(allDays("09:00", "17:00"), from, to, JKT), busy);
}

function run(
  todos: SchedulableTodo[],
  opts: Partial<Parameters<typeof allocate>[0]> = {},
) {
  resetIds();
  return allocate({
    todos,
    free: opts.free ?? freeFor(WED, WED),
    timeBlocks: opts.timeBlocks ?? [],
    shape: SHAPE,
    buffers: BUFFERS,
    notBefore: opts.notBefore,
    newId,
  });
}

describe("§5.5 Step 2 — candidate ordering", () => {
  it("excludes blocked todos entirely", () => {
    const order = sortCandidates([
      todo({ id: "a", blocked: true, remainingToAllocate: 4 }),
      todo({ id: "b", remainingToAllocate: 1 }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["b"]);
  });

  it("excludes todos with nothing left to allocate", () => {
    const order = sortCandidates([
      todo({ id: "a", remainingToAllocate: 0 }),
      todo({ id: "b", remainingToAllocate: 2 }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["b"]);
  });

  it("puts the earliest due date first and nulls last", () => {
    const order = sortCandidates([
      todo({ id: "none", dueDate: null }),
      todo({ id: "late", dueDate: "2026-09-01" }),
      todo({ id: "soon", dueDate: "2026-08-27" }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["soon", "late", "none"]);
  });

  it("breaks a due-date tie by priority, highest first", () => {
    const order = sortCandidates([
      todo({ id: "p4", priority: 4, dueDate: "2026-08-27" }),
      todo({ id: "p1", priority: 1, dueDate: "2026-08-27" }),
      todo({ id: "p2", priority: 2, dueDate: "2026-08-27" }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["p1", "p2", "p4"]);
  });

  it("then by largest remaining_to_allocate", () => {
    const order = sortCandidates([
      todo({ id: "small", remainingToAllocate: 1 }),
      todo({ id: "big", remainingToAllocate: 6 }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["big", "small"]);
  });

  it("then by created_at ascending — the determinism tiebreaker", () => {
    const order = sortCandidates([
      todo({ id: "new", createdAt: "2026-08-05T00:00:00.000Z" }),
      todo({ id: "old", createdAt: "2026-08-01T00:00:00.000Z" }),
    ]);
    expect(order.map((x) => x.id)).toEqual(["old", "new"]);
  });

  it("is a total order even for identical rows", () => {
    const identical = [
      todo({ id: "zzz" }),
      todo({ id: "aaa" }),
      todo({ id: "mmm" }),
    ];
    expect(sortCandidates(identical).map((x) => x.id)).toEqual([
      "aaa",
      "mmm",
      "zzz",
    ]);
  });
});

describe("§5.5 Step 3 — placement", () => {
  it("places one pomodoro at the start of the window", () => {
    const { placements } = run([todo({ remainingToAllocate: 1 })]);
    expect(placements).toHaveLength(1);
    expect(fmt(placements[0]!)).toBe("09:00–09:25");
    expect(placements[0]!.pomodoros).toBe(1);
  });

  it("caps a session at 4 pomodoros", () => {
    const { placements } = run([todo({ remainingToAllocate: 6 })]);
    expect(placements[0]!.pomodoros).toBe(4);
    expect(fmt(placements[0]!)).toBe("09:00–10:55");
  });

  it("leaves the required gap between its own back-to-back sessions", () => {
    const { placements } = run([todo({ remainingToAllocate: 6 })]);
    // The first draft carries a 10-minute switch after-buffer; the second's
    // before-buffer is 0, so §5.2 gives required_gap = 10.
    expect(placements).toHaveLength(2);
    expect(fmt(placements[0]!)).toBe("09:00–10:55");
    // The remaining 2 pomodoros are a 55-minute session (2x25 + 1x5).
    expect(fmt(placements[1]!)).toBe("11:05–12:00");
  });

  it("caps a todo at 2 sessions per day and reports the rest as unfit", () => {
    const { placements, unfit } = run([todo({ remainingToAllocate: 12 })]);
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.date === WED)).toBe(true);
    // 4 + 4 placed, 4 left over with nowhere legal to go today.
    expect(unfit).toEqual([
      { todo: expect.objectContaining({ id: "t1" }), remaining: 4 },
    ]);
  });

  it("spreads the same todo across days when the range allows", () => {
    const { placements, unfit } = run([todo({ remainingToAllocate: 12 })], {
      free: freeFor(WED, FRI),
    });
    expect(unfit).toEqual([]);
    expect(placements).toHaveLength(3);
    expect(placements.map((p) => p.date)).toEqual([WED, WED, THU]);
    expect(placements.reduce((n, p) => n + p.pomodoros, 0)).toBe(12);
  });

  it("falls back to a smaller session when the full one will not fit", () => {
    // Only 09:00–09:40 is free, which fits 1 pomodoro but not 2.
    const busy: BusyInterval[] = [
      { source: "gcal_busy", start: at(WED, "09:40"), end: at(WED, "17:00") },
    ];
    const { placements } = run([todo({ remainingToAllocate: 4 })], {
      free: freeFor(WED, WED, busy),
    });
    expect(placements).toHaveLength(1);
    expect(placements[0]!.pomodoros).toBe(1);
    expect(fmt(placements[0]!)).toBe("09:00–09:25");
  });

  it("never places anything outside an availability window", () => {
    const { placements } = run([todo({ remainingToAllocate: 20 })], {
      free: freeFor(WED, WED),
    });
    for (const p of placements) {
      expect(p.start).toBeGreaterThanOrEqual(at(WED, "09:00"));
      expect(p.end).toBeLessThanOrEqual(at(WED, "17:00"));
    }
  });

  it("never overlaps a prayer block", () => {
    const prayer: BusyInterval = {
      source: "prayer",
      start: at(WED, "11:53"),
      end: at(WED, "12:13"),
    };
    const { placements } = run([todo({ remainingToAllocate: 8 })], {
      free: freeFor(WED, WED, [prayer]),
    });
    for (const p of placements) {
      expect(p.start < prayer.end && prayer.start < p.end).toBe(false);
    }
  });

  it("never overlaps external busy time", () => {
    const busy: BusyInterval = {
      source: "gcal_busy",
      start: at(WED, "10:00"),
      end: at(WED, "11:00"),
    };
    const { placements } = run([todo({ remainingToAllocate: 8 })], {
      free: freeFor(WED, WED, [busy]),
    });
    for (const p of placements) {
      expect(p.start < busy.end && busy.start < p.end).toBe(false);
    }
  });

  it("respects notBefore", () => {
    const { placements } = run([todo({ remainingToAllocate: 1 })], {
      notBefore: at(WED, "14:00"),
    });
    expect(fmt(placements[0]!)).toBe("14:00–14:25");
  });
});

describe("§5.4 — time blocks are hard for the allocator", () => {
  const morningBlock = () =>
    expandTimeBlocks(
      [
        timeBlock({
          start_time: "09:00",
          end_time: "12:00",
          days_of_week: [3],
          filter_tags: ["menulis"],
        }),
      ],
      [],
      WED,
      WED,
      JKT,
    );

  it("only places a matching todo inside the block", () => {
    const { placements } = run([todo({ tags: ["menulis"], remainingToAllocate: 1 })], {
      timeBlocks: morningBlock(),
    });
    expect(fmt(placements[0]!)).toBe("09:00–09:25");
  });

  it("steps a non-matching todo past the block instead of the whole day", () => {
    const { placements } = run([todo({ tags: ["riset"], remainingToAllocate: 1 })], {
      timeBlocks: morningBlock(),
    });
    expect(fmt(placements[0]!)).toBe("12:00–12:25");
  });

  it("leaves the slot empty rather than backfilling a non-matching todo", () => {
    // The block covers the whole window and nothing matches it.
    const blocks = expandTimeBlocks(
      [
        timeBlock({
          start_time: "09:00",
          end_time: "17:00",
          days_of_week: [3],
          filter_priorities: [1],
        }),
      ],
      [],
      WED,
      WED,
      JKT,
    );
    const { placements, unfit } = run(
      [todo({ priority: 4, remainingToAllocate: 3 })],
      { timeBlocks: blocks },
    );
    expect(placements).toEqual([]);
    expect(unfit[0]?.remaining).toBe(3);
  });
});

describe("§5.5 Step 4 — the remainder", () => {
  it("reports what did not fit instead of spilling into next week", () => {
    const { placements, unfit } = run(
      [
        todo({ id: "a", remainingToAllocate: 8, dueDate: "2026-08-26" }),
        todo({ id: "b", remainingToAllocate: 8, dueDate: "2026-08-27" }),
      ],
      { free: freeFor(WED, WED) },
    );

    // The window is 8 h; nothing may be placed beyond it.
    for (const p of placements) {
      expect(p.end).toBeLessThanOrEqual(at(WED, "17:00"));
    }
    expect(unfit.length).toBeGreaterThan(0);
    expect(unfit.map((u) => u.todo.id)).toContain("b");
  });

  it("returns no remainder when everything fits", () => {
    const { unfit } = run([todo({ remainingToAllocate: 2 })]);
    expect(unfit).toEqual([]);
  });
});

describe("determinism", () => {
  const fixture = () => [
    todo({ id: "a", remainingToAllocate: 5, priority: 2, dueDate: "2026-08-27" }),
    todo({ id: "b", remainingToAllocate: 3, priority: 1, dueDate: "2026-08-27" }),
    todo({ id: "c", remainingToAllocate: 7, priority: 3 }),
  ];

  it("produces identical output across runs", () => {
    const first = run(fixture(), { free: freeFor(MON, FRI) });
    const second = run(fixture(), { free: freeFor(MON, FRI) });
    expect(second).toEqual(first);
  });

  it("does not depend on the input array's order", () => {
    const forward = run(fixture(), { free: freeFor(MON, FRI) });
    const reversed = run(fixture().reverse(), { free: freeFor(MON, FRI) });
    expect(
      reversed.placements.map((p) => `${p.todoId}@${p.start}:${p.pomodoros}`),
    ).toEqual(forward.placements.map((p) => `${p.todoId}@${p.start}:${p.pomodoros}`));
  });

  it("returns placements in chronological order", () => {
    const { placements } = run(fixture(), { free: freeFor(MON, FRI) });
    const starts = placements.map((p) => p.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });
});

describe("fixture scenario — a realistic week", () => {
  it("honours priority order under contention", () => {
    // One day, 8 hours. Three todos want 6 pomodoros each; only some fit.
    const { placements } = run(
      [
        todo({ id: "urgent", priority: 1, remainingToAllocate: 6, dueDate: "2026-08-26" }),
        todo({ id: "normal", priority: 3, remainingToAllocate: 6, dueDate: "2026-08-26" }),
      ],
      { free: freeFor(WED, WED) },
    );

    const first = placements[0]!;
    expect(first.todoId).toBe("urgent");
    // The urgent todo gets both of its allowed sessions before the other
    // todo is considered for its second.
    const urgentTotal = placements
      .filter((p) => p.todoId === "urgent")
      .reduce((n, p) => n + p.pomodoros, 0);
    expect(urgentTotal).toBe(6);
  });
});

describe("a parent may not be scheduled before its children", () => {
  const parent = () =>
    todo({ id: "parent", depth: 1, remainingToAllocate: 1, priority: 1 });
  const child = (id: string, overrides: Partial<SchedulableTodo> = {}) =>
    todo({
      id,
      parentId: "parent",
      depth: 2,
      remainingToAllocate: 1,
      priority: 4,
      ...overrides,
    });

  it("considers deeper todos first, whatever the §5.5 order would say", () => {
    // The parent is P1 and would otherwise sort ahead of both children.
    const order = sortCandidates([parent(), child("c1"), child("c2")]);
    expect(order.map((x) => x.id)).toEqual(["c1", "c2", "parent"]);
  });

  it("keeps the §5.5 order within a depth level", () => {
    const order = sortCandidates([
      child("late", { dueDate: "2026-09-01" }),
      child("soon", { dueDate: "2026-08-27" }),
      parent(),
    ]);
    expect(order.map((x) => x.id)).toEqual(["soon", "late", "parent"]);
  });

  it("starts the parent only after its last child ends", () => {
    const { placements } = run([parent(), child("c1"), child("c2")]);
    const byId = new Map(placements.map((p) => [p.todoId, p]));

    const parentStart = byId.get("parent")!.start;
    const lastChildEnd = Math.max(byId.get("c1")!.end, byId.get("c2")!.end);
    expect(parentStart).toBeGreaterThanOrEqual(lastChildEnd);
  });

  it("respects a grandchild through its parent", () => {
    const grandchild = todo({
      id: "g",
      parentId: "c1",
      depth: 3,
      remainingToAllocate: 1,
    });
    const { placements } = run([parent(), child("c1"), grandchild]);
    const byId = new Map(placements.map((p) => [p.todoId, p]));

    expect(byId.get("c1")!.start).toBeGreaterThanOrEqual(byId.get("g")!.end);
    expect(byId.get("parent")!.start).toBeGreaterThanOrEqual(byId.get("c1")!.end);
  });

  it("honours a child agenda that already exists outside this run", () => {
    resetIds();
    const existingEnd = at(WED, "14:00");
    const { placements } = allocate({
      todos: [parent(), child("c1", { remainingToAllocate: 0 })],
      free: freeFor(WED, WED),
      timeBlocks: [],
      shape: SHAPE,
      buffers: BUFFERS,
      existingEndByTodo: new Map([["c1", existingEnd]]),
      newId,
    });
    const parentPlacement = placements.find((p) => p.todoId === "parent")!;
    expect(parentPlacement.start).toBeGreaterThanOrEqual(existingEnd);
  });

  it("reports the parent as unfit when no slot after its children exists", () => {
    // The child consumes the tail of the day, leaving nothing after it.
    const busy: BusyInterval[] = [
      { source: "gcal_busy", start: at(WED, "09:00"), end: at(WED, "16:50") },
    ];
    const { unfit } = run([parent(), child("c1")], {
      free: freeFor(WED, WED, busy),
    });
    expect(unfit.map((u) => u.todo.id)).toContain("parent");
  });
});
