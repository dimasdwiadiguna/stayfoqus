"use client";

import * as React from "react";

import { ErrorNote } from "@/components/settings/error-note";
import { GcalSection } from "@/components/settings/gcal-section";
import { Row, Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
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
  /** The exact redirect_uri this deployment sends to Google. */
  redirect_uri?: string | null;
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
  // Bumped by the retry button. The setup effect keys off it, so enabling the
  // Calendar API in the console is followed by one tap rather than a reload.
  const [setupAttempt, setSetupAttempt] = React.useState(0);
  /*
   * Owned by the tap, not by the effect (D-071): the button sets it, the
   * request clears it. The *first* attempt is automatic and is not a retry, so
   * it deliberately leaves this alone.
   */
  const [retrying, setRetrying] = React.useState(false);
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
      } finally {
        if (!cancelled) setRetrying(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status?.connected, status?.scopes_ok, settings.gcal_calendar_id, setupAttempt]);

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

            {signInError ? <ErrorNote message={signInError} /> : null}

            <SignInChecklist />
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
          <ErrorNote
            message={setupError}
            retrying={retrying}
            onRetry={() => {
              setSetupError(null);
              setRetrying(true);
              setSetupAttempt((n) => n + 1);
            }}
          />
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
          <>
            <Button variant="primary" block asChild>
              <a href="/api/gcal/connect?return_to=/settings">
                {t.settings.gcalConnect}
              </a>
            </Button>
            <RedirectUriHelp redirectUri={status.redirect_uri ?? null} />
          </>
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

/**
 * What Supabase has to know about *this* origin before sign-in can come back.
 *
 * A new project ships with Site URL set to `http://localhost:3000`, and GoTrue
 * falls back to it whenever the `redirectTo` it is handed is not on the
 * Redirect URLs allow list. The OAuth round trip therefore succeeds — Google
 * authenticates, the code is issued — and then the browser is sent to
 * `localhost`, where a phone has nothing listening. Nothing in the app is
 * wrong, and nothing in the app can detect it either: GoTrue publishes which
 * providers are enabled, but not its Site URL or its allow list.
 *
 * So this states the requirement instead, with the origin already filled in —
 * the one fact the user would otherwise have to assemble by hand, on a phone,
 * from a page of documentation.
 */
function SignInChecklist() {
  // `location` is read in render rather than from an effect (D-071): nothing
  // here is server-rendered, because `BootGate` holds the shell until IndexedDB
  // is ready on the client.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Disclosure label={t.auth.redirectHelpTitle} contentClassName="space-y-1.5 pb-1">
      <p className="text-[11px] leading-relaxed text-fg-subtle">
        {t.auth.redirectHelpBlurb}
      </p>
      <dl className="space-y-1.5">
        <div>
          <dt className="text-[11px] text-fg-muted">{t.auth.redirectSiteUrl}</dt>
          <dd className="font-mono text-[11px] break-all text-fg">{origin}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-fg-muted">{t.auth.redirectAllowList}</dt>
          {/* In one string: bare `/**` after an expression reads as a comment in JSX. */}
          <dd className="font-mono text-[11px] break-all text-fg">{`${origin}/**`}</dd>
        </div>
      </dl>
    </Disclosure>
  );
}

/**
 * The one string Google has to recognise, and the one case the app can check.
 *
 * `Error 400: redirect_uri_mismatch` has two causes and they look identical
 * from the error page. Either the URI was never added to the OAuth client — the
 * same client already carries Supabase's sign-in callback, and the two are
 * unrelated, so having one is no evidence of the other — or
 * `NEXT_PUBLIC_SITE_URL` names a different origin than the app is being served
 * from, and the URI being sent is not the one anybody would think to register.
 *
 * The second is genuinely detectable, so it is stated as a warning rather than
 * as a fold: the app can see both origins and knows they disagree. The first is
 * not, so it gets the same treatment as the Supabase allow list — the exact
 * value, ready to copy, and no claim that anything is wrong.
 */
function RedirectUriHelp({ redirectUri }: { redirectUri: string | null }) {
  if (!redirectUri) return null;

  // Read in render rather than from an effect (D-071): nothing here is
  // server-rendered, because BootGate holds the shell until the client is ready.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  let mismatched = false;
  try {
    mismatched = origin.length > 0 && new URL(redirectUri).origin !== origin;
  } catch {
    // An unparseable value is a misconfiguration of its own, and showing it
    // verbatim below says more than any guess this could make.
  }

  return (
    <>
      {mismatched ? (
        <p className="rounded-lg border border-warning/40 bg-surface-2 px-3 py-2.5 text-[13px] text-warning">
          {t.settings.gcalOriginMismatch(origin)}
        </p>
      ) : null}

      <Disclosure
        label={t.settings.gcalRedirectHelpTitle}
        defaultOpen={mismatched}
        contentClassName="space-y-1.5 pb-1"
      >
        <p className="text-[11px] leading-relaxed text-fg-subtle">
          {t.settings.gcalRedirectHelpBlurb}
        </p>
        <p className="font-mono text-[11px] break-all text-fg">{redirectUri}</p>
      </Disclosure>
    </>
  );
}
