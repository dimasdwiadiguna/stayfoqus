"use client";

import { applyCommuteMoves } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import {
  createRow,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "@/lib/db/mutations";
import type {
  BufferType,
  CalendarEvent,
  DayOfWeek,
  EventRecurrence,
  IsoDate,
  Settings,
  UUID,
} from "@/lib/db/schema";

/**
 * Event CRUD, and the per-date skip.
 *
 * Deliberately *not* mirrored to Google Calendar. §6.2 sends agendas, and an
 * event exists precisely as the manual stand-in for that sync — writing one
 * back to Google would close a loop nobody asked for.
 */

export interface NewEventInput {
  title: string;
  location?: string | null;
  place_id?: UUID | null;
  notes?: string | null;
  start_time: string;
  end_time: string;
  recurrence?: EventRecurrence;
  days_of_week?: DayOfWeek[];
  specific_date?: IsoDate | null;
  end_date?: IsoDate | null;
  buffer_before_min?: number;
  buffer_before_type?: BufferType;
  buffer_after_min?: number;
  buffer_after_type?: BufferType;
}

/**
 * An event is a waypoint in the day's chain of places even though its own
 * commute is never stored on it (that is derived per occurrence, in
 * `expandEvents`). So every mutation here re-runs the reconciler: a meeting at
 * the office really does mean the next block starts from the office.
 */
async function reconcileCommute(): Promise<void> {
  await applyCommuteMoves();
}

export async function createEvent(input: NewEventInput, settings: Settings) {
  const event = await createRow("events", {
    title: input.title.trim(),
    location: input.location?.trim() || null,
    place_id: input.place_id ?? null,
    commute_auto: 1,
    notes: input.notes ?? null,
    start_time: input.start_time,
    end_time: input.end_time,
    recurrence: input.recurrence ?? "once",
    days_of_week: input.days_of_week ?? [],
    specific_date: input.specific_date ?? null,
    end_date: input.end_date ?? null,
    // The same defaults an agenda gets, so a commute buffer is one edit away
    // rather than something to remember.
    buffer_before_min: input.buffer_before_min ?? settings.default_buffer_before_min,
    buffer_before_type: input.buffer_before_type ?? settings.default_buffer_type,
    buffer_after_min: input.buffer_after_min ?? settings.default_buffer_after_min,
    buffer_after_type: input.buffer_after_type ?? settings.default_buffer_type,
    enabled: true,
  });
  await reconcileCommute();
  return event;
}

export type EventPatch = Partial<
  Omit<
    CalendarEvent,
    "id" | "user_id" | "created_at" | "updated_at" | "deleted_at" | "dirty"
  >
>;

export async function updateEvent(eventId: UUID, patch: EventPatch) {
  // As for agendas: typing a buffer by hand takes this event out of the
  // estimate's hands, for every one of its occurrences.
  const takesOver =
    (patch.buffer_before_min !== undefined || patch.buffer_before_type !== undefined) &&
    patch.commute_auto === undefined;

  const next = await updateRow(
    "events",
    eventId,
    takesOver ? { ...patch, commute_auto: 0 } : patch,
  );
  await reconcileCommute();
  return next;
}

export async function deleteEvent(eventId: UUID) {
  const row = await softDeleteRow("events", eventId);
  await reconcileCommute();
  return row;
}

/** Undo for `deleteEvent`. */
export async function restoreEvent(eventId: UUID) {
  const row = await restoreRow("events", eventId);
  await reconcileCommute();
  return row;
}

/**
 * Skips — or un-skips — a single occurrence of a repeating event.
 *
 * Reuses the existing exception row rather than piling up tombstones, so
 * `[event_id+date]` stays a genuine key (the reasoning behind D-058's
 * equivalent for time blocks). Returns the new skipped state.
 */
export async function toggleEventSkip(
  eventId: UUID,
  date: IsoDate,
): Promise<boolean> {
  const db = getDb();
  const existing = await db.event_exceptions
    .where("[event_id+date]")
    .equals([eventId, date])
    .first();

  if (existing && !existing.deleted_at) {
    await softDeleteRow("event_exceptions", existing.id);
    await reconcileCommute();
    return false;
  }

  if (existing) {
    await restoreRow("event_exceptions", existing.id);
    await reconcileCommute();
    return true;
  }

  await createRow("event_exceptions", { event_id: eventId, date, action: "skipped" });
  await reconcileCommute();
  return true;
}
