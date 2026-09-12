"use client";

import { Button } from "@/components/ui/button";
import { linkify } from "@/lib/gcal/linkify";
import { id as t } from "@/lib/i18n/id";
import { cn } from "@/lib/utils";

/**
 * An upstream error, shown as the upstream wrote it.
 *
 * Two things make the difference between a wall of text and a fix: Google's
 * most useful messages name the console page that resolves them, so any URL is
 * made tappable; and the failure is usually transient once that page has been
 * visited, so there is a retry rather than "reload the app".
 */
export function ErrorNote({
  message,
  tone = "danger",
  onRetry,
  retrying = false,
}: {
  message: string;
  tone?: "danger" | "warning";
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "space-y-2 rounded-lg border px-3 py-2",
        tone === "danger"
          ? "border-danger/40 bg-danger/10"
          : "border-warning/40 bg-surface-2",
      )}
    >
      <p
        className={cn(
          "font-mono text-[11px] leading-relaxed break-words",
          tone === "danger" ? "text-danger" : "text-warning",
        )}
      >
        {linkify(message).map((segment, index) =>
          segment.kind === "link" ? (
            <a
              key={index}
              href={segment.value}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
            >
              {segment.value}
            </a>
          ) : (
            <span key={index}>{segment.value}</span>
          ),
        )}
      </p>

      {onRetry ? (
        <Button size="sm" block disabled={retrying} onClick={onRetry}>
          {retrying ? t.common.loading : t.common.retry}
        </Button>
      ) : null}
    </div>
  );
}
