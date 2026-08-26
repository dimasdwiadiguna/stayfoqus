import { NextResponse } from "next/server";

import {
  GcalError,
  currentUserId,
  deleteEvent,
  findOrCreateFoqusCalendar,
  upsertEvent,
} from "@/lib/gcal/server";
import type { GcalEventPayload } from "@/lib/gcal/types";

export const dynamic = "force-dynamic";

/**
 * §6.2 — the write path. Called by the outbox drain, so a failure here must
 * return a non-2xx status: that is what feeds the queue's exponential backoff
 * and keeps the operation pending until the network comes back.
 */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let body: GcalEventPayload;
  try {
    body = (await request.json()) as GcalEventPayload;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const calendarId = await findOrCreateFoqusCalendar(userId);
    const result = await upsertEvent(userId, {
      calendarId,
      agendaId: body.agenda_id,
      summary: body.summary,
      description: body.description,
      startAt: body.start_at,
      endAt: body.end_at,
      eventId: body.event_id,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let body: { event_id?: string };
  try {
    body = (await request.json()) as { event_id?: string };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.event_id) {
    return NextResponse.json({ error: "missing_event_id" }, { status: 400 });
  }

  try {
    const calendarId = await findOrCreateFoqusCalendar(userId);
    await deleteEvent(userId, calendarId, body.event_id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
