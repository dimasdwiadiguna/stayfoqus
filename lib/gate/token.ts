/**
 * The access gate's token, as pure functions over Web Crypto.
 *
 * Deliberately dependency-free and edge-safe: `middleware.ts` runs on the edge
 * runtime, where Node's `crypto` module is unavailable, and this module is the
 * only thing it needs besides the password itself.
 *
 * The signing key *is* the password, so there is no second secret to configure
 * and rotating the password invalidates every issued cookie at once — which is
 * the behaviour you want from a gate whose whole purpose is "only me".
 */

const VERSION = "v1";
const encoder = new TextEncoder();

/** How long an unlocked session lasts before the password is asked again. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export const GATE_COOKIE = "foqus_gate";

function base64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Compares two strings in time that does not depend on where they differ.
 *
 * Lengths are allowed to leak — both operands here are fixed-width digests or
 * signatures, so there is nothing to learn from that.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(password: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

async function digest(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * Password check. Both sides are hashed first so the comparison is over two
 * equal-length digests and the attempt reveals nothing about the real length.
 */
export async function passwordMatches(
  password: string,
  attempt: string,
): Promise<boolean> {
  const [expected, actual] = await Promise.all([digest(password), digest(attempt)]);
  return constantTimeEqual(expected, actual);
}

/** Issues `"<expiry>.<signature>"`, valid until `now + SESSION_MS`. */
export async function signToken(
  password: string,
  now: number = Date.now(),
): Promise<string> {
  const expiresAt = now + SESSION_MS;
  const payload = `${VERSION}.${expiresAt}`;
  return `${expiresAt}.${await hmac(password, payload)}`;
}

/**
 * Verifies a token against the current password. Returns false for anything
 * malformed, expired, or signed with a different password.
 */
export async function verifyToken(
  password: string,
  token: string | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token) return false;

  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(token.slice(0, separator));
  const signature = token.slice(separator + 1);
  if (!Number.isFinite(expiresAt) || signature.length === 0) return false;
  if (expiresAt <= now) return false;

  const expected = await hmac(password, `${VERSION}.${expiresAt}`);
  return constantTimeEqual(expected, signature);
}
