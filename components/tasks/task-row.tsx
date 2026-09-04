"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarPlus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import * as React from "react";

import { SwipeRow, type SwipeAction } from "@/components/tasks/swipe-row";
import {
  BlockedIcon,
  CategoryDot,
  PriorityBar,
  RemainingBadge,
  TaskMeta,
  taskMetaCount,
  type TaskMetaProps,
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

  /*
   * One kind of metadata rides beside the title; two or more get a line of
   * their own. Forcing everything onto one line is what truncates the figure
   * the user came for (D-116), and giving a bare title a second line spends
   * 16 px on nothing.
   */
  const meta: TaskMetaProps = {
    due: todo.due_date,
    overdue: Boolean(todo.due_date && todo.due_date < today && !done),
    dueLabel: todo.due_date ? formatDayLabel(todo.due_date, timezone, today) : "",
    childCount,
    doneChildCount,
    tags: todo.tags,
  };
  const metaCount = taskMetaCount(meta);

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
          className="flex min-h-11 items-center gap-2 py-1.5 pr-3"
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
              // The box is 24 px in a 44 px row; `tap-44` gives it the hit
              // area M10 asks for without widening the row.
              className="tap-44 size-6"
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
              {metaCount === 1 ? <TaskMeta {...meta} inline /> : null}
            </div>

            {metaCount > 1 ? <TaskMeta {...meta} className="mt-0.5" /> : null}
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
