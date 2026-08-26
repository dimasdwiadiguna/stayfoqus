"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import * as React from "react";

import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePomodoroLogs } from "@/hooks/use-tasks";
import { useSettings } from "@/hooks/use-settings";
import { updateAgenda } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import type { Agenda, BufferType, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { sessionDurationMin } from "@/lib/scheduling";
import { formatDuration, instantAt, localDate, localTime } from "@/lib/time";
import { countsAsUsed } from "@/lib/todos/derived";

const BUFFER_TYPES: { value: BufferType; label: string }[] = [
  { value: "switch", label: t.agenda.bufferSwitch },
  { value: "commute", label: t.agenda.bufferCommute },
];

export function AgendaSheet({
  agendaId,
  onClose,
  onDelete,
  onStartFocus,
}: {
  agendaId: UUID | null;
  onClose: () => void;
  onDelete: (agenda: Agenda) => void;
  onStartFocus?: (agenda: Agenda) => void;
}) {
  const agenda = useLiveQuery(
    () => (agendaId ? getDb().agendas.get(agendaId) : undefined),
    [agendaId],
  );

  return (
    <Sheet open={Boolean(agendaId)} onOpenChange={(open) => !open && onClose()}>
      {agenda ? (
        <AgendaSheetContent
          agenda={agenda}
          onDelete={onDelete}
          onStartFocus={onStartFocus}
        />
      ) : null}
    </Sheet>
  );
}

function AgendaSheetContent({
  agenda,
  onDelete,
  onStartFocus,
}: {
  agenda: Agenda;
  onDelete: (agenda: Agenda) => void;
  onStartFocus?: (agenda: Agenda) => void;
}) {
  const settings = useSettings();
  const logs = usePomodoroLogs();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const todo = useLiveQuery(() => getDb().todos.get(agenda.todo_id), [agenda.todo_id]);
  const completed = logs.filter(
    (log) => log.agenda_id === agenda.id && countsAsUsed(log),
  ).length;

  const date = localDate(agenda.start_at, settings.timezone);
  const time = localTime(agenda.start_at, settings.timezone);
  const shape = {
    focusMin: settings.pomodoro_focus_min,
    shortBreakMin: settings.pomodoro_short_break_min,
  };

  const reschedule = (nextDate: string, nextTime: string, pomodoros: number) => {
    const start = instantAt(nextDate, nextTime, settings.timezone).getTime();
    const end = start + sessionDurationMin(pomodoros, shape) * 60_000;
    void updateAgenda(agenda.id, {
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      allocated_pomodoro: pomodoros,
    });
  };

  return (
    <SheetContent
      title={agenda.title_override ?? todo?.title ?? t.agenda.title}
      description={t.agenda.status[agenda.status]}
      footer={
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="icon"
            aria-label={t.common.delete}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
          {onStartFocus ? (
            <Button variant="primary" block onClick={() => onStartFocus(agenda)}>
              {t.agenda.startFocus}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <span className="text-[13px] text-fg-muted">{t.common.pomodoro}</span>
          <PomodoroDots
            allocated={agenda.allocated_pomodoro}
            completed={completed}
            running={false}
            size={9}
          />
        </div>

        {agenda.outside_window ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {t.calendar.outsideWindowBadge}
          </p>
        ) : null}
        {agenda.gcal_conflict ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {t.calendar.gcalConflict}
          </p>
        ) : null}

        <Field label={t.agenda.fieldTitleOverride}>
          <Input
            defaultValue={agenda.title_override ?? ""}
            placeholder={todo?.title ?? ""}
            onBlur={(e) =>
              void updateAgenda(agenda.id, {
                title_override: e.target.value.trim() || null,
              })
            }
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.agenda.fieldStart}>
            <Input
              type="date"
              value={date}
              onChange={(e) =>
                reschedule(e.target.value, time, agenda.allocated_pomodoro)
              }
            />
          </Field>
          <Field label="&nbsp;">
            <Input
              type="time"
              step={300}
              value={time}
              onChange={(e) =>
                reschedule(date, e.target.value, agenda.allocated_pomodoro)
              }
            />
          </Field>
        </div>

        <Field
          label={t.agenda.fieldAllocated}
          hint={formatDuration(sessionDurationMin(agenda.allocated_pomodoro, shape))}
        >
          <div className="flex items-center gap-2">
            <Button
              size="iconSm"
              aria-label="-"
              onClick={() =>
                reschedule(date, time, Math.max(1, agenda.allocated_pomodoro - 1))
              }
            >
              −
            </Button>
            <span className="w-10 text-center text-[15px] font-semibold tabular-nums">
              {agenda.allocated_pomodoro}
            </span>
            <Button
              size="iconSm"
              aria-label="+"
              onClick={() => reschedule(date, time, agenda.allocated_pomodoro + 1)}
            >
              +
            </Button>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.agenda.fieldBufferBefore}>
            <Input
              type="number"
              min={0}
              step={5}
              value={agenda.buffer_before_min}
              onChange={(e) =>
                void updateAgenda(agenda.id, {
                  buffer_before_min: Math.max(0, Number(e.target.value)),
                })
              }
            />
            <div className="mt-1.5">
              <Select
                ariaLabel={t.agenda.fieldBufferBefore}
                value={agenda.buffer_before_type}
                onValueChange={(v) =>
                  void updateAgenda(agenda.id, {
                    buffer_before_type: v as BufferType,
                  })
                }
                items={BUFFER_TYPES}
              />
            </div>
          </Field>
          <Field label={t.agenda.fieldBufferAfter}>
            <Input
              type="number"
              min={0}
              step={5}
              value={agenda.buffer_after_min}
              onChange={(e) =>
                void updateAgenda(agenda.id, {
                  buffer_after_min: Math.max(0, Number(e.target.value)),
                })
              }
            />
            <div className="mt-1.5">
              <Select
                ariaLabel={t.agenda.fieldBufferAfter}
                value={agenda.buffer_after_type}
                onValueChange={(v) =>
                  void updateAgenda(agenda.id, {
                    buffer_after_type: v as BufferType,
                  })
                }
                items={BUFFER_TYPES}
              />
            </div>
          </Field>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t.agenda.deleteConfirmTitle}
        // §4.3: the copy must say the todo survives.
        description={t.agenda.deleteConfirmBody}
        confirmLabel={t.common.delete}
        tone="danger"
        onConfirm={() => onDelete(agenda)}
      />
    </SheetContent>
  );
}
