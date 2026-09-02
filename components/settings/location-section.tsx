"use client";

import { MapPin, Pencil } from "lucide-react";
import * as React from "react";

import { PlaceEditorSheet } from "@/components/places/place-editor";
import { PlacePicker } from "@/components/places/place-picker";
import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Chip, Input } from "@/components/ui/field";
import { usePlaces } from "@/hooks/use-places";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { id as t } from "@/lib/i18n/id";
import { COMMUTE_SPEED_PRESETS } from "@/lib/scheduling/commute";

/**
 * The only two things this feature ever asks the user to configure: where home
 * is, and roughly how fast they travel.
 *
 * Everything else — which blocks get a commute, how long, when it changes — is
 * derived from the locations attached to the work itself. That was the design
 * constraint: one field to fill in per thing, and two settings for the whole
 * app.
 */
export function LocationSection() {
  const settings = useSettings();
  const places = usePlaces();
  const [pickingHome, setPickingHome] = React.useState(false);
  const [editing, setEditing] = React.useState<{ placeId: string } | null>(null);
  const [custom, setCustom] = React.useState(false);

  const home = places.find((p) => p.id === settings.home_place_id);
  const preset = COMMUTE_SPEED_PRESETS.find(
    (p) => p.kmh === settings.commute_speed_kmh,
  );

  return (
    <Section title={t.settings.locationTitle} blurb={t.settings.locationBlurb}>
      <Row
        label={t.settings.homePlace}
        hint={t.settings.homePlaceHint}
        control={
          <Button variant="outline" onClick={() => setPickingHome(true)}>
            <MapPin className="size-4" />
            {home ? home.name : t.settings.setHomePlace}
          </Button>
        }
      />

      <div>
        <p className="mb-1.5 text-[15px]">{t.settings.commuteSpeed}</p>
        {/* Presets plus a custom field, the same idiom as the duration picker —
            one row, horizontally scrollable, so it never wraps into two. */}
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-2">
          {COMMUTE_SPEED_PRESETS.map((option) => (
            <Chip
              key={option.key}
              size="sm"
              active={!custom && preset?.key === option.key}
              onClick={() => {
                setCustom(false);
                void updateSettings({ commute_speed_kmh: option.kmh });
              }}
            >
              {t.location[
                option.key === "walk"
                  ? "speedWalk"
                  : option.key === "motorbike"
                    ? "speedMotorbike"
                    : "speedCar"
              ]}{" "}
              · {t.location.speedValue(option.kmh)}
            </Chip>
          ))}
          <Chip
            size="sm"
            active={custom || !preset}
            onClick={() => setCustom((v) => !v)}
          >
            {t.location.speedCustom}
          </Chip>
        </div>

        {custom || !preset ? (
          <Input
            type="number"
            min={1}
            max={200}
            step={1}
            aria-label={t.settings.commuteSpeed}
            defaultValue={settings.commute_speed_kmh}
            onBlur={(e) => {
              const value = Math.round(Number(e.target.value));
              if (Number.isFinite(value) && value > 0) {
                void updateSettings({
                  commute_speed_kmh: Math.min(200, value),
                });
              }
            }}
          />
        ) : null}

        <p className="mt-1 text-[12px] text-fg-subtle">
          {t.settings.commuteSpeedHint}
        </p>
      </div>

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-fg-muted">
          {t.settings.savedPlaces}
        </p>
        {places.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t.settings.noSavedPlaces}</p>
        ) : (
          /*
            A row opens the full editor rather than being an inline rename box.
            The box could only ever change the name — the coordinates, the thing
            the estimate is actually made of, had nowhere to be corrected — and
            an unlabelled input in a settings list does not read as editable in
            the first place.
          */
          <ul className="space-y-1">
            {places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => setEditing({ placeId: place.id })}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-left"
                >
                  <span className="min-w-0 truncate text-[15px]">{place.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums text-fg-subtle">
                    {t.location.coordinates(place.latitude, place.longitude)}
                    <Pencil className="size-3.5" aria-hidden />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <PlaceEditorSheet
        placeId={editing?.placeId ?? null}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />

      <PlacePicker
        open={pickingHome}
        value={settings.home_place_id}
        allowNone={false}
        title={t.settings.setHomePlace}
        onPick={(place_id) => void updateSettings({ home_place_id: place_id })}
        onClose={() => setPickingHome(false)}
      />
    </Section>
  );
}
