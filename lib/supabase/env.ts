/**
 * Supabase is optional at runtime.
 *
 * FOQUS is local-first: every feature except cross-device sync and Google
 * Calendar works with IndexedDB alone. Rather than crashing when the project is
 * not configured, the app reports "local-only mode" in Settings → Sinkronisasi
 * and skips the sync engine's network phases entirely.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}
