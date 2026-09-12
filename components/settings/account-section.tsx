"use client";

import * as React from "react";

import { GcalSection } from "@/components/settings/gcal-section";
import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { updateSettings, useSettings } from "@/hooks/use-settings";
import { id as t } from "@/lib/i18n/id";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

interface GcalStatus {
  configured: boolean;
  signed_in: boolean;
  connected: boolean;
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

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const supabase = getSupabase();
      if (supabase) {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setEmail(data.user?.email ?? null);
      }
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
    if (!status?.connected || settings.gcal_calendar_id) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/gcal/status", { method: "POST" });
        if (!res.ok) return;
        const json = (await res.json()) as {
          calendar_id: string;
          calendar_name: string;
        };
        if (cancelled) return;
        await updateSettings({
          gcal_calendar_id: json.calendar_id,
          gcal_calendar_name: json.calendar_name,
        });
      } catch {
        // Offline, or Google unreachable. The picker still works later.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status?.connected, settings.gcal_calendar_id]);

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
            <Button
              variant="primary"
              block
              onClick={() =>
                void getSupabase()?.auth.signInWithOAuth({
                  provider: "google",
                  options: { redirectTo: `${location.origin}/settings` },
                })
              }
            >
              {t.auth.signIn}
            </Button>
          </div>
        )}

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

      <GcalSection connected={status?.connected === true} />
    </>
  );
}
