import { describe, expect, it } from "vitest";

import {
  expandTimeBlocks,
  matchesTimeBlock,
  satisfiesTimeBlocks,
  violatedBlock,
} from "@/lib/scheduling/timeblocks";
import type { SchedulableTodo, TimeBlockInstance } from "@/lib/scheduling/types";

import { JKT, at, fmt, span, timeBlock, timeBlockException } from "./helpers";

type TodoFilterView = Pick<SchedulableTodo, "categoryId" | "tags" | "priority">;

const work: TodoFilterView = {
  categoryId: "cat-kerja",
  tags: ["riset", "panggilan"],
  priority: 2,
};

function instance(overrides: Partial<TimeBlockInstance> = {}): TimeBlockInstance {
  return {
    date: "2026-08-26",
    timeBlockId: "tb-1",
    name: "Deep work",
    color: "#7c9cff",
    filterCategoryIds: [],
    filterTags: [],
    filterPriorities: [],
    start: at("2026-08-26", "09:00"),
    end: at("2026-08-26", "12:00"),
    ...overrides,
  };
}

describe("§5.4 filter semantics — OR within, AND across", () => {
  it("accepts everything when no filter is set", () => {
    expect(matchesTimeBlock(work, instance())).toBe(true);
  });

  it("ORs within the category dimension", () => {
    expect(
      matchesTimeBlock(work, instance({ filterCategoryIds: ["cat-kerja", "cat-riset"] })),
    ).toBe(true);
    expect(
      matchesTimeBlock(work, instance({ filterCategoryIds: ["cat-personal"] })),
    ).toBe(false);
  });

  it("ORs within the tag dimension — any overlap is enough", () => {
    expect(matchesTimeBlock(work, instance({ filterTags: ["panggilan"] }))).toBe(true);
    expect(
      matchesTimeBlock(work, instance({ filterTags: ["menulis", "riset"] })),
    ).toBe(true);
    expect(matchesTimeBlock(work, instance({ filterTags: ["menulis"] }))).toBe(false);
  });

  it("ORs within the priority dimension", () => {
    expect(matchesTimeBlock(work, instance({ filterPriorities: [1, 2] }))).toBe(true);
    expect(matchesTimeBlock(work, instance({ filterPriorities: [3, 4] }))).toBe(false);
  });

  it("ANDs across dimensions — every set dimension must pass", () => {
    const block = instance({
      filterCategoryIds: ["cat-kerja"],
      filterTags: ["riset"],
      filterPriorities: [2],
    });
    expect(matchesTimeBlock(work, block)).toBe(true);

    // One dimension failing is enough to reject.
    expect(
      matchesTimeBlock({ ...work, priority: 4 }, block),
    ).toBe(false);
    expect(
      matchesTimeBlock({ ...work, tags: ["lain"] }, block),
    ).toBe(false);
    expect(
      matchesTimeBlock({ ...work, categoryId: "cat-personal" }, block),
    ).toBe(false);
  });

  it("rejects an uncategorised todo when a category filter is set", () => {
    expect(
      matchesTimeBlock(
        { ...work, categoryId: null },
        instance({ filterCategoryIds: ["cat-kerja"] }),
      ),
    ).toBe(false);
  });
});

describe("§5.4 enforcement over an interval", () => {
  const strict = instance({ filterTags: ["menulis"] });

  it("passes when the placement touches no block", () => {
    expect(
      satisfiesTimeBlocks(work, span("2026-08-26", "13:00", "14:00"), [strict]),
    ).toBe(true);
  });

  it("fails when the placement overlaps a block it does not match", () => {
    expect(
      satisfiesTimeBlocks(work, span("2026-08-26", "11:30", "12:30"), [strict]),
    ).toBe(false);
  });

  it("requires every overlapping block to be satisfied", () => {
    const second = instance({
      timeBlockId: "tb-2",
      start: at("2026-08-26", "11:00"),
      end: at("2026-08-26", "14:00"),
      filterTags: ["riset"],
    });
    // 11:30–12:30 overlaps both: matches tb-2 but not tb-1.
    expect(
      satisfiesTimeBlocks(work, span("2026-08-26", "11:30", "12:30"), [strict, second]),
    ).toBe(false);
    // 12:00–13:00 overlaps only tb-2, which it matches.
    expect(
      satisfiesTimeBlocks(work, span("2026-08-26", "12:00", "13:00"), [strict, second]),
    ).toBe(true);
  });

  it("names the violated block for the confirmation copy", () => {
    const violated = violatedBlock(
      work,
      span("2026-08-26", "10:00", "11:00"),
      [strict],
    );
    expect(violated?.name).toBe("Deep work");
  });
});

describe("§4.6/§4.7 recurrence expansion", () => {
  it("expands a weekly block onto its chosen days", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ days_of_week: [1, 3, 5] })],
      [],
      "2026-08-24", // Monday
      "2026-08-30", // Sunday
      JKT,
    );
    expect(blocks.map((b) => b.date)).toEqual([
      "2026-08-24",
      "2026-08-26",
      "2026-08-28",
    ]);
    expect(fmt(blocks[0]!)).toBe("09:00–12:00");
  });

  it("expands a one-off block only on its date", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ recurrence: "once", specific_date: "2026-08-27", days_of_week: [] })],
      [],
      "2026-08-24",
      "2026-08-30",
      JKT,
    );
    expect(blocks.map((b) => b.date)).toEqual(["2026-08-27"]);
  });

  it("omits a one-off block outside the range", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ recurrence: "once", specific_date: "2026-09-10", days_of_week: [] })],
      [],
      "2026-08-24",
      "2026-08-30",
      JKT,
    );
    expect(blocks).toEqual([]);
  });

  it("stops a recurring block at its end date", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ days_of_week: [1, 2, 3, 4, 5], end_date: "2026-08-26" })],
      [],
      "2026-08-24",
      "2026-08-30",
      JKT,
    );
    expect(blocks.map((b) => b.date)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
    ]);
  });

  it("skips a single instance via time_block_exceptions", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ days_of_week: [1, 2, 3, 4, 5] })],
      [timeBlockException({ date: "2026-08-26" })],
      "2026-08-24",
      "2026-08-28",
      JKT,
    );
    expect(blocks.map((b) => b.date)).not.toContain("2026-08-26");
    expect(blocks).toHaveLength(4);
  });

  it("ignores disabled and deleted blocks", () => {
    const blocks = expandTimeBlocks(
      [
        timeBlock({ id: "off", enabled: false }),
        timeBlock({ id: "gone", deleted_at: "2026-08-01T00:00:00.000Z" }),
      ],
      [],
      "2026-08-24",
      "2026-08-28",
      JKT,
    );
    expect(blocks).toEqual([]);
  });

  it("ignores a deleted exception, so the instance comes back", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ days_of_week: [3] })],
      [timeBlockException({ date: "2026-08-26", deleted_at: "2026-08-20T00:00:00.000Z" })],
      "2026-08-24",
      "2026-08-28",
      JKT,
    );
    expect(blocks.map((b) => b.date)).toEqual(["2026-08-26"]);
  });

  it("drops a block whose end time is not after its start", () => {
    const blocks = expandTimeBlocks(
      [timeBlock({ start_time: "22:00", end_time: "02:00" })],
      [],
      "2026-08-24",
      "2026-08-28",
      JKT,
    );
    expect(blocks).toEqual([]);
  });
});
