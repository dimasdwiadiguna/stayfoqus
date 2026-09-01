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
import type { LinkCandidate } from "@/lib/scheduling";
import { MINUTE_MS, formatTimeRange } from "@/lib/time";
import { cn } from "@/lib/utils";

/** How long a press must be held before the block starts moving (§8). */
const MOVE_HOLD_MS = 200;
const MOVE_TOLERANCE_PX = 8;
/** How close to the pane's edge a drag has to get before the day scrolls. */
const AUTOSCROLL_EDGE_PX = 56;
/** Fastest the pane scrolls itself, per frame, at the very edge. */
const AUTOSCROLL_MAX_PX = 12;

/** What the day column thinks of the placement currently under the finger. */
export type DropVerdict = "ok" | "outside" | "time-block" | "prayer" | "event";

/**
 * One agenda on the timeline.
 *
 * §8 assigns two drags to this block: move and resize from an edge. Resize was
 * removed on request (D-090): on a 390 px screen the 22 px handle sat inside the
 * move target and next to the scroll gesture, and since D-079 the duration
 * presets in the agenda sheet are a better way to change a length anyway. The
 * whole block is now one move surface, still gated behind a 200 ms hold so it
 * cannot hijack the timeline's vertical scroll.
 *
 * While it moves it does three things at once: looks for a predecessor to pin
 * itself to (D-091), scrolls the day when it reaches the edge of the pane, and
 * colours its own ring with what the drop would cost. The last two exist
 * because the day column is 2160 px tall and the answer used to arrive only
 * after release, in a dialog.
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
  linkCandidateAt,
  onLinkPreview,
  evaluateDropAt,
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
  onMove: (startMs: number, link: LinkCandidate | null) => void;
  /** Pure lookup, owned by the screen: what this start would pin to. */
  linkCandidateAt: (startMs: number) => LinkCandidate | null;
  /** Reports the live candidate so the column can draw the seam. */
  onLinkPreview: (candidate: LinkCandidate | null) => void;
  /** Pure lookup: what a drop at this start would need confirming for. */
  evaluateDropAt: (startMs: number) => DropVerdict;
}) {
  const scrollRef = useTimelineScroll();

  const startMs = new Date(agenda.start_at).getTime();
  const endMs = new Date(agenda.end_at).getTime();

  const [drag, setDrag] = React.useState<{
    deltaMin: number;
    link: LinkCandidate | null;
    verdict: DropVerdict;
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
  /** Likewise for the pin: the last candidate seen, read at commit time. */
  const linkRef = React.useRef<LinkCandidate | null>(null);
  /**
   * A committed drag ends with a `click`, and by then `drag` is already back to
   * null — so releasing a move used to open the agenda sheet on top of whatever
   * the drop was asking. The release sets this; the click consumes it.
   */
  const swallowClickRef = React.useRef(false);

  const top =
    topFor(startMs, date, timezone) + (drag ? minutesToPx(drag.deltaMin) : 0);
  const height = heightFor(startMs, endMs);

  const isDraft = agenda.status === "draft";
  const width = `calc(${100 / columns}% - 4px)`;
  const left = `calc(${(column * 100) / columns}% + 2px)`;

  /**
   * The move gesture.
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
  const beginDrag = (e: React.PointerEvent) => {
    e.stopPropagation();

    const originY = e.clientY;
    const originX = e.clientX;
    const pointerId = e.pointerId;
    const target = e.currentTarget as HTMLElement;
    const pane = scrollRef?.current ?? null;
    const paneStartTop = pane?.scrollTop ?? 0;

    let armed = false;
    /** Set once movement has been claimed as a scroll — no drag after that. */
    let scrolling = false;
    let holdTimer = 0;
    let frame = 0;
    /** Latest pointer position, so the autoscroll loop can re-apply it. */
    let lastClientY = e.clientY;

    /**
     * Recomputes the preview from the pointer *and* the pane's current scroll.
     *
     * The scroll term matters because the pane can now move underneath a
     * stationary finger; without it the block would slide out from under the
     * pointer by exactly the distance auto-scrolled.
     */
    const applyMove = () => {
      const scrolled = (pane?.scrollTop ?? 0) - paneStartTop;
      const dyPx = lastClientY - originY + scrolled;
      let deltaMin = snapMinutes(pxToMinutes(dyPx), MOVE_SNAP_MIN);

      // Magnet: within reach of a neighbour, the preview lands on the exact
      // chained start rather than on the 5-minute grid, so releasing where the
      // green line appears produces precisely the placement it described.
      const candidate = linkCandidateAt(startMs + deltaMin * MINUTE_MS);
      if (candidate) deltaMin = (candidate.start - startMs) / MINUTE_MS;

      linkRef.current = candidate;
      deltaRef.current = deltaMin;
      onLinkPreview(candidate);
      setDrag({
        deltaMin,
        link: candidate,
        verdict: evaluateDropAt(startMs + deltaMin * MINUTE_MS),
      });
    };

    /** Scrolls the day while the drag is held against the pane's edge. */
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!armed || !pane) return;

      const rect = pane.getBoundingClientRect();
      const fromTop = lastClientY - rect.top;
      const fromBottom = rect.bottom - lastClientY;

      let step = 0;
      if (fromTop < AUTOSCROLL_EDGE_PX) {
        step = -AUTOSCROLL_MAX_PX * (1 - Math.max(0, fromTop) / AUTOSCROLL_EDGE_PX);
      } else if (fromBottom < AUTOSCROLL_EDGE_PX) {
        step = AUTOSCROLL_MAX_PX * (1 - Math.max(0, fromBottom) / AUTOSCROLL_EDGE_PX);
      }
      if (step === 0) return;

      const before = pane.scrollTop;
      pane.scrollTop = before + step;
      // Clamped by the pane itself; when it has nothing left to give, stop
      // recomputing so the block does not creep on a stationary finger.
      if (pane.scrollTop !== before) applyMove();
    };

    const arm = () => {
      if (scrolling) return;
      armed = true;
      deltaRef.current = 0;
      linkRef.current = null;
      setDrag({ deltaMin: 0, link: null, verdict: "ok" });
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* the pointer already ended */
      }
      // A drag is a deliberate act; confirm it in the hand.
      navigator.vibrate?.(8);
      frame = requestAnimationFrame(tick);
    };

    holdTimer = window.setTimeout(arm, MOVE_HOLD_MS);

    const onPointerMove = (ev: PointerEvent) => {
      lastClientY = ev.clientY;
      const rawDy = ev.clientY - originY;

      if (!armed) {
        const dxPx = ev.clientX - originX;
        // A clearly horizontal gesture is the day swipe; let it through
        // untouched by ending our involvement.
        if (
          Math.abs(dxPx) > Math.abs(rawDy) &&
          Math.abs(dxPx) > MOVE_TOLERANCE_PX
        ) {
          cleanup(false);
          return;
        }
        if (Math.abs(rawDy) > MOVE_TOLERANCE_PX) {
          scrolling = true;
          window.clearTimeout(holdTimer);
        }
        if (scrolling && pane) pane.scrollTop = paneStartTop - rawDy;
        return;
      }

      ev.preventDefault();
      applyMove();
    };

    const onPointerUp = () => cleanup(true);

    const cleanup = (commit: boolean) => {
      window.clearTimeout(holdTimer);
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* capture was never taken */
      }

      const deltaMin = deltaRef.current;
      const link = linkRef.current;
      const shouldCommit = commit && armed && !scrolling && deltaMin !== 0;

      armed = false;
      deltaRef.current = 0;
      linkRef.current = null;
      onLinkPreview(null);
      setDrag(null);

      // Committed outside the state updater, synchronously, so the write
      // cannot be lost to React's scheduling.
      if (shouldCommit) {
        swallowClickRef.current = true;
        onMove(startMs + deltaMin * MINUTE_MS, link);
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
        onPointerDown={beginDrag}
        onClick={() => {
          if (swallowClickRef.current) {
            swallowClickRef.current = false;
            return;
          }
          if (!drag) onOpen();
        }}
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
          // The ring answers while the finger is still down, so the cost of a
          // drop is known before it is made. Green for a pin, and a warning
          // beats it — a link is a preference, a prayer block is not.
          drag?.link && "ring-success",
          drag?.verdict === "outside" && "ring-warning",
          drag?.verdict === "time-block" && "ring-warning",
          drag?.verdict === "prayer" && "ring-prayer",
          drag?.verdict === "event" && "ring-event",
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
      </div>
    </>
  );
}
