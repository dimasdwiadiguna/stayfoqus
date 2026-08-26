import { describe, expect, it } from "vitest";

import { edgePaddingMin, requiredGapMin } from "@/lib/scheduling/buffers";
import type { BufferSide, EdgeKind } from "@/lib/scheduling/types";

const sw = (min: number): BufferSide => ({ min, type: "switch" });
const cm = (min: number): BufferSide => ({ min, type: "commute" });

describe("§5.2 required_gap — the worked examples", () => {
  it("A.after = 10 (switch), B.before = 15 (switch) → gap = 15", () => {
    expect(requiredGapMin(sw(10), sw(15))).toBe(15);
  });

  it("A.after = 10 (switch), B.before = 15 (commute) → gap = 25", () => {
    expect(requiredGapMin(sw(10), cm(15))).toBe(25);
  });

  it("A.after = 20 (commute), B.before = 15 (commute) → gap = 20", () => {
    expect(requiredGapMin(cm(20), cm(15))).toBe(20);
  });
});

describe("§5.2 required_gap — the rule in general", () => {
  it("takes the max within the same type", () => {
    expect(requiredGapMin(sw(5), sw(30))).toBe(30);
    expect(requiredGapMin(sw(30), sw(5))).toBe(30);
    expect(requiredGapMin(cm(45), cm(45))).toBe(45);
  });

  it("sums across types", () => {
    expect(requiredGapMin(cm(20), sw(10))).toBe(30);
    expect(requiredGapMin(sw(0), cm(0))).toBe(0);
  });

  it("is symmetric in its arguments", () => {
    const pairs: [BufferSide, BufferSide][] = [
      [sw(10), cm(15)],
      [cm(20), sw(5)],
      [sw(7), sw(7)],
      [cm(0), sw(12)],
    ];
    for (const [a, b] of pairs) {
      expect(requiredGapMin(a, b)).toBe(requiredGapMin(b, a));
    }
  });

  it("ignores a zero-length buffer of the other type", () => {
    expect(requiredGapMin(cm(0), sw(10))).toBe(10);
  });
});

describe("edge padding — what a candidate still owes", () => {
  const agendaEdge = (buffer: BufferSide): EdgeKind => ({
    kind: "agenda",
    agendaId: "a1",
    buffer,
  });

  it("charges nothing at a window edge (§5.2: buffers may spill past it)", () => {
    expect(edgePaddingMin({ kind: "window" }, sw(30))).toBe(0);
    expect(edgePaddingMin({ kind: "window" }, cm(30))).toBe(0);
  });

  it("charges nothing against a prayer block or external busy time", () => {
    expect(
      edgePaddingMin({ kind: "obstacle", obstacle: "prayer" }, cm(30)),
    ).toBe(0);
    expect(
      edgePaddingMin({ kind: "obstacle", obstacle: "gcal_busy" }, sw(30)),
    ).toBe(0);
  });

  it("charges only the shortfall over what the neighbour already reserved", () => {
    // Worked example 1: neighbour reserved 10 switch, gap must be 15 → owes 5.
    expect(edgePaddingMin(agendaEdge(sw(10)), sw(15))).toBe(5);
    // Worked example 2: gap must be 25, 10 already reserved → owes 15.
    expect(edgePaddingMin(agendaEdge(sw(10)), cm(15))).toBe(25 - 10);
    // Worked example 3: gap must be 20, 20 already reserved → owes nothing.
    expect(edgePaddingMin(agendaEdge(cm(20)), cm(15))).toBe(0);
  });

  it("never goes negative when the neighbour over-reserved", () => {
    expect(edgePaddingMin(agendaEdge(sw(60)), sw(5))).toBe(0);
  });
});
