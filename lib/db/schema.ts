/**
 * Single source of truth for the FOQUS data model.
 *
 * These types are consumed by:
 *  - the Dexie schema (`lib/db/client.ts`)
 *  - the Supabase migrations (`supabase/migrations/*` — kept in sync by hand)
 *  - the pure scheduling module (`lib/scheduling/*`), which imports only the
 *    plain row types and never Dexie itself.
 *
 * Naming is snake_case throughout so a row round-trips to Postgres untouched.
 */

export type UUID = string;
/** ISO-8601 instant in UTC, e.g. "2026-08-26T04:30:00.000Z". */
export type IsoDateTime = string;
/** Calendar date in the user's timezone, e.g. "2026-08-26". */
export type IsoDate = string;
/** Wall-clock time of day in the user's timezone, e.g. "04:30". */
export type HHmm = string;
/** ISO week identifier, e.g. "2026-W35". */
export type IsoWeek = string;

/** 0 = Sunday … 6 = Saturday. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** 1 = highest (red) … 4 = none (gray). */
export type Priority = 1 | 2 | 3 | 4;

/**
 * IndexedDB cannot index booleans, and `dirty` is the hot index the sync engine
 * scans. It is therefore stored as 0/1 rather than a boolean.
 */
export type Flag = 0 | 1;

export interface BaseRow {
  id: UUID;
  user_id: UUID;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  deleted_at: IsoDateTime | null;
}

/** Fields that exist only in IndexedDB and are stripped before pushing. */
export interface LocalMeta {
  dirty: Flag;
}

/* ------------------------------------------------------------------ */
/* categories                                                          */
/* ------------------------------------------------------------------ */

export interface Category extends BaseRow, LocalMeta {
  name: string;
  /** Hex colour, e.g. "#7c9cff". */
  color: string;
  /** lucide-react icon name, e.g. "briefcase". */
  icon: string;
  sort_order: number;
}

/* ------------------------------------------------------------------ */
/* todos                                                               */
/* ------------------------------------------------------------------ */

export type TodoStatus = "inbox" | "active" | "done" | "archived";

export interface Todo extends BaseRow, LocalMeta {
  title: string;
  notes: string | null;
  category_id: UUID | null;
  priority: Priority;
  /** Flat, free-form. */
  tags: string[];
  due_date: IsoDate | null;
  estimated_pomodoro: number;
  /** Hierarchy parent. Depth is capped at 3 (root → child → grandchild). */
  parent_id: UUID | null;
  /** Cross-todo dependencies. Distinct from hierarchy. */
  blocked_by: UUID[];
  status: TodoStatus;
  completed_at: IsoDateTime | null;
  focus_week: IsoWeek | null;
  sort_order: number;
}

/* ------------------------------------------------------------------ */
/* agendas                                                             */
/* ------------------------------------------------------------------ */

export type BufferType = "switch" | "commute";

export type AgendaStatus =
  | "planned"
  | "draft"
  | "done"
  | "partial"
  | "missed"
  | "cancelled";

export interface Agenda extends BaseRow, LocalMeta {
  todo_id: UUID;
  title_override: string | null;
  start_at: IsoDateTime;
  end_at: IsoDateTime;
  allocated_pomodoro: number;
  buffer_before_min: number;
  buffer_before_type: BufferType;
  buffer_after_min: number;
  buffer_after_type: BufferType;
  status: AgendaStatus;
  /** True when the user knowingly placed it outside an availability window. */
  outside_window: boolean;
  gcal_event_id: string | null;
  gcal_synced_at: IsoDateTime | null;
  gcal_conflict: boolean;
  /**
   * "Immediately after": this agenda is pinned to the *end of another agenda's
   * buffer* rather than to a clock time. Move the predecessor and this one
   * follows; its own `start_at` is derived, not authored.
   *
   * Null for the overwhelming majority of agendas, which own their start time.
   */
  follows_agenda_id: UUID | null;
}

/* ------------------------------------------------------------------ */
/* pomodoro_logs                                                       */
/* ------------------------------------------------------------------ */

export type PomodoroType = "focus" | "short_break" | "long_break";
export type PomodoroOutcome = "completed" | "aborted";

export interface PomodoroLog extends BaseRow, LocalMeta {
  /** null = untethered focus session. */
  agenda_id: UUID | null;
  todo_id: UUID | null;
  started_at: IsoDateTime;
  ended_at: IsoDateTime | null;
  duration_sec: number;
  type: PomodoroType;
  outcome: PomodoroOutcome;
  /** Ran beyond the agenda's allocation. */
  is_overtime: boolean;
}

/* ------------------------------------------------------------------ */
/* availability_windows                                                */
/* ------------------------------------------------------------------ */

export interface AvailabilityWindow extends BaseRow, LocalMeta {
  day_of_week: DayOfWeek;
  start_time: HHmm;
  end_time: HHmm;
  enabled: boolean;
}

/* ------------------------------------------------------------------ */
/* time_blocks                                                         */
/* ------------------------------------------------------------------ */

export type TimeBlockRecurrence = "once" | "weekly";

export interface TimeBlock extends BaseRow, LocalMeta {
  name: string;
  start_time: HHmm;
  end_time: HHmm;
  recurrence: TimeBlockRecurrence;
  days_of_week: DayOfWeek[];
  specific_date: IsoDate | null;
  end_date: IsoDate | null;
  filter_category_ids: UUID[];
  filter_tags: string[];
  filter_priorities: Priority[];
  color: string;
  enabled: boolean;
}

export interface TimeBlockException extends BaseRow, LocalMeta {
  time_block_id: UUID;
  date: IsoDate;
  action: "skipped";
}

/* ------------------------------------------------------------------ */
/* settings (single row)                                               */
/* ------------------------------------------------------------------ */

export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";

export interface PrayerBlockSetting {
  enabled: boolean;
  duration_min: number;
}

export type PrayerBlockSettings = Record<PrayerKey, PrayerBlockSetting>;

export type ThemePreference = "dark" | "light" | "system";

/**
 * Calculation methods exposed in Settings. "Kemenag" is the Indonesian Ministry
 * of Religious Affairs parameter set; `adhan` has no built-in preset for it, so
 * it is expressed as explicit angles in `lib/scheduling/prayer.ts`.
 */
export type PrayerCalculationMethod =
  | "Kemenag"
  | "MuslimWorldLeague"
  | "Egyptian"
  | "Karachi"
  | "UmmAlQura"
  | "Singapore";

export interface Settings extends BaseRow, LocalMeta {
  timezone: string;
  latitude: number;
  longitude: number;
  prayer_calculation_method: PrayerCalculationMethod;
  prayer_blocks: PrayerBlockSettings;
  friday_dhuhr_duration_min: number;
  default_buffer_before_min: number;
  default_buffer_after_min: number;
  default_buffer_type: BufferType;
  pomodoro_focus_min: number;
  pomodoro_short_break_min: number;
  pomodoro_long_break_min: number;
  pomodoro_long_break_every: number;
  ticking_enabled: boolean;
  ticking_volume: number;
  bell_enabled: boolean;
  bell_volume: number;
  theme: ThemePreference;
  gcal_calendar_id: string | null;
  /** Opaque incremental-sync token for the FOQUS calendar (§6.3). */
  gcal_sync_token: string | null;
}

/* ------------------------------------------------------------------ */
/* outbox                                                              */
/* ------------------------------------------------------------------ */

export type OutboxEntity =
  | "todo"
  | "agenda"
  | "category"
  | "pomodoro_log"
  | "settings"
  | "time_block"
  | "time_block_exception"
  | "availability_window"
  | "gcal";

export type OutboxOperation = "create" | "update" | "delete";
export type OutboxStatus = "pending" | "blocked";

export interface OutboxEntry {
  /** Monotonic, Dexie-assigned. Guarantees insertion-order draining. */
  seq?: number;
  id: UUID;
  entity: OutboxEntity;
  entity_id: UUID;
  operation: OutboxOperation;
  payload: unknown;
  attempts: number;
  last_error: string | null;
  status: OutboxStatus;
  created_at: IsoDateTime;
  /** Earliest time the engine may retry, used for exponential backoff. */
  next_attempt_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* gcal_busy_cache                                                     */
/* ------------------------------------------------------------------ */

export interface GcalBusy {
  id: UUID;
  user_id: UUID;
  start_at: IsoDateTime;
  end_at: IsoDateTime;
  calendar_id: string;
  summary: string | null;
  fetched_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* conflict_log                                                        */
/* ------------------------------------------------------------------ */

export interface ConflictLogEntry {
  id: UUID;
  user_id: UUID;
  table_name: SyncedTableName;
  row_id: UUID;
  local_updated_at: IsoDateTime;
  remote_updated_at: IsoDateTime;
  resolved: "remote_wins";
  acknowledged: boolean;
  created_at: IsoDateTime;
}

/* ------------------------------------------------------------------ */
/* sync bookkeeping                                                    */
/* ------------------------------------------------------------------ */

/** Tables that participate in the two-way pull/push sync. */
export const SYNCED_TABLES = [
  "categories",
  "todos",
  "agendas",
  "pomodoro_logs",
  "availability_windows",
  "time_blocks",
  "time_block_exceptions",
  "settings",
] as const;

export type SyncedTableName = (typeof SYNCED_TABLES)[number];

export interface SyncState {
  /** Table name, or "__engine__" for engine-wide bookkeeping. */
  table_name: SyncedTableName | "__engine__";
  last_pulled_at: IsoDateTime | null;
}

/** Maps a synced table to the outbox entity tag used for its operations. */
export const TABLE_TO_ENTITY: Record<SyncedTableName, OutboxEntity> = {
  categories: "category",
  todos: "todo",
  agendas: "agenda",
  pomodoro_logs: "pomodoro_log",
  availability_windows: "availability_window",
  time_blocks: "time_block",
  time_block_exceptions: "time_block_exception",
  settings: "settings",
};

/** Row shapes keyed by table, for generic sync code. */
export interface SyncedRowMap {
  categories: Category;
  todos: Todo;
  agendas: Agenda;
  pomodoro_logs: PomodoroLog;
  availability_windows: AvailabilityWindow;
  time_blocks: TimeBlock;
  time_block_exceptions: TimeBlockException;
  settings: Settings;
}

export type SyncedRow = SyncedRowMap[SyncedTableName];

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** §4.2: root → child → grandchild. */
export const MAX_TODO_DEPTH = 3;

/** §5.5 Step 3: session size cap and per-day repetition cap. */
export const MAX_POMODORO_PER_SESSION = 4;
export const MAX_SESSIONS_PER_TODO_PER_DAY = 2;

/**
 * Used for the single settings row and for the local-only user id when the app
 * runs without Supabase. Deterministic so seeded rows are stable across reloads.
 */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";
export const SETTINGS_ROW_ID = "00000000-0000-4000-8000-000000000002";
