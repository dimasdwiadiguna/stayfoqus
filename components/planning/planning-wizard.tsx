"use client";

import { ArrowLeft, ArrowRight, Plus, Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PlanningCelebration } from "@/components/planning/planning-celebration";
import { Button } from "@/components/ui/button";
import { CheckIndicator, Input } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { useNow } from "@/hooks/use-now";
import { usePlaceIndex } from "@/hooks/use-places";
import { useSchedulingWorld } from "@/hooks/use-scheduling";
import { useSettings } from "@/hooks/use-settings";
import { useTaskData } from "@/hooks/use-tasks";
import { allocateDay, nothingToAllocate } from "@/lib/agendas/allocate-day";
import type { UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";
import { localDate } from "@/lib/time";
import { createTodo, updateTodo } from "@/lib/todos/repo";

const MAX_MIT = 3;

type Step = "targets" | "mit";

/**
 * The daily planning wizard.
 *
 * Two steps, each one decision: choose what today is for, then name the three
 * that matter most — and the second step's button places them. It used to have
 * a third step that walked the list through `ScheduleSheet` one todo at a time,
 * which was the right shape for a week and is the wrong one for a day: for a
 * single day, allocating and then nudging the drafts on the timeline is fewer
 * taps than three sheets in a row (D-125). `ScheduleSheet` still owns the
 * ordinary "Jadwalkan" path, so no scheduling flow was lost.
 *
 * It ends with a small, earned celebration (D-089).
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
  const router = useRouter();
  const settings = useSettings();
  const now = useNow();
  const { todos, index, counters, agendas } = useTaskData();

  const today = localDate(new Date(), settings.timezone);
  const world = useSchedulingWorld({ from: today, to: today });
  const places = usePlaceIndex();

  const [step, setStep] = React.useState<Step>("targets");
  const [selected, setSelected] = React.useState<ReadonlySet<UUID>>(
    () => new Set(),
  );
  const [mit, setMit] = React.useState<readonly UUID[]>([]);
  const [newTitle, setNewTitle] = React.useState("");

  const [running, setRunning] = React.useState(false);
  const [placedCount, setPlacedCount] = React.useState(0);
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
    const created = await createTodo({ title, status: "active" });
    setSelected((prev) => new Set(prev).add(created.id));
    setNewTitle("");
  };

  /* ---------------- step transitions ------------------------------------ */

  const allocateSelection = async () => {
    setRunning(true);
    try {
      // §4.2's P1 is "Mendesak". Naming a task one of the day's three most
      // important *is* that claim, so it is stored as priority rather than as a
      // separate flag the rest of the app would not understand (D-088).
      for (const todoId of mit) {
        await updateTodo(todoId, { priority: 1 });
      }

      const picked = open.filter((todo) => selected.has(todo.id));
      if (nothingToAllocate(picked, counters)) {
        toast.show(t.today.nothingToAllocate);
        return;
      }

      const result = await allocateDay({
        picked,
        index,
        counters,
        agendas,
        world,
        places,
        settings,
        now,
      });

      if (result.placements.length === 0) {
        toast.show(t.agenda.noSlots);
        return;
      }

      haptic();
      setPlacedCount(result.placements.length);
      setCelebrating(true);
    } finally {
      setRunning(false);
    }
  };

  /* ---------------- render ----------------------------------------------- */

  const stepTitle =
    step === "targets" ? t.planning.stepTargets : t.planning.stepMit;

  const stepHint =
    step === "targets" ? t.planning.stepTargetsHint : t.planning.stepMitHint;

  return (
    <>
      <SheetContent
        title={stepTitle}
        description={stepHint}
        className="h-[92dvh]"
        footer={
          <div className="flex gap-2">
            {step === "mit" ? (
              <Button variant="secondary" onClick={() => setStep("targets")}>
                <ArrowLeft className="size-4" />
                {t.planning.back}
              </Button>
            ) : null}

            {step === "targets" ? (
              <Button
                variant="primary"
                block
                disabled={selected.size === 0}
                onClick={() => setStep("mit")}
              >
                {t.planning.next}
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                variant="primary"
                block
                disabled={running}
                onClick={() => void allocateSelection()}
              >
                <Sparkles className="size-4" />
                {running ? t.planning.allocating : t.planning.allocate}
              </Button>
            )}
          </div>
        }
      >
        {step === "targets" ? (
          <div className="space-y-2.5 pb-2">
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

            <p className="text-[11px] text-fg-subtle">
              {t.planning.selected(selected.size)}
            </p>

            {open.length === 0 ? (
              <p className="text-[13px] text-fg-subtle">
                {t.planning.noCandidates}
              </p>
            ) : (
              <ul className="space-y-1">
                {open.map((todo) => (
                  <li key={todo.id}>
                    <button
                      type="button"
                      onClick={() => toggleSelected(todo.id)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-left"
                    >
                      <CheckIndicator checked={selected.has(todo.id)} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {todo.title}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-fg-subtle">
                        {todo.estimated_pomodoro}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2.5 pb-2">
            <p className="text-[11px] text-fg-subtle">
              {mit.length >= MAX_MIT
                ? t.planning.mitFull
                : t.planning.mitCounter(mit.length)}
            </p>
            <ul className="space-y-1">
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
                            ? "flex min-h-11 w-full items-center gap-2 rounded-lg border border-warning bg-warning/10 px-2.5 text-left"
                            : "flex min-h-11 w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-left disabled:opacity-45"
                        }
                      >
                        <Star
                          className={
                            chosen
                              ? "size-4 shrink-0 fill-warning text-warning"
                              : "size-4 shrink-0 text-fg-subtle"
                          }
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px]">
                          {todo.title}
                        </span>
                        {chosen ? (
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-warning">
                            #{rank + 1}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}
      </SheetContent>

      <PlanningCelebration
        open={celebrating}
        scheduledCount={placedCount}
        date={today}
        soundEnabled={settings.bell_enabled}
        volume={settings.bell_volume}
        onClose={() => {
          setCelebrating(false);
          onClose();
          // §5.5 Step 5: the drafts are waiting on the timeline.
          router.push("/calendar");
        }}
      />
    </>
  );
}
