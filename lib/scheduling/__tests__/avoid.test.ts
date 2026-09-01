import { describe, expect, it } from "vitest";

import { avoidPrayer } from "@/lib/scheduling/avoid";
import { buildFreeSpace } from "@/lib/scheduling/freespace";
import type { BusyInterval, PrayerBlock, WindowInstance } from "@/lib/scheduling/types";

import { at, fmt, span } from "./helpers";

const DATE = "2026-08-26"; // a Wednesday

function prayer(
  key: PrayerBlock["key"],
  from: string,
  to: string,
): PrayerBlock {
  const start = at(DATE, from);
  const end = at(DATE, to);
  // The avoidance rule only ever reads the block's bounds, so the adhan is set
  // to the midpoint the resolver would produce and nothing else changes.
  return { date: DATE, key, fridayDhuhr: false, adhan: (start + end) / 2, start, end };
}

function window(from: string, to: string): WindowInstance {
  return {
    date: DATE,
    dayOfWeek: 3,
    start: at(DATE, from),
    end: at(DATE, to),
  };
}

function busy(from: string, to: string): BusyInterval {
  return { source: "agenda", start: at(DATE, from), end: at(DATE, to) };
}

/** The day as the calendar sees it: one window, prayers subtracted. */
function freeSpace(prayers: PrayerBlock[], others: BusyInterval[] = []) {
  return buildFreeSpace(
    [window("08:00", "20:00")],
    [
      ...prayers.map(
        (p): BusyInterval => ({ source: "prayer", start: p.start, end: p.end }),
      ),
      ...others,
    ],
  );
}

describe("moving a placement off a prayer block", () => {
  const dhuhr = prayer("dhuhr", "11:53", "12:13");

  it("says nothing when the placement is already clear", () => {
    const free = freeSpace([dhuhr]);
    expect(avoidPrayer(span(DATE, "09:00", "10:00"), [dhuhr], free)).toBeNull();
  });

  it("offers both sides when both are empty", () => {
    const free = freeSpace([dhuhr]);
    const result = avoidPrayer(span(DATE, "11:30", "12:30"), [dhuhr], free);

    expect(result?.prayer.key).toBe("dhuhr");
    // An hour finishing at 11:50 — the 5-minute grid, floored so the block
    // never clips the prayer it was moved to respect.
    expect(fmt(result!.earlier!)).toBe("10:50–11:50");
    expect(fmt(result!.later!)).toBe("12:15–13:15");
  });

  it("keeps the placement's own length", () => {
    const free = freeSpace([dhuhr]);
    const result = avoidPrayer(span(DATE, "11:45", "12:00"), [dhuhr], free);

    const length = (i: { start: number; end: number }) => i.end - i.start;
    expect(length(result!.earlier!)).toBe(15 * 60_000);
    expect(length(result!.later!)).toBe(15 * 60_000);
  });

  it("withholds a side that another commitment already fills", () => {
    // Something sits across the whole morning approach to Dhuhr.
    const free = freeSpace([dhuhr], [busy("10:00", "11:53")]);
    const result = avoidPrayer(span(DATE, "11:30", "12:30"), [dhuhr], free);

    expect(result?.earlier).toBeNull();
    expect(fmt(result!.later!)).toBe("12:15–13:15");
  });

  it("withholds a side that falls outside the availability window", () => {
    const fajr = prayer("fajr", "08:10", "08:30");
    const free = freeSpace([fajr]);
    const result = avoidPrayer(span(DATE, "08:00", "09:00"), [fajr], free);

    // An hour ending at 08:10 would start at 07:10, before the window opens.
    expect(result?.earlier).toBeNull();
    expect(fmt(result!.later!)).toBe("08:30–09:30");
  });

  it("offers nothing at all when the day is full on both sides", () => {
    const free = freeSpace([dhuhr], [
      busy("08:00", "11:53"),
      busy("12:13", "20:00"),
    ]);
    const result = avoidPrayer(span(DATE, "11:40", "12:20"), [dhuhr], free);

    expect(result?.prayer.key).toBe("dhuhr");
    expect(result?.earlier).toBeNull();
    expect(result?.later).toBeNull();
  });

  it("answers about the first prayer it hits when it spans two", () => {
    const asr = prayer("asr", "15:13", "15:33");
    const maghrib = prayer("maghrib", "17:52", "18:12");
    const free = freeSpace([asr, maghrib]);

    const result = avoidPrayer(span(DATE, "15:00", "18:00"), [asr, maghrib], free);
    expect(result?.prayer.key).toBe("asr");
  });

  it("never proposes a shift that lands on another prayer", () => {
    const asr = prayer("asr", "15:13", "15:33");
    const maghrib = prayer("maghrib", "17:52", "18:12");
    const free = freeSpace([asr, maghrib]);

    // Three hours after Asr runs straight into Maghrib, so only the earlier
    // side survives.
    const result = avoidPrayer(span(DATE, "15:00", "18:00"), [asr, maghrib], free);
    expect(result?.later).toBeNull();
    expect(fmt(result!.earlier!)).toBe("12:10–15:10");
  });
});
