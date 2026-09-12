import { describe, expect, it } from "vitest";

import {
  GOOGLE_SCOPES,
  describeGoogleError,
  missingScopesFrom,
} from "@/lib/gcal/scopes";

const CALENDARS = "https://www.googleapis.com/auth/calendar.calendars";
const EVENTS = "https://www.googleapis.com/auth/calendar.events";
const READONLY = "https://www.googleapis.com/auth/calendar.readonly";

describe("the scopes FOQUS asks Google for", () => {
  /*
   * The regression this pins. §6.1 names only `calendar.events` and
   * `calendar.readonly`; Google's discovery document says `calendars.insert`
   * accepts none of them, so creating the FOQUS calendar 403'd on first connect.
   */
  it("includes the one that permits creating a calendar", () => {
    expect(GOOGLE_SCOPES).toContain(CALENDARS);
  });

  it("keeps the two the brief names", () => {
    expect(GOOGLE_SCOPES).toContain(EVENTS);
    expect(GOOGLE_SCOPES).toContain(READONLY);
  });

  it("does not reach for the broad calendar scope", () => {
    expect(GOOGLE_SCOPES).not.toContain("https://www.googleapis.com/auth/calendar");
  });
});

describe("missingScopesFrom", () => {
  it("is satisfied by the full grant, in any order", () => {
    expect(missingScopesFrom([READONLY, CALENDARS, EVENTS].join(" "))).toEqual([]);
  });

  it("names what an older connection is short of", () => {
    // Exactly the token an existing user holds: consented before the fix.
    expect(missingScopesFrom(`${EVENTS} ${READONLY}`)).toEqual([CALENDARS]);
  });

  it("ignores extra scopes Google threw in", () => {
    const extra = "openid email https://www.googleapis.com/auth/userinfo.profile";
    expect(missingScopesFrom(`${extra} ${CALENDARS} ${EVENTS} ${READONLY}`)).toEqual([]);
  });

  /*
   * Unknown is treated as incomplete on purpose: a token stored before scopes
   * were recorded would otherwise pass here and fail with a 403 mid-sync.
   */
  it("treats an absent grant as incomplete rather than complete", () => {
    expect(missingScopesFrom(null)).toEqual([...GOOGLE_SCOPES]);
    expect(missingScopesFrom("")).toEqual([...GOOGLE_SCOPES]);
    expect(missingScopesFrom("   ")).toEqual([...GOOGLE_SCOPES]);
  });
});

describe("describeGoogleError", () => {
  it("digs out the sentence from Google's API envelope", () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: "Request had insufficient authentication scopes.",
        errors: [{ message: "Insufficient Permission", reason: "insufficientPermissions" }],
        status: "PERMISSION_DENIED",
      },
    });
    expect(describeGoogleError(new Error(body))).toBe(
      "Request had insufficient authentication scopes.",
    );
  });

  it("falls back to the nested errors array", () => {
    const body = JSON.stringify({ error: { errors: [{ message: "Not Found" }] } });
    expect(describeGoogleError(new Error(body))).toBe("Not Found");
  });

  it("handles the OAuth token endpoint's flatter shape", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    expect(describeGoogleError(new Error(body))).toBe(
      "Token has been expired or revoked.",
    );
  });

  it("passes plain text through, truncated", () => {
    expect(describeGoogleError(new Error("Service Unavailable"))).toBe(
      "Service Unavailable",
    );
    expect(describeGoogleError(new Error("x".repeat(500)))).toHaveLength(300);
  });
});
