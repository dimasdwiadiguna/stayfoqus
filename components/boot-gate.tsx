"use client";

import * as React from "react";

import { setAfterMutate } from "@/lib/db/mutations";
import { seedIfNeeded } from "@/lib/db/seed";
import { id as t } from "@/lib/i18n/id";
import { getSupabase } from "@/lib/supabase/client";
import { startGcalEngine } from "@/lib/gcal/engine";
import { adoptSignedInUser } from "@/lib/sync/adopt";
import { requestSync, runSync, setConflictHandler, startSyncEngine } from "@/lib/sync/engine";
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
    let stopGcal: (() => void) | undefined;
    let stopAuth: (() => void) | undefined;

    (async () => {
      const supabase = getSupabase();

      /*
       * Order matters. The signed-in user id has to be adopted *before*
       * `seedIfNeeded` runs, or a first launch that is already signed in seeds
       * its categories and settings under the local sentinel and then has to
       * hand them over a moment later.
       */
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (data.user) await adoptSignedInUser(data.user.id);
      }

      await seedIfNeeded();
      if (cancelled) return;

      setAfterMutate(requestSync);
      setConflictHandler((count) => toast.show(t.sync.conflictApplied(count)));
      stopEngine = startSyncEngine();
      stopGcal = startGcalEngine();

      /*
       * Signing in happens *after* boot: the OAuth round trip returns to a
       * freshly mounted app, and `getUser()` above can still answer null while
       * the browser client is finishing the code exchange. Without this
       * listener, everything created before that moment keeps the sentinel
       * owner until the next cold start.
       */
      if (supabase) {
        const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
          if (!session?.user) return;
          if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
          void adoptSignedInUser(session.user.id).then((adopted) => {
            if (adopted > 0) {
              toast.show(t.sync.adopted(adopted));
              void runSync();
            }
          });
        });
        stopAuth = () => sub.subscription.unsubscribe();
      }

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
      stopGcal?.();
      stopAuth?.();
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
