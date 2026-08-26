import { describe, expect, it } from "vitest";

import {
  isInsideWindow,
  resolveWindows,
  windowMinutes,
} from "@/lib/scheduling/availability";

import { JKT, allDays, at, span, windowSpec } from "./helpers";

describe("§4.5 availability windows", () => {
  it("resolves the seeded weekday/weekend defaults", () => {
    const specs = [
      ...[1, 2, 3, 4, 5].map((d) => windowSpec(d, "04:00", "22:00")),
      ...[0, 6].map((d) => windowSpec(d, "06:00", "20:00")),
    ];
    // 2026-08-24 is a Monday; 2026-08-29/30 are Sat/Sun.
    const windows = resolveWindows(specs, "2026-08-24", "2026-08-30", JKT);
    expect(windows).toHaveLength(7);

    const monday = windows.find((w) => w.date === "2026-08-24")!;
    expect(monday.start).toBe(at("2026-08-24", "04:00"));
    expect(monday.end).toBe(at("2026-08-24", "22:00"));

    const saturday = windows.find((w) => w.date === "2026-08-29")!;
    expect(saturday.start).toBe(at("2026-08-29", "06:00"));
    expect(saturday.end).toBe(at("2026-08-29", "20:00"));
  });

  it("supports multiple windows on one day (§4.5)", () => {
    const specs = [
      windowSpec(1, "04:00", "07:00"),
      windowSpec(1, "09:00", "22:00"),
    ];
    const windows = resolveWindows(specs, "2026-08-24", "2026-08-24", JKT);
    expect(windows).toHaveLength(2);
    expect(windows[0]!.end).toBe(at("2026-08-24", "07:00"));
    expect(windows[1]!.start).toBe(at("2026-08-24", "09:00"));
  });

  it("skips disabled windows", () => {
    const specs = [windowSpec(1, "04:00", "22:00", false)];
    expect(resolveWindows(specs, "2026-08-24", "2026-08-24", JKT)).toEqual([]);
  });

  it("drops a window that does not end after it starts", () => {
    const specs = [windowSpec(1, "22:00", "04:00"), windowSpec(1, "09:00", "09:00")];
    expect(resolveWindows(specs, "2026-08-24", "2026-08-24", JKT)).toEqual([]);
  });

  it("returns windows in chronological order across days", () => {
    const windows = resolveWindows(allDays("08:00", "17:00"), "2026-08-24", "2026-08-26", JKT);
    const starts = windows.map((w) => w.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("sums window minutes", () => {
    const windows = resolveWindows(allDays("09:00", "17:00"), "2026-08-24", "2026-08-25", JKT);
    expect(windowMinutes(windows)).toBe(2 * 8 * 60);
  });

  it("reports whether an interval is fully inside a window (§5.1)", () => {
    const windows = resolveWindows(allDays("09:00", "17:00"), "2026-08-24", "2026-08-24", JKT);
    expect(isInsideWindow(span("2026-08-24", "10:00", "11:00"), windows)).toBe(true);
    expect(isInsideWindow(span("2026-08-24", "16:30", "17:30"), windows)).toBe(false);
    expect(isInsideWindow(span("2026-08-24", "18:00", "19:00"), windows)).toBe(false);
  });
});
