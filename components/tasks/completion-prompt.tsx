"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { Todo } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";

export interface CompletionRequest {
  todo: Todo;
  suggested: number;
  alreadyToday: number;
}

/**
 * Asks how many pomodoros a todo actually took, at the moment it is completed.
 *
 * Pre-filled with what the timer already recorded, or the estimate when it
 * recorded nothing — so the common case is one tap on Simpan, and the number is
 * only touched when reality differed.
 */
export function CompletionPrompt({
  request,
  onCancel,
  onConfirm,
}: {
  request: CompletionRequest | null;
  onCancel: () => void;
  onConfirm: (reported: number) => void;
}) {
  return (
    <Sheet open={Boolean(request)} onOpenChange={(open) => !open && onCancel()}>
      {request ? (
        <PromptBody
          key={request.todo.id}
          request={request}
          onConfirm={onConfirm}
        />
      ) : null}
    </Sheet>
  );
}

function PromptBody({
  request,
  onConfirm,
}: {
  request: CompletionRequest;
  onConfirm: (reported: number) => void;
}) {
  const [value, setValue] = React.useState(() => Math.max(0, request.suggested));

  return (
    <SheetContent
      title={t.tasks.completedPomodoroPrompt}
      description={request.todo.title}
      footer={
        <Button variant="primary" block onClick={() => onConfirm(value)}>
          {t.common.save}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <div className="flex items-center justify-center gap-5 py-5">
          <Button
            size="icon"
            aria-label="-"
            onClick={() => setValue((n) => Math.max(0, n - 1))}
          >
            −
          </Button>
          <span className="w-16 text-center text-4xl font-semibold tabular-nums">
            {value}
          </span>
          <Button
            size="icon"
            aria-label="+"
            onClick={() => setValue((n) => Math.min(99, n + 1))}
          >
            +
          </Button>
        </div>

        <p className="text-center text-[13px] text-fg-muted">
          {value === 0 ? t.tasks.completedPomodoroNone : t.tasks.completedPomodoroHint}
        </p>

        {request.alreadyToday > 0 ? (
          <p className="text-center text-[12px] text-fg-subtle">
            {t.tasks.completedPomodoroAlready(request.alreadyToday)}
          </p>
        ) : null}
      </div>
    </SheetContent>
  );
}
