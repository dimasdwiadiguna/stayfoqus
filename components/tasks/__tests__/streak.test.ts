import { describe, expect, it } from "vitest";

import { computeStreak } from "@/components/tasks/today-header";

const JKT = "Asia/Jakarta";
const TODAY = "2026-08-26";

/** 09:00 Jakarta on the given date. */
function log(date: string, overrides: Partial<{ type: string; outcome: string; deleted_at: string | null }> = {}) {
  return {
    started_at: `${date}T02:00:00.000Z`,
    type: "focus",
    outcome: "completed",
    deleted_at: null,
    ...overrides,
  };
}

describe("§9 streak counter", () => {
  it("is zero with no logs", () => {
    expect(computeStreak([], JKT, TODAY)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const logs = [log("2026-08-24"), log("2026-08-25"), log("2026-08-26")];
    expect(computeStreak(logs, JKT, TODAY)).toBe(3);
  });

  it("does not break just because today has no pomodoro yet", () => {
    const logs = [log("2026-08-24"), log("2026-08-25")];
    expect(computeStreak(logs, JKT, TODAY)).toBe(2);
  });

  it("stops at the first missing day", () => {
    const logs = [log("2026-08-22"), log("2026-08-25"), log("2026-08-26")];
    expect(computeStreak(logs, JKT, TODAY)).toBe(2);
  });

  it("counts several logs on one day once", () => {
    const logs = [log("2026-08-26"), log("2026-08-26"), log("2026-08-26")];
    expect(computeStreak(logs, JKT, TODAY)).toBe(1);
  });

  it("ignores aborted sessions, breaks and deleted logs", () => {
    const logs = [
      log("2026-08-26", { outcome: "aborted" }),
      log("2026-08-25", { type: "short_break" }),
      log("2026-08-24", { deleted_at: "2026-08-24T10:00:00.000Z" }),
    ];
    expect(computeStreak(logs, JKT, TODAY)).toBe(0);
  });

  it("attributes a log to the user's local day, not UTC", () => {
    // 2026-08-25T17:30:00Z is 00:30 on the 26th in Jakarta.
    const logs = [
      {
        started_at: "2026-08-25T17:30:00.000Z",
        type: "focus",
        outcome: "completed",
        deleted_at: null,
      },
    ];
    expect(computeStreak(logs, JKT, TODAY)).toBe(1);
  });
});
