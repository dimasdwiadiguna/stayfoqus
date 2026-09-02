"use client";

import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";
import { useSyncExternalStore } from "react";

import { AccountSection } from "@/components/settings/account-section";
import { AvailabilityEditor } from "@/components/settings/availability-editor";
import { CategoryEditor } from "@/components/settings/category-editor";
import { LocationSection } from "@/components/settings/location-section";
import { Row, Section, Stepper } from "@/components/settings/section";
import { TimeBlockEditor } from "@/components/settings/time-block-editor";
import { Screen, ScreenTitle } from "@/components/shell/screen";
import { SyncIndicator } from "@/components/shell/sync-indicator";
import { Button } from "@/components/ui/button";
import { Input, Segmented, Select, Slider, Switch } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { getDb } from "@/lib/db/client";
import type {
  BufferType,
  PrayerCalculationMethod,
  PrayerKey,
  ThemePreference,
} from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import { audioState, previewSound } from "@/lib/pomodoro/audio";
import { prayerTimesFor } from "@/lib/scheduling";
import {
  dropOutboxEntry,
  forceFullResync,
  retryBlocked,
} from "@/lib/sync/engine";
import { useSyncStatus } from "@/lib/sync/status";
import { isFriday, localDate, localTime } from "@/lib/time";
import { cn } from "@/lib/utils";

const PRAYERS: PrayerKey[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

const METHODS: { value: PrayerCalculationMethod; label: string }[] = [
  { value: "Kemenag", label: "Kemenag (Indonesia)" },
  { value: "MuslimWorldLeague", label: "Muslim World League" },
  { value: "Egyptian", label: "Egyptian" },
  { value: "Karachi", label: "Karachi" },
  { value: "UmmAlQura", label: "Umm al-Qura" },
  { value: "Singapore", label: "Singapore" },
];

export function SettingsScreen() {
  const settings = useSettings();

  return (
    <Screen
      header={
        <ScreenTitle title={t.settings.title} actions={<SyncIndicator />} />
      }
    >
      <div className="pb-24">
        <AccountSection />
        <AvailabilityEditor />
        <LocationSection />
        <BufferSection />
        <PrayerSection />
        <PomodoroSection />
        <CategoryEditor />
        <TimeBlockEditor />

        <Section title={t.settings.sectionAppearance}>
          <Segmented
            ariaLabel={t.settings.theme}
            value={settings.theme}
            onChange={(theme: ThemePreference) => void updateSettings({ theme })}
            options={[
              { value: "dark" as const, label: t.settings.themeDark },
              { value: "light" as const, label: t.settings.themeLight },
              { value: "system" as const, label: t.settings.themeSystem },
            ]}
          />
        </Section>

        <SyncSection />

        <Section title={t.settings.sectionAbout}>
          <p className="text-[13px] leading-relaxed text-fg-muted">
            {t.settings.aboutBlurb}
          </p>
          <Row label={t.settings.version} control={<span className="text-[13px] text-fg-subtle">1.0.0</span>} />
        </Section>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

function BufferSection() {
  const settings = useSettings();
  return (
    <Section title={t.settings.sectionBuffer}>
      <Row
        label={t.settings.bufferBefore}
        control={
          <Stepper
            label={t.settings.bufferBefore}
            value={settings.default_buffer_before_min}
            step={5}
            max={180}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ default_buffer_before_min: v })}
          />
        }
      />
      <Row
        label={t.settings.bufferAfter}
        control={
          <Stepper
            label={t.settings.bufferAfter}
            value={settings.default_buffer_after_min}
            step={5}
            max={180}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ default_buffer_after_min: v })}
          />
        }
      />
      <Row
        label={t.settings.bufferType}
        control={
          <Segmented
            ariaLabel={t.settings.bufferType}
            value={settings.default_buffer_type}
            onChange={(v: BufferType) => void updateSettings({ default_buffer_type: v })}
            options={[
              { value: "switch" as const, label: t.agenda.bufferSwitch },
              { value: "commute" as const, label: t.agenda.bufferCommute },
            ]}
          />
        }
      />
    </Section>
  );
}

/**
 * The block a duration produces around an adhan, as "11:43–12:03".
 *
 * Mirrors `resolvePrayerBlocks` rather than calling it: this is one prayer on
 * one day, and building the whole day's set for a label would be wasteful.
 */
function blockRangeFor(adhan: Date, durationMin: number, timezone: string): string {
  const half = (durationMin * 60_000) / 2;
  const start = new Date(adhan.getTime() - half);
  const end = new Date(adhan.getTime() + half);
  return `${localTime(start, timezone)}–${localTime(end, timezone)}`;
}

function PrayerSection() {
  const settings = useSettings();

  // Today's computed times, so a change of coordinates or method is visible
  // immediately rather than only on the calendar.
  const today = localDate(new Date(), settings.timezone);
  const times = React.useMemo(() => {
    try {
      return prayerTimesFor(
        today,
        settings.latitude,
        settings.longitude,
        settings.prayer_calculation_method,
      ).times;
    } catch {
      return null;
    }
  }, [today, settings.latitude, settings.longitude, settings.prayer_calculation_method]);

  return (
    <Section title={t.settings.sectionPrayer} blurb={t.settings.prayerBlurb}>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[12px] text-fg-muted">{t.settings.prayerLatitude}</span>
          <Input
            type="number"
            step="0.0001"
            defaultValue={settings.latitude}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) void updateSettings({ latitude: v });
            }}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[12px] text-fg-muted">{t.settings.prayerLongitude}</span>
          <Input
            type="number"
            step="0.0001"
            defaultValue={settings.longitude}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) void updateSettings({ longitude: v });
            }}
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[12px] text-fg-muted">{t.settings.prayerTimezone}</span>
        <Input
          defaultValue={settings.timezone}
          onBlur={(e) => {
            const value = e.target.value.trim();
            // Reject an unknown zone rather than storing something that would
            // throw on every date conversion afterwards.
            try {
              new Intl.DateTimeFormat("en", { timeZone: value });
              void updateSettings({ timezone: value });
            } catch {
              e.target.value = settings.timezone;
              toast.error(t.common.somethingWrong);
            }
          }}
        />
      </label>

      <div className="space-y-1">
        <span className="text-[12px] text-fg-muted">{t.settings.prayerMethod}</span>
        <Select
          ariaLabel={t.settings.prayerMethod}
          value={settings.prayer_calculation_method}
          onValueChange={(v) =>
            void updateSettings({
              prayer_calculation_method: v as PrayerCalculationMethod,
            })
          }
          items={METHODS}
        />
      </div>

      {PRAYERS.map((key) => {
        const block = settings.prayer_blocks[key];
        return (
          <div
            key={key}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-[15px]">{t.settings.prayerNames[key]}</div>
              {times ? (
                <div className="text-[12px] tabular-nums text-fg-subtle">
                  {/*
                    The adhan, then the block the duration above produces around
                    it (D-102). Shown here because this is where the number is
                    changed, and "20 menit" no longer means "20 minutes from the
                    adhan" — it means 10 either side.
                  */}
                  {localTime(times[key], settings.timezone)} ·{" "}
                  {blockRangeFor(
                    times[key],
                    key === "dhuhr" && isFriday(today)
                      ? settings.friday_dhuhr_duration_min
                      : block.duration_min,
                    settings.timezone,
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Stepper
                label={t.settings.prayerNames[key]}
                value={block.duration_min}
                step={5}
                max={240}
                suffix={t.common.minutesShort}
                onChange={(duration_min) =>
                  void updateSettings({
                    prayer_blocks: {
                      ...settings.prayer_blocks,
                      [key]: { ...block, duration_min },
                    },
                  })
                }
              />
              <Switch
                checked={block.enabled}
                aria-label={t.settings.prayerNames[key]}
                onCheckedChange={(enabled) =>
                  void updateSettings({
                    prayer_blocks: {
                      ...settings.prayer_blocks,
                      [key]: { ...block, enabled },
                    },
                  })
                }
              />
            </div>
          </div>
        );
      })}

      <Row
        label={t.settings.fridayDhuhr}
        control={
          <Stepper
            label={t.settings.fridayDhuhr}
            value={settings.friday_dhuhr_duration_min}
            step={5}
            max={240}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ friday_dhuhr_duration_min: v })}
          />
        }
      />
    </Section>
  );
}

function PomodoroSection() {
  const settings = useSettings();
  return (
    <Section title={t.settings.sectionPomodoro}>
      <Row
        label={t.settings.pomodoroFocus}
        control={
          <Stepper
            label={t.settings.pomodoroFocus}
            value={settings.pomodoro_focus_min}
            min={5}
            max={120}
            step={5}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ pomodoro_focus_min: v })}
          />
        }
      />
      <Row
        label={t.settings.pomodoroShortBreak}
        control={
          <Stepper
            label={t.settings.pomodoroShortBreak}
            value={settings.pomodoro_short_break_min}
            min={1}
            max={60}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ pomodoro_short_break_min: v })}
          />
        }
      />
      <Row
        label={t.settings.pomodoroLongBreak}
        control={
          <Stepper
            label={t.settings.pomodoroLongBreak}
            value={settings.pomodoro_long_break_min}
            min={1}
            max={90}
            step={5}
            suffix={t.common.minutesShort}
            onChange={(v) => void updateSettings({ pomodoro_long_break_min: v })}
          />
        }
      />
      <Row
        label={t.settings.pomodoroLongBreakEvery}
        control={
          <Stepper
            label={t.settings.pomodoroLongBreakEvery}
            value={settings.pomodoro_long_break_every}
            min={2}
            max={12}
            suffix={t.settings.pomodoroSessions}
            onChange={(v) => void updateSettings({ pomodoro_long_break_every: v })}
          />
        }
      />

      <AudioStatusRow />

      <AudioRow
        label={t.settings.ticking}
        volumeLabel={t.settings.tickingVolume}
        enabled={settings.ticking_enabled}
        volume={settings.ticking_volume}
        onToggle={(ticking_enabled) => void updateSettings({ ticking_enabled })}
        onVolume={(ticking_volume) => void updateSettings({ ticking_volume })}
        onPreview={() => void previewSound("tick", settings.ticking_volume)}
      />
      <AudioRow
        label={t.settings.bell}
        volumeLabel={t.settings.bellVolume}
        enabled={settings.bell_enabled}
        volume={settings.bell_volume}
        onToggle={(bell_enabled) => void updateSettings({ bell_enabled })}
        onVolume={(bell_volume) => void updateSettings({ bell_volume })}
        onPreview={() => void previewSound("bell", settings.bell_volume)}
      />
    </Section>
  );
}

/**
 * §5.6's audio has three ways to be silent that look identical to the user:
 * never unlocked, suspended after a background, or muted by the iPhone ringer
 * switch. The first two are observable and reported here; the third is not
 * observable at all from the web, so it is stated as a hint.
 */
function AudioStatusRow() {
  const state = useSyncExternalStore(
    subscribeToAudioState,
    audioState,
    () => "locked" as const,
  );

  const label =
    state === "running"
      ? t.settings.audioRunning
      : state === "suspended"
        ? t.settings.audioSuspended
        : state === "unsupported"
          ? t.settings.audioUnsupported
          : t.settings.audioLocked;

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <Row
        label={t.settings.audioStatus}
        control={
          <span
            className={cn(
              "text-[13px] font-medium",
              state === "running" ? "text-success" : "text-warning",
            )}
          >
            {state === "running" ? t.settings.audioRunning : "—"}
          </span>
        }
      />
      <p className="text-[12px] text-fg-subtle">{label}</p>
      <p className="text-[12px] text-fg-subtle">{t.settings.audioIosHint}</p>
    </div>
  );
}

/**
 * The audio state changes without any event of its own, so it is polled — but
 * only while Settings is open, and only twice a second.
 */
function subscribeToAudioState(onChange: () => void): () => void {
  const timer = setInterval(onChange, 500);
  return () => clearInterval(timer);
}

function AudioRow({
  label,
  volumeLabel,
  enabled,
  volume,
  onToggle,
  onVolume,
  onPreview,
}: {
  label: string;
  volumeLabel: string;
  enabled: boolean;
  volume: number;
  onToggle: (enabled: boolean) => void;
  onVolume: (volume: number) => void;
  onPreview: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <Row
        label={label}
        control={
          <div className="flex items-center gap-2">
            {/* Preview doubles as the iOS audio unlock — it is a user gesture. */}
            <Button size="sm" onClick={onPreview} disabled={!enabled}>
              {t.settings.testSound}
            </Button>
            <Switch checked={enabled} aria-label={label} onCheckedChange={onToggle} />
          </div>
        }
      />
      {enabled ? (
        <Slider
          aria-label={volumeLabel}
          value={[volume]}
          min={0}
          max={1}
          step={0.05}
          onValueChange={([v]) => onVolume(v ?? 0)}
        />
      ) : null}
    </div>
  );
}

function SyncSection() {
  const status = useSyncStatus();
  const blocked = useLiveQuery(
    () => getDb().outbox.where("status").equals("blocked").toArray(),
    [],
  );
  const pending = useLiveQuery(
    () => getDb().outbox.where("status").equals("pending").count(),
    [],
    0,
  );
  const lastPulled = useLiveQuery(
    () => getDb().sync_state.toArray(),
    [],
  );

  const newest = (lastPulled ?? [])
    .map((s) => s.last_pulled_at)
    .filter((v): v is string => Boolean(v))
    .sort()
    .pop();

  return (
    <Section title={t.settings.sectionSync}>
      {status.phase === "local-only" ? (
        <p className="text-[13px] text-fg-muted">{t.sync.localOnly}</p>
      ) : null}

      <Row
        label={t.sync.pending(pending)}
        hint={pending === 0 ? t.sync.queueEmpty : undefined}
        control={null}
      />
      <Row
        label={t.sync.lastPulled}
        control={
          <span className="text-[13px] text-fg-subtle">
            {newest ? new Date(newest).toLocaleString("id-ID") : t.sync.never}
          </span>
        }
      />

      {status.lastError ? (
        <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[11px] break-words text-danger">
          {status.lastError}
        </p>
      ) : null}

      {(blocked ?? []).length > 0 ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-warning">
            {t.sync.blocked(blocked!.length)}
          </p>
          <ul className="space-y-1">
            {blocked!.slice(0, 10).map((entry) => (
              <li
                key={entry.seq}
                className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px]">
                    {entry.entity} · {entry.operation}
                  </div>
                  <div className="truncate font-mono text-[11px] text-fg-subtle">
                    {entry.last_error}
                  </div>
                </div>
                <Button
                  size="iconSm"
                  variant="ghost"
                  aria-label={t.common.delete}
                  onClick={() => void dropOutboxEntry(entry.seq!)}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
          <Button block onClick={() => void retryBlocked()}>
            {t.common.retry}
          </Button>
        </div>
      ) : null}

      <Button block onClick={() => void forceFullResync()}>
        {t.sync.forceResync}
      </Button>
    </Section>
  );
}
