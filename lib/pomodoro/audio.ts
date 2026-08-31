"use client";

/**
 * §5.6 — audio, synthesised with the Web Audio API. **No audio files.**
 *
 * iOS Safari needs three things that no other browser does, and missing any
 * one of them produces exactly the same symptom — total silence:
 *
 * 1. The AudioContext must be *created and resumed inside a user gesture*.
 *    `primeAudio()` does that synchronously; see its comment.
 * 2. By default Web Audio obeys the **hardware silent switch**. A phone with
 *    the ringer switch flipped plays nothing at all, however correct the code
 *    is. `navigator.audioSession.type = "playback"` opts out of that
 *    (Safari 16.4+); it is the only way, and there is no feature test beyond
 *    the property's existence.
 * 3. The context is suspended when the page stops being visible, and a
 *    `resume()` from a timer callback — not a gesture — is refused. A 25-minute
 *    session almost always ends in that state, so the bell would never ring.
 *    A silent keep-alive source holds the audio session open for the life of a
 *    session (`beginAudioSession`).
 */

let context: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let keepAlive: AudioBufferSourceNode | null = null;

type AudioContextCtor = typeof AudioContext;

/** Safari 16.4+ only; absent everywhere else, which is why it is optional. */
interface AudioSessionCapableNavigator extends Navigator {
  audioSession?: { type: string };
}

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Tells iOS this page plays *content*, not UI feedback, so the ringer switch
 * no longer silences it. Harmless and inert everywhere else.
 */
function claimPlaybackSession(): void {
  if (typeof navigator === "undefined") return;
  const session = (navigator as AudioSessionCapableNavigator).audioSession;
  if (session && session.type !== "playback") {
    try {
      session.type = "playback";
    } catch {
      // Read-only in some versions; the rest of the chain still works.
    }
  }
}

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  claimPlaybackSession();
  context = new Ctor();
  master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  return context;
}

/**
 * Starts a silent looping source that keeps the audio session alive.
 *
 * Without it iOS suspends the context the moment the screen locks or the app
 * is backgrounded, and the end-of-session bell is dropped — the single most
 * likely reason a pomodoro finishes in silence on a phone. The buffer is two
 * seconds of zeroes, so it costs nothing audible and almost nothing in power.
 */
export function beginAudioSession(): void {
  const ctx = ensureContext();
  if (!ctx || keepAlive) return;

  try {
    const buffer = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * 2), ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(ctx.destination);
    source.start(0);
    keepAlive = source;
  } catch {
    // Not fatal: audio still works while the app is in the foreground.
  }
}

/** Releases the keep-alive when no session is running. */
export function endAudioSession(): void {
  if (!keepAlive) return;
  try {
    keepAlive.stop();
    keepAlive.disconnect();
  } catch {
    /* already stopped */
  }
  keepAlive = null;
}

/**
 * Unlocks audio **synchronously**, inside the tap handler.
 *
 * This must not be awaited behind anything: browsers only honour `resume()` and
 * the silent-buffer trick while the call stack still belongs to the user
 * gesture. An earlier version awaited a Dexie read first, which put the unlock
 * in a later microtask — the AudioContext stayed suspended and nothing played,
 * on desktop as well as iOS.
 *
 * Call this first, before any `await`. `resume()` itself returns a promise,
 * but *starting* it in the gesture is what counts.
 */
export function primeAudio(): void {
  const ctx = ensureContext();
  if (!ctx) return;

  claimPlaybackSession();

  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  if (!unlocked) {
    // A one-sample silent buffer: enough to open the audio session on iOS.
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      unlocked = true;
    } catch {
      // Retried on the next gesture.
    }
  }
}

/** Awaitable form, for callers that genuinely are the gesture's first action. */
export async function unlockAudio(): Promise<boolean> {
  primeAudio();
  const ctx = context;
  if (!ctx) return false;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === "running";
}

/** Resume after the tab was backgrounded, where browsers suspend the context. */
export async function resumeAudio(): Promise<void> {
  if (context && context.state === "suspended") {
    try {
      await context.resume();
    } catch {
      /* the next user gesture will retry */
    }
  }
}

export function isAudioUnlocked(): boolean {
  return unlocked && context?.state === "running";
}

export function closeAudio(): void {
  endAudioSession();
  context?.close().catch(() => {});
  context = null;
  master = null;
  unlocked = false;
}

/** Diagnostic for Settings, so a silent phone is explainable rather than magic. */
export function audioState(): "unsupported" | "locked" | "suspended" | "running" {
  if (!audioContextCtor()) return "unsupported";
  if (!context) return "locked";
  if (context.state === "running") return "running";
  return "suspended";
}

/**
 * Ticking: "a short synthesized click once per second (a brief oscillator burst
 * through a fast-decay gain envelope — keep it soft, not sharp)."
 *
 * A triangle wave with a 30 ms decay and a gentle attack reads as a soft wooden
 * tick rather than the click a square wave would give.
 */
export function playTick(volume: number): void {
  const ctx = context;
  if (!ctx || !master || ctx.state !== "running" || volume <= 0) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(1_050, now);
  osc.frequency.exponentialRampToValueAtTime(620, now + 0.03);

  const peak = Math.min(0.18, 0.18 * volume);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);

  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 0.06);
}

/**
 * Bell: "a warm two-tone chime at session end."
 *
 * Two sine partials a perfect fifth apart, the upper one delayed and quieter,
 * each with a long exponential decay — the shape of a struck bar, not a beep.
 */
export function playBell(volume: number, kind: "focus" | "break" = "focus"): void {
  const ctx = context;
  if (!ctx || !master || ctx.state !== "running" || volume <= 0) return;

  const now = ctx.currentTime;
  // A break ends on a lower, calmer pair than a focus session does.
  const root = kind === "focus" ? 587.33 : 440; // D5 / A4
  const partials: { freq: number; delay: number; gain: number; decay: number }[] = [
    { freq: root, delay: 0, gain: 0.5, decay: 1.6 },
    { freq: root * 1.5, delay: 0.14, gain: 0.32, decay: 1.9 },
  ];

  for (const partial of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + partial.delay;

    osc.type = "sine";
    osc.frequency.setValueAtTime(partial.freq, start);

    const peak = Math.max(0.0002, Math.min(0.5, partial.gain * volume));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay);

    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + partial.decay + 0.05);
  }
}

/* ------------------------------------------------------------------ */
/* pre-scheduled bell                                                   */
/* ------------------------------------------------------------------ */

let scheduled: OscillatorNode[] = [];

/**
 * Books the end-of-phase chime on the *audio* clock, at session start.
 *
 * The bell used to be played from the tick that noticed the phase had ended.
 * That works on a desktop tab in the foreground and nowhere else: iOS throttles
 * or stops timers in a backgrounded page, so the one moment the user most needs
 * the sound — they put the phone down and went to work — is exactly the moment
 * JS is not running.
 *
 * Web Audio's scheduler is not JS. Once a node is booked with a start time it
 * fires on the audio thread whether or not the main thread is alive, provided
 * the context is still running — which is what `beginAudioSession` guarantees.
 *
 * Anything that changes when the phase ends (pause, skip, abort, resume) must
 * call `cancelScheduledBell` and book again.
 */
export function scheduleBell(
  delaySec: number,
  volume: number,
  kind: "focus" | "break" = "focus",
): void {
  cancelScheduledBell();

  const ctx = context;
  if (!ctx || !master || volume <= 0) return;
  if (delaySec <= 0) return;
  // Web Audio keeps every booked node in memory until it fires. An hour is far
  // beyond any sane phase and keeps that bounded.
  if (delaySec > 3 * 3600) return;

  const at = ctx.currentTime + delaySec;
  const root = kind === "focus" ? 587.33 : 440;
  const partials = [
    { freq: root, delay: 0, gain: 0.5, decay: 1.6 },
    { freq: root * 1.5, delay: 0.14, gain: 0.32, decay: 1.9 },
  ];

  for (const partial of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = at + partial.delay;

    osc.type = "sine";
    osc.frequency.setValueAtTime(partial.freq, start);

    const peak = Math.max(0.0002, Math.min(0.5, partial.gain * volume));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + partial.decay);

    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + partial.decay + 0.05);
    osc.addEventListener("ended", () => {
      scheduled = scheduled.filter((node) => node !== osc);
    });
    scheduled.push(osc);
  }
}

export function cancelScheduledBell(): void {
  for (const osc of scheduled) {
    try {
      osc.stop();
      osc.disconnect();
    } catch {
      /* already fired or stopped */
    }
  }
  scheduled = [];
}

export function hasScheduledBell(): boolean {
  return scheduled.length > 0;
}

/**
 * A short rising arpeggio for a completed planning session.
 *
 * Distinct from the pomodoro bell on purpose: that one marks the end of an
 * interval and should be calm, this one marks an accomplishment and rises. Four
 * partials of a major triad, each brief, played over ~700 ms.
 */
export function playFanfare(volume = 0.6): void {
  const ctx = context;
  const out = master;
  if (!ctx || !out || ctx.state !== "running" || volume <= 0) return;

  const now = ctx.currentTime;
  // C5 – E5 – G5 – C6: a plain major arpeggio, which reads as "resolved".
  const notes = [523.25, 659.25, 783.99, 1046.5];

  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = now + i * 0.11;
    const decay = i === notes.length - 1 ? 1.1 : 0.45;

    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, start);

    const peak = Math.max(0.0002, Math.min(0.4, 0.34 * volume));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);

    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + decay + 0.05);
  });
}

/** Settings → "Coba suara". Unlocks first, since it is itself a user gesture. */
export async function previewSound(
  which: "tick" | "bell",
  volume: number,
): Promise<void> {
  primeAudio();
  // Try immediately — on a context that is already running this plays inside
  // the gesture, which is the most reliable moment there is.
  if (which === "tick") playTick(volume);
  else playBell(volume);

  // Then again once a cold context has finished resuming, since the first
  // attempt above would have been dropped.
  const wasRunning = context?.state === "running";
  await unlockAudio();
  if (!wasRunning) {
    if (which === "tick") playTick(volume);
    else playBell(volume);
  }
}
