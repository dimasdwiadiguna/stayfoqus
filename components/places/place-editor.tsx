"use client";

import dynamic from "next/dynamic";
import { Crosshair, Trash2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useSettings } from "@/hooks/use-settings";
import { getDb } from "@/lib/db/client";
import type { Coordinate, Place, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  createPlace,
  deletePlace,
  restorePlace,
  updatePlace,
} from "@/lib/places/repo";

/**
 * Leaflet touches `window` at import time, so the map loads only in the browser
 * and only once an editor is actually opened — it never enters the initial
 * bundle of an app whose first paint has to be instant offline.
 */
const PlaceMap = dynamic(
  () => import("@/components/places/place-map").then((m) => m.PlaceMap),
  { ssr: false, loading: () => <div className="h-56 rounded-xl bg-surface-muted" /> },
);

/**
 * One form for a place, whether it is being created or corrected.
 *
 * Reported as three separate problems — renaming was buried in an unlabelled
 * inline field in Settings, coordinates could not be changed *at all* once
 * saved, and deleting lived somewhere else again. They were one problem: a
 * place was write-once. Everything about it is editable here, in the place the
 * user already goes to choose one.
 *
 * Rendered inline by the picker (which swaps its own content) and as a sheet of
 * its own from Settings, so both routes reach the identical form.
 */
export function PlaceEditorBody({
  placeId,
  initial,
  onSaved,
  onCancel,
}: {
  /** Null to create a new place. */
  placeId: UUID | null;
  /** Where the map starts when creating. Ignored when editing. */
  initial?: Coordinate;
  onSaved: (placeId: UUID) => void;
  onCancel: () => void;
}) {
  // `undefined` while the query is in flight, `null` once it has answered that
  // the row is gone.
  const existing = useLiveQuery(
    async () => (placeId ? ((await getDb().places.get(placeId)) ?? null) : null),
    [placeId],
  );

  // The form holds a *draft* — the map has to be free to pan without a live
  // value yanking it back — so it must not be seeded before the row arrives.
  // Mounting early filled the name with "" and the coordinates with the city
  // default, and saving then quietly moved the pin the user came to correct.
  // The key makes the row's arrival remount the form rather than leave stale
  // state behind (the D-076 trap, one layer along).
  if (placeId !== null && existing === undefined) {
    return <div className="h-72 animate-pulse rounded-xl bg-surface-muted" />;
  }

  return (
    <PlaceForm
      key={existing?.id ?? "new"}
      existing={existing ?? null}
      initial={initial}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

function PlaceForm({
  existing,
  initial,
  onSaved,
  onCancel,
}: {
  existing: Place | null;
  initial?: Coordinate;
  onSaved: (placeId: UUID) => void;
  onCancel: () => void;
}) {
  const settings = useSettings();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [locating, setLocating] = React.useState(false);

  // Seeded once. A live-query-driven `value` would fight the map's own panning
  // and re-centre under the user's finger on every keystroke.
  const [draft, setDraft] = React.useState<Coordinate>(() =>
    existing
      ? { latitude: existing.latitude, longitude: existing.longitude }
      : (initial ?? {
          // The best guess the app already holds: a city, not a home. The user
          // pans from there.
          latitude: settings.latitude,
          longitude: settings.longitude,
        }),
  );
  const [name, setName] = React.useState(existing?.name ?? "");

  const locate = () => {
    if (!navigator.geolocation) {
      toast.error(t.location.locateFailed);
      return;
    }
    setLocating(true);
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
    const trimmed = name.trim() || t.location.namePlaceholder;
    if (existing) {
      // Coordinates go through `updatePlace`, which re-prices every commute
      // measured from or to this pin.
      await updatePlace(existing.id, {
        name: trimmed,
        latitude: draft.latitude,
        longitude: draft.longitude,
      });
      onSaved(existing.id);
      return;
    }
    const place = await createPlace({ ...draft, name: trimmed });
    onSaved(place.id);
  };

  const remove = async () => {
    if (!existing) return;
    await deletePlace(existing.id);
    toast.undoable(t.settings.placeDeleted, () => void restorePlace(existing.id));
    onCancel();
  };

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

      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          {t.common.cancel}
        </Button>
        {existing ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.location.delete}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4 text-danger" />
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t.location.deleteConfirmTitle}
        description={t.location.deleteConfirmBody}
        confirmLabel={t.location.delete}
        tone="danger"
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** The same form as its own sheet, for callers that are not the picker. */
export function PlaceEditorSheet({
  placeId,
  open,
  onClose,
}: {
  placeId: UUID | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        title={placeId ? t.location.editTitle : t.location.newTitle}
      >
        {open ? (
          <PlaceEditorBody
            key={placeId ?? "new"}
            placeId={placeId}
            onSaved={onClose}
            onCancel={onClose}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
