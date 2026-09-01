import type { BufferSide, EdgeKind } from "@/lib/scheduling/types";

/**
 * §5.2 — the typed-buffer collision rule.
 *
 *   switch_need  = max( A.after where type == 'switch',
 *                       B.before where type == 'switch' )
 *   commute_need = max( A.after where type == 'commute',
 *                       B.before where type == 'commute' )
 *   required_gap = switch_need + commute_need
 *
 * Within the same type, take the max; across types, sum. Two mental resets
 * overlap in purpose so the larger absorbs the smaller — but you cannot do your
 * mental reset while you are commuting, so those needs stack.
 *
 * Note the rule is symmetric in its two arguments: both `max` and `+` are, so
 * swapping the sides cannot change the result. Callers that hold a neighbour's
 * facing side without knowing whether it precedes or follows may pass either
 * order.
 */
export function requiredGapMin(after: BufferSide, before: BufferSide): number {
  const switchNeed = Math.max(
    after.type === "switch" ? after.min : 0,
    before.type === "switch" ? before.min : 0,
  );
  const commuteNeed = Math.max(
    after.type === "commute" ? after.min : 0,
    before.type === "commute" ? before.min : 0,
  );
  return switchNeed + commuteNeed;
}

/**
 * Extra padding a candidate must leave at one edge of a free interval.
 *
 * The free-space map already carves each existing agenda's own buffer out of
 * the schedulable space (§5.5 Step 1: "existing non-draft agendas *with their
 * buffers*"). Charging the candidate its full buffer on top of that would
 * double-count the same-type overlap the rule exists to collapse — so what is
 * owed here is only the shortfall.
 *
 *   edge is another agenda → max(0, required_gap − buffer already reserved)
 *   edge is the window     → 0; §5.2 lets a buffer spill past the window edge
 *   edge is a prayer block
 *     or an external busy  → 0; §5.2 defines the rule between *buffered*
 *     blocks only — an agenda or an event, never a prayer or a window edge
 */
export function edgePaddingMin(edge: EdgeKind, own: BufferSide): number {
  if (edge.kind !== "buffered") return 0;
  // `edge.buffer` is the neighbour's side that faces this interval and `own` is
  // the candidate's side that faces the neighbour; the rule is symmetric, so
  // this holds whether the neighbour precedes or follows.
  const gap = requiredGapMin(edge.buffer, own);
  return Math.max(0, gap - edge.buffer.min);
}
