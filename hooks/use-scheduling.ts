"use client";

import { useLiveQuery } from "dexie-react-hooks";
import * as React from "react";

import { usePlaces } from "@/hooks/use-places";
import { useSettings } from "@/hooks/use-settings";
import { useAgendas, useTaskData } from "@/hooks/use-tasks";
import { getDb } from "@/lib/db/client";
import type {
  CalendarEvent,
  EventException,
  IsoDate,
  TimeBlock,
  TimeBlockException,
  UUID,
} from "@/lib/db/schema";
import {
  buildWorld,
  toSchedulable,
  type SchedulableTodo,
  type SchedulingWorld,
} from "@/lib/scheduling";
import { countersFor } from "@/lib/todos/derived";
import { isBlocked } from "@/lib/todos/tree";

const EMPTY: never[] = [];

export function useTimeBlocks(): TimeBlock[] {
  const rows = useLiveQuery(() => getDb().time_blocks.toArray(), []);
  return React.useMemo(
    () => (rows ?? EMPTY).filter((b) => !b.deleted_at),
    [rows],
  );
}

export function useTimeBlockExceptions(): TimeBlockException[] {
  const rows = useLiveQuery(() => getDb().time_block_exceptions.toArray(), []);
  return React.useMemo(
    () => (rows ?? EMPTY).filter((e) => !e.deleted_at),
    [rows],
  );
}

export function useEvents(): CalendarEvent[] {
  const rows = useLiveQuery(() => getDb().events.toArray(), []);
  return React.useMemo(
    () => (rows ?? EMPTY).filter((e) => !e.deleted_at),
    [rows],
  );
}

export function useEventExceptions(): EventException[] {
  const rows = useLiveQuery(() => getDb().event_exceptions.toArray(), []);
  return React.useMemo(
    () => (rows ?? EMPTY).filter((e) => !e.deleted_at),
    [rows],
  );
}

export function useAvailabilityWindows() {
  const rows = useLiveQuery(() => getDb().availability_windows.toArray(), []);
  return React.useMemo(
    () => (rows ?? EMPTY).filter((w) => !w.deleted_at),
    [rows],
  );
}

export function useGcalBusy() {
  const rows = useLiveQuery(() => getDb().gcal_busy_cache.toArray(), []);
  return rows ?? EMPTY;
}

export interface UseWorldOptions {
  from: IsoDate;
  to: IsoDate;
  excludeAgendaIds?: ReadonlySet<UUID>;
  includeDraftAgendas?: boolean;
}

/**
 * Assembles the §5.5 Step 1 picture from live data.
 *
 * Every screen that reasons about time — the calendar timeline, the Jadwalkan
 * sheet, the reschedule chips, the weekly capacity meter — reads it from here
 * so they can never disagree about what is free.
 */
export function useSchedulingWorld(options: UseWorldOptions): SchedulingWorld {
  const settings = useSettings();
  const agendas = useAgendas();
  const places = usePlaces();
  const windows = useAvailabilityWindows();
  const timeBlocks = useTimeBlocks();
  const exceptions = useTimeBlockExceptions();
  const events = useEvents();
  const eventExceptions = useEventExceptions();
  const gcalBusyEntries = useGcalBusy();

  const { from, to, excludeAgendaIds, includeDraftAgendas } = options;

  return React.useMemo(
    () =>
      buildWorld({
        settings,
        availabilityWindows: windows,
        agendas,
        timeBlocks,
        timeBlockExceptions: exceptions,
        events,
        eventExceptions,
        gcalBusyEntries,
        places,
        from,
        to,
        excludeAgendaIds,
        includeDraftAgendas,
      }),
    [
      settings,
      windows,
      agendas,
      timeBlocks,
      exceptions,
      events,
      eventExceptions,
      gcalBusyEntries,
      places,
      from,
      to,
      excludeAgendaIds,
      includeDraftAgendas,
    ],
  );
}

/** Todos in scheduler form, with derived counters and blocked state folded in. */
export function useSchedulableTodos(): SchedulableTodo[] {
  const { todos, index, counters } = useTaskData();
  return React.useMemo(
    () =>
      todos
        .filter((todo) => todo.status !== "done" && todo.status !== "archived")
        .map((todo) =>
          toSchedulable(
            todo,
            countersFor(counters, todo.id).remainingToAllocate,
            isBlocked(index, todo),
          ),
        ),
    [todos, index, counters],
  );
}
