import { getDb } from "@/lib/db/client";
import { createRow, getCurrentUserId, nowIso } from "@/lib/db/mutations";
import {
  SETTINGS_ROW_ID,
  type AvailabilityWindow,
  type Category,
  type DayOfWeek,
  type Settings,
} from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

/**
 * Seed rows use fixed UUIDs rather than fresh ones.
 *
 * A second device that installs the app offline seeds before it can pull, so
 * random ids would produce duplicate categories once both devices sync. With
 * stable ids the two seeds converge on the same rows, and last-write-wins then
 * settles any divergence (including a category the user already deleted).
 */
const SEED_NS = "00000000-0000-4000-8000-0000000001";

const seedId = (n: number) => `${SEED_NS}${n.toString().padStart(2, "0")}`;

export const SEED_CATEGORY_IDS = {
  kerja: seedId(1),
  riset: seedId(2),
  personal: seedId(3),
  ibadah: seedId(4),
} as const;

const SEED_CATEGORIES: ReadonlyArray<
  Pick<Category, "id" | "name" | "color" | "icon" | "sort_order">
> = [
  { id: SEED_CATEGORY_IDS.kerja, name: t.seed.categories.kerja, color: "#7c9cff", icon: "briefcase", sort_order: 0 },
  { id: SEED_CATEGORY_IDS.riset, name: t.seed.categories.riset, color: "#43c98a", icon: "flask-conical", sort_order: 1 },
  { id: SEED_CATEGORY_IDS.personal, name: t.seed.categories.personal, color: "#f0b429", icon: "heart", sort_order: 2 },
  { id: SEED_CATEGORY_IDS.ibadah, name: t.seed.categories.ibadah, color: "#57c9b6", icon: "moon-star", sort_order: 3 },
];

/** §4.5: Mon–Fri 04:00–22:00, Sat–Sun 06:00–20:00. */
const SEED_WINDOWS: ReadonlyArray<
  Pick<AvailabilityWindow, "id" | "day_of_week" | "start_time" | "end_time" | "enabled">
> = ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((day) => {
  const weekend = day === 0 || day === 6;
  return {
    id: seedId(10 + day),
    day_of_week: day,
    start_time: weekend ? "06:00" : "04:00",
    end_time: weekend ? "20:00" : "22:00",
    enabled: true,
  };
});

export function defaultSettings(): Omit<
  Settings,
  "id" | "user_id" | "created_at" | "updated_at" | "deleted_at" | "dirty"
> {
  return {
    timezone: "Asia/Jakarta",
    latitude: -6.9175,
    longitude: 107.6191,
    prayer_calculation_method: "Kemenag",
    prayer_blocks: {
      fajr: { enabled: true, duration_min: 20 },
      dhuhr: { enabled: true, duration_min: 20 },
      asr: { enabled: true, duration_min: 20 },
      maghrib: { enabled: true, duration_min: 20 },
      isha: { enabled: true, duration_min: 20 },
    },
    friday_dhuhr_duration_min: 90,
    default_buffer_before_min: 0,
    default_buffer_after_min: 10,
    default_buffer_type: "switch",
    pomodoro_focus_min: 25,
    pomodoro_short_break_min: 5,
    pomodoro_long_break_min: 15,
    pomodoro_long_break_every: 4,
    ticking_enabled: true,
    ticking_volume: 0.35,
    bell_enabled: true,
    bell_volume: 0.6,
    theme: "dark",
    gcal_calendar_id: null,
    gcal_sync_token: null,
  };
}

/**
 * Idempotent. Runs on every boot and only fills gaps, so a partially seeded
 * database (interrupted first launch, or a pull that arrived first) converges.
 */
export async function seedIfNeeded(): Promise<void> {
  const db = getDb();

  const settings = await db.settings.get(SETTINGS_ROW_ID);
  if (!settings) {
    await createRow("settings", {
      id: SETTINGS_ROW_ID,
      ...defaultSettings(),
    });
  }

  const categoryCount = await db.categories.count();
  if (categoryCount === 0) {
    for (const c of SEED_CATEGORIES) {
      await createRow("categories", c);
    }
  }

  const windowCount = await db.availability_windows.count();
  if (windowCount === 0) {
    for (const w of SEED_WINDOWS) {
      await createRow("availability_windows", w);
    }
  }
}

/**
 * Returns the settings row, creating it if the database predates it. The UI
 * always has settings — no screen should have to handle `undefined`.
 */
export async function ensureSettings(): Promise<Settings> {
  const db = getDb();
  const existing = await db.settings.get(SETTINGS_ROW_ID);
  if (existing) return existing;
  return createRow("settings", { id: SETTINGS_ROW_ID, ...defaultSettings() });
}

/** In-memory fallback used before the first live query resolves. */
export function settingsFallback(): Settings {
  const ts = nowIso();
  return {
    id: SETTINGS_ROW_ID,
    user_id: getCurrentUserId(),
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    ...defaultSettings(),
  };
}
