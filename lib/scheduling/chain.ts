import type { Agenda, UUID } from "@/lib/db/schema";
import { requiredGapMin } from "@/lib/scheduling/buffers";
import type { BufferSide } from "@/lib/scheduling/types";

/**
 * "Immediately after" — an agenda pinned to a predecessor rather than a clock.
 *
 * Not in the brief. §5.2 gives the *rule* for the gap between two agendas but
 * assumes both own their start time; move the first and the second stays put,
 * so a deliberately back-to-back pair silently drifts apart. The link makes the
 * relationship the stored fact and the start time the derived one.
 *
 * Where the gap comes from: the successor starts at the predecessor's end plus
 * §5.2's composed `required_gap`. That is the same rule the free-space map and
 * the allocator already use, so a chained pair cannot end up closer together
 * than a pair the scheduler would have produced. Whenever the successor asks
 * for no more than the predecessor already reserves, it reduces exactly to
 * "the end of the previous agenda's buffer".
 *
 * Pure: takes rows, returns the moves to apply.
 */

const MINUTE = 60_000;

function sideBefore(agenda: Agenda): BufferSide {
  return { min: agenda.buffer_before_min, type: agenda.buffer_before_type };
}

function sideAfter(agenda: Agenda): BufferSide {
  return { min: agenda.buffer_after_min, type: agenda.buffer_after_type };
}

/** The instant `successor` must start at, given where `predecessor` ends. */
export function chainedStart(
  predecessor: Pick<
    Agenda,
    "end_at" | "buffer_after_min" | "buffer_after_type"
  >,
  successor: Pick<Agenda, "buffer_before_min" | "buffer_before_type">,
): number {
  const gap = requiredGapMin(
    {
      min: predecessor.buffer_after_min,
      type: predecessor.buffer_after_type,
    },
    {
      min: successor.buffer_before_min,
      type: successor.buffer_before_type,
    },
  );
  return new Date(predecessor.end_at).getTime() + gap * MINUTE;
}

export interface ChainMove {
  id: UUID;
  start_at: string;
  end_at: string;
}

/** A link that could not be honoured, and why. */
export interface ChainProblem {
  id: UUID;
  reason: "missing" | "cycle" | "self";
}

export interface ChainResult {
  moves: ChainMove[];
  problems: ChainProblem[];
}

/**
 * Recomputes every follower's start time, transitively.
 *
 * A chain is walked from each root (an agenda that follows nothing) outward, so
 * a three-deep chain settles in one pass and in the right order. Anything not
 * reachable from a root is, by definition, part of a cycle — reported rather
 * than moved, because there is no correct answer for it and looping would hang
 * the UI.
 *
 * Each agenda keeps its own duration; only its position moves.
 */
export function resolveChains(agendas: readonly Agenda[]): ChainResult {
  const live = agendas.filter(
    (a) => !a.deleted_at && a.status !== "cancelled",
  );
  const byId = new Map(live.map((a) => [a.id, a]));

  const followersOf = new Map<UUID, Agenda[]>();
  const problems: ChainProblem[] = [];
  const linked = new Set<UUID>();

  for (const agenda of live) {
    const target = agenda.follows_agenda_id;
    if (!target) continue;

    if (target === agenda.id) {
      problems.push({ id: agenda.id, reason: "self" });
      continue;
    }
    if (!byId.has(target)) {
      // The predecessor was deleted, or has not been pulled yet. Left where it
      // is rather than guessed at; `repairDanglingLinks` clears it once the
      // absence is known to be permanent.
      problems.push({ id: agenda.id, reason: "missing" });
      continue;
    }

    linked.add(agenda.id);
    const bucket = followersOf.get(target);
    if (bucket) bucket.push(agenda);
    else followersOf.set(target, [agenda]);
  }

  // Deterministic order when two agendas follow the same predecessor.
  for (const bucket of followersOf.values()) {
    bucket.sort((a, b) => a.start_at.localeCompare(b.start_at) || (a.id < b.id ? -1 : 1));
  }

  const moves: ChainMove[] = [];
  const settled = new Map<UUID, { start: number; end: number }>();
  const visited = new Set<UUID>();

  const roots = live.filter((a) => !linked.has(a.id));

  const walk = (agenda: Agenda) => {
    visited.add(agenda.id);
    const current = settled.get(agenda.id) ?? {
      start: new Date(agenda.start_at).getTime(),
      end: new Date(agenda.end_at).getTime(),
    };

    for (const follower of followersOf.get(agenda.id) ?? []) {
      if (visited.has(follower.id)) continue;

      const gap =
        requiredGapMin(sideAfter(agenda), sideBefore(follower)) * MINUTE;
      const start = current.end + gap;
      const duration =
        new Date(follower.end_at).getTime() -
        new Date(follower.start_at).getTime();
      const end = start + duration;

      settled.set(follower.id, { start, end });
      if (start !== new Date(follower.start_at).getTime()) {
        moves.push({
          id: follower.id,
          start_at: new Date(start).toISOString(),
          end_at: new Date(end).toISOString(),
        });
      }
      walk({
        ...follower,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
      });
    }
  };

  for (const root of roots) walk(root);

  // Anything linked but never reached sits in a cycle.
  for (const agenda of live) {
    if (linked.has(agenda.id) && !visited.has(agenda.id)) {
      problems.push({ id: agenda.id, reason: "cycle" });
    }
  }

  return { moves, problems };
}

/**
 * Would linking `followerId` to `targetId` create a cycle?
 *
 * Checked before the link is stored, so `resolveChains` never has to recover
 * from one in normal use.
 */
export function wouldCycle(
  agendas: readonly Agenda[],
  followerId: UUID,
  targetId: UUID,
): boolean {
  if (followerId === targetId) return true;

  const byId = new Map(agendas.map((a) => [a.id, a]));
  const seen = new Set<UUID>([followerId]);

  let cursor: UUID | null = targetId;
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.follows_agenda_id ?? null;
  }
  return false;
}

/**
 * Agendas whose predecessor no longer exists. Their link is cleared so they
 * become ordinary time-pinned agendas rather than staying quietly broken.
 */
export function danglingLinks(agendas: readonly Agenda[]): UUID[] {
  const live = new Set(
    agendas.filter((a) => !a.deleted_at).map((a) => a.id),
  );
  return agendas
    .filter(
      (a) =>
        !a.deleted_at &&
        a.follows_agenda_id !== null &&
        !live.has(a.follows_agenda_id),
    )
    .map((a) => a.id);
}

/**
 * The agenda a new block would naturally attach to: the one whose buffer ends
 * exactly where this block would begin, within a small tolerance.
 *
 * This is what makes the offer feel earned rather than arbitrary — it appears
 * when the user has actually butted the two together, not merely placed them
 * on the same day.
 */
export function abuttingPredecessor(
  agendas: readonly Agenda[],
  candidate: { start: number; bufferBefore: BufferSide },
  toleranceMin = 6,
): Agenda | null {
  const tolerance = toleranceMin * MINUTE;
  let best: { agenda: Agenda; distance: number } | null = null;

  for (const agenda of agendas) {
    if (agenda.deleted_at || agenda.status === "cancelled") continue;

    const gap = requiredGapMin(sideAfter(agenda), candidate.bufferBefore) * MINUTE;
    const wouldStartAt = new Date(agenda.end_at).getTime() + gap;
    const distance = Math.abs(candidate.start - wouldStartAt);

    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { agenda, distance };
    }
  }

  return best?.agenda ?? null;
}

/** A predecessor a dragged block could pin itself to, and where that puts it. */
export interface LinkCandidate {
  predecessor: Agenda;
  /** The instant the block would start at once linked. */
  start: number;
}

/**
 * The predecessor a block being dragged is currently reaching for.
 *
 * The same idea as `abuttingPredecessor`, but for a live gesture rather than a
 * settled placement, which changes three things:
 *
 * - **A wider tolerance.** This is the cue shown *while approaching*, not a
 *   test of where something came to rest. 15 minutes is ~22 px at the timeline's
 *   1.5 px/min, which is about how close a thumb gets before it means it.
 * - **The mover is excluded**, along with anything that would close a loop.
 *   `linkImmediatelyAfter` refuses a cycle, so offering one would be a promise
 *   the drop could not keep — the green line must never lie.
 * - **It returns the resolved start**, so the caller can snap the preview onto
 *   it. Releasing where the line appears then produces exactly the placement the
 *   line described.
 *
 * The gap itself still comes from `chainedStart`, i.e. §5.2's composed
 * `required_gap` — one rule, not a second one that happens to agree.
 */
export function dragLinkCandidate(
  agendas: readonly Agenda[],
  mover: { id: UUID; start: number; bufferBefore: BufferSide },
  toleranceMin = 15,
): LinkCandidate | null {
  const tolerance = toleranceMin * MINUTE;
  let best: LinkCandidate & { distance: number } | null = null;

  for (const agenda of agendas) {
    if (agenda.id === mover.id) continue;
    if (agenda.deleted_at || agenda.status === "cancelled") continue;
    if (wouldCycle(agendas, mover.id, agenda.id)) continue;

    const gap = requiredGapMin(sideAfter(agenda), mover.bufferBefore) * MINUTE;
    const start = new Date(agenda.end_at).getTime() + gap;
    const distance = Math.abs(mover.start - start);

    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { predecessor: agenda, start, distance };
    }
  }

  return best ? { predecessor: best.predecessor, start: best.start } : null;
}
