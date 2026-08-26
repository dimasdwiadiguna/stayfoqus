"use client";

import { CalendarClock } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { createAgenda } from "@/lib/agendas/repo";
import type { Todo } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import {
  isInsideWindow,
  sessionDurationMin,
  suggestSlots,
  violatedBlock,
  type PlacementCandidate,
} from "@/lib/scheduling";
import {
  addDays,
  formatDateWithWeekday,
  formatDuration,
  instantAt,
  localDate,
} from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";

/** How far ahead the suggestion engine looks for the three chips (§8). */
const HORIZON_DAYS = 14;

type PendingConfirm =
  | { kind: "outside-window"; start: number; end: number; pomodoros: number }
  | { kind: "time-block"; blockName: string; start: number; end: number; pomodoros: number }
  | null;

/**
 * §8: "converting a todo into an agenda goes through an explicit flow: … a
 * sheet offers 3 recommended slots as one-tap chips, plus 'Pilih waktu lain…'."
 *
 * The chips come from the same free-space engine smart allocation uses, so a
 * suggested slot is always one allocation would have chosen.
 */
export function ScheduleSheet({
  todo,
  onClose,
  defaultPomodoros,
}: {
  todo: Todo | null;
  onClose: () => void;
  defaultPomodoros?: number;
}) {
  return (
    <Sheet open={Boolean(todo)} onOpenChange={(open) => !open && onClose()}>
      {todo ? (
        <SheetContent title={t.agenda.scheduleSheetTitle} description={todo.title}>
          <ScheduleBody
            key={todo.id}
            todo={todo}
            onDone={onClose}
            defaultPomodoros={defaultPomodoros}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function ScheduleBody({
  todo,
  onDone,
  defaultPomodoros,
}: {
  todo: Todo;
  onDone: () => void;
  defaultPomodoros?: number;
}) {
  const settings = useSettings();
  const { counters } = useTaskData();

  const today = localDate(new Date(), settings.timezone);
  const world = useSchedulingWorld({ from: today, to: addDays(today, HORIZON_DAYS) });

  const remaining = countersFor(counters, todo.id).remainingToAllocate;
  const [pomodoros, setPomodoros] = React.useState(
    Math.max(1, Math.min(4, defaultPomodoros ?? remaining ?? 1)),
  );
  const [manualDate, setManualDate] = React.useState(today);
  const [manualTime, setManualTime] = React.useState("09:00");
  const [manualOpen, setManualOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null);

  const slots = React.useMemo(
    () =>
      suggestSlots({
        todo: {
          categoryId: todo.category_id,
          tags: todo.tags,
          priority: todo.priority,
        },
        free: world.free,
        timeBlocks: world.timeBlocks,
        buffers: world.buffers,
        shape: world.shape,
        pomodoros,
        limit: 3,
        notBefore: Date.now(),
      }),
    [todo.category_id, todo.tags, todo.priority, world, pomodoros],
  );

  const commit = async (
    start: number,
    end: number,
    n: number,
    outsideWindow: boolean,
  ) => {
    await createAgenda(
      {
        todo_id: todo.id,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        allocated_pomodoro: n,
        outside_window: outsideWindow,
      },
      settings,
    );
    haptic();
    toast.success(t.agenda.scheduled);
    onDone();
  };

  const takeSlot = (slot: PlacementCandidate) => {
    // Suggestions come from inside the free-space map, so they are legal by
    // construction — no confirmation needed.
    void commit(slot.start, slot.end, slot.pomodoros, false);
  };

  /**
   * Manual placement is a *soft* constraint (§5.1, §5.4): allowed, but the user
   * is told what they are stepping over first.
   */
  const takeManual = () => {
    const start = instantAt(manualDate, manualTime, settings.timezone).getTime();
    const end = start + sessionDurationMin(pomodoros, world.shape) * 60_000;
    const interval = { start, end };

    const inside = isInsideWindow(interval, world.windows);
    if (!inside) {
      setConfirm({ kind: "outside-window", start, end, pomodoros });
      return;
    }

    const violated = violatedBlock(
      { categoryId: todo.category_id, tags: todo.tags, priority: todo.priority },
      interval,
      world.timeBlocks,
    );
    if (violated) {
      setConfirm({
        kind: "time-block",
        blockName: violated.name,
        start,
        end,
        pomodoros,
      });
      return;
    }

    void commit(start, end, pomodoros, false);
  };

  const duration = sessionDurationMin(pomodoros, world.shape);

  return (
    <div className="space-y-5 pb-2">
      <Field label={t.agenda.fieldAllocated} hint={formatDuration(duration)}>
        <div className="flex items-center gap-2">
          <Button
            size="iconSm"
            aria-label="-"
            onClick={() => setPomodoros((n) => Math.max(1, n - 1))}
          >
            −
          </Button>
          <span className="w-10 text-center text-[15px] font-semibold tabular-nums">
            {pomodoros}
          </span>
          <Button
            size="iconSm"
            aria-label="+"
            onClick={() => setPomodoros((n) => Math.min(8, n + 1))}
          >
            +
          </Button>
          {remaining > 0 ? (
            <span className="ml-2 text-[12px] text-fg-subtle">
              {t.tasks.remainingToAllocate(remaining)}
            </span>
          ) : null}
        </div>
      </Field>

      <section className="space-y-2">
        <h3 className="text-[13px] font-medium text-fg-muted">
          {t.agenda.suggestedSlots}
        </h3>
        {slots.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t.agenda.noSlots}</p>
        ) : (
          <ul className="space-y-1.5">
            {slots.map((slot) => (
              <li key={slot.start}>
                <button
                  type="button"
                  onClick={() => takeSlot(slot)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 text-left hover:border-accent"
                >
                  <CalendarClock className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">
                      {formatDateWithWeekday(slot.date)} ·{" "}
                      {timeOf(slot.start, settings.timezone)}
                    </span>
                    <span className="block text-[12px] text-fg-subtle">
                      {slot.pomodoros} {t.common.pomodoro} ·{" "}
                      {formatDuration((slot.end - slot.start) / 60_000)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {manualOpen ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label={t.agenda.fieldStart}>
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
              />
            </Field>
            <Field label="&nbsp;">
              <Input
                type="time"
                step={300}
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
              />
            </Field>
          </div>
          <Button variant="primary" block onClick={takeManual}>
            {t.common.save}
          </Button>
        </section>
      ) : (
        <Button variant="ghost" block onClick={() => setManualOpen(true)}>
          {t.agenda.pickAnotherTime}
        </Button>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === "time-block"
            ? t.calendar.timeBlockConfirm(confirm.blockName)
            : t.calendar.outsideWindowConfirm
        }
        confirmLabel={
          confirm?.kind === "time-block"
            ? t.calendar.placeAnyway
            : t.calendar.scheduleAnyway
        }
        onConfirm={() => {
          if (!confirm) return;
          void commit(
            confirm.start,
            confirm.end,
            confirm.pomodoros,
            confirm.kind === "outside-window",
          );
        }}
      />
    </div>
  );
}

function timeOf(ms: number, timezone: string): string {
  return new Date(ms).toLocaleTimeString("id-ID", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Local-only helper used by the sheet's manual path and the calendar. */
export { HORIZON_DAYS };
