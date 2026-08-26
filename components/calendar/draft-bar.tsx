"use client";

import { useLiveQuery } from "dexie-react-hooks";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { applyDrafts, discardDrafts, revertToDrafts } from "@/lib/agendas/repo";
import { getDb } from "@/lib/db/client";
import { id as t } from "@/lib/i18n/id";
import { haptic } from "@/lib/reward";

/** §5.5 Step 5 gives the undo window an explicit 10 seconds. */
const UNDO_MS = 10_000;

/**
 * §5.5 Step 5 / §7.3 — the draft preview bar, pinned to the bottom of the
 * calendar whenever any draft agenda exists.
 *
 * "Only on **Terapkan** are they promoted to `planned` and queued for Google
 * Calendar. Show a toast with **Urungkan** that reverts the entire batch for
 * 10 seconds."
 */
export function DraftBar() {
  const drafts = useLiveQuery(
    () => getDb().agendas.where("status").equals("draft").toArray(),
    [],
  );

  const live = (drafts ?? []).filter((a) => !a.deleted_at);
  if (live.length === 0) return null;

  const ids = live.map((a) => a.id);

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom,0px))] z-30 mx-auto max-w-md border-t border-accent/40 bg-surface/95 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            void discardDrafts(ids);
            toast.show(t.week.reverted);
          }}
        >
          {t.week.discardDrafts}
        </Button>
        <Button
          variant="primary"
          block
          onClick={() => {
            void applyDrafts(ids);
            haptic();
            toast.undoable(
              t.week.applied(ids.length),
              () => void revertToDrafts(ids),
              { durationMs: UNDO_MS },
            );
          }}
        >
          {t.week.applyDrafts(ids.length)}
        </Button>
      </div>
    </div>
  );
}
