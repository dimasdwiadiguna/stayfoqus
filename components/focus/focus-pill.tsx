"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { motion } from "motion/react";

import { formatClock } from "@/components/focus/progress-ring";
import { getDb } from "@/lib/db/client";
import { id as t } from "@/lib/i18n/id";
import { isPaused, remainingMs } from "@/lib/pomodoro/machine";
import { setMinimized, usePomodoroStore } from "@/lib/pomodoro/store";
import { cn } from "@/lib/utils";

/**
 * §7.4 — "When minimized it collapses into a floating pill above the tab bar
 * showing the remaining time and the task title; tapping it restores the full
 * view. The timer keeps running regardless."
 */
export function FocusPill() {
  const timer = usePomodoroStore((s) => s.timer);
  const now = usePomodoroStore((s) => s.now);
  const minimized = usePomodoroStore((s) => s.minimized);
  const visible = usePomodoroStore((s) => s.visible);

  const todo = useLiveQuery(
    () => (timer.todoId ? getDb().todos.get(timer.todoId) : undefined),
    [timer.todoId],
  );

  const phase = timer.phase;
  const show = minimized && visible && (phase !== null || timer.awaitingFocus);
  if (!show) return null;

  const paused = phase !== null && isPaused(phase);
  const isBreak = phase !== null && phase.kind !== "focus";
  const remaining = phase ? remainingMs(phase, now) : 0;

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => setMinimized(false)}
      aria-label={t.focus.minimized}
      className={cn(
        "fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-full border px-4 py-2.5 shadow-lg backdrop-blur",
        isBreak
          ? "border-prayer/40 bg-prayer/15"
          : "border-accent/40 bg-accent-soft",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          paused ? "bg-fg-subtle" : isBreak ? "bg-prayer" : "animate-pulse bg-accent",
        )}
      />
      <span className="font-mono text-[15px] font-semibold tabular-nums">
        {timer.awaitingFocus ? "--:--" : formatClock(remaining)}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-[13px] text-fg-muted">
        {timer.awaitingFocus
          ? t.focus.nextFocus
          : (todo?.title ?? t.focus.untethered)}
      </span>
    </motion.button>
  );
}
