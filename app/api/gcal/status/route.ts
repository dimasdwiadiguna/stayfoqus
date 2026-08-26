import { NextResponse } from "next/server";

import {
  GcalError,
  currentUserId,
  disconnect,
  findOrCreateFoqusCalendar,
  googleClientConfig,
  isConnected,
} from "@/lib/gcal/server";

export const dynamic = "force-dynamic";

/** Connection state for Settings → Akun & Google Calendar. */
export async function GET() {
  const configured = googleClientConfig() !== null;
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ configured, signed_in: false, connected: false });
  }
  try {
    return NextResponse.json({
      configured,
      signed_in: true,
      connected: configured && (await isConnected(userId)),
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
    return NextResponse.json({ calendar_id: calendarId });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}

export async function DELETE() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  await disconnect(userId);
  return NextResponse.json({ ok: true });
}
