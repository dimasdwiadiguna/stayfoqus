"use client";

import { getDb } from "@/lib/db/client";
import { enqueue, getCurrentUserId, setCurrentUserId } from "@/lib/db/mutations";
import {
  LOCAL_USER_ID,
  SYNCED_TABLES,
  TABLE_TO_ENTITY,
  type SyncedRow,
  type SyncedTableName,
} from "@/lib/db/schema";

/**
 * Hands every locally created row to the account that just signed in.
 *
 * FOQUS is usable with no account at all (D-009), so rows written before the
 * first sign-in carry the sentinel `LOCAL_USER_ID`. Postgres will not take
 * them: every synced table's RLS policy is
 * `with check (user_id = (select auth.uid()))`, so an upsert carrying the
 * sentinel is rejected — and the outbox, doing exactly what it should, retries
 * it five times and parks it as `blocked`. The result is a first sign-in that
 * looks like it worked and syncs nothing.
 *
 * Re-stamping is deliberately not a plain `modify`: each adopted row is queued
 * so the push engine sends it, and `updated_at` is left alone so the
 * last-write-wins ordering of §3.2 still reflects when the user actually made
 * the change.
 */
export async function adoptLocalRows(userId: string): Promise<number> {
  const db = getDb();
  let adopted = 0;

  for (const table of SYNCED_TABLES) {
    const rows = (await db[table]
      .filter((row: SyncedRow) => row.user_id === LOCAL_USER_ID)
      .toArray()) as SyncedRow[];
    if (rows.length === 0) continue;

    await db.transaction("rw", db[table], db.outbox, async () => {
      for (const row of rows) {
        await db[table].update(row.id, { user_id: userId, dirty: 1 } as never);
        await enqueue(TABLE_TO_ENTITY[table as SyncedTableName], row.id, "create", {
          ...row,
          user_id: userId,
        });
      }
    });
    adopted += rows.length;
  }

  return adopted;
}

/**
 * Called on boot and on every auth change. Returns the number of rows adopted,
 * so the caller can decide whether to say anything about it.
 *
 * Idempotent: once a row carries a real user id there is nothing left to claim,
 * and a second sign-in on the same device does no writes at all.
 */
export async function adoptSignedInUser(userId: string): Promise<number> {
  const previous = getCurrentUserId();
  setCurrentUserId(userId);

  // Signing in as a *different* account would mean handing this device's data
  // to someone else. FOQUS is single-user by design, so the only transition
  // worth acting on is sentinel → real account.
  if (previous !== LOCAL_USER_ID && previous !== userId) return 0;

  return adoptLocalRows(userId);
}
