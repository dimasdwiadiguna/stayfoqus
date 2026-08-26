import { describe, expect, it } from "vitest";

import { resolveWindows } from "@/lib/scheduling/availability";
import { buildFreeSpace } from "@/lib/scheduling/freespace";
import { earliestStartIn, suggestSlots } from "@/lib/scheduling/placement";
import {
  largestSessionFitting,
  pomodorosForDuration,
  sessionDurationMin,
} from "@/lib/scheduling/session";
import { expandTimeBlocks } from "@/lib/scheduling/timeblocks";
import type { BusyInterval, SchedulableTodo } from "@/lib/scheduling/types";

import { JKT, allDays, at, cm, fmt, sw, timeBlock } from "./helpers";

const DAY = "2026-08-26";
const SHAPE = { focusMin: 25, shortBreakMin: 5 };
const windows = () => resolveWindows(allDays("09:00", "17:00"), DAY, DAY, JKT);

const todo: Pick<SchedulableTodo, "categoryId" | "tags" | "priority"> = {
  categoryId: "cat-work",
  tags: ["riset"],
  priority: 2,
};

function agendaBusy(from: string, to: string, before = sw(0), after = sw(0)) {
  const core = { start: at(DAY, from), end: at(DAY, to) };
  return {
    source: "agenda",
    agendaId: "a1",
    core,
    start: core.start - before.min * 60_000,
    end: core.end + after.min * 60_000,
    bufferBefore: before,
    bufferAfter: after,
  } satisfies BusyInterval;
}

describe("§5.5 Step 3 — session geometry", () => {
  it("matches the brief: 1→25m, 2→55m, 3→85m, 4→115m", () => {
    expect(sessionDurationMin(1, SHAPE)).toBe(25);
    expect(sessionDurationMin(2, SHAPE)).toBe(55);
    expect(sessionDurationMin(3, SHAPE)).toBe(85);
    expect(sessionDurationMin(4, SHAPE)).toBe(115);
  });

  it("follows custom pomodoro durations", () => {
    expect(sessionDurationMin(3, { focusMin: 50, shortBreakMin: 10 })).toBe(170);
  });

  it("finds the largest session that fits", () => {
    expect(largestSessionFitting(120, SHAPE)).toBe(4);
    expect(largestSessionFitting(114, SHAPE)).toBe(3);
    expect(largestSessionFitting(24, SHAPE)).toBe(0);
  });

  it("inverts a duration back to whole pomodoros for resize snapping (§8)", () => {
    expect(pomodorosForDuration(25, SHAPE)).toBe(1);
    expect(pomodorosForDuration(60, SHAPE)).toBe(2);
    expect(pomodorosForDuration(90, SHAPE)).toBe(3);
  });
});

describe("earliestStartIn — buffer-aware fitting", () => {
  it("starts at the window edge, charging nothing for its own buffer", () => {
    const free = buildFreeSpace(windows(), []);
    const start = earliestStartIn(free[0]!, 55, { before: sw(15), after: sw(10) });
    expect(fmt({ start: start!, end: start! + 55 * 60_000 })).toBe("09:00–09:55");
  });

  it("charges only the shortfall next to another agenda (§5.2 example 1)", () => {
    // Neighbour ends 11:00 with a 10-minute switch buffer → free from 11:10.
    // Candidate wants a 15-minute switch buffer → required gap 15 → 11:15.
    const free = buildFreeSpace(windows(), [agendaBusy("10:00", "11:00", sw(0), sw(10))]);
    const tail = free.find((f) => f.start >= at(DAY, "11:00"))!;
    const start = earliestStartIn(tail, 25, { before: sw(15), after: sw(10) });
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("11:15–11:40");
  });

  it("stacks across types (§5.2 example 2)", () => {
    // Neighbour: 10 switch. Candidate: 15 commute → required gap 25 → 11:25.
    const free = buildFreeSpace(windows(), [agendaBusy("10:00", "11:00", sw(0), sw(10))]);
    const tail = free.find((f) => f.start >= at(DAY, "11:00"))!;
    const start = earliestStartIn(tail, 25, { before: cm(15), after: sw(10) });
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("11:25–11:50");
  });

  it("charges nothing when the neighbour already reserved enough (§5.2 example 3)", () => {
    // Neighbour: 20 commute. Candidate: 15 commute → required gap 20, already
    // reserved 20 → the candidate may start the moment the buffer ends.
    const free = buildFreeSpace(windows(), [agendaBusy("10:00", "11:00", sw(0), cm(20))]);
    const tail = free.find((f) => f.start >= at(DAY, "11:00"))!;
    const start = earliestStartIn(tail, 25, { before: cm(15), after: sw(10) });
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("11:20–11:45");
  });

  it("charges nothing against a prayer block", () => {
    const prayer: BusyInterval = {
      source: "prayer",
      start: at(DAY, "11:53"),
      end: at(DAY, "12:13"),
    };
    const free = buildFreeSpace(windows(), [prayer]);
    const tail = free.find((f) => f.start >= at(DAY, "12:00"))!;
    const start = earliestStartIn(tail, 25, { before: cm(45), after: sw(10) });
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("12:15–12:40");
  });

  it("reserves the trailing edge against a following agenda", () => {
    // Free 09:00–10:45 (agenda 11:00 with a 15-minute switch before-buffer).
    // A 55-minute session with a 30-minute commute after-buffer needs
    // required_gap = 15 + 30 = 45, of which 15 is reserved → 30 more.
    const free = buildFreeSpace(windows(), [agendaBusy("11:00", "12:00", sw(15), sw(0))]);
    const head = free[0]!;
    const start = earliestStartIn(head, 55, { before: sw(0), after: cm(30) });
    expect(start).not.toBeNull();
    expect(start! + 55 * 60_000).toBeLessThanOrEqual(head.end - 30 * 60_000);
  });

  it("returns null when the session cannot fit", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("09:20", "17:00")]);
    expect(earliestStartIn(free[0]!, 25, { before: sw(0), after: sw(0) })).toBeNull();
  });

  it("snaps the start up to a 5-minute boundary", () => {
    const free = buildFreeSpace(windows(), [
      {
        source: "gcal_busy",
        start: at(DAY, "09:00"),
        end: at(DAY, "10:07"),
      },
    ]);
    const tail = free[0]!;
    const start = earliestStartIn(tail, 25, { before: sw(0), after: sw(0) });
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("10:10–10:35");
  });

  it("respects notBefore", () => {
    const free = buildFreeSpace(windows(), []);
    const start = earliestStartIn(
      free[0]!,
      25,
      { before: sw(0), after: sw(0) },
      at(DAY, "13:02"),
    );
    expect(fmt({ start: start!, end: start! + 25 * 60_000 })).toBe("13:05–13:30");
  });
});

describe("suggestSlots — the 3 recommended slots (§8, §5.8)", () => {
  const buffers = { before: sw(0), after: sw(10) };

  it("returns the earliest valid slots, one per free interval", () => {
    const free = buildFreeSpace(
      resolveWindows(allDays("09:00", "17:00"), DAY, "2026-08-28", JKT),
      [],
    );
    const slots = suggestSlots({
      todo,
      free,
      timeBlocks: [],
      buffers,
      shape: SHAPE,
      pomodoros: 2,
    });
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.date)).toEqual([
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
    expect(fmt(slots[0]!)).toBe("09:00–09:55");
  });

  it("falls back to a smaller session when the requested one will not fit", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("09:40", "17:00")]);
    const slots = suggestSlots({
      todo,
      free,
      timeBlocks: [],
      buffers,
      shape: SHAPE,
      pomodoros: 4,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.pomodoros).toBe(1);
    expect(fmt(slots[0]!)).toBe("09:00–09:25");
  });

  it("never suggests a slot before `notBefore`", () => {
    const free = buildFreeSpace(windows(), []);
    const slots = suggestSlots({
      todo,
      free,
      timeBlocks: [],
      buffers,
      shape: SHAPE,
      pomodoros: 1,
      notBefore: at(DAY, "15:20"),
    });
    expect(fmt(slots[0]!)).toBe("15:20–15:45");
  });

  it("steps past a time block the todo does not match (§5.4)", () => {
    const blocks = expandTimeBlocks(
      [
        timeBlock({
          start_time: "09:00",
          end_time: "12:00",
          days_of_week: [3],
          filter_tags: ["menulis"],
        }),
      ],
      [],
      DAY,
      DAY,
      JKT,
    );
    const free = buildFreeSpace(windows(), []);
    const slots = suggestSlots({
      todo, // tagged "riset" — does not match
      free,
      timeBlocks: blocks,
      buffers,
      shape: SHAPE,
      pomodoros: 1,
      limit: 1,
    });
    expect(fmt(slots[0]!)).toBe("12:00–12:25");
  });

  it("places inside a matching time block", () => {
    const blocks = expandTimeBlocks(
      [
        timeBlock({
          start_time: "09:00",
          end_time: "12:00",
          days_of_week: [3],
          filter_tags: ["riset"],
        }),
      ],
      [],
      DAY,
      DAY,
      JKT,
    );
    const free = buildFreeSpace(windows(), []);
    const slots = suggestSlots({
      todo,
      free,
      timeBlocks: blocks,
      buffers,
      shape: SHAPE,
      pomodoros: 1,
      limit: 1,
    });
    expect(fmt(slots[0]!)).toBe("09:00–09:25");
  });

  it("returns nothing when there is no free space at all", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("08:00", "18:00")]);
    expect(
      suggestSlots({ todo, free, timeBlocks: [], buffers, shape: SHAPE, pomodoros: 1 }),
    ).toEqual([]);
  });
});
