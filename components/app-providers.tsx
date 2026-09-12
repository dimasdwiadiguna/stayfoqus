"use client";

import * as React from "react";

import { AppErrorBoundary } from "@/components/error-boundary";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {/* `BootGate` deliberately does *not* live here: the access gate at
          /gate renders under this provider too, and it must not open the
          database or start the sync engine before anyone is through the door.
          The boot sequence belongs to the app shell — see app/(app)/layout.tsx. */}
      <AppErrorBoundary>{children}</AppErrorBoundary>
      <Toaster />
      <ServiceWorkerRegistrar />
    </ThemeProvider>
  );
}
