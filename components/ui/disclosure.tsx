"use client";

import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A labelled fold.
 *
 * Every surface in this app has the same shape of problem: four or five
 * controls that decide the thing, and four or five more that are set once and
 * then scrolled past forever. Folding the second group costs one tap on the
 * rare occasion it is wanted and gives back its rows every other time.
 *
 * The summary is a real `<button>` with `aria-expanded`, not a `<details>`:
 * `<details>` cannot be animated or styled consistently across the two target
 * browsers, and the content here is form fields whose mount cost is nothing.
 */
export function Disclosure({
  label,
  defaultOpen = false,
  children,
  className,
  contentClassName,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-1.5 text-[13px] font-medium text-fg-muted hover:text-fg"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-4 transition-transform", open && "rotate-90")}
        />
        {label}
      </button>
      {open ? <div className={contentClassName}>{children}</div> : null}
    </div>
  );
}
