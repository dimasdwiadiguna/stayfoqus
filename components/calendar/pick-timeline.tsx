"use client";

import { Link2, Link2Off } from "lucide-react";
import * as React from "react";

import { BufferBand } from "@/components/calendar/buffer-band";
import { Button } from "@/components/ui/button";
import type { Agenda, IsoDate, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import {
  DAY_HEIGHT,
  HOUR_HEIGHT,
  MOVE_SNAP_MIN,
  heightFor,
  instantForPx,
  minutesToPx,
  pxToMinutes,
  snapMinutes,
  topFor,
} from "@/lib/calendar/geometry";
import type {
  BufferSide,
  PrayerBlock,
  TimeBlockInstance,
  WindowInstance,
} from "@/lib/scheduling";
import { abuttingPredecessor } from "@/lib/scheduling";
import { MINUTE_MS, formatDateWithWeekday, localTime, startOfLocalDay } from "@/lib/time";
import { cn } from "@/lib/utils";

const MINUTE = MINUTE_MS;

export interface PickDraft {
  date: IsoDate;
  start: number;
  end: number;
  /** Set when the draft is pinned to another agenda's buffer end. */
  followsAgendaId: UUID | null;
}

/**
 * The "Kalender" way of choosing a slot.
 *
 * A compact 2–3 day timeline showing the same obstacles the scheduler sees.
 * Tapping empty space drops a draft already sized to the estimate, so the
 * question is only *where*, never *how long* — the duration was answered
 * before this tab opened.
 *
 * The draft can then be dragged. When it comes to rest against a neighbour's
 * buffer, the "immediately after" offer appears: pin it to that agenda's end
 * rather than to a clock time, so it follows if the neighbour ever moves.
 */
export function PickTimeline({
  days,
  timezone,
  windows,
  prayers,
  timeBlocks,
  agendas,
  busy,
  durationMin,
  buffers,
  draft,
  onChange,
  notBefore,
}: {
  days: IsoDate[];
  timezone: string;
  windows: readonly WindowInstance[];
  prayers: readonly PrayerBlock[];
  timeBlocks: readonly TimeBlockInstance[];
  agendas: readonly Agenda[];
  busy: readonly { start: number; end: number }[];
  durationMin: number;
  buffers: { before: BufferSide; after: BufferSide };
  draft: PickDraft | null;
  onChange: (draft: PickDraft | null) => void;
  notBefore: number;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const scrolledRef = React.useRef(false);

  // Open on the earliest time anything could actually go — the later of the
  // day's window and `notBefore`. Opening on the window start would show a
  // band of already-unavailable hours when planning late in the day.
  React.useEffect(() => {
    if (scrolledRef.current) return;
    const first = windows.find((w) => w.date === days[0]);
    const anchorMs = Math.max(
      first ? first.start : notBefore,
      Number.isFinite(notBefore) ? notBefore : 0,
    );
    const hour = new Date(anchorMs).getHours();

    let frame = 0;
    let attempts = 0;
    const apply = () => {
      const el = scrollRef.current;
      if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
        el.scrollTop = Math.max(0, (hour - 1) * HOUR_HEIGHT);
        scrolledRef.current = true;
        return;
      }
      if (attempts++ < 20) frame = requestAnimationFrame(apply);
    };
    frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [days, windows, notBefore]);

  /** Places or moves the draft, snapping to the same 5-minute grid as §8. */
  const place = React.useCallback(
    (date: IsoDate, px: number) => {
      // Snap *after* clamping, or a tap in the past would land on an unsnapped
      // "now" like 23:49 rather than on the grid the rest of the app uses.
      const raw = Math.max(instantForPx(px, date, timezone, MOVE_SNAP_MIN), notBefore);
      const step = MOVE_SNAP_MIN * MINUTE;
      const start = Math.ceil(raw / step) * step;
      onChange({
        date,
        start,
        end: start + durationMin * MINUTE,
        followsAgendaId: null,
      });
    },
    [durationMin, notBefore, onChange, timezone],
  );

  /** The neighbour this draft is currently butted against, if any. */
  const neighbour = React.useMemo(() => {
    if (!draft) return null;
    return abuttingPredecessor(agendas, {
      start: draft.start,
      bufferBefore: buffers.before,
    });
  }, [draft, agendas, buffers.before]);

  const linked = draft?.followsAgendaId != null;

  return (
    <div className="space-y-2">
      <div
        ref={scrollRef}
        className="no-scrollbar h-[46dvh] overflow-y-auto overscroll-contain rounded-lg border border-border"
      >
        <div className="flex">
          <div
            className="relative w-9 shrink-0 border-r border-border"
            style={{ height: DAY_HEIGHT }}
            aria-hidden
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[9px] tabular-nums text-fg-subtle"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {String(hour).padStart(2, "0")}
              </span>
            ))}
          </div>

          {days.map((date) => (
            <PickDay
              key={date}
              date={date}
              timezone={timezone}
              windows={windows.filter((w) => w.date === date)}
              prayers={prayers.filter((p) => p.date === date)}
              timeBlocks={timeBlocks.filter((b) => b.date === date)}
              agendas={agendas}
              busy={busy}
              draft={draft?.date === date ? draft : null}
              durationMin={durationMin}
              buffers={buffers}
              notBefore={notBefore}
              onPlace={(px) => place(date, px)}
              onDrag={(start) =>
                onChange({
                  date,
                  start,
                  end: start + durationMin * MINUTE,
                  // Dragging by hand overrides a pin; the user just chose a time.
                  followsAgendaId: null,
                })
              }
            />
          ))}
        </div>
      </div>

      {draft ? (
        <div className="space-y-2">
          <p className="text-center text-[13px] tabular-nums text-fg-muted">
            {formatDateWithWeekday(draft.date)} ·{" "}
            {localTime(new Date(draft.start), timezone)}–
            {localTime(new Date(draft.end), timezone)}
          </p>

          {neighbour || linked ? (
            <Button
              block
              variant={linked ? "primary" : "secondary"}
              onClick={() =>
                onChange({
                  ...draft,
                  followsAgendaId: linked ? null : (neighbour?.id ?? null),
                })
              }
            >
              {linked ? (
                <Link2Off className="size-4" />
              ) : (
                <Link2 className="size-4" />
              )}
              {linked ? t.agenda.unlinkImmediatelyAfter : t.agenda.immediatelyAfter}
            </Button>
          ) : null}

          {linked ? (
            <p className="text-center text-[12px] text-fg-subtle">
              {t.agenda.immediatelyAfterHint}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-[13px] text-fg-subtle">
          {t.agenda.tapToPlace}
        </p>
      )}
    </div>
  );
}

function PickDay({
  date,
  timezone,
  windows,
  prayers,
  timeBlocks,
  agendas,
  busy,
  draft,
  durationMin,
  buffers,
  notBefore,
  onPlace,
  onDrag,
}: {
  date: IsoDate;
  timezone: string;
  windows: readonly WindowInstance[];
  prayers: readonly PrayerBlock[];
  timeBlocks: readonly TimeBlockInstance[];
  agendas: readonly Agenda[];
  busy: readonly { start: number; end: number }[];
  draft: PickDraft | null;
  durationMin: number;
  buffers: { before: BufferSide; after: BufferSide };
  notBefore: number;
  onPlace: (px: number) => void;
  onDrag: (start: number) => void;
}) {
  const dayStart = startOfLocalDay(date, timezone).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const within = (v: { start: number; end: number }) =>
    v.start < dayEnd && v.end > dayStart;
  const clip = (v: { start: number; end: number }) => ({
    start: Math.max(v.start, dayStart),
    end: Math.min(v.end, dayEnd),
  });

  const dragRef = React.useRef<{ originY: number; startAt: number } | null>(null);
  const [dragDelta, setDragDelta] = React.useState(0);

  const draftTop = draft
    ? topFor(draft.start, date, timezone) + minutesToPx(dragDelta)
    : 0;
  const draftHeight = minutesToPx(durationMin);

  return (
    <div
      className="relative min-w-0 flex-1 border-r border-border/60 last:border-r-0"
      style={{ height: DAY_HEIGHT }}
      onClick={(e) => {
        // Only a tap on bare column space places a draft; the draft itself
        // stops propagation so tapping it never re-places it elsewhere.
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        onPlace(e.clientY - rect.top);
      }}
    >
      {/* Every decorative layer is pointer-transparent: the column itself has
          to receive the tap that places the draft. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-surface/40"
      />
      {windows.filter(within).map((w, i) => {
        const c = clip(w);
        return (
          <div
            key={`w${i}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-bg"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
            }}
          />
        );
      })}

      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-border/40"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}

      {/* Past time is not a candidate, so it is shaded out. */}
      {notBefore > dayStart ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 bg-bg/70"
          style={{ height: Math.max(0, topFor(Math.min(notBefore, dayEnd), date, timezone)) }}
        />
      ) : null}

      {timeBlocks.filter(within).map((block) => {
        const c = clip(block);
        return (
          <div
            key={`${block.timeBlockId}-${block.start}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
              backgroundColor: `${block.color}12`,
            }}
          />
        );
      })}

      {busy.filter(within).map((b, i) => {
        const c = clip(b);
        return (
          <div
            key={`b${i}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-busy/25"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
            }}
          />
        );
      })}

      {prayers.filter(within).map((p) => {
        const c = clip(p);
        return (
          <div
            key={`${p.key}-${p.start}`}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-l-2 border-prayer bg-prayer/12"
            style={{
              top: topFor(c.start, date, timezone),
              height: heightFor(c.start, c.end),
            }}
          />
        );
      })}

      {/* Existing agendas, read-only, with their buffers — the things the new
          block has to fit between. */}
      {agendas
        .map((agenda) => ({
          agenda,
          start: new Date(agenda.start_at).getTime(),
          end: new Date(agenda.end_at).getTime(),
        }))
        .filter(within)
        .map(({ agenda, start, end }) => (
          <React.Fragment key={agenda.id}>
            <BufferBand
              type={agenda.buffer_before_type}
              minutes={agenda.buffer_before_min}
              side="before"
              top={
                topFor(start, date, timezone) -
                minutesToPx(agenda.buffer_before_min)
              }
              height={minutesToPx(agenda.buffer_before_min)}
              left="2px"
              width="calc(100% - 4px)"
            />
            <BufferBand
              type={agenda.buffer_after_type}
              minutes={agenda.buffer_after_min}
              side="after"
              top={topFor(end, date, timezone)}
              height={minutesToPx(agenda.buffer_after_min)}
              left="2px"
              width="calc(100% - 4px)"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-sm border border-accent/40 bg-accent-soft/70 px-1 text-[9px] leading-tight text-fg-muted"
              style={{
                top: topFor(start, date, timezone),
                height: heightFor(start, end),
                left: 2,
                right: 2,
              }}
            >
              {localTime(new Date(start), timezone)}
            </div>
          </React.Fragment>
        ))}

      {/* the draft being placed */}
      {draft ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t.agenda.tapToPlace}
          className={cn(
            "absolute z-20 rounded-md border-2 border-dashed px-1.5 py-1 text-[11px] font-medium shadow-lg",
            draft.followsAgendaId
              ? "border-success bg-success/20 text-success"
              : "border-accent bg-accent-soft text-fg",
          )}
          style={{
            top: draftTop,
            height: draftHeight,
            left: 2,
            right: 2,
            touchAction: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            const target = e.currentTarget;
            dragRef.current = { originY: e.clientY, startAt: draft.start };
            try {
              target.setPointerCapture(e.pointerId);
            } catch {
              /* pointer already gone */
            }
          }}
          onPointerMove={(e) => {
            const origin = dragRef.current;
            if (!origin) return;
            e.preventDefault();
            setDragDelta(
              snapMinutes(pxToMinutes(e.clientY - origin.originY), MOVE_SNAP_MIN),
            );
          }}
          onPointerUp={() => {
            const origin = dragRef.current;
            dragRef.current = null;
            if (!origin) return;
            // Committed outside any state updater, for the same reason as the
            // calendar's own drag — see components/calendar/agenda-block.tsx.
            const step = MOVE_SNAP_MIN * MINUTE;
            const raw = Math.max(origin.startAt + dragDelta * MINUTE, notBefore);
            const next = Math.ceil(raw / step) * step;
            setDragDelta(0);
            if (next !== origin.startAt) onDrag(next);
          }}
        >
          {localTime(new Date(draft.start + dragDelta * MINUTE), timezone)}
        </div>
      ) : null}

      {/* the draft's own buffers, so the space it really needs is visible */}
      {draft ? (
        <>
          <BufferBand
            type={buffers.before.type}
            minutes={buffers.before.min}
            side="before"
            top={draftTop - minutesToPx(buffers.before.min)}
            height={minutesToPx(buffers.before.min)}
            left="2px"
            width="calc(100% - 4px)"
            dimmed
          />
          <BufferBand
            type={buffers.after.type}
            minutes={buffers.after.min}
            side="after"
            top={draftTop + draftHeight}
            height={minutesToPx(buffers.after.min)}
            left="2px"
            width="calc(100% - 4px)"
            dimmed
          />
        </>
      ) : null}
    </div>
  );
}
