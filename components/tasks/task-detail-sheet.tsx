"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Checkbox,
  Chip,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useAgendasForTodo } from "@/hooks/use-tasks";
import type { Category, Priority, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { formatDateWithWeekday, formatTimeRange, isoWeekOf, localDate } from "@/lib/time";
import { createTodo, setDependencies, updateTodo } from "@/lib/todos/repo";
import { buildTodoIndex, childrenOf, descendantsOf } from "@/lib/todos/tree";
import { cn } from "@/lib/utils";

const PRIORITIES: Priority[] = [1, 2, 3, 4];

export function TaskDetailSheet({
  todo,
  todos,
  categories,
  timezone,
  onClose,
  onSchedule,
  onOpenTodo,
}: {
  todo: Todo | null;
  todos: Todo[];
  categories: Category[];
  timezone: string;
  onClose: () => void;
  onSchedule: (todo: Todo) => void;
  onOpenTodo: (todoId: UUID) => void;
}) {
  return (
    <Sheet open={Boolean(todo)} onOpenChange={(open) => !open && onClose()}>
      {todo ? (
        <SheetContent title={t.tasks.detailTitle} className="h-[92dvh]">
          <DetailBody
            key={todo.id}
            todo={todo}
            todos={todos}
            categories={categories}
            timezone={timezone}
            onSchedule={onSchedule}
            onOpenTodo={onOpenTodo}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function DetailBody({
  todo,
  todos,
  categories,
  timezone,
  onSchedule,
  onOpenTodo,
}: {
  todo: Todo;
  todos: Todo[];
  categories: Category[];
  timezone: string;
  onSchedule: (todo: Todo) => void;
  onOpenTodo: (todoId: UUID) => void;
}) {
  const agendas = useAgendasForTodo(todo.id);
  const index = React.useMemo(() => buildTodoIndex(todos), [todos]);
  const children = childrenOf(index, todo.id);
  const [newSubtask, setNewSubtask] = React.useState("");
  const [tagDraft, setTagDraft] = React.useState(todo.tags.join(", "));

  // The sheet writes through on every change (optimistic, §13) rather than
  // holding a draft — there is no Save button to forget to press.
  const patch = (p: Parameters<typeof updateTodo>[1]) => void updateTodo(todo.id, p);

  const commitTags = () => {
    const tags = tagDraft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    patch({ tags: [...new Set(tags)] });
  };

  const dependencyCandidates = React.useMemo(() => {
    const excluded = new Set([todo.id, ...descendantsOf(index, todo.id).map((d) => d.id)]);
    return todos.filter((c) => !excluded.has(c.id) && c.status !== "archived");
  }, [index, todo.id, todos]);

  const toggleDependency = async (depId: UUID) => {
    const next = todo.blocked_by.includes(depId)
      ? todo.blocked_by.filter((x) => x !== depId)
      : [...todo.blocked_by, depId];
    const result = await setDependencies(todo.id, next);
    if (!result.ok) {
      toast.error(t.tasks.cycleDetected(result.cycle.map((c) => c.title)));
    }
  };

  const thisWeek = isoWeekOf(localDate(new Date(), timezone));

  return (
    <div className="space-y-5 pb-2">
      <Field label={t.tasks.fieldTitle}>
        <Input
          defaultValue={todo.title}
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value && value !== todo.title) patch({ title: value });
          }}
        />
      </Field>

      <Field label={t.tasks.fieldNotes}>
        <Textarea
          defaultValue={todo.notes ?? ""}
          onBlur={(e) => patch({ notes: e.target.value.trim() || null })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t.tasks.fieldCategory}>
          <Select
            ariaLabel={t.tasks.fieldCategory}
            value={todo.category_id ?? "none"}
            onValueChange={(v) => patch({ category_id: v === "none" ? null : v })}
            items={[
              { value: "none", label: t.tasks.noCategory },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </Field>
        <Field label={t.tasks.fieldDueDate}>
          <Input
            type="date"
            defaultValue={todo.due_date ?? ""}
            onChange={(e) => patch({ due_date: e.target.value || null })}
          />
        </Field>
      </div>

      <Field label={t.tasks.fieldPriority}>
        <div className="flex gap-1.5">
          {PRIORITIES.map((p) => (
            <Chip
              key={p}
              active={todo.priority === p}
              onClick={() => patch({ priority: p })}
            >
              {t.priority.short(p)} · {t.priority[`p${p}` as const]}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t.tasks.fieldTags} hint={t.tasks.tagsPlaceholder}>
        <Input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => e.key === "Enter" && commitTags()}
          placeholder={t.tasks.tagsPlaceholder}
        />
      </Field>

      <Field label={t.tasks.fieldEstimate}>
        <div className="flex items-center gap-2">
          <Button
            size="iconSm"
            aria-label="-"
            onClick={() =>
              patch({ estimated_pomodoro: Math.max(1, todo.estimated_pomodoro - 1) })
            }
          >
            −
          </Button>
          <span className="w-10 text-center text-[15px] font-semibold tabular-nums">
            {todo.estimated_pomodoro}
          </span>
          <Button
            size="iconSm"
            aria-label="+"
            onClick={() => patch({ estimated_pomodoro: todo.estimated_pomodoro + 1 })}
          >
            +
          </Button>
        </div>
      </Field>

      <label className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
        <span className="text-[15px]">{t.tasks.fieldFocusWeek}</span>
        <Switch
          checked={todo.focus_week === thisWeek}
          onCheckedChange={(on) => patch({ focus_week: on ? thisWeek : null })}
        />
      </label>

      {/* ----- subtasks ----- */}
      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-fg-muted">
          {t.tasks.addSubtask}
        </h3>
        <ul className="space-y-1">
          {children.map((child) => (
            <li key={child.id} className="flex items-center gap-2">
              <Checkbox
                checked={child.status === "done"}
                onCheckedChange={(on) =>
                  void updateTodo(child.id, {
                    status: on ? "done" : "active",
                    completed_at: on ? new Date().toISOString() : null,
                  })
                }
                aria-label={child.title}
              />
              <button
                type="button"
                onClick={() => onOpenTodo(child.id)}
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-[15px]",
                  child.status === "done" && "text-fg-subtle line-through",
                )}
              >
                {child.title}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            placeholder={t.tasks.addSubtask}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !newSubtask.trim()) return;
              void createTodo({
                title: newSubtask,
                parent_id: todo.id,
                category_id: todo.category_id,
                status: "active",
              });
              setNewSubtask("");
            }}
          />
          <Button
            size="icon"
            aria-label={t.tasks.addSubtask}
            disabled={!newSubtask.trim()}
            onClick={() => {
              void createTodo({
                title: newSubtask,
                parent_id: todo.id,
                category_id: todo.category_id,
                status: "active",
              });
              setNewSubtask("");
            }}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </section>

      {/* ----- dependencies ----- */}
      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-fg-muted">
          {t.tasks.fieldDependencies}
        </h3>
        {todo.blocked_by.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {todo.blocked_by.map((depId) => {
              const dep = todos.find((c) => c.id === depId);
              return (
                <Chip key={depId} active onClick={() => void toggleDependency(depId)}>
                  {dep?.title ?? depId.slice(0, 6)}
                  <X className="size-3" />
                </Chip>
              );
            })}
          </div>
        ) : null}
        <DependencyPicker
          candidates={dependencyCandidates}
          selected={todo.blocked_by}
          onToggle={(depId) => void toggleDependency(depId)}
        />
      </section>

      {/* ----- agendas ----- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[13px] font-medium text-fg-muted">
            {t.tasks.agendasOfTodo}
          </h3>
          <Button size="sm" onClick={() => onSchedule(todo)}>
            {t.tasks.schedule}
          </Button>
        </div>
        {agendas.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t.tasks.noAgendas}</p>
        ) : (
          <ul className="space-y-1">
            {agendas.map((agenda) => (
              <li
                key={agenda.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px]"
              >
                <span className="min-w-0 truncate">
                  {formatDateWithWeekday(localDate(agenda.start_at, timezone))} ·{" "}
                  {formatTimeRange(agenda.start_at, agenda.end_at, timezone)}
                </span>
                <span className="shrink-0 text-fg-subtle">
                  {t.agenda.status[agenda.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DependencyPicker({
  candidates,
  selected,
  onToggle,
}: {
  candidates: Todo[];
  selected: UUID[];
  onToggle: (todoId: UUID) => void;
}) {
  const [query, setQuery] = React.useState("");
  const matches = React.useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return candidates
      .filter((c) => c.title.toLowerCase().includes(q))
      .slice(0, 6);
  }, [candidates, query]);

  return (
    <div className="space-y-1.5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t.common.search}
      />
      {matches.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onToggle(c.id);
                  setQuery("");
                }}
                className={cn(
                  "flex min-h-11 w-full items-center px-3 text-left text-[14px] hover:bg-surface-2",
                  selected.includes(c.id) && "text-accent",
                )}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
