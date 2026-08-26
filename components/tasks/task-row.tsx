"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarPlus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import * as React from "react";

import { SwipeRow, type SwipeAction } from "@/components/tasks/swipe-row";
import {
  BlockedIcon,
  CategoryDot,
  DueBadge,
  PriorityBar,
  RemainingBadge,
  TagChips,
} from "@/components/tasks/task-bits";
import { Checkbox } from "@/components/ui/field";
import type { Category, Todo } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { formatDayLabel } from "@/lib/time";
import type { TodoCounters } from "@/lib/todos/derived";
import { cn } from "@/lib/utils";

export interface TaskRowProps {
  todo: Todo;
  depth: number;
  category?: Category;
  counters: TodoCounters;
  blockers: string[];
  childCount: number;
  doneChildCount: number;
  expanded: boolean;
  today: string;
  timezone: string;
  onToggleExpanded: () => void;
  onToggleComplete: () => void;
  onOpen: () => void;
  onSchedule: () => void;
  onDelete: () => void;
}

export function TaskRow({
  todo,
  depth,
  category,
  counters,
  blockers,
  childCount,
  doneChildCount,
  expanded,
  today,
  timezone,
  onToggleExpanded,
  onToggleComplete,
  onOpen,
  onSchedule,
  onDelete,
}: TaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const done = todo.status === "done";
  const blocked = blockers.length > 0;

  const actions: SwipeAction[] = [
    {
      key: "schedule",
      label: t.tasks.schedule,
      icon: <CalendarPlus className="size-4" />,
      onSelect: onSchedule,
    },
    {
      key: "edit",
      label: t.common.edit,
      icon: <Pencil className="size-4" />,
      onSelect: onOpen,
    },
    {
      key: "delete",
      label: t.common.delete,
      icon: <Trash2 className="size-4" />,
      tone: "danger",
      onSelect: onDelete,
    },
  ];

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      {...attributes}
      {...listeners}
      className={cn("relative", isDragging && "z-10")}
    >
      <SwipeRow
        actions={actions}
        onComplete={done ? undefined : onToggleComplete}
        onTap={onOpen}
        className="border-b border-border/60"
      >
        <div
          className="flex min-h-[3.25rem] items-center gap-2.5 py-2 pr-3"
          style={{ paddingLeft: `${0.75 + depth * 1.25}rem` }}
        >
          <PriorityBar priority={todo.priority} />

          <span
            // Stops the tap from bubbling into the row's "open detail" handler.
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={done}
              onCheckedChange={onToggleComplete}
              aria-label={todo.title}
              className="size-6"
            />
          </span>

          <div className={cn("min-w-0 flex-1", blocked && !done && "opacity-55")}>
            <div className="flex items-center gap-1.5">
              <CategoryDot category={category} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[15px]",
                  done && "text-fg-subtle line-through",
                )}
              >
                {todo.title}
              </span>
              <BlockedIcon blockers={blockers} />
            </div>

            {(todo.due_date || todo.tags.length > 0 || childCount > 0) && (
              <div className="mt-0.5 flex items-center gap-2 overflow-hidden">
                <DueBadge
                  due={todo.due_date}
                  overdue={Boolean(todo.due_date && todo.due_date < today && !done)}
                  label={
                    todo.due_date ? formatDayLabel(todo.due_date, timezone, today) : ""
                  }
                />
                {childCount > 0 ? (
                  <span className="shrink-0 text-[11px] text-fg-subtle">
                    {t.tasks.subtaskCount(doneChildCount, childCount)}
                  </span>
                ) : null}
                <TagChips tags={todo.tags} />
              </div>
            )}
          </div>

          <RemainingBadge
            remaining={counters.remainingToAllocate}
            estimated={todo.estimated_pomodoro}
          />

          {childCount > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={todo.title}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpanded();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="grid size-9 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-2"
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform",
                  expanded && "rotate-90",
                )}
              />
            </button>
          ) : (
            <span className="w-1 shrink-0" />
          )}
        </div>
      </SwipeRow>
    </li>
  );
}
