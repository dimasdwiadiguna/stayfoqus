"use client";

import { Button } from "@/components/ui/button";
import { id as t } from "@/lib/i18n/id";

/**
 * "Berapa pomodoro yang terpakai?" — the one control two sheets ask it with.
 *
 * `CompletionPrompt` (§5.9 / D-084) and the missed-agenda review (§5.8) each
 * had their own copy of this, identical but for a font size, which is two
 * places for the clamp at zero to drift apart. The minus stops at zero because
 * a negative count is not an answer; there is no ceiling worth enforcing, since
 * a long day is a real answer.
 */
export function PomodoroCountStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-5 py-5">
      <Button
        size="icon"
        aria-label={t.common.decrease}
        disabled={value === 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        −
      </Button>
      <span className="w-16 text-center text-4xl font-semibold tabular-nums">
        {value}
      </span>
      <Button
        size="icon"
        aria-label={t.common.increase}
        onClick={() => onChange(Math.min(99, value + 1))}
      >
        +
      </Button>
    </div>
  );
}
