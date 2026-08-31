"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import * as React from "react";

import { BufferSwatch } from "@/components/calendar/buffer-band";
import { DurationPicker } from "@/components/calendar/duration-picker";
import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Chip, Field, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePomodoroLogs } from "@/hooks/use-tasks";
import { useSettings } from "@/hooks/use-settings";
import { linkImmediatelyAfter, updateAgenda } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import type { Agenda, BufferType, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { instantAt, localDate, localTime } from "@/lib/time";
import { countsAsUsed } from "@/lib/todos/derived";

const BUFFER_TYPES: BufferType[] = ["switch", "commute"];

/**
 * §5.2 — the buffer editor.
 *
 * The type is picked with the same swatches the timeline draws, so the choice
 * made here is recognisable there. It matters more than a usual enum: the two
 * types compose differently (max within a type, sum across), so the user has to
 * be able to tell at a glance which one an agenda carries.
 */
function BufferField({
  label,
  minutes,
  type,
  onMinutes,
  onType,
}: {
  label: string;
  minutes: number;
  type: BufferType;
  onMinutes: (minutes: number) => void;
  onType: (type: BufferType) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={0}
        step={5}
        value={minutes}
        aria-label={label}
        onChange={(e) => onMinutes(Math.max(0, Number(e.target.value)))}
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BUFFER_TYPES.map((value) => (
          <Chip
            key={value}
            active={type === value}
            aria-label={
              value === "commute" ? t.agenda.bufferCommute : t.agenda.bufferSwitch
            }
            onClick={() => onType(value)}
          >
            <BufferSwatch type={value} />
          </Chip>
        ))}
      </div>
    </Field>
  );
}

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

  const durationMin = Math.round(
    (new Date(agenda.end_at).getTime() - new Date(agenda.start_at).getTime()) /
      60_000,
  );

  /** Moves the agenda, keeping its current length. */
  const moveTo = (nextDate: string, nextTime: string) => {
    const start = instantAt(nextDate, nextTime, settings.timezone).getTime();
    void updateAgenda(agenda.id, {
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + durationMin * 60_000).toISOString(),
    });
  };

  /** Sets the length from the duration presets, deriving the pomodoro count. */
  const setDuration = (minutes: number, pomodoros: number) => {
    const start = new Date(agenda.start_at).getTime();
    void updateAgenda(agenda.id, {
      end_at: new Date(start + minutes * 60_000).toISOString(),
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

        {agenda.follows_agenda_id ? (
          <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5">
            <p className="text-[13px] text-success">
              {t.agenda.immediatelyAfterHint}
            </p>
            <Button
              size="sm"
              onClick={() => void linkImmediatelyAfter(agenda.id, null)}
            >
              {t.agenda.unlinkImmediatelyAfter}
            </Button>
          </div>
        ) : null}

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
              disabled={agenda.follows_agenda_id !== null}
              onChange={(e) => moveTo(e.target.value, time)}
            />
          </Field>
          <Field label="&nbsp;">
            <Input
              type="time"
              step={300}
              value={time}
              // A pinned agenda's start is derived, not authored — editing it
              // here would be overwritten by the next chain resolve.
              disabled={agenda.follows_agenda_id !== null}
              onChange={(e) => moveTo(date, e.target.value)}
            />
          </Field>
        </div>

        <Field label={t.agenda.fieldDuration}>
          <DurationPicker
            valueMin={durationMin}
            onChange={setDuration}
            shape={shape}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <BufferField
            label={t.agenda.fieldBufferBefore}
            minutes={agenda.buffer_before_min}
            type={agenda.buffer_before_type}
            onMinutes={(buffer_before_min) =>
              void updateAgenda(agenda.id, { buffer_before_min })
            }
            onType={(buffer_before_type) =>
              void updateAgenda(agenda.id, { buffer_before_type })
            }
          />
          <BufferField
            label={t.agenda.fieldBufferAfter}
            minutes={agenda.buffer_after_min}
            type={agenda.buffer_after_type}
            onMinutes={(buffer_after_min) =>
              void updateAgenda(agenda.id, { buffer_after_min })
            }
            onType={(buffer_after_type) =>
              void updateAgenda(agenda.id, { buffer_after_type })
            }
          />
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
