import Dexie, { type EntityTable } from "dexie";

import type {
  Agenda,
  AvailabilityWindow,
  Category,
  ConflictLogEntry,
  GcalBusy,
  OutboxEntry,
  PomodoroLog,
  Settings,
  SyncState,
  TimeBlock,
  TimeBlockException,
  Todo,
} from "@/lib/db/schema";

/**
 * IndexedDB is the read source of truth for the UI (§3.1).
 *
 * Index notes:
 *  - `dirty` is stored as 0/1 because IndexedDB refuses to index booleans.
 *  - `deleted_at` is not indexed: it is null for most rows and IndexedDB skips
 *    null keys entirely, so an index would silently exclude live rows.
 *    Soft-delete filtering happens in the repository layer instead.
 *  - `outbox.seq` is auto-incremented so draining is strictly insertion-ordered.
 */
export class FoqusDatabase extends Dexie {
  categories!: EntityTable<Category, "id">;
  todos!: EntityTable<Todo, "id">;
  agendas!: EntityTable<Agenda, "id">;
  pomodoro_logs!: EntityTable<PomodoroLog, "id">;
  availability_windows!: EntityTable<AvailabilityWindow, "id">;
  time_blocks!: EntityTable<TimeBlock, "id">;
  time_block_exceptions!: EntityTable<TimeBlockException, "id">;
  settings!: EntityTable<Settings, "id">;
  outbox!: EntityTable<OutboxEntry, "seq">;
  gcal_busy_cache!: EntityTable<GcalBusy, "id">;
  conflict_log!: EntityTable<ConflictLogEntry, "id">;
  sync_state!: EntityTable<SyncState, "table_name">;

  constructor() {
    super("foqus");

    this.version(1).stores({
      categories: "id, sort_order, updated_at, dirty",
      todos:
        "id, parent_id, category_id, status, due_date, focus_week, priority, sort_order, updated_at, dirty, *tags, *blocked_by",
      agendas:
        "id, todo_id, start_at, end_at, status, gcal_event_id, updated_at, dirty, [status+end_at], [todo_id+status]",
      pomodoro_logs:
        "id, agenda_id, todo_id, started_at, type, outcome, updated_at, dirty, [type+outcome]",
      availability_windows: "id, day_of_week, updated_at, dirty",
      time_blocks: "id, recurrence, specific_date, updated_at, dirty",
      time_block_exceptions:
        "id, time_block_id, date, updated_at, dirty, [time_block_id+date]",
      settings: "id, updated_at, dirty",
      outbox: "++seq, id, status, entity, entity_id, next_attempt_at",
      gcal_busy_cache: "id, start_at, end_at, calendar_id",
      conflict_log: "id, created_at, acknowledged",
      sync_state: "table_name",
    });

    // v2 adds `agendas.follows_agenda_id` — the "immediately after" link.
    // Indexed because resolving a chain asks "who follows this agenda?" on
    // every move. Existing rows are backfilled to null.
    this.version(2)
      .stores({
        agendas:
          "id, todo_id, start_at, end_at, status, gcal_event_id, updated_at, dirty, follows_agenda_id, [status+end_at], [todo_id+status]",
      })
      .upgrade((tx) =>
        tx
          .table("agendas")
          .toCollection()
          .modify((agenda: { follows_agenda_id?: string | null }) => {
            agenda.follows_agenda_id = null;
          }),
      );
  }
}

let instance: FoqusDatabase | null = null;

/**
 * Lazily constructs the database. Dexie only touches `indexedDB` on open, but
 * keeping construction lazy means importing a repository module from a server
 * component or a unit test never allocates a connection.
 */
export function getDb(): FoqusDatabase {
  if (!instance) instance = new FoqusDatabase();
  return instance;
}

/** Test-only: drops the singleton so a fresh fake-indexeddb can be installed. */
export function __resetDbForTests() {
  instance?.close();
  instance = null;
}
