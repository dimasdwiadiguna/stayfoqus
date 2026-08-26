"use client";

import { getDb } from "@/lib/db/client";
import { getCurrentUserId, newId, nowIso } from "@/lib/db/mutations";
import { SETTINGS_ROW_ID, type GcalBusy } from "@/lib/db/schema";
import { updateSettings } from "@/hooks/use-settings";
import type { GcalBusyInterval, GcalPullEvent } from "@/lib/gcal/types";

/**
 * §6.3/§6.4 — the client half of the Google read path.
 *
 * Conflict rule: "If a Google event was modified more recently than the local
 * agenda, the Google version wins. Set `gcal_conflict = true`, show a small
 * badge on the agenda for 24 hours, and log it."
 */

export interface PullResponse {
  calendar_id: string;
  events: GcalPullEvent[];
  sync_token: string | null;
  resynced: boolean;
  busy: GcalBusyInterval[];
}

export interface PullOutcome {
  applied: number;
  conflicts: number;
  removed: number;
}

const IDLE: PullOutcome = { applied: 0, conflicts: 0, removed: 0 };

/**
 * Runs one Google pull. Returns an idle outcome (rather than throwing) when
 * Google is not connected — this is called on a timer and a disconnected
 * account is a normal state, not an error.
 */
export async function pullGoogleCalendar(): Promise<PullOutcome> {
  const db = getDb();
  const settings = await db.settings.get(SETTINGS_ROW_ID);
  if (!settings) return IDLE;

  const res = await fetch("/api/gcal/pull", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sync_token: settings.gcal_sync_token }),
  });

  // 401 = not signed in, 412 = not connected, 501 = not configured.
  if (res.status === 401 || res.status === 412 || res.status === 501) return IDLE;
  if (!res.ok) throw new Error(`GCal pull ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as PullResponse;

  const outcome = await applyPulledEvents(data.events);
  await replaceBusyCache(data.busy);

  // The sync token and calendar id are local bookkeeping; writing them through
  // `updateSettings` keeps them in the same row the UI reads.
  if (
    data.sync_token !== settings.gcal_sync_token ||
    data.calendar_id !== settings.gcal_calendar_id
  ) {
    await updateSettings({
      gcal_sync_token: data.sync_token,
      gcal_calendar_id: data.calendar_id,
    });
  }

  return outcome;
}

/**
 * Applies time changes from Google to the matching local agendas.
 *
 * Only events carrying `foqusAgendaId` are applied — an event a user created by
 * hand in the FOQUS calendar has no local todo to attach to, and inventing one
 * would be worse than ignoring it.
 */
export async function applyPulledEvents(
  events: readonly GcalPullEvent[],
): Promise<PullOutcome> {
  const db = getDb();
  let applied = 0;
  let conflicts = 0;
  let removed = 0;

  for (const event of events) {
    if (!event.agenda_id) continue;
    const agenda = await db.agendas.get(event.agenda_id);
    if (!agenda || agenda.deleted_at) continue;

    if (event.cancelled) {
      // Deleted in Google → the local agenda goes with it. Written straight to
      // Dexie: echoing the delete back to Google would be a pointless round trip.
      await db.agendas.update(agenda.id, {
        deleted_at: nowIso(),
        updated_at: nowIso(),
        gcal_event_id: null,
      });
      removed += 1;
      continue;
    }

    if (!event.start_at || !event.end_at) continue;

    const remoteTime = new Date(event.updated).getTime();
    const localTime = new Date(agenda.updated_at).getTime();
    const unchanged =
      agenda.start_at === event.start_at && agenda.end_at === event.end_at;

    if (unchanged) {
      await db.agendas.update(agenda.id, {
        gcal_event_id: event.event_id,
        gcal_synced_at: nowIso(),
      });
      continue;
    }

    if (remoteTime <= localTime) {
      // The local edit is newer; the outbox will push it over Google's version.
      continue;
    }

    await db.agendas.update(agenda.id, {
      start_at: event.start_at,
      end_at: event.end_at,
      gcal_event_id: event.event_id,
      gcal_synced_at: nowIso(),
      gcal_conflict: true,
      updated_at: event.updated,
    });
    applied += 1;
    conflicts += 1;

    await db.conflict_log.add({
      id: newId(),
      user_id: getCurrentUserId(),
      table_name: "agendas",
      row_id: agenda.id,
      local_updated_at: agenda.updated_at,
      remote_updated_at: event.updated,
      resolved: "remote_wins",
      acknowledged: false,
      created_at: nowIso(),
    });
  }

  return { applied, conflicts, removed };
}

/**
 * §4.10 — `gcal_busy_cache` is a read-only mirror, refreshed wholesale for the
 * rolling −7/+30 day window. Replacing rather than merging is what makes a
 * *deleted* remote event stop blocking the scheduler.
 */
export async function replaceBusyCache(
  intervals: readonly GcalBusyInterval[],
): Promise<void> {
  const db = getDb();
  const fetchedAt = nowIso();
  const userId = getCurrentUserId();

  const rows: GcalBusy[] = intervals.map((interval) => ({
    id: newId(),
    user_id: userId,
    start_at: interval.start_at,
    end_at: interval.end_at,
    calendar_id: interval.calendar_id,
    summary: interval.summary,
    fetched_at: fetchedAt,
  }));

  await db.transaction("rw", db.gcal_busy_cache, async () => {
    await db.gcal_busy_cache.clear();
    if (rows.length) await db.gcal_busy_cache.bulkAdd(rows);
  });
}
