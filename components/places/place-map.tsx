"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import * as React from "react";

import { id as t } from "@/lib/i18n/id";
import type { Coordinate } from "@/lib/db/schema";

/**
 * A pin picker, wrapping Leaflet by hand.
 *
 * §2 fixes the tech stack and does not include a map, so this is a deliberate
 * addition — recorded in DECISIONS. Leaflet rather than MapLibre because raster
 * OpenStreetMap tiles need no API key and the whole library is ~45 KB against
 * MapLibre's ~800 KB, which matters in a PWA whose point is opening instantly.
 * No `react-leaflet`: the wrapper is a hundred lines and one fewer dependency to
 * keep in step with React's major versions.
 *
 * ## The pin does not move; the map does
 *
 * A fixed crosshair at the centre, with the map panning beneath it. That avoids
 * Leaflet's default marker images, which break under every bundler because the
 * CSS references them by relative path — and it is the better touch interaction
 * anyway: a dragged marker spends the whole gesture under the user's thumb,
 * which is precisely where they cannot see it.
 *
 * ## Offline
 *
 * Tiles need the network. Everything else here does not, and the caller always
 * offers manual coordinates alongside, so choosing a pin is possible offline —
 * just not comfortable. Tiles already seen are served from the service worker's
 * runtime cache.
 */

const DEFAULT_ZOOM = 15;

export function PlaceMap({
  value,
  onChange,
  className,
}: {
  value: Coordinate;
  onChange: (next: Coordinate) => void;
  className?: string;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const [tilesFailed, setTilesFailed] = React.useState(false);

  // The latest callback, so the `moveend` handler registered once below never
  // closes over a stale one. Assigned in an effect rather than during render —
  // a ref written while rendering is not guaranteed to survive a discarded one.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || mapRef.current) return;

    const map = L.map(host, {
      center: [value.latitude, value.longitude],
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // Required by the OpenStreetMap tile usage policy.
      attribution: "© OpenStreetMap",
    });
    tiles.on("tileerror", () => setTilesFailed(true));
    tiles.on("tileload", () => setTilesFailed(false));
    tiles.addTo(map);

    map.on("moveend", () => {
      const centre = map.getCenter();
      onChangeRef.current({ latitude: centre.lat, longitude: centre.lng });
    });

    mapRef.current = map;

    // The sheet animates in, so the container has no size on the first frame
    // and Leaflet would render a 0×0 map. Re-measuring on resize covers both
    // that and an orientation change.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // Mount once: `value` is the *initial* centre, and re-centring on every
    // change would fight the user's own panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Recentres from outside — "use my location", or a typed coordinate. */
  const recentre = React.useCallback((next: Coordinate) => {
    mapRef.current?.setView([next.latitude, next.longitude], DEFAULT_ZOOM);
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const centre = map.getCenter();
    // Only when the value has genuinely moved elsewhere; the tolerance keeps
    // the map's own `moveend` from bouncing back through here.
    const moved =
      Math.abs(centre.lat - value.latitude) > 1e-6 ||
      Math.abs(centre.lng - value.longitude) > 1e-6;
    if (moved) recentre(value);
  }, [value, recentre]);

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-xl border border-border">
        <div ref={hostRef} className="h-56 w-full bg-surface-muted" />

        {/*
          The pin: fixed at the centre, never in the way of the gesture.

          `z-[500]` is not decoration. Leaflet gives its own panes z-index 400
          (tiles) through 700, so an overlay with `z-index: auto` loses to them
          however late it comes in the DOM — the pin was drawn *underneath the
          map* and only visible when the tiles failed to load.

          Drawn as a teardrop with a white ring and a drop shadow so it stays
          legible over a satellite-dark street, a pale field, or a road, none of
          which a flat dot survives.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center"
        >
          <div className="flex flex-col items-center" style={{ marginTop: -22 }}>
            <svg
              width="28"
              height="40"
              viewBox="0 0 28 40"
              className="drop-shadow-[0_2px_3px_rgba(0,0,0,0.45)]"
            >
              <path
                d="M14 1.5c-6.6 0-12 5.3-12 11.9 0 8.6 10.6 20.9 11.1 21.4a1.2 1.2 0 0 0 1.8 0C15.4 34.3 26 22 26 13.4 26 6.8 20.6 1.5 14 1.5Z"
                fill="var(--accent)"
                stroke="#fff"
                strokeWidth="2.5"
              />
              <circle cx="14" cy="13.2" r="4.2" fill="#fff" />
            </svg>
            {/* The exact point the tip rests on, so precision is visible. */}
            <div className="size-1.5 -mt-1 rounded-full bg-black/50 ring-1 ring-white/70" />
          </div>
        </div>
      </div>

      <p className="mt-1.5 text-[12px] text-fg-muted">
        {tilesFailed ? t.location.mapOffline : t.location.mapTitle}
      </p>
    </div>
  );
}
