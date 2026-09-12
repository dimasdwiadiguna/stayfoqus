import { describe, expect, it } from "vitest";

import type { Settings } from "@/lib/db/schema";
import { gcalConfigFrom, pullRequestFrom } from "@/lib/gcal/config";
import { settingsFallback } from "@/lib/db/seed";

describe("reading the Google configuration from settings", () => {
  it("carries the user's choices through to the pull request", () => {
    const settings: Settings = {
      ...settingsFallback(),
      gcal_enabled: true,
      gcal_calendar_id: "work@group.calendar.google.com",
      gcal_calendar_name: "Kerja",
      gcal_busy_enabled: true,
      gcal_busy_calendar_ids: ["family@group.calendar.google.com"],
      gcal_window_past_days: 14,
      gcal_window_future_days: 90,
      gcal_sync_token: "tok",
    };

    expect(pullRequestFrom(gcalConfigFrom(settings))).toEqual({
      calendar_id: "work@group.calendar.google.com",
      sync_token: "tok",
      busy_enabled: true,
      busy_calendar_ids: ["family@group.calendar.google.com"],
      window_past_days: 14,
      window_future_days: 90,
    });
  });

  /*
   * A settings row pulled from another device that has not upgraded yet arrives
   * without the 0005 columns. Reading `undefined` as "off" would silently stop
   * the whole integration, so every switch defaults to on and only the calendar
   * id — which has no safe default — gates the calls.
   */
  it("treats a settings row older than migration 0005 as fully enabled", () => {
    const legacy = { ...settingsFallback() } as Partial<Settings>;
    delete legacy.gcal_enabled;
    delete legacy.gcal_write_enabled;
    delete legacy.gcal_busy_enabled;
    delete legacy.gcal_busy_calendar_ids;
    delete legacy.gcal_window_past_days;
    delete legacy.gcal_window_future_days;

    const config = gcalConfigFrom(legacy as Settings);

    expect(config.enabled).toBe(true);
    expect(config.write_enabled).toBe(true);
    expect(config.busy_enabled).toBe(true);
    // Null, not []: "every other calendar" is §6.3's default. An empty array
    // would mean the opposite — that no calendar counts as busy.
    expect(config.busy_calendar_ids).toBeNull();
    expect(config.window_past_days).toBe(7);
    expect(config.window_future_days).toBe(30);
  });

  it("survives no settings row at all", () => {
    const config = gcalConfigFrom(undefined);
    expect(config.enabled).toBe(true);
    expect(config.calendar_id).toBeNull();
  });
});
