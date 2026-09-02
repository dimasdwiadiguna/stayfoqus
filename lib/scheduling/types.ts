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
  /**
   * Another block that owns buffers — an agenda, or a manually entered event.
   * Its facing buffer is already carved out of the map, so a candidate owes
   * only the shortfall (§5.2, D-028).
   */
  | { kind: "buffered"; buffer: BufferSide; owner: BufferedOwner; ownerId: UUID };

/** What a buffered edge belongs to. Both compose by the same §5.2 rule. */
export type BufferedOwner = "agenda" | "event";

export type ObstacleKind = "prayer" | "gcal_busy";

export interface FreeInterval extends Interval {
  /** Local date this interval belongs to (its containing availability window). */
  date: IsoDate;
  before: EdgeKind;
  after: EdgeKind;
  /**
   * Where you would be when this interval begins: home at the start of the day,
   * otherwise the place of the last committed block before it.
   *
   * The free-space map's mirror of `resolveCommute`'s `lastPlace`, and the same
   * fold — so what the suggester reserves for a journey is what the reconciler
   * will later write onto the row. Null when there is nothing to go on (no home
   * pin yet, or nothing placed today has a location), which reads as "no
   * journey" everywhere.
   */
  originPlaceId: UUID | null;
}

/** An interval that blocks scheduling, with enough context to explain itself. */
export interface BusyInterval extends Interval {
  source: "agenda" | "event" | "prayer" | "gcal_busy";
  /** For agendas and events: the core interval, without the buffers. */
  core?: Interval;
  bufferBefore?: BufferSide;
  bufferAfter?: BufferSide;
  /** The agenda or event this came from, for a buffered edge. */
  ownerId?: UUID;
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
  /**
   * The call to prayer itself, at the exact midpoint of the block.
   *
   * Stored because the block no longer begins there (D-102): the first half is
   * time to stop, walk and make wudhu. Without this instant nothing on screen
   * could say when the adhan actually is.
   */
  adhan: number;
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
  /** Where the work happens, so the allocator can charge the journey to it. */
  placeId: UUID | null;
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
