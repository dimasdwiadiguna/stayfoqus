import { describe, expect, it } from "vitest";

import { googleEnabledFrom } from "@/lib/supabase/auth-settings";

/*
 * The failure this guards: clicking "Masuk dengan Google" navigated straight to
 * GoTrue and came back as raw JSON — "Unsupported provider: provider is not
 * enabled" — because the provider was off in the Supabase dashboard and nothing
 * had asked beforehand.
 */
describe("reading GoTrue's settings document", () => {
  it("sees an enabled Google provider", () => {
    expect(
      googleEnabledFrom({
        disable_signup: false,
        mailer_autoconfirm: false,
        external: { email: true, google: true, github: false },
      }),
    ).toBe(true);
  });

  it("sees a disabled one", () => {
    expect(googleEnabledFrom({ external: { email: true, google: false } })).toBe(
      false,
    );
  });

  it("treats an absent provider as disabled", () => {
    expect(googleEnabledFrom({ external: { email: true } })).toBe(false);
  });

  /*
   * Anything unexpected reads as "not enabled" rather than throwing: the caller
   * only uses this to decide whether to warn, and a warning that turns out to be
   * unnecessary is cheaper than a crash in Settings.
   */
  it("does not throw on a shape it did not expect", () => {
    for (const payload of [null, undefined, "", 42, {}, { external: null }, { external: "yes" }]) {
      expect(googleEnabledFrom(payload)).toBe(false);
    }
  });
});
