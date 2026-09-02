"use client";

import { MapPin } from "lucide-react";
import * as React from "react";

import { PlacePicker } from "@/components/places/place-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { usePlaces } from "@/hooks/use-places";
import type { UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

/**
 * The one control the user actually thinks about.
 *
 * Everything else in this feature — the buffer, the band on the timeline, the
 * ticker's warning, the room the allocator leaves — follows from this single
 * field. That is the whole design: one question, asked where the work is
 * described, and no settings to reason about afterwards.
 */
export function PlaceField({
  value,
  onChange,
  label = t.agenda.fieldPlace,
  hint,
}: {
  value: UUID | null;
  onChange: (placeId: UUID | null) => void;
  label?: string;
  hint?: string;
}) {
  const places = usePlaces();
  const [open, setOpen] = React.useState(false);

  const place = value ? places.find((p) => p.id === value) : undefined;

  return (
    <Field label={label} hint={hint}>
      <Button variant="outline" block onClick={() => setOpen(true)}>
        <MapPin className="size-4 shrink-0 text-fg-muted" />
        <span className="min-w-0 flex-1 truncate text-left">
          {place ? place.name : t.location.none}
        </span>
      </Button>

      <PlacePicker
        open={open}
        value={value}
        onPick={onChange}
        onClose={() => setOpen(false)}
      />
    </Field>
  );
}
