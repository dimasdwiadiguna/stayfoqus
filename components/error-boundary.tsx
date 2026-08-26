"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { id } from "@/lib/i18n/id";

interface State {
  error: Error | null;
}

/**
 * Top-level boundary. A crash in one screen must not take down the shell's
 * ability to reload, so the fallback is deliberately dependency-free.
 */
export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[foqus] unhandled render error", error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-dvh place-items-center px-8 text-center">
        <div className="max-w-sm space-y-4">
          <h1 className="text-base font-semibold">{id.common.somethingWrong}</h1>
          <p className="font-mono text-[12px] break-words text-fg-subtle">
            {this.state.error.message}
          </p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => this.setState({ error: null })}>
              {id.common.retry}
            </Button>
            <Button variant="primary" onClick={() => location.reload()}>
              {id.common.reload}
            </Button>
          </div>
        </div>
      </main>
    );
  }
}
