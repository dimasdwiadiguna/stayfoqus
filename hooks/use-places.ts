"use client";

import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";

import { useSettings } from "@/hooks/use-settings";
import { getDb } from "@/lib/db/client";
import type { Place, UUID } from "@/lib/db/schema";
import type { CommutePricing } from "@/lib/scheduling/commute";

const EMPTY: never[] = [];

/** Every live place, in the user's own order. */
export function usePlaces(): Place[] {
  const rows = useLiveQuery(() => getDb().places.toArray(), []);
  return React.useMemo(
    () =>
      (rows ?? EMPTY)
        .filter((p) => !p.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order),
    [rows],
  );
}

/**
 * The same places keyed by id — the shape the commute maths wants.
 *
 * Built here rather than at each call site so the map identity is stable across
 * renders and the memos downstream of it are not invalidated every tick.
 */
export function usePlaceIndex(): ReadonlyMap<UUID, Place> {
  const places = usePlaces();
  return React.useMemo(
    () => new Map(places.map((place) => [place.id, place] as const)),
    [places],
  );
}

/**
 * What `suggestSlots` and `allocate` need to charge the journey to a candidate.
 *
 * Handed the destination; the origin comes from the free interval being
 * considered, because it differs slot by slot.
 */
export function useCommutePricing(placeId: UUID | null): CommutePricing {
  const places = usePlaceIndex();
  const settings = useSettings();

  return React.useMemo(
    () => ({ placeId, places, speedKmh: settings.commute_speed_kmh }),
    [placeId, places, settings.commute_speed_kmh],
  );
}
