"use client";

import { agendaDots, type PomodoroDot } from "@/lib/todos/derived";
import { cn } from "@/lib/utils";

/**
 * §5.7 — allocation rendered as a row of small circles:
 *   ○ allocated but unused · ● completed · ◐ in progress · accent = overtime.
 */
export function PomodoroDots({
  allocated,
  completed,
  running,
  className,
  size = 7,
}: {
  allocated: number;
  completed: number;
  running: boolean;
  className?: string;
  size?: number;
}) {
  const dots = agendaDots(allocated, completed, running);
  if (dots.length === 0) return null;

  const label = `${completed}/${allocated}`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("flex flex-wrap items-center gap-[3px]", className)}
    >
      {dots.map((dot, i) => (
        <Dot key={i} kind={dot} size={size} />
      ))}
    </span>
  );
}

function Dot({ kind, size }: { kind: PomodoroDot; size: number }) {
  const style = { width: size, height: size } as const;

  if (kind === "filled") {
    return (
      <span
        aria-hidden
        style={style}
        className="rounded-full bg-accent transition-colors"
      />
    );
  }
  if (kind === "overtime") {
    return (
      <span aria-hidden style={style} className="rounded-full bg-overtime" />
    );
  }
  if (kind === "running") {
    // Half-filled: a conic gradient reads as "in progress" at 7px where a
    // dashed border would just look like noise.
    return (
      <span
        aria-hidden
        style={{
          ...style,
          background:
            "conic-gradient(var(--accent) 0 50%, color-mix(in srgb, var(--accent) 25%, transparent) 50% 100%)",
        }}
        className="animate-pulse rounded-full"
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className="rounded-full border border-accent/55"
    />
  );
}
