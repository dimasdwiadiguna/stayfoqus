import { describe, expect, it } from "vitest";

import {
  IDLE,
  abort,
  advance,
  breakAfter,
  elapsedMs,
  isExpired,
  pause,
  progress,
  remainingMs,
  resume,
  skip,
  startFocus,
  type PomodoroConfig,
  type TimerState,
} from "@/lib/pomodoro/machine";

const CONFIG: PomodoroConfig = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
};

const MIN = 60_000;
const T0 = Date.parse("2026-08-26T02:00:00.000Z");

let counter = 0;
const nextLogId = () => `log-${++counter}`;

function begin(overrides: Partial<Parameters<typeof startFocus>[1]> = {}) {
  counter = 0;
  return startFocus(IDLE, {
    now: T0,
    config: CONFIG,
    logId: nextLogId(),
    agendaId: "agenda-1",
    todoId: "todo-1",
    ...overrides,
  });
}

describe("§5.6 wall-clock timing", () => {
  it("derives elapsed and remaining from `now`, never from a counter", () => {
    const { state } = begin();
    const phase = state.phase!;
    expect(elapsedMs(phase, T0 + 10 * MIN)).toBe(10 * MIN);
    expect(remainingMs(phase, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(progress(phase, T0 + 10 * MIN)).toBeCloseTo(0.4);
  });

  it("clamps remaining at zero past the target", () => {
    const { state } = begin();
    expect(remainingMs(state.phase!, T0 + 90 * MIN)).toBe(0);
    expect(isExpired(state.phase!, T0 + 90 * MIN)).toBe(true);
  });

  it("opens a log the moment a focus session starts", () => {
    const { effects } = begin();
    expect(effects).toEqual([
      {
        type: "open-log",
        logId: "log-1",
        kind: "focus",
        startedAt: T0,
        agendaId: "agenda-1",
        todoId: "todo-1",
        isOvertime: false,
      },
    ]);
  });
});

describe("pause and resume do not lose time", () => {
  it("freezes elapsed time while paused", () => {
    const started = begin().state;
    const paused = pause(started, T0 + 5 * MIN).state;
    expect(elapsedMs(paused.phase!, T0 + 20 * MIN)).toBe(5 * MIN);
  });

  it("credits the paused interval back on resume", () => {
    let state = begin().state;
    state = pause(state, T0 + 5 * MIN).state;
    state = resume(state, T0 + 12 * MIN).state;
    // 5 minutes ran, 7 were paused: at T0+20 only 13 minutes have elapsed.
    expect(elapsedMs(state.phase!, T0 + 20 * MIN)).toBe(13 * MIN);
    expect(state.phase!.pausedMs).toBe(7 * MIN);
  });

  it("never expires while paused, however long the app is away", () => {
    let state = begin().state;
    state = pause(state, T0 + 1 * MIN).state;
    const result = advance(state, T0 + 500 * MIN, CONFIG, nextLogId);
    expect(result.effects).toEqual([]);
    expect(result.state.phase?.kind).toBe("focus");
  });

  it("ignores a redundant pause or resume", () => {
    let state = begin().state;
    state = pause(state, T0 + MIN).state;
    const again = pause(state, T0 + 2 * MIN);
    expect(again.state.phase!.pausedAt).toBe(T0 + MIN);
    const notPaused = resume(begin().state, T0 + MIN);
    expect(notPaused.state.phase!.pausedMs).toBe(0);
  });
});

describe("§5.6 phase transitions", () => {
  it("completes focus and auto-starts the break", () => {
    const started = begin().state;
    const { state, effects } = advance(started, T0 + 25 * MIN, CONFIG, nextLogId);

    expect(effects.map((e) => e.type)).toEqual([
      "close-log",
      "chime",
      "focus-completed",
      "open-log",
    ]);
    const closed = effects[0];
    expect(closed).toMatchObject({
      type: "close-log",
      logId: "log-1",
      outcome: "completed",
      durationSec: 1500,
    });
    expect(state.phase?.kind).toBe("short_break");
    expect(state.completedFocus).toBe(1);
    expect(state.awaitingFocus).toBe(false);
  });

  it("waits for an explicit tap after a break", () => {
    let state = begin().state;
    state = advance(state, T0 + 25 * MIN, CONFIG, nextLogId).state;
    const after = advance(state, T0 + 31 * MIN, CONFIG, nextLogId);

    expect(after.state.phase).toBeNull();
    expect(after.state.awaitingFocus).toBe(true);
    expect(after.effects.map((e) => e.type)).toEqual(["close-log", "chime"]);
  });

  it("takes a long break after every 4th focus session", () => {
    expect(breakAfter(1, CONFIG)).toBe("short_break");
    expect(breakAfter(3, CONFIG)).toBe("short_break");
    expect(breakAfter(4, CONFIG)).toBe("long_break");
    expect(breakAfter(8, CONFIG)).toBe("long_break");
  });

  it("opens a long break in the machine after the 4th focus", () => {
    let state: TimerState = { ...IDLE, completedFocus: 3 };
    state = startFocus(state, {
      now: T0,
      config: CONFIG,
      logId: nextLogId(),
      alreadyCompleted: 3,
    }).state;
    const result = advance(state, T0 + 25 * MIN, CONFIG, nextLogId);
    expect(result.state.phase?.kind).toBe("long_break");
    expect(result.state.phase?.durationMs).toBe(15 * MIN);
  });
});

describe("recovery after a background/foreground cycle (§13)", () => {
  it("resolves a session that ended while the app was away", () => {
    const started = begin().state;
    // The app is backgrounded at T0+2m and returns an hour later.
    const { state, effects } = advance(started, T0 + 62 * MIN, CONFIG, nextLogId);

    // Both the focus session and its break elapsed while away.
    expect(state.phase).toBeNull();
    expect(state.awaitingFocus).toBe(true);
    expect(state.completedFocus).toBe(1);
    expect(effects.map((e) => e.type)).toEqual([
      "close-log",
      "chime",
      "focus-completed",
      "open-log",
      "close-log",
      "chime",
    ]);
  });

  it("closes each log at its true end time, not at the wake-up time", () => {
    const started = begin().state;
    const { effects } = advance(started, T0 + 62 * MIN, CONFIG, nextLogId);

    const focusClose = effects.find(
      (e) => e.type === "close-log" && e.logId === "log-1",
    );
    expect(focusClose).toMatchObject({ endedAt: T0 + 25 * MIN });

    const breakClose = effects.find(
      (e) => e.type === "close-log" && e.logId === "log-2",
    );
    // Focus ended at +25, the 5-minute break at +30 — not at +62.
    expect(breakClose).toMatchObject({ endedAt: T0 + 30 * MIN, durationSec: 300 });
  });

  it("is idempotent — advancing twice changes nothing further", () => {
    const started = begin().state;
    const first = advance(started, T0 + 62 * MIN, CONFIG, nextLogId);
    const second = advance(first.state, T0 + 62 * MIN, CONFIG, nextLogId);
    expect(second.effects).toEqual([]);
    expect(second.state).toEqual(first.state);
  });

  it("does nothing when the phase is still running", () => {
    const started = begin().state;
    const result = advance(started, T0 + 5 * MIN, CONFIG, nextLogId);
    expect(result.effects).toEqual([]);
    expect(result.state).toEqual(started);
  });
});

describe("§5.6 abort and skip", () => {
  it("logs an aborted focus session but counts nothing", () => {
    const started = begin().state;
    const { state, effects } = abort(started, T0 + 9 * MIN);
    expect(state).toEqual(IDLE);
    expect(effects).toEqual([
      {
        type: "close-log",
        logId: "log-1",
        endedAt: T0 + 9 * MIN,
        durationSec: 540,
        outcome: "aborted",
      },
    ]);
  });

  it("treats skipping a focus session as aborting it", () => {
    const started = begin().state;
    const { effects } = skip(started, T0 + 3 * MIN, CONFIG, nextLogId());
    expect(effects[0]).toMatchObject({ outcome: "aborted" });
  });

  it("lets a break be skipped straight to the awaiting-focus state", () => {
    let state = begin().state;
    state = advance(state, T0 + 25 * MIN, CONFIG, nextLogId).state;
    const { state: after, effects } = skip(state, T0 + 27 * MIN, CONFIG, nextLogId());
    expect(after.awaitingFocus).toBe(true);
    expect(effects[0]).toMatchObject({ outcome: "completed" });
  });
});

describe("overtime (§5.6)", () => {
  it("marks the log as overtime when asked", () => {
    const { state, effects } = begin({ isOvertime: true });
    expect(state.phase!.isOvertime).toBe(true);
    expect(effects[0]).toMatchObject({ isOvertime: true });
  });
});

describe("untethered sessions (§5.6)", () => {
  it("runs with no agenda", () => {
    counter = 0;
    const { state, effects } = startFocus(IDLE, {
      now: T0,
      config: CONFIG,
      logId: nextLogId(),
      agendaId: null,
      todoId: null,
    });
    expect(state.agendaId).toBeNull();
    expect(effects[0]).toMatchObject({ agendaId: null, todoId: null });
  });
});
