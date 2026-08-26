import { NextResponse } from "next/server";

import {
  GcalError,
  currentUserId,
  fetchBusy,
  findOrCreateFoqusCalendar,
  pullFoqusCalendar,
} from "@/lib/gcal/server";

export const dynamic = "force-dynamic";

/**
 * §6.3 — the read path, in one round trip.
 *
 *  - incremental sync of the FOQUS calendar using the caller's stored syncToken
 *  - `freebusy` across the user's other calendars for `gcal_busy_cache`
 *
 * The client passes the token it holds and stores whatever comes back. Phase 1
 * has no webhooks or push channels (§6.3), so this is polled on foreground,
 * pull-to-refresh, and every 5 minutes while the app is open.
 */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let body: { sync_token?: string | null };
  try {
    body = (await request.json()) as { sync_token?: string | null };
  } catch {
    body = {};
  }

  try {
    const calendarId = await findOrCreateFoqusCalendar(userId);
    const [pull, busy] = await Promise.all([
      pullFoqusCalendar(userId, calendarId, body.sync_token ?? null),
      fetchBusy(userId, calendarId),
    ]);

    return NextResponse.json({
      calendar_id: calendarId,
      events: pull.events,
      sync_token: pull.sync_token,
      resynced: pull.resynced,
      busy,
    });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
