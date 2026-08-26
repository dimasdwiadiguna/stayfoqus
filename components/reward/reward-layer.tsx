"use client";

import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";

import { ConfirmDialog } from "@/components/ui/dialog";
import { DayCompleteSheet } from "@/components/reward/day-complete";
import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { getDb } from "@/lib/db/client";
import type { PomodoroLog, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { isDayCleared, shouldPromptTodoDone } from "@/lib/agendas/coupling";
import { celebrate } from "@/lib/reward";
import { localDate } from "@/lib/time";
import { completeTodo } from "@/lib/todos/repo";

/**
 * §5.9 and §9, mounted once above the tabs.
 *
 * Both prompts fire *once*, so each keeps a record of what it has already
 * asked about. Those records are the only state here — everything shown is
 * derived from the live data during render, never pushed into state from an
 * effect, so a change in the database cannot produce a cascading re-render.
 * The records are per-device and deliberately not synced: UI nicety, not data.
 */
export function RewardLayer() {
  const settings = useSettings();
  const now = useNow();
  const today = localDate(new Date(), settings.timezone);

  const [answered, setAnswered] = React.useState<ReadonlySet<UUID>>(
    () => new Set(),
  );
  const [dayDismissed, setDayDismissed] = React.useState<string | null>(null);

  const agendas = useLiveQuery(() => getDb().agendas.toArray(), []);
  const todos = useLiveQuery(() => getDb().todos.toArray(), []);
  const logs = useLiveQuery(() => getDb().pomodoro_logs.toArray(), []);

  /* ---------------- §5.9 "Todo sudah selesai?" --------------------------- */

  const candidate: Todo | null = React.useMemo(() => {
    if (!agendas || !todos || !logs || now === null) return null;

    const logsByAgenda = new Map<UUID, PomodoroLog[]>();
    for (const log of logs) {
      if (log.deleted_at || !log.agenda_id) continue;
      const bucket = logsByAgenda.get(log.agenda_id);
      if (bucket) bucket.push(log);
      else logsByAgenda.set(log.agenda_id, [log]);
    }

    for (const todo of todos) {
      if (answered.has(todo.id)) continue;
      const own = agendas.filter((a) => a.todo_id === todo.id);
      if (own.length === 0) continue;

      const ownLogs = own.flatMap((a) => logsByAgenda.get(a.id) ?? []);
      if (shouldPromptTodoDone({ todo, agendas: own, logs: ownLogs, now })) {
        return todo;
      }
    }
    return null;
  }, [agendas, todos, logs, now, answered]);

  const dismissCandidate = () => {
    if (candidate) setAnswered((prev) => new Set(prev).add(candidate.id));
  };

  /* ---------------- §9 "Hari Selesai" ------------------------------------ */

  const dayCleared = React.useMemo(() => {
    if (!agendas || now === null) return false;
    const todays = agendas.filter(
      (a) => !a.deleted_at && localDate(a.start_at, settings.timezone) === today,
    );
    return isDayCleared(todays);
  }, [agendas, now, today, settings.timezone]);

  const dayOpen = dayCleared && dayDismissed !== today;

  // §9: confetti is scarce — clearing every agenda for the day earns it.
  // Firing it is a genuine external side effect, so it does belong in an
  // effect; the ref keeps it to once per day.
  const celebratedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!dayOpen || celebratedFor.current === today) return;
    celebratedFor.current = today;
    void celebrate("day-cleared");
  }, [dayOpen, today]);

  return (
    <>
      <ConfirmDialog
        open={candidate !== null}
        onOpenChange={(open) => !open && dismissCandidate()}
        title={candidate ? t.missed.todoDoneQuestion(candidate.title) : ""}
        confirmLabel={t.missed.todoDoneYes}
        cancelLabel={t.missed.todoDoneNo}
        onConfirm={() => {
          if (candidate) void completeTodo(candidate.id);
        }}
      />

      <DayCompleteSheet
        open={dayOpen}
        date={today}
        onClose={() => setDayDismissed(today)}
      />
    </>
  );
}
