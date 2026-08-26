"use client";

import * as React from "react";

import {
  FocusOverlay,
  usePomodoroSettingsSync,
} from "@/components/focus/focus-overlay";
import { FocusPill } from "@/components/focus/focus-pill";
import { startPomodoroEngine } from "@/lib/pomodoro/store";

/**
 * Mounts the timer engine once, above the tab router, so a running session
 * survives navigation between tabs (§7.4).
 */
export function FocusLayer() {
  usePomodoroSettingsSync();

  React.useEffect(() => startPomodoroEngine(), []);

  return (
    <>
      <FocusOverlay />
      <FocusPill />
    </>
  );
}
