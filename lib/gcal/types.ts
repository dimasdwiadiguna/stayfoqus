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
