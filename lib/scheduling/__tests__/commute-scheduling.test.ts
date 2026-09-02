import { describe, expect, it } from "vitest";

import type { Place, UUID } from "@/lib/db/schema";
import { resolveWindows } from "@/lib/scheduling/availability";
import { allocate } from "@/lib/scheduling/allocate";
import { travelMinutes, type CommuteStop } from "@/lib/scheduling/commute";
import { buildFreeSpace, occupy } from "@/lib/scheduling/freespace";
import { earliestStartIn, suggestSlots } from "@/lib/scheduling/placement";
import type {
  BusyInterval,
  DefaultBuffers,
  SchedulableTodo,
  SessionShape,
} from "@/lib/scheduling/types";

import { JKT, allDays, at, fmt, sw } from "./helpers";

/**
 * The scheduler's half of the commute rule: reserving space for a journey that
 * has not been taken yet.
 *
 * The arithmetic itself is `buffers.test.ts`'s — §5.2 is untouched by any of
 * this. What is under test here is only *which* BufferSide a candidate is
 * charged, and that the free-space map tracks where you would be.
 */

const DAY = "2026-08-26"; // a Wednesday
const NEXT = "2026-08-27";

const place = (id: string, latitude: number, longitude: number): Place => ({
  id,
  user_id: "u",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  deleted_at: null,
  dirty: 0,
  name: id,
  latitude,
  longitude,
  sort_order: 0,
});

const HOME = place("home", -6.9175, 107.6191);
const OFFICE = place("office", -6.8915, 107.6107); // ~4.1 km by road from home
const PLACES: ReadonlyMap<UUID, Place> = new Map([
  [HOME.id, HOME],
  [OFFICE.id, OFFICE],
]);

const SPEED = 22;
/** 20 minutes — pinned so a change in the model shows up as a failure here. */
const HOME_TO_OFFICE = travelMinutes(HOME, OFFICE, SPEED);

const windows = (from = DAY, to = DAY) =>
  resolveWindows(allDays("09:00", "17:00"), from, to, JKT);

const stop = (date: string, time: string, placeId: string | null): CommuteStop => ({
  key: `${date}-${time}`,
  date,
  start: at(date, time),
  placeId,
});

function agendaBusy(
  date: string,
  from: string,
  to: string,
  after = sw(0),
  agendaId = "a1",
): BusyInterval {
  const core = { start: at(date, from), end: at(date, to) };
  return {
    source: "agenda",
    agendaId,
    core,
    start: core.start,
    end: core.end + after.min * 60_000,
    bufferBefore: sw(0),
    bufferAfter: after,
  };
}

/* ------------------------------------------------------------------ */
/* the free-space map knows where you would be                         */
/* ------------------------------------------------------------------ */

describe("FreeInterval.originPlaceId", () => {
  it("is home at the start of the day", () => {
    const free = buildFreeSpace(windows(), [], { homePlaceId: HOME.id });
    expect(free[0]!.originPlaceId).toBe(HOME.id);
  });

  it("is null when no home pin has been dropped", () => {
    const free = buildFreeSpace(windows(), []);
    expect(free[0]!.originPlaceId).toBeNull();
  });

  it("becomes the last committed block's place", () => {
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "11:00", "12:00")], {
      homePlaceId: HOME.id,
      stops: [stop(DAY, "11:00", OFFICE.id)],
    });
    expect(free.map(fmt)).toEqual(["09:00–11:00", "12:00–17:00"]);
    expect(free[0]!.originPlaceId).toBe(HOME.id);
    expect(free[1]!.originPlaceId).toBe(OFFICE.id);
  });

  it("is not moved by a block with no location", () => {
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "11:00", "12:00")], {
      homePlaceId: HOME.id,
      stops: [stop(DAY, "11:00", null)],
    });
    expect(free[1]!.originPlaceId).toBe(HOME.id);
  });

  it("is not moved by a prayer block or external busy time", () => {
    const free = buildFreeSpace(
      windows(),
      [{ source: "prayer", start: at(DAY, "11:52"), end: at(DAY, "12:12") }],
      { homePlaceId: HOME.id, stops: [] },
    );
    expect(free[1]!.originPlaceId).toBe(HOME.id);
  });

  it("restarts at home the next day", () => {
    const free = buildFreeSpace(
      windows(DAY, NEXT),
      [agendaBusy(DAY, "15:00", "16:00")],
      { homePlaceId: HOME.id, stops: [stop(DAY, "15:00", OFFICE.id)] },
    );
    const tomorrow = free.filter((i) => i.date === NEXT);
    expect(tomorrow[0]!.originPlaceId).toBe(HOME.id);
  });

  it("follows a placement through `occupy`", () => {
    const free = buildFreeSpace(windows(), [], { homePlaceId: HOME.id });
    const after = occupy(free, {
      start: at(DAY, "10:00"),
      end: at(DAY, "11:00"),
      agendaId: "new",
      bufferBefore: sw(0),
      bufferAfter: sw(0),
      placeId: OFFICE.id,
    });
    expect(after[1]!.originPlaceId).toBe(OFFICE.id);
  });
});

/* ------------------------------------------------------------------ */
/* charging the journey                                                */
/* ------------------------------------------------------------------ */

const buffers: DefaultBuffers = { before: sw(0), after: sw(10) };
const shape: SessionShape = { focusMin: 25, shortBreakMin: 5 };

describe("earliestStartIn — with a journey to pay for", () => {
  it("is unchanged when the work has no location", () => {
    const free = buildFreeSpace(windows(), [], { homePlaceId: HOME.id });
    const plain = earliestStartIn(free[0]!, 25, buffers);
    const priced = earliestStartIn(free[0]!, 25, buffers, -Infinity, true, {
      placeId: null,
      places: PLACES,
      speedKmh: SPEED,
    });
    expect(priced).toBe(plain);
  });

  it("charges nothing against a window edge, however far the journey", () => {
    // §5.2: a buffer may spill past the window edge, so the day's first slot
    // still starts at 09:00 — the commute simply runs before the window.
    const free = buildFreeSpace(windows(), [], { homePlaceId: HOME.id });
    const start = earliestStartIn(free[0]!, 25, buffers, -Infinity, true, {
      placeId: OFFICE.id,
      places: PLACES,
      speedKmh: SPEED,
    });
    expect(start).toBe(at(DAY, "09:00"));
  });

  it("stacks the journey on top of a neighbour's switch buffer", () => {
    // Predecessor at home until 11:00 with a 10-minute switch buffer, so the
    // map already reserves to 11:10. §5.2 sums across types, so the candidate
    // owes the whole journey on top: 11:10 + 20 = 11:30.
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "10:00", "11:00", sw(10))], {
      homePlaceId: HOME.id,
      stops: [stop(DAY, "10:00", HOME.id)],
    });
    const interval = free[1]!;
    expect(fmt(interval)).toBe("11:10–17:00");

    const start = earliestStartIn(interval, 25, buffers, -Infinity, true, {
      placeId: OFFICE.id,
      places: PLACES,
      speedKmh: SPEED,
    });
    expect(start).toBe(at(DAY, "11:10") + HOME_TO_OFFICE * 60_000);
  });

  it("charges nothing when the previous block was at the same place", () => {
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "10:00", "11:00", sw(10))], {
      homePlaceId: HOME.id,
      stops: [stop(DAY, "10:00", OFFICE.id)],
    });
    const start = earliestStartIn(free[1]!, 25, buffers, -Infinity, true, {
      placeId: OFFICE.id,
      places: PLACES,
      speedKmh: SPEED,
    });
    expect(start).toBe(at(DAY, "11:10"));
  });
});

/* ------------------------------------------------------------------ */
/* suggestions and allocation                                          */
/* ------------------------------------------------------------------ */

const todo = (overrides: Partial<SchedulableTodo> = {}): SchedulableTodo => ({
  id: "t1",
  title: "Todo",
  categoryId: null,
  tags: [],
  priority: 4,
  dueDate: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  remainingToAllocate: 1,
  blocked: false,
  placeId: null,
  parentId: null,
  depth: 1,
  ...overrides,
});

describe("suggestSlots", () => {
  it("never offers a slot that has no room for the journey", () => {
    // A 30-minute gap between two blocks: enough for a 25-minute session on its
    // own, not enough once a 20-minute journey has to fit in front of it.
    const free = buildFreeSpace(
      windows(),
      [
        agendaBusy(DAY, "09:00", "10:00", sw(0), "a1"),
        agendaBusy(DAY, "10:30", "16:00", sw(0), "a2"),
      ],
      { homePlaceId: HOME.id, stops: [stop(DAY, "09:00", HOME.id)] },
    );

    const withoutLocation = suggestSlots({
      todo: { categoryId: null, tags: [], priority: 4 },
      free,
      timeBlocks: [],
      buffers: { before: sw(0), after: sw(0) },
      shape,
      pomodoros: 1,
      limit: 1,
    });
    expect(fmt(withoutLocation[0]!)).toBe("10:00–10:25");

    const withLocation = suggestSlots({
      todo: { categoryId: null, tags: [], priority: 4 },
      free,
      timeBlocks: [],
      buffers: { before: sw(0), after: sw(0) },
      shape,
      pomodoros: 1,
      limit: 1,
      commute: { placeId: OFFICE.id, places: PLACES, speedKmh: SPEED },
    });
    expect(fmt(withLocation[0]!)).not.toBe("10:00–10:25");
  });
});

describe("allocate", () => {
  it("does not charge a second journey for a session at the same place", () => {
    const free = buildFreeSpace(windows(), [], { homePlaceId: HOME.id });
    const result = allocate({
      todos: [todo({ remainingToAllocate: 2, placeId: OFFICE.id })],
      free,
      timeBlocks: [],
      shape,
      buffers,
      places: PLACES,
      commuteSpeedKmh: SPEED,
      newId: (() => {
        let n = 0;
        return () => `d${++n}`;
      })(),
    });

    expect(result.placements).toHaveLength(1);
    // 2 pomodoros = 55 minutes, in one session, starting at the window edge —
    // where §5.2 lets the journey spill past.
    expect(result.placements[0]!.start).toBe(at(DAY, "09:00"));
  });

  it("leaves room for the journey between two places", () => {
    // One session already at home, so the office session must travel.
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "09:00", "10:00", sw(10))], {
      homePlaceId: HOME.id,
      stops: [stop(DAY, "09:00", HOME.id)],
    });

    const result = allocate({
      todos: [todo({ placeId: OFFICE.id })],
      free,
      timeBlocks: [],
      shape,
      buffers,
      places: PLACES,
      commuteSpeedKmh: SPEED,
      newId: () => "d1",
    });

    expect(result.placements[0]!.start).toBe(
      at(DAY, "10:10") + HOME_TO_OFFICE * 60_000,
    );
  });

  it("behaves exactly as before when no places are supplied", () => {
    const free = buildFreeSpace(windows(), [agendaBusy(DAY, "09:00", "10:00", sw(10))]);
    const result = allocate({
      todos: [todo({ placeId: OFFICE.id })],
      free,
      timeBlocks: [],
      shape,
      buffers,
      newId: () => "d1",
    });
    expect(result.placements[0]!.start).toBe(at(DAY, "10:10"));
  });
});
