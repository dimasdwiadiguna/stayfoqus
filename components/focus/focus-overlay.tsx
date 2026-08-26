"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, Pause, Play, SkipForward, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";

import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { ProgressRing, formatClock } from "@/components/focus/progress-ring";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useSettings } from "@/hooks/use-settings";
import { getDb } from "@/lib/db/client";
import { id as t } from "@/lib/i18n/id";
import { primeAudio } from "@/lib/pomodoro/audio";
import {
  completedFocusFor,
  pauseSession,
  resumeSession,
  setMinimized,
  skipPhase,
  startFocusSession,
  stopSession,
  usePomodoroStore,
} from "@/lib/pomodoro/store";
import {
  isPaused,
  progress as phaseProgress,
  remainingMs,
} from "@/lib/pomodoro/machine";
import { cn } from "@/lib/utils";

/**
 * §7.4 — the Fokus screen. A full-screen overlay, not a tab; minimising
 * collapses it into a pill above the tab bar while the timer keeps running.
 */
export function FocusOverlay() {
  const timer = usePomodoroStore((s) => s.timer);
  const now = usePomodoroStore((s) => s.now);
  const visible = usePomodoroStore((s) => s.visible);
  const minimized = usePomodoroStore((s) => s.minimized);
  const wakeLockActive = usePomodoroStore((s) => s.wakeLockActive);

  const [confirmStop, setConfirmStop] = React.useState(false);
  const phase = timer.phase;

  const agenda = useLiveQuery(
    () => (timer.agendaId ? getDb().agendas.get(timer.agendaId) : undefined),
    [timer.agendaId],
  );
  const todo = useLiveQuery(
    () => (timer.todoId ? getDb().todos.get(timer.todoId) : undefined),
    [timer.todoId],
  );

  const open = visible && !minimized && (phase !== null || timer.awaitingFocus);
  const isBreak = phase !== null && phase.kind !== "focus";
  const paused = phase !== null && isPaused(phase);

  const remaining = phase ? remainingMs(phase, now) : 0;
  const ratio = phase ? phaseProgress(phase, now) : 1;

  const title =
    agenda?.title_override ?? todo?.title ?? (timer.agendaId ? t.agenda.title : t.focus.untethered);

  const allocated = agenda?.allocated_pomodoro ?? 0;
  const sessionLabel = allocated
    ? t.focus.sessionCounter(Math.min(timer.completedFocus + 1, allocated), allocated)
    : t.focus.sessionCounterUntethered(timer.completedFocus + 1);

  const overtime = Boolean(phase?.isOvertime);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t.focus.title}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}
          className={cn(
            "fixed inset-0 z-50 flex flex-col",
            // §7.4: the break screen is visually distinct — a calmer palette.
            isBreak ? "bg-prayer/10 backdrop-blur-sm" : "bg-bg",
          )}
        >
          <div className="safe-top flex items-center justify-between px-4 py-3">
            <button
              type="button"
              aria-label={t.focus.minimized}
              onClick={() => setMinimized(true)}
              className="grid size-11 place-items-center rounded-full text-fg-muted hover:bg-surface-2"
            >
              <ChevronDown className="size-5" />
            </button>
            <span className="text-[13px] font-medium text-fg-muted">
              {isBreak
                ? phase!.kind === "long_break"
                  ? t.focus.breakLong
                  : t.focus.breakShort
                : t.focus.title}
            </span>
            <span className="size-11" />
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6">
            <ProgressRing
              progress={ratio}
              tone={overtime ? "overtime" : isBreak ? "prayer" : "accent"}
              pulse={!phase}
              label={formatClock(remaining)}
            >
              <div className="text-center">
                <div
                  className={cn(
                    "font-mono text-5xl font-semibold tabular-nums",
                    paused && "opacity-50",
                  )}
                >
                  {formatClock(remaining)}
                </div>
                {overtime ? (
                  <div className="mt-1 text-[12px] font-medium text-overtime">
                    {t.focus.overtime}
                  </div>
                ) : null}
              </div>
            </ProgressRing>

            <div className="space-y-1.5 text-center">
              <p className="text-lg font-medium">{title}</p>
              <p className="text-[13px] text-fg-muted">{sessionLabel}</p>
              {allocated > 0 ? (
                <div className="flex justify-center pt-1">
                  <PomodoroDots
                    allocated={allocated}
                    completed={timer.completedFocus}
                    running={!isBreak && phase !== null}
                    size={10}
                  />
                </div>
              ) : null}
            </div>

            {timer.awaitingFocus ? (
              <div className="space-y-3 text-center">
                <p className="text-[13px] text-fg-muted">{t.focus.breakAutoStart}</p>
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => {
                    primeAudio();
                    void (async () => {
                      const completed = timer.agendaId
                        ? await completedFocusFor(timer.agendaId)
                        : timer.completedFocus;
                      await startFocusSession({
                        agendaId: timer.agendaId,
                        todoId: timer.todoId,
                        alreadyCompleted: completed,
                        isOvertime: allocated > 0 && completed >= allocated,
                      });
                    })();
                  }}
                >
                  {t.focus.nextFocus}
                </Button>
              </div>
            ) : null}

            {overtime ? (
              <p className="max-w-xs text-center text-[12px] text-fg-subtle">
                {t.focus.overtimeHint}
              </p>
            ) : null}
            {!wakeLockActive && phase?.kind === "focus" && !paused ? (
              <p className="text-center text-[12px] text-fg-subtle">
                {t.focus.wakeLockUnavailable}
              </p>
            ) : null}
          </div>

          {phase ? (
            <div className="safe-bottom flex items-center justify-center gap-3 px-6 pb-6">
              <Button
                size="lg"
                variant="secondary"
                onClick={() => void (paused ? resumeSession() : pauseSession())}
              >
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                {paused ? t.focus.resume : t.focus.pause}
              </Button>
              <Button size="lg" variant="ghost" onClick={() => void skipPhase()}>
                <SkipForward className="size-4" />
                {t.focus.skip}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={() => setConfirmStop(true)}
                className="text-danger"
              >
                <Square className="size-4" />
                {t.focus.stop}
              </Button>
            </div>
          ) : null}

          <ConfirmDialog
            open={confirmStop}
            onOpenChange={setConfirmStop}
            title={t.focus.abortConfirmTitle}
            description={t.focus.abortConfirmBody}
            confirmLabel={t.focus.stop}
            tone="danger"
            onConfirm={() => void stopSession()}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Keeps the settings-derived config in the timer store current. */
export function usePomodoroSettingsSync() {
  const settings = useSettings();
  React.useEffect(() => {
    usePomodoroStore.getState().set({
      config: {
        focusMin: settings.pomodoro_focus_min,
        shortBreakMin: settings.pomodoro_short_break_min,
        longBreakMin: settings.pomodoro_long_break_min,
        longBreakEvery: settings.pomodoro_long_break_every,
      },
      audio: {
        ticking: settings.ticking_enabled,
        tickingVolume: settings.ticking_volume,
        bell: settings.bell_enabled,
        bellVolume: settings.bell_volume,
      },
    });
  }, [
    settings.pomodoro_focus_min,
    settings.pomodoro_short_break_min,
    settings.pomodoro_long_break_min,
    settings.pomodoro_long_break_every,
    settings.ticking_enabled,
    settings.ticking_volume,
    settings.bell_enabled,
    settings.bell_volume,
  ]);
}
