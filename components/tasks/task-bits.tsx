"use client";

import { Lock } from "lucide-react";

import type { Category, Priority } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { cn } from "@/lib/utils";

const PRIORITY_COLOR: Record<Priority, string> = {
  1: "var(--p1)",
  2: "var(--p2)",
  3: "var(--p3)",
  4: "var(--p4)",
};

const PRIORITY_LABEL: Record<Priority, string> = {
  1: t.priority.p1,
  2: t.priority.p2,
  3: t.priority.p3,
  4: t.priority.p4,
};

export function PriorityBar({ priority }: { priority: Priority }) {
  // P4 is "no priority" — showing a marker for it would be noise.
  if (priority === 4) return <span className="w-1 shrink-0" aria-hidden />;
  return (
    <span
      role="img"
      aria-label={PRIORITY_LABEL[priority]}
      className="w-1 shrink-0 self-stretch rounded-full"
      style={{ backgroundColor: PRIORITY_COLOR[priority] }}
    />
  );
}

export function CategoryDot({ category }: { category?: Category }) {
  if (!category) return null;
  return (
    <span
      role="img"
      aria-label={category.name}
      title={category.name}
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: category.color }}
    />
  );
}

export function DueBadge({
  due,
  overdue,
  label,
}: {
  due: string | null;
  overdue: boolean;
  label: string;
}) {
  if (!due) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-[11px] tabular-nums",
        overdue ? "font-medium text-danger" : "text-fg-subtle",
      )}
    >
      {label}
    </span>
  );
}

/**
 * §7.1: `remaining_to_allocate` "is the signal that drives planning", so it is
 * the one badge that gets accent treatment rather than muted text.
 */
export function RemainingBadge({
  remaining,
  estimated,
}: {
  remaining: number;
  estimated: number;
}) {
  if (estimated === 0) return null;
  if (remaining === 0) {
    return (
      <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-subtle">
        ✓
      </span>
    );
  }
  return (
    <span
      className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent"
      title={t.tasks.remainingToAllocate(remaining)}
    >
      {remaining}
    </span>
  );
}

export function BlockedIcon({ blockers }: { blockers: string[] }) {
  if (blockers.length === 0) return null;
  return (
    <span
      title={t.tasks.blockedBy(blockers)}
      aria-label={t.tasks.blockedBy(blockers)}
      className="shrink-0 text-fg-subtle"
    >
      <Lock className="size-3.5" />
    </span>
  );
}

export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag}
          className="truncate rounded bg-surface-3 px-1.5 text-[11px] text-fg-subtle"
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
