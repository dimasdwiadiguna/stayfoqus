import { NextResponse } from "next/server";

import { gateEnabled, gatePassword } from "@/lib/gate/config";
import {
  GATE_COOKIE,
  SESSION_MS,
  passwordMatches,
  signToken,
  verifyToken,
} from "@/lib/gate/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Throttle, so the gate cannot be brute-forced from a script.
 *
 * In-memory and therefore per-instance: a serverless deployment may run several
 * at once, and a cold start forgets everything. That is honest about what this
 * buys — it turns thousands of guesses per second into a handful, which is the
 * difference that matters for a human-chosen password. It is not a substitute
 * for choosing a long one.
 */
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, { count: number; firstAt: number }>();

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function recordAttempt(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

/** Whether the gate is on at all, and whether this visitor is already through. */
export async function GET(request: Request) {
  const password = gatePassword();
  if (!password) return NextResponse.json({ enabled: false, unlocked: true });

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${GATE_COOKIE}=`))
    ?.slice(GATE_COOKIE.length + 1);

  return NextResponse.json({
    enabled: true,
    unlocked: await verifyToken(password, cookie),
  });
}

/** Unlocks. On success the response carries the signed session cookie. */
export async function POST(request: Request) {
  const password = gatePassword();
  if (!password) {
    // Nothing to unlock. Answering 200 keeps the client's flow identical in
    // local development, where the gate is deliberately off.
    return NextResponse.json({ ok: true, enabled: false });
  }

  if (!recordAttempt(clientKey(request))) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const attempt = typeof body.password === "string" ? body.password : "";
  if (!(await passwordMatches(password, attempt))) {
    return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  }

  attempts.delete(clientKey(request));

  const response = NextResponse.json({ ok: true, enabled: true });
  response.cookies.set(GATE_COOKIE, await signToken(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_MS / 1000),
  });
  return response;
}

/** Locks this device again — Pengaturan → "Kunci sekarang". */
export async function DELETE() {
  const response = NextResponse.json({ ok: true, enabled: gateEnabled() });
  response.cookies.set(GATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
