"use client";

import * as React from "react";

import { Chip, Input } from "@/components/ui/field";
import { id as t } from "@/lib/i18n/id";
import { pomodorosForDuration, sessionDurationMin } from "@/lib/scheduling";
import type { SessionShape } from "@/lib/scheduling";
import { formatDuration } from "@/lib/time";

/**
 * Duration presets for an agenda.
 *
 * The brief models an agenda's length purely as a pomodoro count
 * (`n × focus + (n−1) × break`), which is right for planning but clumsy for a
 * 10-minute errand. The presets set the duration directly; `allocated_pomodoro`
 * is then derived from it, so the §5.7 dot row and the derived counters stay
 * consistent with whatever length was chosen.
 */
export const DURATION_PRESETS_MIN = [10, 15, 30, 60, 90, 120] as const;

export function DurationPicker({
  valueMin,
  onChange,
  shape,
  className,
}: {
  valueMin: number;
  onChange: (minutes: number, pomodoros: number) => void;
  shape: SessionShape;
  className?: string;
}) {
  // Custom only opens when asked for. A duration that happens not to match a
  // preset (25 minutes, say) still shows correctly in the equivalence line —
  // auto-expanding a number field for it would just be noise.
  const [custom, setCustom] = React.useState(false);

  const apply = (minutes: number) => {
    const clamped = Math.max(5, Math.min(600, Math.round(minutes)));
    onChange(clamped, pomodorosForDuration(clamped, shape));
  };

  return (
    <div className={className}>
      {/*
        One scrolling row rather than two wrapped ones. Seven presets wrapped
        onto a second line on a 390px screen, which cost a whole row of the
        sheet for a control the user usually just taps once.
      */}
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
        {DURATION_PRESETS_MIN.map((minutes) => (
          <Chip
            key={minutes}
            size="sm"
            active={!custom && valueMin === minutes}
            onClick={() => {
              setCustom(false);
              apply(minutes);
            }}
          >
            {formatDuration(minutes)}
          </Chip>
        ))}
        <Chip size="sm" active={custom} onClick={() => setCustom((v) => !v)}>
          {t.agenda.durationCustom}
        </Chip>
      </div>

      <div className="mt-1 flex items-center gap-2">
        {custom ? (
          <>
            <Input
              type="number"
              min={5}
              max={600}
              step={5}
              value={valueMin}
              aria-label={t.agenda.durationCustom}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) apply(next);
              }}
              className="h-9 w-24"
            />
            <span className="text-[12px] text-fg-subtle">
              {t.common.minutes}
            </span>
          </>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg-subtle">
          {t.agenda.durationEquivalent(
            pomodorosForDuration(valueMin, shape),
            formatDuration(
              sessionDurationMin(pomodorosForDuration(valueMin, shape), shape),
            ),
          )}
        </span>
      </div>
    </div>
  );
}
