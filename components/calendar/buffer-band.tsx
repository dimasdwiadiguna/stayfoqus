"use client";

import { ArrowRightLeft, Car } from "lucide-react";

import type { BufferType } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * §5.2 — the buffer, drawn as the block of time it actually is.
 *
 * The brief calls for "a thin, muted stripe attached to the agenda block", and
 * that is what this was: two 2px lines inside the block's own edges. It was
 * effectively invisible and, worse, gave no way to tell the two types apart —
 * which matters, because they compose differently (`max` within a type, `+`
 * across) and a user cannot reason about a gap they cannot see.
 *
 * The band now occupies the real minutes the buffer consumes, immediately
 * before or after the block, so the schedulable space it eats is visible at a
 * glance. It stays muted and clearly subordinate: no border on the outer edge,
 * lower contrast than any agenda, and it never intercepts a pointer.
 *
 * The two types are distinguished three ways over, so neither colour alone nor
 * pattern alone has to carry it:
 *
 *   switch  — cool slate, horizontal weave, ⇄ icon: a mental reset, sitting still
 *   commute — warm bronze, diagonal stripes, car icon: physical travel
 */
export function BufferBand({
  type,
  minutes,
  side,
  top,
  height,
  left,
  width,
  dimmed,
}: {
  type: BufferType;
  minutes: number;
  side: "before" | "after";
  top: number;
  height: number;
  left: string;
  width: string;
  /** Drafts render their buffers fainter, matching the dashed block. */
  dimmed?: boolean;
}) {
  if (minutes <= 0 || height <= 0) return null;

  const commute = type === "commute";
  const color = commute ? "var(--buffer-commute)" : "var(--buffer-switch)";
  const typeLabel = commute ? t.agenda.bufferCommute : t.agenda.bufferSwitch;
  const label =
    side === "before"
      ? t.agenda.bufferBeforeLabel(formatDuration(minutes), typeLabel)
      : t.agenda.bufferAfterLabel(formatDuration(minutes), typeLabel);

  const Icon = commute ? Car : ArrowRightLeft;

  // Diagonal for travel, horizontal for sitting still.
  //
  // Both are deliberately faint. §5.2 asks for something "thin, muted" and the
  // buffer must never compete with the agenda it belongs to — an earlier pass
  // used denser stripes and the commute band read as the louder of the two,
  // which inverts the hierarchy. The gaps are wider than the strokes so a run
  // of buffers stays calm.
  const stripes = commute
    ? `repeating-linear-gradient(135deg, transparent 0 7px, color-mix(in srgb, ${color} 24%, transparent) 7px 11px)`
    : `repeating-linear-gradient(0deg, transparent 0 5px, color-mix(in srgb, ${color} 22%, transparent) 5px 8px)`;

  return (
    <div
      // Purely informative and never a drag target — the block above owns the
      // gesture, and a band would otherwise steal the touch that starts on it.
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-[5] overflow-hidden rounded-sm",
        dimmed && "opacity-55",
      )}
      style={{
        top,
        height,
        left,
        width,
        backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
        backgroundImage: stripes,
        // The edge that touches the agenda is solid, so the band reads as
        // belonging to that block rather than floating between two of them.
        [side === "before" ? "borderBottom" : "borderTop"]:
          `1.5px solid color-mix(in srgb, ${color} 50%, transparent)`,
      }}
      title={label}
    >
      {height >= 15 ? (
        <span
          className="flex h-full items-center gap-1 px-1.5 text-[9px] leading-none font-medium tracking-tight opacity-80"
          style={{ color }}
        >
          <Icon className="size-2.5 shrink-0" strokeWidth={2.5} />
          {height >= 22 ? (
            <span className="truncate">{formatDuration(minutes)}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Shared swatch, so the legend and the agenda sheet match the timeline. */
export function BufferSwatch({
  type,
  className,
}: {
  type: BufferType;
  className?: string;
}) {
  const commute = type === "commute";
  const color = commute ? "var(--buffer-commute)" : "var(--buffer-switch)";
  const Icon = commute ? Car : ArrowRightLeft;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium",
        className,
      )}
      style={{ color }}
    >
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-[3px]"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
          backgroundImage: commute
            ? `repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, ${color} 55%, transparent) 2px 4px)`
            : `repeating-linear-gradient(0deg, transparent 0 2px, color-mix(in srgb, ${color} 45%, transparent) 2px 3px)`,
          border: `1px solid color-mix(in srgb, ${color} 55%, transparent)`,
        }}
      />
      <Icon className="size-3 shrink-0" strokeWidth={2.5} />
      {commute ? t.agenda.bufferCommute : t.agenda.bufferSwitch}
    </span>
  );
}
