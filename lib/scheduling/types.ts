import type {
  BufferType,
  DayOfWeek,
  HHmm,
  IsoDate,
  Priority,
  UUID,
} from "@/lib/db/schema";

/**
 * `lib/scheduling` is pure and framework-free (§5, §13).
 *
 * No React, no Dexie, no `Date.now()` reached for implicitly — every entry
 * point takes the data it needs. Intervals are epoch milliseconds because all
 * the arithmetic here is interval arithmetic; conversion to and from wall-clock
 * time happens only at the edges, through `lib/time`.
 */

export interface Interval {
  /** Inclusive start, epoch ms. */
  start: number;
  /** Exclusive end, epoch ms. */
  end: number;
}

export interface BufferSide {
  min: number;
  type: BufferType;
}

/** What sits immediately before or after a free interval. */
export type EdgeKind =
  /** The availability window itself — buffers may spill past it (§5.2). */
  | { kind: "window" }
  /** A prayer block or an external busy block: hard, and carries no buffer. */
  | { kind: "obstacle"; obstacle: ObstacleKind }
  /** Another agenda, whose facing buffer is already carved out of the map. */
  | { kind: "agenda"; buffer: BufferSide; agendaId: UUID };

export type ObstacleKind = "prayer" | "gcal_busy";

export interface FreeInterval extends Interval {
  /** Local date this interval belongs to (its containing availability window). */
  date: IsoDate;
  before: EdgeKind;
  after: EdgeKind;
}

/** An interval that blocks scheduling, with enough context to explain itself. */
export interface BusyInterval extends Interval {
  source: "agenda" | "prayer" | "gcal_busy";
  /** For agendas: the core interval without buffers. */
  core?: Interval;
  bufferBefore?: BufferSide;
  bufferAfter?: BufferSide;
  agendaId?: UUID;
  label?: string;
}

/** An availability window resolved to a concrete instant range (§4.5). */
export interface WindowInstance extends Interval {
  date: IsoDate;
  dayOfWeek: DayOfWeek;
}

/** A prayer block resolved for one day (§5.3). */
export interface PrayerBlock extends Interval {
  date: IsoDate;
  key: "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
  /** True for the longer Friday Dhuhr block. */
  fridayDhuhr: boolean;
}

/** One occurrence of a recurring or one-off time block (§4.6, §5.4). */
export interface TimeBlockInstance extends Interval {
  date: IsoDate;
  timeBlockId: UUID;
  name: string;
  color: string;
  filterCategoryIds: UUID[];
  filterTags: string[];
  filterPriorities: Priority[];
}

/** The subset of a todo the scheduler reasons about. */
export interface SchedulableTodo {
  id: UUID;
  title: string;
  categoryId: UUID | null;
  tags: string[];
  priority: Priority;
  dueDate: IsoDate | null;
  createdAt: string;
  remainingToAllocate: number;
  /** Blocked todos are excluded from smart allocation entirely (§4.2, §5.5). */
  blocked: boolean;
  /** Hierarchy parent, used to keep a parent from starting before its children. */
  parentId: UUID | null;
  /**
   * Depth in the hierarchy (1 = root). Deeper todos are scheduled first so a
   * parent can be placed after everything beneath it.
   */
  depth: number;
}

/** Pomodoro geometry, from settings (§4.8). */
export interface SessionShape {
  focusMin: number;
  shortBreakMin: number;
}

export interface DefaultBuffers {
  before: BufferSide;
  after: BufferSide;
}

export interface AvailabilityWindowSpec {
  dayOfWeek: DayOfWeek;
  startTime: HHmm;
  endTime: HHmm;
  enabled: boolean;
}
