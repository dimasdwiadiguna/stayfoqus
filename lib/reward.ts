"use client";

/**
 * §9 — the reward layer.
 *
 * The rule the brief sets is scarcity: confetti fires only for a completion
 * that took real work, everything else stays crisp and quiet. All of it is
 * gated on `prefers-reduced-motion`.
 */

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Short haptic tap where supported. Silently absent on iOS Safari. */
export function haptic(pattern: number | number[] = 12): void {
  if (typeof navigator === "undefined") return;
  if (prefersReducedMotion()) return;
  navigator.vibrate?.(pattern);
}

export type CelebrationKind = "todo-with-subtasks" | "day-cleared";

/**
 * §9: confetti fires only for completing a todo that has subtasks, or clearing
 * every agenda for the day. `canvas-confetti` is imported lazily so its canvas
 * code never lands in the initial bundle.
 */
export async function celebrate(kind: CelebrationKind): Promise<void> {
  if (prefersReducedMotion()) return;

  const { default: confetti } = await import("canvas-confetti");

  if (kind === "day-cleared") {
    const shoot = (originX: number) =>
      confetti({
        particleCount: 60,
        spread: 70,
        startVelocity: 42,
        origin: { x: originX, y: 0.7 },
        colors: ["#7c9cff", "#43c98a", "#f0b429", "#c084fc"],
        disableForReducedMotion: true,
      });
    void shoot(0.2);
    setTimeout(() => void shoot(0.8), 140);
    return;
  }

  void confetti({
    particleCount: 44,
    spread: 58,
    startVelocity: 34,
    origin: { y: 0.72 },
    colors: ["#7c9cff", "#43c98a", "#f0b429"],
    disableForReducedMotion: true,
  });
}

/**
 * In-app notification for pomodoro/break completion (§10).
 * Phase 1 is explicitly local notifications only — no push infrastructure.
 */
export async function notifyLocal(title: string, body?: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "denied") return;
  if (Notification.permission === "default") {
    const granted = await Notification.requestPermission();
    if (granted !== "granted") return;
  }
  try {
    new Notification(title, { body, icon: "/icons/icon-192.png", silent: true });
  } catch {
    // Some browsers only allow notifications from a service worker context.
  }
}
