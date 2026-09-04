"use client";

import { CalendarClock, Play, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { PlanningWizard } from "@/components/planning/planning-wizard";
import { EmptyState, Screen, ScreenTitle } from "@/components/shell/screen";
import { SyncIndicator } from "@/components/shell/sync-indicator";
import { Button } from "@/components/ui/button";
import { CheckIndicator, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { usePlaceIndex } from "@/hooks/use-places";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { allocateDay, nothingToAllocate } from "@/lib/agendas/allocate-day";
import type { Agenda, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { completedFocusFor, startFocusSession } from "@/lib/pomodoro/store";
import { primeAudio } from "@/lib/pomodoro/audio";
import {
  freeMinutes,
  sessionDurationMin,
  type AllocationResult,
} from "@/lib/scheduling";
import { formatTimeRange, localDate } from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";
import { isBlocked } from "@/lib/todos/tree";
import { cn } from "@/lib/utils";

/**
 * The day as the unit of planning (D-123), in place of §7.3's weekly screen.
 *
 * It answers three questions in the order they get asked: what am I committed
 * to today, does it fit, and what do I start next. The capacity meter and the
 * allocator read the same free-space map, so "kapasitas 12 pomodoro" and what
 * "Alokasikan otomatis" can actually place cannot drift apart (D-064).
 *
 * There is no stored "target hari ini" flag. The plan *is* the day's agendas,
 * which survives closing the screen better than a checkbox would; the
 * selection below is deliberately ephemeral, because it lives only as long as
 * it takes to press Alokasikan.
 */
export function TodayScreen() {
  const router = useRouter();
  const settings = useSettings();
  const now = useNow();
  const { todos, index, counters, agendas } = useTaskData();

  const today = localDate(new Date(), settings.timezone);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<ReadonlySet<UUID>>(new Set());
  const [running, setRunning] = React.useState(false);
  const [unfit, setUnfit] = React.useState<AllocationResult["unfit"]>([]);
  const [planningOpen, setPlanningOpen] = React.useState(false);

  const world = useSchedulingWorld({ from: today, to: today });
  const places = usePlaceIndex();

  /* ---------------- today's plan ----------------------------------------- */

  const plan = React.useMemo(
    () =>
      agendas
        .filter(
          (agenda) =>
            agenda.status !== "cancelled" &&
            agenda.status !== "draft" &&
            localDate(agenda.start_at, settings.timezone) === today,
        )
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [agendas, settings.timezone, today],
  );

  const titleOf = React.useCallback(
    (agenda: Agenda) =>
      agenda.title_override ?? index.byId.get(agenda.todo_id)?.title ?? "",
    [index],
  );

  /** The one block worth a start button: the next that is not finished yet. */
  const nextAgendaId = React.useMemo(() => {
    const upcoming = plan.find(
      (agenda) =>
        agenda.status !== "done" &&
        (now === null || new Date(agenda.end_at).getTime() > now),
    );
    return upcoming?.id ?? null;
  }, [plan, now]);

  /* ---------------- candidates ------------------------------------------- */

  const scheduledToday = React.useMemo(
    () => new Set(plan.map((agenda) => agenda.todo_id)),
    [plan],
  );

  const candidates = React.useMemo(() => {
    const open = todos.filter(
      (todo) =>
        todo.status !== "done" &&
        todo.status !== "archived" &&
        !scheduledToday.has(todo.id) &&
        countersFor(counters, todo.id).remainingToAllocate > 0,
    );
    if (!query.trim()) return open.slice(0, 30);
    const q = query.toLowerCase();
    return open.filter((todo) => todo.title.toLowerCase().includes(q)).slice(0, 30);
  }, [todos, scheduledToday, counters, query]);

  /* ---------------- capacity meter --------------------------------------- */

  const capacity = React.useMemo(() => {
    const perPomodoroMin = sessionDurationMin(1, world.shape);
    // What the scheduler actually has left: availability windows minus prayer
    // blocks, existing commitments and busy time.
    const total = Math.floor(freeMinutes(world.free) / perPomodoroMin);
    const used = plan.reduce((sum, agenda) => sum + agenda.allocated_pomodoro, 0);
    const wanted =
      used +
      todos
        .filter((todo) => selected.has(todo.id))
        .reduce(
          (sum, todo) => sum + countersFor(counters, todo.id).remainingToAllocate,
          0,
        );
    return { total: total + used, used, wanted };
  }, [world.free, world.shape, plan, todos, selected, counters]);

  const over = capacity.wanted > capacity.total;

  /* ---------------- allocation ------------------------------------------- */

  const runAllocation = async () => {
    setRunning(true);
    try {
      const picked = todos.filter((todo) => selected.has(todo.id));
      if (nothingToAllocate(picked, counters)) {
        toast.show(t.today.nothingToAllocate);
        return;
      }

      const result = await allocateDay({
        picked,
        index,
        counters,
        agendas,
        world,
        places,
        settings,
        now,
      });

      setUnfit(result.unfit);
      setSelected(new Set());

      if (result.placements.length === 0) {
        toast.show(t.agenda.noSlots);
        return;
      }
      router.push("/calendar");
    } finally {
      setRunning(false);
    }
  };

  const toggle = (todoId: UUID) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });

  return (
    <Screen
      header={
        <div className="space-y-1.5">
          <ScreenTitle
            title={t.today.title}
            actions={
              <>
                <Button
                  size="iconSm"
                  variant="ghost"
                  className="tap-44"
                  aria-label={t.planning.button}
                  title={t.planning.button}
                  onClick={() => setPlanningOpen(true)}
                >
                  <CalendarClock className="size-4" />
                </Button>
                <SyncIndicator />
              </>
            }
          />
          <CapacityMeter
            used={capacity.used}
            wanted={capacity.wanted}
            total={capacity.total}
            over={over}
          />
        </div>
      }
    >
      <div className="space-y-4 px-4 py-3 pb-28">
        {/* §5.5 Step 4 — the remainder panel. */}
        {unfit.length > 0 ? (
          <section className="rounded-lg border border-warning/40 bg-warning/10 p-2.5">
            <h2 className="text-[13px] font-semibold text-warning">
              {t.today.unfitTitle(unfit.length)}
            </h2>
            <ul className="mt-1.5 space-y-0.5">
              {unfit.map((entry) => (
                <li key={entry.todo.id} className="text-[12px] text-fg-muted">
                  {entry.todo.title} · {entry.remaining} {t.common.pomodoro}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-fg-subtle">{t.today.unfitHint}</p>
          </section>
        ) : null}

        <section className="space-y-1.5">
          <h2 className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            {t.today.planSection}
          </h2>
          {plan.length === 0 ? (
            <EmptyState title={t.today.planEmpty} />
          ) : (
            <ul className="space-y-1">
              {plan.map((agenda) => (
                <PlanRow
                  key={agenda.id}
                  agenda={agenda}
                  title={titleOf(agenda)}
                  timezone={settings.timezone}
                  completed={countersFor(counters, agenda.todo_id).used}
                  startable={agenda.id === nextAgendaId}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1.5">
          <h2 className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            {t.today.candidateSection}
          </h2>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.common.search}
          />
          {candidates.length === 0 ? (
            <p className="text-[12px] text-fg-subtle">{t.today.candidateEmpty}</p>
          ) : (
            <ul className="space-y-1">
              {candidates.map((todo) => (
                <CandidateRow
                  key={todo.id}
                  todo={todo}
                  remaining={countersFor(counters, todo.id).remainingToAllocate}
                  blocked={isBlocked(index, todo)}
                  checked={selected.has(todo.id)}
                  onToggle={() => toggle(todo.id)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/*
        The primary action costs nothing until there is something to allocate,
        which is the point: a full-width button parked above an empty list is a
        row of screen spent on a disabled control.
      */}
      {selected.size > 0 ? (
        <div className="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom,0px))] z-30 mx-auto max-w-md px-4 pb-2">
          <Button
            variant="primary"
            block
            disabled={running}
            onClick={() => void runAllocation()}
          >
            <Sparkles className="size-4" />
            {running
              ? t.today.allocating
              : t.today.allocateSelected(selected.size)}
          </Button>
        </div>
      ) : null}

      <PlanningWizard
        open={planningOpen}
        onClose={() => setPlanningOpen(false)}
      />
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
      <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
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
          "text-[11px] tabular-nums",
          over ? "text-warning" : "text-fg-subtle",
        )}
      >
        {t.today.capacity(wanted, total)}
        {over ? ` · ${t.today.capacityOver}` : ""}
      </p>
    </div>
  );
}

function PlanRow({
  agenda,
  title,
  timezone,
  completed,
  startable,
}: {
  agenda: Agenda;
  title: string;
  timezone: string;
  completed: number;
  startable: boolean;
}) {
  return (
    <li
      className={cn(
        "flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5",
        agenda.status === "done" && "opacity-60",
      )}
    >
      <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
        {formatTimeRange(agenda.start_at, agenda.end_at, timezone)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
      <PomodoroDots
        allocated={agenda.allocated_pomodoro}
        completed={Math.min(completed, agenda.allocated_pomodoro)}
        running={false}
        size={6}
      />
      {startable ? (
        <Button
          size="iconSm"
          variant="primary"
          className="tap-44"
          aria-label={t.focus.start}
          title={t.focus.start}
          onClick={() => {
            // Synchronously, before any await — the unlock is only honoured
            // while the call stack still belongs to the tap (D-080).
            primeAudio();
            void (async () => {
              const done = await completedFocusFor(agenda.id);
              await startFocusSession({
                agendaId: agenda.id,
                todoId: agenda.todo_id,
                alreadyCompleted: done,
                isOvertime: done >= agenda.allocated_pomodoro,
              });
            })();
          }}
        >
          <Play className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}

function CandidateRow({
  todo,
  remaining,
  blocked,
  checked,
  onToggle,
}: {
  todo: Todo;
  remaining: number;
  blocked: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      {/*
        The whole row is the control, with the checkbox as its indicator — a
        20 px box next to a 20 px line of text is two targets that both miss
        M10's 44 px rule, and neither of them is the thing the user is aiming
        at.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={checked ? t.today.deselectTodo : t.today.selectTodo}
        className={cn(
          "flex min-h-11 w-full items-center gap-2 rounded-lg border bg-surface-2 px-2.5 py-1.5 text-left",
          checked ? "border-accent" : "border-border",
          blocked && "opacity-55",
        )}
      >
        <CheckIndicator checked={checked} />
        <span className="min-w-0 flex-1 truncate text-[13px]">{todo.title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
          {remaining}/{todo.estimated_pomodoro}
        </span>
      </button>
    </li>
  );
}
