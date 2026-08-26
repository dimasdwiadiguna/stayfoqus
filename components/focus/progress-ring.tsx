"use client";

import { cn } from "@/lib/utils";

/**
 * The large circular progress ring on the Focus screen (§7.4), also used at a
 * smaller size for the daily progress ring in the Tasks header (§9).
 */
export function ProgressRing({
  progress,
  size = 260,
  stroke = 10,
  tone = "accent",
  pulse = false,
  children,
  className,
  label,
}: {
  /** 0..1 */
  progress: number;
  size?: number;
  stroke?: number;
  tone?: "accent" | "success" | "overtime" | "prayer";
  pulse?: boolean;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = circumference * clamped;

  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "overtime"
        ? "var(--overtime)"
        : tone === "prayer"
          ? "var(--prayer)"
          : "var(--accent)";

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("-rotate-90", pulse && "animate-pulse")}
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          // The transition is short enough to feel immediate at 1 Hz and is
          // collapsed to nothing under prefers-reduced-motion by globals.css.
          style={{ transition: "stroke-dasharray 240ms linear" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
