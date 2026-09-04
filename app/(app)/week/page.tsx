import { redirect } from "next/navigation";

/**
 * The weekly plan is on hold; the day is the planning unit now (D-123).
 *
 * The route stays as a redirect rather than disappearing: a service worker
 * installed before this change still precaches `/week` (D-002), so a user with
 * the PWA on their home screen can reach it once more before the new worker
 * takes over.
 */
export default function WeekPage() {
  redirect("/today");
}
