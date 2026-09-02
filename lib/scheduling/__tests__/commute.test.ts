import { describe, expect, it } from "vitest";

import type { Place, UUID } from "@/lib/db/schema";
import {
  COMMUTE_SPEED_PRESETS,
  haversineKm,
  resolveCommute,
  travelMinutes,
  type CommuteStop,
} from "@/lib/scheduling/commute";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const place = (id: string, latitude: number, longitude: number): Place => ({
  id,
  user_id: "u",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  dirty: 0,
  name: id,
  latitude,
  longitude,
  sort_order: 0,
});

// Real coordinates, so the distances mean something.
const HOME = place("home", -6.9175, 107.6191); // Bandung, alun-alun
const OFFICE = place("office", -6.8915, 107.6107); // Dago, ~3 km north
const FAR = place("far", -6.2, 106.816667); // Jakarta, ~120 km north-west
const NEXT_DOOR = place("next-door", -6.9176, 107.6192); // ~15 m away

const index = (...places: Place[]): ReadonlyMap<UUID, Place> =>
  new Map(places.map((p) => [p.id, p] as const));

const MOTORBIKE = 22;

const stop = (
  key: string,
  date: string,
  hour: number,
  placeId: string | null,
): CommuteStop => ({
  key,
  date,
  start: Date.UTC(2026, 8, 2, hour, 0, 0),
  placeId,
});

/* ------------------------------------------------------------------ */
/* distance                                                            */
/* ------------------------------------------------------------------ */

describe("haversineKm", () => {
  it("measures Bandung to Jakarta at roughly 120 km", () => {
    expect(haversineKm(HOME, FAR)).toBeGreaterThan(115);
    expect(haversineKm(HOME, FAR)).toBeLessThan(125);
  });

  it("is zero for a point against itself, and symmetric", () => {
    expect(haversineKm(HOME, HOME)).toBe(0);
    expect(haversineKm(HOME, OFFICE)).toBeCloseTo(haversineKm(OFFICE, HOME), 9);
  });
});

describe("travelMinutes", () => {
  it("rounds up onto the 5-minute grid", () => {
    const minutes = travelMinutes(HOME, OFFICE, MOTORBIKE);
    expect(minutes % 5).toBe(0);
    expect(minutes).toBeGreaterThan(0);
  });

  it("never rounds down — a short buffer makes you late, a long one only costs slack", () => {
    // 3.04 km straight → 4.10 km by road; at 22 km/h that is 11.2 min plus the
    // 5-minute overhead = 16.2, which rounds *up* to 20.
    expect(travelMinutes(HOME, OFFICE, MOTORBIKE)).toBe(20);
  });

  it("charges nothing between two pins in the same building", () => {
    expect(travelMinutes(HOME, NEXT_DOOR, MOTORBIKE)).toBe(0);
  });

  it("charges nothing when either end is unknown", () => {
    expect(travelMinutes(null, OFFICE, MOTORBIKE)).toBe(0);
    expect(travelMinutes(HOME, null, MOTORBIKE)).toBe(0);
    expect(travelMinutes(null, null, MOTORBIKE)).toBe(0);
  });

  it("refuses a nonsensical speed rather than returning Infinity", () => {
    expect(travelMinutes(HOME, FAR, 0)).toBe(0);
    expect(travelMinutes(HOME, FAR, -5)).toBe(0);
  });

  it("takes longer on foot than on a motorbike", () => {
    const walk = COMMUTE_SPEED_PRESETS.find((p) => p.key === "walk")!.kmh;
    expect(travelMinutes(HOME, OFFICE, walk)).toBeGreaterThan(
      travelMinutes(HOME, OFFICE, MOTORBIKE),
    );
  });
});

/* ------------------------------------------------------------------ */
/* the day's chain                                                     */
/* ------------------------------------------------------------------ */

const ctx = (homePlaceId: string | null = HOME.id) => ({
  homePlaceId,
  places: index(HOME, OFFICE, FAR, NEXT_DOOR),
  speedKmh: MOTORBIKE,
});

describe("resolveCommute — the day's chain of places", () => {
  it("measures the first stop of the day from home", () => {
    const out = resolveCommute([stop("a", "2026-09-02", 9, OFFICE.id)], ctx());
    expect(out.get("a")).toMatchObject({
      minutes: 20,
      fromPlaceId: HOME.id,
      toPlaceId: OFFICE.id,
    });
  });

  it("measures the next stop from the previous one, not from home", () => {
    const out = resolveCommute(
      [
        stop("a", "2026-09-02", 9, OFFICE.id),
        stop("b", "2026-09-02", 13, OFFICE.id),
      ],
      ctx(),
    );
    // Already at the office: nothing to travel.
    expect(out.get("b")?.minutes).toBe(0);
    expect(out.get("b")?.fromPlaceId).toBe(OFFICE.id);
  });

  it("restarts at home on each local date", () => {
    const out = resolveCommute(
      [
        stop("a", "2026-09-02", 15, OFFICE.id),
        stop("b", "2026-09-03", 9, OFFICE.id),
      ],
      ctx(),
    );
    expect(out.get("b")?.fromPlaceId).toBe(HOME.id);
    expect(out.get("b")?.minutes).toBe(20);
  });

  it("leaves a stop with no location out entirely", () => {
    const out = resolveCommute([stop("a", "2026-09-02", 9, null)], ctx());
    expect(out.has("a")).toBe(false);
  });

  it("does not let a stop with no location move you", () => {
    const out = resolveCommute(
      [
        stop("a", "2026-09-02", 9, OFFICE.id),
        stop("b", "2026-09-02", 11, null), // an errand, done where you are
        stop("c", "2026-09-02", 13, OFFICE.id),
      ],
      ctx(),
    );
    // Still at the office when `c` starts — `b` was not a journey.
    expect(out.get("c")?.fromPlaceId).toBe(OFFICE.id);
    expect(out.get("c")?.minutes).toBe(0);
  });

  it("charges nothing anywhere when no home pin has been dropped", () => {
    const out = resolveCommute([stop("a", "2026-09-02", 9, OFFICE.id)], ctx(null));
    expect(out.get("a")).toMatchObject({ minutes: 0, fromPlaceId: null });
  });

  it("still measures later stops once a known place has been reached", () => {
    const out = resolveCommute(
      [
        stop("a", "2026-09-02", 9, OFFICE.id),
        stop("b", "2026-09-02", 13, FAR.id),
      ],
      ctx(null),
    );
    expect(out.get("a")?.minutes).toBe(0); // origin unknown
    expect(out.get("b")?.minutes).toBeGreaterThan(60); // office → Jakarta
  });

  it("charges nothing for a place that no longer exists", () => {
    const out = resolveCommute(
      [stop("a", "2026-09-02", 9, "deleted-place")],
      ctx(),
    );
    expect(out.get("a")?.minutes).toBe(0);
  });

  it("does not depend on the order the stops arrive in", () => {
    const stops = [
      stop("a", "2026-09-02", 9, OFFICE.id),
      stop("b", "2026-09-02", 13, FAR.id),
      stop("c", "2026-09-02", 17, OFFICE.id),
    ];
    const forward = resolveCommute(stops, ctx());
    const backward = resolveCommute([...stops].reverse(), ctx());

    for (const key of ["a", "b", "c"]) {
      expect(backward.get(key)).toEqual(forward.get(key));
    }
  });

  it("breaks a tie on start time by key, so two devices agree", () => {
    const same = (key: string): CommuteStop => ({
      key,
      date: "2026-09-02",
      start: Date.UTC(2026, 8, 2, 9),
      placeId: key === "a" ? OFFICE.id : FAR.id,
    });
    const out = resolveCommute([same("b"), same("a")], ctx());
    // "a" sorts first, so it is the one reached from home.
    expect(out.get("a")?.fromPlaceId).toBe(HOME.id);
    expect(out.get("b")?.fromPlaceId).toBe(OFFICE.id);
  });
});
