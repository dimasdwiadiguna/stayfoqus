"use client";

import { ChevronLeft, ChevronRight, Minus, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { EmptyState, Screen, ScreenTitle } from "@/components/shell/screen";
import { SyncIndicator } from "@/components/shell/sync-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { createAgenda } from "@/lib/agendas/repo";
import { newId } from "@/lib/db/mutations";
import type { Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  allocate,
  freeMinutes,
  sessionDurationMin,
  toSchedulable,
  type AllocationResult,
} from "@/lib/scheduling";
import { addWeeks, isoWeekDates, isoWeekOf, localDate } from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";
import { setFocusWeek } from "@/lib/todos/repo";
import { depthOf, isBlocked } from "@/lib/todos/tree";
import { cn } from "@/lib/utils";

/**
 * §7.3 — Pekan Ini.
 *
 * The capacity meter and the allocator both read the same free-space map, so
 * "kapasitas 48 pomodoro" and what "Alokasikan otomatis" can actually place
 * cannot drift apart.
 */
export function WeekScreen() {
  const router = useRouter();
  const settings = useSettings();
  const now = useNow();
  const { todos, index, counters, agendas } = useTaskData();

  const today = localDate(new Date(), settings.timezone);
  const [week, setWeek] = React.useState(() => isoWeekOf(today));
  const [query, setQuery] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [unfit, setUnfit] = React.useState<AllocationResult["unfit"]>([]);

  const days = React.useMemo(() => isoWeekDates(week), [week]);
  const from = days[0]!;
  const to = days[6]!;

  const world = useSchedulingWorld({ from, to });

  const targets = React.useMemo(
    () =>
      todos.filter(
        (todo) =>
          todo.focus_week === week &&
          todo.status !== "done" &&
          todo.status !== "archived",
      ),
    [todos, week],
  );

  const candidates = React.useMemo(() => {
    const open = todos.filter(
      (todo) =>
        todo.focus_week !== week &&
        todo.status !== "done" &&
        todo.status !== "archived",
    );
    if (!query.trim()) return open.slice(0, 30);
    const q = query.toLowerCase();
    return open.filter((todo) => todo.title.toLowerCase().includes(q)).slice(0, 30);
  }, [todos, week, query]);

  /* ---------------- capacity meter (§7.3) -------------------------------- */

  const capacity = React.useMemo(() => {
    const perPomodoroMin = sessionDurationMin(1, world.shape);
    // Capacity is the free space the scheduler actually has: availability
    // windows minus prayer blocks, existing commitments and busy time.
    const total = Math.floor(freeMinutes(world.free) / perPomodoroMin);
    const used = targets.reduce(
      (sum, todo) => sum + countersFor(counters, todo.id).allocated,
      0,
    );
    const wanted = targets.reduce(
      (sum, todo) => sum + todo.estimated_pomodoro,
      0,
    );
    return { total, used, wanted };
  }, [world.free, world.shape, targets, counters]);

  /* ---------------- draft state ------------------------------------------ */

  const [drafts, setDrafts] = React.useState<UUID[]>([]);

  const runAllocation = async () => {
    setRunning(true);
    try {
      const schedulable = targets.map((todo) =>
        toSchedulable(
          todo,
          countersFor(counters, todo.id).remainingToAllocate,
          isBlocked(index, todo),
          depthOf(index, todo.id),
        ),
      );

      // A parent must not start before its children — including children whose
      // agendas already exist outside this run.
      const existingEndByTodo = new Map<string, number>();
      for (const agenda of agendas) {
        if (agenda.status === "cancelled") continue;
        const end = new Date(agenda.end_at).getTime();
        existingEndByTodo.set(
          agenda.todo_id,
          Math.max(existingEndByTodo.get(agenda.todo_id) ?? -Infinity, end),
        );
      }

      if (schedulable.every((s) => s.remainingToAllocate === 0)) {
        toast.show(t.week.nothingToAllocate);
        return;
      }

      const result = allocate({
        todos: schedulable,
        free: world.free,
        timeBlocks: world.timeBlocks,
        shape: world.shape,
        buffers: world.buffers,
        notBefore: now ?? undefined,
        existingEndByTodo,
        newId,
      });

      // §5.5 Step 5: everything lands as a draft, previewed on the calendar.
      for (const placement of result.placements) {
        await createAgenda(
          {
            id: placement.id,
            todo_id: placement.todoId,
            start_at: new Date(placement.start).toISOString(),
            end_at: new Date(placement.end).toISOString(),
            allocated_pomodoro: placement.pomodoros,
            status: "draft",
          },
          settings,
        );
      }

      setDrafts(result.placements.map((p) => p.id));
      setUnfit(result.unfit);

      if (result.placements.length === 0) {
        toast.show(t.agenda.noSlots);
        return;
      }
      // Drop the user into the calendar in draft-preview mode (§7.3).
      router.push("/calendar");
    } finally {
      setRunning(false);
    }
  };

  const over = capacity.wanted > capacity.total;

  return (
    <Screen
      header={
        <div className="space-y-2">
          <ScreenTitle title={t.week.title} actions={<SyncIndicator />} />
          <div className="flex items-center gap-1">
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.common.back}
              onClick={() => setWeek((w) => addWeeks(w, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium text-fg-muted">
              {t.week.weekLabel(week)}
            </span>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.common.confirm}
              onClick={() => setWeek((w) => addWeeks(w, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <CapacityMeter
            used={capacity.used}
            wanted={capacity.wanted}
            total={capacity.total}
            over={over}
          />
        </div>
      }
    >
      <div className="space-y-5 px-4 py-4 pb-28">
        <Button
          variant="primary"
          block
          size="lg"
          disabled={running || targets.length === 0}
          onClick={() => void runAllocation()}
        >
          <Sparkles className="size-4" />
          {running ? t.week.allocating : t.week.allocate}
        </Button>

        {drafts.length > 0 ? (
          <p className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[13px] text-accent">
            {t.week.applyDrafts(drafts.length)}
          </p>
        ) : null}

        {/* §5.5 Step 4 — the remainder panel. */}
        {unfit.length > 0 ? (
          <section className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <h2 className="text-[14px] font-semibold text-warning">
              {t.week.unfitTitle(unfit.length)}
            </h2>
            <ul className="mt-2 space-y-1">
              {unfit.map((entry) => (
                <li key={entry.todo.id} className="text-[13px] text-fg-muted">
                  {entry.todo.title} · {entry.remaining} {t.common.pomodoro}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-fg-subtle">{t.week.unfitHint}</p>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-fg-subtle uppercase">
            {t.week.targetSection}
          </h2>
          {targets.length === 0 ? (
            <EmptyState title={t.week.targetEmpty} />
          ) : (
            <ul className="space-y-1.5">
              {targets.map((todo) => (
                <WeekRow
                  key={todo.id}
                  todo={todo}
                  remaining={countersFor(counters, todo.id).remainingToAllocate}
                  blocked={isBlocked(index, todo)}
                  inWeek
                  onToggle={() => void setFocusWeek(todo.id, null)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold tracking-wide text-fg-subtle uppercase">
            {t.week.candidateSection}
          </h2>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.common.search}
          />
          {candidates.length === 0 ? (
            <p className="text-[13px] text-fg-subtle">{t.week.candidateEmpty}</p>
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((todo) => (
                <WeekRow
                  key={todo.id}
                  todo={todo}
                  remaining={countersFor(counters, todo.id).remainingToAllocate}
                  blocked={isBlocked(index, todo)}
                  inWeek={false}
                  onToggle={() => void setFocusWeek(todo.id, week)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}

function CapacityMeter({
  used,
  wanted,
  total,
  over,
}: {
  used: number;
  wanted: number;
  total: number;
  over: boolean;
}) {
  const pct = total > 0 ? Math.min(1, wanted / total) : 0;
  const usedPct = total > 0 ? Math.min(1, used / total) : 0;

  return (
    <div className="space-y-1">
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            over ? "bg-warning/40" : "bg-accent/35",
          )}
          style={{ width: `${pct * 100}%` }}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            over ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${usedPct * 100}%` }}
        />
      </div>
      <p
        className={cn(
          "text-[12px] tabular-nums",
          over ? "text-warning" : "text-fg-subtle",
        )}
      >
        {t.week.capacity(wanted, total)}
        {over ? ` · ${t.week.capacityOver}` : ""}
      </p>
    </div>
  );
}

function WeekRow({
  todo,
  remaining,
  blocked,
  inWeek,
  onToggle,
}: {
  todo: Todo;
  remaining: number;
  blocked: boolean;
  inWeek: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2",
        blocked && "opacity-55",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[15px]">{todo.title}</span>
      <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
        {remaining}/{todo.estimated_pomodoro}
      </span>
      <Button
        size="iconSm"
        variant="ghost"
        aria-label={inWeek ? t.week.removeFromWeek : t.week.addToWeek}
        onClick={onToggle}
      >
        {inWeek ? <Minus className="size-4" /> : <Plus className="size-4" />}
      </Button>
    </li>
  );
}
