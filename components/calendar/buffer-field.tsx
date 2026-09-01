"use client";

import { BufferSwatch } from "@/components/calendar/buffer-band";
import { Chip, Field, Input } from "@/components/ui/field";
import type { BufferType } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

const BUFFER_TYPES: BufferType[] = ["switch", "commute"];

/**
 * §5.2 — the buffer editor, shared by the agenda sheet and the event sheet.
 *
 * The type is picked with the same swatches the timeline draws, so the choice
 * made here is recognisable there. It matters more than a usual enum: the two
 * types compose differently (max within a type, sum across), so the user has to
 * be able to tell at a glance which one a block carries.
 */
export function BufferField({
  label,
  minutes,
  type,
  onMinutes,
  onType,
}: {
  label: string;
  minutes: number;
  type: BufferType;
  onMinutes: (minutes: number) => void;
  onType: (type: BufferType) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        step={5}
        value={minutes}
        aria-label={label}
        onChange={(e) => onMinutes(Math.max(0, Number(e.target.value)))}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BUFFER_TYPES.map((value) => (
          <Chip
            key={value}
            active={type === value}
            aria-label={
              value === "commute" ? t.agenda.bufferCommute : t.agenda.bufferSwitch
            }
            onClick={() => onType(value)}
          >
            <BufferSwatch type={value} />
          </Chip>
        ))}
      </div>
    </Field>
  );
}
