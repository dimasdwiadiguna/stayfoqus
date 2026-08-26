import { describe, expect, it } from "vitest";

import { resolveWindows } from "@/lib/scheduling/availability";
import { buildFreeSpace, freeMinutes, occupy } from "@/lib/scheduling/freespace";
import type { BusyInterval } from "@/lib/scheduling/types";

import { JKT, allDays, at, cm, fmt, sw, windowSpec } from "./helpers";

const DAY = "2026-08-26"; // a Wednesday
const windows = () => resolveWindows(allDays("09:00", "17:00"), DAY, DAY, JKT);

function agendaBusy(
  from: string,
  to: string,
  before = sw(0),
  after = sw(0),
  agendaId = "a1",
): BusyInterval {
  const core = { start: at(DAY, from), end: at(DAY, to) };
  return {
    source: "agenda",
    agendaId,
    core,
    start: core.start - before.min * 60_000,
    end: core.end + after.min * 60_000,
    bufferBefore: before,
    bufferAfter: after,
  };
}

describe("§5.5 Step 1 — free-space map", () => {
  it("returns the whole window when nothing blocks it", () => {
    const free = buildFreeSpace(windows(), []);
    expect(free).toHaveLength(1);
    expect(fmt(free[0]!)).toBe("09:00–17:00");
    expect(free[0]!.before).toEqual({ kind: "window" });
    expect(free[0]!.after).toEqual({ kind: "window" });
  });

  it("subtracts an agenda together with its buffers", () => {
    const free = buildFreeSpace(windows(), [
      agendaBusy("11:00", "12:00", sw(15), sw(10)),
    ]);
    expect(free.map(fmt)).toEqual(["09:00–10:45", "12:10–17:00"]);
  });

  it("records the neighbouring agenda's facing buffer on each edge", () => {
    const free = buildFreeSpace(windows(), [
      agendaBusy("11:00", "12:00", sw(15), cm(10)),
    ]);
    expect(free[0]!.after).toEqual({
      kind: "agenda",
      agendaId: "a1",
      buffer: sw(15),
    });
    expect(free[1]!.before).toEqual({
      kind: "agenda",
      agendaId: "a1",
      buffer: cm(10),
    });
  });

  it("subtracts prayer blocks, which present an obstacle edge", () => {
    const prayer: BusyInterval = {
      source: "prayer",
      start: at(DAY, "11:53"),
      end: at(DAY, "12:13"),
      label: "dhuhr",
    };
    const free = buildFreeSpace(windows(), [prayer]);
    expect(free.map(fmt)).toEqual(["09:00–11:53", "12:13–17:00"]);
    expect(free[0]!.after).toEqual({ kind: "obstacle", obstacle: "prayer" });
    expect(free[1]!.before).toEqual({ kind: "obstacle", obstacle: "prayer" });
  });

  it("subtracts external busy time from other calendars", () => {
    const busy: BusyInterval = {
      source: "gcal_busy",
      start: at(DAY, "14:00"),
      end: at(DAY, "15:30"),
      label: "Standup",
    };
    const free = buildFreeSpace(windows(), [busy]);
    expect(free.map(fmt)).toEqual(["09:00–14:00", "15:30–17:00"]);
  });

  it("merges overlapping blockers instead of emitting negative gaps", () => {
    const free = buildFreeSpace(windows(), [
      agendaBusy("11:00", "12:00", sw(0), sw(30), "a1"),
      agendaBusy("12:15", "13:00", sw(30), sw(0), "a2"),
    ]);
    // The two buffers overlap between 12:00 and 12:30; the map must not
    // produce a zero-or-negative sliver between them.
    expect(free.map(fmt)).toEqual(["09:00–11:00", "13:00–17:00"]);
  });

  it("clips a blocker that extends past the window edge", () => {
    const free = buildFreeSpace(windows(), [
      agendaBusy("16:00", "17:00", sw(0), sw(30)),
    ]);
    // The trailing buffer spills past 17:00 — legal per §5.2 — and simply ends
    // the free space at 16:00.
    expect(free.map(fmt)).toEqual(["09:00–16:00"]);
  });

  it("drops a blocker that lies entirely outside the window", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("06:00", "07:00")]);
    expect(free.map(fmt)).toEqual(["09:00–17:00"]);
  });

  it("returns nothing when a blocker covers the whole window", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("08:00", "18:00")]);
    expect(free).toEqual([]);
  });

  it("honours the minimum-length filter", () => {
    const free = buildFreeSpace(
      windows(),
      [agendaBusy("09:20", "16:00")],
      { minimumMinutes: 30 },
    );
    // The 20-minute head is dropped; the hour-long tail survives.
    expect(free.map(fmt)).toEqual(["16:00–17:00"]);
  });

  it("keeps split windows on the same day separate", () => {
    const split = resolveWindows(
      [windowSpec(3, "04:00", "07:00"), windowSpec(3, "09:00", "22:00")],
      DAY,
      DAY,
      JKT,
    );
    const free = buildFreeSpace(split, []);
    expect(free.map(fmt)).toEqual(["04:00–07:00", "09:00–22:00"]);
  });

  it("sums free minutes", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("12:00", "13:00")]);
    expect(freeMinutes(free)).toBe(7 * 60);
  });
});

describe("occupy — updating the map after a placement", () => {
  const placement = (from: string, to: string, before = sw(0), after = sw(0)) => ({
    start: at(DAY, from),
    end: at(DAY, to),
    agendaId: "new",
    bufferBefore: before,
    bufferAfter: after,
  });

  it("splits the interval the placement landed in", () => {
    const free = buildFreeSpace(windows(), []);
    const next = occupy(free, placement("10:00", "10:55"));
    expect(next.map(fmt)).toEqual(["09:00–10:00", "10:55–17:00"]);
    expect(next[0]!.after).toEqual({
      kind: "agenda",
      agendaId: "new",
      buffer: sw(0),
    });
  });

  it("removes the placement's buffers from the map too", () => {
    // Without this, the next candidate could start the instant this one ends,
    // and the §5.2 gap accounting would double-count the same buffer.
    const free = buildFreeSpace(windows(), []);
    const next = occupy(free, placement("10:00", "10:55", sw(15), sw(10)));
    expect(next.map(fmt)).toEqual(["09:00–09:45", "11:05–17:00"]);
    expect(next[1]!.before).toEqual({
      kind: "agenda",
      agendaId: "new",
      buffer: sw(10),
    });
  });

  it("removes an interval consumed exactly", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("10:00", "17:00")]);
    const next = occupy(free, placement("09:00", "10:00"));
    expect(next).toEqual([]);
  });

  it("leaves untouched intervals alone", () => {
    const free = buildFreeSpace(windows(), [agendaBusy("12:00", "13:00")]);
    const next = occupy(free, placement("13:00", "13:55"));
    expect(next.map(fmt)).toEqual(["09:00–12:00", "13:55–17:00"]);
  });
});
