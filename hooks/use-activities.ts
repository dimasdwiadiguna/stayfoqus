"use client";

import * as React from "react";

import { useNow } from "@/hooks/use-now";
import { useSettings } from "@/hooks/use-settings";
import { useAgendas } from "@/hooks/use-tasks";
import {
  buildActivities,
  nowAndNext,
  resolvePrayerBlocks,
  type NowNext,
} from "@/lib/scheduling";
import { addDays, localDate } from "@/lib/time";

/**
 * What is happening now and what is next, for the ticker (D-103).
 *
 * Deliberately leaner than `useSchedulingWorld`: that mounts five live queries
 * and resolves availability windows, time blocks and Google busy time, none of
 * which the ticker looks at — and unlike a screen, this one is mounted above
 * every tab for the whole life of the app. Agendas come from the live query
 * that already exists, and the prayer blocks from the same
 * `resolvePrayerBlocks` the calendar uses, so the two can never disagree about
 * when a prayer is.
 *
 * The range runs to tomorrow, or at 23:50 the question "what is next" would
 * have no answer.
 */
export function useNowNext(): NowNext & { now: number | null } {
  const settings = useSettings();
  const agendas = useAgendas();
  const now = useNow();

  const today = now === null ? null : localDate(new Date(now), settings.timezone);

  const prayers = React.useMemo(() => {
    if (!today) return [];
    return resolvePrayerBlocks(
      {
        latitude: settings.latitude,
        longitude: settings.longitude,
        method: settings.prayer_calculation_method,
        blocks: settings.prayer_blocks,
        fridayDhuhrDurationMin: settings.friday_dhuhr_duration_min,
      },
      today,
      addDays(today, 1),
    );
    // Keyed on the local date, so this recomputes at midnight rather than on
    // every 30-second tick.
  }, [
    today,
    settings.latitude,
    settings.longitude,
    settings.prayer_calculation_method,
    settings.prayer_blocks,
    settings.friday_dhuhr_duration_min,
  ]);

  const activities = React.useMemo(
    () => buildActivities({ agendas, prayers }),
    [agendas, prayers],
  );

  return React.useMemo(
    () => ({
      ...(now === null
        ? { current: null, next: null }
        : nowAndNext(activities, now)),
      now,
    }),
    [activities, now],
  );
}
