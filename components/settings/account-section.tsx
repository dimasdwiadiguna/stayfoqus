"use client";

import * as React from "react";

import { GcalSection } from "@/components/settings/gcal-section";
import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { id as t } from "@/lib/i18n/id";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { probeAuthProviders, type AuthProbe } from "@/lib/supabase/auth-settings";

interface GcalStatus {
  configured: boolean;
  signed_in: boolean;
  connected: boolean;
  /** False when the stored token predates a scope the app now needs. */
  scopes_ok?: boolean;
}

/**
 * §7.5 — Akun & Google Calendar.
 *
 * This section owns the *connection*: who is signed in, and whether Google has
 * granted a refresh token. Everything about how that connection behaves lives
 * one section down, in `GcalSection`.
 */
export function AccountSection() {
  const settings = useSettings();
  const [email, setEmail] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<GcalStatus | null>(null);
  const [setupError, setSetupError] = React.useState<string | null>(null);
  const [signInError, setSignInError] = React.useState<string | null>(null);
  const [providers, setProviders] = React.useState<AuthProbe | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setEmail(data.user?.email ?? null);
      }
      // Whether the project has the Google provider switched on at all. Asked
      // before the button is offered, because `signInWithOAuth` navigates away
      // and a disabled provider answers with raw JSON the user cannot act on.
      const probe = await probeAuthProviders();
      if (!cancelled) setProviders(probe);

      try {
        // `status` answers 200 even when signed out, so this never logs a 401.
        const res = await fetch("/api/gcal/status");
        const json = (await res.json()) as GcalStatus;
        if (!cancelled) setStatus(json);
      } catch {
        if (!cancelled) {
          setStatus({ configured: false, signed_in: false, connected: false });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * A first connect has a calendar to settle before anything can be written.
   * §6.1's find-or-create runs server-side; the id and name are stored here so
   * the picker has something to show and the write path has a target, without
   * the user having to open the picker at all.
   */
  React.useEffect(() => {
    if (!status?.connected || status.scopes_ok === false) return;
    if (settings.gcal_calendar_id) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/gcal/status", { method: "POST" });
        const json = (await res.json()) as {
          calendar_id?: string;
          calendar_name?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.calendar_id) {
          // Google's own sentence, not a generic failure. This is the path that
          // used to surface an unreadable 403 about missing scopes.
          setSetupError(json.error ?? String(res.status));
          return;
        }
        setSetupError(null);
        await updateSettings({
          gcal_calendar_id: json.calendar_id,
          gcal_calendar_name: json.calendar_name ?? null,
        });
      } catch {
        // Offline, or Google unreachable. The picker still works later.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status?.connected, status?.scopes_ok, settings.gcal_calendar_id]);

  const supabaseReady = isSupabaseConfigured();

  return (
    <>
      <Section title={t.settings.sectionAccount}>
        {!supabaseReady ? (
          <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-fg-muted">
            {t.sync.localOnly}
          </p>
        ) : email ? (
          <Row
            label={t.auth.signedInAs}
            hint={email}
            control={
              <Button
                size="sm"
                onClick={() =>
                  void getSupabase()
                    ?.auth.signOut()
                    .then(() => location.reload())
                }
              >
                {t.auth.signOut}
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] text-fg-muted">{t.auth.signInBlurb}</p>

            {providers?.status === "ok" && !providers.googleEnabled ? (
              <p className="rounded-lg border border-warning/40 bg-surface-2 px-3 py-2.5 text-[13px] text-warning">
                {t.auth.providerDisabled}
              </p>
            ) : null}

            <Button
              variant="primary"
              block
              // Offering a button whose only outcome is a page of JSON is worse
              // than not offering it. An unreachable probe still lets the user
              // try — being unable to ask is not evidence of a problem.
              disabled={providers?.status === "ok" && !providers.googleEnabled}
              onClick={() =>
                void (async () => {
                  setSignInError(null);
                  const { error } = (await getSupabase()?.auth.signInWithOAuth({
                    provider: "google",
                    options: { redirectTo: `${location.origin}/settings` },
                  })) ?? { error: null };
                  // Reached only when supabase-js refuses before redirecting;
                  // the navigation itself never returns here.
                  if (error) setSignInError(error.message);
                })()
              }
            >
              {t.auth.signIn}
            </Button>

            {signInError ? (
              <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[11px] break-words text-danger">
                {signInError}
              </p>
            ) : null}
          </div>
        )}

        {status?.connected && status.scopes_ok === false ? (
          <div className="space-y-2 rounded-lg border border-warning/40 bg-surface-2 px-3 py-2.5">
            <p className="text-[13px] text-warning">{t.settings.gcalScopesStale}</p>
            <Button variant="primary" block asChild>
              <a href="/api/gcal/connect?return_to=/settings">
                {t.settings.gcalReconnect}
              </a>
            </Button>
          </div>
        ) : null}

        {setupError ? (
          <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-[11px] break-words text-danger">
            {setupError}
          </p>
        ) : null}

        {status?.connected ? (
          <Row
            label={t.settings.gcalConnected}
            hint={settings.gcal_calendar_name ?? undefined}
            control={
              <Button
                size="sm"
                onClick={() =>
                  void (async () => {
                    await fetch("/api/gcal/status", { method: "DELETE" });
                    await updateSettings({
                      gcal_calendar_id: null,
                      gcal_calendar_name: null,
                      gcal_sync_token: null,
                    });
                    setStatus({ ...status, connected: false });
                  })()
                }
              >
                {t.settings.gcalDisconnect}
              </Button>
            }
          />
        ) : status?.signed_in && status.configured ? (
          <Button variant="primary" block asChild>
            <a href="/api/gcal/connect?return_to=/settings">
              {t.settings.gcalConnect}
            </a>
          </Button>
        ) : status && !status.configured ? (
          <p className="text-[13px] text-fg-subtle">{t.settings.gcalNotConfigured}</p>
        ) : (
          <p className="text-[13px] text-fg-subtle">{t.settings.gcalNotConnected}</p>
        )}
      </Section>

      <GcalSection connected={status?.connected === true && status.scopes_ok !== false} />
    </>
  );
}
