"use client";

import { CalendarDays, MapPin, Repeat } from "lucide-react";

import { BufferBand } from "@/components/calendar/buffer-band";
import { heightFor, minutesToPx, topFor } from "@/lib/calendar/geometry";
import type { IsoDate } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import type { EventInstance } from "@/lib/scheduling";
import { formatTimeRange, localTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * One event on the timeline.
 *
 * It has to be unmistakable against an agenda, and colour alone cannot carry
 * that — so the two differ in three ways at once:
 *
 *   agenda — soft accent fill, a 1px border all round, pomodoro dots
 *   event  — rose tint, a solid 3px bar down the left, an icon and a location
 *
 * No drag: an event is edited in its sheet. Where an agenda's time is something
 * the scheduler keeps negotiating, an event's is a fact about the world.
 */
export function EventBlock({
  event,
  date,
  timezone,
  column,
  columns,
  compact,
  repeats,
  onOpen,
}: {
  event: EventInstance;
  date: IsoDate;
  timezone: string;
  column: number;
  columns: number;
  compact?: boolean;
  /** Shows the repeat mark, so a weekly commitment reads as one. */
  repeats: boolean;
  onOpen: () => void;
}) {
  const top = topFor(event.start, date, timezone);
  const height = heightFor(event.start, event.end);
  const width = `calc(${100 / columns}% - 4px)`;
  const left = `calc(${(column * 100) / columns}% + 2px)`;

  const timeRange = formatTimeRange(
    new Date(event.start).toISOString(),
    new Date(event.end).toISOString(),
    timezone,
  );
  /**
   * Height alone, not `compact` — see the same note on `AgendaBlock`. A tall
   * event in a narrow 3-day column has room to stack; forcing its range onto
   * the title's row left roughly one character of the title visible.
   */
  const short = height < 40;
  /** Only the start time where a narrow one-line block cannot fit the range. */
  const stamp = short && compact
    ? localTime(new Date(event.start).toISOString(), timezone)
    : timeRange;
  const Icon = event.location ? MapPin : CalendarDays;

  return (
    <>
      {/* Buffers use the same bands as an agenda: one language for one idea. */}
      <BufferBand
        type={event.bufferBefore.type}
        minutes={event.bufferBefore.min}
        side="before"
        top={top - minutesToPx(event.bufferBefore.min)}
        height={minutesToPx(event.bufferBefore.min)}
        left={left}
        width={width}
        dimmed={event.skipped}
      />
      <BufferBand
        type={event.bufferAfter.type}
        minutes={event.bufferAfter.min}
        side="after"
        top={top + height}
        height={minutesToPx(event.bufferAfter.min)}
        left={left}
        width={width}
        dimmed={event.skipped}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={`${event.title} ${timeRange}`}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "absolute z-10 overflow-hidden rounded-md border border-event/40 bg-event/15 py-1 pr-1.5 pl-2 text-left",
          // The solid bar is the tell that survives at any height.
          "border-l-[3px] border-l-event",
          // A skipped occurrence stays on the timeline as a ghost so it can be
          // tapped back; it just stops claiming the time.
          event.skipped && "opacity-45",
        )}
        style={{ top, height, left, width }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <Icon className="size-3 shrink-0 text-event" aria-hidden />
          <span
            className={cn(
              "min-w-0 flex-1 text-[12px] font-medium leading-tight",
              // One line beside the time on a short block; two when it stacks,
              // because a narrow 3-day column otherwise shows "B…" and no more.
              short ? "truncate" : "line-clamp-2",
              event.skipped && "line-through",
            )}
          >
            {event.title}
          </span>
          {repeats ? (
            <Repeat
              className="size-3 shrink-0 text-event/70"
              aria-label={t.event.repeats}
            />
          ) : null}
          {short ? (
            <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">
              {stamp}
            </span>
          ) : null}
        </div>

        {short ? null : (
          <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-[10px] text-fg-muted">
            <span className="shrink-0 tabular-nums">{timeRange}</span>
            {event.location ? (
              <span className="min-w-0 flex-1 truncate">{event.location}</span>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
