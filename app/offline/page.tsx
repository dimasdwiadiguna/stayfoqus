import { id } from "@/lib/i18n/id";

export const metadata = { title: id.sync.offline };

/**
 * Precached navigation fallback. Reaching this page means the service worker
 * had no cached document for the requested URL — the app itself works offline.
 */
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-8 text-center">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">{id.app.name}</h1>
        <p className="text-sm text-fg-muted">{id.sync.offline}</p>
        <a href="/tasks" className="inline-block text-sm text-accent underline">
          {id.nav.tasks}
        </a>
      </div>
    </main>
  );
}
