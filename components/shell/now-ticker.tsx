"use client";

import {
  CalendarClock,
  CalendarDays,
  Car,
  ChevronRight,
  CloudSun,
  Coffee,
  Moon,
  Sun,
  Sunrise,
  Sunset,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { useNowNext } from "@/hooks/use-activities";
import { useAgendas, useTodos } from "@/hooks/use-tasks";
import type { Agenda, PrayerKey, Todo, UUID } from "@/lib/db/schema";
import { id as t } from "@/lib/i18n/id";
import type { Activity } from "@/lib/scheduling";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Below this, the countdown stops being information and becomes a warning. */
const SOON_MIN = 5;

const PRAYER_ICONS: Record<PrayerKey, LucideIcon> = {
  fajr: Sunrise,
  dhuhr: Sun,
  asr: CloudSun,
  maghrib: Sunset,
  isha: Moon,
};

/**
 * The now-and-next strip, above every screen.
 *
 * One line: what is running, what is next, and how long until it. It carries
 * more than agendas — a prayer block and a commute buffer are both things you
 * are *in*, and the commute is the one you most need warning about (D-103).
 *
 * The icon does the labelling so the words do not have to: on a 390px screen
 * there is room for two truncated titles and a countdown, and nothing else. The
 * countdown never truncates — it is the only part that changes.
 */
export function NowTicker() {
  const { current, next, now } = useNowNext();
  const todos = useTodos();
  const agendas = useAgendas();

  // Nothing today or tomorrow: no strip at all, rather than a permanently
  // empty row on a fresh install.
  if (!current && !next) return null;

  const untilMin = next && now !== null ? (next.start - now) / 60_000 : null;
  const soon = untilMin !== null && untilMin <= SOON_MIN;

  return (
    <Link
      href="/calendar"
      aria-label={t.ticker.label}
      className="shrink-0 border-b border-border bg-surface/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-md items-center gap-1.5 px-4 py-1.5 text-[12px]">
        {current ? (
          <Slot
            activity={current}
            label={describeActivity(current, agendas, todos)}
            muted
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-fg-subtle">
            <Coffee className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{t.ticker.free}</span>
          </span>
        )}

        <ChevronRight
          className="size-3.5 shrink-0 text-fg-subtle/60"
          aria-hidden
        />

        {next ? (
          <>
            <Slot activity={next} label={describeActivity(next, agendas, todos)} />
            <span
              className={cn(
                "shrink-0 font-semibold tabular-nums",
                soon ? "animate-pulse text-warning" : "text-fg-muted",
              )}
            >
              {untilMin !== null && untilMin < 1
                ? t.ticker.soon
                : formatDuration(untilMin ?? 0)}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-fg-subtle">
            {t.ticker.nothingNext}
          </span>
        )}
      </div>
    </Link>
  );
}

function Slot({
  activity,
  label,
  muted,
}: {
  activity: Activity;
  label: string;
  /** The current activity is stated quietly; the next one is the news. */
  muted?: boolean;
}) {
  const Icon =
    activity.kind === "prayer"
      ? PRAYER_ICONS[activity.prayerKey ?? "dhuhr"]
      : activity.kind === "commute"
        ? Car
        : activity.kind === "event"
          ? CalendarDays
          : CalendarClock;

  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1",
        activity.kind === "prayer"
          ? "text-prayer"
          : activity.kind === "commute"
            ? // The same bronze as the commute buffer band, so the strip and
              // the timeline speak one language (D-082).
              "text-buffer-commute"
            : activity.kind === "event"
              ? // And the same rose the event block wears.
                "text-event"
              : muted
                ? "text-fg-muted"
                : "text-fg",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * The words for one activity. A commute names where it is going or coming
 * from — "perjalanan" alone answers the wrong half of the question.
 */
function describeActivity(
  activity: Activity,
  agendas: readonly Agenda[],
  todos: readonly Todo[],
): string {
  if (activity.kind === "prayer") {
    return t.settings.prayerNames[activity.prayerKey ?? "dhuhr"];
  }

  // An event owns its title; an agenda borrows one from its todo.
  const title =
    activity.title ?? agendaTitle(activity.agendaId, agendas, todos);
  if (activity.kind === "agenda" || activity.kind === "event") return title;
  return activity.side === "before"
    ? t.ticker.commuteTo(title)
    : t.ticker.commuteFrom(title);
}

function agendaTitle(
  agendaId: UUID | undefined,
  agendas: readonly Agenda[],
  todos: readonly Todo[],
): string {
  const agenda = agendas.find((a) => a.id === agendaId);
  if (!agenda) return t.agenda.title;
  return (
    agenda.title_override ??
    todos.find((todo) => todo.id === agenda.todo_id)?.title ??
    t.agenda.title
  );
}
