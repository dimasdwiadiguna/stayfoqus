import { describe, expect, it } from "vitest";

import { buildActivities, nowAndNext } from "@/lib/scheduling/upnext";
import type { EventInstance } from "@/lib/scheduling/events";
import type { PrayerBlock } from "@/lib/scheduling/types";
import { makeAgenda } from "@/lib/todos/__tests__/fixtures";

import { at } from "./helpers";

const DATE = "2026-08-26";
const T = (hhmm: string) => at(DATE, hhmm);

/** An agenda with no buffers unless a test asks for one. */
function ag(
  id: string,
  from: string,
  to: string,
  extra: Partial<Parameters<typeof makeAgenda>[0]> = {},
) {
  return makeAgenda({
    id,
    todo_id: `todo-${id}`,
    start_at: new Date(T(from)).toISOString(),
    end_at: new Date(T(to)).toISOString(),
    buffer_before_min: 0,
    buffer_before_type: "switch",
    buffer_after_min: 0,
    buffer_after_type: "switch",
    ...extra,
  });
}

function prayer(key: PrayerBlock["key"], from: string, to: string): PrayerBlock {
  const start = T(from);
  const end = T(to);
  return { date: DATE, key, fridayDhuhr: false, adhan: (start + end) / 2, start, end };
}

describe("what counts as an activity", () => {
  it("carries agendas and prayer blocks, in time order", () => {
    const activities = buildActivities({
      agendas: [ag("b", "14:00", "15:00"), ag("a", "09:00", "10:00")],
      events: [],
      prayers: [prayer("dhuhr", "11:43", "12:03")],
    });

    expect(activities.map((a) => a.kind)).toEqual(["agenda", "prayer", "agenda"]);
    expect(activities[0]!.start).toBe(T("09:00"));
  });

  it("makes a commute buffer its own activity, on either side", () => {
    const activities = buildActivities({
      agendas: [
        ag("a", "09:00", "10:00", {
          buffer_before_min: 30,
          buffer_before_type: "commute",
          buffer_after_min: 20,
          buffer_after_type: "commute",
        }),
      ],
      events: [],
      prayers: [],
    });

    expect(activities.map((a) => [a.kind, a.side])).toEqual([
      ["commute", "before"],
      ["agenda", undefined],
      ["commute", "after"],
    ]);
    expect(activities[0]!.start).toBe(T("08:30"));
    expect(activities[2]!.end).toBe(T("10:20"));
  });

  it("never shows a switch buffer — the agenda already represents it", () => {
    const activities = buildActivities({
      agendas: [
        ag("a", "09:00", "10:00", {
          buffer_before_min: 15,
          buffer_before_type: "switch",
          buffer_after_min: 10,
          buffer_after_type: "switch",
        }),
      ],
      events: [],
      prayers: [],
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]!.kind).toBe("agenda");
  });

  it("ignores a zero-minute commute buffer", () => {
    const activities = buildActivities({
      agendas: [
        ag("a", "09:00", "10:00", {
          buffer_before_min: 0,
          buffer_before_type: "commute",
        }),
      ],
      events: [],
      prayers: [],
    });
    expect(activities).toHaveLength(1);
  });

  it("leaves out drafts, cancelled, done and deleted agendas", () => {
    const activities = buildActivities({
      agendas: [
        ag("draft", "09:00", "10:00", { status: "draft" }),
        ag("cancelled", "10:00", "11:00", { status: "cancelled" }),
        ag("done", "11:00", "12:00", { status: "done" }),
        ag("gone", "12:00", "13:00", { deleted_at: "2026-08-26T00:00:00.000Z" }),
        ag("real", "13:00", "14:00", { status: "planned" }),
      ],
      events: [],
      prayers: [],
    });

    expect(activities.map((a) => a.agendaId)).toEqual(["real"]);
  });

  it("keeps a missed or partial agenda — the work is unresolved, not over", () => {
    const activities = buildActivities({
      agendas: [
        ag("m", "09:00", "10:00", { status: "missed" }),
        ag("p", "10:00", "11:00", { status: "partial" }),
      ],
      events: [],
      prayers: [],
    });
    expect(activities).toHaveLength(2);
  });
});

/** An event occurrence, with no buffers unless a test asks for one. */
function evt(
  from: string,
  to: string,
  extra: Partial<EventInstance> = {},
): EventInstance {
  return {
    date: DATE,
    eventId: "e1",
    title: "Rapat klien",
    location: null,
    placeId: null,
    commute: null,
    bufferBefore: { min: 0, type: "switch" },
    bufferAfter: { min: 0, type: "switch" },
    skipped: false,
    start: T(from),
    end: T(to),
    ...extra,
  };
}

describe("events in the stream", () => {
  it("carries an event, with its own title", () => {
    const activities = buildActivities({
      agendas: [],
      events: [evt("13:00", "15:00")],
      prayers: [],
    });
    expect(activities.map((a) => a.kind)).toEqual(["event"]);
    expect(activities[0]!.title).toBe("Rapat klien");
    expect(activities[0]!.eventId).toBe("e1");
  });

  it("applies the buffer rule to an event exactly as to an agenda", () => {
    const activities = buildActivities({
      agendas: [],
      events: [
        evt("13:00", "15:00", {
          bufferBefore: { min: 30, type: "commute" },
          bufferAfter: { min: 15, type: "switch" },
        }),
      ],
      prayers: [],
    });
    // The commute out is a journey; the switch back is not an activity.
    expect(activities.map((a) => [a.kind, a.side])).toEqual([
      ["commute", "before"],
      ["event", undefined],
    ]);
    expect(activities[0]!.start).toBe(T("12:30"));
  });

  it("leaves out a skipped occurrence and its commute", () => {
    const activities = buildActivities({
      agendas: [],
      events: [
        evt("13:00", "15:00", {
          skipped: true,
          bufferBefore: { min: 30, type: "commute" },
        }),
      ],
      prayers: [],
    });
    expect(activities).toHaveLength(0);
  });

  it("takes its turn as current and next alongside agendas", () => {
    const activities = buildActivities({
      agendas: [ag("a", "09:00", "10:00")],
      events: [evt("13:00", "15:00")],
      prayers: [],
    });

    expect(nowAndNext(activities, T("09:30")).next?.kind).toBe("event");
    expect(nowAndNext(activities, T("14:00")).current?.title).toBe("Rapat klien");
  });
});

describe("what is running, and what comes next", () => {
  const day = () =>
    buildActivities({
      agendas: [
        ag("a", "09:00", "12:00", {
          buffer_after_min: 30,
          buffer_after_type: "commute",
        }),
        ag("b", "14:00", "15:00"),
      ],
      events: [],
      prayers: [prayer("dhuhr", "11:43", "12:03")],
    });

  it("answers with the agenda in progress and the prayer that follows", () => {
    const { current, next } = nowAndNext(day(), T("10:00"));
    expect(current?.agendaId).toBe("a");
    expect(next?.kind).toBe("prayer");
  });

  it("prefers the most recently started of two overlapping activities", () => {
    // The prayer block opened at 11:43 inside an agenda running since 09:00.
    const { current } = nowAndNext(day(), T("11:50"));
    expect(current?.kind).toBe("prayer");
  });

  it("reports the commute as current once the agenda has ended", () => {
    const { current, next } = nowAndNext(day(), T("12:10"));
    expect(current?.kind).toBe("commute");
    expect(current?.side).toBe("after");
    expect(next?.agendaId).toBe("b");
  });

  it("has no current activity in a gap, but still knows what is next", () => {
    const { current, next } = nowAndNext(day(), T("13:00"));
    expect(current).toBeNull();
    expect(next?.agendaId).toBe("b");
  });

  it("has no next once the day is done", () => {
    const { current, next } = nowAndNext(day(), T("23:00"));
    expect(current).toBeNull();
    expect(next).toBeNull();
  });

  it("breaks a tie deterministically, whichever order they arrive in", () => {
    const first = ag("aaa", "09:00", "10:00");
    const second = ag("zzz", "09:00", "10:00");

    const forwards = nowAndNext(
      buildActivities({ agendas: [first, second], events: [], prayers: [] }),
      T("08:00"),
    );
    const backwards = nowAndNext(
      buildActivities({ agendas: [second, first], events: [], prayers: [] }),
      T("08:00"),
    );

    expect(forwards.next?.key).toBe(backwards.next?.key);
    expect(forwards.next?.agendaId).toBe("aaa");
  });

  it("counts an activity as over the instant it ends", () => {
    const activities = buildActivities({
      agendas: [ag("a", "09:00", "10:00")],
      events: [],
      prayers: [],
    });
    expect(nowAndNext(activities, T("10:00")).current).toBeNull();
    expect(nowAndNext(activities, T("09:59")).current?.agendaId).toBe("a");
  });
});
