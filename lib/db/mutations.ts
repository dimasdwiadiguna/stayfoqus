import { getDb } from "@/lib/db/client";
import {
  LOCAL_USER_ID,
  TABLE_TO_ENTITY,
  type OutboxEntity,
  type OutboxEntry,
  type OutboxOperation,
  type SyncedRowMap,
  type SyncedTableName,
  type UUID,
} from "@/lib/db/schema";

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): UUID {
  return crypto.randomUUID();
}

/**
 * The owning user for locally created rows. Supabase Auth overwrites this at
 * first sign-in (`lib/sync/adopt.ts`); until then every row belongs to the
 * local sentinel user so the app is fully usable without an account.
 */
let currentUserId: UUID = LOCAL_USER_ID;

export function setCurrentUserId(userId: UUID) {
  currentUserId = userId;
}

export function getCurrentUserId(): UUID {
  return currentUserId;
}

/**
 * Notified after every committed mutation. The sync engine registers its
 * debounced trigger here (§3.2) — this indirection keeps `lib/db` free of any
 * dependency on the network layer, so mutations stay unit-testable.
 */
let afterMutate: (() => void) | null = null;

export function setAfterMutate(fn: (() => void) | null) {
  afterMutate = fn;
}

function notifyMutated() {
  afterMutate?.();
}

/** Fields the caller never supplies — they are stamped by the mutation layer. */
type Managed = "id" | "user_id" | "created_at" | "updated_at" | "deleted_at" | "dirty";

export type NewRow<T extends SyncedTableName> = Omit<SyncedRowMap[T], Managed> &
  Partial<Pick<SyncedRowMap[T], "id">>;

export type RowPatch<T extends SyncedTableName> = Partial<
  Omit<SyncedRowMap[T], Managed>
>;

/**
 * Appends an outbox entry. Called inside the same Dexie transaction as the row
 * write so a mutation is never visible in the UI without a queued operation.
 *
 * The payload is a snapshot taken at enqueue time; the push engine re-reads the
 * live row before sending so a backlog never pushes stale field values. The
 * snapshot is retained because it is what Settings → Sinkronisasi shows for a
 * blocked entry, and because `gcal` entries carry data that has no row at all.
 */
export async function enqueue(
  entity: OutboxEntity,
  entityId: UUID,
  operation: OutboxOperation,
  payload: unknown,
): Promise<void> {
  const entry: Omit<OutboxEntry, "seq"> = {
    id: newId(),
    entity,
    entity_id: entityId,
    operation,
    payload,
    attempts: 0,
    last_error: null,
    status: "pending",
    created_at: nowIso(),
    next_attempt_at: nowIso(),
  };
  await getDb().outbox.add(entry as OutboxEntry);
}

async function withOutbox<R>(
  table: SyncedTableName,
  fn: () => Promise<R>,
): Promise<R> {
  const db = getDb();
  const result = await db.transaction("rw", db[table], db.outbox, fn);
  notifyMutated();
  return result;
}

export async function createRow<T extends SyncedTableName>(
  table: T,
  data: NewRow<T>,
): Promise<SyncedRowMap[T]> {
  const ts = nowIso();
  const row = {
    ...data,
    id: data.id ?? newId(),
    user_id: currentUserId,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 1,
  } as unknown as SyncedRowMap[T];

  await withOutbox(table, async () => {
    await getDb()[table].put(row as never);
    await enqueue(TABLE_TO_ENTITY[table], row.id, "create", row);
  });
  return row;
}

export async function updateRow<T extends SyncedTableName>(
  table: T,
  id: UUID,
  patch: RowPatch<T>,
): Promise<SyncedRowMap[T] | undefined> {
  const db = getDb();
  return withOutbox(table, async () => {
    const existing = (await db[table].get(id)) as SyncedRowMap[T] | undefined;
    if (!existing) return undefined;
    const next = {
      ...existing,
      ...patch,
      updated_at: nowIso(),
      dirty: 1,
    } as SyncedRowMap[T];
    await db[table].put(next as never);
    await enqueue(TABLE_TO_ENTITY[table], id, "update", next);
    return next;
  });
}

/**
 * Soft delete (§3.2). Rows are never removed from IndexedDB by user action —
 * only `purgeDeleted` reclaims space for rows the server has already accepted.
 */
export async function softDeleteRow<T extends SyncedTableName>(
  table: T,
  id: UUID,
): Promise<void> {
  const db = getDb();
  await withOutbox(table, async () => {
    const existing = (await db[table].get(id)) as SyncedRowMap[T] | undefined;
    if (!existing || existing.deleted_at) return;
    const ts = nowIso();
    const next = {
      ...existing,
      deleted_at: ts,
      updated_at: ts,
      dirty: 1,
    } as SyncedRowMap[T];
    await db[table].put(next as never);
    await enqueue(TABLE_TO_ENTITY[table], id, "delete", next);
  });
}

/** Restores a soft-deleted row — the undo path for destructive gestures (§8). */
export async function restoreRow<T extends SyncedTableName>(
  table: T,
  id: UUID,
): Promise<void> {
  const db = getDb();
  await withOutbox(table, async () => {
    const existing = (await db[table].get(id)) as SyncedRowMap[T] | undefined;
    if (!existing) return;
    const next = {
      ...existing,
      deleted_at: null,
      updated_at: nowIso(),
      dirty: 1,
    } as SyncedRowMap[T];
    await db[table].put(next as never);
    await enqueue(TABLE_TO_ENTITY[table], id, "update", next);
  });
}

/**
 * Applies a batch of writes as one transaction across several tables.
 * Used by flows that must be atomic for undo to be coherent — applying a draft
 * batch, releasing an agenda back to the inbox, deleting a parent todo.
 */
export async function batch<R>(
  tables: SyncedTableName[],
  fn: () => Promise<R>,
): Promise<R> {
  const db = getDb();
  const stores = [...new Set(tables)].map((t) => db[t]);
  const result = await db.transaction("rw", [...stores, db.outbox], fn);
  notifyMutated();
  return result;
}
