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
/* places                                                              */
/* ------------------------------------------------------------------ */

/**
 * A pinned coordinate the user can attach to work: home, the office, a gym.
 *
 * Places exist so a commute buffer can be *computed* from the distance between
 * two of them rather than typed in every time. They are deliberately a table
 * rather than inline coordinates on each row: the same place is reused across
 * many todos and events, and moving the pin has to move every estimate with it.
 */
export interface Place extends BaseRow, LocalMeta {
  name: string;
  latitude: number;
  longitude: number;
  sort_order: number;
}

/** The subset of a place the travel maths actually needs. */
export interface Coordinate {
  latitude: number;
  longitude: number;
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
  /**
   * Where this work happens. A *default*: it is copied onto each agenda as the
   * todo is scheduled, and the agenda's own copy is what the commute maths
   * reads. Null means "wherever you already are" — no commute is charged.
   */
  place_id: UUID | null;
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
  /** Where this session happens. Copied from the todo at creation. */
  place_id: UUID | null;
  /**
   * While 1, `buffer_before_min` / `buffer_before_type` are owned by the
   * commute reconciler and rewritten whenever the day's order changes. Typing a
   * buffer by hand sets it to 0 and the reconciler never touches this row
   * again, until the user asks for the estimate back.
   */
  commute_auto: Flag;
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
/* events                                                              */
/* ------------------------------------------------------------------ */

export type EventRecurrence = "once" | "weekly";

/**
 * A commitment that is not a todo: a meeting, a class, an appointment.
 *
 * Not in the brief, which assumes everything on the calendar descends from a
 * todo (an agenda) or from another calendar (`gcal_busy_cache`). Added on
 * request as the deliberate manual stand-in for the Google Calendar sync, so
 * hours that are genuinely spoken for stop being handed out by the allocator.
 *
 * Shaped after `time_blocks` — wall-clock times plus a recurrence — rather than
 * absolute instants, so "every Tuesday at 09:00" stays 09:00 in the user's own
 * timezone, and so the expansion and the per-date exceptions can reuse a
 * pattern that is already tested.
 */
export interface CalendarEvent extends BaseRow, LocalMeta {
  title: string;
  /** Free text, e.g. "Ruang rapat lantai 3". A label, not a coordinate. */
  location: string | null;
  /**
   * The coordinate, when there is one. Separate from `location` because they
   * answer different questions: `location` tells the user where to go, this
   * tells the scheduler how long getting there takes.
   *
   * An event is a *rule* (wall-clock + recurrence), and two occurrences can be
   * reached from different places, so its commute buffer is never stored on
   * this row — it is derived per occurrence onto `EventInstance.bufferBefore`.
   */
  place_id: UUID | null;
  /** As `Agenda.commute_auto`, but governing every occurrence of this rule. */
  commute_auto: Flag;
  notes: string | null;
  start_time: HHmm;
  /** At or before `start_time` means the event ends on the following day. */
  end_time: HHmm;
  recurrence: EventRecurrence;
  days_of_week: DayOfWeek[];
  specific_date: IsoDate | null;
  end_date: IsoDate | null;
  buffer_before_min: number;
  buffer_before_type: BufferType;
  buffer_after_min: number;
  buffer_after_type: BufferType;
  enabled: boolean;
}

/** §4.7's shape, for events: skip a single occurrence of a repeat. */
export interface EventException extends BaseRow, LocalMeta {
  event_id: UUID;
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
  /**
   * Where every day starts. Null until the user drops the pin — and then the
   * first block of each day simply gets no commute, rather than one measured
   * from a guess.
   */
  home_place_id: UUID | null;
  /** Average door-to-door speed, km/h. Drives every distance estimate. */
  commute_speed_kmh: number;
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
  | "place"
  | "pomodoro_log"
  | "settings"
  | "time_block"
  | "time_block_exception"
  | "event"
  | "event_exception"
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
  "places",
  "todos",
  "agendas",
  "pomodoro_logs",
  "availability_windows",
  "time_blocks",
  "time_block_exceptions",
  "events",
  "event_exceptions",
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
  places: "place",
  todos: "todo",
  agendas: "agenda",
  pomodoro_logs: "pomodoro_log",
  availability_windows: "availability_window",
  time_blocks: "time_block",
  time_block_exceptions: "time_block_exception",
  events: "event",
  event_exceptions: "event_exception",
  settings: "settings",
};

/** Row shapes keyed by table, for generic sync code. */
export interface SyncedRowMap {
  categories: Category;
  places: Place;
  todos: Todo;
  agendas: Agenda;
  pomodoro_logs: PomodoroLog;
  availability_windows: AvailabilityWindow;
  time_blocks: TimeBlock;
  time_block_exceptions: TimeBlockException;
  events: CalendarEvent;
  event_exceptions: EventException;
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
