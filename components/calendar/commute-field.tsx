"use client";

import { Car } from "lucide-react";

import { BufferField } from "@/components/calendar/buffer-field";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { explainCommute } from "@/hooks/use-commute";
import { usePlaceIndex } from "@/hooks/use-places";
import { useSettings } from "@/hooks/use-settings";
import type { BufferType, Flag, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import type { CommuteAssignment } from "@/lib/scheduling/commute";
import { formatDuration } from "@/lib/time";

/**
 * The `before` buffer, when there may be a journey behind it.
 *
 * Replaces `BufferField` on that one side, and only there: the journey to a
 * block is what §5.2 wants on the arriving side, while the `after` side keeps
 * whatever mental reset the user chose. Writing a commute to both would swallow
 * the reset instead of stacking with it.
 *
 * Two states, and the switch between them is the "manual or computed" choice
 * the whole feature was asked for:
 *
 *  - **computed** — there is a location and the estimate owns the number. It is
 *    shown, not asked: a read-only line naming both ends and the distance, so
 *    the figure is explicable rather than magic.
 *  - **manual** — the ordinary `BufferField`, exactly as before.
 *
 * The user crosses between them with one tap, and crossing back re-derives from
 * the current day rather than restoring an old number.
 */
export function CommuteField({
  label,
  minutes,
  type,
  placeId,
  auto,
  assignment,
  onMinutes,
  onType,
  onAutoChange,
}: {
  label: string;
  minutes: number;
  type: BufferType;
  placeId: UUID | null;
  auto: Flag;
  assignment: CommuteAssignment | undefined;
  onMinutes: (minutes: number) => void;
  onType: (type: BufferType) => void;
  onAutoChange: (auto: Flag) => void;
}) {
  const places = usePlaceIndex();
  const settings = useSettings();

  const computed = auto !== 0 && placeId !== null;

  if (!computed) {
    return (
      <div>
        <BufferField
          label={label}
          minutes={minutes}
          type={type}
          onMinutes={onMinutes}
          onType={onType}
        />
        {placeId ? (
          <Button
            variant="link"
            size="sm"
            className="mt-1 px-0"
            onClick={() => onAutoChange(1)}
          >
            {t.agenda.commuteRecompute}
          </Button>
        ) : null}
      </div>
    );
  }

  const detail = explainCommute(assignment, places);
  const noHome = !settings.home_place_id && !detail?.fromName;

  return (
    <Field label={label}>
      <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <Car className="size-4 shrink-0 text-buffer-commute" />
          <span className="text-[14px] font-medium tabular-nums">
            {minutes > 0 ? formatDuration(minutes) : "—"}
          </span>
        </div>

        {detail ? (
          <p className="mt-0.5 text-[12px] text-fg-muted">
            {detail.fromName
              ? t.agenda.commuteFromTo(detail.fromName, detail.toName)
              : t.agenda.commuteFromUnknown(detail.toName)}
            {detail.km > 0
              ? // Indonesian decimals use a comma, as `formatHoursDecimal` does.
                ` · ${t.agenda.commuteDistance(detail.km.toFixed(1).replace(".", ","))}`
              : ""}
          </p>
        ) : null}

        {noHome ? (
          <p className="mt-1 text-[12px] text-warning">{t.agenda.commuteNoHome}</p>
        ) : null}
      </div>

      <Button
        variant="link"
        size="sm"
        className="mt-1 px-0"
        onClick={() => onAutoChange(0)}
      >
        {t.agenda.commuteSetManual}
      </Button>
    </Field>
  );
}
