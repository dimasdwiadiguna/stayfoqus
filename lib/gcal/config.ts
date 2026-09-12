"use client";

import { getDb } from "@/lib/db/client";
import { SETTINGS_ROW_ID, type Settings } from "@/lib/db/schema";
import type { GcalPullRequest } from "@/lib/gcal/types";

/**
 * One place that answers "what did the user ask Google to do?".
 *
 * Every Google call reads its configuration from the settings row rather than
 * from a constant, so the whole integration is steerable from Pengaturan. The
 * route handlers hold the credentials; this holds the preferences.
 */

export interface GcalConfig {
  /** False when the master switch is off, or nothing has been connected yet. */
  enabled: boolean;
  calendar_id: string | null;
  calendar_name: string | null;
  write_enabled: boolean;
  busy_enabled: boolean;
  busy_calendar_ids: string[] | null;
  window_past_days: number;
  window_future_days: number;
  sync_token: string | null;
}

/**
 * A settings row older than Dexie v5 can still be in memory when this runs —
 * a pull from another device delivers whatever Postgres holds, and a column
 * added in 0005 arrives as `undefined` until that device writes the row back.
 * Every read here is defaulted for that reason.
 */
export function gcalConfigFrom(settings: Settings | undefined): GcalConfig {
  return {
    enabled: settings?.gcal_enabled ?? true,
    calendar_id: settings?.gcal_calendar_id ?? null,
    calendar_name: settings?.gcal_calendar_name ?? null,
    write_enabled: settings?.gcal_write_enabled ?? true,
    busy_enabled: settings?.gcal_busy_enabled ?? true,
    busy_calendar_ids: settings?.gcal_busy_calendar_ids ?? null,
    window_past_days: settings?.gcal_window_past_days ?? 7,
    window_future_days: settings?.gcal_window_future_days ?? 30,
    sync_token: settings?.gcal_sync_token ?? null,
  };
}

export async function readGcalConfig(): Promise<GcalConfig> {
  return gcalConfigFrom(await getDb().settings.get(SETTINGS_ROW_ID));
}

/** The body every `/api/gcal/pull` call sends. */
export function pullRequestFrom(config: GcalConfig): GcalPullRequest {
  return {
    calendar_id: config.calendar_id,
    sync_token: config.sync_token,
    busy_enabled: config.busy_enabled,
    busy_calendar_ids: config.busy_calendar_ids,
    window_past_days: config.window_past_days,
    window_future_days: config.window_future_days,
  };
}
