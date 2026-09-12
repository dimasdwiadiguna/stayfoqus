"use client";

import { Check, RefreshCw } from "lucide-react";
import * as React from "react";

import { Row, Section, Stepper } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { CheckIndicator, Input, Switch } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { detachGcalEvents } from "@/lib/agendas/repo";
import { refreshGoogleCalendar } from "@/lib/gcal/engine";
import { clearBusyCache } from "@/lib/gcal/pull";
import type { GcalCalendar } from "@/lib/gcal/types";
import { id as t } from "@/lib/i18n/id";
import { cn } from "@/lib/utils";

/**
 * §6 — Google Calendar, configured here rather than in the code.
 *
 * The deployment supplies the OAuth client and nothing else. Which calendar
 * agendas are mirrored to, whether they are mirrored at all, which other
 * calendars the scheduler should treat as busy and how wide the sync window is
 * are all decided on this screen, stored in the settings row, and read by every
 * Google call through `lib/gcal/config`.
 */
export function GcalSection({ connected }: { connected: boolean }) {
  const settings = useSettings();
  const [picking, setPicking] = React.useState(false);

  if (!connected) return null;

  const busyIds = settings.gcal_busy_calendar_ids;

  return (
    <Section
      title={t.settings.sectionGcal}
      blurb={t.settings.gcalBlurb}
      collapsible
      storageKey="gcal"
    >
      <Row
        label={t.settings.gcalEnabled}
        hint={t.settings.gcalEnabledHint}
        control={
          <Switch
            checked={settings.gcal_enabled}
            onCheckedChange={(gcal_enabled) => void updateSettings({ gcal_enabled })}
          />
        }
      />

      <Row
        label={t.settings.gcalTarget}
        hint={settings.gcal_calendar_name ?? t.settings.gcalTargetNone}
        control={
          <Button size="sm" onClick={() => setPicking((open) => !open)}>
            {t.settings.gcalChange}
          </Button>
        }
      />

      {picking ? (
        <CalendarPicker
          selectedId={settings.gcal_calendar_id}
          onDone={() => setPicking(false)}
        />
      ) : null}

      <Row
        label={t.settings.gcalWrite}
        hint={t.settings.gcalWriteHint}
        control={
          <Switch
            checked={settings.gcal_write_enabled}
            onCheckedChange={(gcal_write_enabled) =>
              void updateSettings({ gcal_write_enabled })
            }
          />
        }
      />

      <Row
        label={t.settings.gcalBusy}
        hint={t.settings.gcalBusyHint}
        control={
          <Switch
            checked={settings.gcal_busy_enabled}
            onCheckedChange={(gcal_busy_enabled) =>
              void (async () => {
                await updateSettings({ gcal_busy_enabled });
                // Intervals nobody refreshes are worse than none: the allocator
                // would keep routing around hours that may long since be free.
                if (!gcal_busy_enabled) await clearBusyCache();
              })()
            }
          />
        }
      />

      {settings.gcal_busy_enabled ? (
        <BusyCalendarPicker
          selectedIds={busyIds}
          excludeId={settings.gcal_calendar_id}
        />
      ) : null}

      <div className="pt-1">
        <div className="text-[13px]">{t.settings.gcalWindow}</div>
        <div className="text-[11px] text-fg-subtle">{t.settings.gcalWindowHint}</div>
      </div>
      <Row
        label={t.settings.gcalWindowPast}
        control={
          <Stepper
            label={t.settings.gcalWindowPast}
            value={settings.gcal_window_past_days}
            min={0}
            max={365}
            step={7}
            suffix={t.settings.gcalDays}
            onChange={(gcal_window_past_days) =>
              void updateSettings({ gcal_window_past_days })
            }
          />
        }
      />
      <Row
        label={t.settings.gcalWindowFuture}
        control={
          <Stepper
            label={t.settings.gcalWindowFuture}
            value={settings.gcal_window_future_days}
            min={1}
            max={365}
            step={7}
            suffix={t.settings.gcalDays}
            onChange={(gcal_window_future_days) =>
              void updateSettings({ gcal_window_future_days })
            }
          />
        }
      />

      <Button
        block
        disabled={!settings.gcal_enabled}
        onClick={() =>
          void refreshGoogleCalendar().then(() => toast.success(t.sync.synced))
        }
      >
        <RefreshCw aria-hidden />
        {t.settings.gcalSyncNow}
      </Button>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* the calendars themselves                                            */
/* ------------------------------------------------------------------ */

type ListState =
  | { status: "loading" }
  | { status: "failed"; reason: string | null }
  | { status: "ready"; calendars: GcalCalendar[] };

/**
 * Loads the account's calendars once per mount. Deliberately not cached across
 * mounts: the list is small, it changes outside the app, and a stale entry here
 * means writing agendas into a calendar that no longer exists.
 */
function useCalendars(): [ListState, (next: GcalCalendar) => void] {
  const [state, setState] = React.useState<ListState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/gcal/calendars");
        const json = (await res.json()) as {
          calendars?: GcalCalendar[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.calendars) {
          // Google's own wording. A generic "could not load" hides the one
          // sentence that says what to do about it.
          setState({ status: "failed", reason: json.error ?? String(res.status) });
          return;
        }
        setState({ status: "ready", calendars: json.calendars });
      } catch (err) {
        if (!cancelled) {
          setState({ status: "failed", reason: err instanceof Error ? err.message : null });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const append = React.useCallback((next: GcalCalendar) => {
    setState((current) =>
      current.status === "ready"
        ? { status: "ready", calendars: [...current.calendars, next] }
        : current,
    );
  }, []);

  return [state, append];
}

function CalendarPicker({
  selectedId,
  onDone,
}: {
  selectedId: string | null;
  onDone: () => void;
}) {
  const [state, append] = useCalendars();
  const [name, setName] = React.useState("FOQUS");
  const [creating, setCreating] = React.useState(false);

  async function choose(calendar: GcalCalendar) {
    if (!calendar.writable || calendar.id === selectedId) {
      onDone();
      return;
    }

    /*
     * A Google event id is only meaningful inside the calendar that issued it,
     * and the sync token belongs to one calendar's change feed. Both are
     * dropped so the next sync recreates the agendas where they now belong.
     * The events left behind on the old calendar are deliberately not deleted:
     * removing them would need a write to a calendar the user has just told us
     * to stop using.
     */
    await detachGcalEvents();
    await updateSettings({
      gcal_calendar_id: calendar.id,
      gcal_calendar_name: calendar.summary,
      gcal_sync_token: null,
    });
    toast.show(t.settings.gcalSwitched(calendar.summary));
    onDone();
  }

  async function create() {
    const trimmed = name.trim();
    if (trimmed.length === 0 || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/gcal/calendars", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const json = (await res.json()) as {
        calendar?: GcalCalendar;
        error?: string;
      };
      if (!res.ok || !json.calendar) {
        toast.error(json.error ?? t.settings.gcalCalendarsFailed);
        return;
      }
      append(json.calendar);
      await choose(json.calendar);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.settings.gcalCalendarsFailed);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
        {t.settings.gcalChoose}
      </div>

      {state.status === "loading" ? (
        <p className="text-[13px] text-fg-muted">{t.settings.gcalLoadingCalendars}</p>
      ) : state.status === "failed" ? (
        <div className="space-y-1">
          <p className="text-[13px] text-danger">{t.settings.gcalCalendarsFailed}</p>
          {state.reason ? (
            <p className="font-mono text-[11px] break-words text-fg-subtle">
              {state.reason}
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {state.calendars.map((calendar) => {
            const reason = calendar.primary
              ? t.settings.gcalPrimaryBlocked
              : !calendar.writable
                ? t.settings.gcalReadOnly
                : null;
            return (
              <li key={calendar.id}>
                <button
                  type="button"
                  disabled={!calendar.writable}
                  onClick={() => void choose(calendar)}
                  className={cn(
                    "tap-44 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
                    calendar.writable
                      ? "hover:bg-surface-3"
                      : "cursor-not-allowed opacity-55",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">
                      {calendar.summary}
                    </span>
                    {reason ? (
                      <span className="block text-[11px] text-fg-subtle">{reason}</span>
                    ) : null}
                  </span>
                  {calendar.id === selectedId ? (
                    <Check aria-hidden className="size-4 shrink-0 text-accent" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Input
          aria-label={t.settings.gcalNewName}
          placeholder={t.settings.gcalNewName}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-9"
        />
        <Button size="sm" disabled={creating} onClick={() => void create()}>
          {t.settings.gcalCreate}
        </Button>
      </div>
    </div>
  );
}

/**
 * Which of the other calendars count as busy.
 *
 * Null — nothing selected explicitly — means "all of them", which is §6.3's
 * default and stays correct when a calendar is added in Google later. Ticking
 * any single calendar turns the setting into an explicit list.
 */
function BusyCalendarPicker({
  selectedIds,
  excludeId,
}: {
  selectedIds: string[] | null;
  excludeId: string | null;
}) {
  const [state] = useCalendars();

  if (state.status !== "ready") return null;

  const candidates = state.calendars.filter((c) => c.id !== excludeId);
  if (candidates.length === 0) return null;

  const isOn = (id: string) => selectedIds === null || selectedIds.includes(id);

  async function toggle(id: string) {
    const current = selectedIds ?? candidates.map((c) => c.id);
    const next = current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id];

    // Back to "everything" when the list ends up covering every calendar, so a
    // calendar added in Google next month is counted without being ticked here.
    const coversAll = candidates.every((c) => next.includes(c.id));
    await updateSettings({ gcal_busy_calendar_ids: coversAll ? null : next });
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2.5">
      <div className="text-[11px] font-semibold tracking-wide text-fg-subtle uppercase">
        {t.settings.gcalBusySources}
      </div>
      <p className="mt-0.5 text-[11px] text-fg-subtle">
        {selectedIds === null ? t.settings.gcalBusyAll : null}
      </p>
      <ul className="mt-1 space-y-0.5">
        {candidates.map((calendar) => (
          <li key={calendar.id}>
            <button
              type="button"
              onClick={() => void toggle(calendar.id)}
              aria-pressed={isOn(calendar.id)}
              className="tap-44 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-3"
            >
              <CheckIndicator checked={isOn(calendar.id)} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {calendar.summary}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
