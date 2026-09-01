/**
 * The scheduling core (§5).
 *
 * Pure and framework-free: no React, no Dexie, no ambient clock. Every rule the
 * app enforces about time lives here and is imported by the UI — never
 * reimplemented inside a component (§13).
 */

export * from "@/lib/scheduling/types";
export * from "@/lib/scheduling/intervals";
export * from "@/lib/scheduling/buffers";
export * from "@/lib/scheduling/availability";
export * from "@/lib/scheduling/prayer";
export * from "@/lib/scheduling/freespace";
export * from "@/lib/scheduling/session";
export * from "@/lib/scheduling/timeblocks";
export * from "@/lib/scheduling/placement";
export * from "@/lib/scheduling/avoid";
export * from "@/lib/scheduling/allocate";
export * from "@/lib/scheduling/chain";
export * from "@/lib/scheduling/upnext";
export * from "@/lib/scheduling/context";
