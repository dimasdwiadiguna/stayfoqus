/**
 * Splits text into plain runs and the links inside it.
 *
 * Google's most useful errors carry the fix as a URL in the message — "Enable
 * it by visiting https://console.developers.google.com/…?project=…". Rendered
 * as plain text that is a paragraph to retype by hand, which on a phone is the
 * difference between a two-tap fix and giving up.
 *
 * Deliberately narrow: only `https://`, never `http://` and never a bare
 * hostname. The text comes from an upstream API by way of our own route
 * handler, and the smallest rule that covers the real case is the right one.
 */

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string };

/**
 * Trailing punctuation belongs to the sentence, not the URL — "…retry." and
 * "…(see https://x)" are both common in Google's wording.
 */
const TRAILING = /[.,;:!?)\]}'"]+$/;

const URL_PATTERN = /https:\/\/[^\s<>"']+/g;

export function linkify(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    let url = match[0];

    const trimmed = url.replace(TRAILING, "");
    // Only give the punctuation back if stripping it left a usable URL.
    if (trimmed.length > "https://".length) url = trimmed;

    if (start > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, start) });
    }
    segments.push({ kind: "link", value: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor) });
  }
  return segments;
}
