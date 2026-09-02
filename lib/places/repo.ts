"use client";

import { applyCommuteMoves } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import {
  createRow,
  restoreRow,
  softDeleteRow,
  updateRow,
} from "@/lib/db/mutations";
import type { Place, UUID } from "@/lib/db/schema";

/**
 * Place CRUD.
 *
 * A place is a pinned coordinate the user attaches to work — home, the office,
 * the gym — and the distance between two of them is what a computed commute
 * buffer is made of.
 *
 * Moving a pin moves every estimate measured from or to it, so the mutations
 * that change coordinates re-run the reconciler. Renaming one does not — the
 * name is not part of the arithmetic.
 */

export interface NewPlaceInput {
  name: string;
  latitude: number;
  longitude: number;
}

export async function createPlace(input: NewPlaceInput): Promise<Place> {
  const db = getDb();
  const existing = await db.places.toArray();
  const sort_order =
    existing.reduce((max, place) => Math.max(max, place.sort_order), -1) + 1;

  return createRow("places", {
    name: input.name.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    sort_order,
  });
}

export type PlacePatch = Partial<Pick<Place, "name" | "latitude" | "longitude" | "sort_order">>;

export async function updatePlace(placeId: UUID, patch: PlacePatch) {
  const next = await updateRow("places", placeId, patch);
  if (patch.latitude !== undefined || patch.longitude !== undefined) {
    await applyCommuteMoves();
  }
  return next;
}

/**
 * Soft-deletes the place, leaving every `place_id` that pointed at it alone.
 *
 * The same reasoning as D-060 for categories: rewriting every referring row
 * would be a large cascade for an action the user may undo within five seconds,
 * and a dangling `place_id` already reads as "no location" everywhere — the
 * commute lookup simply finds nothing and charges zero.
 */
export async function deletePlace(placeId: UUID) {
  const row = await softDeleteRow("places", placeId);
  await applyCommuteMoves();
  return row;
}

/** Undo for `deletePlace`. */
export async function restorePlace(placeId: UUID) {
  const row = await restoreRow("places", placeId);
  await applyCommuteMoves();
  return row;
}
