import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { __resetDbForTests, getDb } from "@/lib/db/client";
import { LOCAL_USER_ID, type Agenda } from "@/lib/db/schema";
import { applyPulledEvents } from "@/lib/gcal/pull";
import type { GcalPullEvent } from "@/lib/gcal/types";

/* The agenda as FOQUS stores it: UTC, per §13. */
const LOCAL_START = "2026-09-13T00:00:00.000Z";
const LOCAL_END = "2026-09-13T01:30:00.000Z";
/* The same moments as Google answers them: the calendar's own offset. */
const GOOGLE_START = "2026-09-13T07:00:00+07:00";
const GOOGLE_END = "2026-09-13T08:30:00+07:00";

const AGENDA_ID = "11111111-1111-4111-8111-111111111111";

function agenda(patch: Partial<Agenda> = {}): Agenda {
  return {
    id: AGENDA_ID,
    user_id: LOCAL_USER_ID,
    todo_id: "22222222-2222-4222-8222-222222222222",
    title_override: null,
    start_at: LOCAL_START,
    end_at: LOCAL_END,
    allocated_pomodoro: 3,
    buffer_before_min: 0,
    buffer_before_type: "switch",
    buffer_after_min: 10,
    buffer_after_type: "switch",
    status: "planned",
    outside_window: false,
    follows_agenda_id: null,
    place_id: null,
    commute_auto: 1,
    gcal_event_id: "evt-1",
    gcal_synced_at: null,
    gcal_conflict: false,
    created_at: "2026-09-12T16:00:00.000Z",
    updated_at: "2026-09-12T16:00:00.000Z",
    deleted_at: null,
    dirty: 0,
    ...patch,
  } as Agenda;
}

function event(patch: Partial<GcalPullEvent> = {}): GcalPullEvent {
  return {
    event_id: "evt-1",
    agenda_id: AGENDA_ID,
    start_at: GOOGLE_START,
    end_at: GOOGLE_END,
    summary: "Mwmbuat sirat twa",
    // Google stamps `updated` a moment after our own write, always.
    updated: "2026-09-12T16:00:04.000Z",
    cancelled: false,
    ...patch,
  };
}

beforeEach(async () => {
  const db = getDb();
  await db.delete();
  __resetDbForTests();
  await getDb().open();
});

describe("§6.4 — applying what Google sends back", () => {
  /*
   * The regression. Comparing the *text* of the two stamps marked every agenda
   * FOQUS had just created as "changed in Google": same instant, different
   * spelling. Google's `updated` is always newer than our write, so each one
   * was overwritten and badged without anyone touching it.
   */
  it("does not flag a conflict when only the spelling of the time differs", async () => {
    const db = getDb();
    await db.agendas.add(agenda());

    const outcome = await applyPulledEvents([event()]);

    expect(outcome.conflicts).toBe(0);
    expect(outcome.applied).toBe(0);

    const after = (await db.agendas.get(AGENDA_ID))!;
    expect(after.gcal_conflict).toBe(false);
    // The stored times are untouched, still UTC.
    expect(after.start_at).toBe(LOCAL_START);
    expect(after.end_at).toBe(LOCAL_END);
    // And the round trip is recorded.
    expect(after.gcal_synced_at).not.toBeNull();
    expect(await db.conflict_log.count()).toBe(0);
  });

  it("applies a real edit made in Google, and badges it", async () => {
    const db = getDb();
    await db.agendas.add(agenda());

    // Moved an hour later, in Google.
    const outcome = await applyPulledEvents([
      event({
        start_at: "2026-09-13T08:00:00+07:00",
        end_at: "2026-09-13T09:30:00+07:00",
        updated: "2026-09-12T17:00:00.000Z",
      }),
    ]);

    expect(outcome.applied).toBe(1);
    expect(outcome.conflicts).toBe(1);

    const after = (await db.agendas.get(AGENDA_ID))!;
    expect(after.gcal_conflict).toBe(true);
    // Stored back as UTC (§13), not in Google's offset form.
    expect(after.start_at).toBe("2026-09-13T01:00:00.000Z");
    expect(after.end_at).toBe("2026-09-13T02:30:00.000Z");
    expect(await db.conflict_log.count()).toBe(1);
  });

  it("keeps a local edit that is newer than Google's version", async () => {
    const db = getDb();
    await db.agendas.add(
      agenda({ updated_at: "2026-09-12T18:00:00.000Z" }),
    );

    const outcome = await applyPulledEvents([
      event({
        start_at: "2026-09-13T09:00:00+07:00",
        end_at: "2026-09-13T10:30:00+07:00",
        updated: "2026-09-12T17:00:00.000Z",
      }),
    ]);

    expect(outcome.applied).toBe(0);
    const after = (await db.agendas.get(AGENDA_ID))!;
    expect(after.start_at).toBe(LOCAL_START);
    expect(after.gcal_conflict).toBe(false);
  });

  it("soft-deletes an agenda whose Google event was cancelled", async () => {
    const db = getDb();
    await db.agendas.add(agenda());

    const outcome = await applyPulledEvents([event({ cancelled: true })]);

    expect(outcome.removed).toBe(1);
    const after = (await db.agendas.get(AGENDA_ID))!;
    expect(after.deleted_at).not.toBeNull();
    expect(after.gcal_event_id).toBeNull();
  });

  it("ignores an event with no agenda of its own", async () => {
    const outcome = await applyPulledEvents([event({ agenda_id: null })]);
    expect(outcome).toEqual({ applied: 0, conflicts: 0, removed: 0 });
  });
});
