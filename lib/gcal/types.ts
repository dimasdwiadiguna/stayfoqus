import type { IsoDateTime, UUID } from "@/lib/db/schema";

/**
 * Operations queued in the shared outbox under entity `"gcal"` (§3.3).
 * They carry everything the route handler needs so a queued write survives the
 * local agenda being edited or deleted before the queue drains.
 */
export type GcalOutboxOp =
  | {
      kind: "upsert_event";
      agenda_id: UUID;
    }
  | {
      kind: "delete_event";
      agenda_id: UUID;
      gcal_event_id: string;
    };

export interface GcalEventPayload {
  /**
   * The calendar the user chose in Pengaturan. Sent on every write rather than
   * resolved server-side, so there is exactly one place that decides where an
   * agenda lands. Null falls back to find-or-create "FOQUS" — the path a first
   * connect takes before a choice exists.
   */
  calendar_id: string | null;
  agenda_id: UUID;
  summary: string;
  description: string;
  start_at: IsoDateTime;
  end_at: IsoDateTime;
  /** Existing Google event id when updating; null creates a new event. */
  event_id: string | null;
}

export interface GcalEventResult {
  event_id: string;
  updated: IsoDateTime;
}

/** The user's calendars, as Pengaturan needs to list them. */
export interface GcalCalendar {
  id: string;
  summary: string;
  primary: boolean;
  /** True when FOQUS may create and edit events on it. */
  writable: boolean;
}

/**
 * Everything the pull needs, assembled from the settings row on the client.
 * The server holds no preferences of its own — it holds the refresh token.
 */
export interface GcalPullRequest {
  calendar_id: string | null;
  sync_token: string | null;
  busy_enabled: boolean;
  /** Null means every calendar except the chosen one. */
  busy_calendar_ids: string[] | null;
  window_past_days: number;
  window_future_days: number;
}

export interface GcalBusyInterval {
  start_at: IsoDateTime;
  end_at: IsoDateTime;
  calendar_id: string;
  summary: string | null;
}

export interface GcalPullEvent {
  event_id: string;
  agenda_id: UUID | null;
  start_at: IsoDateTime | null;
  end_at: IsoDateTime | null;
  summary: string | null;
  updated: IsoDateTime;
  cancelled: boolean;
}

export interface GcalPullResult {
  events: GcalPullEvent[];
  sync_token: string | null;
  /** True when Google invalidated the token and a full window resync ran. */
  resynced: boolean;
}
