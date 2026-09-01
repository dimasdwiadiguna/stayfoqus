"use client";

import { CalendarClock } from "lucide-react";
import * as React from "react";

import { DurationPicker } from "@/components/calendar/duration-picker";
import {
  PickTimeline,
  type PickDraft,
} from "@/components/calendar/pick-timeline";
import { PrayerShiftDialog } from "@/components/calendar/prayer-shift-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field, Input, Segmented } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { createAgenda, updateAgenda } from "@/lib/agendas/repo";
import type { Agenda, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import {
  avoidPrayer,
  isInsideWindow,
  overlappingEvent,
  sessionDurationMin,
  suggestSlots,
  violatedBlock,
  type PlacementCandidate,
  type PrayerAvoidance,
} from "@/lib/scheduling";
import {
  addDays,
  formatDateWithWeekday,
  formatDuration,
  instantAt,
  localDate,
  localTime,
} from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";
import { childrenBlockingStart, earliestStartFor } from "@/lib/todos/ordering";

/** How far ahead the suggestion engine looks. */
const HORIZON_DAYS = 14;
/** Days shown in the calendar tab — three fit a phone without crowding. */
const PICK_DAYS = 3;

type PickMode = "list" | "calendar" | "custom";

type PendingConfirm = {
  kind: "outside-window" | "time-block" | "event";
  blockName?: string;
  start: number;
  end: number;
  pomodoros: number;
  followsAgendaId: UUID | null;
} | null;

/**
 * §8's "Jadwalkan" flow, now with three ways to answer the same question.
 *
 * The brief specifies one: three recommended slots plus "Pilih waktu lain…".
 * That is the fastest path when the suggestions are right and a dead end when
 * they are not — a date-and-time field gives no sense of what the day already
 * looks like. The tabs keep the fast path first and add the two the user
 * reaches for when it misses:
 *
 *   Daftar   — the recommended slots (unchanged, still the default)
 *   Kalender — see the day, tap where it should go, drag to adjust
 *   Custom   — type a date and time
 *
 * Duration is chosen once, above the tabs: it is a property of the work, not of
 * how the user happens to pick a time for it.
 */
export function ScheduleSheet({
  todo,
  agenda,
  onClose,
  defaultPomodoros,
  onScheduled,
}: {
  todo: Todo | null;
  /**
   * Set to *move* this agenda rather than create a new one (D-106).
   *
   * Moving an agenda to another day is the same question as scheduling it in
   * the first place, and everything that answers that question already lives
   * here: the suggestions, the three tabs, the prayer avoidance, the time-block
   * and parent-ordering rules. A bare date field skipped all of it.
   */
  agenda?: Agenda | null;
  onClose: () => void;
  defaultPomodoros?: number;
  /** Lets a caller (the planning wizard) advance after a successful schedule. */
  onScheduled?: () => void;
}) {
  return (
    <Sheet open={Boolean(todo)} onOpenChange={(open) => !open && onClose()}>
      {todo ? (
        <SheetContent
          title={agenda ? t.agenda.moveSheetTitle : t.agenda.scheduleSheetTitle}
          description={todo.title}
          className="h-[92dvh]"
        >
          <ScheduleBody
            key={agenda?.id ?? todo.id}
            todo={todo}
            agenda={agenda ?? null}
            onDone={() => {
              onScheduled?.();
              onClose();
            }}
            defaultPomodoros={defaultPomodoros}
          />
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

function ScheduleBody({
  todo,
  agenda,
  onDone,
  defaultPomodoros,
}: {
  todo: Todo;
  agenda: Agenda | null;
  onDone: () => void;
  defaultPomodoros?: number;
}) {
  const settings = useSettings();
  const { counters, index, agendas, todos } = useTaskData();
  const now = useNow();

  /**
   * A parent may not start before its children. The suggestion list simply
   * never offers an earlier slot, and the manual paths refuse one.
   */
  const childFloor = React.useMemo(
    () => earliestStartFor(index, todo.id, agendas),
    [index, todo.id, agendas],
  );

  const todosById = React.useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos],
  );

  const today = localDate(new Date(), settings.timezone);
  const excludeAgendaIds = React.useMemo(
    () => (agenda ? new Set([agenda.id]) : undefined),
    [agenda],
  );
  const world = useSchedulingWorld({
    from: today,
    to: addDays(today, HORIZON_DAYS),
    // Otherwise the agenda occupies the slot it is trying to leave, and the
    // most obvious answer — twenty minutes later — is never offered (D-069).
    excludeAgendaIds,
  });

  const remaining = countersFor(counters, todo.id).remainingToAllocate;
  const initialPomodoros = agenda
    ? agenda.allocated_pomodoro
    : Math.max(1, Math.min(4, defaultPomodoros ?? remaining ?? 1));
  const initialDurationMin = agenda
    ? Math.round(
        (new Date(agenda.end_at).getTime() -
          new Date(agenda.start_at).getTime()) /
          60_000,
      )
    : sessionDurationMin(initialPomodoros, {
        focusMin: settings.pomodoro_focus_min,
        shortBreakMin: settings.pomodoro_short_break_min,
      });

  const [mode, setMode] = React.useState<PickMode>("list");
  const [pomodoros, setPomodoros] = React.useState(initialPomodoros);
  const [durationMin, setDurationMin] = React.useState(initialDurationMin);

  const [draft, setDraft] = React.useState<PickDraft | null>(null);
  const [manualDate, setManualDate] = React.useState(today);
  const [manualTime, setManualTime] = React.useState("09:00");
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null);
  const [avoidance, setAvoidance] = React.useState<{
    result: PrayerAvoidance;
    start: number;
    end: number;
    followsAgendaId: UUID | null;
  } | null>(null);

  const floor = Math.max(now ?? 0, childFloor);

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
        limit: 5,
        notBefore: floor,
      }),
    [todo.category_id, todo.tags, todo.priority, world, pomodoros, floor],
  );

  const commit = async (
    start: number,
    end: number,
    n: number,
    outsideWindow: boolean,
    followsAgendaId: UUID | null,
  ) => {
    if (agenda) {
      // A move writes `follows_agenda_id` explicitly for the same reason every
      // other manual placement does: choosing a time by hand releases the pin
      // unless the user asked for a new one (D-087).
      await updateAgenda(agenda.id, {
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        allocated_pomodoro: n,
        outside_window: outsideWindow,
        follows_agenda_id: followsAgendaId,
      });
      haptic();
      toast.success(t.calendar.moved);
      onDone();
      return;
    }

    await createAgenda(
      {
        todo_id: todo.id,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
        allocated_pomodoro: n,
        outside_window: outsideWindow,
        follows_agenda_id: followsAgendaId,
      },
      settings,
    );
    haptic();
    toast.success(t.agenda.scheduled);
    onDone();
  };

  /**
   * Manual placement is a *soft* constraint (§5.1, §5.4): allowed, but the user
   * is told what they are stepping over. Placing a parent before its children
   * is the one hard refusal.
   */
  const submitManual = (
    start: number,
    end: number,
    followsAgendaId: UUID | null,
    options: { skipPrayer?: boolean } = {},
  ) => {
    if (start < childFloor) {
      const blockers = childrenBlockingStart(index, todo.id, agendas, start);
      toast.error(t.agenda.parentBeforeChild(blockers.map((c) => c.title)));
      return;
    }

    const interval = { start, end };

    // §5.3 — offer the way around a prayer block before asking whether to go
    // through it. Asked first: accepting a shift changes what the window and
    // time-block checks below would be judging.
    if (!options.skipPrayer) {
      const result = avoidPrayer(interval, world.prayers, world.free);
      if (result) {
        setAvoidance({ result, start, end, followsAgendaId });
        return;
      }
    }

    // Same soft confirmation as the calendar's own drop path, so scheduling
    // through the Custom tab cannot quietly step over an event.
    const clash = overlappingEvent(interval, world.events);
    if (clash) {
      setConfirm({
        kind: "event",
        blockName: clash.title,
        start,
        end,
        pomodoros,
        followsAgendaId,
      });
      return;
    }

    if (!isInsideWindow(interval, world.windows)) {
      setConfirm({
        kind: "outside-window",
        start,
        end,
        pomodoros,
        followsAgendaId,
      });
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
        followsAgendaId,
      });
      return;
    }

    void commit(start, end, pomodoros, false, followsAgendaId);
  };

  const takeSlot = (slot: PlacementCandidate) => {
    // Suggestions come from inside the free-space map, so they are legal by
    // construction — no confirmation needed.
    void commit(slot.start, slot.end, slot.pomodoros, false, null);
  };

  // Anchored on the earliest day anything could legally go, which is `floor`
  // once "now" and the child-ordering rule are folded in.
  const pickDays = React.useMemo(() => {
    const anchor = localDate(
      new Date(Number.isFinite(floor) ? floor : 0),
      settings.timezone,
    );
    return Array.from({ length: PICK_DAYS }, (_, i) => addDays(anchor, i));
  }, [floor, settings.timezone]);

  return (
    <div className="space-y-4 pb-2">
      <Field
        label={t.agenda.fieldDuration}
        hint={remaining > 0 ? t.tasks.remainingToAllocate(remaining) : undefined}
      >
        <DurationPicker
          valueMin={durationMin}
          shape={world.shape}
          onChange={(minutes, n) => {
            setDurationMin(minutes);
            setPomodoros(n);
            // A different length invalidates where the draft was placed.
            setDraft((current) =>
              current
                ? { ...current, end: current.start + minutes * 60_000 }
                : null,
            );
          }}
        />
      </Field>

      <Segmented
        ariaLabel={t.agenda.scheduleSheetTitle}
        value={mode}
        onChange={setMode}
        className="w-full"
        options={[
          { value: "list" as const, label: t.agenda.tabList },
          { value: "calendar" as const, label: t.agenda.tabCalendar },
          { value: "custom" as const, label: t.agenda.tabCustom },
        ]}
      />

      {mode === "list" ? (
        slots.length === 0 ? (
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
                      {localTime(new Date(slot.start), settings.timezone)}
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
        )
      ) : null}

      {mode === "calendar" ? (
        <div className="space-y-3">
          <PickTimeline
            days={pickDays}
            timezone={settings.timezone}
            windows={world.windows}
            prayers={world.prayers}
            timeBlocks={world.timeBlocks}
            agendas={agendas}
            events={world.events}
            todosById={todosById}
            busy={world.busy.filter((b) => b.source === "gcal_busy")}
            durationMin={durationMin}
            buffers={world.buffers}
            draft={draft}
            onChange={setDraft}
            notBefore={floor}
          />
          <Button
            variant="primary"
            block
            disabled={!draft}
            onClick={() => {
              if (!draft) return;
              submitManual(draft.start, draft.end, draft.followsAgendaId);
            }}
          >
            {t.common.save}
          </Button>
        </div>
      ) : null}

      {mode === "custom" ? (
        <div className="space-y-3">
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
          <Button
            variant="primary"
            block
            onClick={() => {
              const start = instantAt(
                manualDate,
                manualTime,
                settings.timezone,
              ).getTime();
              submitManual(start, start + durationMin * 60_000, null);
            }}
          >
            {t.common.save}
          </Button>
        </div>
      ) : null}

      <PrayerShiftDialog
        avoidance={avoidance?.result ?? null}
        timezone={settings.timezone}
        onOpenChange={(open) => !open && setAvoidance(null)}
        onShift={(interval) => {
          setAvoidance(null);
          setDraft((current) =>
            current
              ? { ...current, start: interval.start, end: interval.end, followsAgendaId: null }
              : current,
          );
          // The pin described an abutment that no longer holds after a shift,
          // so it is dropped rather than carried to a different instant.
          submitManual(interval.start, interval.end, null);
        }}
        onKeep={() => {
          if (!avoidance) return;
          // Read from the pending state, not from `draft`: the custom tab
          // reaches this dialog without ever placing one.
          const { start, end, followsAgendaId } = avoidance;
          setAvoidance(null);
          submitManual(start, end, followsAgendaId, { skipPrayer: true });
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === "event"
            ? t.calendar.eventConflictConfirm(confirm.blockName ?? "")
            : confirm?.kind === "time-block"
              ? t.calendar.timeBlockConfirm(confirm.blockName ?? "")
              : t.calendar.outsideWindowConfirm
        }
        confirmLabel={
          confirm?.kind === "outside-window"
            ? t.calendar.scheduleAnyway
            : t.calendar.placeAnyway
        }
        onConfirm={() => {
          if (!confirm) return;
          void commit(
            confirm.start,
            confirm.end,
            confirm.pomodoros,
            confirm.kind === "outside-window",
            confirm.followsAgendaId,
          );
        }}
      />
    </div>
  );
}

export { HORIZON_DAYS };
