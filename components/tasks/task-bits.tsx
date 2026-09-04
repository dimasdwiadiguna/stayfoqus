"use client";

import { CalendarDays, ListTree, Lock } from "lucide-react";

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
        "inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums",
        overdue ? "font-medium text-danger" : "text-fg-subtle",
      )}
      title={overdue ? t.tasks.overdue : undefined}
    >
      <CalendarDays className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

export interface TaskMetaProps {
  due: string | null;
  overdue: boolean;
  dueLabel: string;
  childCount: number;
  doneChildCount: number;
  tags: string[];
}

/**
 * How many kinds of metadata a todo has to show.
 *
 * The row asks before it decides whether the meta belongs beside the title or
 * on a line of its own: one kind fits, two start truncating (D-116).
 */
export function taskMetaCount({ due, childCount, tags }: TaskMetaProps): number {
  return (due ? 1 : 0) + (childCount > 0 ? 1 : 0) + (tags.length > 0 ? 1 : 0);
}

/**
 * A todo's metadata as one line: due date, subtask progress, tags.
 *
 * Each figure is an icon plus a number, with the sentence it stands for kept in
 * `title` — at 11 px the words cost more room than they earn, and the sentence
 * is still there for a pointer and for a screen reader.
 */
export function TaskMeta({
  due,
  overdue,
  dueLabel,
  childCount,
  doneChildCount,
  tags,
  inline = false,
  className,
}: TaskMetaProps & { inline?: boolean; className?: string }) {
  if (taskMetaCount({ due, overdue, dueLabel, childCount, doneChildCount, tags }) === 0) {
    return null;
  }
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 overflow-hidden",
        inline && "shrink-0",
        className,
      )}
    >
      <DueBadge due={due} overdue={overdue} label={dueLabel} />
      {childCount > 0 ? (
        <span
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] tabular-nums text-fg-subtle"
          title={t.tasks.subtaskCount(doneChildCount, childCount)}
        >
          <ListTree className="size-3 shrink-0" aria-hidden />
          {doneChildCount}/{childCount}
        </span>
      ) : null}
      <TagChips tags={tags} limit={inline ? 1 : 3} />
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

export function TagChips({ tags, limit = 3 }: { tags: string[]; limit?: number }) {
  if (tags.length === 0) return null;
  return (
    <span className="flex min-w-0 gap-1 overflow-hidden">
      {tags.slice(0, limit).map((tag) => (
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
