"use client";

import { Lock } from "lucide-react";
import * as React from "react";

import { Section } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { id as t } from "@/lib/i18n/id";

/**
 * The access gate, from the inside.
 *
 * There is nothing here to configure: the password is a deployment secret
 * (`FOQUS_ACCESS_PASSWORD`), not a preference, so this section exists to say
 * whether the deployment is protected and to hand the device back its lock.
 */
export function AccessSection() {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/gate");
        const json = (await res.json()) as { enabled: boolean };
        if (!cancelled) setEnabled(json.enabled);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (enabled === null) return null;

  return (
    <Section title={t.gate.sectionTitle} collapsible storageKey="access">
      {enabled ? (
        <>
          <p className="text-[11px] leading-relaxed text-fg-subtle">
            {t.gate.lockBlurb}
          </p>
          <Button
            block
            onClick={() =>
              void fetch("/api/gate", { method: "DELETE" }).then(() => {
                // A full navigation rather than a router push: the middleware
                // has to re-evaluate the cleared cookie, and the app shell —
                // Dexie, the sync engine, a running timer — should be torn down
                // rather than left mounted behind the door. `replace`, so
                // Settings is not one back-gesture away from the lock.
                window.location.replace("/gate");
              })
            }
          >
            <Lock aria-hidden />
            {t.gate.lockNow}
          </Button>
        </>
      ) : (
        <p className="text-[13px] text-fg-muted">{t.gate.disabled}</p>
      )}
    </Section>
  );
}
