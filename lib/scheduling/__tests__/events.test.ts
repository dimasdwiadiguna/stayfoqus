import { describe, expect, it } from "vitest";

import { LOCAL_USER_ID, type CalendarEvent, type EventException } from "@/lib/db/schema";
import { eventBusy } from "@/lib/scheduling/context";
import {
  activeEvents,
  expandEvents,
  overlappingEvent,
} from "@/lib/scheduling/events";
import { buildFreeSpace } from "@/lib/scheduling/freespace";
import { edgePaddingMin } from "@/lib/scheduling/buffers";
import type { WindowInstance } from "@/lib/scheduling/types";

import { JKT, at, cm, fmt, span, sw } from "./helpers";

const TS = "2026-08-01T00:00:00.000Z";
/** 2026-08-25 is a Tuesday. */
const TUE = "2026-08-25";
const WED = "2026-08-26";

function ev(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: overrides.id ?? "e1",
    user_id: LOCAL_USER_ID,
    created_at: TS,
    updated_at: TS,
    deleted_at: null,
    dirty: 0,
    title: "Rapat tim",
    location: null,
    place_id: null,
    commute_auto: 1,
    notes: null,
    start_time: "13:00",
    end_time: "15:00",
    recurrence: "once",
    days_of_week: [],
    specific_date: WED,
    end_date: null,
    buffer_before_min: 0,
    buffer_before_type: "switch",
    buffer_after_min: 0,
    buffer_after_type: "switch",
    enabled: true,
    ...overrides,
  };
}

function skip(eventId: string, date: string): EventException {
  return {
    id: `x-${eventId}-${date}`,
    user_id: LOCAL_USER_ID,
    created_at: TS,
    updated_at: TS,
    deleted_at: null,
    dirty: 0,
    event_id: eventId,
    date,
    action: "skipped",
  };
}

const expand = (
  events: CalendarEvent[],
  exceptions: EventException[] = [],
  from = TUE,
  to = "2026-09-08",
) => expandEvents(events, exceptions, from, to, JKT);

describe("expanding events", () => {
  it("places a one-off on its own date only", () => {
    const out = expand([ev()]);
    expect(out).toHaveLength(1);
    expect(out[0]!.date).toBe(WED);
    expect(fmt(out[0]!)).toBe("13:00–15:00");
  });

  it("repeats weekly on the chosen days", () => {
    const out = expand([
      ev({ recurrence: "weekly", days_of_week: [2], specific_date: null }),
    ]);
    expect(out.map((e) => e.date)).toEqual([TUE, "2026-09-01", "2026-09-08"]);
  });

  it("stops repeating after end_date", () => {
    const out = expand([
      ev({
        recurrence: "weekly",
        days_of_week: [2],
        specific_date: null,
        end_date: "2026-09-01",
      }),
    ]);
    expect(out.map((e) => e.date)).toEqual([TUE, "2026-09-01"]);
  });

  it("ends on the following day when it wraps midnight", () => {
    // A time block would be skipped outright here; an event at 21:00–00:30 is
    // a thing that actually happens.
    const out = expand([ev({ start_time: "21:00", end_time: "00:30" })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.start).toBe(at(WED, "21:00"));
    expect(out[0]!.end).toBe(at("2026-08-27", "00:30"));
  });

  it("skips nothing when disabled rows and tombstones are present", () => {
    expect(expand([ev({ enabled: false })])).toHaveLength(0);
    expect(expand([ev({ deleted_at: TS })])).toHaveLength(0);
  });

  it("returns a skipped occurrence rather than dropping it", () => {
    // Dropping it would make the skip one-way: the editor is only reachable by
    // tapping the block, so a vanished occurrence could never be brought back.
    const out = expand(
      [ev({ recurrence: "weekly", days_of_week: [2], specific_date: null })],
      [skip("e1", "2026-09-01")],
    );
    expect(out.map((e) => e.skipped)).toEqual([false, true, false]);
    expect(activeEvents(out).map((e) => e.date)).toEqual([TUE, "2026-09-08"]);
  });
});

describe("what an event reserves", () => {
  it("takes its core plus both buffers, like an agenda", () => {
    const busy = eventBusy(
      expand([
        ev({
          buffer_before_min: 30,
          buffer_before_type: "commute",
          buffer_after_min: 15,
          buffer_after_type: "switch",
        }),
      ]),
    );
    expect(busy).toHaveLength(1);
    expect(fmt(busy[0]!)).toBe("12:30–15:15");
    expect(busy[0]!.core).toEqual(span(WED, "13:00", "15:00"));
  });

  it("reserves nothing for a skipped occurrence", () => {
    const out = expand(
      [ev({ recurrence: "weekly", days_of_week: [2], specific_date: null })],
      [skip("e1", TUE)],
    );
    expect(eventBusy(out).map((b) => b.start)).not.toContain(at(TUE, "13:00"));
  });

  it("cuts the day's free space, and composes §5.2 exactly like an agenda", () => {
    const window: WindowInstance = {
      date: WED,
      dayOfWeek: 3,
      start: at(WED, "09:00"),
      end: at(WED, "18:00"),
    };
    const free = buildFreeSpace(
      [window],
      eventBusy(
        expand([ev({ buffer_before_min: 10, buffer_before_type: "switch" })]),
      ),
    );

    expect(free.map(fmt)).toEqual(["09:00–12:50", "15:00–18:00"]);

    // D-028's first worked example, with an event as the neighbour: 10 switch
    // already carved out, a candidate asking 15 switch owes only the 5 short.
    expect(edgePaddingMin(free[0]!.after, sw(15))).toBe(5);
    // And across types the two needs stack: 10 switch + 20 commute = 30, of
    // which 10 is already reserved.
    expect(edgePaddingMin(free[0]!.after, cm(20))).toBe(20);
  });
});

describe("what a placement collides with", () => {
  const day = () => expand([ev()]);

  it("names the event in the way", () => {
    expect(overlappingEvent(span(WED, "14:00", "16:00"), day())?.title).toBe(
      "Rapat tim",
    );
  });

  it("says nothing when the placement is clear", () => {
    expect(overlappingEvent(span(WED, "15:00", "16:00"), day())).toBeNull();
    expect(overlappingEvent(span(WED, "09:00", "13:00"), day())).toBeNull();
  });

  it("ignores a skipped occurrence", () => {
    const out = expand(
      [ev({ recurrence: "weekly", days_of_week: [2], specific_date: null })],
      [skip("e1", TUE)],
    );
    expect(overlappingEvent(span(TUE, "13:30", "14:00"), out)).toBeNull();
  });
});
