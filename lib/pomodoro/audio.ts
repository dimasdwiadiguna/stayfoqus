"use client";

/**
 * §5.6 — audio, synthesised with the Web Audio API. **No audio files.**
 *
 * iOS will not let an AudioContext produce sound unless it was created and
 * resumed inside a user gesture, so `unlockAudio()` must be called from the
 * tap handler on "Mulai fokus" — never on page load. It also plays a silent
 * buffer, which is what actually flips the audio session on older iOS.
 */

let context: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

function ensureContext(): AudioContext | null {
  if (context) return context;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  context = new Ctor();
  master = context.createGain();
  master.gain.value = 1;
  master.connect(context.destination);
  return context;
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
  context?.close().catch(() => {});
  context = null;
  master = null;
  unlocked = false;
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

/** Settings → "Coba suara". Unlocks first, since it is itself a user gesture. */
export async function previewSound(
  which: "tick" | "bell",
  volume: number,
): Promise<void> {
  primeAudio();
  await unlockAudio();
  if (which === "tick") playTick(volume);
  else playBell(volume);
}
