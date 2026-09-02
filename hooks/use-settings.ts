"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { applyCommuteMoves } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import { updateRow } from "@/lib/db/mutations";
import { SETTINGS_ROW_ID, type Settings } from "@/lib/db/schema";
import { settingsFallback } from "@/lib/db/seed";

/**
 * Settings are read on nearly every screen, so this hook never returns
 * undefined — it falls back to the defaults until the live query resolves.
 */
export function useSettings(): Settings {
  const row = useLiveQuery(() => getDb().settings.get(SETTINGS_ROW_ID), []);
  return row ?? settingsFallback();
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = await updateRow("settings", SETTINGS_ROW_ID, patch);

  // Moving home, changing how fast you travel, or changing the fallback buffer
  // re-prices every automatic commute on the calendar.
  if (
    patch.home_place_id !== undefined ||
    patch.commute_speed_kmh !== undefined ||
    patch.default_buffer_before_min !== undefined ||
    patch.default_buffer_type !== undefined
  ) {
    await applyCommuteMoves();
  }

  return next;
}
