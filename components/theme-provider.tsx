"use client";

import * as React from "react";

import { useSettings } from "@/hooks/use-settings";

/**
 * Applies `settings.theme` to <html>. The document ships with `class="dark"`
 * already set so the first paint is never light — 'system' and 'light' are
 * resolved here, after IndexedDB answers.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const settings = useSettings();
  const preference = settings.theme;

  React.useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const dark =
        preference === "dark" ||
        (preference === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
    };

    apply();
    if (preference !== "system") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);

  return <>{children}</>;
}
