"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

import { AgendaSheet } from "@/components/calendar/agenda-sheet";
import {
  CreateAtSheet,
  type CreateAtRequest,
} from "@/components/calendar/create-at-sheet";
import { DraftBar } from "@/components/calendar/draft-bar";
import { TimelineScrollContext } from "@/components/calendar/scroll-context";
import { HourGutter, TimelineDay } from "@/components/calendar/timeline";
import { EmptyState, Screen, ScreenTitle } from "@/components/shell/screen";
import { SyncIndicator } from "@/components/shell/sync-indicator";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import {
  completedFocusFor,
  startFocusSession,
  usePomodoroStore,
} from "@/lib/pomodoro/store";
import { primeAudio } from "@/lib/pomodoro/audio";
import { usePomodoroLogs, useTaskData } from "@/hooks/use-tasks";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { deleteAgenda, restoreAgenda, updateAgenda } from "@/lib/agendas/repo";
import { toggleSkip } from "@/lib/timeblocks/repo";
import { HOUR_HEIGHT, instantForPx } from "@/lib/calendar/geometry";
import type { Agenda, IsoDate, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  freeMinutes,
  isInsideWindow,
  violatedBlock,
  buildFreeSpace,
} from "@/lib/scheduling";
import {
  addDays,
  formatDateFull,
  formatDateWithWeekday,
  formatHoursDecimal,
  localDate,
  formatTimeRange,
} from "@/lib/time";
import { countsAsUsed } from "@/lib/todos/derived";
import { childrenBlockingStart, earliestStartFor } from "@/lib/todos/ordering";
import { cn } from "@/lib/utils";

type CalendarView = "day" | "three" | "list";

const LIST_HORIZON_DAYS = 14;

type PendingMove = {
  agenda: Agenda;
  start: number;
  end: number;
  reason: "outside-window" | "time-block";
  blockName?: string;
} | null;

export function CalendarScreen() {
  const settings = useSettings();
  const today = localDate(new Date(), settings.timezone);

  const [view, setView] = React.useState<CalendarView>("day");
  const [anchor, setAnchor] = React.useState<IsoDate>(today);
  const [openAgendaId, setOpenAgendaId] = React.useState<UUID | null>(null);
  const [pendingMove, setPendingMove] = React.useState<PendingMove>(null);
  const [createAt, setCreateAt] = React.useState<CreateAtRequest | null>(null);
  const nowMs = useNow();
  const runningAgendaId = usePomodoroStore((s) => s.timer.agendaId);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrolledFor = React.useRef<string>("");

  const days: IsoDate[] =
    view === "three"
      ? [anchor, addDays(anchor, 1), addDays(anchor, 2)]
      : [anchor];

  const rangeTo =
    view === "list"
      ? addDays(anchor, LIST_HORIZON_DAYS)
      : days[days.length - 1]!;
  const world = useSchedulingWorld({
    from: anchor,
    to: rangeTo,
    includeDraftAgendas: true,
  });

  const { todos, agendas, index } = useTaskData();
  const logs = usePomodoroLogs();
  const todosById = React.useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos],
  );

  const completedByAgenda = React.useMemo(() => {
    const map = new Map<UUID, number>();
    for (const log of logs) {
      if (!countsAsUsed(log) || !log.agenda_id) continue;
      map.set(log.agenda_id, (map.get(log.agenda_id) ?? 0) + 1);
    }
    return map;
  }, [logs]);

  /** §7.2: auto-scroll to the current hour on open. */
  React.useEffect(() => {
    if (view === "list") return;
    const key = `${view}:${anchor}`;
    if (scrolledFor.current === key) return;

    const target = anchor === today ? new Date().getHours() : 7;
    const top = Math.max(0, (target - 1) * HOUR_HEIGHT);

    // The pane's height comes from flex layout, which is not resolved on the
    // first commit — assigning scrollTop then would clamp to 0. Retry on the
    // next frames until the element can actually hold the offset.
    let frame = 0;
    let attempts = 0;
    const apply = () => {
      const el = scrollRef.current;
      if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
        el.scrollTop = top;
        scrolledFor.current = key;
        return;
      }
      if (attempts++ < 20) frame = requestAnimationFrame(apply);
    };
    frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [view, anchor, today]);

  const agendasForDay = React.useCallback(
    (date: IsoDate) =>
      agendas.filter(
        (agenda) => localDate(agenda.start_at, settings.timezone) === date,
      ),
    [agendas, settings.timezone],
  );

  /* ---------------- day header totals (§7.2) ----------------------------- */

  const headerTotals = React.useMemo(() => {
    const list = agendasForDay(anchor).filter((a) => a.status !== "cancelled");
    const allocated = list.reduce((sum, a) => sum + a.allocated_pomodoro, 0);
    const dayWindows = world.windows.filter((w) => w.date === anchor);
    const dayStart = dayWindows[0]?.start ?? 0;
    const dayEnd = dayWindows[dayWindows.length - 1]?.end ?? 0;
    const dayBusy = world.busy.filter(
      (b) => b.end > dayStart && b.start < dayEnd,
    );
    // "Free hours remaining" is the net figure: windows minus every obstacle.
    const free = buildFreeSpace(dayWindows, dayBusy);
    return { count: list.length, allocated, freeMin: freeMinutes(free) };
  }, [agendasForDay, anchor, world.windows, world.busy]);

  /* ---------------- move / resize (§5.1, §5.4 soft confirmations) -------- */

  const commitMove = async (
    agenda: Agenda,
    start: number,
    end: number,
    outside: boolean,
  ) => {
    await updateAgenda(agenda.id, {
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      outside_window: outside,
    });
  };

  const requestMove = (agenda: Agenda, start: number, end: number) => {
    const interval = { start, end };
    const todo = todosById.get(agenda.todo_id);

    // A parent may not start before its children. Unlike the window and
    // time-block rules this is not a confirmation — a parent that begins
    // before its own subtasks is incoherent, not merely unusual.
    const childFloor = earliestStartFor(index, agenda.todo_id, agendas);
    if (start < childFloor) {
      const blockers = childrenBlockingStart(
        index,
        agenda.todo_id,
        agendas,
        start,
      );
      toast.error(t.agenda.parentBeforeChild(blockers.map((c) => c.title)));
      return;
    }

    if (!isInsideWindow(interval, world.windows)) {
      setPendingMove({ agenda, start, end, reason: "outside-window" });
      return;
    }
    const violated = todo
      ? violatedBlock(
          {
            categoryId: todo.category_id,
            tags: todo.tags,
            priority: todo.priority,
          },
          interval,
          world.timeBlocks,
        )
      : null;
    if (violated) {
      setPendingMove({
        agenda,
        start,
        end,
        reason: "time-block",
        blockName: violated.name,
      });
      return;
    }
    void commitMove(agenda, start, end, false);
  };

  const onMoveAgenda = (agenda: Agenda, startMs: number) => {
    const duration =
      new Date(agenda.end_at).getTime() - new Date(agenda.start_at).getTime();
    requestMove(agenda, startMs, startMs + duration);
  };

  const onResizeAgenda = (agenda: Agenda, endMs: number) => {
    const startMs = new Date(agenda.start_at).getTime();
    if (endMs <= startMs) return;
    requestMove(agenda, startMs, endMs);
  };

  const onDeleteAgenda = async (agenda: Agenda) => {
    const removed = await deleteAgenda(agenda.id);
    if (!removed) return;
    setOpenAgendaId(null);
    toast.undoable(t.agenda.deleted, () => void restoreAgenda(agenda.id));
  };

  /* ---------------- swipe between days (§8) ------------------------------ */

  const swipeRef = React.useRef<{ x: number; y: number } | null>(null);

  const step = view === "three" ? 3 : 1;

  return (
    <Screen
      header={
        <div className="space-y-2">
          <ScreenTitle title={t.calendar.title} actions={<SyncIndicator />} />

          <div className="flex items-center gap-1">
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.common.back}
              onClick={() => setAnchor((d) => addDays(d, -step))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-center text-[13px] font-medium text-fg-muted">
              {formatDateFull(anchor)}
            </span>
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.calendar.now}
              onClick={() => setAnchor((d) => addDays(d, step))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={anchor === today ? "secondary" : "outline"}
              onClick={() => setAnchor(today)}
            >
              {t.common.today}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Segmented
              ariaLabel={t.calendar.title}
              value={view}
              onChange={setView}
              options={[
                { value: "day", label: t.calendar.viewDay },
                { value: "three", label: t.calendar.view3Day },
                { value: "list", label: t.calendar.viewList },
              ]}
            />
            {view !== "list" ? (
              <span className="shrink-0 text-right text-[11px] leading-tight tabular-nums text-fg-subtle">
                {t.calendar.agendaCount(headerTotals.count)} ·{" "}
                {t.calendar.allocatedPomodoro(headerTotals.allocated)}
                <br />
                {t.calendar.freeHours(formatHoursDecimal(headerTotals.freeMin))}
              </span>
            ) : null}
          </div>
        </div>
      }
      // The timeline pane owns its scrolling; only the list view uses the
      // standard screen scroller.
      scroll={view === "list"}
      contentClassName="no-scrollbar"
    >
      {view === "list" ? (
        <AgendaList
          from={anchor}
          to={rangeTo}
          agendas={agendas}
          timezone={settings.timezone}
          todosById={todosById}
          onOpen={(agenda) => setOpenAgendaId(agenda.id)}
        />
      ) : (
        <div
          ref={scrollRef}
          className="no-scrollbar h-full overflow-y-auto overscroll-contain"
          onPointerDown={(e) => {
            swipeRef.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => {
            const origin = swipeRef.current;
            swipeRef.current = null;
            if (!origin) return;
            const dx = e.clientX - origin.x;
            const dy = e.clientY - origin.y;
            // Horizontal swipe on the canvas → previous / next day (§8).
            if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
              setAnchor((d) => addDays(d, dx < 0 ? step : -step));
            }
          }}
        >
          <TimelineScrollContext.Provider value={scrollRef}>
            <div className="flex">
              <HourGutter />
              {days.map((date) => (
                <div
                  key={date}
                  className="min-w-0 flex-1 border-r border-border/60"
                >
                  {view === "three" ? (
                    <div className="sticky top-0 z-30 border-b border-border bg-bg/95 py-1 text-center text-[11px] font-medium backdrop-blur">
                      {formatDateWithWeekday(date)}
                    </div>
                  ) : null}
                  <TimelineDay
                    date={date}
                    timezone={settings.timezone}
                    windows={world.windows.filter((w) => w.date === date)}
                    timeBlocks={world.timeBlocks.filter((b) => b.date === date)}
                    busy={world.busy.filter((b) => b.source === "gcal_busy")}
                    prayers={world.prayers.filter((p) => p.date === date)}
                    agendas={agendasForDay(date)}
                    todosById={todosById}
                    completedByAgenda={completedByAgenda}
                    runningAgendaId={runningAgendaId}
                    nowMs={nowMs}
                    compact={view === "three"}
                    onOpenAgenda={(agenda) => setOpenAgendaId(agenda.id)}
                    onMoveAgenda={onMoveAgenda}
                    onResizeAgenda={onResizeAgenda}
                    onToggleBlockSkip={(block) => {
                      void (async () => {
                        const skipped = await toggleSkip(
                          block.timeBlockId,
                          block.date,
                        );
                        toast.undoable(
                          skipped
                            ? t.settings.timeBlockSkipped
                            : t.settings.timeBlockUnskip,
                          () => void toggleSkip(block.timeBlockId, block.date),
                        );
                      })();
                    }}
                    onCreateAt={(px) => {
                      const startMs = instantForPx(
                        px,
                        date,
                        settings.timezone,
                        15,
                      );
                      setCreateAt({
                        date,
                        startMs,
                        outsideWindow: !world.windows.some(
                          (w) => w.start <= startMs && startMs < w.end,
                        ),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </TimelineScrollContext.Provider>
        </div>
      )}

      <DraftBar />

      <CreateAtSheet request={createAt} onClose={() => setCreateAt(null)} />

      <AgendaSheet
        agendaId={openAgendaId}
        onClose={() => setOpenAgendaId(null)}
        onDelete={onDeleteAgenda}
        onStartFocus={(agenda) => {
          setOpenAgendaId(null);
          // Synchronously, before any await — the unlock is only honoured
          // while the call stack still belongs to the tap.
          primeAudio();
          void (async () => {
            const completed = await completedFocusFor(agenda.id);
            await startFocusSession({
              agendaId: agenda.id,
              todoId: agenda.todo_id,
              alreadyCompleted: completed,
              isOvertime: completed >= agenda.allocated_pomodoro,
            });
          })();
        }}
      />

      <ConfirmDialog
        open={pendingMove !== null}
        onOpenChange={(open) => !open && setPendingMove(null)}
        title={
          pendingMove?.reason === "time-block"
            ? t.calendar.timeBlockConfirm(pendingMove.blockName ?? "")
            : t.calendar.outsideWindowConfirm
        }
        confirmLabel={
          pendingMove?.reason === "time-block"
            ? t.calendar.placeAnyway
            : t.calendar.scheduleAnyway
        }
        onConfirm={() => {
          if (!pendingMove) return;
          void commitMove(
            pendingMove.agenda,
            pendingMove.start,
            pendingMove.end,
            pendingMove.reason === "outside-window",
          );
        }}
      />
    </Screen>
  );
}

function AgendaList({
  from,
  to,
  agendas,
  timezone,
  todosById,
  onOpen,
}: {
  from: IsoDate;
  to: IsoDate;
  agendas: Agenda[];
  timezone: string;
  todosById: Map<UUID, import("@/lib/db/schema").Todo>;
  onOpen: (agenda: Agenda) => void;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<IsoDate, Agenda[]>();
    for (const agenda of agendas) {
      if (agenda.status === "cancelled") continue;
      const date = localDate(agenda.start_at, timezone);
      if (date < from || date > to) continue;
      const bucket = map.get(date);
      if (bucket) bucket.push(agenda);
      else map.set(date, [agenda]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.start_at.localeCompare(b.start_at));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agendas, timezone, from, to]);

  if (grouped.length === 0) {
    return <EmptyState title={t.calendar.emptyDay} />;
  }

  return (
    <div className="pb-24">
      {grouped.map(([date, list]) => (
        <section key={date}>
          <h2 className="sticky top-0 z-10 bg-bg/95 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase backdrop-blur">
            {formatDateWithWeekday(date)}
          </h2>
          <ul>
            {list.map((agenda) => (
              <li key={agenda.id}>
                <button
                  type="button"
                  onClick={() => onOpen(agenda)}
                  className="flex min-h-14 w-full items-center gap-3 border-b border-border/60 px-4 py-2 text-left"
                >
                  <span className="w-20 shrink-0 text-[12px] tabular-nums text-fg-muted">
                    {formatTimeRange(agenda.start_at, agenda.end_at, timezone)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">
                      {agenda.title_override ??
                        todosById.get(agenda.todo_id)?.title ??
                        t.agenda.title}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        agenda.status === "missed"
                          ? "text-danger"
                          : "text-fg-subtle",
                      )}
                    >
                      {t.agenda.status[agenda.status]} ·{" "}
                      {t.calendar.allocatedPomodoro(agenda.allocated_pomodoro)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
