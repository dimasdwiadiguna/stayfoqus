import { NextResponse } from "next/server";

import {
  FOQUS_CALENDAR_NAME,
  GcalError,
  currentUserId,
  disconnect,
  findOrCreateFoqusCalendar,
  googleClientConfig,
  isConnected,
  missingScopes,
} from "@/lib/gcal/server";
import { describeGoogleError } from "@/lib/gcal/scopes";

export const dynamic = "force-dynamic";

/** Connection state for Settings → Akun & Google Calendar. */
export async function GET() {
  const configured = googleClientConfig() !== null;
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ configured, signed_in: false, connected: false });
  }
  try {
    const connected = configured && (await isConnected(userId));
    // A connection made before `calendar.calendars` was requested cannot create
    // a calendar, and says so with a 403 nobody can read. Reported here so the
    // UI can ask for a reconnect before anything fails.
    const missing = connected ? await missingScopes(userId) : [];
    return NextResponse.json({
      configured,
      signed_in: true,
      connected,
      scopes_ok: missing.length === 0,
      missing_scopes: missing,
    });
  } catch {
    return NextResponse.json({ configured, signed_in: true, connected: false });
  }
}

/**
 * Ensures the dedicated FOQUS calendar exists and returns its id (§6.1).
 * The client stores it in `settings.gcal_calendar_id`.
 */
export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  try {
    const calendarId = await findOrCreateFoqusCalendar(userId);
    return NextResponse.json({
      calendar_id: calendarId,
      calendar_name: FOQUS_CALENDAR_NAME,
    });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: describeGoogleError(err) }, { status });
  }
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  await disconnect(userId);
  return NextResponse.json({ ok: true });
}
