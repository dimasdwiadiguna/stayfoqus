import type { Agenda, Coordinate, IsoDate, Place, UUID } from "@/lib/db/schema";
import { localDate } from "@/lib/time";

/**
 * Turning distance into a commute buffer.
 *
 * §5.2 gives `commute` a precise *meaning* — physical travel, which stacks with
 * a mental reset rather than overlapping it — but never says where the number
 * comes from, so until now it was always typed by hand. This module answers it
 * from the distance between two pinned places.
 *
 * Pure and offline by construction, like the rest of `lib/scheduling/`. §3.1
 * forbids the UI blocking on the network and `docs/PHASE2.md` rules out
 * server-side scheduling, so a routing API is out: this is straight-line
 * distance corrected by a detour factor. Expect ±25% on a city trip — which is
 * the right accuracy for something whose entire job is to be *slack*.
 */

/* ------------------------------------------------------------------ */
/* the travel model                                                    */
/* ------------------------------------------------------------------ */

/** Mean Earth radius, km. */
const EARTH_RADIUS_KM = 6371;

/**
 * Straight line → road distance. Roads bend, rivers have three bridges, and
 * one-way systems are one-way. 1.35 is the low end of the usual 1.2–1.5 range
 * for a dense city grid, chosen low because `COMMUTE_OVERHEAD_MIN` already
 * covers the fixed costs and over-reserving fragments a day.
 */
export const COMMUTE_DETOUR_FACTOR = 1.35;

/**
 * The part of a journey that is not travelling: finding the bike, parking,
 * lifts, walking in from the gate. Flat, because it barely varies with
 * distance, and it is most of a short trip.
 */
export const COMMUTE_OVERHEAD_MIN = 5;

/** Same grid the drag gesture snaps to (`SNAP_MS`), so the two agree. */
export const COMMUTE_SNAP_MIN = 5;

/**
 * Below this, two pins are the same building with a different GPS fix. Charging
 * a commute across a car park would be worse than charging nothing.
 */
export const COMMUTE_MIN_KM = 0.15;

export interface CommuteSpeedPreset {
  key: "walk" | "motorbike" | "car";
  kmh: number;
}

/**
 * Door-to-door averages, not top speeds.
 *
 * A car is *slower* than a motorbike here, and that is not a typo: in
 * Indonesian city traffic a motorbike filters and parks almost anywhere while a
 * car queues and then hunts for a space.
 */
export const COMMUTE_SPEED_PRESETS: readonly CommuteSpeedPreset[] = [
  { key: "walk", kmh: 4 },
  { key: "motorbike", kmh: 22 },
  { key: "car", kmh: 18 },
];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance between two coordinates, in kilometres. */
export function haversineKm(a: Coordinate, b: Coordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road distance between two coordinates, in kilometres. */
export function travelDistanceKm(from: Coordinate, to: Coordinate): number {
  return haversineKm(from, to) * COMMUTE_DETOUR_FACTOR;
}

/**
 * Minutes to reserve for the journey, rounded *up* onto the 5-minute grid.
 *
 * Up rather than nearest: a buffer that is a little too long costs some slack,
 * one that is a little too short makes you late, and those are not symmetric.
 * Returns 0 when either end is unknown or the two are effectively the same
 * place — "no location" means "wherever you already are", never "far away".
 */
export function travelMinutes(
  from: Coordinate | null | undefined,
  to: Coordinate | null | undefined,
  speedKmh: number,
): number {
  if (!from || !to) return 0;
  if (!(speedKmh > 0)) return 0;

  const km = travelDistanceKm(from, to);
  if (km < COMMUTE_MIN_KM) return 0;

  const raw = (km / speedKmh) * 60 + COMMUTE_OVERHEAD_MIN;
  return Math.ceil(raw / COMMUTE_SNAP_MIN) * COMMUTE_SNAP_MIN;
}

/* ------------------------------------------------------------------ */
/* the day's chain of places                                           */
/* ------------------------------------------------------------------ */

/** One committed block, reduced to what the commute chain needs to know. */
export interface CommuteStop {
  /** Agenda id, or `${eventId}|${date}` for one occurrence of an event. */
  key: string;
  /** Local calendar date. The chain restarts at home on each one. */
  date: IsoDate;
  /** Epoch ms; only the ordering is used. */
  start: number;
  placeId: UUID | null;
}

export interface CommuteAssignment {
  key: string;
  minutes: number;
  /** Where the journey starts. Null when the origin is unknown. */
  fromPlaceId: UUID | null;
  /** Where it ends — the stop's own place. */
  toPlaceId: UUID;
}

export interface CommuteContext {
  /** Where every day begins. Null until the user has dropped the pin. */
  homePlaceId: UUID | null;
  places: ReadonlyMap<UUID, Place>;
  speedKmh: number;
}

/**
 * Walks each local day from home and answers, for every stop that has a
 * location, how long getting there takes.
 *
 * The rule, and the one thing worth being careful about:
 *
 *   lastPlace = home at the start of each local day
 *   stop has a place → travel(lastPlace → it); lastPlace = it
 *   stop has none    → no commute, **and lastPlace does not move**
 *
 * That last clause is the whole reason this is a fold rather than a map over
 * pairs. A task with no location is done wherever you already are, so it is not
 * a journey and it does not teleport you: an errand between two office blocks
 * must not make the second one look like a fresh trip from home.
 *
 * Stops are sorted here rather than trusted, so the result cannot depend on the
 * order a live query happened to return — the determinism D-062 established.
 * Ties fall through to the key, which is unique by construction.
 */
export function resolveCommute(
  stops: readonly CommuteStop[],
  ctx: CommuteContext,
): Map<string, CommuteAssignment> {
  const out = new Map<string, CommuteAssignment>();

  const byDate = new Map<IsoDate, CommuteStop[]>();
  for (const stop of stops) {
    const bucket = byDate.get(stop.date);
    if (bucket) bucket.push(stop);
    else byDate.set(stop.date, [stop]);
  }

  const coord = (placeId: UUID | null): Coordinate | null => {
    if (!placeId) return null;
    return ctx.places.get(placeId) ?? null;
  };

  for (const bucket of byDate.values()) {
    const ordered = [...bucket].sort(
      (a, b) => a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );

    let lastPlaceId: UUID | null = ctx.homePlaceId;

    for (const stop of ordered) {
      if (!stop.placeId) continue;

      const minutes = travelMinutes(
        coord(lastPlaceId),
        coord(stop.placeId),
        ctx.speedKmh,
      );
      out.set(stop.key, {
        key: stop.key,
        minutes,
        fromPlaceId: lastPlaceId,
        toPlaceId: stop.placeId,
      });

      // Only a *known* location moves you. Reached even when `minutes` is 0,
      // because arriving somewhere five metres away still means you are there.
      lastPlaceId = stop.placeId;
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* what counts as a stop                                               */
/* ------------------------------------------------------------------ */

/**
 * The agenda statuses that put you somewhere.
 *
 * A `draft` was never a commitment and a `cancelled` one is not happening, so
 * neither moves you — the same exclusions D-103 makes for the ticker, for the
 * same reason. `done` and `partial` *are* included here, unlike in the ticker:
 * a morning that really happened at the office is exactly what makes the
 * afternoon's journey short.
 */
const CHAIN_STATUSES = new Set(["planned", "done", "partial", "missed"]);

export function isChainAgenda(agenda: Agenda): boolean {
  return !agenda.deleted_at && CHAIN_STATUSES.has(agenda.status);
}

/** Agendas as stops in the chain. */
export function agendaStops(
  agendas: readonly Agenda[],
  timezone: string,
): CommuteStop[] {
  return agendas.filter(isChainAgenda).map((agenda) => ({
    key: agenda.id,
    date: localDate(agenda.start_at, timezone),
    start: new Date(agenda.start_at).getTime(),
    placeId: agenda.place_id,
  }));
}

/** One occurrence of an event, keyed so it cannot collide with an agenda id. */
export function eventStopKey(eventId: UUID, date: IsoDate): string {
  return `${eventId}|${date}`;
}

