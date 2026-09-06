"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CalendarClock, Link2, Link2Off, ListTodo, Trash2 } from "lucide-react";
import * as React from "react";

import { BufferField } from "@/components/calendar/buffer-field";
import { CommuteField } from "@/components/calendar/commute-field";
import { DurationPicker } from "@/components/calendar/duration-picker";
import { PomodoroDots } from "@/components/calendar/pomodoro-dots";
import { PlaceField } from "@/components/places/place-field";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCommuteAssignments } from "@/hooks/use-commute";
import { useAgendas, usePomodoroLogs } from "@/hooks/use-tasks";
import { useSettings } from "@/hooks/use-settings";
import { linkImmediatelyAfter, updateAgenda } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import type { Agenda, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { abuttingPredecessor, wouldCycle } from "@/lib/scheduling";
import { formatDateWithWeekday, localDate, localTime } from "@/lib/time";
import { countsAsUsed } from "@/lib/todos/derived";

export function AgendaSheet({
  agendaId,
  onClose,
  onDelete,
  onStartFocus,
  onOpenTodo,
  onMove,
}: {
  agendaId: UUID | null;
  onClose: () => void;
  onDelete: (agenda: Agenda) => void;
  onStartFocus?: (agenda: Agenda) => void;
  onOpenTodo?: (todoId: UUID) => void;
  /** Opens the slot picker to move this agenda. */
  onMove?: (agenda: Agenda) => void;
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
          onOpenTodo={onOpenTodo}
          onMove={onMove}
        />
      ) : null}
    </Sheet>
  );
}

function AgendaSheetContent({
  agenda,
  onDelete,
  onStartFocus,
  onOpenTodo,
  onMove,
}: {
  agenda: Agenda;
  onDelete: (agenda: Agenda) => void;
  onStartFocus?: (agenda: Agenda) => void;
  onOpenTodo?: (todoId: UUID) => void;
  onMove?: (agenda: Agenda) => void;
}) {
  const settings = useSettings();
  const logs = usePomodoroLogs();
  const allAgendas = useAgendas();
  /*
   * No delete confirmation. The delete is soft and its undo toast is a true
   * inverse (D-022), and §4.3's requirement — that the copy say the todo
   * survives — is met by `t.agenda.deleted`, which is that sentence word for
   * word. A dialog in front of a reversible action asks the user to decide
   * twice.
   */

  const todo = useLiveQuery(() => getDb().todos.get(agenda.todo_id), [agenda.todo_id]);

  /** The agenda this one is pinned behind, resolved to something readable. */
  const predecessorTitle = useLiveQuery(async () => {
    if (!agenda.follows_agenda_id) return "";
    const row = await getDb().agendas.get(agenda.follows_agenda_id);
    if (!row) return "";
    if (row.title_override) return row.title_override;
    return (await getDb().todos.get(row.todo_id))?.title ?? t.agenda.title;
  }, [agenda.follows_agenda_id]) ?? "";

  /**
   * A neighbour this agenda already rests against, if pinning to it would be
   * legal. Same 6-minute tolerance as the drag path's settled test, and the gap
   * still comes from §5.2's composed rule rather than a second one.
   */
  const link = useLiveQuery(async () => {
    if (agenda.follows_agenda_id) return null;
    const day = localDate(agenda.start_at, settings.timezone);
    const sameDay = allAgendas.filter(
      (row) =>
        row.id !== agenda.id &&
        row.status !== "cancelled" &&
        localDate(row.start_at, settings.timezone) === day,
    );
    const found = abuttingPredecessor(sameDay, {
      start: new Date(agenda.start_at).getTime(),
      bufferBefore: {
        min: agenda.buffer_before_min,
        type: agenda.buffer_before_type,
      },
    });
    if (!found) return null;
    if (wouldCycle([...sameDay, agenda], agenda.id, found.id)) return null;
    const title =
      found.title_override ??
      (await getDb().todos.get(found.todo_id))?.title ??
      t.agenda.title;
    return { id: found.id, title };
  }, [
    agenda.id,
    agenda.start_at,
    agenda.follows_agenda_id,
    agenda.buffer_before_min,
    agenda.buffer_before_type,
    allAgendas,
    settings.timezone,
  ]);
  const linkTarget = link ?? null;
  const linkTargetTitle = link?.title ?? "";

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

  // A pinned agenda's start is derived, not authored — offering to move it
  // would be overwritten by the next chain resolve.
  const pinned = agenda.follows_agenda_id !== null;
  const assignments = useCommuteAssignments(date);

  /*
   * D-132's open-if-set rule: a fold must never hide state the user set and can
   * no longer see. "Set" here means anything the defaults would not have
   * produced — a title of its own, a place, a hand-typed buffer (commute_auto
   * 0, D-114), or a buffer that no longer matches Settings.
   *
   * A located agenda therefore usually opens its fold, which is the right
   * trade: a place implies a computed journey, and a journey is worth seeing.
   */
  const carriesDetail =
    agenda.title_override !== null ||
    agenda.place_id !== null ||
    agenda.commute_auto === 0 ||
    agenda.buffer_before_min !== settings.default_buffer_before_min ||
    agenda.buffer_after_min !== settings.default_buffer_after_min ||
    agenda.buffer_before_type !== settings.default_buffer_type ||
    agenda.buffer_after_type !== settings.default_buffer_type;

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
            onClick={() => onDelete(agenda)}
          >
            <Trash2 className="size-4" />
          </Button>
          {onOpenTodo ? (
            <Button
              variant="secondary"
              size="icon"
              aria-label={t.agenda.openTodo}
              title={t.agenda.openTodo}
              onClick={() => onOpenTodo(agenda.todo_id)}
            >
              <ListTodo className="size-4" />
            </Button>
          ) : null}
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

        {/*
          The link had exactly one way in: dragging one block against another.
          A relationship the app stores as a column should not be reachable only
          by a pointer gesture (R-32), so where a block already rests against a
          neighbour the offer is made here too. `wouldCycle` gates it for the
          same reason the drag cue is gated: an offer the write would refuse is
          worse than no offer.
        */}
        {!agenda.follows_agenda_id && linkTarget ? (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
            <p className="text-[13px]">
              {t.agenda.followsNamed(linkTargetTitle)}
            </p>
            <p className="text-[12px] text-fg-subtle">
              {t.agenda.immediatelyAfterHint}
            </p>
            <Button
              size="sm"
              onClick={() => void linkImmediatelyAfter(agenda.id, linkTarget.id)}
            >
              <Link2 className="size-4" />
              {t.agenda.immediatelyAfter}
            </Button>
          </div>
        ) : null}

        {agenda.follows_agenda_id ? (
          <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5">
            {/* Naming it matters: "mengikuti agenda sebelumnya" is only useful
                if the user can tell which one that is. */}
            <p className="text-[13px] font-medium text-success">
              {t.agenda.followsNamed(predecessorTitle)}
            </p>
            <p className="text-[12px] text-success/80">
              {t.agenda.immediatelyAfterHint}
            </p>
            <Button
              size="sm"
              onClick={() => void linkImmediatelyAfter(agenda.id, null)}
            >
              <Link2Off className="size-4" />
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

        <Field label={t.agenda.fieldDuration}>
          <DurationPicker
            valueMin={durationMin}
            onChange={setDuration}
            shape={shape}
          />
        </Field>

        {/*
          Moving an agenda is the same question as scheduling it, so it opens
          the same three-tab picker (D-106) — a bare date field skipped the
          suggestions, the prayer avoidance and the time-block rules entirely.
        */}
        <Field
          label={t.agenda.fieldSchedule}
          hint={pinned ? t.agenda.pinnedSchedule : undefined}
        >
          <Button
            block
            variant="outline"
            disabled={pinned}
            onClick={() => onMove?.(agenda)}
          >
            <CalendarClock className="size-4" />
            {formatDateWithWeekday(date)} · {time}
          </Button>
        </Field>

        {/*
          The set-once three, folded (D-132's rule, third surface): a title that
          defaults to the todo's, a place, and the two buffers with their type
          swatches and the commute toggle. Eight controls sitting under the two
          the sheet is actually opened for, Durasi and Jadwal.

          The warnings and the chain cards above stay put — they are alerts, not
          fields, and an alert that has to be unfolded is not an alert.
        */}
        <Disclosure
          label={t.common.moreDetail}
          contentClassName="space-y-5 pt-3"
          defaultOpen={carriesDetail}
        >
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

          <PlaceField
            value={agenda.place_id}
            onChange={(place_id) => void updateAgenda(agenda.id, { place_id })}
          />

          <div className="grid grid-cols-2 gap-3">
            <CommuteField
              label={t.agenda.fieldBufferBefore}
              minutes={agenda.buffer_before_min}
              type={agenda.buffer_before_type}
              placeId={agenda.place_id}
              auto={agenda.commute_auto}
              assignment={assignments.get(agenda.id)}
              onMinutes={(buffer_before_min) =>
                void updateAgenda(agenda.id, { buffer_before_min })
              }
              onType={(buffer_before_type) =>
                void updateAgenda(agenda.id, { buffer_before_type })
              }
              onAutoChange={(commute_auto) =>
                void updateAgenda(agenda.id, { commute_auto })
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
        </Disclosure>
      </div>
    </SheetContent>
  );
}
