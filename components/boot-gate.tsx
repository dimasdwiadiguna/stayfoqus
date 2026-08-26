"use client";

import * as React from "react";

import { setAfterMutate, setCurrentUserId } from "@/lib/db/mutations";
import { seedIfNeeded } from "@/lib/db/seed";
import { id as t } from "@/lib/i18n/id";
import { getSupabase } from "@/lib/supabase/client";
import { requestSync, setConflictHandler, startSyncEngine } from "@/lib/sync/engine";
import { toast } from "@/components/ui/toast";

/**
 * Runs the one-time client boot sequence before any screen renders:
 * seed the database, adopt the signed-in user id, then start the sync engine.
 *
 * Everything below the gate reads from IndexedDB, so rendering earlier would
 * flash empty lists on every cold start.
 */
export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let stopEngine: (() => void) | undefined;

    (async () => {
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (data.user) setCurrentUserId(data.user.id);
      }

      await seedIfNeeded();
      if (cancelled) return;

      setAfterMutate(requestSync);
      setConflictHandler((count) => toast.show(t.sync.conflictApplied(count)));
      stopEngine = startSyncEngine();
      setReady(true);
    })().catch((err) => {
      console.error("[foqus] boot failed", err);
      // A boot failure must not leave a blank screen: the UI degrades to
      // whatever IndexedDB already holds.
      if (!cancelled) setReady(true);
    });

    return () => {
      cancelled = true;
      setAfterMutate(null);
      stopEngine?.();
    };
  }, []);

  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div
          aria-label={t.common.loading}
          className="size-8 animate-spin rounded-full border-2 border-border border-t-accent"
        />
      </div>
    );
  }

  return <>{children}</>;
}
