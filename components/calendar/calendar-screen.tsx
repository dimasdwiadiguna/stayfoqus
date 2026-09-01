"use client";

import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Maximize2,
  Minimize2,
} from "lucide-react";
import * as React from "react";

import { AgendaSheet } from "@/components/calendar/agenda-sheet";
import {
  CreateAtSheet,
  type CreateAtRequest,
} from "@/components/calendar/create-at-sheet";
import { BufferSwatch } from "@/components/calendar/buffer-band";
import { PrayerShiftDialog } from "@/components/calendar/prayer-shift-dialog";
import { DraftBar } from "@/components/calendar/draft-bar";
import { TimelineScrollContext } from "@/components/calendar/scroll-context";
import { EventSheet, type OpenEvent } from "@/components/calendar/event-sheet";
import { PlanningWizard } from "@/components/planning/planning-wizard";
import { ScheduleSheet } from "@/components/calendar/schedule-sheet";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
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
import { useEvents, useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import {
  deleteAgenda,
  linkImmediatelyAfter,
  restoreAgenda,
  updateAgenda,
} from "@/lib/agendas/repo";
import { toggleSkip } from "@/lib/timeblocks/repo";
import {
  FULL_DAY_VIEWPORT,
  HOUR_HEIGHT,
  dayViewport,
  instantForPx,
  type DayViewport,
} from "@/lib/calendar/geometry";
import type { Agenda, IsoDate, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import type { DropVerdict } from "@/components/calendar/agenda-block";
import {
  avoidPrayer,
  dragLinkCandidate,
  freeMinutes,
  isInsideWindow,
  overlaps,
  violatedBlock,
  buildFreeSpace,
  type EventInstance,
  type LinkCandidate,
  type PrayerAvoidance,
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

/**
 * A drop waiting on an answer.
 *
 * Two questions can stand between releasing a block and writing it: the soft
 * constraints of §5.1/§5.4, and — when the block came to rest against a
 * neighbour — whether the user meant "immediately after" (D-091). They are
 * asked in that order, one dialog at a time, because the second only matters
 * once the placement itself is settled.
 */
type PendingDrop = {
  agenda: Agenda;
  start: number;
  end: number;
  /** The neighbour the drag was reaching for, if any. */
  link: LinkCandidate | null;
  phase: "prayer" | "constraint" | "link";
  reason?: "outside-window" | "time-block";
  blockName?: string;
  /** Only in the "prayer" phase: the block hit, and the ways around it. */
  avoidance?: PrayerAvoidance;
} | null;

export function CalendarScreen() {
  const settings = useSettings();
  const today = localDate(new Date(), settings.timezone);

  const [view, setView] = React.useState<CalendarView>("day");
  const [anchor, setAnchor] = React.useState<IsoDate>(today);
  const [openAgendaId, setOpenAgendaId] = React.useState<UUID | null>(null);
  const [pendingDrop, setPendingDrop] = React.useState<PendingDrop>(null);
  const [createAt, setCreateAt] = React.useState<CreateAtRequest | null>(null);
  const [planningOpen, setPlanningOpen] = React.useState(false);
  const [openTodoId, setOpenTodoId] = React.useState<UUID | null>(null);
  /** Off by default: the dead hours outside the productive band are hidden. */
  const [fullDay, setFullDay] = React.useState(false);
  const [scheduling, setScheduling] = React.useState<Todo | null>(null);
  const [openEvent, setOpenEvent] = React.useState<OpenEvent | null>(null);
  const nowMs = useNow();
  const runningAgendaId = usePomodoroStore((s) => s.timer.agendaId);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrolledFor = React.useRef<string>("");

  const days: IsoDate[] = React.useMemo(
    () =>
      view === "three"
        ? [anchor, addDays(anchor, 1), addDays(anchor, 2)]
        : [anchor],
    [view, anchor],
  );

  const rangeTo =
    view === "list"
      ? addDays(anchor, LIST_HORIZON_DAYS)
      : days[days.length - 1]!;
  const world = useSchedulingWorld({
    from: anchor,
    to: rangeTo,
    includeDraftAgendas: true,
  });

  const { todos, agendas, index, categories } = useTaskData();
  const rawEvents = useEvents();
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


  const eventsForDay = React.useCallback(
    (date: IsoDate) => world.events.filter((e) => e.date === date),
    [world.events],
  );

  /** Which events repeat, so the block can wear the mark. */
  const repeatingEventIds = React.useMemo(
    () =>
      new Set(
        rawEvents.filter((e) => e.recurrence === "weekly").map((e) => e.id),
      ),
    [rawEvents],
  );

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

  /**
   * The slice of the 24-hour column the day columns render.
   *
   * One band for every visible day, or the three-day columns would not line up
   * with each other or with the hour gutter. Union of each day's own band, so a
   * late block on any one of them widens the view for all.
   */
  const viewport: DayViewport = React.useMemo(() => {
    if (fullDay || view === "list") return FULL_DAY_VIEWPORT;

    let top = Infinity;
    let bottom = -Infinity;
    for (const date of days) {
      const band = dayViewport(
        date,
        settings.timezone,
        world.windows.filter((w) => w.date === date),
        agendasForDay(date)
          .filter((a) => a.status !== "cancelled")
          .map((a) => ({
            // The buffers are part of what has to stay visible.
            start:
              new Date(a.start_at).getTime() - a.buffer_before_min * 60_000,
            end: new Date(a.end_at).getTime() + a.buffer_after_min * 60_000,
          })),
      );
      top = Math.min(top, band.topPx);
      bottom = Math.max(bottom, band.topPx + band.heightPx);
    }

    if (!Number.isFinite(top) || bottom <= top) return FULL_DAY_VIEWPORT;
    return { topPx: top, heightPx: bottom - top };
  }, [fullDay, view, days, settings.timezone, world.windows, agendasForDay]);

  /** §7.2: auto-scroll to the current hour on open. */
  React.useEffect(() => {
    if (view === "list") return;
    const key = `${view}:${anchor}`;
    if (scrolledFor.current === key) return;

    const target = anchor === today ? new Date().getHours() : 7;
    // Relative to the rendered band, not to midnight: the dead hours above the
    // productive window are no longer part of the scrollable content.
    const top = Math.max(0, (target - 1) * HOUR_HEIGHT - viewport.topPx);

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
  }, [view, anchor, today, viewport.topPx]);

  const hasBuffers = React.useMemo(
    () =>
      days.some((date) =>
        agendasForDay(date).some(
          (a) =>
            a.status !== "cancelled" &&
            (a.buffer_before_min > 0 || a.buffer_after_min > 0),
        ),
      ),
    [days, agendasForDay],
  );

  /* ---------------- move / resize (§5.1, §5.4 soft confirmations) -------- */

  const commitMove = async (
    agenda: Agenda,
    start: number,
    end: number,
    outside: boolean,
    link: LinkCandidate | null,
  ) => {
    // Captured before the write so the undo is a real inverse (D-022) — a
    // mis-drag otherwise loses the old time silently, and with it any pin the
    // drag released.
    const before = {
      start_at: agenda.start_at,
      end_at: agenda.end_at,
      outside_window: agenda.outside_window,
      follows_agenda_id: agenda.follows_agenda_id,
    };

    // `follows_agenda_id` is always written explicitly: dragging a pinned
    // agenda by hand releases its pin (D-087), so leaving the column alone
    // would silently keep a link the user just overrode.
    await updateAgenda(agenda.id, {
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      outside_window: outside,
      follows_agenda_id: null,
    });

    if (link) {
      // Re-checked against live data rather than the drag-time snapshot; the
      // cue already filtered cycles, this is the belt to that pair of braces.
      const result = await linkImmediatelyAfter(agenda.id, link.predecessor.id);
      if (!result.ok) toast.error(t.agenda.linkCycle);
    }

    toast.undoable(
      t.calendar.moved,
      () => void updateAgenda(agenda.id, before),
    );
  };

  /** Asks about the pin, once the placement itself is settled. */
  const requestLink = (
    agenda: Agenda,
    start: number,
    end: number,
    outside: boolean,
    link: LinkCandidate | null,
  ) => {
    if (!link) {
      void commitMove(agenda, start, end, outside, null);
      return;
    }
    setPendingDrop({
      agenda,
      start,
      end,
      link,
      phase: "link",
      reason: undefined,
    });
  };

  const requestMove = (
    agenda: Agenda,
    start: number,
    end: number,
    link: LinkCandidate | null,
    options: { skipPrayer?: boolean } = {},
  ) => {
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

    // A prayer block is not a wall the user should have to bounce off: before
    // asking whether to break it, offer the two placements that do not.
    if (!options.skipPrayer) {
      const avoidance = avoidPrayer(
        interval,
        world.prayers,
        // The agenda being moved must not block its own way out, the same
        // reason `useSchedulingWorld` grew `excludeAgendaIds` for reschedule.
        buildFreeSpace(
          world.windows,
          world.busy.filter((b) => b.agendaId !== agenda.id),
        ),
      );
      if (avoidance) {
        setPendingDrop({
          agenda,
          start,
          end,
          link,
          phase: "prayer",
          avoidance,
        });
        return;
      }
    }

    if (!isInsideWindow(interval, world.windows)) {
      setPendingDrop({
        agenda,
        start,
        end,
        link,
        phase: "constraint",
        reason: "outside-window",
      });
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
      setPendingDrop({
        agenda,
        start,
        end,
        link,
        phase: "constraint",
        reason: "time-block",
        blockName: violated.name,
      });
      return;
    }
    requestLink(agenda, start, end, false, link);
  };

  const onMoveAgenda = (
    agenda: Agenda,
    startMs: number,
    link: LinkCandidate | null,
  ) => {
    const duration =
      new Date(agenda.end_at).getTime() - new Date(agenda.start_at).getTime();
    requestMove(agenda, startMs, startMs + duration, link);
  };

  /**
   * What a drop at `startMs` would cost, while the finger is still down.
   *
   * The same predicates the drop itself runs, so the ring can never promise
   * something the dialogs then contradict. Read-only: nothing is decided here.
   */
  const evaluateDropAt = React.useCallback(
    (agenda: Agenda, startMs: number): DropVerdict => {
      const duration =
        new Date(agenda.end_at).getTime() - new Date(agenda.start_at).getTime();
      const interval = { start: startMs, end: startMs + duration };

      if (world.prayers.some((prayer) => overlaps(interval, prayer))) {
        return "prayer";
      }
      if (!isInsideWindow(interval, world.windows)) return "outside";

      const todo = todosById.get(agenda.todo_id);
      if (
        todo &&
        violatedBlock(
          {
            categoryId: todo.category_id,
            tags: todo.tags,
            priority: todo.priority,
          },
          interval,
          world.timeBlocks,
        )
      ) {
        return "time-block";
      }
      return "ok";
    },
    [world.prayers, world.windows, world.timeBlocks, todosById],
  );

  /**
   * What a block dragged to `startMs` would pin itself to.
   *
   * Answered here rather than inside the day column because `wouldCycle` has to
   * walk the whole follow graph — a column only knows one day of it.
   */
  const linkCandidateAt = React.useCallback(
    (agenda: Agenda, startMs: number) =>
      dragLinkCandidate(agendas, {
        id: agenda.id,
        start: startMs,
        bufferBefore: {
          min: agenda.buffer_before_min,
          type: agenda.buffer_before_type,
        },
      }),
    [agendas],
  );

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
        // Kept to three thin rows: on a 390px screen every row of chrome is a
        // row of timeline the user does not get to see.
        <div className="space-y-2">
          <ScreenTitle
            title={t.calendar.title}
            actions={
              <>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t.planning.button}
                  title={t.planning.button}
                  onClick={() => setPlanningOpen(true)}
                >
                  <ClipboardList className="size-4" />
                </Button>
                <SyncIndicator />
              </>
            }
          />

          <div className="flex items-center gap-1">
            <Button
              size="iconSm"
              variant="ghost"
              aria-label={t.calendar.previousDay}
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
              aria-label={t.calendar.nextDay}
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

          <div className="flex items-center gap-2">
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
              <>
                {/*
                  §5.2's two buffer types are only useful if they can be told
                  apart on the timeline, so the key sits with the view it
                  explains — and only on days that have a buffer to decode.
                */}
                {hasBuffers ? (
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <BufferSwatch type="switch" compact />
                    <BufferSwatch type="commute" compact />
                  </span>
                ) : null}
                <Button
                  size="iconSm"
                  variant="ghost"
                  className={hasBuffers ? undefined : "ml-auto"}
                  aria-label={
                    fullDay ? t.calendar.compactHours : t.calendar.fullDayHours
                  }
                  title={
                    fullDay ? t.calendar.compactHours : t.calendar.fullDayHours
                  }
                  onClick={() => setFullDay((v) => !v)}
                >
                  {fullDay ? (
                    <Minimize2 className="size-4" />
                  ) : (
                    <Maximize2 className="size-4" />
                  )}
                </Button>
              </>
            ) : null}
          </div>

          {/*
            The day's totals on one thin line of their own. Squeezed onto the
            row above they truncated on a 390px screen, and the figure lost was
            the free hours — the one of the three that drives a decision.
          */}
          {view !== "list" ? (
            <p className="text-[11px] tabular-nums text-fg-subtle">
              {t.calendar.agendaCount(headerTotals.count)} ·{" "}
              {t.calendar.allocatedPomodoro(headerTotals.allocated)} ·{" "}
              {t.calendar.freeHours(formatHoursDecimal(headerTotals.freeMin))}
            </p>
          ) : null}
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
          events={world.events}
          timezone={settings.timezone}
          todosById={todosById}
          onOpen={(agenda) => setOpenAgendaId(agenda.id)}
          onOpenEvent={(event) =>
            setOpenEvent({
              eventId: event.eventId,
              date: event.date,
              skipped: event.skipped,
            })
          }
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
            {/*
              The day labels sit outside the clipped band so they can stay
              sticky against the scroll pane; `overflow: hidden` on the band
              would otherwise strand them.
            */}
            {view === "three" ? (
              <div className="sticky top-0 z-30 flex border-b border-border bg-bg/95 backdrop-blur">
                <div className="w-11 shrink-0" aria-hidden />
                {days.map((date) => (
                  <div
                    key={date}
                    className="min-w-0 flex-1 py-1 text-center text-[11px] font-medium"
                  >
                    {formatDateWithWeekday(date)}
                  </div>
                ))}
              </div>
            ) : null}

            {/*
              The column stays a linear 24 hours; only the slice of it that is
              rendered moves (D-095). Everything inside keeps computing its
              position from the top of the day, so no drag arithmetic changes.
            */}
            <div
              className="relative overflow-hidden"
              style={{ height: viewport.heightPx }}
            >
              <div className="flex" style={{ marginTop: -viewport.topPx }}>
                <HourGutter />
                {days.map((date) => (
                  <div
                    key={date}
                    className="min-w-0 flex-1 border-r border-border/60"
                  >
                    <TimelineDay
                      date={date}
                      timezone={settings.timezone}
                      windows={world.windows.filter((w) => w.date === date)}
                      timeBlocks={world.timeBlocks.filter(
                        (b) => b.date === date,
                      )}
                      busy={world.busy.filter((b) => b.source === "gcal_busy")}
                      prayers={world.prayers.filter((p) => p.date === date)}
                      agendas={agendasForDay(date)}
                      events={eventsForDay(date)}
                      repeatingEventIds={repeatingEventIds}
                      todosById={todosById}
                      completedByAgenda={completedByAgenda}
                      runningAgendaId={runningAgendaId}
                      nowMs={nowMs}
                      compact={view === "three"}
                      viewportTopPx={viewport.topPx}
                      onOpenAgenda={(agenda) => setOpenAgendaId(agenda.id)}
                      onOpenEvent={(event) =>
                        setOpenEvent({
                          eventId: event.eventId,
                          date: event.date,
                          skipped: event.skipped,
                        })
                      }
                      onMoveAgenda={onMoveAgenda}
                      linkCandidateAt={linkCandidateAt}
                      evaluateDropAt={evaluateDropAt}
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
                            () =>
                              void toggleSkip(block.timeBlockId, block.date),
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
            </div>
          </TimelineScrollContext.Provider>
        </div>
      )}

      <PlanningWizard
        open={planningOpen}
        onClose={() => setPlanningOpen(false)}
      />

      <DraftBar />

      <CreateAtSheet
        request={createAt}
        onClose={() => setCreateAt(null)}
        onCreatedEvent={(eventId, date) =>
          setOpenEvent({ eventId, date, skipped: false })
        }
      />

      <EventSheet open={openEvent} onClose={() => setOpenEvent(null)} />

      <AgendaSheet
        agendaId={openAgendaId}
        onClose={() => setOpenAgendaId(null)}
        onDelete={onDeleteAgenda}
        onOpenTodo={(todoId) => {
          setOpenAgendaId(null);
          setOpenTodoId(todoId);
        }}
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

      {/*
        §5.3 — a prayer block in the way. Asked before the soft constraints,
        because accepting a shift changes the placement they would judge.
      */}
      <PrayerShiftDialog
        avoidance={
          pendingDrop?.phase === "prayer"
            ? (pendingDrop.avoidance ?? null)
            : null
        }
        timezone={settings.timezone}
        onOpenChange={(open) => !open && setPendingDrop(null)}
        onShift={(interval) => {
          if (!pendingDrop) return;
          const { agenda } = pendingDrop;
          setPendingDrop(null);
          // A shift is a fresh placement: it is re-checked against the window
          // and the time blocks, and its pin is recomputed for the new start
          // rather than carried over from where the finger let go.
          requestMove(
            agenda,
            interval.start,
            interval.end,
            linkCandidateAt(agenda, interval.start),
          );
        }}
        onKeep={() => {
          if (!pendingDrop) return;
          const { agenda, start, end, link } = pendingDrop;
          setPendingDrop(null);
          requestMove(agenda, start, end, link, { skipPrayer: true });
        }}
      />

      {/* §5.1 / §5.4 — the soft constraints, asked next. */}
      {/*
        An agenda is a slice of a todo, so the notes, subtasks and estimate
        behind it should be one tap away rather than a tab away.
      */}
      <TaskDetailSheet
        todo={openTodoId ? (index.byId.get(openTodoId) ?? null) : null}
        todos={todos}
        categories={categories}
        timezone={settings.timezone}
        onClose={() => setOpenTodoId(null)}
        onSchedule={(todo) => {
          setOpenTodoId(null);
          setScheduling(todo);
        }}
        onOpenTodo={setOpenTodoId}
      />

      <ScheduleSheet todo={scheduling} onClose={() => setScheduling(null)} />

      <ConfirmDialog
        open={pendingDrop?.phase === "constraint"}
        onOpenChange={(open) => !open && setPendingDrop(null)}
        title={
          pendingDrop?.reason === "time-block"
            ? t.calendar.timeBlockConfirm(pendingDrop.blockName ?? "")
            : t.calendar.outsideWindowConfirm
        }
        confirmLabel={
          pendingDrop?.reason === "time-block"
            ? t.calendar.placeAnyway
            : t.calendar.scheduleAnyway
        }
        onConfirm={() => {
          if (!pendingDrop) return;
          requestLink(
            pendingDrop.agenda,
            pendingDrop.start,
            pendingDrop.end,
            pendingDrop.reason === "outside-window",
            pendingDrop.link,
          );
        }}
      />

      {/*
        D-091 — the pin question. Three outcomes, exactly as D-024 established:
        confirm links, the explicit cancel places without a link, and dismissing
        answers nothing, so the block stays where it was.
      */}
      <ConfirmDialog
        open={pendingDrop?.phase === "link"}
        onOpenChange={(open) => !open && setPendingDrop(null)}
        title={t.agenda.linkConfirmTitle(
          pendingDrop?.link
            ? (pendingDrop.link.predecessor.title_override ??
                todosById.get(pendingDrop.link.predecessor.todo_id)?.title ??
                t.agenda.title)
            : "",
        )}
        description={t.agenda.linkConfirmBody}
        confirmLabel={t.agenda.linkConfirmYes}
        cancelLabel={t.agenda.linkConfirmNo}
        onConfirm={() => {
          if (!pendingDrop) return;
          void commitMove(
            pendingDrop.agenda,
            pendingDrop.start,
            pendingDrop.end,
            pendingDrop.reason === "outside-window",
            pendingDrop.link,
          );
        }}
        onCancel={() => {
          if (!pendingDrop) return;
          void commitMove(
            pendingDrop.agenda,
            pendingDrop.start,
            pendingDrop.end,
            pendingDrop.reason === "outside-window",
            null,
          );
        }}
      />
    </Screen>
  );
}

/** One row of the list view: an agenda, or an event. */
type ListEntry =
  | { kind: "agenda"; start: number; agenda: Agenda }
  | { kind: "event"; start: number; event: EventInstance };

function AgendaList({
  from,
  to,
  agendas,
  events,
  timezone,
  todosById,
  onOpen,
  onOpenEvent,
}: {
  from: IsoDate;
  to: IsoDate;
  agendas: Agenda[];
  events: readonly EventInstance[];
  timezone: string;
  todosById: Map<UUID, import("@/lib/db/schema").Todo>;
  onOpen: (agenda: Agenda) => void;
  onOpenEvent: (event: EventInstance) => void;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<IsoDate, ListEntry[]>();
    const push = (date: IsoDate, entry: ListEntry) => {
      if (date < from || date > to) return;
      const bucket = map.get(date);
      if (bucket) bucket.push(entry);
      else map.set(date, [entry]);
    };

    for (const agenda of agendas) {
      if (agenda.status === "cancelled") continue;
      push(localDate(agenda.start_at, timezone), {
        kind: "agenda",
        start: new Date(agenda.start_at).getTime(),
        agenda,
      });
    }
    // Events belong here too: a day list that omitted the meeting would be a
    // list of only half the day.
    for (const event of events) {
      push(event.date, { kind: "event", start: event.start, event });
    }

    for (const bucket of map.values()) bucket.sort((a, b) => a.start - b.start);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [agendas, events, timezone, from, to]);

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
            {list.map((entry) =>
              entry.kind === "event" ? (
                <li key={`event-${entry.event.eventId}-${entry.event.start}`}>
                  <button
                    type="button"
                    onClick={() => onOpenEvent(entry.event)}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 border-b border-border/60 border-l-[3px] border-l-event px-4 py-2 text-left",
                      entry.event.skipped && "opacity-45",
                    )}
                  >
                    <span className="w-20 shrink-0 text-[12px] tabular-nums text-fg-muted">
                      {formatTimeRange(
                        new Date(entry.event.start).toISOString(),
                        new Date(entry.event.end).toISOString(),
                        timezone,
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[15px]",
                          entry.event.skipped && "line-through",
                        )}
                      >
                        {entry.event.title}
                      </span>
                      <span className="text-[11px] text-event">
                        {entry.event.skipped
                          ? t.event.skippedBadge
                          : (entry.event.location ?? t.event.title)}
                      </span>
                    </span>
                  </button>
                </li>
              ) : (
              <li key={entry.agenda.id}>
                <button
                  type="button"
                  onClick={() => onOpen(entry.agenda)}
                  className="flex min-h-14 w-full items-center gap-3 border-b border-border/60 px-4 py-2 text-left"
                >
                  <span className="w-20 shrink-0 text-[12px] tabular-nums text-fg-muted">
                    {formatTimeRange(
                      entry.agenda.start_at,
                      entry.agenda.end_at,
                      timezone,
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">
                      {entry.agenda.title_override ??
                        todosById.get(entry.agenda.todo_id)?.title ??
                        t.agenda.title}
                    </span>
                    <span
                      className={cn(
                        "text-[11px]",
                        entry.agenda.status === "missed"
                          ? "text-danger"
                          : "text-fg-subtle",
                      )}
                    >
                      {t.agenda.status[entry.agenda.status]} ·{" "}
                      {t.calendar.allocatedPomodoro(
                        entry.agenda.allocated_pomodoro,
                      )}
                    </span>
                  </span>
                </button>
              </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
