"use client";

import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A settings section, optionally folded.
 *
 * Settings is ten sections in one scroll, and half of them are answered once
 * and never opened again: the productive hours, the location, the default
 * buffers, the prayer durations, the time blocks. Left expanded they put
 * roughly thirty controls above Pomodoro, Kategori and Tampilan, which are the
 * three that get touched.
 *
 * `collapsible` folds a section and remembers the choice per section, so the
 * order stays the one the brief specifies (§7.5) while the scroll follows what
 * this user actually opens.
 */
export function Section({
  title,
  blurb,
  collapsible = false,
  storageKey,
  children,
}: {
  title: string;
  blurb?: string;
  collapsible?: boolean;
  /** Stable id for the remembered open state. Required when collapsible. */
  storageKey?: string;
  children: React.ReactNode;
}) {
  /*
   * Seeded during render rather than pushed from an effect (D-071). That is
   * safe here and only here: `BootGate` renders nothing until IndexedDB is
   * ready on the client, so no settings section is ever server-rendered and
   * there is no first paint for this value to disagree with.
   */
  const [open, setOpen] = React.useState(() => {
    if (!collapsible || !storageKey) return true;
    try {
      return window.localStorage.getItem(sectionKey(storageKey)) === "1";
    } catch {
      // A browser with storage disabled simply does not remember.
      return false;
    }
  });

  const toggle = () => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      if (storageKey) {
        try {
          window.localStorage.setItem(sectionKey(storageKey), next ? "1" : "0");
        } catch {
          // As above.
        }
      }
      return next;
    });
  };

  return (
    <section className="border-b border-border px-4 py-3.5 last:border-b-0">
      {collapsible ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className="tap-44 -my-1 flex w-full items-center gap-1 py-1 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-fg-subtle transition-transform",
              open && "rotate-90",
            )}
          />
          <h2 className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
            {title}
          </h2>
        </button>
      ) : (
        <h2 className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
          {title}
        </h2>
      )}
      {open ? (
        <>
          {blurb ? (
            <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">
              {blurb}
            </p>
          ) : null}
          <div className="mt-2 space-y-2">{children}</div>
        </>
      ) : null}
    </section>
  );
}

const sectionKey = (id: string) => `foqus.settings.section.${id}`;

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
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <div className="min-w-0">
        <div className="text-[13px]">{label}</div>
        {hint ? <div className="text-[11px] text-fg-subtle">{hint}</div> : null}
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
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`${label} −`}
        onClick={() => onChange(clamp(value - step))}
        className="tap-44 grid size-9 place-items-center rounded-md border border-border bg-surface-2 hover:bg-surface-3"
      >
        −
      </button>
      <span className="w-12 text-center text-[15px] font-medium tabular-nums">
        {value}
        {suffix ? <span className="text-[11px] text-fg-subtle"> {suffix}</span> : null}
      </span>
      <button
        type="button"
        aria-label={`${label} +`}
        onClick={() => onChange(clamp(value + step))}
        className="tap-44 grid size-9 place-items-center rounded-md border border-border bg-surface-2 hover:bg-surface-3"
      >
        +
      </button>
    </div>
  );
}
