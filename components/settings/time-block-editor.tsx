"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Chip, Input, Segmented, Switch } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCategories, useTodos } from "@/hooks/use-tasks";
import { useTimeBlocks } from "@/hooks/use-scheduling";
import type { DayOfWeek, Priority, TimeBlock } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { allTags } from "@/lib/todos/grouping";
import {
  createTimeBlock,
  deleteTimeBlock,
  updateTimeBlock,
} from "@/lib/timeblocks/repo";

const DAY_ORDER: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];
const PRIORITIES: Priority[] = [1, 2, 3, 4];

const PALETTE = [
  "#7c9cff",
  "#43c98a",
  "#f0b429",
  "#c084fc",
  "#57c9b6",
  "#f4574d",
];

/** §4.6 / §5.4 — the time block manager. */
export function TimeBlockEditor() {
  const blocks = useTimeBlocks();
  const [editing, setEditing] = React.useState<TimeBlock | null>(null);

  return (
    <Section title={t.settings.sectionTimeBlocks} blurb={t.settings.timeBlockBlurb}>
      {blocks.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">{t.common.none}</p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((block) => (
            <li
              key={block.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3"
            >
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-full"
                style={{ backgroundColor: block.color }}
              />
              <button
                type="button"
                onClick={() => setEditing(block)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-[15px]">{block.name}</div>
                <div className="text-[12px] text-fg-subtle">
                  {block.start_time}–{block.end_time} ·{" "}
                  {block.recurrence === "once"
                    ? (block.specific_date ?? t.settings.timeBlockOnce)
                    : block.days_of_week
                        .slice()
                        .sort()
                        .map((d) => t.days.short[d])
                        .join(" ")}
                </div>
              </button>
              <Switch
                checked={block.enabled}
                aria-label={block.name}
                onCheckedChange={(on) => void updateTimeBlock(block.id, { enabled: on })}
              />
            </li>
          ))}
        </ul>
      )}

      <Button
        block
        onClick={() =>
          void (async () => {
            const created = await createTimeBlock({
              name: t.settings.addTimeBlock,
              start_time: "09:00",
              end_time: "12:00",
            });
            setEditing(created);
          })()
        }
      >
        <Plus className="size-4" />
        {t.settings.addTimeBlock}
      </Button>

      <TimeBlockSheet block={editing} onClose={() => setEditing(null)} />
    </Section>
  );
}

function TimeBlockSheet({
  block,
  onClose,
}: {
  block: TimeBlock | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(block)} onOpenChange={(open) => !open && onClose()}>
      {block ? (
        <TimeBlockForm key={block.id} block={block} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function TimeBlockForm({
  block,
  onClose,
}: {
  block: TimeBlock;
  onClose: () => void;
}) {
  const categories = useCategories();
  const todos = useTodos();
  const tags = React.useMemo(() => allTags(todos), [todos]);

  const patch = (p: Parameters<typeof updateTimeBlock>[1]) =>
    void updateTimeBlock(block.id, p);

  const toggleIn = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const noFilter =
    block.filter_category_ids.length === 0 &&
    block.filter_tags.length === 0 &&
    block.filter_priorities.length === 0;

  return (
    <SheetContent
      title={block.name}
      description={t.settings.timeBlockBlurb}
      footer={
        <Button
          variant="danger"
          block
          onClick={() => {
            void deleteTimeBlock(block.id);
            onClose();
          }}
        >
          <Trash2 className="size-4" />
          {t.common.delete}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Input
          defaultValue={block.name}
          aria-label={t.settings.timeBlockName}
          onBlur={(e) => e.target.value.trim() && patch({ name: e.target.value.trim() })}
        />

        <div className="flex items-center gap-2">
          <Input
            type="time"
            step={300}
            value={block.start_time}
            aria-label={t.agenda.fieldStart}
            onChange={(e) => patch({ start_time: e.target.value })}
          />
          <span className="text-fg-subtle">–</span>
          <Input
            type="time"
            step={300}
            value={block.end_time}
            aria-label={t.agenda.fieldEnd}
            onChange={(e) => patch({ end_time: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <span className="text-[13px] font-medium text-fg-muted">
            {t.settings.timeBlockRecurrence}
          </span>
          <Segmented
            ariaLabel={t.settings.timeBlockRecurrence}
            value={block.recurrence}
            onChange={(v) => patch({ recurrence: v })}
            options={[
              { value: "weekly" as const, label: t.settings.timeBlockWeekly },
              { value: "once" as const, label: t.settings.timeBlockOnce },
            ]}
          />
        </div>

        {block.recurrence === "weekly" ? (
          <div className="flex flex-wrap gap-1.5">
            {DAY_ORDER.map((day) => (
              <Chip
                key={day}
                active={block.days_of_week.includes(day)}
                onClick={() =>
                  patch({ days_of_week: toggleIn(block.days_of_week, day) })
                }
              >
                {t.days.short[day]}
              </Chip>
            ))}
          </div>
        ) : (
          <Input
            type="date"
            value={block.specific_date ?? ""}
            aria-label={t.settings.timeBlockDate}
            onChange={(e) => patch({ specific_date: e.target.value || null })}
          />
        )}

        <div className="space-y-1.5">
          <span className="text-[13px] font-medium text-fg-muted">
            {t.settings.timeBlockEndDate}
          </span>
          <Input
            type="date"
            value={block.end_date ?? ""}
            aria-label={t.settings.timeBlockEndDate}
            onChange={(e) => patch({ end_date: e.target.value || null })}
          />
        </div>

        <div className="space-y-1.5">
          <span className="text-[13px] font-medium text-fg-muted">
            {t.settings.categoryColor}
          </span>
          <div className="flex gap-2">
            {PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={color}
                onClick={() => patch({ color })}
                className="size-8 rounded-full border-2"
                style={{
                  backgroundColor: color,
                  borderColor: block.color === color ? "var(--fg)" : "transparent",
                }}
              />
            ))}
          </div>
        </div>

        {/* §5.4 filters: OR within a dimension, AND across dimensions. */}
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
          {noFilter ? (
            <p className="text-[12px] text-fg-subtle">{t.settings.timeBlockNoFilter}</p>
          ) : null}

          <FilterGroup label={t.settings.timeBlockFilterCategories}>
            {categories.map((c) => (
              <Chip
                key={c.id}
                active={block.filter_category_ids.includes(c.id)}
                onClick={() =>
                  patch({
                    filter_category_ids: toggleIn(block.filter_category_ids, c.id),
                  })
                }
              >
                {c.name}
              </Chip>
            ))}
          </FilterGroup>

          {tags.length > 0 ? (
            <FilterGroup label={t.settings.timeBlockFilterTags}>
              {tags.map((tag) => (
                <Chip
                  key={tag}
                  active={block.filter_tags.includes(tag)}
                  onClick={() =>
                    patch({ filter_tags: toggleIn(block.filter_tags, tag) })
                  }
                >
                  {tag}
                </Chip>
              ))}
            </FilterGroup>
          ) : null}

          <FilterGroup label={t.settings.timeBlockFilterPriorities}>
            {PRIORITIES.map((p) => (
              <Chip
                key={p}
                active={block.filter_priorities.includes(p)}
                onClick={() =>
                  patch({
                    filter_priorities: toggleIn(block.filter_priorities, p),
                  })
                }
              >
                {t.priority.short(p)}
              </Chip>
            ))}
          </FilterGroup>
        </div>
      </div>
    </SheetContent>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[12px] font-medium text-fg-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
