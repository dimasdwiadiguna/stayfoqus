import { describe, expect, it } from "vitest";

import {
  abuttingPredecessor,
  chainedStart,
  danglingLinks,
  dragLinkCandidate,
  resolveChains,
  wouldCycle,
} from "@/lib/scheduling/chain";
import { makeAgenda } from "@/lib/todos/__tests__/fixtures";

import { cm, sw } from "./helpers";

const T = (hhmm: string) => `2026-08-26T${hhmm}:00.000Z`;
const ms = (hhmm: string) => Date.parse(T(hhmm));

/** An agenda from `from` to `to`, with the given buffers. */
function ag(
  id: string,
  from: string,
  to: string,
  extra: Partial<Parameters<typeof makeAgenda>[0]> = {},
) {
  return makeAgenda({
    id,
    todo_id: `todo-${id}`,
    start_at: T(from),
    end_at: T(to),
    buffer_before_min: 0,
    buffer_before_type: "switch",
    buffer_after_min: 0,
    buffer_after_type: "switch",
    ...extra,
  });
}

describe("where a follower starts", () => {
  it("lands at the end of the predecessor's buffer when it asks for none", () => {
    const start = chainedStart(
      { end_at: T("10:00"), buffer_after_min: 15, buffer_after_type: "switch" },
      { buffer_before_min: 0, buffer_before_type: "switch" },
    );
    expect(start).toBe(ms("10:15"));
  });

  it("takes the larger of two same-type buffers (§5.2 max)", () => {
    const start = chainedStart(
      { end_at: T("10:00"), buffer_after_min: 10, buffer_after_type: "switch" },
      { buffer_before_min: 25, buffer_before_type: "switch" },
    );
    expect(start).toBe(ms("10:25"));
  });

  it("sums across types (§5.2)", () => {
    const start = chainedStart(
      { end_at: T("10:00"), buffer_after_min: 10, buffer_after_type: "switch" },
      { buffer_before_min: 20, buffer_before_type: "commute" },
    );
    expect(start).toBe(ms("10:30"));
  });

  it("is immediate when neither side reserves anything", () => {
    const start = chainedStart(
      { end_at: T("10:00"), buffer_after_min: 0, buffer_after_type: "switch" },
      { buffer_before_min: 0, buffer_before_type: "switch" },
    );
    expect(start).toBe(ms("10:00"));
  });
});

describe("resolving a chain", () => {
  it("moves a follower when its predecessor is elsewhere", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 15 });
    const b = ag("b", "14:00", "15:00", { follows_agenda_id: "a" });

    const { moves, problems } = resolveChains([a, b]);
    expect(problems).toEqual([]);
    expect(moves).toEqual([
      { id: "b", start_at: T("10:15"), end_at: T("11:15") },
    ]);
  });

  it("preserves the follower's own duration", () => {
    const a = ag("a", "09:00", "10:00");
    const b = ag("b", "14:00", "14:25", { follows_agenda_id: "a" });
    const { moves } = resolveChains([a, b]);
    expect(moves[0]).toEqual({ id: "b", start_at: T("10:00"), end_at: T("10:25") });
  });

  it("emits nothing when the follower is already in place", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    const b = ag("b", "10:10", "11:10", { follows_agenda_id: "a" });
    expect(resolveChains([a, b]).moves).toEqual([]);
  });

  it("propagates through a three-deep chain in one pass", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    const b = ag("b", "20:00", "20:30", {
      follows_agenda_id: "a",
      buffer_after_min: 5,
    });
    const c = ag("c", "21:00", "21:45", { follows_agenda_id: "b" });

    const { moves } = resolveChains([a, b, c]);
    const byId = new Map(moves.map((m) => [m.id, m]));
    expect(byId.get("b")).toMatchObject({ start_at: T("10:10"), end_at: T("10:40") });
    expect(byId.get("c")).toMatchObject({ start_at: T("10:45"), end_at: T("11:30") });
  });

  it("handles two agendas following the same predecessor deterministically", () => {
    const a = ag("a", "09:00", "10:00");
    const b = ag("b", "12:00", "12:30", { follows_agenda_id: "a" });
    const c = ag("c", "13:00", "13:30", { follows_agenda_id: "a" });

    const first = resolveChains([a, b, c]);
    const second = resolveChains([a, c, b]);
    expect(second.moves).toEqual(first.moves);
  });

  it("reports a missing predecessor instead of guessing", () => {
    const b = ag("b", "14:00", "15:00", { follows_agenda_id: "gone" });
    const { moves, problems } = resolveChains([b]);
    expect(moves).toEqual([]);
    expect(problems).toEqual([{ id: "b", reason: "missing" }]);
  });

  it("reports a cycle instead of looping", () => {
    const a = ag("a", "09:00", "10:00", { follows_agenda_id: "b" });
    const b = ag("b", "11:00", "12:00", { follows_agenda_id: "a" });
    const { moves, problems } = resolveChains([a, b]);
    expect(moves).toEqual([]);
    expect(problems.map((p) => p.reason)).toEqual(["cycle", "cycle"]);
  });

  it("reports an agenda that follows itself", () => {
    const a = ag("a", "09:00", "10:00", { follows_agenda_id: "a" });
    expect(resolveChains([a]).problems).toEqual([{ id: "a", reason: "self" }]);
  });

  it("ignores deleted and cancelled agendas", () => {
    const a = ag("a", "09:00", "10:00", { deleted_at: T("08:00") });
    const b = ag("b", "14:00", "15:00", { follows_agenda_id: "a" });
    expect(resolveChains([a, b]).problems).toEqual([
      { id: "b", reason: "missing" },
    ]);
  });
});

describe("guarding the link", () => {
  it("refuses a self-link", () => {
    expect(wouldCycle([ag("a", "09:00", "10:00")], "a", "a")).toBe(true);
  });

  it("refuses a link that closes a loop", () => {
    const a = ag("a", "09:00", "10:00", { follows_agenda_id: "b" });
    const b = ag("b", "11:00", "12:00");
    expect(wouldCycle([a, b], "b", "a")).toBe(true);
  });

  it("allows an ordinary link", () => {
    const a = ag("a", "09:00", "10:00");
    const b = ag("b", "11:00", "12:00");
    expect(wouldCycle([a, b], "b", "a")).toBe(false);
  });

  it("allows extending a chain at its end", () => {
    const a = ag("a", "09:00", "10:00");
    const b = ag("b", "10:00", "11:00", { follows_agenda_id: "a" });
    const c = ag("c", "12:00", "13:00");
    expect(wouldCycle([a, b, c], "c", "b")).toBe(false);
  });

  it("finds links whose predecessor is gone", () => {
    const a = ag("a", "09:00", "10:00", { deleted_at: T("08:00") });
    const b = ag("b", "10:00", "11:00", { follows_agenda_id: "a" });
    const c = ag("c", "12:00", "13:00");
    expect(danglingLinks([a, b, c])).toEqual(["b"]);
  });
});

describe("offering the link", () => {
  it("finds the agenda a block has been butted against", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    const found = abuttingPredecessor([a], {
      start: ms("10:10"),
      bufferBefore: sw(0),
    });
    expect(found?.id).toBe("a");
  });

  it("tolerates a few minutes of slop from a 5-minute drag grid", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    expect(
      abuttingPredecessor([a], { start: ms("10:15"), bufferBefore: sw(0) })?.id,
    ).toBe("a");
  });

  it("does not offer for a block that is merely on the same day", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    expect(
      abuttingPredecessor([a], { start: ms("14:00"), bufferBefore: sw(0) }),
    ).toBeNull();
  });

  it("accounts for the candidate's own buffer when measuring", () => {
    // a ends 10:00 with 10 switch; a commute before-buffer of 20 sums to 30.
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    expect(
      abuttingPredecessor([a], { start: ms("10:30"), bufferBefore: cm(20) })?.id,
    ).toBe("a");
    expect(
      abuttingPredecessor([a], { start: ms("10:10"), bufferBefore: cm(20) }),
    ).toBeNull();
  });

  it("picks the nearest when two would fit", () => {
    const a = ag("a", "09:00", "10:00");
    const b = ag("b", "09:30", "10:05");
    expect(
      abuttingPredecessor([a, b], { start: ms("10:05"), bufferBefore: sw(0) })?.id,
    ).toBe("b");
  });
});

describe("the predecessor a dragged block is reaching for", () => {
  it("offers the block above once the drag comes within tolerance", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    const b = ag("b", "14:00", "15:00");

    const found = dragLinkCandidate([a, b], {
      id: "b",
      start: ms("10:12"),
      bufferBefore: sw(0),
    });
    expect(found?.predecessor.id).toBe("a");
  });

  it("returns exactly the instant `chainedStart` would produce", () => {
    const a = ag("a", "09:00", "10:00", { buffer_after_min: 10 });
    const b = ag("b", "14:00", "15:00", {
      buffer_before_min: 20,
      buffer_before_type: "commute",
    });

    const found = dragLinkCandidate([a, b], {
      id: "b",
      // 10 switch + 20 commute sum to 30 (§5.2), so the pin lands at 10:30.
      start: ms("10:26"),
      bufferBefore: cm(20),
    });
    expect(found?.start).toBe(
      chainedStart(a, { buffer_before_min: 20, buffer_before_type: "commute" }),
    );
    expect(found?.start).toBe(ms("10:30"));
  });

  it("never offers the block being dragged as its own predecessor", () => {
    const a = ag("a", "09:00", "10:00");
    expect(
      dragLinkCandidate([a], { id: "a", start: ms("10:00"), bufferBefore: sw(0) }),
    ).toBeNull();
  });

  it("refuses a candidate that would close a loop", () => {
    // a already follows b, so pinning b behind a would make a cycle. The cue
    // must not offer what `linkImmediatelyAfter` will refuse.
    const a = ag("a", "09:00", "10:00", { follows_agenda_id: "b" });
    const b = ag("b", "11:00", "12:00");

    expect(
      dragLinkCandidate([a, b], {
        id: "b",
        start: ms("10:00"),
        bufferBefore: sw(0),
      }),
    ).toBeNull();
  });

  it("is wider than the settled-placement offer, but still bounded", () => {
    const a = ag("a", "09:00", "10:00");
    const mover = (at: string) =>
      dragLinkCandidate([a], { id: "b", start: ms(at), bufferBefore: sw(0) });

    // 12 minutes away: too far for `abuttingPredecessor`, close enough to drag.
    expect(abuttingPredecessor([a], { start: ms("10:12"), bufferBefore: sw(0) })).toBeNull();
    expect(mover("10:12")?.predecessor.id).toBe("a");
    expect(mover("10:20")).toBeNull();
  });

  it("skips a cancelled or deleted neighbour", () => {
    const gone = ag("a", "09:00", "10:00", { status: "cancelled" });
    expect(
      dragLinkCandidate([gone], {
        id: "b",
        start: ms("10:00"),
        bufferBefore: sw(0),
      }),
    ).toBeNull();
  });
});
