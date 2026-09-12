"use client";

import { getDb } from "@/lib/db/client";
import { getCurrentUserId, newId, nowIso } from "@/lib/db/mutations";
import { type GcalBusy } from "@/lib/db/schema";
import { updateSettings } from "@/hooks/use-settings";
import { pullRequestFrom, readGcalConfig } from "@/lib/gcal/config";
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
  busy_enabled: boolean;
}

export interface PullOutcome {
  applied: number;
  conflicts: number;
  removed: number;
}

const IDLE: PullOutcome = { applied: 0, conflicts: 0, removed: 0 };

/**
 * Two RFC3339 stamps naming the same moment.
 *
 * This has to be an instant comparison, not a string one. FOQUS stores UTC
 * (§13) and sends `2026-09-13T00:00:00.000Z`; Google answers in the calendar's
 * own timezone, `2026-09-13T07:00:00+07:00`. Identical moment, different text.
 *
 * Comparing the text marked *every* agenda FOQUS had just created as changed in
 * Google — and since Google stamps `updated` a moment after the write, the
 * remote always looked newer, so each one was overwritten with Google's
 * spelling and badged "Diubah dari Google Calendar" without anyone touching it.
 * A conflict badge that fires on every write teaches the user to ignore it,
 * which costs the one case it exists for.
 */
function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  // An unparseable stamp is never "the same": fall back to the text so a
  // malformed value is treated as a change rather than silently accepted.
  if (Number.isNaN(left) || Number.isNaN(right)) return a === b;
  return left === right;
}

/** Google's offset form, back to the UTC the rest of the app stores. */
function toUtc(value: string): string {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toISOString();
}

/**
 * Runs one Google pull. Returns an idle outcome (rather than throwing) when
 * Google is not connected — this is called on a timer and a disconnected
 * account is a normal state, not an error.
 */
export async function pullGoogleCalendar(): Promise<PullOutcome> {
  const config = await readGcalConfig();
  // The master switch in Pengaturan. Off is a deliberate state, not an error.
  if (!config.enabled) return IDLE;

  const res = await fetch("/api/gcal/pull", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pullRequestFrom(config)),
  });

  // 401 = locked or not signed in, 412 = not connected, 501 = not configured.
  if (res.status === 401 || res.status === 412 || res.status === 501) return IDLE;
  if (!res.ok) throw new Error(`GCal pull ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as PullResponse;

  const outcome = await applyPulledEvents(data.events);
  // Only when busy intervals were actually asked for: replacing the cache with
  // an empty list because the user turned the feature off would be right, but
  // doing it on every pull *after* that would keep clearing a cache nobody is
  // filling. `clearBusyCache` is the explicit path for turning it off.
  if (data.busy_enabled) await replaceBusyCache(data.busy);

  // The sync token and the resolved calendar are local bookkeeping; writing
  // them through `updateSettings` keeps them in the row the UI reads.
  const patch: Parameters<typeof updateSettings>[0] = {};
  if (data.sync_token !== config.sync_token) patch.gcal_sync_token = data.sync_token;
  if (data.calendar_id !== config.calendar_id) {
    // The server fell back — the chosen calendar was deleted or unshared.
    patch.gcal_calendar_id = data.calendar_id;
  }
  if (Object.keys(patch).length > 0) await updateSettings(patch);

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
      sameInstant(agenda.start_at, event.start_at) &&
      sameInstant(agenda.end_at, event.end_at);

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
      // Normalised on the way in: §13 stores every datetime in UTC, and Google
      // answers in the calendar's own offset.
      start_at: toUtc(event.start_at),
      end_at: toUtc(event.end_at),
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
 * rolling window configured in Pengaturan. Replacing rather than merging is
 * what makes a *deleted* remote event stop blocking the scheduler.
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
    // Google answers in each calendar's own offset; §13 stores UTC.
    start_at: toUtc(interval.start_at),
    end_at: toUtc(interval.end_at),
    calendar_id: interval.calendar_id,
    summary: interval.summary,
    fetched_at: fetchedAt,
  }));

  await db.transaction("rw", db.gcal_busy_cache, async () => {
    await db.gcal_busy_cache.clear();
    if (rows.length) await db.gcal_busy_cache.bulkAdd(rows);
  });
}

/**
 * Empties the busy cache. Called when the user turns off "kalender lain sebagai
 * sibuk", so the allocator stops treating intervals nobody is refreshing as
 * obstacles.
 */
export async function clearBusyCache(): Promise<void> {
  await getDb().gcal_busy_cache.clear();
}
