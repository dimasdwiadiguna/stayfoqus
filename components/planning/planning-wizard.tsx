"use client";

import { ArrowLeft, ArrowRight, Plus, Star } from "lucide-react";
import * as React from "react";

import { ScheduleSheet } from "@/components/calendar/schedule-sheet";
import { PlanningCelebration } from "@/components/planning/planning-celebration";
import { Button } from "@/components/ui/button";
import { Checkbox, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import type { Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import { isoWeekOf, localDate } from "@/lib/time";
import { countersFor } from "@/lib/todos/derived";
import { createTodo, setFocusWeek, updateTodo } from "@/lib/todos/repo";

const MAX_MIT = 3;

type Step = "targets" | "mit" | "schedule";

/**
 * The daily planning wizard.
 *
 * §7.3 already lets the user mark week targets and run smart allocation, which
 * is the *batch* answer. This is the deliberate one: choose what matters, name
 * the three that matter most, then place them yourself, one at a time, in
 * priority order. It ends with a small, earned celebration.
 *
 * Each step is a decision, and no step does two things at once — which is what
 * keeps a three-part flow from feeling like a form.
 */
export function PlanningWizard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      {/* Mounted only while open, so its state resets without an effect. */}
      {open ? <WizardBody onClose={onClose} /> : null}
    </Sheet>
  );
}

function WizardBody({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const { todos, counters } = useTaskData();

  const today = localDate(new Date(), settings.timezone);
  const week = isoWeekOf(today);

  const [step, setStep] = React.useState<Step>("targets");
  const [selected, setSelected] = React.useState<ReadonlySet<UUID>>(
    () => new Set(todos.filter((x) => x.focus_week === week).map((x) => x.id)),
  );
  const [mit, setMit] = React.useState<readonly UUID[]>([]);
  const [newTitle, setNewTitle] = React.useState("");

  const [scheduling, setScheduling] = React.useState<Todo | null>(null);
  const [doneIds, setDoneIds] = React.useState<ReadonlySet<UUID>>(() => new Set());
  const [celebrating, setCelebrating] = React.useState(false);

  const open = React.useMemo(
    () =>
      todos.filter(
        (todo) => todo.status !== "done" && todo.status !== "archived",
      ),
    [todos],
  );

  const toggleSelected = (todoId: UUID) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(todoId)) next.delete(todoId);
      else next.add(todoId);
      return next;
    });

  const toggleMit = (todoId: UUID) =>
    setMit((prev) => {
      if (prev.includes(todoId)) return prev.filter((x) => x !== todoId);
      if (prev.length >= MAX_MIT) return prev;
      return [...prev, todoId];
    });

  const addTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const created = await createTodo({
      title,
      status: "active",
      focus_week: week,
    });
    setSelected((prev) => new Set(prev).add(created.id));
    setNewTitle("");
  };

  /* ---------------- step transitions ------------------------------------ */

  const commitTargets = async () => {
    // Marking targets is a real edit — the plan survives closing the wizard.
    for (const todo of open) {
      const shouldTarget = selected.has(todo.id);
      const isTarget = todo.focus_week === week;
      if (shouldTarget !== isTarget) {
        await setFocusWeek(todo.id, shouldTarget ? week : null);
      }
    }
    setStep("mit");
  };

  const commitMit = async () => {
    // §4.2's P1 is "Mendesak". Naming a task one of the day's three most
    // important *is* that claim, so it is stored as priority rather than as a
    // separate flag the rest of the app would not understand.
    for (const todoId of mit) {
      await updateTodo(todoId, { priority: 1 });
    }
    haptic();
    setStep("schedule");
  };

  /* ---------------- the queue for step 3 --------------------------------- */

  const queue = React.useMemo(() => {
    const chosen = open.filter((todo) => selected.has(todo.id));
    return chosen
      .slice()
      .sort((a, b) => {
        // The three most important first, in the order the user named them.
        const ai = mit.indexOf(a.id);
        const bi = mit.indexOf(b.id);
        if (ai !== bi) {
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        }
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.created_at.localeCompare(b.created_at);
      })
      .filter((todo) => countersFor(counters, todo.id).remainingToAllocate > 0);
  }, [open, selected, mit, counters]);

  const pending = queue.filter((todo) => !doneIds.has(todo.id));

  const finish = () => {
    setCelebrating(true);
  };

  /* ---------------- render ----------------------------------------------- */

  const stepTitle =
    step === "targets"
      ? t.planning.stepTargets
      : step === "mit"
        ? t.planning.stepMit
        : t.planning.stepSchedule;

  const stepHint =
    step === "targets"
      ? t.planning.stepTargetsHint
      : step === "mit"
        ? t.planning.stepMitHint
        : t.planning.stepScheduleHint;

  return (
    <>
      <SheetContent
        title={stepTitle}
        description={stepHint}
        className="h-[92dvh]"
        footer={
          <div className="flex gap-2">
            {step !== "targets" ? (
              <Button
                variant="secondary"
                onClick={() => setStep(step === "mit" ? "targets" : "mit")}
              >
                <ArrowLeft className="size-4" />
                {t.planning.back}
              </Button>
            ) : null}

            {step === "targets" ? (
              <Button
                variant="primary"
                block
                disabled={selected.size === 0}
                onClick={() => void commitTargets()}
              >
                {t.planning.next}
                <ArrowRight className="size-4" />
              </Button>
            ) : null}

            {step === "mit" ? (
              <Button variant="primary" block onClick={() => void commitMit()}>
                {t.planning.next}
                <ArrowRight className="size-4" />
              </Button>
            ) : null}

            {step === "schedule" ? (
              <Button variant="primary" block onClick={finish}>
                {t.planning.finish}
              </Button>
            ) : null}
          </div>
        }
      >
        {step === "targets" ? (
          <div className="space-y-3 pb-2">
            <div className="flex gap-2">
              <Input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={t.planning.addTask}
                onKeyDown={(e) => e.key === "Enter" && void addTask()}
              />
              <Button
                size="icon"
                aria-label={t.planning.addTask}
                disabled={!newTitle.trim()}
                onClick={() => void addTask()}
              >
                <Plus className="size-4" />
              </Button>
            </div>

            <p className="text-[12px] text-fg-subtle">
              {t.planning.selected(selected.size)}
            </p>

            {open.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">
                {t.planning.noCandidates}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {open.map((todo) => (
                  <li key={todo.id}>
                    <button
                      type="button"
                      onClick={() => toggleSelected(todo.id)}
                      className="flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 text-left"
                    >
                      <Checkbox
                        checked={selected.has(todo.id)}
                        aria-label={todo.title}
                        tabIndex={-1}
                      />
                      <span className="min-w-0 flex-1 truncate text-[15px]">
                        {todo.title}
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-fg-subtle">
                        {todo.estimated_pomodoro}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {step === "mit" ? (
          <div className="space-y-3 pb-2">
            <p className="text-[12px] text-fg-subtle">
              {mit.length >= MAX_MIT
                ? t.planning.mitFull
                : t.planning.mitCounter(mit.length)}
            </p>
            <ul className="space-y-1.5">
              {open
                .filter((todo) => selected.has(todo.id))
                .map((todo) => {
                  const rank = mit.indexOf(todo.id);
                  const chosen = rank >= 0;
                  return (
                    <li key={todo.id}>
                      <button
                        type="button"
                        onClick={() => toggleMit(todo.id)}
                        disabled={!chosen && mit.length >= MAX_MIT}
                        className={
                          chosen
                            ? "flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-warning bg-warning/10 px-3 text-left"
                            : "flex min-h-12 w-full items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 text-left disabled:opacity-45"
                        }
                      >
                        <Star
                          className={
                            chosen
                              ? "size-4 shrink-0 fill-warning text-warning"
                              : "size-4 shrink-0 text-fg-subtle"
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-[15px]">
                          {todo.title}
                        </span>
                        {chosen ? (
                          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-warning">
                            #{rank + 1}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        ) : null}

        {step === "schedule" ? (
          <div className="space-y-3 pb-2">
            <p className="text-[12px] text-fg-subtle">
              {pending.length === 0
                ? t.planning.allScheduled
                : t.planning.remaining(pending.length)}
            </p>

            <ul className="space-y-1.5">
              {queue.map((todo, i) => {
                const scheduled = doneIds.has(todo.id);
                return (
                  <li
                    key={todo.id}
                    className={
                      scheduled
                        ? "flex min-h-12 items-center gap-2.5 rounded-lg border border-success/40 bg-success/10 px-3"
                        : "flex min-h-12 items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3"
                    }
                  >
                    <span className="w-5 shrink-0 text-[12px] tabular-nums text-fg-subtle">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">
                      {todo.title}
                    </span>
                    {scheduled ? (
                      <span className="shrink-0 text-[12px] text-success">
                        {t.common.done}
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setScheduling(todo)}>
                        {t.planning.scheduleNow}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </SheetContent>

      {/* The same sheet the rest of the app uses — one scheduling flow, not two. */}
      <ScheduleSheet
        todo={scheduling}
        onClose={() => setScheduling(null)}
        onScheduled={() => {
          if (scheduling) {
            setDoneIds((prev) => new Set(prev).add(scheduling.id));
          }
        }}
      />

      <PlanningCelebration
        open={celebrating}
        scheduledCount={doneIds.size}
        date={today}
        soundEnabled={settings.bell_enabled}
        volume={settings.bell_volume}
        onClose={() => {
          setCelebrating(false);
          onClose();
        }}
      />
    </>
  );
}
