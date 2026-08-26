"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export function Section({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-5 last:border-b-0">
      <h2 className="text-[13px] font-semibold tracking-wide text-fg-subtle uppercase">
        {title}
      </h2>
      {blurb ? (
        <p className="mt-1 text-[12px] leading-relaxed text-fg-subtle">{blurb}</p>
      ) : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  control,
  className,
}: {
  label: string;
  hint?: string;
  control: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="text-[15px]">{label}</div>
        {hint ? <div className="text-[12px] text-fg-subtle">{hint}</div> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** Compact numeric stepper used throughout Settings. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  label: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label={`${label} −`}
        onClick={() => onChange(clamp(value - step))}
        className="grid size-9 place-items-center rounded-md border border-border bg-surface-2 hover:bg-surface-3"
      >
        −
      </button>
      <span className="w-14 text-center text-[15px] font-medium tabular-nums">
        {value}
        {suffix ? <span className="text-[11px] text-fg-subtle"> {suffix}</span> : null}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        onClick={() => onChange(clamp(value + step))}
        className="grid size-9 place-items-center rounded-md border border-border bg-surface-2 hover:bg-surface-3"
      >
        +
      </button>
    </div>
  );
}
