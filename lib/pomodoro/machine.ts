import type { PomodoroType, UUID } from "@/lib/db/schema";

/**
 * §5.6 — the pomodoro timer, as a pure state machine.
 *
 * The rule that shapes everything here: **timing is wall-clock based**. The
 * state stores instants, never a countdown, and every read derives the elapsed
 * time from `now`. A backgrounded tab, a throttled timer, a device asleep for
 * an hour — none of them can make this drift, because nothing is accumulated.
 *
 * `advance(state, now)` is the single place a phase can end. It is called on
 * every tick *and* on every visibility change, so returning to the app after
 * the target end time resolves the session immediately.
 */

export type PhaseKind = PomodoroType;

export interface Phase {
  kind: PhaseKind;
  /** Id of the `pomodoro_logs` row opened when this phase started. */
  logId: UUID;
  /** Wall-clock instant this phase began. */
  startedAt: number;
  /** Target length, excluding paused time. */
  durationMs: number;
  /** When the user paused, or null while running. */
  pausedAt: number | null;
  /** Total paused time already accumulated in this phase. */
  pausedMs: number;
  agendaId: UUID | null;
  todoId: UUID | null;
  /** §5.6: running beyond the agenda's allocation is allowed and marked. */
  isOvertime: boolean;
}

export interface TimerState {
  phase: Phase | null;
  /**
   * §5.6: "Breaks auto-start. The next focus session waits for an explicit
   * tap." True between a finished break and that tap.
   */
  awaitingFocus: boolean;
  /** Completed focus sessions in this run — drives the long-break cadence. */
  completedFocus: number;
  /** The agenda this run is attached to; null for an untethered session. */
  agendaId: UUID | null;
  todoId: UUID | null;
}

export const IDLE: TimerState = {
  phase: null,
  awaitingFocus: false,
  completedFocus: 0,
  agendaId: null,
  todoId: null,
};

export interface PomodoroConfig {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
}

const MINUTE = 60_000;

/* ------------------------------------------------------------------ */
/* derived reads                                                       */
/* ------------------------------------------------------------------ */

export function elapsedMs(phase: Phase, now: number): number {
  const pausedNow = phase.pausedAt === null ? 0 : now - phase.pausedAt;
  return Math.max(0, now - phase.startedAt - phase.pausedMs - pausedNow);
}

export function remainingMs(phase: Phase, now: number): number {
  return Math.max(0, phase.durationMs - elapsedMs(phase, now));
}

export function progress(phase: Phase, now: number): number {
  if (phase.durationMs <= 0) return 1;
  return Math.min(1, elapsedMs(phase, now) / phase.durationMs);
}

export function isExpired(phase: Phase, now: number): boolean {
  return elapsedMs(phase, now) >= phase.durationMs;
}

export function isPaused(phase: Phase): boolean {
  return phase.pausedAt !== null;
}

export function durationFor(kind: PhaseKind, config: PomodoroConfig): number {
  if (kind === "focus") return config.focusMin * MINUTE;
  if (kind === "short_break") return config.shortBreakMin * MINUTE;
  return config.longBreakMin * MINUTE;
}

/**
 * Which break follows the Nth completed focus session.
 * §5.6: a long break "after every 4 focus sessions".
 */
export function breakAfter(
  completedFocus: number,
  config: PomodoroConfig,
): PhaseKind {
  const every = Math.max(1, config.longBreakEvery);
  return completedFocus > 0 && completedFocus % every === 0
    ? "long_break"
    : "short_break";
}

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

/**
 * What the caller must persist. The machine never touches Dexie itself — the
 * host applies these in order, which keeps the machine testable in isolation.
 */
export type TimerEffect =
  | {
      type: "open-log";
      logId: UUID;
      kind: PhaseKind;
      startedAt: number;
      agendaId: UUID | null;
      todoId: UUID | null;
      isOvertime: boolean;
    }
  | {
      type: "close-log";
      logId: UUID;
      endedAt: number;
      durationSec: number;
      outcome: "completed" | "aborted";
    }
  | { type: "chime"; kind: PhaseKind }
  | { type: "focus-completed"; agendaId: UUID | null; todoId: UUID | null };

export interface TimerResult {
  state: TimerState;
  effects: TimerEffect[];
}

/* ------------------------------------------------------------------ */
/* transitions                                                         */
/* ------------------------------------------------------------------ */

function openPhase(
  kind: PhaseKind,
  now: number,
  config: PomodoroConfig,
  base: Pick<TimerState, "agendaId" | "todoId">,
  logId: UUID,
  isOvertime: boolean,
): { phase: Phase; effect: TimerEffect } {
  const phase: Phase = {
    kind,
    logId,
    startedAt: now,
    durationMs: durationFor(kind, config),
    pausedAt: null,
    pausedMs: 0,
    agendaId: base.agendaId,
    todoId: base.todoId,
    isOvertime,
  };
  return {
    phase,
    effect: {
      type: "open-log",
      logId,
      kind,
      startedAt: now,
      agendaId: base.agendaId,
      todoId: base.todoId,
      isOvertime,
    },
  };
}

export interface StartFocusInput {
  now: number;
  config: PomodoroConfig;
  logId: UUID;
  agendaId?: UUID | null;
  todoId?: UUID | null;
  /** Completed focus sessions already logged against this agenda. */
  alreadyCompleted?: number;
  /** True when this session exceeds the agenda's allocation (§5.6). */
  isOvertime?: boolean;
}

export function startFocus(
  state: TimerState,
  input: StartFocusInput,
): TimerResult {
  const base = {
    agendaId: input.agendaId ?? state.agendaId ?? null,
    todoId: input.todoId ?? state.todoId ?? null,
  };
  const { phase, effect } = openPhase(
    "focus",
    input.now,
    input.config,
    base,
    input.logId,
    input.isOvertime ?? false,
  );

  return {
    state: {
      ...state,
      ...base,
      phase,
      awaitingFocus: false,
      completedFocus: input.alreadyCompleted ?? state.completedFocus,
    },
    effects: [effect],
  };
}

export function pause(state: TimerState, now: number): TimerResult {
  if (!state.phase || state.phase.pausedAt !== null) {
    return { state, effects: [] };
  }
  return {
    state: { ...state, phase: { ...state.phase, pausedAt: now } },
    effects: [],
  };
}

export function resume(state: TimerState, now: number): TimerResult {
  const phase = state.phase;
  if (!phase || phase.pausedAt === null) return { state, effects: [] };
  return {
    state: {
      ...state,
      phase: {
        ...phase,
        pausedAt: null,
        pausedMs: phase.pausedMs + (now - phase.pausedAt),
      },
    },
    effects: [],
  };
}

/**
 * §5.6: "A focus session counts as used only if the full 25 minutes elapse.
 * Aborting logs `outcome='aborted'` and counts for nothing." The log is still
 * written — aborted sessions are honest data.
 */
export function abort(state: TimerState, now: number): TimerResult {
  const phase = state.phase;
  if (!phase) return { state: { ...state, awaitingFocus: false }, effects: [] };

  return {
    state: { ...IDLE },
    effects: [
      {
        type: "close-log",
        logId: phase.logId,
        endedAt: now,
        durationSec: Math.round(elapsedMs(phase, now) / 1000),
        outcome: "aborted",
      },
    ],
  };
}

/**
 * "Lewati" — end the current phase early *as if* it had finished.
 * For a break that is harmless. For a focus session it is not, so skipping a
 * focus session aborts it: only a full session counts (§5.6).
 */
export function skip(
  state: TimerState,
  now: number,
  config: PomodoroConfig,
  nextLogId: UUID,
): TimerResult {
  const phase = state.phase;
  if (!phase) return { state, effects: [] };
  if (phase.kind === "focus") return abort(state, now);
  void config;
  void nextLogId;
  return finishBreak(state, phase, now);
}

function finishFocus(
  state: TimerState,
  phase: Phase,
  now: number,
  config: PomodoroConfig,
  breakLogId: UUID,
): TimerResult {
  const completedFocus = state.completedFocus + 1;
  const kind = breakAfter(completedFocus, config);

  // §5.6: breaks auto-start, so the break phase opens immediately.
  const { phase: breakPhase, effect: openBreak } = openPhase(
    kind,
    now,
    config,
    state,
    breakLogId,
    false,
  );

  return {
    state: { ...state, phase: breakPhase, awaitingFocus: false, completedFocus },
    effects: [
      {
        type: "close-log",
        logId: phase.logId,
        endedAt: now,
        durationSec: Math.round(phase.durationMs / 1000),
        outcome: "completed",
      },
      { type: "chime", kind: "focus" },
      { type: "focus-completed", agendaId: phase.agendaId, todoId: phase.todoId },
      openBreak,
    ],
  };
}

function finishBreak(
  state: TimerState,
  phase: Phase,
  now: number,
): TimerResult {
  return {
    state: { ...state, phase: null, awaitingFocus: true },
    effects: [
      {
        type: "close-log",
        logId: phase.logId,
        endedAt: now,
        durationSec: Math.round(elapsedMs(phase, now) / 1000),
        outcome: "completed",
      },
      { type: "chime", kind: phase.kind },
    ],
  };
}

/**
 * Resolves the state forward to `now`.
 *
 * This is what makes recovery correct: on a tick, on a visibility change, and
 * on a cold start from persisted state, the same function runs. If the app was
 * away long enough for a focus session *and* its break to elapse, both are
 * resolved in one call and the machine lands on `awaitingFocus`.
 */
export function advance(
  state: TimerState,
  now: number,
  config: PomodoroConfig,
  nextLogId: () => UUID,
): TimerResult {
  let current = state;
  const effects: TimerEffect[] = [];

  // Bounded: each iteration either ends a phase or stops. Two phases can end in
  // one call (focus then its break); the guard is defensive.
  for (let i = 0; i < 4; i += 1) {
    const phase = current.phase;
    if (!phase || phase.pausedAt !== null || !isExpired(phase, now)) break;

    // The phase ended at its target time, not at `now` — that difference is
    // exactly the time the app spent in the background.
    const endedAt = phase.startedAt + phase.pausedMs + phase.durationMs;

    const result =
      phase.kind === "focus"
        ? finishFocus(current, phase, endedAt, config, nextLogId())
        : finishBreak(current, phase, endedAt);

    current = result.state;
    effects.push(...result.effects);
  }

  return { state: current, effects };
}

/** Clears `awaitingFocus` without starting anything — the Focus screen's exit. */
export function dismiss(): TimerResult {
  return { state: { ...IDLE }, effects: [] };
}
