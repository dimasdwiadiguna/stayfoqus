"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { EyeOff, Trash2, Undo2 } from "lucide-react";
import * as React from "react";

import { BufferField } from "@/components/calendar/buffer-field";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Chip, Field, Input, Segmented } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { getDb } from "@/lib/db/client";
import type { DayOfWeek, EventRecurrence, IsoDate, UUID } from "@/lib/db/schema";
import {
  deleteEvent,
  restoreEvent,
  toggleEventSkip,
  updateEvent,
  type EventPatch,
} from "@/lib/events/repo";
import { id as t } from "@/lib/i18n/id";
import { dayOfWeek, minutesFromMidnight } from "@/lib/time";

const DAY_ORDER: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export interface OpenEvent {
  eventId: UUID;
  /** The occurrence that was tapped — what "skip today" applies to. */
  date: IsoDate;
  skipped: boolean;
}

/**
 * The event editor.
 *
 * Reached only by tapping the block on the calendar, which is what the user
 * asked for. It writes through on every change with no Save button (D-027),
 * and it reads the row **live** rather than holding it in state — D-076
 * records exactly that bug in the time block editor, where every edit was
 * saved and then immediately repainted from a stale copy.
 */
export function EventSheet({
  open,
  onClose,
}: {
  open: OpenEvent | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(open)} onOpenChange={(next) => !next && onClose()}>
      {open ? (
        <SheetContent title={t.event.title} className="h-[92dvh]">
          <EventSheetBody key={open.eventId} open={open} onClose={onClose} />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function EventSheetBody({
  open,
  onClose,
}: {
  open: OpenEvent;
  onClose: () => void;
}) {
  const event = useLiveQuery(
    () => (open ? getDb().events.get(open.eventId) : undefined),
    [open?.eventId],
  );

  const [confirmDelete, setConfirmDelete] = React.useState(false);

  if (!event || event.deleted_at) return null;

  const patch = (next: EventPatch) => void updateEvent(event.id, next);
  const weekly = event.recurrence === "weekly";
  const wrapsMidnight =
    minutesFromMidnight(event.end_time) <= minutesFromMidnight(event.start_time);

  return (
    <>
      <div className="space-y-4 pb-2">
        {open.skipped ? (
          <div className="space-y-2 rounded-lg border border-event/40 bg-event/10 px-3 py-2.5">
            <p className="text-[13px] text-event">{t.event.tapToRestore}</p>
            <Button
              size="sm"
              onClick={() => {
                void toggleEventSkip(event.id, open.date);
                toast.show(t.event.unskipped);
                onClose();
              }}
            >
              <Undo2 className="size-4" />
              {t.event.skippedBadge}
            </Button>
          </div>
        ) : null}

        <Field label={t.event.fieldTitle}>
          <Input
            defaultValue={event.title}
            onBlur={(e) => patch({ title: e.target.value.trim() || t.event.title })}
          />
        </Field>

        <Field label={t.event.fieldLocation} hint={t.event.fieldLocationHint}>
          <Input
            defaultValue={event.location ?? ""}
            onBlur={(e) => patch({ location: e.target.value.trim() || null })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.event.fieldStart}>
            <Input
              type="time"
              step={300}
              value={event.start_time}
              onChange={(e) => patch({ start_time: e.target.value })}
            />
          </Field>
          <Field label={t.event.fieldEnd} hint={wrapsMidnight ? t.event.endsNextDay : undefined}>
            <Input
              type="time"
              step={300}
              value={event.end_time}
              onChange={(e) => patch({ end_time: e.target.value })}
            />
          </Field>
        </div>

        <Field label={t.event.fieldRepeat}>
          <Segmented
            ariaLabel={t.event.fieldRepeat}
            value={event.recurrence}
            className="w-full"
            onChange={(recurrence: EventRecurrence) =>
              patch(
                recurrence === "weekly"
                  ? {
                      recurrence,
                      // Seed the repeat with the day the event already sits on,
                      // so switching to weekly never blanks it off the calendar.
                      days_of_week:
                        event.days_of_week.length > 0
                          ? event.days_of_week
                          : [dayOfWeek(open.date)],
                    }
                  : { recurrence, specific_date: event.specific_date ?? open.date },
              )
            }
            options={[
              { value: "once" as const, label: t.event.repeatOnce },
              { value: "weekly" as const, label: t.event.repeatWeekly },
            ]}
          />
        </Field>

        {weekly ? (
          <>
            <Field label={t.event.repeatDays}>
              <div className="flex flex-wrap gap-1.5">
                {DAY_ORDER.map((day) => (
                  <Chip
                    key={day}
                    active={event.days_of_week.includes(day)}
                    onClick={() =>
                      patch({ days_of_week: toggleDay(event.days_of_week, day) })
                    }
                  >
                    {t.days.short[day]}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label={t.event.repeatUntil} hint={t.event.fieldLocationHint}>
              <Input
                type="date"
                value={event.end_date ?? ""}
                onChange={(e) => patch({ end_date: e.target.value || null })}
              />
            </Field>
          </>
        ) : (
          <Field label={t.event.fieldDate}>
            <Input
              type="date"
              value={event.specific_date ?? open.date}
              onChange={(e) => patch({ specific_date: e.target.value })}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <BufferField
            label={t.agenda.fieldBufferBefore}
            minutes={event.buffer_before_min}
            type={event.buffer_before_type}
            onMinutes={(buffer_before_min) => patch({ buffer_before_min })}
            onType={(buffer_before_type) => patch({ buffer_before_type })}
          />
          <BufferField
            label={t.agenda.fieldBufferAfter}
            minutes={event.buffer_after_min}
            type={event.buffer_after_type}
            onMinutes={(buffer_after_min) => patch({ buffer_after_min })}
            onType={(buffer_after_type) => patch({ buffer_after_type })}
          />
        </div>

        <div className="flex gap-2">
          {weekly && !open.skipped ? (
            <Button
              block
              onClick={() => {
                void toggleEventSkip(event.id, open.date);
                toast.undoable(t.event.skipped, () => {
                  void toggleEventSkip(event.id, open.date);
                });
                onClose();
              }}
            >
              <EyeOff className="size-4" />
              {t.event.skipToday}
            </Button>
          ) : null}
          <Button
            variant="danger"
            size="icon"
            aria-label={t.common.delete}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t.event.deleteConfirmTitle}
        description={t.event.deleteConfirmBody}
        confirmLabel={t.common.delete}
        tone="danger"
        onConfirm={() => {
          const id = event.id;
          void deleteEvent(id);
          onClose();
          toast.undoable(t.event.deleted, () => void restoreEvent(id));
        }}
      />
    </>
  );
}

function toggleDay(days: readonly DayOfWeek[], day: DayOfWeek): DayOfWeek[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
}
