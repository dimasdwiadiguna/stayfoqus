"use client";

import { useLiveQuery } from "dexie-react-hooks";

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

export function updateSettings(patch: Partial<Settings>) {
  return updateRow("settings", SETTINGS_ROW_ID, patch);
}
