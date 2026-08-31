"use client";

import { AlertTriangle, CloudAlert, Link2 } from "lucide-react";
import * as React from "react";

import { BufferBand } from "@/components/calendar/buffer-band";
import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { useTimelineScroll } from "@/components/calendar/scroll-context";
import type { Agenda, IsoDate, Todo } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  MOVE_SNAP_MIN,
  heightFor,
  minutesToPx,
  pxToMinutes,
  snapMinutes,
  topFor,
} from "@/lib/calendar/geometry";
import { pomodorosForDuration, sessionDurationMin } from "@/lib/scheduling";
import { useSettings } from "@/hooks/use-settings";
import { MINUTE_MS, formatTimeRange } from "@/lib/time";
import { cn } from "@/lib/utils";

/** How long a press must be held before the block starts moving (§8). */
const MOVE_HOLD_MS = 200;
const MOVE_TOLERANCE_PX = 8;
const RESIZE_HANDLE_PX = 22;

/**
 * One agenda on the timeline.
 *
 * §8 assigns two drags to this block: move (snapping to 5 minutes) and resize
 * from an edge (snapping to whole pomodoro durations). Move is gated behind a
 * 200 ms hold so it cannot hijack the timeline's vertical scroll — the same
 * constraint §8 fixes for the task list. The resize handles are small, explicit
 * targets, so they engage immediately.
 */
export function AgendaBlock({
  agenda,
  todo,
  date,
  timezone,
  column,
  columns,
  compact,
  completed,
  running,
  onOpen,
  onMove,
  onResize,
}: {
  agenda: Agenda;
  todo?: Todo;
  date: IsoDate;
  timezone: string;
  column: number;
  columns: number;
  compact?: boolean;
  completed: number;
  running: boolean;
  onOpen: () => void;
  onMove: (startMs: number) => void;
  onResize: (endMs: number) => void;
}) {
  const settings = useSettings();
  const scrollRef = useTimelineScroll();
  const shape = {
    focusMin: settings.pomodoro_focus_min,
    shortBreakMin: settings.pomodoro_short_break_min,
  };

  const startMs = new Date(agenda.start_at).getTime();
  const endMs = new Date(agenda.end_at).getTime();

  const [drag, setDrag] = React.useState<{
    mode: "move" | "resize";
    deltaMin: number;
  } | null>(null);

  /**
   * The authoritative delta for committing a drag.
   *
   * It must not be read out of the `drag` state: a functional `setState`
   * updater does not run synchronously, so by the time React invoked it the
   * gesture's cleanup had already reset its local flags and the commit was
   * silently skipped — which is why dragging appeared to do nothing at all.
   * The state drives the preview; this ref drives the write.
   */
  const deltaRef = React.useRef(0);

  const top =
    topFor(startMs, date, timezone) +
    (drag?.mode === "move" ? minutesToPx(drag.deltaMin) : 0);
  const baseHeight = heightFor(startMs, endMs);
  const height =
    drag?.mode === "resize"
      ? Math.max(
          minutesToPx(shape.focusMin),
          baseHeight + minutesToPx(drag.deltaMin),
        )
      : baseHeight;

  const isDraft = agenda.status === "draft";
  const width = `calc(${100 / columns}% - 4px)`;
  const left = `calc(${(column * 100) / columns}% + 2px)`;

  /**
   * Move and resize both start here.
   *
   * The block sets `touch-action: none`, so the browser never claims the
   * gesture — which is what made dragging almost impossible before: with
   * `pan-y` the scroller took over within a few pixels and cancelled the
   * pointer stream before the 200 ms hold could arm the drag.
   *
   * Taking the gesture means we owe the user scrolling back. Until the hold
   * arms (`armed`), vertical movement is forwarded to the timeline's scroll
   * pane by hand, so a swipe that happens to start on a block still scrolls.
   */
  const beginDrag = (e: React.PointerEvent, mode: "move" | "resize") => {
    e.stopPropagation();

    const originY = e.clientY;
    const originX = e.clientX;
    const pointerId = e.pointerId;
    const target = e.currentTarget as HTMLElement;
    const pane = scrollRef?.current ?? null;
    const paneStartTop = pane?.scrollTop ?? 0;

    let armed = mode === "resize";
    /** Set once movement has been claimed as a scroll — no drag after that. */
    let scrolling = false;
    let holdTimer = 0;

    const arm = () => {
      if (scrolling) return;
      armed = true;
      deltaRef.current = 0;
      setDrag({ mode, deltaMin: 0 });
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* the pointer already ended */
      }
      // A drag is a deliberate act; confirm it in the hand.
      navigator.vibrate?.(8);
    };

    if (mode === "move") holdTimer = window.setTimeout(arm, MOVE_HOLD_MS);
    else arm();

    const onPointerMove = (ev: PointerEvent) => {
      const dyPx = ev.clientY - originY;

      if (!armed) {
        const dxPx = ev.clientX - originX;
        // A clearly horizontal gesture is the day swipe; let it through
        // untouched by ending our involvement.
        if (
          Math.abs(dxPx) > Math.abs(dyPx) &&
          Math.abs(dxPx) > MOVE_TOLERANCE_PX
        ) {
          cleanup(false);
          return;
        }
        if (Math.abs(dyPx) > MOVE_TOLERANCE_PX) {
          scrolling = true;
          window.clearTimeout(holdTimer);
        }
        if (scrolling && pane) pane.scrollTop = paneStartTop - dyPx;
        return;
      }

      ev.preventDefault();
      const rawMin = pxToMinutes(dyPx);
      const deltaMin =
        mode === "move"
          ? snapMinutes(rawMin, MOVE_SNAP_MIN)
          : snapToPomodoro(baseHeight, rawMin, shape);
      deltaRef.current = deltaMin;
      setDrag({ mode, deltaMin });
    };

    const onPointerUp = () => cleanup(true);

    const cleanup = (commit: boolean) => {
      window.clearTimeout(holdTimer);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* capture was never taken */
      }

      const deltaMin = deltaRef.current;
      const shouldCommit = commit && armed && !scrolling && deltaMin !== 0;

      armed = false;
      deltaRef.current = 0;
      setDrag(null);

      // Committed outside the state updater, synchronously, so the write
      // cannot be lost to React's scheduling.
      if (shouldCommit) {
        if (mode === "move") onMove(startMs + deltaMin * MINUTE_MS);
        else onResize(endMs + deltaMin * MINUTE_MS);
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const title = agenda.title_override ?? todo?.title ?? t.agenda.title;
  const timeRange = formatTimeRange(agenda.start_at, agenda.end_at, timezone);
  /** Below two lines of text, the title and the range share one row. */
  const short = height < 40 || compact;

  const badges = (
    <>
      {agenda.follows_agenda_id ? (
        <Link2
          className="size-3 shrink-0 text-success"
          aria-label={t.agenda.immediatelyAfterBadge}
        />
      ) : null}
      {agenda.gcal_conflict ? (
        <CloudAlert
          className="size-3 shrink-0 text-warning"
          aria-label={t.calendar.gcalConflict}
        />
      ) : null}
      {agenda.outside_window ? (
        <AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden />
      ) : null}
    </>
  );

  const beforePx = minutesToPx(agenda.buffer_before_min);
  const afterPx = minutesToPx(agenda.buffer_after_min);

  return (
    <>
      {/*
        §5.2 buffers, drawn as the time they actually consume so the gap the
        scheduler reserves is visible. They sit outside the block, immediately
        above and below it, and follow it while it is being dragged.
      */}
      <BufferBand
        type={agenda.buffer_before_type}
        minutes={agenda.buffer_before_min}
        side="before"
        top={top - beforePx}
        height={beforePx}
        left={left}
        width={width}
        dimmed={isDraft}
      />
      <BufferBand
        type={agenda.buffer_after_type}
        minutes={agenda.buffer_after_min}
        side="after"
        top={top + height}
        height={afterPx}
        left={left}
        width={width}
        dimmed={isDraft}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={`${title} ${timeRange}`}
        onPointerDown={(e) => beginDrag(e, "move")}
        onClick={() => !drag && onOpen()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "absolute z-10 overflow-hidden rounded-md border px-1.5 py-1 text-left transition-shadow",
          isDraft
            ? "border-dashed border-accent bg-accent-soft/70"
            : "border-accent/50 bg-accent-soft",
          agenda.status === "done" && "border-success/50 bg-success/12",
          agenda.status === "partial" && "border-warning/50 bg-warning/12",
          agenda.status === "missed" && "border-danger/50 bg-danger/12",
          drag && "shadow-lg ring-2 ring-accent",
        )}
        // The block owns the gesture; scrolling is forwarded by hand in
        // `beginDrag` so a swipe starting here still moves the timeline.
        style={{ top, height, left, width, touchAction: "none" }}
      >
        {agenda.outside_window ? (
          <span
            aria-hidden
            title={t.calendar.outsideWindowBadge}
            className="absolute inset-y-0 left-0 w-1 bg-warning"
          />
        ) : null}

        {/*
        The time range is always rendered, not only when the block is tall
        enough — a single-pomodoro block is ~38px, which used to fall below the
        old threshold and hide exactly the information the block exists to give.
        Short blocks put the range beside the title; taller ones stack it.
      */}
        {short ? (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">
              {timeRange}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight">
              {title}
            </span>
            {badges}
          </div>
        ) : (
          <>
            <div className="flex items-start gap-1">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight">
                {title}
              </span>
              {badges}
            </div>
            <div className="mt-0.5 text-[10px] tabular-nums text-fg-muted">
              {timeRange}
            </div>
          </>
        )}

        {height > 62 ? (
          <PomodoroDots
            allocated={agenda.allocated_pomodoro}
            completed={completed}
            running={running}
            className="mt-1"
          />
        ) : null}

        {/* resize handle — §8: snaps to whole pomodoro durations */}
        <span
          role="separator"
          aria-label={t.agenda.fieldEnd}
          onPointerDown={(e) => beginDrag(e, "resize")}
          className="absolute inset-x-0 bottom-0 cursor-ns-resize"
          style={{ height: RESIZE_HANDLE_PX, touchAction: "none" }}
        />
      </div>
    </>
  );
}

/**
 * Resizing snaps the *resulting duration* onto the pomodoro ladder
 * (25/55/85/115…), so a block always represents a whole number of sessions.
 */
function snapToPomodoro(
  baseHeightPx: number,
  rawDeltaMin: number,
  shape: { focusMin: number; shortBreakMin: number },
): number {
  const currentMin = pxToMinutes(baseHeightPx);
  const targetMin = currentMin + rawDeltaMin;
  const n = Math.max(1, pomodorosForDuration(targetMin, shape));
  return sessionDurationMin(n, shape) - currentMin;
}
