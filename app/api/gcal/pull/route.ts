import { NextResponse } from "next/server";

import {
  GcalError,
  currentUserId,
  fetchBusy,
  pullFoqusCalendar,
  resolveCalendar,
} from "@/lib/gcal/server";
import type { GcalPullRequest } from "@/lib/gcal/types";

export const dynamic = "force-dynamic";

/**
 * §6.3 — the read path, in one round trip.
 *
 *  - incremental sync of the chosen calendar using the caller's stored syncToken
 *  - `freebusy` across the other calendars for `gcal_busy_cache`
 *
 * Every preference in the request body comes from the settings row the user
 * edits in Pengaturan — which calendar, whether busy intervals are wanted at
 * all, which calendars count, and how wide the window is. The server contributes
 * the refresh token and nothing else. Phase 1 has no webhooks or push channels
 * (§6.3), so this is polled on foreground, pull-to-refresh, and every 5 minutes
 * while the app is open.
 */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let body: Partial<GcalPullRequest>;
  try {
    body = (await request.json()) as Partial<GcalPullRequest>;
  } catch {
    body = {};
  }

  const window = {
    past_days: body.window_past_days ?? 7,
    future_days: body.window_future_days ?? 30,
  };

  try {
    const calendarId = await resolveCalendar(userId, body.calendar_id ?? null);
    const busyWanted = body.busy_enabled !== false;

    const [pull, busy] = await Promise.all([
      pullFoqusCalendar(userId, calendarId, body.sync_token ?? null, window),
      busyWanted
        ? fetchBusy(userId, calendarId, body.busy_calendar_ids ?? null, window)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      calendar_id: calendarId,
      events: pull.events,
      sync_token: pull.sync_token,
      resynced: pull.resynced,
      busy,
      // Echoed so the client can tell "you asked for none" from "there were
      // none", and leave the cache alone in the first case.
      busy_enabled: busyWanted,
    });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
