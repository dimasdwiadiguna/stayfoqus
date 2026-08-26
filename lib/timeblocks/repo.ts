"use client";

import { getDb } from "@/lib/db/client";
import {
  createRow,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "@/lib/db/mutations";
import type {
  DayOfWeek,
  IsoDate,
  Priority,
  TimeBlock,
  UUID,
} from "@/lib/db/schema";

/** §4.6 / §4.7 — time block CRUD and per-instance skips. */

export interface NewTimeBlockInput {
  name: string;
  start_time: string;
  end_time: string;
  recurrence?: TimeBlock["recurrence"];
  days_of_week?: DayOfWeek[];
  specific_date?: IsoDate | null;
  end_date?: IsoDate | null;
  filter_category_ids?: UUID[];
  filter_tags?: string[];
  filter_priorities?: Priority[];
  color?: string;
}

const DEFAULT_COLOR = "#7c9cff";

export function createTimeBlock(input: NewTimeBlockInput) {
  return createRow("time_blocks", {
    name: input.name.trim(),
    start_time: input.start_time,
    end_time: input.end_time,
    recurrence: input.recurrence ?? "weekly",
    days_of_week: input.days_of_week ?? [1, 2, 3, 4, 5],
    specific_date: input.specific_date ?? null,
    end_date: input.end_date ?? null,
    filter_category_ids: input.filter_category_ids ?? [],
    filter_tags: input.filter_tags ?? [],
    filter_priorities: input.filter_priorities ?? [],
    color: input.color ?? DEFAULT_COLOR,
    enabled: true,
  });
}

export function updateTimeBlock(
  blockId: UUID,
  patch: Partial<Omit<TimeBlock, "id" | "user_id" | "created_at" | "updated_at" | "deleted_at" | "dirty">>,
) {
  return updateRow("time_blocks", blockId, patch);
}

export function deleteTimeBlock(blockId: UUID) {
  return softDeleteRow("time_blocks", blockId);
}

/**
 * §4.7 — skip a single occurrence of a recurring block. Toggling re-uses the
 * existing exception row rather than piling up tombstones, so the composite
 * `[time_block_id+date]` index stays a genuine key.
 */
export async function toggleSkip(blockId: UUID, date: IsoDate): Promise<boolean> {
  const db = getDb();
  const existing = await db.time_block_exceptions
    .where("[time_block_id+date]")
    .equals([blockId, date])
    .first();

  if (existing && !existing.deleted_at) {
    await softDeleteRow("time_block_exceptions", existing.id);
    return false;
  }

  if (existing) {
    // Previously skipped and then un-skipped: revive the same row.
    await restoreRow("time_block_exceptions", existing.id);
    return true;
  }

  await createRow("time_block_exceptions", {
    time_block_id: blockId,
    date,
    action: "skipped",
  });
  return true;
}

export async function isSkipped(blockId: UUID, date: IsoDate): Promise<boolean> {
  const row = await getDb()
    .time_block_exceptions.where("[time_block_id+date]")
    .equals([blockId, date])
    .first();
  return Boolean(row && !row.deleted_at);
}
