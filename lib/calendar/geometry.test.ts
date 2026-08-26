import { describe, expect, it } from "vitest";

import {
  heightFor,
  instantForPx,
  layoutOverlaps,
  minutesToPx,
  snapMinutes,
  topFor,
} from "@/lib/calendar/geometry";
import { instantAt } from "@/lib/time";

const JKT = "Asia/Jakarta";
const DAY = "2026-08-26";

describe("timeline geometry", () => {
  it("places an instant at the right offset", () => {
    expect(topFor(instantAt(DAY, "00:00", JKT), DAY, JKT)).toBe(0);
    expect(topFor(instantAt(DAY, "09:00", JKT), DAY, JKT)).toBe(minutesToPx(540));
  });

  it("measures a block's height from its duration", () => {
    const start = instantAt(DAY, "09:00", JKT);
    const end = instantAt(DAY, "10:25", JKT);
    expect(heightFor(start, end)).toBe(minutesToPx(85));
  });

  it("round-trips pixels back to a snapped instant (§8: 5-minute steps)", () => {
    const px = topFor(instantAt(DAY, "09:07", JKT), DAY, JKT);
    const back = instantForPx(px, DAY, JKT);
    expect(back).toBe(instantAt(DAY, "09:05", JKT).getTime());
  });

  it("snaps to arbitrary steps", () => {
    expect(snapMinutes(37)).toBe(35);
    expect(snapMinutes(38)).toBe(40);
    expect(snapMinutes(37, 15)).toBe(30);
  });
});

describe("overlap layout", () => {
  const block = (start: number, end: number, id: string) => ({ start, end, id });

  it("gives a lone block the full width", () => {
    const out = layoutOverlaps([block(0, 10, "a")]);
    expect(out[0]).toMatchObject({ column: 0, columns: 1 });
  });

  it("splits two overlapping blocks into two columns", () => {
    const out = layoutOverlaps([block(0, 10, "a"), block(5, 15, "b")]);
    expect(out.map((o) => o.column)).toEqual([0, 1]);
    expect(out.every((o) => o.columns === 2)).toBe(true);
  });

  it("keeps sequential blocks full width", () => {
    const out = layoutOverlaps([block(0, 10, "a"), block(10, 20, "b")]);
    expect(out.every((o) => o.columns === 1)).toBe(true);
  });

  it("reuses a column once its block has ended", () => {
    const out = layoutOverlaps([
      block(0, 30, "a"),
      block(0, 10, "b"),
      block(12, 20, "c"),
    ]);
    const byId = new Map(out.map((o) => [o.item.id, o]));
    expect(byId.get("a")!.column).toBe(0);
    expect(byId.get("b")!.column).toBe(1);
    expect(byId.get("c")!.column).toBe(1);
    expect(byId.get("c")!.columns).toBe(2);
  });

  it("treats separated clusters independently", () => {
    const out = layoutOverlaps([
      block(0, 10, "a"),
      block(5, 15, "b"),
      block(100, 110, "c"),
    ]);
    const byId = new Map(out.map((o) => [o.item.id, o]));
    expect(byId.get("c")!.columns).toBe(1);
  });
});
