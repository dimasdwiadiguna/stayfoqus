"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { id as t } from "@/lib/i18n/id";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type Result =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; rows: number }
  | { kind: "problem"; title: string; detail: string | null };

/**
 * Answers "is the database actually wired up?" without making the user read a
 * console.
 *
 * Three things can be wrong on a fresh Supabase project and they fail in ways
 * that look identical from the sync indicator: the env vars are missing, the
 * migrations were never run, or the user is not signed in so RLS hides every
 * row. This distinguishes them and says which one it is.
 */
export function ConnectionCheck() {
  const [result, setResult] = React.useState<Result>({ kind: "idle" });

  async function check() {
    setResult({ kind: "checking" });

    if (!isSupabaseConfigured()) {
      setResult({ kind: "problem", title: t.sync.checkNoEnv, detail: null });
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setResult({ kind: "problem", title: t.sync.checkNoEnv, detail: null });
      return;
    }

    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      setResult({ kind: "problem", title: t.sync.checkSignedOut, detail: null });
      return;
    }

    // `head: true` asks Postgres for the count and no rows: the cheapest query
    // that still goes through PostgREST, the schema and the RLS policy.
    const { count, error } = await supabase
      .from("settings")
      .select("id", { count: "exact", head: true });

    if (error) {
      // 42P01 is "relation does not exist" — the migrations have not been run.
      const missingTable = error.code === "42P01" || /does not exist/i.test(error.message);
      setResult({
        kind: "problem",
        title: missingTable ? t.sync.checkNoTables : t.sync.checkFailed,
        detail: error.message,
      });
      return;
    }

    setResult({ kind: "ok", rows: count ?? 0 });
  }

  return (
    <div className="space-y-2">
      <Button block disabled={result.kind === "checking"} onClick={() => void check()}>
        {result.kind === "checking" ? t.sync.checking : t.sync.check}
      </Button>

      {result.kind === "ok" ? (
        <p className="rounded-lg border border-success/40 bg-surface-2 px-3 py-2 text-[13px] text-fg">
          {t.sync.checkOk(result.rows)}
        </p>
      ) : null}

      {result.kind === "problem" ? (
        <div className="space-y-1 rounded-lg border border-warning/40 bg-surface-2 px-3 py-2">
          <p className="text-[13px] text-warning">{result.title}</p>
          {result.detail ? (
            <p className="font-mono text-[11px] break-words text-fg-subtle">
              {result.detail}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
