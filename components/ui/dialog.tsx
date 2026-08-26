"use client";

import { Dialog as D } from "radix-ui";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { id } from "@/lib/i18n/id";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof D.Content> & {
  title: string;
  description?: string;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[60] bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in" />
      <D.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card border border-border bg-surface p-4 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      >
        <D.Title className="text-[15px] font-semibold">{title}</D.Title>
        {description ? (
          <D.Description className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
            {description}
          </D.Description>
        ) : (
          <D.Description className="sr-only">{title}</D.Description>
        )}
        {children}
      </D.Content>
    </D.Portal>
  );
}

export type ConfirmTone = "default" | "danger";

/**
 * Confirmation dialog. §5 calls for soft warnings that never hard-block, so the
 * cancel action is always present and the confirm label is caller-supplied.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = id.common.cancel,
  tone = "default",
  onConfirm,
  onCancel,
  extraActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  /**
   * Runs when the user picks the *cancel* action explicitly. Some §5.9 prompts
   * make both answers meaningful ("Hapus agenda?" / "Biarkan"), so cancel is not
   * always a no-op. Dismissing with Escape or the overlay never fires it.
   */
  onCancel?: () => void;
  extraActions?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        {extraActions ? <div className="mt-3">{extraActions}</div> : null}
        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            block
            onClick={() => {
              onCancel?.();
              onOpenChange(false);
            }}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            block
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
