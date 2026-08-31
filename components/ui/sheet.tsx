"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";
import { id } from "@/lib/i18n/id";

/**
 * Bottom sheet — the primary modal surface on mobile.
 * Built on Radix Dialog so focus trapping and Escape handling come for free.
 */

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  children,
  title,
  description,
  footer,
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  title: string;
  description?: string;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
      <Dialog.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl outline-none",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        <div className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0 flex-1">
            <div
              aria-hidden
              className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong"
            />
            {/* Two lines, not one: some titles are whole questions. */}
            <Dialog.Title className="line-clamp-2 text-base font-semibold">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-0.5 text-[13px] text-fg-muted">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close
            aria-label={id.common.close}
            className="mt-3 grid size-9 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="size-4" />
          </Dialog.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {children}
        </div>

        {footer ? (
          <div className="safe-bottom shrink-0 border-t border-border bg-surface px-4 py-3">
            {footer}
          </div>
        ) : (
          <div className="safe-bottom shrink-0" />
        )}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
