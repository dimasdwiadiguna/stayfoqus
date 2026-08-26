"use client";

import { AlertTriangle, CloudAlert } from "lucide-react";
import * as React from "react";

import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
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
const MOVE_TOLERANCE_PX = 5;
const RESIZE_HANDLE_PX = 18;

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

  const top = topFor(startMs, date, timezone) + (drag?.mode === "move" ? minutesToPx(drag.deltaMin) : 0);
  const baseHeight = heightFor(startMs, endMs);
  const height =
    drag?.mode === "resize"
      ? Math.max(minutesToPx(shape.focusMin), baseHeight + minutesToPx(drag.deltaMin))
      : baseHeight;

  const isDraft = agenda.status === "draft";
  const width = `calc(${100 / columns}% - 4px)`;
  const left = `calc(${(column * 100) / columns}% + 2px)`;

  const beginDrag = (
    e: React.PointerEvent,
    mode: "move" | "resize",
  ) => {
    e.stopPropagation();
    const originY = e.clientY;
    const pointerId = e.pointerId;
    const target = e.currentTarget as HTMLElement;
    let active = mode === "resize";
    let holdTimer = 0;

    if (mode === "move") {
      holdTimer = window.setTimeout(() => {
        active = true;
        setDrag({ mode, deltaMin: 0 });
        target.setPointerCapture(pointerId);
      }, MOVE_HOLD_MS);
    } else {
      setDrag({ mode, deltaMin: 0 });
      target.setPointerCapture(pointerId);
    }

    const onPointerMove = (ev: PointerEvent) => {
      const dyPx = ev.clientY - originY;
      if (!active) {
        // Moving before the hold elapses means the user is scrolling.
        if (Math.abs(dyPx) > MOVE_TOLERANCE_PX) cleanup(false);
        return;
      }
      const rawMin = pxToMinutes(dyPx);
      const deltaMin =
        mode === "move"
          ? snapMinutes(rawMin, MOVE_SNAP_MIN)
          : snapToPomodoro(baseHeight, rawMin, shape);
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

      setDrag((current) => {
        if (commit && active && current && current.deltaMin !== 0) {
          if (current.mode === "move") {
            onMove(startMs + current.deltaMin * MINUTE_MS);
          } else {
            onResize(endMs + current.deltaMin * MINUTE_MS);
          }
        }
        return null;
      });
      active = false;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const title = agenda.title_override ?? todo?.title ?? t.agenda.title;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${title} ${formatTimeRange(agenda.start_at, agenda.end_at, timezone)}`}
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
      style={{ top, height, left, width, touchAction: drag ? "none" : "pan-y" }}
    >
      {/* buffer stripes — thin, muted, attached to the block (§5.2) */}
      {agenda.buffer_before_min > 0 ? (
        <span
          aria-hidden
          className="absolute inset-x-0 -top-px bg-fg-subtle/25"
          style={{ height: 2 }}
          title={`${agenda.buffer_before_min} ${t.common.minutesShort}`}
        />
      ) : null}
      {agenda.buffer_after_min > 0 ? (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px bg-fg-subtle/25"
          style={{ height: 2 }}
        />
      ) : null}

      {agenda.outside_window ? (
        <span
          aria-hidden
          title={t.calendar.outsideWindowBadge}
          className="absolute inset-y-0 left-0 w-1 bg-warning"
        />
      ) : null}

      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-tight">
          {title}
        </span>
        {agenda.gcal_conflict ? (
          <CloudAlert
            className="size-3 shrink-0 text-warning"
            aria-label={t.calendar.gcalConflict}
          />
        ) : null}
        {agenda.outside_window ? (
          <AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden />
        ) : null}
      </div>

      {!compact && height > 40 ? (
        <div className="mt-0.5 text-[10px] tabular-nums text-fg-muted">
          {formatTimeRange(agenda.start_at, agenda.end_at, timezone)}
        </div>
      ) : null}

      {height > 58 ? (
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
