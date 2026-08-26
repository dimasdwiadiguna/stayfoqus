"use client";

import { Plus } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Chip, Input, Select } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Category, Priority, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { createTodo } from "@/lib/todos/repo";
import { localDate } from "@/lib/time";
import { haptic } from "@/lib/reward";

const PRIORITIES: Priority[] = [1, 2, 3, 4];

/**
 * §7.1: "Capture must be fast — one tap to open, type, enter."
 * The optional attributes sit in one compact row under the field and are never
 * required; Enter submits from the title field alone.
 */
export function QuickCapture({
  categories,
  timezone,
  parentId = null,
  trigger,
}: {
  categories: Category[];
  timezone: string;
  parentId?: UUID | null;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [categoryId, setCategoryId] = React.useState<UUID | "">("");
  const [priority, setPriority] = React.useState<Priority>(4);
  const [estimate, setEstimate] = React.useState(1);
  const [due, setDue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle("");
    setCategoryId("");
    setPriority(4);
    setEstimate(1);
    setDue("");
  };

  const submit = async (keepOpen: boolean) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await createTodo({
      title: trimmed,
      category_id: categoryId || null,
      priority,
      estimated_pomodoro: estimate,
      due_date: due || null,
      parent_id: parentId,
      status: "active",
    });
    haptic();
    if (keepOpen) {
      // Rapid capture: keep the attribute row as-is and clear only the title.
      setTitle("");
      inputRef.current?.focus();
    } else {
      reset();
      setOpen(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.tasks.quickCapture}
          className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] right-4 z-30 grid size-14 place-items-center rounded-full bg-accent text-accent-fg shadow-lg shadow-black/30 active:scale-95"
        >
          <Plus className="size-6" />
        </button>
      )}

      <SheetContent
        title={t.tasks.quickCapture}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" block onClick={() => void submit(true)}>
              {t.common.add}
            </Button>
            <Button variant="primary" block onClick={() => void submit(false)}>
              {t.common.save}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit(false);
              }
            }}
            placeholder={t.tasks.quickCapture}
            enterKeyHint="done"
            autoComplete="off"
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {PRIORITIES.map((p) => (
              <Chip
                key={p}
                active={priority === p}
                onClick={() => setPriority(p)}
                aria-label={t.priority[`p${p}` as const]}
              >
                {t.priority.short(p)}
              </Chip>
            ))}

            <Chip
              active={estimate > 1}
              onClick={() => setEstimate((n) => (n >= 8 ? 1 : n + 1))}
              aria-label={t.tasks.fieldEstimate}
            >
              {estimate} 🍅
            </Chip>

            <Chip
              active={due === localDate(new Date(), timezone)}
              onClick={() =>
                setDue((d) => (d ? "" : localDate(new Date(), timezone)))
              }
            >
              {t.common.today}
            </Chip>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Select
              ariaLabel={t.tasks.fieldCategory}
              value={categoryId || "none"}
              onValueChange={(v) => setCategoryId(v === "none" ? "" : v)}
              items={[
                { value: "none", label: t.tasks.noCategory },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label={t.tasks.fieldDueDate}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
