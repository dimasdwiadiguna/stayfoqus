"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import * as React from "react";

import { cn } from "@/lib/utils";

const ACTION_WIDTH = 84;
const COMPLETE_THRESHOLD = 96;

export interface SwipeAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  tone?: "default" | "danger";
  onSelect: () => void;
}

/**
 * The Tugas row gesture surface (§8).
 *
 *  - swipe right past a threshold → complete
 *  - swipe left → latch open on a menu of actions
 *  - tap → open the detail sheet
 *
 * `dragDirectionLock` is what keeps this from hijacking vertical scrolling:
 * motion decides the axis from the first few pixels of movement and, when the
 * gesture is vertical, never takes over. `touch-action: pan-y` tells the
 * browser the same thing, so the scroll container stays responsive.
 *
 * The same few pixels also cancel dnd-kit's long-press activation (whose
 * tolerance is 5px), so reorder and swipe never fire together.
 */
export function SwipeRow({
  children,
  actions,
  onComplete,
  onTap,
  disabled,
  className,
}: {
  children: React.ReactNode;
  actions: SwipeAction[];
  onComplete?: () => void;
  onTap?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const x = useMotionValue(0);
  const [open, setOpen] = React.useState(false);
  const menuWidth = actions.length * ACTION_WIDTH;

  const completeOpacity = useTransform(x, [0, COMPLETE_THRESHOLD], [0, 1]);
  const completeScale = useTransform(x, [0, COMPLETE_THRESHOLD], [0.6, 1]);

  const close = React.useCallback(() => {
    setOpen(false);
    animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
  }, [x]);

  return (
    <div className={cn("relative isolate overflow-hidden", className)}>
      {/* right-swipe affordance: complete */}
      <motion.div
        aria-hidden
        style={{ opacity: completeOpacity }}
        className="absolute inset-y-0 left-0 z-0 flex w-1/2 items-center bg-success/15 pl-5"
      >
        <motion.span style={{ scale: completeScale }} className="text-success">
          <CheckMark />
        </motion.span>
      </motion.div>

      {/* left-swipe affordance: action menu */}
      <div
        className="absolute inset-y-0 right-0 z-0 flex"
        style={{ width: menuWidth }}
        aria-hidden={!open}
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              close();
              action.onSelect();
            }}
            style={{ width: ACTION_WIDTH }}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-[11px] font-medium",
              action.tone === "danger"
                ? "bg-danger/15 text-danger"
                : "bg-surface-3 text-fg-muted",
            )}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </div>

      <motion.div
        drag={disabled ? false : "x"}
        dragDirectionLock
        dragElastic={{ left: 0.05, right: 0.4 }}
        dragConstraints={{ left: -menuWidth, right: COMPLETE_THRESHOLD * 1.6 }}
        dragMomentum={false}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={(_event, info) => {
          const offset = info.offset.x;
          const velocity = info.velocity.x;

          if (onComplete && (offset > COMPLETE_THRESHOLD || velocity > 700)) {
            // Fling the row out, then hand off; the list animates the removal.
            animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
            onComplete();
            setOpen(false);
            return;
          }

          const shouldOpen =
            actions.length > 0 && (offset < -menuWidth / 2 || velocity < -500);
          setOpen(shouldOpen);
          animate(x, shouldOpen ? -menuWidth : 0, {
            type: "spring",
            stiffness: 500,
            damping: 40,
          });
        }}
        onClick={() => {
          if (open) close();
          else onTap?.();
        }}
        className="relative z-10 bg-bg"
      >
        {children}
      </motion.div>
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor">
      <path
        d="m4 12.5 5 5L20 6.5"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
