"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CalendarClock, CheckCircle2, Inbox, PieChart, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox, Chip } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import {
  deleteAgenda,
  restoreAgenda,
  updateAgenda,
} from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import { createRow, newId } from "@/lib/db/mutations";
import type { Agenda, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import { sessionDurationMin, suggestSlots } from "@/lib/scheduling";
import {
  addDays,
  formatDateWithWeekday,
  formatTimeRange,
  instantAt,
  localDate,
  localTime,
} from "@/lib/time";
import { cn } from "@/lib/utils";

const RESCHEDULE_HORIZON_DAYS = 14;

/**
 * §5.8 — missed agenda review.
 *
 * "An agenda is **missed** when `end_at` is in the past and `status` is still
 * `planned`." Detection runs off the shared clock, so it re-evaluates on
 * foreground without a separate listener.
 */
export function useMissedAgendas(): Agenda[] {
  const now = useNow();
  const rows = useLiveQuery(
    () => getDb().agendas.where("status").equals("planned").toArray(),
    [],
  );

  return React.useMemo(() => {
    if (now === null) return [];
    return (rows ?? [])
      .filter((a) => !a.deleted_at && new Date(a.end_at).getTime() < now)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [rows, now]);
}

export function MissedBanner({ onOpen }: { onOpen: () => void }) {
  const missed = useMissedAgendas();
  const [dismissed, setDismissed] = React.useState(false);

  if (missed.length === 0 || dismissed) return null;

  return (
    <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left text-[14px] font-medium text-warning"
      >
        {t.missed.bannerTitle(missed.length)}
      </button>
      <Button
        size="iconSm"
        variant="ghost"
        aria-label={t.missed.bannerDismiss}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

type ActionKind = "done" | "partial" | "reschedule" | "release";

/**
 * The review sheet. Each missed agenda gets the four one-tap actions from §5.8,
 * and several can be selected at once for a bulk apply.
 */
export function MissedReviewSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Mounted only while open, so its selection resets on close without an
          effect pushing state around. */}
      {open ? <ReviewBody /> : null}
    </Sheet>
  );
}

function ReviewBody() {
  const missed = useMissedAgendas();
  const { todos } = useTaskData();
  const settings = useSettings();
  const [selected, setSelected] = React.useState<Set<UUID>>(new Set());
  const [pomodoroPrompt, setPomodoroPrompt] = React.useState<{
    agendas: Agenda[];
    kind: "done" | "partial";
    used: number;
  } | null>(null);
  const [rescheduling, setRescheduling] = React.useState<Agenda | null>(null);

  const titleOf = React.useCallback(
    (agenda: Agenda) =>
      agenda.title_override ??
      todos.find((todo) => todo.id === agenda.todo_id)?.title ??
      t.agenda.title,
    [todos],
  );

  const toggle = (agendaId: UUID) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(agendaId)) next.delete(agendaId);
      else next.add(agendaId);
      return next;
    });

  const targets = (agenda: Agenda): Agenda[] =>
    selected.size > 0 && selected.has(agenda.id)
      ? missed.filter((a) => selected.has(a.id))
      : [agenda];

  const act = (agenda: Agenda, kind: ActionKind) => {
    const batch = targets(agenda);

    if (kind === "done" || kind === "partial") {
      setPomodoroPrompt({
        agendas: batch,
        kind,
        // Pre-filled with the allocation, adjustable with +/− (§5.8).
        used: batch[0]?.allocated_pomodoro ?? 1,
      });
      return;
    }

    if (kind === "reschedule") {
      setRescheduling(batch[0] ?? agenda);
      return;
    }

    // §5.8 action 4 — "Lepas ke inbox": the agenda (and its GCal event) goes,
    // the todo returns to the unscheduled list.
    void (async () => {
      for (const item of batch) await deleteAgenda(item.id);
      haptic();
      toast.undoable(t.missed.releasedToInbox, () => {
        void Promise.all(batch.map((item) => restoreAgenda(item.id)));
      });
      setSelected(new Set());
    })();
  };

  const commitPomodoro = async () => {
    if (!pomodoroPrompt) return;
    const { agendas, kind, used } = pomodoroPrompt;

    for (const agenda of agendas) {
      await updateAgenda(agenda.id, {
        status: kind === "done" ? "done" : "partial",
        allocated_pomodoro: agenda.allocated_pomodoro,
      });

      // The review records what actually happened, so the pomodoro history
      // stays honest even for sessions the timer never ran (§4.4).
      const existing = await countCompletedLogs(agenda.id);
      for (let i = existing; i < used; i += 1) {
        await createRow("pomodoro_logs", {
          id: newId(),
          agenda_id: agenda.id,
          todo_id: agenda.todo_id,
          started_at: agenda.start_at,
          ended_at: agenda.end_at,
          duration_sec: settings.pomodoro_focus_min * 60,
          type: "focus",
          outcome: "completed",
          is_overtime: i >= agenda.allocated_pomodoro,
        });
      }
    }

    haptic();
    setPomodoroPrompt(null);
    setSelected(new Set());

    // §5.8 action 2 — "Sebagian … and offers to schedule the remainder."
    if (kind === "partial") {
      const first = agendas[0];
      if (first && used < first.allocated_pomodoro) setRescheduling(first);
    }
  };

  return (
    <>
      <SheetContent
        title={t.missed.sheetTitle}
        description={
          selected.size > 0 ? t.missed.bulkSelected(selected.size) : undefined
        }
      >
          {missed.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-fg-subtle">
              {t.missed.allReviewed}
            </p>
          ) : (
            <ul className="space-y-2 pb-2">
              {missed.map((agenda) => (
                <li
                  key={agenda.id}
                  className={cn(
                    "rounded-lg border p-3",
                    selected.has(agenda.id)
                      ? "border-accent bg-accent-soft/40"
                      : "border-border bg-surface-2",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      checked={selected.has(agenda.id)}
                      onCheckedChange={() => toggle(agenda.id)}
                      aria-label={titleOf(agenda)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px]">{titleOf(agenda)}</div>
                      <div className="text-[12px] tabular-nums text-fg-subtle">
                        {formatDateWithWeekday(
                          localDate(agenda.start_at, settings.timezone),
                        )}{" "}
                        ·{" "}
                        {formatTimeRange(
                          agenda.start_at,
                          agenda.end_at,
                          settings.timezone,
                        )}{" "}
                        · {agenda.allocated_pomodoro} {t.common.pomodoro}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    <ActionButton
                      icon={<CheckCircle2 className="size-4" />}
                      label={t.missed.actionDone}
                      onClick={() => act(agenda, "done")}
                    />
                    <ActionButton
                      icon={<PieChart className="size-4" />}
                      label={t.missed.actionPartial}
                      onClick={() => act(agenda, "partial")}
                    />
                    <ActionButton
                      icon={<CalendarClock className="size-4" />}
                      label={t.missed.actionReschedule}
                      onClick={() => act(agenda, "reschedule")}
                    />
                    <ActionButton
                      icon={<Inbox className="size-4" />}
                      label={t.missed.actionRelease}
                      tone="danger"
                      onClick={() => act(agenda, "release")}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
      </SheetContent>

      {/* "asks how many pomodoros were actually used (pre-filled with the
          allocation, adjustable with +/−)" */}
      <Sheet
        open={pomodoroPrompt !== null}
        onOpenChange={(next) => !next && setPomodoroPrompt(null)}
      >
        {pomodoroPrompt ? (
          <SheetContent
            title={t.missed.pomodoroPrompt}
            footer={
              <Button variant="primary" block onClick={() => void commitPomodoro()}>
                {t.common.save}
              </Button>
            }
          >
            <div className="flex items-center justify-center gap-4 py-6">
              <Button
                size="icon"
                aria-label="-"
                onClick={() =>
                  setPomodoroPrompt((p) =>
                    p ? { ...p, used: Math.max(0, p.used - 1) } : p,
                  )
                }
              >
                −
              </Button>
              <span className="w-14 text-center text-3xl font-semibold tabular-nums">
                {pomodoroPrompt.used}
              </span>
              <Button
                size="icon"
                aria-label="+"
                onClick={() =>
                  setPomodoroPrompt((p) => (p ? { ...p, used: p.used + 1 } : p))
                }
              >
                +
              </Button>
            </div>
            {pomodoroPrompt.agendas.length > 1 ? (
              <p className="pb-2 text-center text-[12px] text-fg-subtle">
                {t.missed.bulkSelected(pomodoroPrompt.agendas.length)}
              </p>
            ) : null}
          </SheetContent>
        ) : null}
      </Sheet>

      <RescheduleSheet
        agenda={rescheduling}
        onClose={() => setRescheduling(null)}
      />
    </>
  );
}

function ActionButton({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2 text-[13px] font-medium hover:bg-surface-3",
        tone === "danger" && "text-danger",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * §5.8 action 3 — "computes and offers **3 nearest valid slots** (using the
 * same free-space engine as smart allocation) as one-tap chips, plus 'Pilih
 * waktu lain…'."
 */
function RescheduleSheet({
  agenda,
  onClose,
}: {
  agenda: Agenda | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={Boolean(agenda)} onOpenChange={(next) => !next && onClose()}>
      {agenda ? (
        <RescheduleBody key={agenda.id} agenda={agenda} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function RescheduleBody({
  agenda,
  onClose,
}: {
  agenda: Agenda;
  onClose: () => void;
}) {
  const settings = useSettings();
  const now = useNow();
  const { todos } = useTaskData();
  const todo = todos.find((x) => x.id === agenda.todo_id);

  const today = localDate(new Date(), settings.timezone);
  const world = useSchedulingWorld({
    from: today,
    to: addDays(today, RESCHEDULE_HORIZON_DAYS),
    // The agenda being moved must not block its own replacement slot.
    excludeAgendaIds: React.useMemo(() => new Set([agenda.id]), [agenda.id]),
  });

  const slots = React.useMemo(
    () =>
      suggestSlots({
        todo: {
          categoryId: todo?.category_id ?? null,
          tags: todo?.tags ?? [],
          priority: todo?.priority ?? 4,
        },
        free: world.free,
        timeBlocks: world.timeBlocks,
        buffers: world.buffers,
        shape: world.shape,
        pomodoros: agenda.allocated_pomodoro,
        limit: 3,
        notBefore: now ?? 0,
      }),
    [todo, world, agenda.allocated_pomodoro, now],
  );

  const moveTo = async (start: number, pomodoros: number) => {
    const end = start + sessionDurationMin(pomodoros, world.shape) * 60_000;
    await updateAgenda(agenda.id, {
      start_at: new Date(start).toISOString(),
      end_at: new Date(end).toISOString(),
      allocated_pomodoro: pomodoros,
      status: "planned",
    });
    haptic();
    toast.success(t.agenda.scheduled);
    onClose();
  };

  return (
    <SheetContent
      title={t.missed.rescheduleTitle}
      description={agenda.title_override ?? todo?.title ?? undefined}
    >
      <div className="space-y-3 pb-2">
        {slots.length === 0 ? (
          <p className="text-[13px] text-fg-subtle">{t.agenda.noSlots}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {slots.map((slot) => (
              <Chip
                key={slot.start}
                className="min-h-12 justify-start px-3"
                onClick={() => void moveTo(slot.start, slot.pomodoros)}
              >
                <CalendarClock className="size-4 text-accent" />
                {formatDateWithWeekday(slot.date)} ·{" "}
                {localTime(new Date(slot.start), settings.timezone)}
              </Chip>
            ))}
          </div>
        )}

        <ManualReschedule
          timezone={settings.timezone}
          defaultDate={today}
          onPick={(start) => void moveTo(start, agenda.allocated_pomodoro)}
        />
      </div>
    </SheetContent>
  );
}

function ManualReschedule({
  timezone,
  defaultDate,
  onPick,
}: {
  timezone: string;
  defaultDate: string;
  onPick: (startMs: number) => void;
}) {
  const [date, setDate] = React.useState(defaultDate);
  const [time, setTime] = React.useState("09:00");

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
      <span className="text-[12px] font-medium text-fg-muted">
        {t.agenda.pickAnotherTime}
      </span>
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t.agenda.fieldStart}
          className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 text-[15px]"
        />
        <input
          type="time"
          step={300}
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label={t.agenda.fieldStart}
          className="h-11 flex-1 rounded-lg border border-border bg-surface px-3 text-[15px]"
        />
      </div>
      <Button
        block
        // Built through the timezone boundary, never from a naive string (§13).
        onClick={() => onPick(instantAt(date, time, timezone).getTime())}
      >
        {t.common.save}
      </Button>
    </div>
  );
}

async function countCompletedLogs(agendaId: UUID): Promise<number> {
  const logs = await getDb().pomodoro_logs.where("agenda_id").equals(agendaId).toArray();
  return logs.filter(
    (log) => !log.deleted_at && log.type === "focus" && log.outcome === "completed",
  ).length;
}
