"use client";

import { create } from "zustand";

import { getDb } from "@/lib/db/client";
import { createRow, newId, updateRow } from "@/lib/db/mutations";
import type { PomodoroType, UUID } from "@/lib/db/schema";
import {
  beginAudioSession,
  cancelScheduledBell,
  endAudioSession,
  hasScheduledBell,
  playBell,
  playTick,
  primeAudio,
  resumeAudio,
  scheduleBell,
  unlockAudio,
} from "@/lib/pomodoro/audio";
import {
  IDLE,
  abort,
  advance,
  dismiss,
  isPaused,
  pause,
  remainingMs,
  resume,
  skip,
  startFocus,
  type PomodoroConfig,
  type TimerEffect,
  type TimerState,
} from "@/lib/pomodoro/machine";
import { haptic, notifyLocal } from "@/lib/reward";
import { id as t } from "@/lib/i18n/id";

/**
 * Hosts the pure timer machine: applies its effects to Dexie, plays audio,
 * holds the wake lock, and persists the run so a refresh or a crash resumes it
 * (§5.6).
 */

const STORAGE_KEY = "foqus.timer.v1";
/** Re-render cadence. Timing itself is wall-clock; this only paints. */
const TICK_MS = 1_000;

export interface PomodoroStore {
  timer: TimerState;
  /** Bumped every tick so subscribed components repaint. */
  now: number;
  minimized: boolean;
  visible: boolean;
  wakeLockActive: boolean;
  config: PomodoroConfig;
  audio: { ticking: boolean; tickingVolume: number; bell: boolean; bellVolume: number };
}

interface Internal extends PomodoroStore {
  set: (patch: Partial<PomodoroStore>) => void;
}

export const usePomodoroStore = create<Internal>((set) => ({
  timer: IDLE,
  now: 0,
  minimized: false,
  visible: false,
  wakeLockActive: false,
  config: {
    focusMin: 25,
    shortBreakMin: 5,
    longBreakMin: 15,
    longBreakEvery: 4,
  },
  audio: { ticking: true, tickingVolume: 0.35, bell: true, bellVolume: 0.6 },
  set: (patch) => set(patch),
}));

const read = () => usePomodoroStore.getState();
const write = (patch: Partial<PomodoroStore>) => read().set(patch);

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

function persist(state: TimerState): void {
  try {
    if (state.phase === null && !state.awaitingFocus) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Private mode, quota, or a browser with storage disabled — the timer
    // still runs, it just will not survive a reload.
  }
}

function restore(): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return IDLE;
    const parsed = JSON.parse(raw) as TimerState;
    if (!parsed || typeof parsed !== "object") return IDLE;
    return { ...IDLE, ...parsed };
  } catch {
    return IDLE;
  }
}

/* ------------------------------------------------------------------ */
/* effects                                                             */
/* ------------------------------------------------------------------ */

async function applyEffects(effects: TimerEffect[]): Promise<void> {
  const { audio } = read();

  for (const effect of effects) {
    switch (effect.type) {
      case "open-log":
        await createRow("pomodoro_logs", {
          id: effect.logId,
          agenda_id: effect.agendaId,
          todo_id: effect.todoId,
          started_at: new Date(effect.startedAt).toISOString(),
          ended_at: null,
          duration_sec: 0,
          type: effect.kind,
          // A session in flight is `aborted` until it actually finishes.
          // §5.6: "counts as used only if the full 25 minutes elapse" — and
          // this is also the honest record if the app dies mid-session.
          outcome: "aborted",
          is_overtime: effect.isOvertime,
        });
        break;

      case "close-log":
        await updateRow("pomodoro_logs", effect.logId, {
          ended_at: new Date(effect.endedAt).toISOString(),
          duration_sec: effect.durationSec,
          outcome: effect.outcome,
        });
        break;

      case "chime":
        // The bell was normally already booked on the audio clock when the
        // phase started (see `syncScheduledBell`), which is what makes it ring
        // on a backgrounded phone. Playing again here would double it, so this
        // only covers the case where nothing was booked — a phase ended early,
        // or the context was not running when it began.
        if (audio.bell && !hasScheduledBell()) {
          playBell(audio.bellVolume, effect.kind === "focus" ? "focus" : "break");
        }
        haptic([12, 60, 18]);
        void notifyLocal(
          effect.kind === "focus" ? t.focus.doneToast : t.focus.breakAutoStart,
        );
        break;

      case "focus-completed":
        // The Focus screen listens for this to fill the dot and pulse the ring.
        break;
    }
  }
}

async function commit(result: { state: TimerState; effects: TimerEffect[] }) {
  write({ timer: result.state });
  persist(result.state);
  await applyEffects(result.effects);
  await syncWakeLock(result.state);
  syncAudioSession(result.state);
}

/**
 * Keeps the audio session and the booked chime in step with the phase.
 *
 * Called after every transition, so pausing cancels the booking, resuming
 * re-books it from the new end time, and going idle releases the keep-alive.
 */
function syncAudioSession(state: TimerState): void {
  const { audio } = read();
  const phase = state.phase;

  if (!phase) {
    cancelScheduledBell();
    endAudioSession();
    return;
  }

  // Held for the whole run, breaks included: a break that ends unheard is the
  // same failure as a focus session that does.
  beginAudioSession();

  if (!audio.bell || isPaused(phase)) {
    cancelScheduledBell();
    return;
  }

  scheduleBell(
    remainingMs(phase, Date.now()) / 1000,
    audio.bellVolume,
    phase.kind === "focus" ? "focus" : "break",
  );
}

/* ------------------------------------------------------------------ */
/* wake lock (§5.6)                                                    */
/* ------------------------------------------------------------------ */

let wakeLock: WakeLockSentinel | null = null;

async function syncWakeLock(state: TimerState): Promise<void> {
  const wantLock = state.phase?.kind === "focus" && state.phase.pausedAt === null;

  if (wantLock && !wakeLock) {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
      wakeLock?.addEventListener("release", () => {
        wakeLock = null;
        write({ wakeLockActive: false });
      });
      write({ wakeLockActive: Boolean(wakeLock) });
    } catch {
      // Unsupported (iOS < 16.4) or refused. The Focus screen says so rather
      // than pretending the screen will stay on.
      write({ wakeLockActive: false });
    }
    return;
  }

  if (!wantLock && wakeLock) {
    try {
      await wakeLock.release();
    } catch {
      /* already released */
    }
    wakeLock = null;
    write({ wakeLockActive: false });
  }
}

/* ------------------------------------------------------------------ */
/* public actions                                                      */
/* ------------------------------------------------------------------ */

export interface StartOptions {
  agendaId?: UUID | null;
  todoId?: UUID | null;
  /** Completed focus logs already recorded against this agenda. */
  alreadyCompleted?: number;
  /** True when this session runs beyond the agenda's allocation (§5.6). */
  isOvertime?: boolean;
}

/**
 * The one entry point that may be called from a tap handler — and must be,
 * because iOS only unlocks audio inside a user gesture.
 */
export async function startFocusSession(options: StartOptions = {}): Promise<void> {
  // Synchronous first, so the unlock happens while this is still the gesture.
  primeAudio();
  await unlockAudio();
  const { timer, config } = read();
  const result = startFocus(timer, {
    now: Date.now(),
    config,
    logId: newId(),
    agendaId: options.agendaId ?? null,
    todoId: options.todoId ?? null,
    alreadyCompleted: options.alreadyCompleted,
    isOvertime: options.isOvertime,
  });
  write({ visible: true, minimized: false });
  await commit(result);
}

export async function pauseSession(): Promise<void> {
  await commit(pause(read().timer, Date.now()));
}

export async function resumeSession(): Promise<void> {
  await resumeAudio();
  await commit(resume(read().timer, Date.now()));
}

export async function skipPhase(): Promise<void> {
  const { timer, config } = read();
  await commit(skip(timer, Date.now(), config, newId()));
}

export async function stopSession(): Promise<void> {
  await commit(abort(read().timer, Date.now()));
  write({ visible: false, minimized: false });
}

export function dismissSession(): void {
  void commit(dismiss());
  write({ visible: false, minimized: false });
}

export function setMinimized(minimized: boolean): void {
  write({ minimized });
}

export function setFocusVisible(visible: boolean): void {
  write({ visible });
}

/** Keeps the store's copy of settings current (durations, audio). */
export function syncPomodoroSettings(
  config: PomodoroConfig,
  audio: PomodoroStore["audio"],
): void {
  write({ config, audio });
  // Turning the bell off mid-session must drop a booking already on the audio
  // clock, or it would ring anyway.
  syncAudioSession(read().timer);
}

/**
 * Counts completed focus logs already recorded for an agenda, so a resumed run
 * continues the numbering and knows when it has gone into overtime.
 */
export async function completedFocusFor(agendaId: UUID): Promise<number> {
  const logs = await getDb().pomodoro_logs.where("agenda_id").equals(agendaId).toArray();
  return logs.filter(
    (log) => !log.deleted_at && log.type === "focus" && log.outcome === "completed",
  ).length;
}

/* ------------------------------------------------------------------ */
/* engine loop                                                         */
/* ------------------------------------------------------------------ */

let started = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let lastTickSecond = -1;

async function step(): Promise<void> {
  const { timer, config, audio } = read();
  const now = Date.now();
  write({ now });

  if (timer.phase) {
    const result = advance(timer, now, config, () => newId());
    if (result.effects.length > 0) {
      await commit(result);
      return;
    }

    // §5.6 ticking: once per second, during a running focus session only.
    const second = Math.floor(now / 1000);
    if (
      audio.ticking &&
      timer.phase.kind === "focus" &&
      timer.phase.pausedAt === null &&
      second !== lastTickSecond
    ) {
      lastTickSecond = second;
      playTick(audio.tickingVolume);
    }
  }
}

/**
 * Starts the loop and installs the recovery hooks.
 *
 * The visibility handler is the important one: browsers throttle timers in a
 * background tab, so returning to the app must resolve the elapsed phases
 * immediately rather than waiting for the next tick (§5.6).
 */
export function startPomodoroEngine(): () => void {
  if (started || typeof window === "undefined") return () => {};
  started = true;

  const restored = restore();
  write({ timer: restored, now: Date.now() });
  // Resolve anything that elapsed while the app was closed.
  void step();

  const onVisibility = () => {
    if (document.visibilityState !== "visible") return;
    void resumeAudio();
    void step();
    void syncWakeLock(read().timer);
    // Coming back may have found the phase already over, or resumed a context
    // that dropped its booking; re-sync either way.
    syncAudioSession(read().timer);
  };

  document.addEventListener("visibilitychange", onVisibility);
  ticker = setInterval(() => void step(), TICK_MS);

  return () => {
    started = false;
    document.removeEventListener("visibilitychange", onVisibility);
    if (ticker) clearInterval(ticker);
    void syncWakeLock(IDLE);
    cancelScheduledBell();
    endAudioSession();
  };
}

export function currentPhaseLabel(kind: PomodoroType): string {
  if (kind === "focus") return t.focus.title;
  if (kind === "short_break") return t.focus.breakShort;
  return t.focus.breakLong;
}
