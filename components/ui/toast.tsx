"use client";

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { create } from "zustand";

import { cn } from "@/lib/utils";

export type ToastTone = "default" | "success" | "danger";

export interface ToastAction {
  label: string;
  /** Runs when the user taps the action; the toast dismisses immediately after. */
  onAction: () => void;
}

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
  action?: ToastAction;
  /**
   * Runs when the toast expires *without* the action being taken.
   * This is where a deferred destructive commit belongs.
   */
  onExpire?: () => void;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id" | "tone" | "durationMs"> &
    Partial<Pick<Toast, "tone" | "durationMs">>) => string;
  dismiss: (id: string, viaAction: boolean) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id = crypto.randomUUID();
    const toast: Toast = {
      id,
      tone: input.tone ?? "default",
      durationMs: input.durationMs ?? 5000,
      message: input.message,
      action: input.action,
      onExpire: input.onExpire,
    };
    set((s) => ({ toasts: [...s.toasts.slice(-2), toast] }));
    return id;
  },
  dismiss: (id, viaAction) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast) return;
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    if (!viaAction) toast.onExpire?.();
  },
}));

export const toast = {
  show: (message: string, opts?: Partial<Omit<Toast, "id" | "message">>) =>
    useToastStore.getState().push({ message, ...opts }),
  success: (message: string) =>
    useToastStore.getState().push({ message, tone: "success" }),
  error: (message: string) =>
    useToastStore.getState().push({ message, tone: "danger" }),
  /**
   * Optimistic-undo helper: the caller has already applied the change locally.
   * `onUndo` reverts it; if the window lapses the toast simply disappears.
   */
  undoable: (
    message: string,
    onUndo: () => void,
    opts?: { label?: string; durationMs?: number; onExpire?: () => void },
  ) =>
    useToastStore.getState().push({
      message,
      durationMs: opts?.durationMs ?? 5000,
      action: { label: opts?.label ?? "Urungkan", onAction: onUndo },
      onExpire: opts?.onExpire,
    }),
};

function ToastItem({ item }: { item: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);

  React.useEffect(() => {
    const t = setTimeout(() => dismiss(item.id, false), item.durationMs);
    return () => clearTimeout(t);
  }, [dismiss, item.id, item.durationMs]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-xl border px-3.5 py-3 shadow-xl backdrop-blur",
        item.tone === "danger"
          ? "border-danger/40 bg-surface-2"
          : item.tone === "success"
            ? "border-success/40 bg-surface-2"
            : "border-border bg-surface-2",
      )}
    >
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        {item.message}
      </span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onAction();
            dismiss(item.id, true);
          }}
          className="shrink-0 rounded-md px-2 py-1 text-[13px] font-semibold text-accent hover:bg-surface-3"
        >
          {item.action.label}
        </button>
      ) : null}
    </motion.div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-[80] mx-auto flex max-w-md flex-col gap-2 px-3">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} item={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
