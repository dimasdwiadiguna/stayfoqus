import { describe, expect, it } from "vitest";

import { linkify } from "@/lib/gcal/linkify";

describe("linkify", () => {
  it("leaves text without a link alone", () => {
    expect(linkify("Request had insufficient authentication scopes.")).toEqual([
      { kind: "text", value: "Request had insufficient authentication scopes." },
    ]);
  });

  /* The real message, verbatim from the device. */
  it("pulls the console URL out of Google's 'API not enabled' message", () => {
    const message =
      "Google Calendar API has not been used in project 324902327139 before or " +
      "it is disabled. Enable it by visiting " +
      "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=324902327139" +
      " then retry.";

    const segments = linkify(message);
    expect(segments).toHaveLength(3);
    expect(segments[1]).toEqual({
      kind: "link",
      value:
        "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=324902327139",
    });
    expect(segments[2]).toEqual({ kind: "text", value: " then retry." });
    // Nothing is lost: the pieces still rebuild the original.
    expect(segments.map((s) => s.value).join("")).toBe(message);
  });

  it("gives trailing punctuation back to the sentence", () => {
    expect(linkify("See https://example.com/docs.")).toEqual([
      { kind: "text", value: "See " },
      { kind: "link", value: "https://example.com/docs" },
      { kind: "text", value: "." },
    ]);
    expect(linkify("(https://example.com/a)")).toEqual([
      { kind: "text", value: "(" },
      { kind: "link", value: "https://example.com/a" },
      { kind: "text", value: ")" },
    ]);
  });

  it("handles several links", () => {
    const segments = linkify("a https://one.example b https://two.example c");
    expect(segments.filter((s) => s.kind === "link").map((s) => s.value)).toEqual([
      "https://one.example",
      "https://two.example",
    ]);
  });

  /*
   * Only https. A plain-text `http://` or a bare hostname in an error body is
   * not worth turning into something tappable.
   */
  it("ignores http and bare hostnames", () => {
    expect(linkify("go to http://example.com or example.com")).toEqual([
      { kind: "text", value: "go to http://example.com or example.com" },
    ]);
  });

  it("does not produce an empty link from punctuation alone", () => {
    const segments = linkify("https://.");
    expect(segments.map((s) => s.value).join("")).toBe("https://.");
  });
});
