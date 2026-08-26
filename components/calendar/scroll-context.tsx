"use client";

import * as React from "react";

/**
 * The timeline's scroll pane, shared with the agenda blocks inside it.
 *
 * A block claims the touch gesture outright (`touch-action: none`) so a drag
 * can never be stolen by the browser's scroller. The cost is that a swipe that
 * *starts* on a block would otherwise not scroll at all — so the block hands
 * that movement back through this ref instead. See `agenda-block.tsx`.
 */
export const TimelineScrollContext =
  React.createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export function useTimelineScroll() {
  return React.useContext(TimelineScrollContext);
}
