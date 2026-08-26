"use client";

import * as React from "react";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-settings";
import { useAgendas, useCategories, usePomodoroLogs, useTodos } from "@/hooks/use-tasks";
import { computeStreak } from "@/components/tasks/today-header";
import type { IsoDate } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { summariseDay } from "@/lib/agendas/coupling";
import { formatDateFull, localDate } from "@/lib/time";

/**
 * §9 — the "Hari Selesai" screen: pomodoro total, top category, streak, and one
 * honest line of encouragement.
 *
 * The line is picked deterministically from the date so re-opening the sheet
 * does not reshuffle it — a message that changes under you reads as noise.
 */
export function DayCompleteSheet({
  open,
  date,
  onClose,
}: {
  open: boolean;
  date: IsoDate;
  onClose: () => void;
}) {
  const settings = useSettings();
  const agendas = useAgendas();
  const logs = usePomodoroLogs();
  const todos = useTodos();
  const categories = useCategories();

  const timezone = settings.timezone;

  const { summary, streak } = React.useMemo(() => {
    const todaysAgendas = agendas.filter(
      (a) => localDate(a.start_at, timezone) === date,
    );
    const todaysLogs = logs.filter(
      (log) => localDate(log.started_at, timezone) === date,
    );
    const todosById = new Map(todos.map((todo) => [todo.id, todo]));
    return {
      summary: summariseDay(todaysAgendas, todaysLogs, todosById),
      streak: computeStreak(logs, timezone, date),
    };
  }, [agendas, logs, todos, timezone, date]);

  const topCategory = summary.topCategoryId
    ? categories.find((c) => c.id === summary.topCategoryId)
    : undefined;

  const encouragement =
    t.reward.encouragement[
      dayHash(date) % t.reward.encouragement.length
    ] ?? t.reward.encouragement[0]!;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        title={t.reward.dayCompleteTitle}
        description={t.reward.dayCompleteSubtitle}
        footer={
          <Button variant="primary" block onClick={onClose}>
            {t.common.close}
          </Button>
        }
      >
        <div className="space-y-4 pb-2 text-center">
          <p className="text-[13px] text-fg-subtle">{formatDateFull(date)}</p>

          <div className="text-5xl font-semibold tabular-nums text-accent">
            {summary.pomodoroTotal}
          </div>
          <p className="text-[13px] text-fg-muted">
            {t.reward.totalPomodoro(summary.pomodoroTotal)} ·{" "}
            {t.calendar.agendaCount(summary.agendaCount)}
          </p>

          <div className="grid grid-cols-2 gap-2 text-left">
            <Stat
              label={t.reward.topCategory}
              value={topCategory?.name ?? t.common.none}
              color={topCategory?.color}
            />
            <Stat
              label={t.reward.streak(streak)}
              value={streak > 0 ? String(streak) : t.reward.streakZero}
            />
          </div>

          <p className="pt-1 text-[14px] leading-relaxed text-fg">{encouragement}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] tracking-wide text-fg-subtle uppercase">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[15px] font-medium">
        {color ? (
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : null}
        {value}
      </div>
    </div>
  );
}

/** Stable per-date index into the encouragement list. */
function dayHash(date: IsoDate): number {
  let hash = 0;
  for (let i = 0; i < date.length; i += 1) {
    hash = (hash * 31 + date.charCodeAt(i)) >>> 0;
  }
  return hash;
}
