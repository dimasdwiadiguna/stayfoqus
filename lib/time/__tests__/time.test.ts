import { describe, expect, it } from "vitest";

import {
  addDays,
  addWeeks,
  dayOfWeek,
  daysBetween,
  formatDuration,
  instantAt,
  isoWeekDates,
  isoWeekOf,
  isoWeekStart,
  localDate,
  localTime,
  minutesFromMidnight,
  minutesIntoLocalDay,
  minutesToHHmm,
} from "@/lib/time";

const JKT = "Asia/Jakarta"; // UTC+7, no DST
const NY = "America/New_York"; // DST, for the transition cases

describe("timezone boundary (§13)", () => {
  it("maps a wall-clock time to the right UTC instant", () => {
    expect(instantAt("2026-08-26", "04:00", JKT).toISOString()).toBe(
      "2026-08-25T21:00:00.000Z",
    );
  });

  it("round-trips instant → local date/time", () => {
    const instant = instantAt("2026-08-26", "22:00", JKT);
    expect(localDate(instant, JKT)).toBe("2026-08-26");
    expect(localTime(instant, JKT)).toBe("22:00");
  });

  it("keeps a local date stable across the UTC day boundary", () => {
    // 23:30 Jakarta on the 26th is 16:30 UTC on the 26th…
    expect(localDate("2026-08-26T16:30:00.000Z", JKT)).toBe("2026-08-26");
    // …but 00:30 Jakarta on the 27th is 17:30 UTC on the 26th.
    expect(localDate("2026-08-26T17:30:00.000Z", JKT)).toBe("2026-08-27");
  });

  it("handles a spring-forward day without drifting", () => {
    // 2026-03-08 is the US DST start. 09:00 local is 13:00 UTC (EST→EDT).
    expect(instantAt("2026-03-08", "09:00", NY).toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
    // The day before, the same wall clock is 14:00 UTC.
    expect(instantAt("2026-03-07", "09:00", NY).toISOString()).toBe(
      "2026-03-07T14:00:00.000Z",
    );
  });

  it("computes minutes into the local day", () => {
    const instant = instantAt("2026-08-26", "09:30", JKT);
    expect(minutesIntoLocalDay(instant, "2026-08-26", JKT)).toBe(570);
  });
});

describe("calendar arithmetic", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("adds days across a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-08-01", "2026-08-31")).toBe(30);
    expect(daysBetween("2026-08-31", "2026-08-01")).toBe(-30);
  });

  it("reports day of week with Sunday = 0", () => {
    expect(dayOfWeek("2026-08-23")).toBe(0); // Sunday
    expect(dayOfWeek("2026-08-28")).toBe(5); // Friday
  });
});

describe("ISO weeks", () => {
  it("identifies the week of a date", () => {
    expect(isoWeekOf("2026-08-26")).toBe("2026-W35");
  });

  it("puts Monday first", () => {
    const dates = isoWeekDates("2026-W35");
    expect(dates).toHaveLength(7);
    expect(dayOfWeek(dates[0]!)).toBe(1);
    expect(dates).toContain("2026-08-26");
  });

  it("handles the year boundary, where the week-year differs", () => {
    // 2027-01-01 is a Friday, part of ISO week 2026-W53.
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(isoWeekStart("2026-W53")).toBe("2026-12-28");
  });

  it("round-trips week → start → week", () => {
    for (const week of ["2026-W01", "2026-W35", "2026-W52"]) {
      expect(isoWeekOf(isoWeekStart(week))).toBe(week);
    }
  });

  it("adds weeks across the year boundary", () => {
    expect(addWeeks("2026-W52", 2)).toBe("2027-W01");
    expect(addWeeks("2026-W01", -1)).toBe("2025-W52");
  });
});

describe("time-of-day helpers", () => {
  it("converts HH:mm to minutes and back", () => {
    expect(minutesFromMidnight("04:00")).toBe(240);
    expect(minutesFromMidnight("22:30")).toBe(1350);
    expect(minutesToHHmm(1350)).toBe("22:30");
    expect(minutesToHHmm(0)).toBe("00:00");
  });

  it("formats durations compactly", () => {
    expect(formatDuration(25)).toBe("25m");
    expect(formatDuration(60)).toBe("1j");
    expect(formatDuration(85)).toBe("1j 25m");
  });
});
