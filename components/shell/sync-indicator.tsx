"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Check, CloudOff, HardDrive, RefreshCw } from "lucide-react";
import Link from "next/link";

import { getDb } from "@/lib/db/client";
import { id as t } from "@/lib/i18n/id";
import { useSyncStatus } from "@/lib/sync/status";
import { cn } from "@/lib/utils";

/**
 * §3.1: "Show a subtle connection/sync indicator in the header: synced,
 * syncing, offline with N pending, or error."
 *
 * The pending count comes straight from a live query on the outbox rather than
 * the status store, so it stays correct even when the engine is idle offline.
 */
export function SyncIndicator() {
  const phase = useSyncStatus((s) => s.phase);
  const pending = useLiveQuery(
    () => getDb().outbox.where("status").equals("pending").count(),
    [],
    0,
  );
  const blocked = useLiveQuery(
    () => getDb().outbox.where("status").equals("blocked").count(),
    [],
    0,
  );

  const { Icon, label, tone, spin } = describe(phase, pending, blocked);

  return (
    <Link
      href="/settings"
      aria-label={label}
      title={label}
      className={cn(
        "tap-44 inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium",
        tone,
      )}
    >
      <Icon className={cn("size-3.5", spin && "animate-spin")} aria-hidden />
      {pending > 0 || blocked > 0 || phase !== "idle" ? (
        <span className="tabular-nums">{label}</span>
      ) : null}
    </Link>
  );
}

function describe(
  phase: ReturnType<typeof useSyncStatus.getState>["phase"],
  pending: number,
  blocked: number,
) {
  if (blocked > 0) {
    return {
      Icon: AlertTriangle,
      label: t.sync.blocked(blocked),
      tone: "text-warning",
      spin: false,
    };
  }
  switch (phase) {
    case "syncing":
      return { Icon: RefreshCw, label: t.sync.syncing, tone: "text-fg-subtle", spin: true };
    case "offline":
      return {
        Icon: CloudOff,
        label: pending > 0 ? t.sync.offlinePending(pending) : t.sync.offline,
        tone: "text-fg-muted",
        spin: false,
      };
    case "error":
      return { Icon: AlertTriangle, label: t.sync.error, tone: "text-danger", spin: false };
    case "local-only":
      return {
        Icon: HardDrive,
        label: pending > 0 ? t.sync.pending(pending) : "",
        tone: "text-fg-subtle",
        spin: false,
      };
    default:
      return pending > 0
        ? { Icon: RefreshCw, label: t.sync.pending(pending), tone: "text-fg-subtle", spin: false }
        : { Icon: Check, label: t.sync.synced, tone: "text-fg-subtle", spin: false };
  }
}
