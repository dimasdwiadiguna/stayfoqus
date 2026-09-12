import "server-only";

import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import { GOOGLE_SCOPES, missingScopesFrom } from "@/lib/gcal/scopes";
import type {
  GcalBusyInterval,
  GcalCalendar,
  GcalPullEvent,
} from "@/lib/gcal/types";

/**
 * §3.3 — all Google Calendar access is server-side.
 *
 * The refresh token never reaches the browser: it lives in
 * `public.google_credentials`, which has RLS enabled and no policies, so only
 * the service role can read it. Everything in this module runs inside a Route
 * Handler under `/app/api/gcal/*`.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export const FOQUS_CALENDAR_NAME = "FOQUS";

/** Marker written on every event so a round trip can be matched (§6.2). */
export const FOQUS_AGENDA_PROPERTY = "foqusAgendaId";

export interface GoogleCredentials {
  user_id: string;
  refresh_token: string;
  access_token: string | null;
  expires_at: string | null;
  scope: string | null;
}

export class GcalError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GcalError";
  }
}

export function googleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!clientId || !clientSecret || !siteUrl) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl.replace(/\/$/, "")}/api/gcal/callback`,
  };
}

/** The signed-in Supabase user, or null. Route handlers must never assume one. */
export async function currentUserId(): Promise<string | null> {
  const supabase = await getServerSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

async function readCredentials(userId: string): Promise<GoogleCredentials | null> {
  const service = getServiceSupabase();
  if (!service) throw new GcalError("Supabase service role is not configured", 500);

  const { data, error } = await service
    .from("google_credentials")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new GcalError(error.message, 500);
  return (data as GoogleCredentials | null) ?? null;
}

interface TokenResponse {
  refresh_token?: string | null;
  access_token: string;
  expires_in: number;
  scope?: string;
}

function accessFields(input: TokenResponse): Record<string, unknown> {
  return {
    access_token: input.access_token,
    expires_at: new Date(Date.now() + input.expires_in * 1000).toISOString(),
    scope: input.scope ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Stores the tokens from a completed consent.
 *
 * Only this path ever has a refresh token to write, which is why it is the only
 * path allowed to create the row.
 */
export async function saveNewCredentials(
  userId: string,
  input: TokenResponse,
): Promise<void> {
  const service = getServiceSupabase();
  if (!service) throw new GcalError("Supabase service role is not configured", 500);

  if (!input.refresh_token) {
    /*
     * Google issues a refresh token only when it feels like it — and never on a
     * re-consent that it decides is redundant. `/api/gcal/connect` asks for
     * `access_type=offline` with `prompt=consent` precisely to force one, so
     * arriving here without it means the grant is unusable: there would be
     * nothing to refresh with once the hour is up.
     */
    throw new GcalError(
      "Google returned no refresh token. Remove FOQUS from your Google account " +
        "permissions and connect again.",
      400,
    );
  }

  const { error } = await service.from("google_credentials").upsert(
    { user_id: userId, refresh_token: input.refresh_token, ...accessFields(input) },
    { onConflict: "user_id" },
  );
  if (error) throw new GcalError(error.message, 500);
}

/**
 * Records a refreshed access token against credentials that already exist.
 *
 * An UPDATE, never an upsert. A refresh response carries no refresh token, and
 * `INSERT … ON CONFLICT DO UPDATE` does **not** save you from that: Postgres
 * checks NOT NULL on the row it is about to insert *before* it arbitrates the
 * conflict, so the statement fails with
 *
 *   null value in column "refresh_token" … violates not-null constraint
 *
 * even when the row is there and the UPDATE branch would have been fine. The
 * previous code omitted the column and trusted the conflict clause to leave it
 * alone; the intent was right and the mechanism could not deliver it. Every
 * connection worked for exactly one hour — until the first access token expired
 * — and then every Google call failed.
 */
export async function saveRefreshedAccessToken(
  userId: string,
  input: TokenResponse,
): Promise<void> {
  const service = getServiceSupabase();
  if (!service) throw new GcalError("Supabase service role is not configured", 500);

  const { data, error } = await service
    .from("google_credentials")
    .update(accessFields(input))
    .eq("user_id", userId)
    .select("user_id");

  if (error) throw new GcalError(error.message, 500);
  if (!data || data.length === 0) {
    // Disconnected between reading the credentials and refreshing them.
    throw new GcalError("Google Calendar is not connected", 412);
  }
}

export async function disconnect(userId: string): Promise<void> {
  const service = getServiceSupabase();
  if (!service) return;
  await service.from("google_credentials").delete().eq("user_id", userId);
}

/**
 * A valid access token, refreshing it when it is within a minute of expiry.
 * Callers never see the refresh token.
 */
async function accessTokenFor(userId: string): Promise<string> {
  const creds = await readCredentials(userId);
  if (!creds) throw new GcalError("Google Calendar is not connected", 412);

  const stillValid =
    creds.access_token &&
    creds.expires_at &&
    new Date(creds.expires_at).getTime() - Date.now() > 60_000;
  if (stillValid) return creds.access_token!;

  const config = googleClientConfig();
  if (!config) throw new GcalError("Google OAuth is not configured", 500);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    // A revoked or expired refresh token is terminal — the user must reconnect.
    throw new GcalError(`Token refresh failed: ${await res.text()}`, 401);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };
  await saveRefreshedAccessToken(userId, json);
  return json.access_token;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}> {
  const config = googleClientConfig();
  if (!config) throw new GcalError("Google OAuth is not configured", 500);

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new GcalError(`Code exchange failed: ${await res.text()}`, 400);
  return res.json();
}

async function googleFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await accessTokenFor(userId);
  return fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });
}

async function googleJson<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await googleFetch(userId, path, init);
  if (!res.ok) throw new GcalError(await res.text(), res.status);
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* calendar setup (§6.1)                                               */
/* ------------------------------------------------------------------ */

interface CalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  deleted?: boolean;
}

const WRITABLE_ROLES = new Set(["owner", "writer"]);

async function calendarList(userId: string): Promise<CalendarListEntry[]> {
  const list = await googleJson<{ items?: CalendarListEntry[] }>(
    userId,
    "/users/me/calendarList?maxResults=250",
  );
  return (list.items ?? []).filter((entry) => !entry.deleted);
}

/**
 * Every calendar the account can see, for the picker in Pengaturan.
 *
 * The primary is included but flagged: §6.1 forbids *writing* to it, and the
 * UI needs to say why rather than silently omitting the calendar the user
 * thinks of as theirs.
 */
export async function listCalendars(userId: string): Promise<GcalCalendar[]> {
  return (await calendarList(userId)).map((entry) => ({
    id: entry.id,
    summary: entry.summary ?? entry.id,
    primary: entry.primary === true,
    writable: entry.primary !== true && WRITABLE_ROLES.has(entry.accessRole ?? ""),
  }));
}

/** Creates a secondary calendar with the given name and returns it. */
export async function createCalendar(
  userId: string,
  name: string,
): Promise<GcalCalendar> {
  const created = await googleJson<{ id: string; summary?: string }>(
    userId,
    "/calendars",
    {
      method: "POST",
      body: JSON.stringify({ summary: name, description: "Agenda FOQUS" }),
    },
  );
  return {
    id: created.id,
    summary: created.summary ?? name,
    primary: false,
    writable: true,
  };
}

/**
 * §6.1: "find or create a secondary calendar named FOQUS … Never write to the
 * primary calendar." The primary is filtered out explicitly, so a user who
 * happens to have named their primary calendar "FOQUS" still gets a new one.
 */
export async function findOrCreateFoqusCalendar(userId: string): Promise<string> {
  const entries = await calendarList(userId);

  const existing = entries.find(
    (c) =>
      !c.primary &&
      c.summary === FOQUS_CALENDAR_NAME &&
      WRITABLE_ROLES.has(c.accessRole ?? ""),
  );
  if (existing) return existing.id;

  return (await createCalendar(userId, FOQUS_CALENDAR_NAME)).id;
}

/**
 * The calendar a request should act on.
 *
 * The client sends whatever the user picked in Pengaturan; this is the one
 * place that decides whether it may be honoured. A calendar that has since been
 * deleted, unshared, or downgraded to read-only falls back to find-or-create
 * rather than failing, so a sync never stops on a choice made months ago. The
 * *primary* calendar is refused outright — §6.1 is explicit, and silently
 * writing an agenda into someone's main calendar is not a recoverable mistake.
 */
export async function resolveCalendar(
  userId: string,
  requested: string | null | undefined,
): Promise<string> {
  if (!requested) return findOrCreateFoqusCalendar(userId);

  const entries = await calendarList(userId);
  const match = entries.find((entry) => entry.id === requested);

  if (match?.primary) {
    throw new GcalError("Refusing to write to the primary calendar", 400);
  }
  if (match && WRITABLE_ROLES.has(match.accessRole ?? "")) return match.id;

  return findOrCreateFoqusCalendar(userId);
}

/* ------------------------------------------------------------------ */
/* events (§6.2)                                                       */
/* ------------------------------------------------------------------ */

export interface UpsertEventInput {
  calendarId: string;
  agendaId: string;
  summary: string;
  description: string;
  startAt: string;
  endAt: string;
  eventId: string | null;
}

export async function upsertEvent(
  userId: string,
  input: UpsertEventInput,
): Promise<{ event_id: string; updated: string }> {
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startAt },
    end: { dateTime: input.endAt },
    // §6.2: no attendees, no reminders in Phase 1.
    attendees: [],
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: { [FOQUS_AGENDA_PROPERTY]: input.agendaId },
    },
  };

  const encoded = encodeURIComponent(input.calendarId);

  if (input.eventId) {
    const res = await googleFetch(
      userId,
      `/calendars/${encoded}/events/${encodeURIComponent(input.eventId)}`,
      { method: "PUT", body: JSON.stringify(body) },
    );
    if (res.ok) {
      const json = (await res.json()) as { id: string; updated: string };
      return { event_id: json.id, updated: json.updated };
    }
    // The event was deleted in Google; fall through and create a new one.
    if (res.status !== 404 && res.status !== 410) {
      throw new GcalError(await res.text(), res.status);
    }
  }

  const created = await googleJson<{ id: string; updated: string }>(
    userId,
    `/calendars/${encoded}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return { event_id: created.id, updated: created.updated };
}

export async function deleteEvent(
  userId: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await googleFetch(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // Already gone is the desired end state.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GcalError(await res.text(), res.status);
  }
}

/* ------------------------------------------------------------------ */
/* incremental read (§6.3)                                             */
/* ------------------------------------------------------------------ */

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

function toPullEvent(event: GoogleEvent): GcalPullEvent {
  return {
    event_id: event.id,
    agenda_id: event.extendedProperties?.private?.[FOQUS_AGENDA_PROPERTY] ?? null,
    start_at: event.start?.dateTime ?? null,
    end_at: event.end?.dateTime ?? null,
    summary: event.summary ?? null,
    updated: event.updated ?? new Date().toISOString(),
    cancelled: event.status === "cancelled",
  };
}

/**
 * The rolling window a full resync and the busy cache cover.
 *
 * §4.10 fixes the defaults at −7/+30 days; they are parameters rather than
 * constants because the user sets them in Pengaturan — someone who plans a
 * quarter ahead needs more than thirty days of busy intervals for the
 * allocator to be telling the truth.
 */
export interface GcalWindow {
  past_days: number;
  future_days: number;
}

export const DEFAULT_WINDOW: GcalWindow = { past_days: 7, future_days: 30 };

const DAY_MS = 86_400_000;

function windowBounds(window: GcalWindow): { timeMin: string; timeMax: string } {
  const now = Date.now();
  // Clamped, because these arrive from a settings row that syncs between
  // devices and an out-of-range value would make Google reject every call.
  const past = Math.min(Math.max(window.past_days, 0), 365);
  const future = Math.min(Math.max(window.future_days, 1), 365);
  return {
    timeMin: new Date(now - past * DAY_MS).toISOString(),
    timeMax: new Date(now + future * DAY_MS).toISOString(),
  };
}

/**
 * §6.3: incremental sync with a stored `syncToken`; on 410 (token invalidated)
 * fall back to a full resync of the configured window.
 */
export async function pullFoqusCalendar(
  userId: string,
  calendarId: string,
  syncToken: string | null,
  window: GcalWindow = DEFAULT_WINDOW,
): Promise<{ events: GcalPullEvent[]; sync_token: string | null; resynced: boolean }> {
  const encoded = encodeURIComponent(calendarId);

  const fetchPage = async (params: URLSearchParams) =>
    googleFetch(userId, `/calendars/${encoded}/events?${params.toString()}`);

  const collect = async (
    initial: URLSearchParams,
  ): Promise<{ events: GcalPullEvent[]; nextSyncToken: string | null }> => {
    const events: GcalPullEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const params = new URLSearchParams(initial);
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetchPage(params);
      if (!res.ok) throw new GcalError(await res.text(), res.status);

      const json = (await res.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      for (const item of json.items ?? []) events.push(toPullEvent(item));
      pageToken = json.nextPageToken;
      nextSyncToken = json.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    return { events, nextSyncToken };
  };

  const windowParams = () => {
    const { timeMin, timeMax } = windowBounds(window);
    return new URLSearchParams({
      showDeleted: "true",
      singleEvents: "true",
      maxResults: "250",
      timeMin,
      timeMax,
    });
  };

  if (syncToken) {
    try {
      // A syncToken request may not carry timeMin/timeMax.
      const params = new URLSearchParams({
        syncToken,
        showDeleted: "true",
        singleEvents: "true",
        maxResults: "250",
      });
      const { events, nextSyncToken } = await collect(params);
      return { events, sync_token: nextSyncToken, resynced: false };
    } catch (err) {
      if (!(err instanceof GcalError) || err.status !== 410) throw err;
      // Token invalidated — fall through to a full window resync.
    }
  }

  const { events, nextSyncToken } = await collect(windowParams());
  return { events, sync_token: nextSyncToken, resynced: true };
}

/* ------------------------------------------------------------------ */
/* freebusy from other calendars (§6.3)                                */
/* ------------------------------------------------------------------ */

/**
 * Busy intervals from the user's *other* calendars — the FOQUS one is excluded
 * because its agendas are already local, and counting them twice would make the
 * scheduler think the day is full.
 *
 * `selected` narrows that further to the calendars chosen in Pengaturan. Null
 * means every other calendar, which is §6.3's default; an empty array means the
 * user deselected them all, and is answered with no busy intervals rather than
 * with all of them.
 */
export async function fetchBusy(
  userId: string,
  foqusCalendarId: string | null,
  selected: string[] | null = null,
  window: GcalWindow = DEFAULT_WINDOW,
): Promise<GcalBusyInterval[]> {
  const entries = await calendarList(userId);

  const allowed = selected === null ? null : new Set(selected);
  const wanted = entries
    .filter((c) => c.id !== foqusCalendarId)
    .filter((c) => allowed === null || allowed.has(c.id));
  if (wanted.length === 0) return [];

  const bounds = windowBounds(window);
  const out: GcalBusyInterval[] = [];
  /*
   * Calendars whose events could not be read — most often a calendar shared at
   * `freeBusyReader`, where the times are visible and the titles genuinely are
   * not. They fall through to `freebusy`, which is what §6.3 originally
   * specified for everything.
   */
  const opaque: CalendarListEntry[] = [];

  for (const calendar of wanted) {
    try {
      out.push(...(await listBusyEvents(userId, calendar, bounds)));
    } catch {
      opaque.push(calendar);
    }
  }

  if (opaque.length > 0) {
    out.push(...(await freeBusyFor(userId, opaque, bounds)));
  }

  return out;
}

interface WindowBounds {
  timeMin: string;
  timeMax: string;
}

interface BusyEvent {
  status?: string;
  summary?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/**
 * One calendar's occupied time, with the titles.
 *
 * §6.3 specifies `freebusy` here, which answers with intervals and nothing
 * else — so every band in the timeline was labelled with the *calendar's* name,
 * and for the primary calendar that name is the user's email address. A row of
 * bands all reading "dimas@…" says only "something is here", which the shading
 * already said.
 *
 * `events.list` costs one call per calendar instead of one for all of them, and
 * returns what the band is for: what the hour is actually spoken for.
 *
 * Two kinds of event are dropped, because `freebusy` drops them too and the
 * scheduler would otherwise start avoiding hours that are genuinely free:
 * anything marked Free (`transparency: "transparent"`), and any invitation this
 * user has declined.
 */
async function listBusyEvents(
  userId: string,
  calendar: CalendarListEntry,
  bounds: WindowBounds,
): Promise<GcalBusyInterval[]> {
  const encoded = encodeURIComponent(calendar.id);
  const out: GcalBusyInterval[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await googleJson<{ items?: BusyEvent[]; nextPageToken?: string }>(
      userId,
      `/calendars/${encoded}/events?${params.toString()}`,
    );

    for (const item of page.items ?? []) {
      if (item.status === "cancelled") continue;
      if (item.transparency === "transparent") continue;
      if (item.attendees?.some((a) => a.self && a.responseStatus === "declined")) {
        continue;
      }
      // All-day entries carry `date` rather than `dateTime`. They mark a day,
      // not an hour, and blocking the whole day would be a worse answer than
      // blocking none of it.
      const start = item.start?.dateTime;
      const end = item.end?.dateTime;
      if (!start || !end) continue;

      out.push({
        calendar_id: calendar.id,
        start_at: start,
        end_at: end,
        // A busy event with no title of its own falls back to the calendar's
        // name, which is the old behaviour and still better than nothing.
        summary: item.summary ?? calendar.summary ?? null,
      });
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  return out;
}

/** §6.3's original path, kept for the calendars whose events are not readable. */
async function freeBusyFor(
  userId: string,
  calendars: readonly CalendarListEntry[],
  bounds: WindowBounds,
): Promise<GcalBusyInterval[]> {
  const result = await googleJson<{
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  }>(userId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: bounds.timeMin,
      timeMax: bounds.timeMax,
      items: calendars.map((c) => ({ id: c.id })),
    }),
  });

  const names = new Map(calendars.map((c) => [c.id, c.summary] as const));

  const out: GcalBusyInterval[] = [];
  for (const [calendarId, entry] of Object.entries(result.calendars ?? {})) {
    for (const slot of entry.busy ?? []) {
      out.push({
        calendar_id: calendarId,
        start_at: slot.start,
        end_at: slot.end,
        summary: names.get(calendarId) ?? null,
      });
    }
  }
  return out;
}

export async function isConnected(userId: string): Promise<boolean> {
  return (await readCredentials(userId)) !== null;
}

/**
 * The scopes this app needs that Google has not granted to the stored token.
 *
 * Google returns the granted set on every token response and it is stored
 * verbatim, so this is answered without a network call. An empty array means
 * the connection is complete; anything else means the user consented under an
 * older scope list and has to reconnect — there is no way to widen a token in
 * place.
 */
/**
 * The scopes this app needs that Google has not granted to the stored token.
 * An empty array means the connection is complete; anything else means the user
 * consented under an older scope list and has to reconnect.
 */
export async function missingScopes(userId: string): Promise<string[]> {
  const creds = await readCredentials(userId);
  if (!creds) return [...GOOGLE_SCOPES];
  return missingScopesFrom(creds.scope);
}
