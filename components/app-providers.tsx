"use client";

import * as React from "react";

import { AppErrorBoundary } from "@/components/error-boundary";
import { ServiceWorkerRegistrar } from "@/components/service-worker";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { BootGate } from "@/components/boot-gate";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AppErrorBoundary>
        <BootGate>{children}</BootGate>
      </AppErrorBoundary>
      <Toaster />
      <ServiceWorkerRegistrar />
    </ThemeProvider>
  );
}
