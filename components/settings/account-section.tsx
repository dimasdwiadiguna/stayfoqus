"use client";

import * as React from "react";

import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useSettings, updateSettings } from "@/hooks/use-settings";
import { id as t } from "@/lib/i18n/id";
import { refreshGoogleCalendar } from "@/lib/gcal/engine";
import { getSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

interface GcalStatus {
  configured: boolean;
  signed_in: boolean;
  connected: boolean;
}

/** §7.5 — Akun & Google Calendar. */
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

  const supabaseReady = isSupabaseConfigured();

  return (
    <Section title={t.settings.sectionAccount} blurb={t.settings.gcalBlurb}>
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
              onClick={() => void getSupabase()?.auth.signOut().then(() => location.reload())}
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
        <>
          <Row
            label={t.settings.gcalConnected("FOQUS")}
            hint={settings.gcal_calendar_id ?? undefined}
            control={
              <Button
                size="sm"
                onClick={() =>
                  void (async () => {
                    await fetch("/api/gcal/status", { method: "DELETE" });
                    await updateSettings({
                      gcal_calendar_id: null,
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
          <Button
            block
            onClick={() =>
              void refreshGoogleCalendar().then(() => toast.success(t.sync.synced))
            }
          >
            {t.settings.gcalSyncNow}
          </Button>
        </>
      ) : status?.signed_in && status.configured ? (
        <Button variant="primary" block asChild>
          <a href="/api/gcal/connect?return_to=/settings">
            {t.settings.gcalConnect}
          </a>
        </Button>
      ) : (
        <p className="text-[13px] text-fg-subtle">{t.settings.gcalNotConnected}</p>
      )}
    </Section>
  );
}
