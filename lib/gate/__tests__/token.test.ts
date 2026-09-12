import { describe, expect, it } from "vitest";

import {
  SESSION_MS,
  constantTimeEqual,
  passwordMatches,
  signToken,
  verifyToken,
} from "@/lib/gate/token";

const PASSWORD = "kucing-oranye-2026";

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("passwordMatches", () => {
  it("accepts the password and nothing else", async () => {
    expect(await passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(await passwordMatches(PASSWORD, "kucing-oranye-2025")).toBe(false);
    expect(await passwordMatches(PASSWORD, "")).toBe(false);
    // A prefix of the real password must not pass.
    expect(await passwordMatches(PASSWORD, "kucing")).toBe(false);
  });
});

describe("token", () => {
  it("round-trips a freshly issued token", async () => {
    const now = Date.UTC(2026, 8, 12, 7, 0, 0);
    const token = await signToken(PASSWORD, now);
    expect(await verifyToken(PASSWORD, token, now + 1000)).toBe(true);
  });

  it("expires exactly at the session boundary", async () => {
    const now = Date.UTC(2026, 8, 12, 7, 0, 0);
    const token = await signToken(PASSWORD, now);
    expect(await verifyToken(PASSWORD, token, now + SESSION_MS - 1)).toBe(true);
    expect(await verifyToken(PASSWORD, token, now + SESSION_MS)).toBe(false);
  });

  it("rejects a token signed with a different password", async () => {
    const now = Date.now();
    const token = await signToken(PASSWORD, now);
    // Rotating the password is what revokes every open session.
    expect(await verifyToken("password-baru", token, now)).toBe(false);
  });

  it("rejects a forged expiry", async () => {
    const now = Date.now();
    const token = await signToken(PASSWORD, now);
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${now + 10 * SESSION_MS}.${signature}`;
    expect(await verifyToken(PASSWORD, forged, now)).toBe(false);
  });

  it("rejects malformed input", async () => {
    const now = Date.now();
    expect(await verifyToken(PASSWORD, undefined, now)).toBe(false);
    expect(await verifyToken(PASSWORD, "", now)).toBe(false);
    expect(await verifyToken(PASSWORD, "nonsense", now)).toBe(false);
    expect(await verifyToken(PASSWORD, ".sig", now)).toBe(false);
    expect(await verifyToken(PASSWORD, `${now + 1000}.`, now)).toBe(false);
  });
});
