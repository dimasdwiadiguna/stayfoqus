"use client";

import * as React from "react";

import { usePlaceIndex } from "@/hooks/use-places";
import { useEventExceptions, useEvents } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useAgendas } from "@/hooks/use-tasks";
import type { IsoDate, Place, UUID } from "@/lib/db/schema";
import {
  agendaStops,
  eventStopKey,
  resolveCommute,
  travelDistanceKm,
  type CommuteAssignment,
} from "@/lib/scheduling/commute";
import { expandEvents } from "@/lib/scheduling/events";

/**
 * How each journey on one day was worked out — for explaining a buffer, not for
 * computing one.
 *
 * The number itself is already on the agenda's row (`applyCommuteMoves` put it
 * there) or on the event occurrence (`expandEvents` derived it). What is missing
 * for a label is *where from*, so this re-runs the same pure resolver over the
 * same stops and hands back the assignments.
 *
 * Scoped to a single date deliberately: the chain never crosses midnight, so one
 * day is all the context an explanation needs, and a sheet must not pay for a
 * month of expansion to draw one line of text.
 */
export function useCommuteAssignments(
  date: IsoDate | null,
): ReadonlyMap<string, CommuteAssignment> {
  const settings = useSettings();
  const agendas = useAgendas();
  const events = useEvents();
  const eventExceptions = useEventExceptions();
  const places = usePlaceIndex();

  return React.useMemo(() => {
    if (!date) return new Map<string, CommuteAssignment>();

    const occurrences = expandEvents(
      events,
      eventExceptions,
      date,
      date,
      settings.timezone,
    ).filter((instance) => !instance.skipped);

    return resolveCommute(
      [
        ...agendaStops(agendas, settings.timezone).filter((s) => s.date === date),
        ...occurrences.map((instance) => ({
          key: eventStopKey(instance.eventId, instance.date),
          date: instance.date,
          start: instance.start,
          placeId: instance.placeId,
        })),
      ],
      {
        homePlaceId: settings.home_place_id,
        places,
        speedKmh: settings.commute_speed_kmh,
      },
    );
  }, [
    date,
    agendas,
    events,
    eventExceptions,
    places,
    settings.timezone,
    settings.home_place_id,
    settings.commute_speed_kmh,
  ]);
}

export interface CommuteExplanation {
  minutes: number;
  fromName: string | null;
  toName: string;
  km: number;
}

/** Turns one assignment into the three things a label needs. */
export function explainCommute(
  assignment: CommuteAssignment | undefined,
  places: ReadonlyMap<UUID, Place>,
): CommuteExplanation | null {
  if (!assignment) return null;

  const to = places.get(assignment.toPlaceId);
  if (!to) return null;

  const from = assignment.fromPlaceId
    ? (places.get(assignment.fromPlaceId) ?? null)
    : null;

  return {
    minutes: assignment.minutes,
    fromName: from?.name ?? null,
    toName: to.name,
    km: from ? travelDistanceKm(from, to) : 0,
  };
}
