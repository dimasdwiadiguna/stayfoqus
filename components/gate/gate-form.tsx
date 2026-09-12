"use client";

import { Lock } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { id as t } from "@/lib/i18n/id";

type State = "idle" | "checking" | "wrong" | "throttled" | "failed";

/**
 * The door. Deliberately the only thing on the page: no navigation, no app
 * shell, nothing that reads the database — the session cookie is set by the
 * server before any of that mounts.
 */
export function GateForm({ next }: { next: string }) {
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<State>("idle");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state === "checking" || password.length === 0) return;
    setState("checking");

    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // A full navigation, not a router push: the middleware has to see the
        // new cookie, and the app shell has never been mounted on this page.
        window.location.replace(next);
        return;
      }

      setState(res.status === 429 ? "throttled" : "wrong");
      setPassword("");
    } catch {
      setState("failed");
    }
  }

  const message =
    state === "wrong"
      ? t.gate.wrong
      : state === "throttled"
        ? t.gate.throttled
        : state === "failed"
          ? t.gate.failed
          : null;

  return (
    <form onSubmit={submit} className="w-full max-w-xs space-y-4">
      <div className="space-y-1.5 text-center">
        <Lock aria-hidden className="mx-auto size-5 text-fg-subtle" />
        <h1 className="text-lg font-semibold">{t.app.name}</h1>
        <p className="text-[13px] text-fg-muted">{t.gate.blurb}</p>
      </div>

      <Input
        type="password"
        // `current-password` lets a password manager offer the saved entry;
        // autoFocus because there is nothing else on the page to do.
        autoComplete="current-password"
        autoFocus
        inputMode="text"
        aria-label={t.gate.password}
        aria-invalid={state === "wrong"}
        placeholder={t.gate.password}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          if (state !== "checking") setState("idle");
        }}
      />

      <Button
        type="submit"
        variant="primary"
        block
        disabled={state === "checking" || password.length === 0}
      >
        {state === "checking" ? t.gate.checking : t.gate.unlock}
      </Button>

      {message ? (
        <p role="alert" className="text-center text-[13px] text-danger">
          {message}
        </p>
      ) : null}
    </form>
  );
}
