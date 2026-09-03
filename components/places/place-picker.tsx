"use client";

import { MapPin, Pencil } from "lucide-react";
import * as React from "react";

import { PlaceEditorBody } from "@/components/places/place-editor";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePlaces } from "@/hooks/use-places";
import type { UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

/**
 * Choosing where something happens.
 *
 * Saved places first, because after the first week that is one tap and the
 * whole feature disappears into the background. Dropping a new pin saves it as
 * a place in the same motion: there is no separate "manage places" step to
 * learn, and the next thing at the same address is a tap away.
 *
 * Each row also carries an edit affordance, opening the same form the pin was
 * created with. That is deliberate and was a correction: a place used to be
 * write-once — renaming lived in Settings, deleting lived here, and the
 * coordinates could not be changed at all once saved.
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
      {open ? (
        <PickerBody
          title={title}
          value={value}
          allowNone={allowNone}
          onPick={(placeId) => {
            onPick(placeId);
            onClose();
          }}
        />
      ) : null}
    </Sheet>
  );
}

/** `null` = the list; `{ placeId }` = the editor, with null meaning "new". */
type Editing = { placeId: UUID | null } | null;

function PickerBody({
  title,
  value,
  allowNone,
  onPick,
}: {
  title: string;
  value: UUID | null;
  allowNone: boolean;
  onPick: (placeId: UUID | null) => void;
}) {
  const places = usePlaces();
  const [editing, setEditing] = React.useState<Editing>(null);

  if (editing) {
    return (
      <SheetContent
        title={editing.placeId ? t.location.editTitle : t.location.newTitle}
      >
        <PlaceEditorBody
          key={editing.placeId ?? "new"}
          placeId={editing.placeId}
          onSaved={(placeId) => {
            // Creating a place from the picker is choosing it: the user opened
            // this to answer "where", and making them tap the new row again
            // would be asking the same question twice.
            if (editing.placeId === null) onPick(placeId);
            else setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </SheetContent>
    );
  }

  return (
    <SheetContent title={title}>
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
                aria-label={t.location.edit}
                title={t.location.edit}
                onClick={() => setEditing({ placeId: place.id })}
              >
                <Pencil className="size-4 text-fg-muted" />
              </Button>
            </li>
          ))}

          {places.length === 0 ? (
            <li className="px-1 py-2 text-[13px] text-fg-muted">
              {t.settings.noSavedPlaces}
            </li>
          ) : null}
        </ul>

        <Button
          variant="outline"
          block
          className="mt-1"
          onClick={() => setEditing({ placeId: null })}
        >
          <MapPin className="size-4" />
          {t.location.pickOnMap}
        </Button>
      </div>
    </SheetContent>
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
      className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[14px] ${
        active ? "bg-accent/10 text-accent" : "hover:bg-surface-muted"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      {hint ? (
        <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
