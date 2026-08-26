import "server-only";

import { getServerSupabase, getServiceSupabase } from "@/lib/supabase/server";
import type { GcalBusyInterval, GcalPullEvent } from "@/lib/gcal/types";

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

/** §6.1 — `calendar.events` to write, `calendar.readonly` for freebusy. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

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

export async function storeCredentials(
  userId: string,
  input: {
    refresh_token?: string | null;
    access_token: string;
    expires_in: number;
    scope?: string;
  },
): Promise<void> {
  const service = getServiceSupabase();
  if (!service) throw new GcalError("Supabase service role is not configured", 500);

  const expiresAt = new Date(Date.now() + input.expires_in * 1000).toISOString();
  const patch: Record<string, unknown> = {
    user_id: userId,
    access_token: input.access_token,
    expires_at: expiresAt,
    scope: input.scope ?? null,
    updated_at: new Date().toISOString(),
  };
  // Google only returns a refresh token on the first consent; a re-auth without
  // one must not wipe the token we already hold.
  if (input.refresh_token) patch.refresh_token = input.refresh_token;

  const { error } = await service
    .from("google_credentials")
    .upsert(patch, { onConflict: "user_id" });
  if (error) throw new GcalError(error.message, 500);
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
  await storeCredentials(userId, json);
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
}

/**
 * §6.1: "find or create a secondary calendar named FOQUS … Never write to the
 * primary calendar." The primary is filtered out explicitly, so a user who
 * happens to have named their primary calendar "FOQUS" still gets a new one.
 */
export async function findOrCreateFoqusCalendar(userId: string): Promise<string> {
  const list = await googleJson<{ items?: CalendarListEntry[] }>(
    userId,
    "/users/me/calendarList?minAccessRole=writer&maxResults=250",
  );

  const existing = list.items?.find(
    (c) => !c.primary && c.summary === FOQUS_CALENDAR_NAME,
  );
  if (existing) return existing.id;

  const created = await googleJson<{ id: string }>(userId, "/calendars", {
    method: "POST",
    body: JSON.stringify({
      summary: FOQUS_CALENDAR_NAME,
      description: "Agenda FOQUS",
    }),
  });
  return created.id;
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
 * §6.3: incremental sync with a stored `syncToken`; on 410 (token invalidated)
 * fall back to a full resync of the −7/+30 day window.
 */
export async function pullFoqusCalendar(
  userId: string,
  calendarId: string,
  syncToken: string | null,
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
    const now = Date.now();
    const params = new URLSearchParams({
      showDeleted: "true",
      singleEvents: "true",
      maxResults: "250",
      timeMin: new Date(now - 7 * 86_400_000).toISOString(),
      timeMax: new Date(now + 30 * 86_400_000).toISOString(),
    });
    return params;
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
 * Busy intervals from every calendar *except* the FOQUS one — the user's own
 * agendas are already local, and counting them twice would make the scheduler
 * think the day is full.
 */
export async function fetchBusy(
  userId: string,
  foqusCalendarId: string | null,
): Promise<GcalBusyInterval[]> {
  const list = await googleJson<{ items?: CalendarListEntry[] }>(
    userId,
    "/users/me/calendarList?maxResults=250",
  );

  const ids = (list.items ?? [])
    .map((c) => c.id)
    .filter((calendarId) => calendarId !== foqusCalendarId);
  if (ids.length === 0) return [];

  const now = Date.now();
  const body = {
    timeMin: new Date(now - 7 * 86_400_000).toISOString(),
    timeMax: new Date(now + 30 * 86_400_000).toISOString(),
    items: ids.map((calendarId) => ({ id: calendarId })),
  };

  const result = await googleJson<{
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  }>(userId, "/freeBusy", { method: "POST", body: JSON.stringify(body) });

  const summaries = new Map(
    (list.items ?? []).map((c) => [c.id, c.summary] as const),
  );

  const out: GcalBusyInterval[] = [];
  for (const [calendarId, entry] of Object.entries(result.calendars ?? {})) {
    for (const slot of entry.busy ?? []) {
      out.push({
        calendar_id: calendarId,
        start_at: slot.start,
        end_at: slot.end,
        summary: summaries.get(calendarId) ?? null,
      });
    }
  }
  return out;
}

export async function isConnected(userId: string): Promise<boolean> {
  return (await readCredentials(userId)) !== null;
}
