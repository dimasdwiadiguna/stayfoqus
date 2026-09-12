/**
 * The Google OAuth scopes this app needs, and the two pure questions asked
 * about them. Kept out of `lib/gcal/server.ts` so they can be unit-tested —
 * that module imports `server-only`, which by design cannot be loaded here.
 */

/**
 * §6.1 names two scopes — `calendar.events` and `calendar.readonly` — and they
 * are not enough.
 *
 * Google's own discovery document
 * (`https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest`) lists
 * `calendars.insert` as requiring one of `calendar`, `calendar.app.created` or
 * `calendar.calendars`. Neither brief scope is among them, so §6.1's very first
 * instruction — "find or create a secondary calendar named FOQUS" — failed with
 * a 403 `insufficientPermissions` the moment it had to create one. Reading
 * (`calendarList.list`, `freebusy.query`) was fine under `calendar.readonly`,
 * which is why the failure looked like a calendar problem rather than a scope
 * problem.
 *
 * `calendar.calendars` is the narrowest fix: it grants calendar creation and
 * management, and nothing about anyone's events. The broad `calendar` scope
 * would also work and grants far more than this app touches.
 */
export const GOOGLE_SCOPES = [
  // Create and manage the FOQUS calendar itself (calendars.insert).
  "https://www.googleapis.com/auth/calendar.calendars",
  // Write agendas as events on it (§6.2).
  "https://www.googleapis.com/auth/calendar.events",
  // calendarList.list for the picker, freebusy.query for the busy cache (§6.3).
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

/**
 * Which required scopes a granted scope string is missing.
 *
 * Google returns the granted set on every token response and FOQUS stores it
 * verbatim, so this needs no network call. An empty result means the connection
 * is complete; anything else means the user consented under an older scope list
 * and has to reconnect — a token cannot be widened in place.
 *
 * A null or empty grant is treated as *unknown*, not as complete: a token
 * stored before scopes were recorded would otherwise pass and then fail with a
 * 403 in the middle of a sync. Prompting a reconnect is the cheaper mistake.
 */
export function missingScopesFrom(granted: string | null | undefined): string[] {
  const have = new Set((granted ?? "").split(/\s+/).filter(Boolean));
  if (have.size === 0) return [...GOOGLE_SCOPES];
  return GOOGLE_SCOPES.filter((scope) => !have.has(scope));
}

/**
 * A Google error worth showing a human.
 *
 * Google answers with a JSON envelope whose useful sentence is buried three
 * levels down, and the raw body is what a `GcalError` carries. The settings
 * screen was rendering that as "Tidak bisa memuat daftar kalender", which threw
 * away the one line that says what to do — most often
 * "Request had insufficient authentication scopes."
 */
export function describeGoogleError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; errors?: { message?: string }[] } | string;
      error_description?: string;
    };
    if (typeof parsed.error === "string") {
      return parsed.error_description ?? parsed.error;
    }
    const message = parsed.error?.message ?? parsed.error?.errors?.[0]?.message;
    if (message) return message;
  } catch {
    // Not JSON — Google also returns plain text for some failures.
  }
  return raw.slice(0, 300);
}
