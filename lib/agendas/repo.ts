"use client";

import { getDb } from "@/lib/db/client";
import {
  createRow,
  enqueue,
  nowIso,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "@/lib/db/mutations";
import type {
  Agenda,
  AgendaStatus,
  BufferType,
  Settings,
  UUID,
} from "@/lib/db/schema";
import type { GcalOutboxOp } from "@/lib/gcal/types";
import { danglingLinks, resolveChains, wouldCycle } from "@/lib/scheduling/chain";

/**
 * Agenda writes, including the Google Calendar side effects from §6.2.
 *
 * Google writes are queued in the shared outbox, never awaited, so scheduling
 * works offline exactly like every other mutation (§3.3).
 */

/** §6.2: only these statuses are mirrored to Google. */
function isSyncable(status: AgendaStatus): boolean {
  return status === "planned" || status === "done" || status === "partial";
}

async function queueGcalUpsert(agendaId: UUID): Promise<void> {
  const op: GcalOutboxOp = { kind: "upsert_event", agenda_id: agendaId };
  await enqueue("gcal", agendaId, "update", op);
}

async function queueGcalDelete(agendaId: UUID, eventId: string): Promise<void> {
  const op: GcalOutboxOp = {
    kind: "delete_event",
    agenda_id: agendaId,
    gcal_event_id: eventId,
  };
  await enqueue("gcal", agendaId, "delete", op);
}

export interface NewAgendaInput {
  todo_id: UUID;
  start_at: string;
  end_at: string;
  allocated_pomodoro: number;
  status?: AgendaStatus;
  outside_window?: boolean;
  title_override?: string | null;
  buffer_before_min?: number;
  buffer_before_type?: BufferType;
  buffer_after_min?: number;
  buffer_after_type?: BufferType;
  /** §"immediately after": pin to the end of this agenda's buffer. */
  follows_agenda_id?: UUID | null;
  id?: UUID;
}

export async function createAgenda(
  input: NewAgendaInput,
  settings: Settings,
): Promise<Agenda> {
  const status = input.status ?? "planned";
  const agenda = await createRow("agendas", {
    id: input.id,
    todo_id: input.todo_id,
    title_override: input.title_override ?? null,
    start_at: input.start_at,
    end_at: input.end_at,
    allocated_pomodoro: input.allocated_pomodoro,
    buffer_before_min: input.buffer_before_min ?? settings.default_buffer_before_min,
    buffer_before_type: input.buffer_before_type ?? settings.default_buffer_type,
    buffer_after_min: input.buffer_after_min ?? settings.default_buffer_after_min,
    buffer_after_type: input.buffer_after_type ?? settings.default_buffer_type,
    status,
    outside_window: input.outside_window ?? false,
    gcal_event_id: null,
    gcal_synced_at: null,
    gcal_conflict: false,
    follows_agenda_id: input.follows_agenda_id ?? null,
  });

  if (isSyncable(status)) await queueGcalUpsert(agenda.id);
  return agenda;
}

export type AgendaPatch = Partial<
  Pick<
    Agenda,
    | "start_at"
    | "end_at"
    | "allocated_pomodoro"
    | "title_override"
    | "buffer_before_min"
    | "buffer_before_type"
    | "buffer_after_min"
    | "buffer_after_type"
    | "status"
    | "outside_window"
    | "gcal_conflict"
    | "follows_agenda_id"
  >
>;

export async function updateAgenda(
  agendaId: UUID,
  patch: AgendaPatch,
): Promise<Agenda | undefined> {
  const next = await updateRow("agendas", agendaId, patch);
  if (!next) return undefined;

  if (isSyncable(next.status)) {
    await queueGcalUpsert(agendaId);
  } else if (next.gcal_event_id) {
    // It left the syncable set (cancelled, or demoted to draft): remove the
    // Google event rather than leaving a stale one behind.
    await queueGcalDelete(agendaId, next.gcal_event_id);
    await getDb().agendas.update(agendaId, { gcal_event_id: null });
  }

  // Moving, resizing or re-buffering an agenda drags everything pinned behind
  // it. Skipped when the patch cannot have changed where anything ends.
  if (
    patch.start_at !== undefined ||
    patch.end_at !== undefined ||
    patch.buffer_after_min !== undefined ||
    patch.buffer_after_type !== undefined ||
    patch.buffer_before_min !== undefined ||
    patch.buffer_before_type !== undefined ||
    patch.follows_agenda_id !== undefined
  ) {
    await applyChainMoves();
  }

  return next;
}

/* ------------------------------------------------------------------ */
/* "immediately after" chains                                          */
/* ------------------------------------------------------------------ */

/**
 * Recomputes every pinned agenda's position and writes the ones that moved.
 *
 * Called after any change that could have shifted where something ends. The
 * writes go through `updateRow` so they sync and queue their Google updates
 * like any other edit — a follower that moved really did move.
 */
export async function applyChainMoves(): Promise<number> {
  const db = getDb();
  const agendas = (await db.agendas.toArray()).filter((a) => !a.deleted_at);

  // A predecessor that no longer exists leaves the follower pinned to nothing.
  // Clearing the link turns it back into an ordinary agenda rather than leaving
  // it quietly broken.
  for (const orphanId of danglingLinks(agendas)) {
    await updateRow("agendas", orphanId, { follows_agenda_id: null });
  }

  const fresh = (await db.agendas.toArray()).filter((a) => !a.deleted_at);
  const { moves } = resolveChains(fresh);

  for (const move of moves) {
    await updateRow("agendas", move.id, {
      start_at: move.start_at,
      end_at: move.end_at,
    });
    const row = await db.agendas.get(move.id);
    if (row && isSyncable(row.status)) await queueGcalUpsert(move.id);
  }

  return moves.length;
}

export type LinkResult = { ok: true } | { ok: false; reason: "cycle" };

/**
 * Pins `agendaId` to start as soon as `targetId` (and its buffer) is done.
 * Refuses a link that would close a loop — there would be no correct answer.
 */
export async function linkImmediatelyAfter(
  agendaId: UUID,
  targetId: UUID | null,
): Promise<LinkResult> {
  if (targetId !== null) {
    const agendas = (await getDb().agendas.toArray()).filter((a) => !a.deleted_at);
    if (wouldCycle(agendas, agendaId, targetId)) return { ok: false, reason: "cycle" };
  }
  await updateAgenda(agendaId, { follows_agenda_id: targetId });
  return { ok: true };
}

/**
 * §4.3: "Deleting an agenda never deletes its todo." The Google event goes with
 * it (§6.2), queued so it survives being offline.
 */
export async function deleteAgenda(agendaId: UUID): Promise<Agenda | undefined> {
  const agenda = await getDb().agendas.get(agendaId);
  if (!agenda || agenda.deleted_at) return undefined;

  await softDeleteRow("agendas", agendaId);
  if (agenda.gcal_event_id) {
    await queueGcalDelete(agendaId, agenda.gcal_event_id);
  }
  // Anything pinned to it is now pinned to nothing; `applyChainMoves` unlinks
  // those rather than leaving them following a ghost.
  await applyChainMoves();
  return agenda;
}

/** Undo for `deleteAgenda`. */
export async function restoreAgenda(agendaId: UUID): Promise<void> {
  await restoreRow("agendas", agendaId);
  const agenda = await getDb().agendas.get(agendaId);
  if (agenda && isSyncable(agenda.status)) await queueGcalUpsert(agendaId);
}

/* ------------------------------------------------------------------ */
/* draft lifecycle (§5.5 Step 5)                                       */
/* ------------------------------------------------------------------ */

/** Promotes a batch of drafts to `planned` and queues their Google writes. */
export async function applyDrafts(agendaIds: UUID[]): Promise<void> {
  for (const agendaId of agendaIds) {
    await updateRow("agendas", agendaId, { status: "planned" });
    await queueGcalUpsert(agendaId);
  }
}

/** Reverts an applied batch — the "Urungkan" path, within the 10s window. */
export async function revertToDrafts(agendaIds: UUID[]): Promise<void> {
  for (const agendaId of agendaIds) {
    const agenda = await getDb().agendas.get(agendaId);
    if (!agenda) continue;
    await updateRow("agendas", agendaId, { status: "draft" });
    if (agenda.gcal_event_id) {
      await queueGcalDelete(agendaId, agenda.gcal_event_id);
      await getDb().agendas.update(agendaId, { gcal_event_id: null });
    }
  }
}

/** Discards a draft batch outright — "Batalkan". */
export async function discardDrafts(agendaIds: UUID[]): Promise<void> {
  for (const agendaId of agendaIds) {
    // Drafts were never written to Google, so a plain soft delete suffices.
    await softDeleteRow("agendas", agendaId);
  }
}

/* ------------------------------------------------------------------ */
/* review (§5.8)                                                       */
/* ------------------------------------------------------------------ */

/**
 * §5.8: an agenda is *missed* when it ended in the past and is still `planned`.
 * Detection is a pure read; the banner decides what to do with the result.
 */
export async function findMissedAgendas(now = new Date()): Promise<Agenda[]> {
  const rows = await getDb()
    .agendas.where("status")
    .equals("planned")
    .toArray();
  return rows
    .filter((a) => !a.deleted_at && new Date(a.end_at) < now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
}

export async function markAgendaStatus(
  agendaId: UUID,
  status: AgendaStatus,
): Promise<void> {
  await updateAgenda(agendaId, { status });
}

/** Clears a 24-hour-old conflict badge (§6.4). */
export async function expireConflictBadges(now = new Date()): Promise<void> {
  const db = getDb();
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  const flagged = (await db.agendas.toArray()).filter(
    (a) => a.gcal_conflict && a.gcal_synced_at && new Date(a.gcal_synced_at).getTime() < cutoff,
  );
  for (const agenda of flagged) {
    // Written straight to Dexie: clearing a local badge is not a change the
    // server needs to hear about.
    await db.agendas.update(agenda.id, { gcal_conflict: false });
  }
}

export { nowIso };
