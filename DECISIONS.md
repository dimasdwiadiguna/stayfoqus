# DECISIONS

Running log of every judgement call made while building FOQUS from `BRIEF.md`.

Each entry states **what was decided**, **why**, and — where relevant — **what
the brief said** and how the decision relates to it. Entries are append-only and
grouped by milestone. §-references point at `BRIEF.md`.

Legend:

- **Filled a gap** — the brief did not specify; a default was chosen.
- **Interpreted** — the brief specified, but the wording admitted more than one
  reading; the chosen reading is recorded.
- **Deviated** — the brief specified something that could not be followed as
  written; the reason and the substitute are recorded.

---

## M0 — Foundation

### D-001 · Next.js 16.3.3 with Turbopack — **Filled a gap**

§2 fixes the framework ("Next.js App Router + TypeScript, strict mode") but not
the version. Scaffolded with the current release (16.3.3, React 19.2) rather
than pinning back to 15, because nothing in the brief needs an older major and
starting a greenfield app on a superseded major buys a migration for free.

Consequence: Turbopack is the default builder in 16, which forced D-002.

### D-002 · Serwist in *configurator* mode, not `next-pwa` — **Deviated (as the brief allows)**

§2 permits either, and asks which was chosen and why.

`next-pwa` is out: its last release predates the App Router, and it drives the
build through webpack internals that no longer exist in Next 16.

Serwist was then tried in its usual plugin form (`withSerwistInit` in
`next.config.ts`) and **failed the build** — plugin mode injects a `webpack`
config, and Next 16 aborts when a webpack config is present under Turbopack:

```
ERROR: This build is using Turbopack, with a `webpack` config and no `turbopack` config.
```

So Serwist runs in **configurator mode** instead (`serwist.config.mjs` +
`serwist build`), which is builder-agnostic. The service worker is compiled as a
second step of `npm run build`:

```
"build": "next build && npm run build:sw"
```

Verified: 25 URLs precached (all four tab routes, `/`, `/offline`, every static
chunk, the icon set) totalling 1.24 MB — i.e. the full app shell, as §10 requires.

Because Serwist no longer injects registration code, `components/service-worker.tsx`
registers `/sw.js` by hand, on `load` and in production only.

### D-003 · Root-level `app/`, `lib/`, `hooks/` — no `src/` — **Interpreted**

The brief names paths as `lib/i18n/id.ts`, `lib/db/schema.ts`, `lib/scheduling/`,
`app/api/gcal/*`, `hooks/`. Those are root-relative, so the `src/` directory the
scaffolder created was flattened away and the `@/*` alias points at the repo
root. This keeps every path in the brief literally correct.

### D-004 · shadcn/ui components hand-authored rather than installed via CLI — **Interpreted**

§2 fixes "Tailwind CSS + shadcn/ui". shadcn/ui is a copy-in component collection,
not a runtime dependency — running its CLI and vendoring the files by hand
produce the same artifact. The CLI was skipped because its `init` rewrites
`globals.css` with its own token set, which would have clobbered the FOQUS
palette (D-005) on every subsequent `add`.

The components in `components/ui/` therefore follow shadcn conventions exactly —
Radix primitives, `cva` variants, the `cn()` helper, `data-slot` attributes — and
are directly interchangeable with generated ones. `radix-ui` (the unified
package) is the only new runtime dependency.

### D-005 · Design tokens as CSS variables, dark-first — **Filled a gap**

§4.8 defaults `theme` to `'dark'`; §7 and §9 describe the visual system but not
its palette. Chosen: a token layer on `:root`/`.dark` with a `.light` override,
surfaced to Tailwind v4 through `@theme inline`.

`<html>` ships with `class="dark"` so the first paint is never a light flash;
`ThemeProvider` resolves `'system'` to an explicit class once IndexedDB answers.
Semantic tokens (`--p1..--p4`, `--prayer`, `--busy`, `--overtime`) exist because
the brief assigns meaning to those colours (§4.2 priority, §5.3 prayer blocks,
§5.6 overtime) and they must stay coherent across both themes.

### D-006 · System font stack, no `next/font/google` — **Filled a gap**

The scaffold pulled Geist from Google Fonts. Removed: it adds a build-time
network dependency and a render-blocking font fetch to a PWA whose whole point is
opening instantly and offline (§10). The stack is the platform UI font, which on
the two target platforms (mobile Safari, Chrome) is San Francisco and Roboto.

### D-007 · `prefers-reduced-motion` handled globally in CSS — **Interpreted**

§9 requires every animation to respect it. Rather than trusting each component,
`globals.css` collapses all durations to ~0 under the media query, and the
components that do more than animate (confetti, haptics) check the query
explicitly. Belt and braces, because the failure mode is invisible to the author.

### D-008 · Supabase is optional at runtime — **Filled a gap**

The brief assumes Supabase and Google Cloud are configured, and §11 puts sync in
Phase 1. But §3.1 also insists nothing in the UI may block on the network, and
the app must be "fully functional offline".

Decision: treat *unconfigured* the same as *offline*. With no
`NEXT_PUBLIC_SUPABASE_*` env, `getSupabase()` returns `null`, the sync engine
short-circuits to a `local-only` phase, and every other feature works against
IndexedDB. This is what makes the app runnable and reviewable without
provisioning two cloud projects first, and it costs one null check.

### D-009 · Local sentinel `user_id` before sign-in — **Filled a gap**

Every table carries `user_id` (§4), but the user can create data before ever
signing in. Rows created offline are stamped with a fixed sentinel UUID
(`LOCAL_USER_ID`); `setCurrentUserId()` swaps in the real Supabase id at
sign-in. Adopting the pre-existing rows into the signed-in account is handled at
M5/auth time and is called out again there.

---

## M1 — Data layer

### D-010 · `dirty` stored as `0 | 1`, not `boolean` — **Deviated (mechanical)**

§3.1 says "stamping `updated_at` and `dirty = true`". IndexedDB cannot index
boolean values, and `dirty` is exactly the field the sync engine scans. It is
stored as `0 | 1` (type `Flag`) so it can carry an index. Semantics are
unchanged; the field is stripped before the row is pushed to Postgres.

### D-011 · `deleted_at` is deliberately *not* indexed — **Filled a gap**

IndexedDB skips records whose indexed key is `null`. Indexing `deleted_at` would
therefore build an index containing only *deleted* rows and silently exclude
every live one from any query that used it. Soft-delete filtering happens in the
repository layer instead.

### D-012 · Outbox ordering via an auto-incremented `seq` — **Interpreted**

§3.2 requires processing "in insertion order". `created_at` is not sufficient —
two mutations inside one millisecond tie, and the tie-break would be arbitrary.
The outbox therefore has a Dexie `++seq` primary key, and `created_at` is kept
for display. The brief's listed `outbox` columns are all still present.

### D-013 · Outbox pushes the *live* row, not the queued snapshot — **Interpreted**

§4.9 gives the outbox a `payload`. Taken literally, a backlog of five edits to
one todo would push five stale snapshots in sequence, and a conflict check
against any of the first four would be meaningless.

Decision: the entry stores a snapshot (it is what Settings → Sinkronisasi shows
for a blocked entry, and `gcal` entries have no row at all), but the push path
re-reads the current row from Dexie and upserts that. Ordering is still strictly
by `seq`, so cross-entity ordering (todo before its agenda) is preserved.

### D-014 · Pull keeps a newer *dirty* local row — **Interpreted**

§3.2's conflict rule is "remote wins when remote `updated_at` is newer than the
local base version". The edge the rule doesn't name: a pull that overlaps a push
of a *still-queued* local edit. If the local row is `dirty` and at least as new
as the remote row, the local value is kept and stays queued — otherwise the
engine would overwrite an edit the user made seconds ago with the value it is
about to replace anyway. Remote still wins whenever it is strictly newer, and
that case is written to `conflict_log` exactly as specified.

### D-015 · Server-side staleness guard — **Filled a gap**

A retried outbox entry can land after a newer write from another device.
`reject_stale_update()` (a `BEFORE UPDATE` trigger on every synced table) drops
an update whose `updated_at` is older than the stored row. This makes retries
idempotent instead of resurrecting stale values, and it costs nothing in the
common case.

### D-016 · Seed rows use fixed UUIDs — **Filled a gap**

§4.1 seeds four categories on first launch; §4.5 seeds seven availability
windows. With random ids, a second device that installs offline seeds *before*
it can pull, and both sets survive the merge as duplicates.

Seed rows therefore use deterministic ids. Two devices converge on the same rows,
and last-write-wins settles any divergence — including a category the user has
already deleted elsewhere, whose newer tombstone correctly wins.

Seeding is idempotent and gap-filling (it runs on every boot), so an interrupted
first launch recovers.

### D-017 · No foreign keys on `todos.parent_id`, `agendas.todo_id` — **Filled a gap**

The outbox drains in order, but a *pull* from another device can deliver a child
row before its parent. A hard FK would reject it and the row would be lost.
These references are enforced in the client instead (hierarchy depth, cycle
detection, orphan cleanup), which is where the rules in §4.2 already live.

`user_id` keeps its FK to `auth.users` — that one can never arrive out of order.

### D-018 · `google_credentials` has RLS on and *zero* policies — **Interpreted**

§3.3: "Store it in Supabase (in a table the client cannot read via RLS)."
Enabling RLS with no policy at all is the strongest form of that: `anon` and
`authenticated` match nothing and see nothing, with no policy predicate to get
wrong. Only the service-role key used by `/app/api/gcal/*` bypasses it.

---

## M2 — Tasks

### D-019 · shadcn/ui via hand-vendored Radix components (see D-004) — *carried forward*

No new decision; recorded here because M2 is where the primitive set grew
(sheet, dialog, select, switch, slider, segmented control, chip, toast).

### D-020 · Swipe and long-press-drag coexist through motion's `dragDirectionLock` — **Filled a gap**

§8 warns that "gesture conflicts with vertical scrolling are the most common
failure mode in this kind of app" and fixes dnd-kit's activation constraint at
~200 ms delay / ~5 px tolerance. It does not say how the horizontal swipe avoids
the same conflict.

Chosen mechanism, in three layers that agree with each other:

1. `touch-action: pan-y` on the draggable surface — the browser keeps vertical
   scrolling for itself.
2. motion's `dragDirectionLock` — the axis is decided from the first few pixels;
   a vertical gesture never becomes a swipe.
3. Those same few pixels exceed dnd-kit's 5 px tolerance inside its 200 ms
   delay, which cancels the reorder activation.

So the three gestures are mutually exclusive by construction rather than by
racing handlers.

### D-021 · Swipe-left latches the menu open instead of firing on release — **Interpreted**

§8 says swipe left "reveals a menu: Jadwalkan · Edit · Hapus". A revealed menu
has to persist to be tappable, so the row snaps to the open position and closes
on the next tap anywhere on it. The alternative — firing the nearest action on
release — would make an irreversible delete a flick away.

### D-022 · Undo is a real inverse, not a deferred commit — **Interpreted**

§8: "All destructive gestures are undoable via a toast with **Urungkan** for 5
seconds." Two implementations are possible: delay the write for 5 s, or write
immediately and offer the inverse.

Chosen: write immediately, undo by inverse. §3.1 requires the UI to update
instantly from the live query, and a deferred write would either lie to the
query or block it. Because deletes are soft (§3.2), the inverse is exact —
`restoreRow` clears `deleted_at`. The toast API supports both shapes
(`onExpire` exists) so a future deferred case has somewhere to live.

### D-023 · Completing a parent with open subtasks does not touch the subtasks — **Interpreted**

§4.2 specifies the soft warning ("3 subtask belum selesai. Tetap selesaikan?")
and that it must never hard-block, but not what happens to the children on
"Tetap selesaikan". They are left alone: the warning exists precisely because
the user knows something the app does not, and silently completing work that
was not done would corrupt the pomodoro history the app is built to keep honest.

### D-024 · "Biarkan" on the §5.9 agenda prompt still completes the todo — **Interpreted**

§5.9: "Completing a todo that still has future `planned` agendas asks: 'Hapus 2
agenda yang belum jalan?' — default yes." The question is about the *agendas*,
not about the completion, so both answers complete the todo and only the agenda
cleanup differs. Escape / tapping outside dismisses without completing, since
that is not an answer. `ConfirmDialog` grew an explicit `onCancel` to keep this
distinction (an ambient dismiss must not be mistaken for a choice).

### D-025 · Filtering keeps ancestors of a match — **Filled a gap**

§7.1 has tag filter chips but does not say what happens to a matching subtask
whose parent does not match. Hiding the parent would orphan the subtask and lose
the context that makes it legible, so a todo survives the filter if it matches
*or any descendant does*.

### D-026 · Grouping applies to root todos only — **Interpreted**

§7.1 has both a grouping toggle and nested, collapsible subtasks. Grouping
subtasks independently would tear a tree apart across headings, so only roots
are grouped; subtasks stay nested under their parent wherever it lands.

### D-027 · Detail sheet writes through on change, with no Save button — **Filled a gap**

§13 asks for optimistic UI everywhere. A draft-and-save sheet would add a state
the user can lose by swiping the sheet away. Text fields commit on blur (so a
half-typed title is never stored), toggles and pickers commit immediately.

---

## M3 — Scheduling core

### D-028 · Buffers are reconciled between the free-space map and the placement check — **Interpreted**

This is the one place where two rules in §5 have to be read together, so it is
worth stating precisely.

§5.5 Step 1 builds the free-space map by subtracting existing agendas *with
their buffers*. §5.5 Step 3 then requires a placement to fit "the session plus
required buffers". Applied naively, that charges a same-type buffer twice —
exactly the overlap §5.2's `max` rule exists to collapse. A 10-minute switch
buffer on the neighbour plus a 15-minute switch buffer on the candidate would
reserve 25 minutes where §5.2 says the answer is 15.

Resolution: each free interval records what sits on either side of it, and the
candidate is charged only the shortfall:

```
padding = max(0, required_gap(neighbour_side, own_side) − neighbour_side.min)
```

Checked against all three worked examples in §5.2, end to end through the map:

| neighbour's facing buffer | candidate's facing buffer | free space starts | placement starts | total gap |
|---|---|---|---|---|
| 10 switch  | 15 switch  | +10 | +15 | **15** ✓ |
| 10 switch  | 15 commute | +10 | +25 | **25** ✓ |
| 20 commute | 15 commute | +20 | +20 | **20** ✓ |

### D-029 · Buffers apply only between agendas — **Interpreted**

§5.2 defines `required_gap` "for a gap between agenda A (ending) and agenda B
(starting)". Prayer blocks and Google busy intervals are therefore hard
obstacles that charge no buffer, and a window edge charges none either — §5.2
says explicitly that "a buffer may extend past the window end". Both are encoded
in the free interval's edge type rather than left to each call site.

### D-030 · Kemenag prayer parameters spelled out, with ihtiyati — **Filled a gap**

`adhan` ships no Kemenag preset. §4.8 defaults the method to `"Kemenag"`, so it
is expressed as the Indonesian Ministry of Religious Affairs parameters: **Fajr
20°, Isha 18°**, plus the **2-minute ihtiyati** (safety margin) Kemenag applies
to its published tables. Without the ihtiyati the computed times run a minute or
two ahead of the schedule the user actually sees — for a scheduling app that
means blocks that start slightly too late.

Verified against published Bandung times for 2026-08-26 (the seeded
coordinates): 04:37 / 11:53 / 15:13 / 17:52 / 19:02.

### D-031 · `adhan` is fed a Date built from *local* calendar fields — **Deviated (mechanical)**

`adhan` reads the civil date off `getFullYear`/`getMonth`/`getDate` — the
*runtime's* local fields — and returns UTC instants. Passing an instant derived
from the user's timezone would be re-read in the server's timezone and could
land a day off. `civilDate()` therefore builds the Date through the local
constructor at midday, which pins those three fields to the target date on any
host. There is a regression test that runs with `TZ=UTC`.

This is the one place in the codebase that deliberately touches local time; §13's
"never construct dates from naive local strings" is about *storage*, and the
output here is still an absolute instant.

### D-032 · Slot suggestions snap to 5-minute boundaries — **Filled a gap**

§8 fixes 5-minute snapping for the drag gesture but says nothing about
suggestions. Suggesting 11:07 when dragging can only produce 11:05 would be
incoherent, so suggestions snap up to the same grid. Alignment is computed on
the epoch, which coincides with local 5-minute boundaries everywhere except
Nepal (+05:45) and Chatham (+12:45); there, suggestions land on a five-minute
grid offset by 15 minutes. Noted rather than fixed — the app's default timezone
is Asia/Jakarta and the cost of a full local-grid computation is not worth it.

### D-033 · Suggestions step past a non-matching time block instead of skipping the day — **Interpreted**

§5.4 makes time blocks hard for the machine. The naive reading — "this interval
is unusable" — would throw away the whole afternoon because a block covers the
morning. The suggester instead advances the cursor to the end of the blocking
instance and retries within the same free interval (bounded to 8 hops so a
pathological block set cannot spin).

---

## M4 — Calendar

### D-034 · Agenda move is long-press-gated; resize is not — **Filled a gap**

§8 lists both drags but only fixes an activation constraint for the *task list*.
A timeline that starts moving a block the instant a finger lands on it is
unusable — the column is 2160 px tall and must stay scrollable.

Move therefore waits the same 200 ms / 5 px the task list uses. Resize does not:
the handle is a small, deliberate target at the block's edge, so an immediate
response is correct there and matches every calendar app.

### D-035 · Resize snaps to the pomodoro ladder, not to minutes — **Interpreted**

§8 says resize snaps "to whole pomodoro durations". Implemented as snapping the
*resulting duration* onto `sessionDurationMin(n)` — 25 / 55 / 85 / 115 … — so a
block always represents a whole number of sessions rather than an arbitrary
length that happens to be a multiple of 25.

### D-036 · Overlapping blocks are laid out in columns — **Filled a gap**

§7.2 gives a layer order but not what happens when two agendas overlap. They
can: §5.1 lets the user place an agenda anywhere they confirm. Hiding one behind
the other would make the overlap invisible, which is exactly the state the user
needs to see, so overlapping blocks split the column width (greedy assignment by
start time, clusters computed independently).

### D-037 · Timeline density: 1.5 px per minute — **Filled a gap**

Chosen so the smallest possible block (one pomodoro, 25 min) is ~38 px tall —
enough for its title, its time range and the §5.7 dot row. A full day is
2160 px, which scrolls comfortably on a 390×844 viewport.

### D-038 · Long-press on empty space opens a todo picker — **Interpreted**

§8: "long-press empty area → Create an agenda or time block starting there."
The gesture has already answered *when*, so the sheet only asks *which todo*,
defaulting the list to the todos with the most left to allocate. Blocked todos
appear but dimmed — §5.1 permits manual scheduling of a blocked todo (with
confirmation), unlike smart allocation which skips them entirely.

Creating a *time block* from the same gesture is deferred to M7, where the time
block editor exists.

### D-039 · The calendar owns its scrolling — **Filled a gap**

The shared `Screen` shell provides a scroll pane, but nesting the 2160 px
timeline inside it produces two scrollers fighting over one gesture. `Screen`
gained a `scroll` prop; the calendar sets it false for the day/3-day views and
true for the list view.

### D-040 · Suggested slots need no confirmation; manual placement does — **Interpreted**

§5.1 and §5.4 attach confirmations to *manual* placement. A slot that came out
of the free-space map is legal by construction — it is inside a window, clear of
prayer blocks and busy time, and satisfies every time block it touches — so
asking for confirmation would be theatre. The confirmations fire on drag, on
resize, and on the sheet's "Pilih waktu lain…" path.

---

## M5 — Google Calendar sync

### D-041 · One `/api/gcal/pull` endpoint for both reads — **Interpreted**

§6.3 describes two reads: incremental sync of the FOQUS calendar, and
`freebusy` across the others. They share the same triggers and the same
credentials, so splitting them into two endpoints would double the round trips
and the token refreshes for no benefit. One POST returns both, plus the
`syncToken` the client stores.

### D-042 · The client owns the `syncToken` — **Filled a gap**

§6.3 requires a stored token but not where. It lives in
`settings.gcal_sync_token`, i.e. in the same local row every screen already
reads, which keeps the server handlers stateless: the client sends the token it
holds and stores whatever comes back. On a 410 the handler transparently falls
back to the −7/+30 window resync and returns `resynced: true`.

### D-043 · Google writes go through the outbox as `entity: "gcal"` — **Interpreted**

§6.2 says calendar writes are queued in the same outbox. The queued payload is
an *operation* (`upsert_event` / `delete_event`), not an event body: the body is
rebuilt from the live agenda at drain time, so a queued write that sat offline
through three edits sends the final state, not the first.

A `delete_event` entry carries the Google event id inline, because by the time
it drains the local agenda may be gone.

### D-044 · Writing back a Google id does not re-enqueue — **Filled a gap**

After a successful write, `gcal_event_id` and `gcal_synced_at` are written
straight to Dexie rather than through `updateRow`. Going through the mutation
layer would append another outbox entry, which would drain, write the id again,
and never terminate. The same reasoning applies to clearing an expired conflict
badge — both are local bookkeeping the server does not need to hear about.

### D-045 · The FOQUS calendar is resolved server-side on every call — **Interpreted**

§6.1 says to find or create it and store the id in
`settings.gcal_calendar_id`. The client does store it, but the route handlers
re-resolve it rather than trusting a client-supplied id: a browser must not be
able to name which calendar the server writes to, and §6.1's "Never write to
the primary calendar" is only enforceable if the server decides. The lookup
filters out `primary` explicitly, so a user whose primary calendar happens to be
named "FOQUS" still gets a separate one.

### D-046 · `freebusy` excludes the FOQUS calendar — **Filled a gap**

§4.10 calls `gcal_busy_cache` a mirror of the user's *other* calendars. Including
FOQUS would double-count the agendas the scheduler already knows about locally
and make every planned day look full.

### D-047 · The busy cache is replaced, not merged — **Interpreted**

§4.10: "Refresh on foreground for a rolling window of −7 to +30 days." A merge
would leave a deleted remote event blocking the scheduler forever, so each
refresh clears the table and rewrites it. It is a cache, not a record.

### D-048 · A Google-side deletion soft-deletes the local agenda — **Filled a gap**

§6.3 covers time changes but not a cancelled event. Since §6.2 already makes
deleting an agenda delete its Google event, the reverse is the consistent
reading: the event is gone, so the agenda goes with it. Written straight to
Dexie, since echoing the delete back to Google would be a pointless round trip.

### D-049 · Only events carrying `foqusAgendaId` are applied — **Interpreted**

§6.2 sets the marker "for reliable round-trip matching". An event a user created
by hand inside the FOQUS calendar has no local todo to attach to; inventing one
would be worse than ignoring it, so unmarked events are skipped.

---

## M6 — Pomodoro

### D-050 · The timer is a pure state machine with an effect list — **Interpreted**

§13 requires a test for "timer recovery after a simulated background/foreground
cycle". That is only testable if the timer has no ambient dependencies, so
`lib/pomodoro/machine.ts` is pure — `advance(state, now, config)` returns the
next state plus a list of effects (open a log, close a log, chime), and the
store applies them. 20 unit tests cover pause/resume accounting, the long-break
cadence, abort/skip semantics, and multi-phase recovery.

### D-051 · A phase ends at its target time, not at wake-up — **Interpreted**

§5.6: "On returning to the app after the target end time has passed,
immediately resolve the session as completed." The subtlety is *what time to
record*. If the app was away for an hour, the focus log must close at
`startedAt + 25min`, not an hour later — otherwise the history would claim a
90-minute pomodoro. `advance` therefore computes each phase's true end and can
resolve several phases in one call (a focus session *and* its break both
elapsed), each closed at its own instant. Tested.

### D-052 · Skipping a focus session aborts it — **Interpreted**

§7.4 lists a "Lewati" control; §5.6 says a focus session counts only if the full
duration elapses. Those combine to one answer: skipping a *break* completes it
normally, skipping a *focus* session logs `outcome='aborted'` and counts for
nothing. Anything else would let the counter be gamed by tapping Lewati.

### D-053 · Timer state persists to `localStorage`, not IndexedDB — **Filled a gap**

§5.6 requires the running session to survive a refresh or crash. The
`pomodoro_logs` rows are already in Dexie (and sync); what needs persisting is
the small ephemeral machine state. `localStorage` is synchronous, so a cold
start restores and resolves before the first paint — an async IndexedDB read
would flash an idle Focus screen first. Every access is wrapped in try/catch, so
a browser with storage disabled still runs the timer, it just cannot resume it.

### D-054 · Synthesised audio: triangle tick, two-partial bell — **Filled a gap**

§5.6 fixes the constraints ("a brief oscillator burst through a fast-decay gain
envelope — keep it soft, not sharp"; "a warm two-tone chime") but not the
synthesis.

Tick: a triangle wave sliding 1050 → 620 Hz over 30 ms with a 4 ms attack and a
50 ms exponential decay. Triangle rather than square because a square's odd
harmonics are exactly the sharpness the brief rules out.

Bell: two sine partials a perfect fifth apart (D5 + A5), the upper one delayed
140 ms and quieter, each decaying exponentially over ~1.6–1.9 s — the envelope of
a struck bar. A break ends on a lower pair (A4) so the two events are
distinguishable without looking.

### D-055 · Audio unlock lives in the start action, not a component — **Interpreted**

§5.6: "Create and resume the `AudioContext` inside the tap handler on 'Mulai
fokus' — never on page load." `startFocusSession()` calls `unlockAudio()` as its
first statement, which makes the rule structural: every caller is a tap handler
by construction, and no future call site can forget.

### D-056 · The wake lock follows the phase, not the screen — **Interpreted**

§5.6 asks for a Screen Wake Lock "while a focus session runs; release it on
pause/finish". The lock is therefore driven by the machine state — held only
while a *focus* phase is running and unpaused — not by the Focus overlay being
open. Minimising to the pill keeps the lock; pausing drops it. When the API is
unavailable (iOS before 16.4) the screen says so rather than pretending.

---

## M7 — Time blocking

### D-057 · The time-block rules were already built and tested in M3 — *note*

§5.4's semantics (recurrence expansion, per-instance skip, OR-within /
AND-across filter matching, hard enforcement in the scheduler) live in
`lib/scheduling/timeblocks.ts` and were unit-tested as part of the pure module.
M7 adds only what is genuinely UI: CRUD, the editor, and the timeline band.

### D-058 · Tapping a band's name skips that one occurrence — **Filled a gap**

§4.7 defines `time_block_exceptions` and §7.5 lists "Lewati hari ini", but
neither says where the control lives. Putting it on the band itself keeps the
action next to the thing it affects, and it is undoable through the same toast
as everything else. Toggling reuses the existing exception row rather than
piling up tombstones, so `[time_block_id+date]` stays a genuine key.

### D-059 · Creating a *time block* from the calendar long-press is deferred to Settings — **Interpreted**

§8 says the long-press creates "an agenda or time block". The agenda path is
immediate and needs one decision (which todo); the time-block path needs a
name, a recurrence, days, and three filter dimensions — an editor, not a sheet.
That editor exists in Settings → Blok waktu, so the gesture creates an agenda
and time blocks are made where their full form already lives.

### D-060 · Deleting a category leaves todos pointing at it — **Filled a gap**

§4.1 says all four seeded categories are deletable but not what happens to
todos using them. The grouping layer already treats an unknown `category_id` as
"Tanpa kategori", so the dangling reference is harmless and the delete stays
reversible — rewriting every affected todo would be a large cascade for an
action the user may undo.

---

## M8 — Weekly Plan & smart allocation

### D-061 · `occupy` removes the placement's *footprint*, not just its core — **Bug found by the tests**

Worth recording because it is exactly the class of error §5.2 exists to
prevent, and the test suite is what caught it.

`buildFreeSpace` subtracts an existing agenda together with its buffers, and
`edgePaddingMin` relies on that: it charges a candidate only the *shortfall*
over what the neighbour already reserved. The allocator's `occupy` originally
removed only the placed agenda's core interval — so the surviving edge claimed
a 10-minute buffer that had never been carved out, the shortfall computed to
zero, and two consecutive sessions were placed **back to back with no gap at
all** (10:55 then 10:55).

`occupy` now takes the buffers explicitly and removes `start − before` to
`end + after`, matching `buildFreeSpace` exactly. The regression is pinned by
"leaves the required gap between its own back-to-back sessions" and by
"removes the placement's buffers from the map too".

### D-062 · Candidate ordering has a fifth tiebreaker beyond `created_at` — **Filled a gap**

§5.5 Step 2 ends with "`created_at` ascending (tiebreaker — guarantees
determinism)". Two rows created in the same millisecond still tie, and the
result would then depend on the input array's order — which is a live query's
order, i.e. not stable. The sort falls through to the row id, which is unique
by construction. Tested both ways round.

### D-063 · Placements are returned chronologically — **Filled a gap**

The greedy pass produces them in candidate order, which is not the order they
appear on the calendar. Sorting the output by start time makes the draft
preview readable and makes two runs comparable regardless of how the candidates
were considered.

### D-064 · The capacity meter is computed from the free-space map — **Interpreted**

§7.3 says capacity is "derived from availability windows minus prayer blocks
and existing commitments". Rather than recompute that, the meter divides
`freeMinutes(world.free)` by the length of one pomodoro — the *same* map the
allocator will use. This makes it impossible for the meter to promise capacity
the allocator cannot deliver.

The meter shows two bars: allocated (solid) inside wanted (translucent), so
"terpakai 32 / kapasitas 48" and an over-capacity target are both visible.

### D-065 · Drafts are written to Dexie, not held in memory — **Interpreted**

§5.5 Step 5 allows the user to "drag, resize, or delete individual drafts"
before applying. Drag and resize are calendar operations on real agenda rows,
so drafts are real rows with `status = 'draft'`. They are excluded from the
free-space map (§5.5 Step 1 subtracts *non-draft* agendas) and never written to
Google (§6.2), so the only thing that changes on **Terapkan** is the status.

This is also what lets the draft bar be a live query: any draft, from any
source, surfaces the Terapkan/Batalkan bar.

---

## M9 — Missed agenda review

### D-066 · Detection rides the shared clock — **Interpreted**

§5.8 says to detect missed agendas "on app foreground". `useNow()` already
ticks and is already re-read on foreground, so `useMissedAgendas()` derives
from it rather than installing a second visibility listener. One clock, one
answer, no drift between the banner and the calendar.

### D-067 · The review writes pomodoro logs for what actually happened — **Filled a gap**

§5.8's **Selesai** and **Sebagian** ask how many pomodoros were really used,
but the brief does not say where that number goes. Storing it only as the
agenda's status would leave the counters in §4.2 wrong — the todo would show
allocated-but-unused forever.

The review therefore back-fills `pomodoro_logs` up to the reported count, from
the agenda's own start/end. Sessions past the allocation are marked
`is_overtime`, exactly as a live session would be. Existing logs are counted
first so re-reviewing does not double-count.

### D-068 · Bulk selection applies to the tapped row's action — **Interpreted**

§5.8: "Support bulk selection: select several, apply one action to all." The
sheet has no separate apply bar; instead, if the row you act on is part of the
selection, the action applies to the whole selection. Acting on an unselected
row affects only that row. This keeps one set of controls rather than two modes.

### D-069 · Reschedule excludes the agenda being moved from its own free-space map — **Filled a gap**

Otherwise the agenda blocks the slot it currently occupies, and "the 3 nearest
valid slots" would silently exclude the most obvious one — moving it 20 minutes
later. `useSchedulingWorld` grew an `excludeAgendaIds` option for this.

---

## M10 — Reward layer & polish

### D-070 · §5.9's prompt condition is a pure function — **Interpreted**

"when an agenda is completed and that todo has no remaining allocation and no
future agendas" needs three clarifications the brief leaves implicit, so the
rule lives in `lib/agendas/coupling.ts` where it can be tested:

1. A **missed** agenda awaiting review is not "no future agendas" — the work is
   unresolved, not finished. It suppresses the prompt.
2. "No remaining allocation" means every allocated pomodoro has a completed
   focus log, not merely that the agenda is marked done.
3. The todo's own `estimated_pomodoro` must also be covered — otherwise a todo
   estimated at 6 with only 2 scheduled would be declared finished after those
   2.

### D-071 · Derived UI state is computed in render, never pushed from an effect — **Filled a gap**

Both §5.9's prompt and §9's "Hari Selesai" trigger read live Dexie data. Written
the obvious way — an effect that inspects the data and calls `setState` — they
produce a cascading render on every database change, which React's lint rules
flag and which would fire on every sync tick.

They are computed with `useMemo` during render instead. The only state is what
the user has already answered or dismissed. The one genuine effect left is
firing the confetti, which is a real external side effect.

### D-072 · The streak does not break on a day that is not over — **Interpreted**

§9 defines it as "consecutive days with ≥1 completed pomodoro". Counting
strictly back from today would show 0 every morning until the first pomodoro,
which reads as a lost streak — precisely the guilt §9 rules out. The walk
therefore starts at yesterday unless today already qualifies. Tested.

### D-073 · The encouragement line is chosen deterministically from the date — **Filled a gap**

§9 asks for "one honest line of encouragement". A random pick reshuffles every
time the sheet re-renders, which reads as noise; the line is hashed from the
date so it is stable for the day.

### D-074 · Confetti fires exactly where §9 says and nowhere else — **Interpreted**

Two triggers only: completing a todo that has subtasks, and clearing every
agenda for the day. Both are gated on `prefers-reduced-motion`, and
`canvas-confetti` is imported lazily so it never enters the initial bundle.
Routine completions get the animated check, the strikethrough and a haptic tap
— nothing more. Scarcity is the mechanism.

---

## Verification

The build was checked end to end in a real browser (390×844, Asia/Jakarta) at
each milestone, not only through the test suite:

- **Prayer times** — computed times for the seeded Bandung coordinates on
  2026-08-26 are 04:37 / 11:53 / 15:13 / 17:52 / 19:02, matching the published
  Kemenag schedule.
- **Slot suggestions route around them** — for a todo scheduled that morning,
  the three chips came back as 11:00, then 12:15 (after the Dhuhr block ends at
  12:13, snapped to the 5-minute grid), then 15:35 (after Ashar's block ends at
  15:33).
- **Smart allocation** — three todos totalling 8 pomodoros were placed as
  drafts around the prayer blocks and the current time, rendered with dashed
  borders and the §5.7 dot rows, with the Terapkan/Batalkan bar pinned below.
- **Offline** — 36 URLs precached, covering the shell, all four tabs and the
  icon set.

Final state: `npm run lint`, `npm run typecheck` and `npm run build` are clean;
the Vitest suite is green.

### D-075 · A running focus session is logged as `aborted` until it finishes — **Bug found in the browser**

Caught by running the Focus screen rather than by a test. `open-log` originally
wrote the row with `outcome: 'completed'` as a placeholder, so the moment a
session started it counted toward the daily progress ring, the derived
`used_pomodoro`, and the streak — directly contradicting §5.6's "counts as used
only if the full 25 minutes elapse".

The open row now carries `outcome: 'aborted'` and `close-log` sets the real
outcome. This is also the correct record if the app dies mid-session: the
session genuinely was not completed.

`countsAsUsed` additionally requires `ended_at !== null`, so an open row cannot
be counted even if some future path writes a different placeholder. Pinned by
"does not count a focus session that is still running".

---

## Bug fixes after first user testing

Six issues reported after running the build. Four were real defects; two were
requested behaviour changes. Recorded here because three of them changed a rule
rather than only a component.

### D-076 · The time block editor rendered from a snapshot — **Bug**

Reported as "nothing in the sheet can be changed": day chips would not toggle,
times would not edit, colours would not stick.

The editor held the row in React state (`setEditing(block)`) and every control
wrote through `updateTimeBlock`. The write reached Dexie, but the form kept
rendering the object it was opened with — so each change was saved and then
immediately painted back from the stale copy. Controlled inputs made this total:
`value={block.start_time}` could never move.

It now holds only the id and reads the live row with `useLiveQuery`. The lesson
generalises: in this codebase a component that both writes a row and renders it
must read it live, never hold it.

### D-077 · Dragging an agenda was lost inside a `setState` updater — **Bug**

Reported as "drag is overridden by page scroll, almost impossible to drag".
There were two independent causes, and the second was the fatal one.

**Cause 1 — the browser took the gesture.** The block set
`touch-action: pan-y`, so within a few pixels of vertical movement the scroller
claimed the pointer and cancelled the stream before the 200 ms hold could arm a
drag. On touch, the drag could essentially never start.

**Cause 2 — the commit never ran.** Even with a mouse, where the gesture was
never stolen, dragging did nothing. The commit was written inside a functional
`setState` updater:

```ts
setDrag((current) => {
  if (commit && active && current && current.deltaMin !== 0) onMove(...);
  return null;
});
active = false;          // ← runs first
```

React does not invoke the updater synchronously, so by the time it ran, the
cleanup had already set `active = false` and the guard was always false. The
write was silently dropped on every drag. (Doing side effects inside an updater
was the real mistake; the stale flag was just how it surfaced.)

Both are fixed:

- The block now sets `touch-action: none` and owns the gesture outright. Taking
  the gesture means owing the user scrolling back, so until the hold arms, the
  block forwards vertical movement to the timeline's scroll pane by hand
  (`TimelineScrollContext`). A clearly horizontal gesture is released so the
  day-swipe still works.
- The delta lives in a ref; the commit happens synchronously in cleanup,
  outside any updater. State drives only the preview.

Verified with real touch events: a 60 px long-press drag moved 15:35 → 16:15
(40 minutes at 1.5 px/min), and a quick upward swipe *starting on the block*
scrolled the pane 1170 → 1282 without moving the agenda.

### D-078 · The agenda block always shows its time range — **Requested**

The range was gated behind `height > 40px`, and a one-pomodoro block is ~38 px —
so the most common block hid exactly the information it exists to convey. The
range is now always rendered: beside the title on short blocks, stacked above it
on taller ones. The dot row keeps a height gate, since it is decoration.

### D-079 · Duration presets, with the pomodoro count derived — **Requested**

10 / 15 / 30 / 60 / 90 / 120 minutes plus a custom field, in both the agenda
sheet and the Jadwalkan sheet.

This is a deliberate departure from the brief's model, which expresses an
agenda's length *only* as a pomodoro count (§5.5: `n × focus + (n−1) × break`).
That is right for planning a week of deep work and clumsy for a ten-minute
errand.

Reconciled rather than replaced: the preset sets the duration directly, and
`allocated_pomodoro` is then derived from it with `pomodorosForDuration`. The
§5.7 dot row and the derived counters in §4.2 therefore stay meaningful at any
length, and the picker states the equivalence out loud ("≈ 1 pomodoro"). Smart
allocation still produces exact pomodoro-shaped sessions; only manual editing
gained the freedom.

### D-080 · Audio unlock must not sit behind an `await` — **Bug**

Reported as "no pomodoro sound". `startFocusSession()` called
`await unlockAudio()` as its first statement, which looked correct — but the
*call sites* did work first:

```ts
onClick={() => void (async () => {
  const completed = await completedFocusFor(agenda.id);   // ← Dexie read
  await startFocusSession({ ... });                       // ← unlock happens here
})()}
```

By then the call stack no longer belonged to the user gesture, so `resume()`
was ignored and the AudioContext stayed `suspended`. `playTick`/`playBell` both
bail on a non-running context, so everything was silent — on desktop as well as
iOS, not just the iOS case §5.6 warns about.

Split into a synchronous `primeAudio()` (create + `resume()` + silent buffer,
no awaits) called as the literal first statement of every tap handler, with the
awaitable `unlockAudio()` kept for callers that genuinely are the gesture's
first action.

### D-081 · A parent may not be scheduled before its children — **Requested, new rule**

Not in the brief, which treats hierarchy purely as organisation (§4.2) and never
constrains a parent's timing. Requested for both automatic and manual
scheduling, and implemented as a **hard** rule in both — unlike the window and
time-block rules, which §5.1/§5.4 make confirmations. The reason for the
difference: a parent that starts before its own subtasks is not an unusual
choice, it is incoherent.

- **Smart allocation.** `SchedulableTodo` gained `parentId` and `depth`, and
  `sortCandidates` now orders by depth descending *before* the §5.5 criteria —
  so children are always placed first and a parent's floor is known when its
  turn comes. Within a depth level the §5.5 order is untouched. The floor also
  accounts for children scheduled outside this run, via `existingEndByTodo`.
- **Manual.** `lib/todos/ordering.ts` answers the same question from the other
  direction. Suggestion lists pass the floor as `notBefore`, so an illegal slot
  is never offered; drag, long-press-create and the manual picker refuse with a
  message naming the blocking subtasks.

Verified end to end: with a subtask scheduled at 20:00, the parent's three
suggested slots began at 20:35 (after the child plus its buffer) instead of
09:00, and a manual 09:00 placement was refused by name.

### D-082 · Buffers are drawn as the block of time they consume — **Requested**

§5.2 asks for "a thin, muted stripe attached to the agenda block", and that is
literally what existed: two 2 px lines *inside* the block's own edges. In
practice it was invisible, and it gave no way to tell the two buffer types
apart — which matters more here than in most apps, because the types compose
differently (`max` within a type, `+` across, §5.2). A user cannot reason about
a gap they cannot see.

The band now occupies the real minutes the buffer reserves, immediately before
or after the block, so the schedulable space it eats is legible at a glance.
Kept subordinate to the agenda: faint fill, wide-gapped weave, a solid edge only
on the side that touches the block, and `pointer-events: none` so it can never
steal the touch that starts a drag.

The two types are distinguished three ways over, so neither colour nor pattern
has to carry it alone — which also keeps it readable for colour-blind users and
in both themes:

| | colour | pattern | icon |
|---|---|---|---|
| `switch` | cool slate `--buffer-switch` | horizontal weave (sitting still) | ⇄ |
| `commute` | warm bronze `--buffer-commute` | diagonal stripes (motion) | car |

Bronze rather than amber deliberately: `--warning` is already amber, and a
buffer is not a warning.

The same swatch component renders in three places so the language stays one
language: the timeline band, the legend in the calendar header (shown only on
days that actually have a buffer), and the type picker in the agenda sheet —
which replaced a plain dropdown, so the choice made there is recognisable on the
timeline afterwards.

A first pass used denser stripes and the commute band ended up louder than the
agenda it belonged to, inverting the hierarchy; the weave was thinned until the
agenda clearly reads first.
