"use client";

import { getDb } from "@/lib/db/client";
import { nowIso } from "@/lib/db/mutations";
import type { OutboxEntry } from "@/lib/db/schema";
import type { GcalEventResult, GcalOutboxOp } from "@/lib/gcal/types";

/**
 * Drains one Google Calendar operation (§6.2).
 *
 * The refresh token lives server-side only, so every call goes through
 * `/app/api/gcal/*`. Throwing here feeds the shared outbox backoff, which is
 * what makes scheduling work offline: the agenda is already in IndexedDB and
 * the Google write simply waits its turn.
 */
export async function drainGcalEntry(entry: OutboxEntry): Promise<void> {
  const op = entry.payload as GcalOutboxOp;
  const db = getDb();

  if (op.kind === "delete_event") {
    const res = await fetch("/api/gcal/events", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_id: op.gcal_event_id }),
    });
    // 404/410 means the event is already gone — that is the desired end state.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(await describeFailure(res));
    }
    return;
  }

  const agenda = await db.agendas.get(op.agenda_id);
  if (!agenda || agenda.deleted_at) return;

  // §6.2: drafts and cancelled agendas are never written to Google.
  if (
    agenda.status !== "planned" &&
    agenda.status !== "done" &&
    agenda.status !== "partial"
  ) {
    return;
  }

  const todo = await db.todos.get(agenda.todo_id);
  const summary = agenda.title_override ?? todo?.title ?? "FOQUS";
  const pomodoroLine = `Pomodoro: ${agenda.allocated_pomodoro}`;
  const description = [todo?.notes ?? "", pomodoroLine]
    .filter(Boolean)
    .join("\n\n");

  const res = await fetch("/api/gcal/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      agenda_id: agenda.id,
      summary,
      description,
      start_at: agenda.start_at,
      end_at: agenda.end_at,
      event_id: agenda.gcal_event_id,
    }),
  });

  if (!res.ok) throw new Error(await describeFailure(res));

  const result = (await res.json()) as GcalEventResult;
  // Written straight to Dexie, not through updateRow: recording the Google id
  // must not enqueue another outbox entry or the queue would never drain.
  await db.agendas.update(agenda.id, {
    gcal_event_id: result.event_id,
    gcal_synced_at: nowIso(),
  });
}

async function describeFailure(res: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* body already consumed or unavailable */
  }
  return `GCal ${res.status}${detail ? `: ${detail}` : ""}`;
}
