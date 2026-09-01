"use client";

import * as React from "react";

import { AgendaBlock } from "@/components/calendar/agenda-block";
import type { Agenda, IsoDate, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  DAY_HEIGHT,
  HOUR_HEIGHT,
  heightFor,
  layoutOverlaps,
  minutesToPx,
  topFor,
} from "@/lib/calendar/geometry";
import type {
  LinkCandidate,
  PrayerBlock,
  TimeBlockInstance,
  WindowInstance,
} from "@/lib/scheduling";
import { startOfLocalDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export interface TimelineDayProps {
  date: IsoDate;
  timezone: string;
  windows: readonly WindowInstance[];
  timeBlocks: readonly TimeBlockInstance[];
  busy: readonly { start: number; end: number; label?: string }[];
  prayers: readonly PrayerBlock[];
  agendas: readonly Agenda[];
  todosById: Map<UUID, Todo>;
  /** Completed focus pomodoros per agenda, for the §5.7 dot row. */
  completedByAgenda: Map<UUID, number>;
  runningAgendaId: UUID | null;
  nowMs: number | null;
  compact?: boolean;
  onOpenAgenda: (agenda: Agenda) => void;
  onMoveAgenda: (
    agenda: Agenda,
    startMs: number,
    link: LinkCandidate | null,
  ) => void;
  /**
   * What a block dragged to `startMs` would pin itself to. Answered by the
   * screen rather than the column, because cycle detection has to walk the
   * whole follow graph, not just today's blocks.
   */
  linkCandidateAt: (agenda: Agenda, startMs: number) => LinkCandidate | null;
  onCreateAt: (startMs: number) => void;
  onToggleBlockSkip: (block: TimeBlockInstance) => void;
}

/**
 * One day column of the calendar (§7.2).
 *
 * Layer order, back to front, exactly as the brief lists it:
 *   availability window shading → time block bands → GCal busy bands →
 *   prayer blocks → agendas (with buffer stripes) → draft agendas.
 */
export function TimelineDay({
  date,
  timezone,
  windows,
  timeBlocks,
  busy,
  prayers,
  agendas,
  todosById,
  completedByAgenda,
  runningAgendaId,
  nowMs,
  compact = false,
  onOpenAgenda,
  onMoveAgenda,
  linkCandidateAt,
  onCreateAt,
  onToggleBlockSkip,
}: TimelineDayProps) {
  const dayStart = startOfLocalDay(date, timezone).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const clip = (v: { start: number; end: number }) => ({
    start: Math.max(v.start, dayStart),
    end: Math.min(v.end, dayEnd),
  });
  const within = (v: { start: number; end: number }) =>
    v.start < dayEnd && v.end > dayStart;

  const laidOut = React.useMemo(
    () =>
      layoutOverlaps(
        agendas
          .map((agenda) => ({
            agenda,
            start: new Date(agenda.start_at).getTime(),
            end: new Date(agenda.end_at).getTime(),
          }))
          .filter(within),
      ),
    // `within` closes over dayStart/dayEnd, which derive from date+timezone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agendas, dayStart, dayEnd],
  );

  /**
   * The link being offered by the block currently under the finger, if any.
   * Lifted here because the cue belongs to the seam *between* two blocks, not
   * to either one of them.
   */
  const [linkPreview, setLinkPreview] = React.useState<{
    candidate: LinkCandidate;
    follower: Agenda;
  } | null>(null);

  const pressRef = React.useRef<{ timer: number; y: number } | null>(null);

  const cancelPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  return (
    <div
      className="relative select-none"
      style={{ height: DAY_HEIGHT }}
      // §8: long-press on an empty area creates an agenda starting there.
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const timer = window.setTimeout(() => {
          pressRef.current = null;
          onCreateAt(y);
        }, 450);
        pressRef.current = { timer, y };
      }}
      onPointerMove={(e) => {
        if (!pressRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (Math.abs(e.clientY - rect.top - pressRef.current.y) > 6) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
    >
      {/* layer 0 — outside-window shading */}
      <div aria-hidden className="absolute inset-0 bg-surface/40" />
      {windows.filter(within).map((w, i) => {
        const c = clip(w);
        return (
          <div
            key={`w${i}`}
            aria-hidden
            className="absolute inset-x-0 bg-bg"
            style={{ top: topFor(c.start, date, timezone), height: heightFor(c.start, c.end) }}
          />
        );
      })}

      {/* hour grid */}
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          aria-hidden
          className="absolute inset-x-0 border-t border-border/45"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}

      {/* layer 1 — time block bands */}
      {timeBlocks.filter(within).map((block) => {
        const c = clip(block);
        return (
          <div
            key={`${block.timeBlockId}-${block.start}`}
            className="absolute inset-x-0 border-y"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
              backgroundColor: `${block.color}14`,
              borderColor: `${block.color}33`,
            }}
          >
            {/* §4.7: skip this single occurrence. */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBlockSkip(block);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t.settings.timeBlockSkipInstance}
              className="absolute left-1.5 top-0.5 max-w-[80%] truncate text-left text-[10px] font-medium tracking-wide uppercase"
              style={{ color: block.color }}
            >
              {block.name}
            </button>
          </div>
        );
      })}

      {/* layer 2 — busy time from the user's other calendars */}
      {busy.filter(within).map((b, i) => {
        const c = clip(b);
        return (
          <div
            key={`b${i}`}
            className="absolute inset-x-0 flex items-start bg-busy/20 px-1.5 py-0.5"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--busy) 22%, transparent) 6px 12px)",
            }}
          >
            <span className="truncate text-[10px] text-fg-subtle">
              {b.label ?? t.calendar.busy}
            </span>
          </div>
        );
      })}

      {/* layer 3 — prayer blocks (local only, never sent to Google) */}
      {prayers.filter(within).map((p) => {
        const c = clip(p);
        return (
          <div
            key={`${p.key}-${p.start}`}
            className="absolute inset-x-0 border-l-2 border-prayer bg-prayer/12 px-1.5 py-0.5"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
            }}
          >
            <span className="truncate text-[10px] font-medium text-prayer">
              {t.settings.prayerNames[p.key]}
            </span>
          </div>
        );
      })}

      {/* layers 4 & 5 — agendas, then drafts (drafts render last, on top) */}
      {[...laidOut]
        .sort((a, b) =>
          Number(a.item.agenda.status === "draft") -
          Number(b.item.agenda.status === "draft"),
        )
        .map(({ item, column, columns }) => (
          <AgendaBlock
            key={item.agenda.id}
            agenda={item.agenda}
            todo={todosById.get(item.agenda.todo_id)}
            date={date}
            timezone={timezone}
            column={column}
            columns={columns}
            compact={compact}
            completed={completedByAgenda.get(item.agenda.id) ?? 0}
            running={runningAgendaId === item.agenda.id}
            onOpen={() => onOpenAgenda(item.agenda)}
            onMove={(startMs, link) => onMoveAgenda(item.agenda, startMs, link)}
            linkCandidateAt={(startMs) => linkCandidateAt(item.agenda, startMs)}
            onLinkPreview={(candidate) =>
              setLinkPreview(
                candidate ? { candidate, follower: item.agenda } : null,
              )
            }
          />
        ))}

      {/*
        The "immediately after" cue (D-091): a green seam drawn where the
        predecessor's reserved footprint ends and the dragged block's begins.
        With buffers of the same type §5.2 collapses the two into one instant,
        so the usual case is a single line; when they differ, the strip between
        them is tinted so the composed gap is visible too.
      */}
      {linkPreview ? (
        <LinkSeam
          candidate={linkPreview.candidate}
          follower={linkPreview.follower}
          predecessorTitle={
            linkPreview.candidate.predecessor.title_override ??
            todosById.get(linkPreview.candidate.predecessor.todo_id)?.title ??
            t.agenda.title
          }
          date={date}
          timezone={timezone}
        />
      ) : null}

      {/* current-time indicator */}
      {nowMs !== null && nowMs >= dayStart && nowMs < dayEnd ? (
        <div
          aria-label={t.calendar.now}
          className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
          style={{ top: topFor(nowMs, date, timezone) }}
        >
          <span className="-ml-1 size-2 rounded-full bg-danger" />
          <span className="h-px flex-1 bg-danger" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The green cue drawn between a dragged block and the predecessor it would
 * follow.
 *
 * It marks the seam between two *footprints* — the predecessor's end plus its
 * after-buffer, and the follower's start minus its before-buffer — rather than
 * between the two block edges, because the buffers are the thing the link
 * actually preserves (§5.2). Purely informational and never interactive: it
 * must not intercept the pointer that is mid-drag.
 */
function LinkSeam({
  candidate,
  follower,
  predecessorTitle,
  date,
  timezone,
}: {
  candidate: LinkCandidate;
  follower: Agenda;
  predecessorTitle: string;
  date: IsoDate;
  timezone: string;
}) {
  const predecessorEnd =
    topFor(candidate.predecessor.end_at, date, timezone) +
    minutesToPx(candidate.predecessor.buffer_after_min);
  const followerStart =
    topFor(candidate.start, date, timezone) -
    minutesToPx(follower.buffer_before_min);

  const top = Math.min(predecessorEnd, followerStart);
  const gap = Math.abs(followerStart - predecessorEnd);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-30"
      style={{ top }}
    >
      {gap > 1 ? (
        <div className="absolute inset-x-0 bg-success/20" style={{ height: gap }} />
      ) : null}
      <div className="absolute inset-x-0 h-0.5 bg-success" />
      <span className="absolute left-1 top-1 rounded-full bg-success px-1.5 py-px text-[9px] font-semibold text-bg">
        {t.agenda.linkCueLabel(predecessorTitle)}
      </span>
    </div>
  );
}

/** Hour labels for the left gutter, shared by every visible day column. */
export function HourGutter() {
  return (
    <div
      className="relative w-11 shrink-0 border-r border-border"
      style={{ height: DAY_HEIGHT }}
      aria-hidden
    >
      {Array.from({ length: 24 }, (_, hour) => (
        <span
          key={hour}
          className={cn(
            "absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-fg-subtle",
            hour === 0 && "translate-y-0",
          )}
          style={{ top: hour * HOUR_HEIGHT }}
        >
          {String(hour).padStart(2, "0")}
        </span>
      ))}
    </div>
  );
}
