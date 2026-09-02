"use client";

import dynamic from "next/dynamic";
import { Crosshair, MapPin, Trash2 } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { usePlaces } from "@/hooks/use-places";
import { useSettings } from "@/hooks/use-settings";
import type { Coordinate, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { createPlace, deletePlace, restorePlace } from "@/lib/places/repo";

/**
 * Leaflet touches `window` at import time, so the map is loaded only in the
 * browser and only once this sheet is actually opened — it never enters the
 * initial bundle of an app whose first paint has to be instant offline.
 */
const PlaceMap = dynamic(
  () => import("@/components/places/place-map").then((m) => m.PlaceMap),
  { ssr: false, loading: () => <div className="h-56 rounded-xl bg-surface-muted" /> },
);

/**
 * Choosing where something happens.
 *
 * Saved places first, because after the first week that is one tap and the
 * whole feature disappears into the background. Dropping a new pin saves it as
 * a place in the same motion: there is no separate "manage places" step to
 * learn, and the next thing at the same address is a tap away.
 *
 * `allowNone` is false when picking the home pin — a home that can be unset
 * from here would be a way to silently switch every estimate off.
 */
export function PlacePicker({
  open,
  value,
  onPick,
  onClose,
  allowNone = true,
  title = t.location.pickTitle,
}: {
  open: boolean;
  value: UUID | null;
  onPick: (placeId: UUID | null) => void;
  onClose: () => void;
  allowNone?: boolean;
  title?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent title={title}>
        {open ? (
          <PickerBody
            value={value}
            allowNone={allowNone}
            onPick={(placeId) => {
              onPick(placeId);
              onClose();
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PickerBody({
  value,
  allowNone,
  onPick,
}: {
  value: UUID | null;
  allowNone: boolean;
  onPick: (placeId: UUID | null) => void;
}) {
  const places = usePlaces();
  const settings = useSettings();

  const [creating, setCreating] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [pendingDelete, setPendingDelete] = React.useState<UUID | null>(null);

  // Somewhere to start the map. The prayer coordinates are the best guess the
  // app already holds — a city, not a home — and the user pans from there.
  const [draft, setDraft] = React.useState<Coordinate>(() => ({
    latitude: settings.latitude,
    longitude: settings.longitude,
  }));
  const [name, setName] = React.useState("");

  const locate = () => {
    if (!navigator.geolocation) {
      toast.error(t.location.locateFailed);
      return;
    }
    setLocating(true);
    setCreating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setDraft({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        setLocating(false);
        toast.error(t.location.locateFailed);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const save = async () => {
    const place = await createPlace({
      name: name.trim() || t.location.namePlaceholder,
      latitude: draft.latitude,
      longitude: draft.longitude,
    });
    onPick(place.id);
  };

  const remove = async (placeId: UUID) => {
    await deletePlace(placeId);
    toast.undoable(t.settings.placeDeleted, () => void restorePlace(placeId));
  };

  if (creating) {
    return (
      <div className="space-y-3 pb-2">
        <PlaceMap value={draft} onChange={setDraft} />

        <Field label={t.location.nameLabel}>
          <Input
            value={name}
            aria-label={t.location.nameLabel}
            placeholder={t.location.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t.location.latitude}>
            <Input
              type="number"
              step="0.0001"
              aria-label={t.location.latitude}
              value={draft.latitude}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setDraft((d) => ({ ...d, latitude: v }));
              }}
            />
          </Field>
          <Field label={t.location.longitude}>
            <Input
              type="number"
              step="0.0001"
              aria-label={t.location.longitude}
              value={draft.longitude}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) setDraft((d) => ({ ...d, longitude: v }));
              }}
            />
          </Field>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={locate} disabled={locating}>
            <Crosshair className="size-4" />
            {locating ? t.location.locating : t.location.useMyLocation}
          </Button>
          <Button variant="primary" className="flex-1" onClick={() => void save()}>
            {t.location.save}
          </Button>
        </div>

        <Button variant="ghost" block onClick={() => setCreating(false)}>
          {t.common.cancel}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 pb-2">
      <ul className="space-y-1">
        {allowNone ? (
          <li>
            <Row
              label={t.location.none}
              active={value === null}
              onClick={() => onPick(null)}
            />
          </li>
        ) : null}

        {places.map((place) => (
          <li key={place.id} className="flex items-center gap-1">
            <Row
              label={place.name}
              hint={t.location.coordinates(place.latitude, place.longitude)}
              active={value === place.id}
              onClick={() => onPick(place.id)}
            />
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.location.delete}
              onClick={() => setPendingDelete(place.id)}
            >
              <Trash2 className="size-4 text-danger" />
            </Button>
          </li>
        ))}

        {places.length === 0 ? (
          <li className="px-1 py-2 text-[13px] text-fg-muted">
            {t.settings.noSavedPlaces}
          </li>
        ) : null}
      </ul>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={() => setCreating(true)}>
          <MapPin className="size-4" />
          {t.location.pickOnMap}
        </Button>
        <Button variant="outline" onClick={locate}>
          <Crosshair className="size-4" />
          {t.location.useMyLocation}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title={t.location.deleteConfirmTitle}
        description={t.location.deleteConfirmBody}
        confirmLabel={t.location.delete}
        tone="danger"
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

function Row({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[14px] ${
        active ? "bg-accent/10 text-accent" : "hover:bg-surface-muted"
      }`}
    >
      <span className="truncate">{label}</span>
      {hint ? (
        <span className="shrink-0 text-[12px] tabular-nums text-fg-muted">{hint}</span>
      ) : null}
    </button>
  );
}
