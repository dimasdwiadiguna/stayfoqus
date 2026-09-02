import type {
  Agenda,
  AvailabilityWindow,
  CalendarEvent,
  EventException,
  IsoDate,
  Place,
  Settings,
  Todo,
  UUID,
} from "@/lib/db/schema";
import { resolveWindows } from "@/lib/scheduling/availability";
import { buildFreeSpace } from "@/lib/scheduling/freespace";
import { activeEvents, expandEvents, type EventInstance } from "@/lib/scheduling/events";
import { resolvePrayerBlocks } from "@/lib/scheduling/prayer";
import { expandTimeBlocks } from "@/lib/scheduling/timeblocks";
import type {
  BusyInterval,
  DefaultBuffers,
  FreeInterval,
  PrayerBlock,
  SchedulableTodo,
  SessionShape,
  TimeBlockInstance,
  WindowInstance,
} from "@/lib/scheduling/types";

/**
 * Adapters from stored rows to the scheduler's own shapes.
 *
 * Still pure: this file imports row *types* only — never Dexie, never React.
 * Callers hand it arrays they already have.
 */

const MINUTE = 60_000;

export function sessionShapeOf(settings: Settings): SessionShape {
  return {
    focusMin: settings.pomodoro_focus_min,
    shortBreakMin: settings.pomodoro_short_break_min,
  };
}

export function defaultBuffersOf(settings: Settings): DefaultBuffers {
  return {
    before: {
      min: settings.default_buffer_before_min,
      type: settings.default_buffer_type,
    },
    after: {
      min: settings.default_buffer_after_min,
      type: settings.default_buffer_type,
    },
  };
}

export function buffersOfAgenda(agenda: Agenda): DefaultBuffers {
  return {
    before: { min: agenda.buffer_before_min, type: agenda.buffer_before_type },
    after: { min: agenda.buffer_after_min, type: agenda.buffer_after_type },
  };
}

export function windowSpecsOf(
  windows: readonly AvailabilityWindow[],
): { dayOfWeek: AvailabilityWindow["day_of_week"]; startTime: string; endTime: string; enabled: boolean }[] {
  return windows
    .filter((w) => !w.deleted_at)
    .map((w) => ({
      dayOfWeek: w.day_of_week,
      startTime: w.start_time,
      endTime: w.end_time,
      enabled: w.enabled,
    }));
}

/**
 * An agenda occupies its core interval *plus* its buffers (§5.2: "Buffers
 * consume schedulable space"). Drafts are excluded — §5.5 Step 1 subtracts
 * "existing non-draft agendas", and a draft preview must not block the very
 * allocation that produced it.
 */
export function agendaBusy(
  agendas: readonly Agenda[],
  options: { includeDrafts?: boolean; excludeIds?: ReadonlySet<UUID> } = {},
): BusyInterval[] {
  const out: BusyInterval[] = [];

  for (const agenda of agendas) {
    if (agenda.deleted_at) continue;
    if (agenda.status === "cancelled") continue;
    if (agenda.status === "draft" && !options.includeDrafts) continue;
    if (options.excludeIds?.has(agenda.id)) continue;

    const core = {
      start: new Date(agenda.start_at).getTime(),
      end: new Date(agenda.end_at).getTime(),
    };
    out.push({
      source: "agenda",
      agendaId: agenda.id,
      core,
      start: core.start - agenda.buffer_before_min * MINUTE,
      end: core.end + agenda.buffer_after_min * MINUTE,
      bufferBefore: { min: agenda.buffer_before_min, type: agenda.buffer_before_type },
      bufferAfter: { min: agenda.buffer_after_min, type: agenda.buffer_after_type },
    });
  }

  return out;
}

/**
 * An event occupies its core interval *plus* its buffers, exactly as an agenda
 * does — §5.2 is a rule about two buffered things meeting, and an event's
 * commute buffer is as real as an agenda's. Skipped occurrences reserve
 * nothing.
 */
export function eventBusy(instances: readonly EventInstance[]): BusyInterval[] {
  return activeEvents(instances).map((event) => {
    const core = { start: event.start, end: event.end };
    return {
      source: "event" as const,
      ownerId: event.eventId,
      core,
      start: core.start - event.bufferBefore.min * MINUTE,
      end: core.end + event.bufferAfter.min * MINUTE,
      bufferBefore: event.bufferBefore,
      bufferAfter: event.bufferAfter,
      label: event.title,
    };
  });
}

export function prayerBusy(blocks: readonly PrayerBlock[]): BusyInterval[] {
  return blocks.map((b) => ({
    source: "prayer" as const,
    start: b.start,
    end: b.end,
    label: b.key,
  }));
}

export function gcalBusy(
  entries: readonly { start_at: string; end_at: string; summary: string | null }[],
): BusyInterval[] {
  return entries.map((e) => ({
    source: "gcal_busy" as const,
    start: new Date(e.start_at).getTime(),
    end: new Date(e.end_at).getTime(),
    label: e.summary ?? undefined,
  }));
}

export function toSchedulable(
  todo: Todo,
  remainingToAllocate: number,
  blocked: boolean,
  depth = 1,
): SchedulableTodo {
  return {
    id: todo.id,
    title: todo.title,
    categoryId: todo.category_id,
    tags: todo.tags,
    priority: todo.priority,
    dueDate: todo.due_date,
    createdAt: todo.created_at,
    remainingToAllocate,
    blocked,
    parentId: todo.parent_id,
    depth,
  };
}

export interface SchedulingWorld {
  windows: WindowInstance[];
  prayers: PrayerBlock[];
  timeBlocks: TimeBlockInstance[];
  events: EventInstance[];
  busy: BusyInterval[];
  free: FreeInterval[];
  shape: SessionShape;
  buffers: DefaultBuffers;
}

export interface BuildWorldInput {
  settings: Settings;
  availabilityWindows: readonly AvailabilityWindow[];
  agendas: readonly Agenda[];
  timeBlocks: readonly import("@/lib/db/schema").TimeBlock[];
  timeBlockExceptions: readonly import("@/lib/db/schema").TimeBlockException[];
  events: readonly CalendarEvent[];
  eventExceptions: readonly EventException[];
  gcalBusyEntries: readonly { start_at: string; end_at: string; summary: string | null }[];
  /**
   * Pinned coordinates, so each event occurrence can be given the journey it
   * actually needs. Omit and events keep their stored buffers.
   */
  places?: readonly Place[];
  from: IsoDate;
  to: IsoDate;
  /** Agendas to ignore — e.g. the one currently being dragged or rescheduled. */
  excludeAgendaIds?: ReadonlySet<UUID>;
  includeDraftAgendas?: boolean;
  minimumFreeMinutes?: number;
}

/**
 * Assembles everything §5.5 Step 1 asks for in one call, so the UI and the
 * allocator start from an identical picture of the week.
 */
export function buildWorld(input: BuildWorldInput): SchedulingWorld {
  const { settings, from, to } = input;
  const timezone = settings.timezone;

  const windows = resolveWindows(
    windowSpecsOf(input.availabilityWindows),
    from,
    to,
    timezone,
  );

  const prayers = resolvePrayerBlocks(
    {
      latitude: settings.latitude,
      longitude: settings.longitude,
      method: settings.prayer_calculation_method,
      blocks: settings.prayer_blocks,
      fridayDhuhrDurationMin: settings.friday_dhuhr_duration_min,
    },
    from,
    to,
  );

  const timeBlocks = expandTimeBlocks(
    input.timeBlocks,
    input.timeBlockExceptions,
    from,
    to,
    timezone,
  );

  const buffers = defaultBuffersOf(settings);

  // Every occurrence gets the journey to it worked out here, from the same
  // chain the agendas' stored buffers came from — see `expandEvents` for why an
  // event derives this rather than storing it.
  const events = expandEvents(
    input.events,
    input.eventExceptions,
    from,
    to,
    timezone,
    input.places
      ? {
          agendas: input.agendas,
          places: new Map(input.places.map((p) => [p.id, p] as const)),
          homePlaceId: settings.home_place_id,
          speedKmh: settings.commute_speed_kmh,
          defaultBefore: buffers.before,
          timezone,
        }
      : undefined,
  );

  const busy = [
    ...agendaBusy(input.agendas, {
      includeDrafts: input.includeDraftAgendas,
      excludeIds: input.excludeAgendaIds,
    }),
    ...eventBusy(events),
    ...prayerBusy(prayers),
    ...gcalBusy(input.gcalBusyEntries),
  ];

  const free = buildFreeSpace(windows, busy, {
    minimumMinutes: input.minimumFreeMinutes,
  });

  return {
    windows,
    prayers,
    timeBlocks,
    events,
    busy,
    free,
    shape: sessionShapeOf(settings),
    buffers,
  };
}
