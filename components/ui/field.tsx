"use client";

import { Checkbox as C, Select as S, Slider as Sl, Switch as Sw } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  children,
  className,
  htmlFor,
}: {
  label?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-[13px] font-medium text-fg-muted"
        >
          {label}
        </label>
      ) : null}
      {children}
      {hint ? <p className="text-[12px] text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

const controlClass =
  "w-full rounded-lg border border-border bg-surface-2 px-3 text-[15px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none";

// React 19 passes `ref` as an ordinary prop, so ComponentProps is enough —
// no forwardRef wrapper needed for the callers that focus these fields.
export function Input({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return <input className={cn(controlClass, "h-11", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(controlClass, "min-h-[88px] resize-y py-2.5", className)}
      {...props}
    />
  );
}

export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof Sw.Root>) {
  return (
    <Sw.Root
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-surface-3 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <Sw.Thumb className="block size-4 translate-x-1 rounded-full bg-fg-muted transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-accent-fg" />
    </Sw.Root>
  );
}

export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-md border-2 border-border-strong text-accent-fg transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}

export function Slider({
  className,
  ...props
}: React.ComponentProps<typeof Sl.Root>) {
  return (
    <Sl.Root
      className={cn(
        "relative flex h-11 w-full touch-none items-center select-none",
        className,
      )}
      {...props}
    >
      <Sl.Track className="relative h-1.5 w-full grow rounded-full bg-surface-3">
        <Sl.Range className="absolute h-full rounded-full bg-accent" />
      </Sl.Track>
      <Sl.Thumb className="block size-5 rounded-full border-2 border-accent bg-surface shadow" />
    </Sl.Root>
  );
}

export function Select({
  value,
  onValueChange,
  items,
  placeholder,
  className,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: ReadonlyArray<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          controlClass,
          "flex h-11 items-center justify-between gap-2 text-left",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <ChevronDown className="size-4 text-fg-muted" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          className="z-[70] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-2 shadow-xl"
        >
          <S.Viewport className="p-1">
            {items.map((it) => (
              <S.Item
                key={it.value}
                value={it.value}
                className="flex h-10 cursor-default items-center justify-between rounded-md px-2.5 text-[15px] outline-none data-[highlighted]:bg-surface-3"
              >
                <S.ItemText>{it.label}</S.ItemText>
                <S.ItemIndicator>
                  <Check className="size-4 text-accent" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

/** Horizontal segmented control used for view switches and grouping toggles. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-lg border border-border bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "min-h-9 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === opt.value
              ? "bg-accent text-accent-fg"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A pill toggle.
 *
 * `size="sm"` is for rows that scroll horizontally rather than wrap: it trades
 * 4 px of height for one more chip on a 390 px screen, and buys the touch
 * target back with an invisible 8 px band above and below (M10's ≥44 px rule).
 * That band would overlap the next line in a wrapping row, so the small size
 * belongs only in single-row contexts.
 */
export function Chip({
  active,
  size = "md",
  className,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  size?: "md" | "sm";
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "relative inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap transition-colors",
        size === "sm"
          ? "min-h-7 px-2.5 text-[12px] before:absolute before:inset-x-0 before:-top-2 before:-bottom-2 before:content-['']"
          : "min-h-8 px-3 text-[13px]",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface-2 text-fg-muted hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
