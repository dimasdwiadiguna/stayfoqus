import { redirect } from "next/navigation";

import { GateForm } from "@/components/gate/gate-form";
import { gateEnabled } from "@/lib/gate/config";
import { id as t } from "@/lib/i18n/id";

export const dynamic = "force-dynamic";

export const metadata = { title: t.gate.title };

/**
 * Rendered outside the app shell — see `app/(app)/layout.tsx`, which is where
 * the database boot now lives. Nothing here touches IndexedDB.
 */
export default async function GatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // With no password configured there is no door to stand in front of.
  if (!gateEnabled()) redirect("/tasks");

  const { next } = await searchParams;

  // Only same-origin, absolute-path destinations: a `next` of
  // `https://elsewhere.example` would turn the gate into an open redirect.
  const target = next && /^\/(?!\/)/.test(next) ? next : "/tasks";

  return (
    <main className="grid min-h-dvh place-items-center px-8">
      <GateForm next={target} />
    </main>
  );
}
