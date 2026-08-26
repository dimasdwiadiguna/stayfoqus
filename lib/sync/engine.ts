"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "@/lib/db/client";
import { getCurrentUserId, newId, nowIso } from "@/lib/db/mutations";
import {
  SYNCED_TABLES,
  type ConflictLogEntry,
  type OutboxEntry,
  type SyncedRow,
  type SyncedTableName,
} from "@/lib/db/schema";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { syncStatus } from "@/lib/sync/status";
import { drainGcalEntry } from "@/lib/gcal/outbox";

/** §3.2: 2s, 4s, 8s… capped at 5 minutes. */
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;
/** After this many consecutive failures an entry is parked as `blocked`. */
const MAX_ATTEMPTS = 5;

const PERIODIC_MS = 60_000;
const DEBOUNCE_MS = 2_000;

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Strips IndexedDB-only fields before a row is sent to Postgres. */
function toRemote(row: SyncedRow): Record<string, unknown> {
  const { dirty: _dirty, ...rest } = row as SyncedRow & { dirty: number };
  void _dirty;
  return rest as Record<string, unknown>;
}

async function refreshCounters(): Promise<{ pending: number; blocked: number }> {
  const db = getDb();
  const [pending, blocked] = await Promise.all([
    db.outbox.where("status").equals("pending").count(),
    db.outbox.where("status").equals("blocked").count(),
  ]);
  syncStatus.set({ pending, blocked });
  return { pending, blocked };
}

/* ------------------------------------------------------------------ */
/* push                                                                */
/* ------------------------------------------------------------------ */

async function pushEntry(
  supabase: SupabaseClient,
  entry: OutboxEntry,
): Promise<void> {
  if (entry.entity === "gcal") {
    await drainGcalEntry(entry);
    return;
  }

  const table = ENTITY_TO_TABLE[entry.entity];
  if (!table) throw new Error(`Unknown outbox entity: ${entry.entity}`);

  // Re-read the live row: a backlog must never push a stale snapshot.
  const row = (await getDb()[table].get(entry.entity_id)) as SyncedRow | undefined;
  if (!row) {
    // The row was hard-purged locally; nothing to replicate.
    return;
  }

  const { error } = await supabase
    .from(table)
    .upsert(toRemote(row), { onConflict: "id" });
  if (error) throw new Error(error.message);
}

const ENTITY_TO_TABLE: Partial<Record<OutboxEntry["entity"], SyncedTableName>> = {
  category: "categories",
  todo: "todos",
  agenda: "agendas",
  pomodoro_log: "pomodoro_logs",
  availability_window: "availability_windows",
  time_block: "time_blocks",
  time_block_exception: "time_block_exceptions",
  settings: "settings",
};

/**
 * Drains the outbox strictly in insertion order, one entry at a time (§3.2).
 * A failing entry stops the queue only until its backoff expires; after
 * MAX_ATTEMPTS it is parked as `blocked` and the drain continues past it.
 */
async function drainOutbox(supabase: SupabaseClient): Promise<void> {
  const db = getDb();

  for (;;) {
    if (!isOnline()) return;

    const entry = await db.outbox
      .where("status")
      .equals("pending")
      .first();
    if (!entry) return;

    if (new Date(entry.next_attempt_at).getTime() > Date.now()) {
      // The head of the queue is still backing off. Order matters more than
      // throughput, so we wait rather than skipping ahead.
      return;
    }

    try {
      await pushEntry(supabase, entry);
      await db.outbox.delete(entry.seq!);
      await markRowClean(entry);
    } catch (err) {
      const attempts = entry.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      const blocked = attempts >= MAX_ATTEMPTS;
      await db.outbox.update(entry.seq!, {
        attempts,
        last_error: message,
        status: blocked ? "blocked" : "pending",
        next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
      });
      syncStatus.set({ lastError: message });
      if (!blocked) return; // respect the backoff before retrying the head
    }
  }
}

/** Clears `dirty` once the row has no further pending operations queued. */
async function markRowClean(entry: OutboxEntry): Promise<void> {
  const table = ENTITY_TO_TABLE[entry.entity];
  if (!table) return;
  const db = getDb();
  const stillQueued = await db.outbox
    .where("entity_id")
    .equals(entry.entity_id)
    .count();
  if (stillQueued > 0) return;
  const row = await db[table].get(entry.entity_id);
  if (row) await db[table].update(entry.entity_id, { dirty: 0 } as never);
}

/* ------------------------------------------------------------------ */
/* pull                                                                */
/* ------------------------------------------------------------------ */

async function logConflict(
  table: SyncedTableName,
  rowId: string,
  localUpdatedAt: string,
  remoteUpdatedAt: string,
): Promise<void> {
  const entry: ConflictLogEntry = {
    id: newId(),
    user_id: getCurrentUserId(),
    table_name: table,
    row_id: rowId,
    local_updated_at: localUpdatedAt,
    remote_updated_at: remoteUpdatedAt,
    resolved: "remote_wins",
    acknowledged: false,
    created_at: nowIso(),
  };
  await getDb().conflict_log.add(entry);
}

/**
 * Pulls rows changed since `last_pulled_at` (§3.2).
 *
 * Conflict rule: remote wins when it is strictly newer than the local row.
 * A local row that is dirty and at least as new keeps its value and stays
 * queued — otherwise a pull racing a push would undo the user's own edit.
 */
async function pullTable(
  supabase: SupabaseClient,
  table: SyncedTableName,
): Promise<number> {
  const db = getDb();
  const state = await db.sync_state.get(table);
  const since = state?.last_pulled_at ?? "1970-01-01T00:00:00.000Z";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(1000);

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SyncedRow[];
  if (rows.length === 0) return 0;

  let conflicts = 0;
  await db.transaction("rw", db[table], db.conflict_log, db.sync_state, async () => {
    for (const remote of rows) {
      const local = (await db[table].get(remote.id)) as SyncedRow | undefined;

      if (local) {
        const localTime = new Date(local.updated_at).getTime();
        const remoteTime = new Date(remote.updated_at).getTime();
        if (local.dirty === 1) {
          if (remoteTime <= localTime) continue; // local edit is newer; it wins
          await logConflict(table, remote.id, local.updated_at, remote.updated_at);
          conflicts += 1;
        } else if (remoteTime <= localTime) {
          continue;
        }
      }

      await db[table].put({ ...remote, dirty: 0 } as never);
    }

    const newest = rows[rows.length - 1]!.updated_at;
    await db.sync_state.put({ table_name: table, last_pulled_at: newest });
  });

  return conflicts;
}

/* ------------------------------------------------------------------ */
/* orchestration                                                       */
/* ------------------------------------------------------------------ */

let running = false;
let queuedRun = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let onConflictsApplied: ((count: number) => void) | null = null;

export function setConflictHandler(fn: (count: number) => void) {
  onConflictsApplied = fn;
}

export async function runSync(): Promise<void> {
  if (running) {
    queuedRun = true;
    return;
  }

  if (!isSupabaseConfigured()) {
    await refreshCounters();
    syncStatus.set({ phase: "local-only" });
    return;
  }

  const supabase = getSupabase();
  if (!supabase) return;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    await refreshCounters();
    syncStatus.set({ phase: "idle" });
    return;
  }

  if (!isOnline()) {
    await refreshCounters();
    syncStatus.set({ phase: "offline" });
    return;
  }

  running = true;
  syncStatus.set({ phase: "syncing", lastError: null });

  try {
    await drainOutbox(supabase);

    let conflicts = 0;
    for (const table of SYNCED_TABLES) {
      conflicts += await pullTable(supabase, table);
    }
    if (conflicts > 0) onConflictsApplied?.(conflicts);

    const { blocked } = await refreshCounters();
    syncStatus.set({
      phase: blocked > 0 ? "error" : "idle",
      lastSyncedAt: nowIso(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await refreshCounters();
    syncStatus.set({ phase: isOnline() ? "error" : "offline", lastError: message });
  } finally {
    running = false;
    if (queuedRun) {
      queuedRun = false;
      void runSync();
    }
  }
}

/** Debounced trigger used after every mutation (§3.2). */
export function requestSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync();
  }, DEBOUNCE_MS);
}

/** Re-queues every blocked entry — Settings → Sinkronisasi → "Paksa sinkron ulang". */
export async function retryBlocked(): Promise<void> {
  const db = getDb();
  await db.outbox
    .where("status")
    .equals("blocked")
    .modify({ status: "pending", attempts: 0, next_attempt_at: nowIso() });
  await refreshCounters();
  await runSync();
}

/** Discards a blocked entry the user has decided to give up on. */
export async function dropOutboxEntry(seq: number): Promise<void> {
  await getDb().outbox.delete(seq);
  await refreshCounters();
}

/** Forgets pull cursors so the next run re-reads every row from the server. */
export async function forceFullResync(): Promise<void> {
  await getDb().sync_state.clear();
  await runSync();
}

let started = false;

/** Installs the drain triggers listed in §3.2. Idempotent. */
export function startSyncEngine(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const onOnline = () => void runSync();
  const onVisibility = () => {
    if (document.visibilityState === "visible") void runSync();
  };

  window.addEventListener("online", onOnline);
  window.addEventListener("offline", () => syncStatus.set({ phase: "offline" }));
  document.addEventListener("visibilitychange", onVisibility);
  periodicTimer = setInterval(() => {
    if (isOnline()) void runSync();
  }, PERIODIC_MS);

  void refreshCounters();
  void runSync();

  return () => {
    started = false;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    if (periodicTimer) clearInterval(periodicTimer);
  };
}

export { refreshCounters };
