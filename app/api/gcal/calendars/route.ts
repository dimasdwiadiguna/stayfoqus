import { NextResponse } from "next/server";

import {
  GcalError,
  createCalendar,
  currentUserId,
  listCalendars,
} from "@/lib/gcal/server";

export const dynamic = "force-dynamic";

/**
 * The calendars the account can see, so Pengaturan can offer a choice instead
 * of the app deciding for the user (§6.1 fixes only that the *primary* is off
 * limits, not which secondary calendar is used).
 */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  try {
    return NextResponse.json({ calendars: await listCalendars(userId) });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}

/** Creates a new secondary calendar with a name the user typed. */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  let body: { name?: unknown };
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 120) {
    return NextResponse.json({ error: "bad_name" }, { status: 400 });
  }

  try {
    return NextResponse.json({ calendar: await createCalendar(userId, name) });
  } catch (err) {
    const status = err instanceof GcalError ? err.status : 500;
    return NextResponse.json({ error: String(err) }, { status });
  }
}
