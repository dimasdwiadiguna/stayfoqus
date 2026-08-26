"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Standard screen chrome: a sticky header over a single scroll pane.
 * Only this pane scrolls — the shell and tab bar stay fixed so the timeline's
 * drag gestures never fight the document scroll.
 */
export function Screen({
  header,
  children,
  className,
  contentClassName,
  scroll = true,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /**
   * Set false when the screen manages its own scrolling — the calendar's
   * timeline is one tall pane and must not sit inside a second scroller.
   */
  scroll?: boolean;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {header ? (
        <header className="safe-top sticky top-0 z-20 shrink-0 border-b border-border bg-bg/95 backdrop-blur">
          <div className="mx-auto max-w-md px-4 py-2.5">{header}</div>
        </header>
      ) : null}
      <div
        className={cn(
          "min-h-0 flex-1",
          scroll && "overflow-y-auto overscroll-contain",
          contentClassName,
        )}
      >
        <div className={cn("mx-auto max-w-md", !scroll && "h-full")}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function ScreenTitle({
  title,
  actions,
}: {
  title: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
      <p className="text-sm text-fg-muted">{title}</p>
      {hint ? <p className="text-[13px] text-fg-subtle">{hint}</p> : null}
      {action}
    </div>
  );
}
