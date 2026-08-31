"use client";

import { motion } from "motion/react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { id as t } from "@/lib/i18n/id";
import { playFanfare, primeAudio } from "@/lib/pomodoro/audio";
import { celebrate, haptic, prefersReducedMotion } from "@/lib/reward";
import { verseForDay } from "@/lib/reward/verses";

/**
 * The end of a planning session — a small win, marked as one.
 *
 * §9's rule still applies: celebration is scarce, and this is one of the few
 * moments that earns it. Finishing a plan is a real commitment, not a tap.
 *
 * Everything here respects `prefers-reduced-motion`: the confetti and the ring
 * animation are skipped, and the verse is shown immediately instead. The sound
 * is opt-out through the same bell setting as the pomodoro chime.
 */
export function PlanningCelebration({
  open,
  scheduledCount,
  date,
  soundEnabled,
  volume,
  onClose,
}: {
  open: boolean;
  scheduledCount: number;
  date: string;
  soundEnabled: boolean;
  volume: number;
  onClose: () => void;
}) {
  const verse = React.useMemo(() => verseForDay(date), [date]);
  const firedFor = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const key = `${date}:${scheduledCount}`;
    if (firedFor.current === key) return;
    firedFor.current = key;

    // The audio context was primed by the taps that got here, so this plays.
    if (soundEnabled) {
      primeAudio();
      playFanfare(volume);
    }
    haptic([14, 60, 14, 60, 22]);
    void celebrate("day-cleared");
  }, [open, date, scheduledCount, soundEnabled, volume]);

  const reduced = typeof window !== "undefined" && prefersReducedMotion();

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {open ? (
        <SheetContent
          title={t.planning.doneTitle}
          description={t.planning.doneSubtitle(scheduledCount)}
          footer={
            <Button variant="primary" block onClick={onClose}>
              {t.planning.close}
            </Button>
          }
        >
          <div className="space-y-5 pb-2 text-center">
            <motion.div
              initial={reduced ? false : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="mx-auto grid size-20 place-items-center rounded-full bg-success/15"
            >
              <motion.svg
                viewBox="0 0 24 24"
                className="size-10 text-success"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <motion.path
                  d="m4 12.5 5 5L20 6.5"
                  initial={reduced ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.45, delay: 0.12 }}
                />
              </motion.svg>
            </motion.div>

            <motion.div
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : 0.35, duration: 0.4 }}
              className="space-y-3 rounded-card border border-border bg-surface-2 px-4 py-4"
            >
              <div dir="rtl" lang="ar" className="space-y-1">
                {verse.arabic.map((line) => (
                  <p key={line} className="text-[20px] leading-[2] font-medium">
                    {line}
                  </p>
                ))}
              </div>
              <p className="text-[13px] leading-relaxed text-fg-muted">
                {verse.translation}
              </p>
              <p className="text-[12px] text-fg-subtle">QS. {verse.reference}</p>
            </motion.div>
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
