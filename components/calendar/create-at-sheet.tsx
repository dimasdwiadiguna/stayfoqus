"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { createAgenda } from "@/lib/agendas/repo";
import type { IsoDate, Todo } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import { sessionDurationMin } from "@/lib/scheduling";
import { countersFor } from "@/lib/todos/derived";
import { formatDateWithWeekday, localTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface CreateAtRequest {
  date: IsoDate;
  startMs: number;
  /** True when the long-press landed outside an availability window (§5.1). */
  outsideWindow: boolean;
}

/**
 * §8: "long-press empty area → Create an agenda … starting there."
 *
 * The time is already chosen by the gesture, so the only question left is which
 * todo this hour belongs to. Blocked todos are listed but dimmed — §5.1 allows
 * manual scheduling of a blocked todo, unlike smart allocation.
 */
export function CreateAtSheet({
  request,
  onClose,
}: {
  request: CreateAtRequest | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(request)} onOpenChange={(open) => !open && onClose()}>
      {request ? (
        // Keyed on the chosen instant so each long-press opens a fresh sheet
        // rather than resetting state from inside an effect.
        <CreateAtBody
          key={request.startMs}
          request={request}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function CreateAtBody({
  request,
  onClose,
}: {
  request: CreateAtRequest;
  onClose: () => void;
}) {
  const settings = useSettings();
  const { todos, index, counters } = useTaskData();
  const [query, setQuery] = React.useState("");
  const [pomodoros, setPomodoros] = React.useState(1);

  const candidates = React.useMemo(() => {
    const open = todos.filter(
      (todo) => todo.status !== "done" && todo.status !== "archived",
    );
    if (!query.trim()) {
      // Default order: the todos that still need allocating, most first.
      return [...open]
        .sort(
          (a, b) =>
            countersFor(counters, b.id).remainingToAllocate -
            countersFor(counters, a.id).remainingToAllocate,
        )
        .slice(0, 12);
    }
    const q = query.toLowerCase();
    return open
      .filter((todo) => todo.title.toLowerCase().includes(q))
      .slice(0, 12);
  }, [todos, query, counters]);

  const commit = async (todo: Todo) => {
    const shape = {
      focusMin: settings.pomodoro_focus_min,
      shortBreakMin: settings.pomodoro_short_break_min,
    };
    const end = request.startMs + sessionDurationMin(pomodoros, shape) * 60_000;
    await createAgenda(
      {
        todo_id: todo.id,
        start_at: new Date(request.startMs).toISOString(),
        end_at: new Date(end).toISOString(),
        allocated_pomodoro: pomodoros,
        outside_window: request.outsideWindow,
      },
      settings,
    );
    haptic();
    toast.success(t.agenda.scheduled);
    onClose();
  };

  return (
    <SheetContent
      title={t.calendar.newAgenda}
      description={`${formatDateWithWeekday(request.date)} · ${localTime(
        new Date(request.startMs),
        settings.timezone,
      )}`}
    >
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-fg-muted">
            {t.agenda.fieldAllocated}
          </span>
          <Button
            size="iconSm"
            aria-label="-"
            onClick={() => setPomodoros((n) => Math.max(1, n - 1))}
          >
            −
          </Button>
          <span className="w-8 text-center text-[15px] font-semibold tabular-nums">
            {pomodoros}
          </span>
          <Button
            size="iconSm"
            aria-label="+"
            onClick={() => setPomodoros((n) => Math.min(8, n + 1))}
          >
            +
          </Button>
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
        />

        {candidates.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t.tasks.emptyFiltered}</p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border">
            {candidates.map((todo) => {
              const blocked = index.byId.has(todo.id)
                ? todo.blocked_by.some((depId) => {
                    const dep = index.byId.get(depId);
                    return dep && dep.status !== "done" && !dep.deleted_at;
                  })
                : false;
              const remaining = countersFor(
                counters,
                todo.id,
              ).remainingToAllocate;
              return (
                <li key={todo.id}>
                  <button
                    type="button"
                    onClick={() => void commit(todo)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-2 border-b border-border/60 px-3 text-left last:border-b-0 hover:bg-surface-2",
                      blocked && "opacity-55",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[15px]">
                      {todo.title}
                    </span>
                    {remaining > 0 ? (
                      <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[11px] font-semibold text-accent">
                        {remaining}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SheetContent>
  );
}
