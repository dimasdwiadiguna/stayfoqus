"use client";

import { Flame } from "lucide-react";
import * as React from "react";

import { ProgressRing } from "@/components/focus/progress-ring";
import { useSettings } from "@/hooks/use-settings";
import { useAgendas, usePomodoroLogs } from "@/hooks/use-tasks";
import { id as t } from "@/lib/i18n/id";
import { addDays, localDate } from "@/lib/time";
import { countsAsUsed } from "@/lib/todos/derived";

/**
 * §7.1 header + §9 rewards: today's progress ring (pomodoros used / allocated)
 * and the streak counter.
 */
export function TodayHeader() {
  const settings = useSettings();
  const agendas = useAgendas();
  const logs = usePomodoroLogs();
  const timezone = settings.timezone;
  const today = localDate(new Date(), timezone);

  const allocated = React.useMemo(
    () =>
      agendas
        .filter(
          (a) =>
            a.status !== "cancelled" &&
            a.status !== "draft" &&
            localDate(a.start_at, timezone) === today,
        )
        .reduce((sum, a) => sum + a.allocated_pomodoro, 0),
    [agendas, timezone, today],
  );

  const used = React.useMemo(
    () =>
      logs.filter(
        (log) => countsAsUsed(log) && localDate(log.started_at, timezone) === today,
      ).length,
    [logs, timezone, today],
  );

  const streak = React.useMemo(
    () => computeStreak(logs, timezone, today),
    [logs, timezone, today],
  );

  const ratio = allocated > 0 ? used / allocated : used > 0 ? 1 : 0;

  return (
    <div className="flex items-center gap-3">
      <ProgressRing
        progress={ratio}
        size={34}
        stroke={3.5}
        tone={used >= allocated && allocated > 0 ? "success" : "accent"}
        label={t.reward.progressToday(used, allocated)}
      >
        <span className="text-[10px] font-semibold tabular-nums">{used}</span>
      </ProgressRing>

      <span className="text-[11px] tabular-nums text-fg-subtle">
        {t.reward.progressToday(used, allocated)}
      </span>

      {/* §9: display the streak plainly. No guilt messaging when it breaks. */}
      <span
        className="ml-auto inline-flex items-center gap-1 text-[11px] tabular-nums text-fg-subtle"
        title={streak > 0 ? t.reward.streak(streak) : t.reward.streakZero}
      >
        <Flame className="size-3.5" aria-hidden />
        {streak}
      </span>
    </div>
  );
}

/**
 * §9 — "consecutive days with ≥1 completed pomodoro".
 *
 * Today not having one yet does not break the streak: the day is not over.
 * The walk therefore starts at yesterday unless today already counts.
 */
export function computeStreak(
  logs: readonly { started_at: string; type: string; outcome: string; deleted_at: string | null }[],
  timezone: string,
  today: string,
): number {
  const days = new Set<string>();
  for (const log of logs) {
    if (log.deleted_at || log.type !== "focus" || log.outcome !== "completed") {
      continue;
    }
    days.add(localDate(log.started_at, timezone));
  }

  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
