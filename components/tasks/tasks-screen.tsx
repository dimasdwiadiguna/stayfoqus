"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as React from "react";

import { EmptyState, Screen, ScreenTitle } from "@/components/shell/screen";
import { SyncIndicator } from "@/components/shell/sync-indicator";
import {
  CompletionPrompt,
  type CompletionRequest,
} from "@/components/tasks/completion-prompt";
import {
  MissedBanner,
  MissedReviewSheet,
} from "@/components/tasks/missed-review";
import { QuickCapture } from "@/components/tasks/quick-capture";
import { TodayHeader } from "@/components/tasks/today-header";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { TaskRow } from "@/components/tasks/task-row";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Chip, Segmented } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { useTaskData } from "@/hooks/use-tasks";
import { useSettings } from "@/hooks/use-settings";
import type { Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { celebrate, haptic } from "@/lib/reward";
import { localDate } from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";
import {
  allTags,
  groupTodos,
  visibleChildren,
  visibleRoots,
  type GroupMode,
  type TaskFilter,
} from "@/lib/todos/grouping";
import {
  completeTodoWithPomodoro,
  completionContext,
  deleteTodo,
  incompleteChildren,
  reorderSiblings,
  restoreTodos,
  uncompleteTodo,
} from "@/lib/todos/repo";
import { blockersOf, childrenOf } from "@/lib/todos/tree";

type PendingDialog =
  | { kind: "complete-parent"; todo: Todo; incomplete: number }
  | { kind: "delete-parent"; todo: Todo; children: number }
  | null;

export function TasksScreen({
  onScheduleTodo,
}: {
  onScheduleTodo: (todo: Todo) => void;
}) {
  const settings = useSettings();
  const data = useTaskData();
  const [groupMode, setGroupMode] = React.useState<GroupMode>("category");
  const [filter, setFilter] = React.useState<TaskFilter>({
    tags: [],
    showDone: false,
    query: "",
  });
  const [expanded, setExpanded] = React.useState<Set<UUID>>(new Set());
  const [openTodoId, setOpenTodoId] = React.useState<UUID | null>(null);
  const [dialog, setDialog] = React.useState<PendingDialog>(null);
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [completing, setCompleting] = React.useState<CompletionRequest | null>(
    null,
  );

  const today = localDate(new Date(), settings.timezone);
  const tags = React.useMemo(() => allTags(data.todos), [data.todos]);

  const roots = React.useMemo(
    () => visibleRoots(data.index, filter),
    [data.index, filter],
  );
  const groups = React.useMemo(
    () => groupTodos(roots, groupMode, data.categories, today),
    [roots, groupMode, data.categories, today],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // §8: a long press starts a reorder; any earlier movement belongs to the
      // swipe gesture or to vertical scrolling.
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const toggleExpanded = (todoId: UUID) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });

  /* ---------------- completion (§4.2 soft warning, §5.9 coupling) -------- */

  /**
   * The last step of completing: record how many pomodoros it took, then mark
   * the todo done. The reported number lands in today's completed *and*
   * planned counts — see `lib/todos/completion.ts`.
   */
  const finishComplete = async (todo: Todo, reported: number) => {
    const hasSubtasks = childrenOf(data.index, todo.id).length > 0;
    const undo = await completeTodoWithPomodoro(todo.id, reported);
    haptic([10, 40, 14]);
    if (hasSubtasks) void celebrate("todo-with-subtasks");
    setCompleting(null);
    // The agendas that were still open went to `done` rather than being
    // deleted (D-094), so the toast says so and the undo puts them back.
    toast.undoable(
      undo.agendas.length > 0
        ? t.tasks.completedWithAgendas(undo.agendas.length)
        : t.tasks.completed,
      () => void uncompleteTodo(todo.id, undo),
    );
  };

  /** Opens the pomodoro prompt, after any warning dialogs have been answered. */
  const askPomodoro = async (todo: Todo) => {
    const context = await completionContext(todo.id);
    setCompleting({
      todo,
      suggested: context?.suggested ?? todo.estimated_pomodoro,
      alreadyToday: context?.alreadyToday ?? 0,
    });
  };

  const requestComplete = async (todo: Todo) => {
    if (todo.status === "done") {
      await uncompleteTodo(todo.id);
      return;
    }

    const incomplete = await incompleteChildren(todo.id);
    if (incomplete.length > 0) {
      setDialog({ kind: "complete-parent", todo, incomplete: incomplete.length });
      return;
    }

    // No question about the outstanding agendas any more: they are marked
    // done rather than deleted, which is not a decision worth a dialog.
    await askPomodoro(todo);
  };

  /* ---------------- deletion (§4.2) ------------------------------------- */

  const runDelete = async (todo: Todo, mode: "cascade" | "promote") => {
    const priorParents = childrenOf(data.index, todo.id).map((c) => ({
      id: c.id,
      parent_id: c.parent_id,
    }));
    const { affected } = await deleteTodo(todo.id, mode);
    toast.undoable(t.tasks.deleted, () => {
      void restoreTodos(affected, mode === "promote" ? priorParents : []);
    });
  };

  const requestDelete = (todo: Todo) => {
    const kids = childrenOf(data.index, todo.id);
    if (kids.length > 0) {
      setDialog({ kind: "delete-parent", todo, children: kids.length });
      return;
    }
    void runDelete(todo, "cascade");
  };

  /* ---------------- reorder --------------------------------------------- */

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeTodo = data.index.byId.get(String(active.id));
    const overTodo = data.index.byId.get(String(over.id));
    if (!activeTodo || !overTodo) return;
    // Cross-level drops are not part of the list gesture; §8 assigns
    // re-parenting to dropping onto a category header instead.
    if (activeTodo.parent_id !== overTodo.parent_id) return;

    const siblings = childrenOf(data.index, activeTodo.parent_id).map((s) => s.id);
    const from = siblings.indexOf(activeTodo.id);
    const to = siblings.indexOf(overTodo.id);
    if (from < 0 || to < 0) return;

    const next = [...siblings];
    next.splice(from, 1);
    next.splice(to, 0, activeTodo.id);
    void reorderSiblings(next);
  };

  /* ---------------- render ---------------------------------------------- */

  const renderTodo = (todo: Todo, depth: number): React.ReactNode[] => {
    const kids = visibleChildren(data.index, todo.id, filter);
    const allKids = childrenOf(data.index, todo.id);
    const isExpanded = expanded.has(todo.id);

    const node = (
      <TaskRow
        key={todo.id}
        todo={todo}
        depth={depth}
        category={
          todo.category_id ? data.categoryById.get(todo.category_id) : undefined
        }
        counters={countersFor(data.counters, todo.id)}
        blockers={blockersOf(data.index, todo).map((b) => b.title)}
        childCount={allKids.length}
        doneChildCount={allKids.filter((k) => k.status === "done").length}
        expanded={isExpanded}
        today={today}
        timezone={settings.timezone}
        onToggleExpanded={() => toggleExpanded(todo.id)}
        onToggleComplete={() => void requestComplete(todo)}
        onOpen={() => setOpenTodoId(todo.id)}
        onSchedule={() => onScheduleTodo(todo)}
        onDelete={() => requestDelete(todo)}
      />
    );

    if (!isExpanded || kids.length === 0) return [node];
    return [node, ...kids.flatMap((kid) => renderTodo(kid, depth + 1))];
  };

  return (
    <Screen
      header={
        <div className="space-y-1.5">
          <ScreenTitle title={t.tasks.title} actions={<SyncIndicator />} />
          <TodayHeader />
          <div className="flex items-center gap-2">
            <Segmented
              className="min-w-0"
              ariaLabel={t.tasks.groupBy}
              value={groupMode}
              onChange={setGroupMode}
              options={[
                { value: "category", label: t.tasks.groupByCategory },
                { value: "due", label: t.tasks.groupByDueDate },
                { value: "priority", label: t.tasks.groupByPriority },
              ]}
            />
            {/*
              A word that never changes, on a row that has none to spare: the
              eye says the same thing in an icon's width, and the sentence
              survives in the label.
            */}
            <Button
              size="iconSm"
              variant="ghost"
              className="tap-44 ml-auto"
              aria-pressed={filter.showDone}
              aria-label={t.tasks.showDone}
              title={t.tasks.showDone}
              onClick={() =>
                setFilter((f) => ({ ...f, showDone: !f.showDone }))
              }
            >
              {filter.showDone ? (
                <Eye className="size-4 text-accent" />
              ) : (
                <EyeOff className="size-4" />
              )}
            </Button>
          </div>
          {tags.length > 0 ? (
            <div className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4">
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  active={filter.tags.includes(tag)}
                  onClick={() =>
                    setFilter((f) => ({
                      ...f,
                      tags: f.tags.includes(tag)
                        ? f.tags.filter((x) => x !== tag)
                        : [...f.tags, tag],
                    }))
                  }
                >
                  {tag}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      }
    >
      <MissedBanner onOpen={() => setReviewOpen(true)} />

      {groups.length === 0 ? (
        <EmptyState
          title={
            data.todos.length === 0 ? t.tasks.empty : t.tasks.emptyFiltered
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <div className="pb-24">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="sticky top-0 z-10 flex items-center gap-2 bg-bg/95 px-4 py-1 text-[11px] font-semibold tracking-wide text-fg-subtle uppercase backdrop-blur">
                  {group.color ? (
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                  ) : null}
                  {group.label}
                  <span className="tabular-nums opacity-60">
                    {group.todos.length}
                  </span>
                </h2>
                <SortableContext
                  items={group.todos.map((x) => x.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul>
                    <AnimatePresence initial={false}>
                      {group.todos.flatMap((todo) => renderTodo(todo, 0))}
                    </AnimatePresence>
                  </ul>
                </SortableContext>
              </section>
            ))}
          </div>
        </DndContext>
      )}

      <CompletionPrompt
        request={completing}
        onCancel={() => setCompleting(null)}
        onConfirm={(reported) => {
          if (!completing) return;
          void finishComplete(completing.todo, reported);
        }}
      />

      <MissedReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      <QuickCapture categories={data.categories} timezone={settings.timezone} />

      <TaskDetailSheet
        todo={openTodoId ? (data.index.byId.get(openTodoId) ?? null) : null}
        todos={data.todos}
        categories={data.categories}
        timezone={settings.timezone}
        onClose={() => setOpenTodoId(null)}
        onSchedule={(todo) => {
          setOpenTodoId(null);
          onScheduleTodo(todo);
        }}
        onOpenTodo={setOpenTodoId}
      />

      <TaskDialogs
        dialog={dialog}
        onDismiss={() => setDialog(null)}
        onCompleteAnyway={(todo) => void askPomodoro(todo)}
        onDelete={(todo, mode) => void runDelete(todo, mode)}
      />
    </Screen>
  );
}

function TaskDialogs({
  dialog,
  onDismiss,
  onCompleteAnyway,
  onDelete,
}: {
  dialog: PendingDialog;
  onDismiss: () => void;
  onCompleteAnyway: (todo: Todo) => void;
  onDelete: (todo: Todo, mode: "cascade" | "promote") => void;
}) {
  if (!dialog) return null;

  if (dialog.kind === "complete-parent") {
    // §4.2: a soft warning — "Never hard-block."
    return (
      <ConfirmDialog
        open
        onOpenChange={(open) => !open && onDismiss()}
        title={t.tasks.completeParentWarning(dialog.incomplete)}
        confirmLabel={t.tasks.completeAnyway}
        onConfirm={() => onCompleteAnyway(dialog.todo)}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onDismiss()}
      title={t.tasks.deleteParentTitle}
      description={t.tasks.deleteParentBody(dialog.children)}
      confirmLabel={t.tasks.deleteChildren}
      tone="danger"
      onConfirm={() => onDelete(dialog.todo, "cascade")}
      extraActions={
        <button
          type="button"
          onClick={() => {
            onDelete(dialog.todo, "promote");
            onDismiss();
          }}
          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-left text-[14px] hover:bg-surface-3"
        >
          {t.tasks.promoteChildren}
        </button>
      }
    />
  );
}
