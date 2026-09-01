"use client";

import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Interval, PrayerAvoidance } from "@/lib/scheduling";
import { id as t } from "@/lib/i18n/id";
import { localTime } from "@/lib/time";

/**
 * §5.3 — what to do about a placement that lands on a prayer block.
 *
 * The brief asks for a confirmation, which is a yes/no about breaking something
 * the user does not want broken. The useful question is *where else*, so the two
 * concrete answers come first: keep the length, finish before it, or start after
 * it. Both are computed by `avoidPrayer` and only offered when they genuinely
 * fit, so tapping one can never produce a second conflict.
 *
 * Placing over the prayer anyway stays available — §5.3 makes this a soft
 * constraint for manual placement, and the user knows things the app does not.
 * When neither side fits, that soft confirmation is all there is to show.
 */
export function PrayerShiftDialog({
  avoidance,
  timezone,
  onOpenChange,
  onShift,
  onKeep,
}: {
  avoidance: PrayerAvoidance | null;
  timezone: string;
  onOpenChange: (open: boolean) => void;
  onShift: (interval: Interval) => void;
  onKeep: () => void;
}) {
  const range = (interval: Interval) =>
    `${localTime(new Date(interval.start), timezone)}–${localTime(
      new Date(interval.end),
      timezone,
    )}`;

  const prayerName = avoidance
    ? t.settings.prayerNames[avoidance.prayer.key]
    : "";
  const hasOption = Boolean(avoidance?.earlier || avoidance?.later);

  return (
    <Dialog open={avoidance !== null} onOpenChange={onOpenChange}>
      <DialogContent
        title={t.calendar.prayerShiftTitle(prayerName)}
        description={
          hasOption
            ? t.calendar.prayerShiftBody
            : t.calendar.prayerNoSlot(prayerName)
        }
      >
        {hasOption ? (
          <div className="mt-3 space-y-2">
            {avoidance?.earlier ? (
              <Button
                block
                variant="primary"
                onClick={() => {
                  onShift(avoidance.earlier!);
                  onOpenChange(false);
                }}
              >
                <ArrowUp className="size-4" />
                {t.calendar.prayerShiftEarlier(range(avoidance.earlier))}
              </Button>
            ) : null}
            {avoidance?.later ? (
              <Button
                block
                variant="primary"
                onClick={() => {
                  onShift(avoidance.later!);
                  onOpenChange(false);
                }}
              >
                <ArrowDown className="size-4" />
                {t.calendar.prayerShiftLater(range(avoidance.later))}
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" block onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            variant={hasOption ? "outline" : "primary"}
            block
            onClick={() => {
              onKeep();
              onOpenChange(false);
            }}
          >
            {t.calendar.prayerKeep}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
