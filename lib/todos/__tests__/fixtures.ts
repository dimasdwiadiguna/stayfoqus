import {
  LOCAL_USER_ID,
  type Agenda,
  type PomodoroLog,
  type Priority,
  type Todo,
  type UUID,
} from "@/lib/db/schema";

let counter = 0;

export function resetFixtureIds() {
  counter = 0;
}

function nextId(prefix: string): UUID {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(4, "0")}`;
}

export function makeTodo(overrides: Partial<Todo> = {}): Todo {
  const ts = "2026-08-01T00:00:00.000Z";
  return {
    id: overrides.id ?? nextId("todo"),
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    title: "Todo",
    notes: null,
    category_id: null,
    priority: 4 as Priority,
    tags: [],
    due_date: null,
    estimated_pomodoro: 1,
    parent_id: null,
    blocked_by: [],
    status: "active",
    completed_at: null,
    focus_week: null,
    sort_order: 0,
    ...overrides,
  };
}

export function makeAgenda(overrides: Partial<Agenda> = {}): Agenda {
  const ts = "2026-08-01T00:00:00.000Z";
  return {
    id: overrides.id ?? nextId("agenda"),
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    todo_id: overrides.todo_id ?? "todo-0001",
    title_override: null,
    start_at: "2026-08-03T02:00:00.000Z",
    end_at: "2026-08-03T02:25:00.000Z",
    allocated_pomodoro: 1,
    buffer_before_min: 0,
    buffer_before_type: "switch",
    buffer_after_min: 10,
    buffer_after_type: "switch",
    status: "planned",
    outside_window: false,
    gcal_event_id: null,
    gcal_synced_at: null,
    gcal_conflict: false,
    follows_agenda_id: null,
    ...overrides,
  };
}

export function makeLog(overrides: Partial<PomodoroLog> = {}): PomodoroLog {
  const ts = "2026-08-03T02:00:00.000Z";
  return {
    id: overrides.id ?? nextId("log"),
    user_id: LOCAL_USER_ID,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    dirty: 0,
    agenda_id: null,
    todo_id: null,
    started_at: ts,
    ended_at: "2026-08-03T02:25:00.000Z",
    duration_sec: 1500,
    type: "focus",
    outcome: "completed",
    is_overtime: false,
    ...overrides,
  };
}
