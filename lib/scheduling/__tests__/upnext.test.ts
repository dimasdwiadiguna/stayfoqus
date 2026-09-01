import { describe, expect, it } from "vitest";

import { buildActivities, nowAndNext } from "@/lib/scheduling/upnext";
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
      prayers: [],
    });
    expect(activities).toHaveLength(2);
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
      buildActivities({ agendas: [first, second], prayers: [] }),
      T("08:00"),
    );
    const backwards = nowAndNext(
      buildActivities({ agendas: [second, first], prayers: [] }),
      T("08:00"),
    );

    expect(forwards.next?.key).toBe(backwards.next?.key);
    expect(forwards.next?.agendaId).toBe("aaa");
  });

  it("counts an activity as over the instant it ends", () => {
    const activities = buildActivities({
      agendas: [ag("a", "09:00", "10:00")],
      prayers: [],
    });
    expect(nowAndNext(activities, T("10:00")).current).toBeNull();
    expect(nowAndNext(activities, T("09:59")).current?.agendaId).toBe("a");
  });
});
