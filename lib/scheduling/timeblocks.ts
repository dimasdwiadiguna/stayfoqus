import type { IsoDate, TimeBlock, TimeBlockException } from "@/lib/db/schema";
import { dateRange, dayOfWeek, instantAt, minutesFromMidnight } from "@/lib/time";
import { byStart, overlaps } from "@/lib/scheduling/intervals";
import type {
  Interval,
  SchedulableTodo,
  TimeBlockInstance,
} from "@/lib/scheduling/types";

/**
 * §5.4 — time blocking. "During this window, only tasks matching this filter
 * may be scheduled." Hard for the machine, soft for the human.
 */

/**
 * Expands recurrence into concrete instances for a date range, honouring
 * per-instance skips from `time_block_exceptions` (§4.7).
 */
export function expandTimeBlocks(
  blocks: readonly TimeBlock[],
  exceptions: readonly TimeBlockException[],
  from: IsoDate,
  to: IsoDate,
  timezone: string,
): TimeBlockInstance[] {
  const skipped = new Set(
    exceptions
      .filter((e) => !e.deleted_at && e.action === "skipped")
      .map((e) => `${e.time_block_id}|${e.date}`),
  );

  const out: TimeBlockInstance[] = [];

  for (const block of blocks) {
    if (block.deleted_at || !block.enabled) continue;
    if (minutesFromMidnight(block.end_time) <= minutesFromMidnight(block.start_time)) {
      continue;
    }

    const dates =
      block.recurrence === "once"
        ? block.specific_date && block.specific_date >= from && block.specific_date <= to
          ? [block.specific_date]
          : []
        : dateRange(from, to).filter((d) => block.days_of_week.includes(dayOfWeek(d)));

    for (const date of dates) {
      if (block.end_date && date > block.end_date) continue;
      if (skipped.has(`${block.id}|${date}`)) continue;

      out.push({
        date,
        timeBlockId: block.id,
        name: block.name,
        color: block.color,
        filterCategoryIds: block.filter_category_ids,
        filterTags: block.filter_tags,
        filterPriorities: block.filter_priorities,
        start: instantAt(date, block.start_time, timezone).getTime(),
        end: instantAt(date, block.end_time, timezone).getTime(),
      });
    }
  }

  return out.sort(byStart);
}

/**
 * §5.4 filter semantics — **OR within a dimension, AND across dimensions**:
 *
 *   matches = (category ∈ filter_category_ids OR the list is empty)
 *         AND (tags ∩ filter_tags ≠ ∅        OR the list is empty)
 *         AND (priority ∈ filter_priorities  OR the list is empty)
 *
 * An empty list means "this dimension does not constrain", so a block with no
 * filters at all accepts everything.
 */
export function matchesTimeBlock(
  todo: Pick<SchedulableTodo, "categoryId" | "tags" | "priority">,
  block: Pick<
    TimeBlockInstance,
    "filterCategoryIds" | "filterTags" | "filterPriorities"
  >,
): boolean {
  const categoryOk =
    block.filterCategoryIds.length === 0 ||
    (todo.categoryId !== null && block.filterCategoryIds.includes(todo.categoryId));

  const tagOk =
    block.filterTags.length === 0 ||
    todo.tags.some((tag) => block.filterTags.includes(tag));

  const priorityOk =
    block.filterPriorities.length === 0 ||
    block.filterPriorities.includes(todo.priority);

  return categoryOk && tagOk && priorityOk;
}

/** Every block instance that overlaps the interval at all. */
export function blocksCovering(
  interval: Interval,
  blocks: readonly TimeBlockInstance[],
): TimeBlockInstance[] {
  return blocks.filter((b) => overlaps(interval, b));
}

/**
 * §5.5 Step 3(b): a placement is legal only if it satisfies *every* time block
 * it touches. "If no matching todo exists, the slot is left empty — never
 * backfill with a non-matching task."
 */
export function satisfiesTimeBlocks(
  todo: Pick<SchedulableTodo, "categoryId" | "tags" | "priority">,
  interval: Interval,
  blocks: readonly TimeBlockInstance[],
): boolean {
  return blocksCovering(interval, blocks).every((b) => matchesTimeBlock(todo, b));
}

/** The first block the todo would violate — used for the §5.4 confirmation. */
export function violatedBlock(
  todo: Pick<SchedulableTodo, "categoryId" | "tags" | "priority">,
  interval: Interval,
  blocks: readonly TimeBlockInstance[],
): TimeBlockInstance | null {
  return (
    blocksCovering(interval, blocks).find((b) => !matchesTimeBlock(todo, b)) ?? null
  );
}
