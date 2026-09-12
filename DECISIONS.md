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

### D-083 · Three separate iOS-only reasons the pomodoro was silent — **Bug**

Reported as "no sound on Safari iOS" after D-080 had already fixed the
gesture-timing bug that silenced desktop. iOS needs three more things, and
missing any one of them produces the identical symptom, so they were fixed
together:

**1. The hardware silent switch.** By default iOS routes Web Audio through the
*ambient* audio session, which the ringer switch mutes outright. No amount of
correct Web Audio code plays a sound on a phone with that switch flipped. The
only remedy is `navigator.audioSession.type = "playback"` (Safari 16.4+), now
set when the context is created and again on every prime. There is no feature
test beyond the property's existence, and it is inert elsewhere.

**2. The context is suspended when the page stops being visible**, and
`resume()` is refused outside a gesture. A 25-minute session almost always ends
in exactly that state — the user starts it and puts the phone down — so the bell
was being dropped precisely when it mattered most. A silent looping buffer
(`beginAudioSession`) now holds the session open for the life of a run and is
released when the timer goes idle.

**3. JS timers are throttled or stopped in a backgrounded page**, so the tick
that *notices* the phase ended may not run until the user returns. The bell is
therefore **booked on the audio clock** at phase start (`scheduleBell`), not
played from the tick: Web Audio's scheduler runs on the audio thread and fires
regardless of the main thread, as long as the context is alive — which (2)
guarantees. Anything that changes when the phase ends (pause, resume, skip,
abort, turning the bell off) cancels and re-books; the tick's own `playBell` is
now a fallback for when nothing was booked, so the two can never double up.

**Honest limitation:** this environment has no iOS Safari, so I verified the
code paths, the desktop behaviour and the new diagnostic — not the fix on a real
iPhone. (1) in particular is device behaviour I cannot reproduce here.

That is also why Settings gained an **audio status** row. Three of the failure
modes above are invisible to the user and look identical; the row reports the
two that are observable (never unlocked / suspended) and states the third — the
silent switch — as a hint, since the web cannot detect it at all.

### D-084 · Completing a task asks how many pomodoros it took — **Requested, new rule**

Not in the brief. §4.4 assumes every pomodoro arrives through the timer, and
§5.8 only back-fills them when reviewing a *missed agenda*. But work routinely
happens away from the app, and completing such a todo left today's counters
claiming nothing had happened.

The requirement was that the answer move **both** of today's numbers. That is
what makes this more than writing logs: logs alone raise *used* and leave the
progress ring reading `3/0`, which is worse than not asking. So the plan always
ensures an agenda exists **today** whose allocation covers the reported total,
then attaches the logs to it:

- an agenda already on today → raise its allocation (the latest one, accounting
  for the others), rather than adding a block the user never scheduled
- no agenda today → create one, `status: 'done'`, ending *now* so it never
  reads as outstanding work
- already covered → write nothing

Only the shortfall is logged, so re-completing a todo, or completing one the
timer already tracked, cannot double-count. Zero is a valid answer.

Pre-filled with what the timer recorded, or the estimate when it recorded
nothing — the common case is one tap on **Simpan**. The rule lives in
`lib/todos/completion.ts` as a pure planner with 15 tests, because the
arithmetic (shortfalls, top-ups, local-day boundaries) is exactly the kind that
looks obvious and is not.

Verified end to end: a todo estimated at 3, completed with no timer history,
moved the header from `0/0` to `3/3` and produced one `done` agenda of 3
pomodoros on the calendar.

---

## Scheduling picker, "immediately after", and the planning wizard

### D-085 · The Jadwalkan sheet gets three tabs — **Requested**

§8 specifies one way to pick a slot: three recommended chips plus "Pilih waktu
lain…". That is the fastest path when the suggestions are right and a dead end
when they are not — a bare date-and-time field gives no sense of what the day
already looks like.

Three tabs now, with the brief's path still first and still the default:

- **Daftar** — the recommended slots, unchanged (raised from 3 to 5, since the
  list is no longer the only option and a longer list costs nothing here)
- **Kalender** — a 3-day timeline showing the same obstacles the scheduler
  sees; tap to place, drag to adjust
- **Custom** — type a date and time

Duration moved *above* the tabs. It is a property of the work, not of how the
user happens to pick a time for it, so asking it once per sheet rather than
once per tab was the only coherent arrangement.

### D-086 · The calendar tab places a block already the right size — **Interpreted**

The request was for a view "yang bisa di tap untuk memunculkan draft block …
ukurannya sudah sesuai dengan estimasi waktu". Implemented literally: the tap
answers *where*, never *how long*. The draft also renders its own buffers, so
the space the agenda really needs — not just its core — is visible while
choosing.

Two mechanical details worth recording, both found by testing:

- A tap in the past clamps to "now", which is not on the 5-minute grid. Snapping
  happens *after* clamping, or a tap would land on something like 23:49.
- Every decorative layer in the column is `pointer-events: none`. One of them
  was not, and it silently swallowed every tap — the feature looked implemented
  and did nothing.

### D-087 · "Immediately after" is a stored link, not a computed time — **Requested, new schema**

The request: butting two agendas together should be able to mean *follows*, and
"locknya bukan ke jam mulai agenda ini, tapi ke jam selesai buffer agenda
sebelumnya".

That is not expressible in the existing model. §5.2 gives the rule for the gap
between two agendas but assumes both own their start time, so a deliberately
back-to-back pair silently drifts apart the moment the first one moves. New
column `agendas.follows_agenda_id` makes the *relationship* the stored fact and
the start time the derived one (Dexie v2 + migration 0002).

**Where the gap comes from.** The follower starts at the predecessor's end plus
§5.2's composed `required_gap` — the same rule the free-space map and the
allocator already use. Whenever the follower asks for no more than the
predecessor already reserves, that reduces exactly to "the end of the previous
agenda's buffer", which is what was asked for; when it asks for more, the pair
cannot end up closer together than the scheduler itself would have placed them.

`lib/scheduling/chain.ts` is pure and resolves the whole graph: transitive
(a three-deep chain settles in one pass, in order), deterministic when two
agendas follow the same predecessor, and cycle-safe — a cycle is *reported*
rather than walked, since there is no correct answer and looping would hang the
UI. `wouldCycle` refuses the link before it is ever stored. 23 tests.

Consequences elsewhere, each deliberate:

- A pinned agenda's date and time fields are **disabled** in the agenda sheet.
  Its start is derived; editing it there would be overwritten by the next
  resolve, which is worse than not offering it.
- Dragging a pinned agenda by hand **clears the pin** — the user just chose a
  time, and silently snapping back would be baffling.
- Deleting a predecessor clears its followers' links rather than leaving them
  pinned to a ghost.
- The offer only appears when the block is genuinely butted against a
  neighbour (within 6 minutes, measured *through* the buffer rule), so it feels
  earned rather than arbitrary.

Verified end to end in a browser: B pinned to A at A's end + 10-minute buffer;
dragging A from 21:00 to 20:00 moved B from 21:35 to 20:35 on its own.

### D-088 · The planning wizard reuses the ordinary scheduling sheet — **Requested**

Three steps, each one decision: pick this week's targets (new tasks can be
created inline), name the three most important, then schedule them one at a
time in that order.

Two choices worth stating:

- **The three MITs are stored as priority 1**, not as a separate flag. §4.2's P1
  is "Mendesak", and naming a task one of the day's three most important *is*
  that claim. A parallel flag would be invisible to the sorter, the grouping,
  the allocator and the task row — everything that already understands priority.
- **Step 3 opens the same `ScheduleSheet` the rest of the app uses**, rather
  than a wizard-specific picker. One scheduling flow, so the three tabs, the
  buffer rules, the parent-ordering refusal and the confirmations all behave
  identically inside the wizard and outside it.

Targets are committed to `focus_week` when step 1 is left, so a plan survives
closing the wizard half-way.

### D-089 · The celebration, and the verse — **Requested**

§9's rule still governs: celebration is scarce. Finishing a plan is a real
commitment rather than a tap, so it earns confetti, a rising arpeggio (distinct
from the pomodoro bell, which marks an *interval* and should stay calm), a
haptic pattern, and a verse.

On the verses specifically:

- A **small, fixed, hand-checked set of five**, chosen for their fit with
  finishing a piece of work and committing to the next — Al-Insyirah 94:5-6 and
  94:7, At-Taubah 9:105, Al-Baqarah 2:286, Ar-Ra'd 13:11. Translations follow
  the Kemenag rendering. This is scripture; generating or paraphrasing it would
  be the wrong kind of clever, so the set is data, not a template.
- **Picked deterministically from the date**, so re-opening the screen never
  reshuffles it.
- Each ayah is its own line rather than one string joined by ۝. That glyph is
  missing from the default font stack on most devices and rendered as a tofu
  box — a visible bug in the middle of scripture, which is exactly where one
  should not be. (Caught in a screenshot, not by a test.)

The whole thing respects `prefers-reduced-motion`, and the sound follows the
existing bell setting rather than adding one.

---

## Kalender: geser, rantai, dan penghindaran sholat

Second round of feedback from real use. Two requests were direct changes to
gestures; the rest came out of a list of proposed UI/UX fixes that was reviewed
and picked from. Four of them change a *rule* rather than a component, so they
are recorded in full.

### D-090 · Resize is gone; the block is one move surface — **Deviated (requested)**

§8 gives the block two drags: move (5-minute snap) and resize from an edge
(pomodoro-ladder snap). The resize edge was removed on request: *"user tidak
diperbolehkan mengubah durasi event dengan mendrag pinggir event."*

It was the right call for three reasons beyond the request itself. The handle
was 22 px on a 390 px screen, sitting inside the move target and immediately
next to the gesture that scrolls a 2160 px column — the exact geometry D-077
already had to rescue once. It was also the *worse* of two ways to set a
length: D-079's presets express "10 menit" directly, while the ladder could
only ever produce 25 / 55 / 85 / 115. And it was the only gesture in the app
that could change how much work an agenda represents without ever showing the
number it was changing.

`snapToPomodoro` went with it. `pomodorosForDuration` and `sessionDurationMin`
are untouched — the duration picker is now their only caller from the UI, and
the §5.7 dot row still derives from `allocated_pomodoro` exactly as before.

### D-091 · A chain is made by dragging, not by a button — **Requested**

D-087 stored the "immediately after" relationship but left only one way to
create it: a button in the Jadwalkan sheet's calendar tab. On the calendar
itself, butting two blocks together meant nothing.

The request was for the gesture to carry it: a green line between the two while
dragging, and a confirmation on release. Three decisions inside that:

**The cue must never lie.** `dragLinkCandidate` filters out the block being
moved and, via `wouldCycle`, anything whose link `linkImmediatelyAfter` would
refuse. Offering a link that the drop then rejects would be worse than not
offering one. The commit re-checks against live Dexie anyway, since the
candidate was computed from a drag-time snapshot.

**Tolerance is 15 minutes, not `abuttingPredecessor`'s 6.** They answer
different questions. Six minutes is "did this come to rest against that"; 15 is
"is this reaching for that", and at 1.5 px/min it is the ~22 px a thumb travels
while deciding. Within it the preview *snaps* to `chainedStart`, so releasing
where the line appears produces exactly the placement the line described.

**The gap still comes from `chainedStart`.** One rule (§5.2's composed
`required_gap`), not a second one that happens to agree.

The release question has three answers, which is why it reuses `ConfirmDialog`
with the D-024 shape: confirm links, the explicit cancel places the block
without a link, and dismissing with Escape answers nothing — so the block stays
where it was. D-087's rule that dragging a pinned agenda *releases* its pin is
kept and made structural: `commitMove` always writes `follows_agenda_id`
explicitly rather than leaving the column alone.

The seam is drawn between the two *footprints* (predecessor end + its after
buffer, follower start − its before buffer), not between the block edges,
because the buffers are what the link preserves. With buffers of the same type
§5.2 collapses those to one instant and it renders as a single line.

### D-092 · Every block in the slot picker says what it is — **Requested**

`PickDay` drew agendas as boxes containing a start time, and time blocks,
prayer blocks and busy bands with no label at all — on the one screen whose
entire purpose is deciding *where*. Choosing the slot after "rapat tim" is a
different decision from choosing the slot after an unlabelled rectangle.

All four layers are named now. The time block's name is plain text here rather
than the skip button it is on the main timeline: this screen respects the
blocks, it does not edit them. Every label is `pointer-events: none` — D-086
records that one non-transparent decorative layer once swallowed every tap and
made this tab look implemented while doing nothing.

### D-093 · A prayer block is routed around, not asked about — **Requested, new rule**

§5.3 makes prayer blocks hard for the scheduler and asks for a confirmation
when the user places over one manually. The request: *"buat agenda tersebut
untuk mundur ke sebelum atau maju ke setelah waktu shalat … selama slot masih
tersedia, atau jika slot sudah tidak ada maka berikan peringatan."*

A yes/no about breaking something the user does not want broken is the wrong
first question. `avoidPrayer` (pure, `lib/scheduling/avoid.ts`) answers the
useful one instead: keep the length, and either finish before the prayer starts
or begin after it ends.

- **"Slot masih tersedia" is defined as fitting whole inside one `FreeInterval`.**
  That is not a convenience — it is what makes the offer trustworthy, since the
  free-space map has already subtracted the availability window edges, other
  agendas *with their buffers*, the other prayers, and Google busy time. A
  shift can therefore never produce a second conflict.
- **Both edges snap away from the prayer** (earlier floors, later ceils onto
  the 5-minute grid). The grid must never be the reason a block clips the thing
  it was moved to respect.
- **Accepting a shift is a fresh placement**, not a variation of the old one:
  it is re-checked against the window and the time blocks, and its pin is
  recomputed for the new start rather than carried over from where the finger
  let go.
- **The agenda being moved is excluded from its own free-space map.** Otherwise
  it blocks its own way out — the same edge D-069 found for reschedule.
- With neither side available, §5.3's plain confirmation is all that remains,
  which is the requested soft warning.

### D-094 · Completion is a status, never a deletion — **Requested, replaces D-024**

§5.9 says completing an agenda does not auto-complete its todo, and that
completing a todo with future `planned` agendas asks *"Hapus 2 agenda yang
belum jalan?"* — default yes. The request replaces both halves: *"maka tandai
task maupun agendanya sebagai selesai. Jangan dihapus (sebagai log activity)."*

**Agendas → todo.** When every live agenda of a todo is `done`, the todo is
completed automatically, with an undo toast rather than the §5.9 prompt. When
nothing is left unresolved there is no useful question to ask, and answering
with a dialog the user has to dismiss is worse than answering reversibly.

Three exclusions, each deliberate:

1. a `partial` agenda is not "selesai" — the work was explicitly reported
   unfinished, so the §5.9 prompt still owns that case;
2. a `draft` neither blocks nor completes, because it was never a commitment;
3. D-070's third clarification still stands — a todo whose `estimated_pomodoro`
   exceeds what its agendas allocate has work nobody has scheduled, and neither
   the automatic rule nor the prompt fires for it. Nothing happens, which is
   correct: the answer is to schedule the rest, not to declare it done.

**Todo → agendas.** `completeTodo` no longer soft-deletes anything. `planned`,
`missed` and `partial` become `done`; a `draft` becomes `cancelled`, because
§6.2 syncs `done` and a draft was never meant to reach Google. The rows survive
as the record of what the days were for — which is precisely the history the
derived counters in §4.2 are computed from, so deleting the unstarted ones was
quietly corrupting the thing the app exists to keep honest.

The prior statuses are returned as a `CompletionUndo` so the toast is a true
inverse (D-022) rather than half of one. The §5.9 delete dialog and the
`removeFutureAgendas` option are gone with it.

### D-095 · A day viewport, not a piecewise axis — **Filled a gap**

The day column is 2160 px for 24 hours while the seeded availability windows
run 04:00–22:00, so roughly a fifth of every scroll is spent on hours nothing
can be scheduled in.

The obvious fix — a non-linear axis that collapses dead hours into a thin strip
— was rejected. Every `topFor`, `heightFor`, `pxToMinutes` and `instantForPx`
would have to become piecewise, and those are exactly the conversions the drag
inverts; D-077 is a record of what that arithmetic costs when it is wrong.

`dayViewport` moves the rendered *slice* instead. The column is still a linear
2160 px; it is placed inside a fixed-height, `overflow: hidden` band and offset
by `topPx`. Because the column element itself is offset, its bounding rect is
too — so `e.clientY - rect.top` still yields full-column coordinates and *no*
call site needed adjusting. Only the auto-scroll-to-current-hour effect, which
computes a `scrollTop` rather than reading one, subtracts `topPx`.

The band widens for anything placed outside a window, buffers included: §5.1
explicitly allows such a placement, and a block the user cannot see is worse
than a strip of empty hours. One band is computed across all visible days, or
the three-day columns would not line up with each other or the hour gutter. A
toggle restores the full 24 hours.

The three-day date labels moved out of the day columns and above the band —
`position: sticky` cannot survive an `overflow: hidden` ancestor.

### D-096 · A destructive action may not hide inside a label — **Filled a gap (reverses part of D-058)**

D-058 put "skip this occurrence" on the time block's name, reasoning that the
action should sit next to the thing it affects. In use that meant tapping a
block's name to read it silently skipped that day's occurrence: a destructive
action wearing the costume of a piece of text, with nothing to suggest it was
tappable at all.

D-058's instinct was right and its target was wrong. The action stays on the
band, but as its own 24 px `EyeOff` button with an `aria-label`; the name is a
plain `pointer-events: none` label. The undo toast is unchanged, so the mistake
was always recoverable — it was just never legible.

### D-097 · Drag ergonomics: autoscroll, undo, and a verdict before release — **Requested**

Three gaps that cost the same thing — certainty about where a block is going
while it can still be changed.

**Autoscroll.** A 2160 px column meant a block could not be dragged to a time
that was off screen. Holding against the pane's edge now scrolls it, easing in
over the last 56 px. The preview folds the pane's own movement into its delta
(`clientY - originY + scrolled`), or the block would slide out from under a
stationary finger by exactly the distance auto-scrolled. The loop stops when
the pane's `scrollTop` stops changing, so a drag held at the top of the day
does not creep.

**Undo.** Deleting an agenda had a toast; moving one did not, even though a
drag also releases an "immediately after" pin — so a mis-drag lost two things
silently. Time, window flag and pin are captured before the write and restored
together.

**A live verdict.** The window, time-block and prayer answers arrived only
after release, in a dialog. The block's ring now carries them while the finger
is down, computed from the same predicates the drop runs so the two can never
disagree. A warning outranks the green link ring: a link is a preference, a
prayer block is not.

### D-098 · Compaction is layout, not touch targets — **Requested**

The request was for the creation surfaces to be denser (*"pill button akan
membuang banyak space"*). The tempting reading — shrink every chip — would have
traded M10's ≥44 px touch targets for a few pixels.

What actually cost rows was *wrapping*: seven duration presets became two
lines, and quick capture's six attribute chips another. Those rows are single
and horizontally scrollable now, and `Chip` gained a `size="sm"` that buys its
touch target back with an invisible 8 px band above and below. That band would
overlap the next line in a wrapping row, so the small size is documented as
belonging only to single-row contexts; every wrapping call site keeps the
default.

The calendar header lost two rows the same way — the full-width planning button
became an icon beside the sync indicator, and the two-line totals became one.

### D-099 · Long-press to create an agenda had never worked — **Bug found in the browser**

Found while verifying the empty-day hint from D-098, which tells the user to
long-press an empty hour. Doing so did nothing, on any part of any day.

`TimelineDay`'s long-press handler is on the day column and guards with
`e.target !== e.currentTarget`, so it only fires on bare column space. But every
layer §7.2 stacks behind the agendas — the outside-window shading, each window
band, all 24 hour rules, the time-block bands, the busy bands, the prayer blocks
— is an absolutely positioned child covering that space. The shading alone is
`inset-0`, so `e.target` was never the column and the gesture returned early
*everywhere*. §8's "long-press empty area → create an agenda" had been dead
since M4.

D-086 records the identical trap in the slot picker, where one non-transparent
decorative layer silently swallowed every tap; the fix there was to make all of
them `pointer-events: none`. The same fix applies here, with `pointer-events:
auto` restored on the one child that is a control — the time-block skip button
from D-096.

Worth stating as a rule rather than a fix, since this is twice: **in a layered
timeline column, every layer is pointer-transparent unless it is a control.**
A `target === currentTarget` guard cannot enforce it, because it fails silently
and the feature merely looks implemented.

### D-100 · A committed drag no longer opens the sheet behind its own dialog — **Bug found in the browser**

Releasing a move fired the block's `onClick` as well. The guard was
`onClick={() => !drag && onOpen()}`, but `cleanup` sets `drag` back to `null`
synchronously *before* React processes the click, so the guard was always false
by then. Every drag therefore ended with the agenda sheet opening — on top of
whatever the drop was asking, whether that was the prayer-shift dialog or the
link question.

The release now sets a ref that the next click consumes. This is the same
lesson as D-077, one layer up: gesture state that a later event has to read
cannot live in React state, because the reset always wins the race.

### D-101 · The buffer legend is icon-only in the header — **Bug found in the browser**

With the legend on the same row as the view switch, "⇄ Ganti fokus" and
"🚗 Perjalanan" ran off the right edge of a 390 px screen and took the new
24-hour toggle with them. `BufferSwatch` gained a `compact` form that keeps the
swatch and the icon and drops the word, with the word moved to `title` and
`aria-label` so nothing is lost to a screen reader. The day's totals moved to a
thin line of their own for the same reason — squeezed onto that row they
truncated, and the figure that got cut was the free hours, the one of the three
that actually drives a decision.

---

## Waktu sholat yang bisa dipersiapkan, dan ticker "sekarang / berikutnya"

### D-102 · The adhan sits in the middle of its block — **Requested, changes §5.3**

§5.3: "Five daily blocks, default 20 minutes each, **starting at the prayer
time**." Read literally — and it was — the block is pure prayer time. There is
not one minute in it to stop what you are doing, walk, or make wudhu, so the
first thing every prayer costs is time the scheduler had already given to
something else.

The block is centred on the adhan now, so its first half *is* the preparation.

**`duration_min` still means the whole block.** This was the choice worth
making, and it went the user's way rather than mine:

- the day's capacity does not move by a single minute — 20 minutes is still 20
  minutes, now 10 either side, so no existing plan is invalidated;
- the number in Settings still equals the length of the block it draws, which
  keeps the label honest.

The cost is real and accepted: the time *after* the adhan halves. That is the
user's own number to raise, and the Settings row now shows the range each
duration produces (`11:52 · 11:42–12:02`) right where it is edited, so the
trade is visible at the moment of choosing rather than discovered on the
calendar.

**Friday Dhuhr follows the same rule**, 45 minutes either side of the call
rather than 90 after it. An exception would have to be remembered by every
future reader of `resolvePrayerBlocks`, and leaving before the adhan is what
Jumu'ah actually looks like.

**`PrayerBlock.adhan` exists because centring took something away.** A block
that starts at the call to prayer tells you when the call is; one centred on it
does not. So the instant is stored, and both timelines draw it as a solid 2 px
rule across the band with the time on it — deliberately as heavy as the
now-line, because after this change it is the only thing on screen that answers
the question.

Two details found by measuring in the browser rather than by reading the code:

- the marker's wrapper was given a height and its contents centred, which put
  the rule half a label *below* the adhan — three minutes at 1.5 px/min, on the
  one mark whose entire job is precision. The wrapper is zero-height and
  anchored on the instant itself now.
- the prayer's name sat in the vertical middle of the band, so the new rule cut
  straight through it and read as a strikethrough. The name is pinned to the
  band's top edge — the start of the time to prepare, which is where it belongs
  anyway.

Everything downstream picked the change up without being touched, which is what
the pure module is for: `prayerBusy`, `buildFreeSpace` and `avoidPrayer` all
read the block's bounds, so D-093's shift dialog now offers 11:15–11:40 and
12:05–12:30 where it used to offer 11:25–11:50 and 12:15–12:40.

### D-103 · The ticker shows activities, not calendar blocks — **Requested**

A strip above every screen: what is running, what is next, how long until it.
The interesting part is not the strip, it is the definition, so the rule lives
in `lib/scheduling/upnext.ts` with 13 tests rather than inside the component.

**A `commute` buffer is an activity; a `switch` buffer never is.** Requested in
exactly those terms, and it falls straight out of what §5.2 already says the
two types mean: travelling somewhere is a thing you are doing, and the one you
most need warning about; a mental reset is time for the head to catch up, and
the agenda on either side of it already stands for it. The two types compose
differently precisely because they are different in kind — this is the same
distinction, one screen further on.

**`draft`, `cancelled` and `done` agendas are left out.** A draft was never a
commitment and a cancelled one is not happening. `done` matters more than it
looks: D-084 creates a retroactive agenda that *ends at the current instant*, so
without this rule the ticker would announce work the user had just finished as
what they are doing now — worse than saying nothing.

**`current` is whichever activity started most recently.** Overlaps are routine
here: a prayer block lands inside an agenda placed over it (§5.1 allows that), a
commute buffer abuts the agenda it belongs to. The most recently started one is
the thing just stepped into, and the one whose ending is the next transition.
Ties fall through to the earlier end and then to the key, so two devices showing
the same day cannot disagree — the determinism D-062 established.

**The hook deliberately does not use `useSchedulingWorld`**, even though it is
the obvious reuse. That hook mounts five live queries and resolves availability
windows, time blocks and Google busy time, none of which the ticker reads — and
unlike a screen, this one is mounted for the life of the app. It takes the two
live queries it needs and calls the same `resolvePrayerBlocks` the calendar
does, so the prayer times still cannot diverge.

Two smaller choices:

- **The countdown rides `useNow()`** (30 s, D-066) rather than starting a second
  timer for itself. The display is minute-granular, so the worst case is showing
  "5m" when 4m31s remain, which is not worth a second clock in a PWA whose
  battery cost the user notices.
- **With nothing to say, the strip does not render.** Turning every prayer off
  on an empty install leaves no row at all — a permanent empty bar would be the
  opposite of "ringkas dan hemat tempat".

The safe-area inset moved from each screen's header to the app shell as a
consequence: whatever comes first inside it — the ticker, or a header on the day
the ticker has nothing to say — has to clear the notch exactly once.

### D-104 · The shell is sized against the ICB once installed — **Bug reported from the device**

Reported as an empty band under the bottom navigation bar. Measured off the
screenshot (828×1792 px = 414×896 pt, iPhone 11 class), reading colour changes
down the centre column:

| band | pt | height | colour |
|---|---|---|---|
| top inset | 0–48 | 48 | `#f7f8fa` (page background) |
| ticker | 48–78 | 30 | `#ffffff` (surface) |
| tab bar | 762–848 | **86** | `#ffffff` (surface) |
| the gap | 848–896 | **48** | `#f7f8fa` (page background) |

Three things follow from those numbers, and they rule out the obvious suspect:

1. **The tab bar is correct.** 86 = 52 (`min-h-[3.25rem]`) + 34
   (`env(safe-area-inset-bottom)`). `safe-bottom` is doing its job, and the home
   indicator is drawn inside the *gap*, not inside the bar.
2. **The gap is 48, not 34** — so it is not a leftover bottom inset. 48 is this
   device's `safe-area-inset-top`, and an identical 48 pt band sits at the top
   of the screen.
3. **The shell's box is 848 tall on an 896 pt screen.** It is pinned to
   `h-dvh`, so the tab bar stops at the bottom of that box and the body colour
   fills the rest.

That the status-bar text is drawn *over* our top band proves the web view does
cover the whole screen — `viewport-fit=cover` and the black-translucent status
bar style are both in effect, and `env(safe-area-inset-top)` really is 48. Yet
`100dvh` came back as 848 = 896 − 48. iOS under-reports `dvh` by exactly the top
inset in an installed app with a translucent status bar.

**Not introduced by the ticker (D-103).** The shell has been `h-dvh` since M0,
so its bottom edge was always at 848 and the gap was always there. Moving the
top inset from each screen's `<header>` onto the shell only made the matching
48 pt band appear at the top as well, which is what made the pair legible.

The fix is a `standalone` custom variant plus `standalone:h-full` on the shell:
installed, the initial containing block is the honest number (`html`/`body` are
`h-full` and the shell is a direct child of `body`); in a browser tab `dvh`
stays, because there Safari's toolbars genuinely do change how much is visible
and that is the whole reason the unit exists.

**Limits of what was verified here.** There is no iOS in this environment, and
Chromium reports `env()` as 0 and `dvh` as the full viewport, so the fault
itself cannot be reproduced locally. What *was* checked: the generated rule
(`@media (display-mode:standalone){.standalone\:h-full{height:100%}}`), that it
follows `.h-dvh` in the cascade so it wins, that the browser-tab path is
byte-for-byte unchanged, and that forcing the standalone height produces a sane
layout — tab bar flush at 896, `document.body.scrollHeight` 896, no overflow.
The standalone path itself is confirmed on the reporter's phone.

---

## Event, pemilih slot untuk memindah, dan ticker yang lebih keras

### D-105 · Events — a commitment that is not a todo — **Requested, new entity**

Everything FOQUS puts on the calendar descends from a todo (an agenda), is
computed (availability windows, prayer blocks, time blocks), or is mirrored
from another Google calendar. A meeting, a class, an appointment — things that
fill a day without being work you scheduled — had nowhere to live, so the
allocator kept handing out hours that were already spoken for.

Requested explicitly as the stand-in for the Google Calendar sync, which the
user would rather defer than depend on. Four decisions inside that:

**Shaped after `time_blocks`, not after agendas.** Wall-clock times plus a
recurrence, rather than absolute instants. That is what makes "every Tuesday at
09:00" stay 09:00 in the user's own timezone, and it lets the expansion and the
per-date exceptions reuse a pattern that is already tested rather than inventing
a second one. Two differences from a time block are deliberate:

- `end_time` at or before `start_time` means the event ends the **next day**.
  `expandTimeBlocks` skips such a row, and rightly — a time block is a rule
  about a window, and a window that wraps midnight is a mistake. An event is a
  thing that happens, and 21:00–00:30 happens.
- a **skipped occurrence is returned, marked**, not dropped. Because the editor
  is reachable only by tapping the block (the user's choice — see the limit
  below), an occurrence that vanished could never be un-skipped once its undo
  toast expired. Callers that reason about *time* filter it out; the calendar
  draws it as a struck-through ghost that taps back.

**`EdgeKind`'s "agenda" variant became "buffered".** An event reserves its core
plus its buffers exactly as an agenda does, and `edgePaddingMin` only ever read
`edge.buffer`. §5.2 is a rule about two buffered things meeting, not about
todos, so the variant stopped claiming otherwise. The arithmetic is untouched
and D-028's worked examples are now pinned twice — once with an agenda as the
neighbour, once with an event.

**Prayer blocks get no special treatment.** Requested in those terms: an event
is a stretch of activity, and a prayer can be taken within it. Both are
obstacles in the free-space map and may overlap; `buildFreeSpace` merges
intersecting blockers so nothing is double-counted. What matters is that
`avoidPrayer` is only ever called on the *agenda* placement path, so an event is
never asked to move out of a prayer's way.

**Manual placement over an event is confirmed, not forbidden** (the user's
choice among three). It joins §5.1 and §5.4's family: one soft dialog, in the
same place, with the same button. A single pure `overlappingEvent` drives both
that dialog and the ring that colours while the block is still under the finger,
so the warning and the question cannot disagree. The Custom tab runs the same
check, or scheduling by typing a time would step over the very thing events
exist to protect.

**Not mirrored to Google.** §6.2 sends agendas; an event *is* the manual
stand-in for that sync, so sending one back would close a pointless loop.

**A known limit, accepted deliberately.** The user chose "tap the block on the
calendar" over a list in Settings. That means a repeating event whose `end_date`
has passed appears on no day and cannot be reached again — not to extend, not to
revive. The mitigation for skipped occurrences (drawing the ghost) does not
cover this one. If it bites, the fix is the Settings list that was declined.

### D-106 · Moving an agenda uses the same picker as scheduling one — **Requested**

Changing an agenda's date was a bare `<input type="date">`, which quietly
skipped everything the app knows about choosing a time: the suggested slots, the
prayer avoidance (D-093), the time-block confirmation, and the rule that a
parent may not begin before its subtasks (D-081).

Moving an agenda is the same question as scheduling it, so `ScheduleSheet` takes
an optional agenda and moves it instead of creating one. Three things change,
and nothing else:

- the duration starts from that agenda, not from the todo's remaining
  allocation;
- the world is built with `excludeAgendaIds: {id}` — without it the agenda
  occupies the slot it is trying to leave, and the most obvious answer, twenty
  minutes later, is never offered (the edge D-069 found for reschedule);
- the write goes through `updateAgenda`, which releases the "immediately after"
  pin exactly as every other manual placement does (D-087).

A pinned agenda's row stays disabled and says why: its start is derived, not
authored.

### D-107 · The ticker gets a second clock, and stays black in both themes — **Requested, relaxes D-066**

D-066 put every screen on one 30-second clock so the now-line, the missed-agenda
detector and the day header could not disagree. A countdown in seconds cannot
live on it, so `useNow` grew `useTick(intervalMs)`: one shared timer per
interval, started on the first subscriber and stopped after the last. Only the
ticker asks for 1000 ms; everything else still shares the 30-second clock, and
the guarantee D-066 was protecting is unaffected.

The fast clock drives **which** activity is current and next, not only the
digits. Driving only the digits would let the countdown reach zero and sit there
for up to thirty seconds, showing a "next" that had already started.

Clock style (`1:12:05`) rather than "1j 12m 5s": at one refresh per second the
digits have to stay in the same places, and a unit-suffixed form changes width
as the numbers shrink. Paired with `tabular-nums`.

The strip is black in **both** themes, which is the point — in the light theme a
surface-coloured bar merged into the header beneath it. It carries the `dark`
class rather than a new set of tokens, which re-resolves every custom property
inside it to the palette already designed to sit on black: the prayer teal, the
commute bronze, the event rose, the warning amber. Nothing is picked twice, and
a future colour inherits the treatment for free.

The pulse runs always rather than only under five minutes — a countdown that
sits still is just a number — and colour is what escalates. Both stay subject to
`prefers-reduced-motion` through the global rule (D-007).

---

## Commute buffer dihitung dari jarak antar lokasi

Requested: a commute buffer should be settable two ways — typed by hand, or
computed from the distance between locations — assuming each day starts at
home (which needs a map pin), with a location on an agenda or event producing
a commute and no location producing none.

Until now `commute` was only a *label*. §5.2 composed it correctly, D-082 drew
it, D-103 announced it in the ticker — but the number was always typed. These
entries record the rule that now produces it.

### D-108 · The day is a fold over places, and an unlocated block does not move you — **Requested, new rule**

`resolveCommute` (pure, `lib/scheduling/commute.ts`) walks each *local* day:

```
lastPlace = home at the start of the day
stop has a place → travel(lastPlace → it); lastPlace = it
stop has none    → no commute, and lastPlace does not move
```

The last clause is the whole reason this is a fold rather than a map over
pairs, and it is the user's own framing ("jika tidak ada, dianggap tidak ada
commute buffer") taken to its conclusion. Work with no location attached is
done wherever you already are, so it is not a journey — and it must not
teleport you either. An errand between two blocks at the office cannot make the
second one look like a fresh trip from home.

Stops are sorted inside the function rather than trusted, so the answer cannot
depend on the order a live query happened to return, with the key as the final
tiebreaker — the determinism D-062 established, for the same reason.

**Home is deliberately not seeded.** `settings.latitude/longitude` already
exist and would have been free to adopt, but they are the *prayer* coordinates
and default to a city centre the user has never confirmed. Measuring every
commute from a guess is worse than measuring none: without the pin the first
block of each day simply gets no commute, and the rest of the chain — between
places the user did choose — is still exactly right.

### D-109 · The estimate is written only to the arriving side — **Interpreted**

The schema allows one buffer type per side, and §5.2 takes the max within a
type and sums across types. So with the seeded defaults (`after = 10 switch`):

```
switch_need  = max(10, 0) = 10
commute_need = max(0,  T) = T
required_gap = 10 + T
```

Reset *and* journey, composed by the rule that already existed, with nothing
double-counted. Writing the journey to the departing block's `after` side as
well would replace its switch buffer and silently delete the mental reset —
which is precisely the overlap §5.2 exists to keep separate. `buffer_after_*`
is therefore never touched by the reconciler.

### D-110 · Agendas store the number; events derive it — **Interpreted**

Asymmetric, and each half is principled.

An **agenda** is one concrete instant. Its commute is a fact about that
placement, and the scheduler has to reserve the space as part of the row's
footprint (`agendaBusy` expands core ± buffers), so it is written to the row by
`applyCommuteMoves` — the counterpart of `applyChainMoves`, called from the
same places.

An **event** is a *rule*: wall-clock time plus a recurrence. Tuesday's
occurrence may be reached from the office and Friday's from home, so one number
on the shared row would be wrong on most days. It is derived per occurrence
onto `EventInstance.bufferBefore`, inside `expandEvents` — the function that
already exists to project the rule onto a date.

Both call the same `resolveCommute` over the same stops, so an agenda and an
event on the same day cannot disagree about the chain.

**Ordering inside `updateAgenda`: commute first, then chain.** `chainedStart`
is computed *from* the buffers, so a pinned follower would land on a stale gap
if the chain settled first. One pass each is enough, and the reason is worth
stating because it looks like it should oscillate: a chain move shifts a
follower in time but never reorders the day, so the commute it was just given
is still the right one.

### D-111 · The free-space map learns where you would be — **Filled a gap**

Without this the allocator reserved the default buffer and the reconciler then
widened it, so drafts placed back to back overlapped the moment they were
applied.

`FreeInterval` gained `originPlaceId`: where you would be when the interval
begins. It is the map's mirror of `resolveCommute`'s `lastPlace`, computed by
the same fold over the same stops — which is what makes the space a slot
reserves identical to the buffer the row is later given.

**No new arithmetic.** `commuteBufferFor` only decides *which* `BufferSide` a
candidate is charged; `edgePaddingMin` composes it against the neighbour's own
buffer exactly as before. A slot after a switch-buffered block reserves reset +
journey; one after a longer commute reserves only the shortfall. The three §5.2
worked examples are untouched and still pass.

**A draft counts as a waypoint**, unlike in D-103's ticker. The allocator
threads its own placements through the map as it goes, so if the reconciler
ignored them, the space reserved for a second session at the same place and the
buffer later written to it would disagree — the one thing these two must never
do.

### D-112 · Straight-line distance, corrected — no routing API — **Filled a gap**

§3.1 forbids the UI blocking on the network and `docs/PHASE2.md` rules out
server-side scheduling, so a routing API is out. The model is:

```
km      = haversine × 1.35            (COMMUTE_DETOUR_FACTOR)
minutes = km / speed × 60 + 5         (COMMUTE_OVERHEAD_MIN)
          rounded UP to the 5-minute grid
```

The detour factor sits at the low end of the usual 1.2–1.5 for a dense grid,
because the flat overhead already covers the fixed costs and over-reserving
fragments a day. Rounding is *up*, never nearest: a buffer slightly too long
costs some slack, one slightly too short makes you late, and those are not
symmetric. Below 150 m two pins are the same building with a different GPS fix
and cost nothing.

Speed presets are door-to-door averages: walk 4, motorbike 22, **car 18**. The
car being slower is not a typo — in Indonesian city traffic a motorbike filters
and parks almost anywhere while a car queues and then hunts for a space.

Expect ±25% on a city trip. That is the right accuracy for something whose
entire job is to be slack, and it is stated here so nobody later mistakes it
for a routing result.

### D-113 · Leaflet, and a pin that does not move — **Deviated (§2)**

§2 fixes the tech stack and contains no map; a pin was asked for explicitly.
Leaflet rather than MapLibre: raster OpenStreetMap tiles need no API key, and
~45 KB against ~800 KB matters in a PWA whose point is opening instantly. No
`react-leaflet` — the wrapper is ~120 lines and one fewer dependency to keep in
step with React's majors. It is loaded through `next/dynamic` only when the
picker opens, so it never enters the initial bundle.

**The pin is fixed at the centre and the map moves beneath it.** That sidesteps
Leaflet's default marker images, which break under every bundler because the
CSS references them by relative path, and it is the better touch interaction
anyway: a dragged marker spends the whole gesture under the user's thumb, which
is exactly where they cannot see it.

Tiles are the only part of this app that genuinely needs the network, so there
are two fallbacks that do not — geolocation and manual coordinates — and a
capped `CacheFirst` runtime cache in `app/sw.ts`, so a pin near home or the
office still draws with the network off. Verified in a browser with tiles
blocked: the map greys out, says so, and the coordinate fields still work.

### D-114 · Manual always wins, and handing it back re-derives — **Requested**

`commute_auto` (0/1, on agendas and events). Typing a buffer by hand sets it to
0 inside `updateAgenda`/`updateEvent`, so the rule is structural rather than
something each call site has to remember. The reconciler then never touches
that row again until the user asks for the estimate back — and handing it back
recomputes from the *current* day rather than restoring an old number, because
the day has probably moved since.

The two states are what the request's "manual atau dihitung" actually looks
like in the sheet: with a location the figure is *shown* rather than asked for,
with both ends and the distance next to it so it is explicable rather than
magic, and one tap crosses in either direction.

### D-115 · `ENTITY_TO_TABLE` was missing events — **Bug, found while editing the same map**

Outside the request, and two lines. `lib/sync/engine.ts` mapped every outbox
entity to its table except `event` and `event_exception`, which
`TABLE_TO_ENTITY` had been producing since events were added. `pushEntry` threw
`Unknown outbox entity: event`, the entry failed five times and was parked as
`blocked` — so no event mutation ever reached Postgres. Invisible without
Supabase configured (D-008 makes unconfigured behave like offline), which is
why it survived.

### Verification

Checked in a real browser (390×844, Asia/Jakarta), driving the actual UI rather
than the repositories, with two places 4.1 km apart:

- **The chain, end to end.** Three blocks on one day came out as
  `14:10 Kantor → 20 commute` (the journey from home), `15:20 Kantor →
  0 switch` (already there), `15:55 no location → 0 switch` (not a journey, and
  it did not move the chain).
- **The sheet explains the number** — "20m · Rumah → Kantor · ± 4,1 km".
- **The band and the ticker** — the bronze commute band draws in the twenty
  real minutes before the block, and the ticker announced "Berangkat ke Rapat"
  from the computed buffer.
- **Manual and back** — "Atur manual" set `commute_auto = 0` and a typed 45 held
  through a subsequent edit; "Hitung otomatis" restored 20 and set it back to 1.
- **Tiles blocked** (the sandbox proxy refuses OpenStreetMap, which is the
  offline case for free): the map greys out, says "Peta perlu internet", and the
  coordinate fields still place the pin.

`npm run lint`, `npm run typecheck`, `npm run build` clean; 340 Vitest tests
green, including the three §5.2 worked examples unchanged.

---

## Perbaikan setelah pemakaian: judul di 3 hari, reschedule, dan editor tempat

Three things reported from the device. Each turned out to be a rule rather than
a component, so each is recorded.

### D-116 · A narrow column is a reason to stack, never to crowd one line — **Bug**

Reported as a title showing a single character in the 3-day view.

`AgendaBlock` and `EventBlock` both computed `short = height < 40 || compact`.
D-078 introduced that: a one-pomodoro block is ~38px and used to hide its time
range entirely, so short blocks put the range *beside* the title. But `compact`
(the 3-day view) forced the same layout regardless of height — and there the
range is `shrink-0` at ~85px inside a ~110px column, leaving the title about
one character. A three-hour block with room for four lines was being squeezed
onto one.

Narrowness and shortness are opposite problems and were being answered with the
same layout:

- `short` is now **height alone**. A tall block in a narrow column stacks, which
  is what the space actually allows.
- Where a block genuinely is one line *and* the column is narrow, the **start
  time** stands in for the range. D-078's rule — never hide the time — is kept;
  only its precision gives way, and only where nothing else fits. The end is
  legible from the block's own extent anyway.
- The stacked title is `line-clamp-2`. Overlapping blocks split the column
  (D-036), so two of them in a 3-day view land in ~45px each; a second line
  buys back most of what that costs. **Without** `break-words`: allowing
  mid-word breaks produced "Menyi / apk…", which reads as a typo rather than a
  truncation.

### D-117 · Rescheduling a missed agenda is the same question as scheduling — **Requested, completes D-106**

D-106 replaced the agenda sheet's bare `<input type="date">` with the real
picker. §5.8's "Jadwalkan ulang" was the same gap one screen over and was
missed: the review sheet had its own three chips plus a date-and-time pair,
which skipped the calendar tab, the prayer avoidance (D-093), the time-block
confirmation, the event overlap check (D-105) and the parent-before-child
refusal (D-081) — every rule that makes a placement trustworthy.

It now opens `ScheduleSheet` with the agenda to move, exactly as the agenda
sheet does. `RescheduleSheet`, `RescheduleBody` and `ManualReschedule` are gone
with it; there is one scheduling flow in the app again.

One rule moved with it, into `ScheduleSheet`'s move path rather than the review:
**giving a missed agenda a new time restores it to `planned`.** That is what
answering §5.8's third action means, and it has to hold wherever the move is
made from — the review sheet, the agenda sheet, a drag — or the agenda stays in
the queue it was just answered out of.

### D-118 · The pin was drawn underneath the map — **Bug**

Reported as "pin map tidak terlihat di atas maps".

Leaflet gives its own panes `z-index: 400` (tiles) through 700. The centre pin
was an absolutely positioned sibling with `z-index: auto`, so it lost to them
however late it came in the DOM. It was visible in local testing only because
the sandbox proxy blocks OpenStreetMap and the tiles never painted — the
failure mode hid the bug behind itself.

`z-[500]` puts it above the tiles and below Leaflet's own controls. The marker
is also a real teardrop now, with a white ring and a drop shadow, plus a small
dot at the point it rests on: a flat accent-coloured dot disappears over a road
or a pale field, which is most of a map.

### D-119 · A place was write-once — **Bug (three reports, one cause)**

Renaming lived in an unlabelled inline input in Settings, deleting lived on a
trash icon in the picker, and the **coordinates could not be changed at all**
once saved — the one field the whole estimate is made of. Reported as three
separate difficulties; it was one: there was no editor.

`PlaceEditorBody` is now the single form for a place, whether being created or
corrected — map, name, coordinates, "lokasi saya sekarang", and delete. The
picker swaps its own content to show it (a pencil on each row), and Settings
opens it as a sheet of its own, so both routes reach the identical form.
Creating from the picker also *picks* the new place: the user opened it to
answer "where", and making them tap the new row would ask the same question
twice.

**The form must not mount before its row arrives.** It holds a draft rather
than rendering live — the map has to pan freely without a live value yanking it
back — so a `useState` initialiser reading an unresolved live query seeded the
name with `""` and the coordinates with the *city default*, and saving then
quietly moved the pin the user came to correct. It now waits for the query to
answer (`undefined` = in flight, `null` = gone) and mounts keyed on the row.
This is D-076's lesson one layer along: a component that both writes a row and
renders it must read it live — and where it genuinely must hold a draft, it has
to wait for the row before taking one.

### Verification

Driven in a browser (390×844, Asia/Jakarta):

- **3-day view** — a 2½-hour agenda and a 3¼-hour event now read
  "Menyiapkan / materi… / 10:00–12:30" and "Belajar / bahasa… / 11:00–14:15",
  against one character before. Overlapping in one column they still truncate,
  which is D-036's split and the width of the phone.
- **Reschedule** — "Jadwalkan ulang" opens "Pindahkan agenda" with the duration
  presets and the Daftar / Kalender / Custom tabs.
- **Place editor** — created "Rumah", reopened it from Settings with the name
  and coordinates *pre-filled*, changed both, and deleted another through the
  confirmation with its undo toast.

---

## UI yang padat, dan hari sebagai unit perencanaan

Two requests, taken together. The app was dense in *features* and loose on
*screen*: on a 390×844 viewport the chrome came to roughly 39 % of the display,
and under it the rows still carried shadcn's default breathing room. The ask was
to tighten rows and spacing **without** shrinking the header or the ticker or
what they say, to fold away fields that had gone orphan or redundant, to let an
icon carry anything a word was carrying alone — and to shelve weekly planning
for now, because the planning that matters today is daily.

### D-120 · `tap-44`: compaction still pays for its touch targets — **Interpreted**

D-098 settled the principle ("compaction is layout, not touch targets") and
`Chip size="sm"` was its one implementation: an invisible band restoring the
44 px M10 asks for. This pass needed the same trick in eight more places, so the
band is now a Tailwind utility, `tap-44`.

It is a **fixed 2.75rem band centred on the control**, not a symmetric negative
inset. That matters: one utility then serves every height the app compacts to —
a 36 px icon button gains 4 px a side, a 28 px chip gains 8 — and no call site
has to work out its own arithmetic. `Chip size="sm"` was refactored onto it, so
there is one definition rather than two that can drift.

Applied by default to `Button size="iconSm"` and to `Segmented`'s items, because
both live in single toolbar rows by construction. Deliberately **not** applied to
`Button size="sm"`: that one turns up inside stacked list rows, where the band
would reach into the row below — exactly the overlap D-098 warns about. The two
`sm` call sites that *are* on a toolbar row (the calendar's "Hari ini", the audio
preview in Settings) opt in by hand.

Measured before and after, counting every `button`, `a`, `[role=button]` and
`input` on each screen whose effective hit box — pseudo-element included — is
under 44 px:

| screen | before | after |
|---|---|---|
| Tugas | 14 | **1** |
| Kalender | 10 | **1** |
| Hari Ini (was Pekan Ini) | 12 | **1** |
| Pengaturan | 87 | **1** |

The one that remains on each is the `NowTicker` strip, which is a full-width
link rather than a control, and which this pass was asked to leave alone.

### D-121 · The header loses its words, never its information — **Requested**

The instruction was explicit: do not cut the header's size or its content, but
where an icon can carry something, let it.

The calendar's fourth row was "3 agenda · 8 pomodoro · 4,5 jam bebas" — three
figures wrapped in words that never change. The words were the row. The figures
moved up beside the day navigation as icon-and-number (`CalendarDays`, `Timer`,
`Hourglass`), and each keeps its full sentence in `title`, which is also what a
screen reader announces. Nothing is lost; a row of timeline is gained.

Two consequences worth recording:

- **The date shortened with it.** Sharing that row, `formatDateFull` ("Jumat, 4
  September 2026") truncated to "Jumat, 4 Sept…" — losing the year *silently*.
  `formatDateWithWeekday` ("Jum 4 Sep") fits whole, and the full date moved to
  `title`. A short form that fits beats a long one that gets cut.
- **The same reasoning ran over the Tasks header**, where the "Tampilkan
  selesai" chip became an eye toggle. That one buys width, not height: it is
  what stops the grouping control from truncating.

Header heights, measured: Kalender 176 → 143 px, Tugas 153 → 141 px, both with
the same information on screen.

### D-122 · A task row stacks only when it has to — **Interpreted**

The row was always two lines: title, then a meta line for due date, subtask
count and tags. A todo with none of those still paid for the second line, and a
todo with one paid for a whole line to hold one badge.

The row now counts its metadata (`taskMetaCount`) and puts a single kind inline
beside the title, keeping the second line for two or more. The cutoff is
deliberate and is D-116's rule read forwards: *a narrow column is a reason to
stack, never to crowd one line* — one figure fits after a truncating title, two
start eating it.

What makes the inline case fit at all is that the figures became icon plus
number — `CalendarDays 4 Sep`, `ListTree 2/5` — with the sentence in `title`,
the same move as D-121 one level down.

Row height 53 → 45 px (`min-h-11`, i.e. exactly M10's floor, not under it), and
the checkbox inside it gained `tap-44` so shortening the row could not shorten
its hit area. On a 390×844 screen the list went from 11.4 rows to 13.7.

### D-123 · The day is the planning unit; §7.3 is shelved, not deleted — **Requested**

§7.3's Pekan Ini is switched off for now. The tab is **Hari Ini**, and the
scheduling engine underneath is untouched: `lib/scheduling/allocate.ts` is
called with `from = to = today` and nothing else changed. The 340-test suite
passes unmodified, which is the evidence that this is a UI change and not a
rules change.

What the screen shows, in the order the questions get asked:

1. **Capacity**, from `freeMinutes(world.free)` — the same free-space map the
   allocator will use, so the meter cannot promise a slot the allocator cannot
   place (D-064, unchanged).
2. **Rencana hari ini** — the day's agendas, with a **Mulai fokus** button on
   the next unfinished one. One tap from planning to working, which is the whole
   reason a daily screen is worth having.
3. **Kandidat** — what still has pomodoros left to place, selectable.
4. **Alokasikan** — appears only once something is selected, pinned above the
   tab bar. A full-width primary button parked over an empty list is a row of
   screen spent on a disabled control.

`/week` stays as a redirect to `/today` rather than disappearing: a service
worker installed before this change still precaches it (D-002), so an installed
PWA can reach the old route once more before the new worker takes over.

### D-124 · There is no "target hari ini" flag, and `focus_week` retires in place — **Interpreted**

D-088 committed weekly targets to `focus_week` so a half-finished plan survived
closing the wizard. The daily screen needs no equivalent, because **the plan is
the day's agendas** — a commitment on a timeline, which survives rather better
than a checkbox. The selection on the Kandidat list is therefore ephemeral
state: it lives exactly as long as it takes to press Alokasikan.

`todos.focus_week` keeps its column and its Dexie index; only the UI and
`setFocusWeek()` are gone. The request was to shelve the weekly concept
*temporarily*, and dropping the column would mean a Dexie v3 plus a Supabase
migration now and two more to undo it — for data that harms nothing while it
sits there. That is D-060's reasoning (a deleted category's dangling references
are left alone) applied to a column.

### D-125 · The wizard is two steps, and the second one allocates — **Requested**

The third step walked the chosen todos through `ScheduleSheet` one at a time,
in MIT order. That is the right shape for a week and the wrong one for a day:
across seven days a deliberate placement per task is worth the taps, within one
day the allocator gets it right in one press and any correction is a drag on the
timeline that is already open.

So step 2's button *is* the allocation. It writes the MITs as `priority = 1`
first (D-088's reasoning holds — priority is the field the sorter, the grouping,
the allocator and the task row all already understand), runs the same
`allocateDay` the Hari Ini screen runs, then celebrates (D-089) and lands on the
calendar in draft preview. `ScheduleSheet` still owns the ordinary "Jadwalkan"
path, so no scheduling flow was lost — there is simply one fewer way in.

### D-126 · One `allocateDay`, because two would diverge — **Filled a gap**

Two screens now ask for "smart-allocate this day": the Hari Ini list and the
wizard. Copied, the two would drift apart on exactly the details that are easy
to get wrong and invisible when wrong — the parent-ordering floor from
`existingEndByTodo` (D-081), and passing `places`/`commuteSpeedKmh` so the
allocator reserves the same buffer the reconciler will later widen (D-061's
class of bug).

`lib/agendas/allocate-day.ts` assembles the call and writes the drafts. It is
app-layer, not `lib/scheduling/` — it touches Dexie — and it adds no rules of its
own; every rule it applies is one the pure module already owns.

### D-127 · Where the whole row is the control, the checkbox stops being one — **Bug found in the browser**

Caught by the touch-target audit, not by review. The Kandidat row had a 20 px
`Checkbox` and a 20 px line of text as two separate controls inside a 44 px row,
so the audit reported two failures per row — and a real `Checkbox` inside the
row's own `<button>` is a `<button>` inside a `<button>`, which is invalid
markup. (The planning wizard had shipped the same nesting since D-088.)

`CheckIndicator` is the fix: the look of a checkbox with none of its behaviour,
`aria-hidden`, with the row's button carrying the `aria-pressed` and the label.
One control, one 44 px target, valid markup. Both call sites use it.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean; the Vitest
suite is green at 340 tests, **unchanged** — no test needed editing, which is
the point.

Measured in Chromium at 390×844, Asia/Jakarta, against the same build with the
same seeded data:

| | before | after |
|---|---|---|
| Tugas: header | 153 px | 141 px |
| Tugas: row height | 53 px | 45 px |
| Tugas: rows in view | 11.4 | **13.7** |
| Kalender: header | 176 px | 143 px |
| Kalender: timeline in view | 583 px | **616 px** (+22 minutes at 1.5 px/min) |
| Hari Ini: header | 139 px | 86 px |
| Hari Ini: rows in view | 11.5 | **15.3** |
| Pengaturan: scroll height | 4242 px | **3841 px** |

Driven end to end: three todos seeded through quick capture → **Hari Ini**
reported "Terpakai 0 / kapasitas 36 pomodoro" → all three selected → **Alokasikan
3 tugas** → landed on the calendar with the "Terapkan 3 draf" bar → applied →
back on Hari Ini the plan read 08:16, 08:51, 09:26 and the meter moved to
"Terpakai 3 / kapasitas 35" (the day lost more than three pomodoros of capacity
because the buffers are real space, which is the honest answer) → **Mulai fokus**
opened the running timer. `/week` redirected to `/today`. Both themes checked on
all four tabs, and the calendar header in day and 3-day view.

---

## Audit terhadap anti-slop, dan UI yang lebih sedikit ketukan

Requested: enhance the UI and UX so it works as a productivity app — fewer taps,
fewer unnecessary fields, a more compact UI, an icon wherever a word is carrying
something alone — with `github.com/miqdadbadjuber/anti-slop` as the audit guide.

anti-slop offers two modes and asks which applies. **Mode 2** was chosen: audit
first as a numbered list, then fix what is picked. The findings live in
`anti-slop/audit-001-2026-09-06.md` with the rule each one breaks, the priority
its tier implies, and the measured evidence. What follows is only the entries
where a *rule* changed rather than a component.

### D-128 · `--fg-subtle` had never passed AA, in either theme — **Bug found by the audit**

The largest thing the audit turned up, and it had been there since D-005.
`--fg-subtle` paints captions, task metadata, hints, the calendar's day totals
and every settings sub-label — 81 uses across 31 files — always at 11, 12 or
13 px, so R-25's 4.5:1 normal-text bar applies and never the 3:1 large-text one.

Measured, not eyeballed. The old values against the four surfaces they can land
on:

| | `--bg` | `--surface` | `--surface-2` | `--surface-3` |
|---|---|---|---|---|
| dark `#6b7480` | 4.11 | 3.79 | 3.45 | 3.04 |
| light `#858d99` | 3.15 | 3.35 | 3.01 | 2.76 |

Eight failures out of eight. The guide is blunt about why this survives review:
the eye overestimates contrast on grey pairs, so a grey-on-grey claim is the most
common accessibility hallucination there is, and the only defence is to compute
it.

Now `#8a939f` and `#5f6772`, which measure 4.63 and 4.71 on the *worst* surface
and better on the other three. Light's `--fg-muted` moved to `#4d5560` with it:
raising subtle without moving muted would have closed the gap between two of the
three text weights, and three legible steps is what the hierarchy is made of.

**The first attempt at this fix was itself wrong**, and is worth recording. It
tested `--bg`, `--surface` and `--surface-2`, shipped a value that passed all
three, and would have left `--surface-3` — the deepest surface, and the one
inside every raised card — failing at 4.18. A token is only fixed against every
surface it can land on, not the ones that came to mind.

### D-129 · A screen heading that repeats its own tab is a row of chrome — **Interpreted**

§7 gives four tabs and names them Tugas, Kalender, Pekan Ini and Pengaturan.
Every screen also rendered an `h1` with that same word, directly above a tab bar
already showing it highlighted. On a 390×844 phone that is a row spent telling
the user where they already know they are.

`ScreenTitle` now renders the heading `sr-only` and returns its actions as a
compact group the caller drops onto its own first row of controls. The heading
survives — a screen reader has no tab bar to look at, and the document still
needs one — and only the pixels go.

Where the actions landed differs per screen, and each was a placement rather than
a sweep: Tugas puts the sync chip on the progress row, Hari Ini puts the planning
button and the sync chip beside the capacity meter, Kalender moves both onto the
view row (which F-16's icon switch had just widened by ~90 px). **Pengaturan lost
its header entirely**: it held one control, a sync chip whose link went to
`/settings`, the screen it was already on, and every fact it summarised is stated
in full by the Sinkronisasi section below it.

Measured, against the same build with the same data: Tugas 141 → 101, Kalender
143 → 101, Hari Ini 86 → 60, Pengaturan 53 → 0. The before column reproduces
D-127's own figures exactly, which is what makes the comparison worth quoting.

### D-130 · A confirmation in front of a reversible action is a tap, not a safety net — **Interpreted**

Three delete paths looked like one finding and turned out to be three, which is
why they are recorded separately rather than swept.

- **An agenda** opened a `ConfirmDialog` *and* then offered an undo toast. §4.3
  requires the copy to say the todo survives, and `t.agenda.deleted` is
  `t.agenda.deleteConfirmBody` word for word — the requirement was already met by
  the toast. The dialog asked the user to decide twice about something the next
  tap could undo. Gone.
- **An event** kept its dialog. Its body says something the toast does not: that
  deleting a recurring event removes every occurrence. A user looking at one
  block on one day cannot infer that, so the confirmation is doing real work.
- **A category** was the opposite of the finding as first written. It had a
  confirmation and *no* undo, so the dialog was the only thing standing between a
  tap and a lost category. It now has the better trade: the delete happens, and
  the toast carries both the consequence and the inverse. The delete was already
  soft (§3.2), so the inverse is exact.

The general rule, since this is the second time it has come up after D-096: a
dialog earns its tap by carrying information the action's own feedback cannot. If
it only repeats what the toast will say, it is a tax on the common case.

### D-131 · The task list's search had been written but never wired — **Bug**

`TaskFilter.query` matches a todo's title, notes and tags in
`lib/todos/grouping.ts`, is honoured by `visibleRoots`, and was initialised to
`""` in `tasks-screen.tsx` and never set again. A finished capability with no way
to reach it, on the one screen where a long list is the expected state, while the
Hari Ini screen — with a much shorter list — had a search box all along.

A magnifier toggle in the header, in D-121's idiom: the glyph carries the word,
the word survives in `aria-label` and `title`, and the field appears only while
it is in use so the default header height is unchanged. Closing it clears the
query, because a list still filtered by a field the user can no longer see is a
list that looks broken.

### D-132 · Rare fields fold; they are never deleted — **Requested**

The instruction was to reduce unnecessary fields, and the choice made was to fold
rather than cut, so nothing loses its home.

`components/ui/disclosure.tsx` is the one primitive, and `Section` grew the same
behaviour for Settings. Three surfaces adopted it:

- **The task detail sheet** was ten field groups in a flat column with
  "Jadwalkan" — the most valuable thing in it — below the subtasks and the
  dependency picker. Notes, tags, the default place and the dependencies fold
  into one `Detail lainnya`; the agendas block moves directly under the estimate.
  The fold **opens by itself when it already holds a value**, or the sheet would
  hide state the user set and cannot see.
- **Quick capture** had a category select and a date input sitting between the
  title field and the keyboard, and that date input duplicated the "Hari ini"
  chip three chips above it. Both fold, on the same open-if-set rule.
- **Settings** folds the five sections that are answered once — the productive
  hours, the location, the default buffers, the prayer durations, the time blocks
  — plus Sinkronisasi, which is diagnostics and only wanted when something is
  wrong. The order stays the one §7.5 specifies; only what is expanded changes.
  Scroll height 3841 → 1588 px, and Pomodoro, Kategori and Tampilan are now
  reachable without a scroll past thirty controls.

The open state persists per section in `localStorage`, seeded during render
rather than pushed from an effect. That is safe here and only here: `BootGate`
renders nothing until IndexedDB is ready on the client, so no settings section is
ever server-rendered and there is no first paint for the value to disagree with
(D-071's rule, and the one place its exception genuinely holds).

### D-133 · The glyphs the guide names, and the one it was right about — **Interpreted**

R-04 lists the icons that mean "generated" rather than "chosen". Three findings,
and they did not all deserve the same answer:

- **`Sparkles` on "Alokasikan otomatis"** is the guide's first example, and it
  was fair. The action means "put these tasks on the calendar", which is a shape;
  it is `CalendarRange` now, in both call sites.
- **A literal 🍅** in quick capture's estimate chip was the app's only emoji.
  Replaced with `Timer`, which already means pomodoro in the calendar header, so
  the two say it the same way.
- **Lucide as the whole icon set** is flagged by the guide as a library look
  chosen by default. Kept, with the reason written down rather than ~57 icons
  rehomed: the set is a single stroke weight and a single corner radius at every
  size the app uses, from the 12 px figures in the calendar header to the 24 px
  FAB, and this UI leans on icon-for-word substitutions (D-121, D-101, and F-16
  below) often enough that a set which stays legible at 12 px is doing real work.
  A mixed set would cost that consistency to avoid a resemblance.

Two the guide would flag that were kept deliberately: `Flame` for the streak and
`Star` for the three most important tasks. Both are conventions the user already
reads, and neither is decoration — they label a number and a rank.

### D-134 · The countdown pulses for the last five minutes, not all day — **Interpreted, narrows D-107**

D-107 made the ticker's countdown pulse always, on the reasoning that "a
countdown that sits still is just a number". The strip is mounted for the life of
the app, so that is a permanent animation on a screen the user is trying to work
on, which is exactly what R-19 means by motion that runs on a loop rather than
guiding attention.

The colour escalation was already there (`soon` switches to `text-warning`) and
the movement now escalates with it. D-107's point survives where it is actually
true: in the last five minutes, when a number that sits still is a number you
miss.

### D-135 · One tab-bar offset, because five had drifted into two — **Bug**

Five things float above the tab bar and each re-derived its height by hand:
`4.25rem + env(safe-area-inset-bottom)` in the FAB, the focus pill and the
toaster, `3.25rem + …` in the draft bar and the allocate bar. Two numbers for one
measurement, which is why the FAB and the draft bar could overlap on the calendar
after an allocation.

`above-tabs` and `above-tabs-gap` in `globals.css`, beside `safe-bottom` and
`tap-44`: one clears the bar, the other clears it plus a thumb. All five call
sites use one or the other, and there are no hand-written insets left in
`components/`.

### D-136 · Two identical steppers, and one label that was punctuation — **Filled a gap**

`CompletionPrompt` (D-084) and the missed-agenda review (§5.8) each asked "how
many pomodoros?" with their own copy of the same `− N +` control, identical but
for a font size — two places for the clamp at zero to drift apart.
`PomodoroCountStepper` is the one of them.

Both copies also labelled their buttons `aria-label="-"` and `"+"`, which a
screen reader reads as punctuation. They use `t.common.decrease` and
`t.common.increase`, which already existed and were already used elsewhere.

### D-137 · The "immediately after" link had no path without a pointer — **Bug**

D-087 stored the relationship, D-091 made the drag create it, and between them
that became the *only* way in: `follows_agenda_id` could not be set without a
pointer gesture, which is R-32's mouse-only pattern applied to a stored fact.

The agenda sheet now offers it wherever the block already rests against a
neighbour, using the same `abuttingPredecessor` and the same 6-minute settled
tolerance the drop path uses, and gated by `wouldCycle` for D-091's reason: an
offer the write would refuse is worse than no offer. The gap still comes from
§5.2's composed rule. One rule, two ways to reach it.

### D-138 · The agenda sheet folds too, and `moreDetail` moves to `common` — **Extends D-132**

Not a new rule; the third surface D-132 applies to, flagged during that pass and
left out of the approved set until it was asked for.

The sheet's body was ten blocks and the last three were the set-once ones: a
title that already defaults to the todo's, a place, and the two buffer fields
with their type swatches and the commute auto/manual toggle. Roughly eight
controls sitting *below* the two the sheet is opened for, Durasi and Jadwal. On
an 844 px viewport the sheet opened 723 px tall.

Two boundaries worth stating, because both were live choices:

- **The warnings and the chain cards stay outside the fold.** `outside_window`,
  `gcal_conflict` and the two "mengikuti / segera setelah" cards are alerts, not
  fields, and an alert that has to be unfolded is not an alert.
- **`defaultOpen` counts a hand-typed buffer.** D-132's open-if-set rule reads
  here as "anything the defaults would not have produced": a title override, a
  place, `commute_auto = 0` (the user typed a buffer, D-114), or a buffer that no
  longer matches Settings. A located agenda therefore usually opens its fold,
  which is the right trade rather than a leak — a place implies a computed
  journey (D-108), and a journey is exactly the thing worth seeing.

`moreDetail` moved from `tasks` to `common` with this. Three unrelated surfaces
now share the label, which puts it in the same family as `save`, `cancel`,
`search` and `today` rather than duplicated into a second namespace.

Measured at 390×844, same build, same data: the sheet 723 → 444 px, its body
581 → 303 px closed and 637 px opened. Verified in both themes, and verified that
setting a title override and reopening finds the fold already open.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean; the Vitest
suite is green at **340 tests, unchanged** — not one needed editing, which is the
evidence that none of this reached a scheduling rule.

Driven in Chromium at 390×844, Asia/Jakarta, in both themes, with the console
watched throughout (clean) and horizontal overflow measured at 0 on every screen.
The full click-through, the before/after chrome measurements and the contrast
table are in `anti-slop/audit-001-2026-09-06.md`; the headline numbers:

| | before | after |
|---|---|---|
| Tugas: content area | 618 px | 658 px (13.7 → 14.6 rows) |
| Kalender: timeline in view | 616 px | 658 px (+28 minutes at 1.5 px/min) |
| Pengaturan: scroll height | 3841 px | 1588 px |
| Agenda sheet on open | 723 px | 444 px |
| delete an agenda or a category | 2 taps | 1, undoable |
| find a task in a long list | scroll or re-group | 1 tap, then type |

**Two findings were recorded and deliberately not fixed.** Completing a task
still costs a modal: making it one tap would reverse part of D-084, which was
asked for on purpose, so it is written up in the audit as F-20 and left for a
decision rather than taken. And `--busy` fails 3:1 as a raw colour pair but is
only ever a 20–25 % alpha band behind the timeline, never text or a boundary, so
it is recorded as a false positive (F-21) rather than "fixed" into something
louder than the agendas it sits behind.

**R-37 is reported as a FAIL.** There is no `DESIGN.md`, by choice, so this pass
is labelled *draft without direction* with the honest default dials
ENERGY 1 / RHYTHM 1 / MOTION 1. The de-facto system it was actually held to —
D-005's tokens, D-006's font stack, D-098 and D-120 on compaction, D-121 on
icons — is real, but it is not written as direction and the gate does not get to
pretend otherwise.

---

## Gerbang akses, dan Google Calendar yang diatur di dalam app

The session that started the real integration work: a Supabase project and a
Google Cloud client about to be filled in for the first time. Three things were
asked for — wire up the database, wire up Google Calendar, and *"pastikan
settingnya bisa dilakukan di appnya (bukan hard code belakang layar)"* — plus a
password in front of everything so the deployment is not readable by its URL.

Three answers were chosen before any code was written, because each changes the
shape of the work: the Google **client secret** stays in the environment while
everything else moves into the app; the gate password is an environment secret
with a signed cookie; the Supabase URL and anon key stay environment variables.

### D-139 · Credentials in the environment, preferences in the app — **Requested, the dividing line**

"Bukan hard code belakang layar" needed a line drawn, because two things were
behind the scenes and they are not the same kind of thing.

One is the OAuth client — id, secret, redirect origin. That is a *deployment
credential*. Moving it into a table the browser can write would mean the app
handing itself the ability to change which Google project it speaks to, and
storing a client secret somewhere a compromised session could read it. It stays
in `.env`.

The other was everything else, and all of it really was hardcoded:

- the target calendar was found or created by the literal string `"FOQUS"`
- every other calendar counted as busy, unconditionally
- the sync window was `−7 / +30` days, written twice inside the route handler
- there was no way to stop writing to Google short of disconnecting the account

Those are preferences. They now live in the settings row — `gcal_enabled`,
`gcal_calendar_id`, `gcal_calendar_name`, `gcal_write_enabled`,
`gcal_busy_enabled`, `gcal_busy_calendar_ids`, `gcal_window_past_days`,
`gcal_window_future_days` (Dexie v5, migration 0005) — which means they sync
between devices like every other preference rather than being a property of
whichever machine was deployed.

The rule this leaves, and the one to apply to the next question of the same
shape: **the environment holds credentials and addresses; the app holds
preferences.** `lib/gcal/config.ts` is the single place that reads the second
half, so no call site gets to reinvent a default.

### D-140 · The primary calendar is refused by the server, not just hidden by the picker — **Interpreted**

§6.1 says "never write to the primary calendar". With the calendar hardcoded
that was a property of the code. With the user choosing, it has to be enforced
where the write happens.

`resolveCalendar` does three things on every events and pull call: refuses the
primary outright (400), honours the requested calendar when it is writable, and
falls back to find-or-create when it is not — deleted, unshared, or downgraded
to read-only. The picker greys the primary out and says why, but that is
courtesy; the server is the boundary. A settings row syncs between devices and
may have been written by a version of the app that did not know the rule.

The fallback is deliberately silent-but-recorded: the pull response echoes the
calendar it actually used, and the client writes that back into settings, so a
stale choice repairs itself rather than failing every sync forever.

### D-141 · Changing calendar forgets the event ids and keeps the old events — **Filled a gap**

A Google event id is only meaningful inside the calendar that issued it, and a
`syncToken` is one calendar's change feed. Switching target therefore clears
both (`detachGcalEvents`), and the next sync recreates the agendas where they
now belong.

The events left behind on the old calendar are **not** deleted. Deleting them
would mean writing to a calendar the user has just told FOQUS to stop using,
which is precisely the instruction being followed. The toast says so rather than
leaving it to be discovered.

### D-142 · The two Google switches drop queued writes instead of deferring them — **Filled a gap**

`gcal_enabled` and `gcal_write_enabled` are read by `drainGcalEntry`, and when
either is off the entry is dropped, not retried later.

Deferring was the first instinct and it is wrong: the outbox drains strictly in
insertion order (D-012), so an entry that can never succeed would sit at the
head of the queue and block every todo, agenda and settings write behind it —
the whole app would stop syncing because Google was switched off.

Dropping needs a way back, so "Sinkronkan sekarang" became two-directional:
`queueMissingGcalEvents` re-queues every mirrorable agenda Google does not have
an id for, the outbox drains, and only then does the pull run. That also repairs
the D-141 case, where every agenda is deliberately missing an id at once.

### D-143 · Signing in hands the sentinel's rows to the account — **Bug, and a file that was cited but never written**

D-009 gave locally created rows a sentinel `user_id` so the app works with no
account. `lib/db/mutations.ts` documented the other half — *"Supabase Auth
overwrites this at first sign-in (`lib/sync/adopt.ts`)"* — and that file did not
exist.

The failure it caused is quiet and total. Every synced table's policy is
`with check (user_id = (select auth.uid()))`, so an upsert carrying the sentinel
is rejected by Postgres; the outbox retries it five times, parks it as
`blocked`, and moves on. A first sign-in would look like it worked and sync
nothing — and the only place saying otherwise is a count in Settings.

`adoptLocalRows` re-stamps every sentinel row and queues each one. Two details
are deliberate:

- **`updated_at` is not touched.** It records when the user made the change, and
  last-write-wins (§3.2) reads it. Bumping it would let a device that has been
  offline for a week win against an edit made yesterday.
- **A *different* account adopts nothing.** Sentinel → account is a claim;
  account → other account would be handing this device's data to someone else.
  FOQUS is single-user, so the second transition sets the id for future writes
  and leaves existing rows alone.

Adoption runs before `seedIfNeeded` on boot, and again from an
`onAuthStateChange` listener — the OAuth round trip returns to a freshly mounted
app where `getUser()` can still answer null while the browser client finishes
the code exchange.

### D-144 · The gate is a server boundary, and its key is the password — **Requested**

A screen in front of the app would have been theatre: the data is in IndexedDB
on the device, but the *deployment* is a public URL, and anyone who has it could
read every API route.

`middleware.ts` holds the line instead. Locked, a navigation gets a redirect to
`/gate` and anything under `/api/` gets a 401 — no page is ever rendered with
the data already in it. The service worker, manifest and icons are excluded so a
locked deployment can still be installed.

The password lives in `FOQUS_ACCESS_PASSWORD` and there is deliberately no UI to
change it: it is a secret, and the "bukan hardcode" rule of D-139 is about
preferences. Empty means the gate is off, which is what keeps `npm run dev`
frictionless.

The cookie is `"<expiry>.<HMAC-SHA256 over that expiry>"`, and **the signing key
is the password itself**. That is the whole reason there is no second secret to
configure, and it buys the behaviour you want from a gate whose purpose is "only
me": changing the password invalidates every issued cookie at once. Web Crypto
only, because middleware runs on the edge runtime where Node's `crypto` is not
available.

Two honest limits, both stated in the README rather than papered over:

- **Throttling is per instance.** Eight wrong guesses per fifteen minutes, in a
  `Map` that a cold start forgets and a second serverless instance does not
  share. It turns a script into a nuisance; it does not make a short password
  safe.
- **An installed PWA keeps working offline while locked.** The service worker
  answers from its precache and never reaches the middleware. The gate protects
  the deployment, not the device — and the device's copy is already the user's
  own.

`BootGate` moved out of `AppProviders` and into `app/(app)/layout.tsx` for this:
the gate page renders under the same root provider, and it must not open the
database or start the sync engine for someone who has not answered yet.

### D-145 · A settings row older than its migration reads as fully enabled — **Interpreted**

`gcalConfigFrom` defaults every new field with `??`, and the Dexie v5 upgrade
backfills them. Both are needed and they cover different paths: the upgrade
fixes rows already on this device, the `??` fixes a row *pulled* from a device
that has not upgraded, which arrives from Postgres with the 0005 columns absent.

The direction of the default is the decision. `undefined` reads as **on**,
because reading it as off would silently stop the entire integration on a device
that had it working — and the thing that actually gates every Google call is
`gcal_calendar_id`, which has no safe default and starts null.

`gcal_busy_calendar_ids` is the one field where null is not "unset" but a value:
null means *every other calendar*, §6.3's default, and it stays correct when a
calendar is added in Google next month. An empty array means the opposite — no
calendar is busy — which is why the picker snaps back to null once every
candidate is ticked rather than storing the full list.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean. The Vitest
suite is green at **355 tests** (347 before, plus 8 new): the gate's token —
expiry at the exact boundary, a forged expiry, rotation revoking an old session,
malformed input — adoption against a real Dexie under `fake-indexeddb`, and the
settings-row defaults above.

The gate was driven against a production build with the password set: a locked
`/tasks` answers 307 to `/gate?next=%2Ftasks`, a locked `/api/gcal/status`
answers 401, `/sw.js` and `/manifest.webmanifest` answer 200 while locked, the
wrong password answers 401 and the ninth attempt 429, the right one sets
`HttpOnly; Secure; SameSite=lax` and `/tasks` then answers 200, and
"Kunci sekarang" clears the cookie.

**Not verified against Google.** No Supabase project or OAuth client was
configured in this environment, so the calendar picker, the busy-calendar
selection and the window settings are exercised by their types and their pure
parts only. The first real connect is the test that matters, and
Pengaturan → Sinkronisasi → "Periksa koneksi database" exists to make its
failures legible rather than mysterious.

---

## Dua hal yang menghalangi integrasi pertama

Reported from the device after the env vars and the Supabase project were filled
in for the first time: *"tidak ada password di awal app"*, and the calendar
settings still errored. Two separate causes, both found by reproducing rather
than by reading.

### D-146 · A precached document is a hole straight through the access gate — **Bug found in the browser**

D-144 put the gate in `middleware.ts` and verified it with `curl`, which is
exactly the test that cannot see this: a fresh HTTP client has no service
worker.

`serwist build` was precaching the app's own HTML documents — `/`, `/tasks`,
`/calendar`, `/today`, `/week`, `/settings` — and `Serwist`'s constructor
registers its `PrecacheRoute` **before** any `runtimeCaching` entry
(`node_modules/serwist/src/Serwist.ts`, the precache route at construction vs.
the runtime routes after it). The router matches in registration order, so every
navigation was answered from the cache. The request never left the browser, the
middleware never ran, and the gate never appeared — online or off, on any device
that had opened the app once. D-144's own note that "an installed PWA keeps
working offline while locked" was true and far too generous: it was not a trade,
it was a bypass.

The fix cannot be a smaller one. To have a server-side gate, the server has to
answer navigations:

- **Documents are no longer precached.** `isAppDocument` in `lib/pwa/shell.ts`
  filters them out of `__SW_MANIFEST` at worker startup. The test is "no file
  extension" rather than a list of routes, so a route added later is covered
  without anyone remembering this file. `/offline` is the one exception — a
  fallback that is not precached cannot be served.
- **Navigations are network-first**, with the last good copy as the fallback.
- **A redirect is never cached.** The `onlyPlainDocuments` plugin refuses
  anything that is not a plain 200, because otherwise a locked navigation would
  store the lock screen under `/tasks` and the app would open to a dead end
  offline. The Cache API refuses a redirected response for a navigation anyway,
  so this is correctness before it is policy.
- **The shell is warmed after boot** (`lib/pwa/warm.ts`). Without it §10's
  "usable with the network off" would quietly regress to one route, because
  tapping a tab is a client-side navigation in Next.js — it fetches an RSC
  payload and never the HTML, so no other document would ever be cached. Warming
  from the app shell rather than from the worker's `install` also means every
  document stored is one an unlocked session was entitled to.

Verified in Chromium against a production build, which is the only test that
would have caught it. With the **previous** worker installed and all five
documents in its precache, deploying the new worker put the gate up on the first
load, and by the second visit the stale precache held `/offline` and nothing
else — Serwist's own cleanup removes entries no longer in the manifest.

### D-147 · §6.1's scopes cannot create the calendar §6.1 asks for — **Bug, and a conflict with the brief**

The second report. `calendarList.list` and `freebusy.query` both worked, so the
connection looked healthy; only *creating* the FOQUS calendar failed, with a 403
whose text never reached the screen.

§2 and §6.1 fix the scopes at `calendar.events` and `calendar.readonly`. Google's
discovery document — `https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest`,
fetched rather than recalled — lists `calendars.insert` as accepting
`calendar`, `calendar.app.created` or `calendar.calendars`, and **none of the
two the brief names**. So §6.1's very first instruction, "find or create a
secondary calendar named FOQUS", could never succeed as specified.

This is a §14 case ("Google API … scope issues that would change the
architecture") and it is recorded as a deviation rather than silently widened.
`calendar.calendars` is added: it is the narrowest scope that permits calendar
creation and management, and it grants nothing about anyone's events. The broad
`calendar` scope would also work and was rejected for being far more than this
app touches.

Three consequences, all handled rather than left to be discovered:

- **A token's scopes cannot be widened in place.** Anyone already connected
  holds a token granted under the old list. `missingScopesFrom` compares the
  stored grant against the required set — no network call, because Google
  returns the granted scopes on every token response and they are already
  stored — and Pengaturan offers "Hubungkan ulang" instead of failing later.
- **An unknown grant counts as incomplete.** A token stored before scopes were
  recorded would otherwise pass and then 403 mid-sync. Prompting a reconnect is
  the cheaper mistake.
- **The consent screen needs the scope too.** An External app must list it, so
  the README's Google Cloud section now names all three.

### D-148 · Google's own sentence, not "tidak bisa memuat" — **Interpreted**

What made D-147 take a round trip to diagnose is that the app had the answer and
threw it away. Every route handler returned `String(err)` — the whole JSON
envelope — and every caller rendered a fixed Indonesian string over it. The
screen said "Tidak bisa memuat daftar kalender" when Google had said
"Request had insufficient authentication scopes."

`describeGoogleError` digs out the one sentence, handling both shapes Google
uses (the API's nested `error.message`, and the token endpoint's flatter
`error_description`) and falling through to truncated plain text. The settings
screen now shows the generic line *and* the specific one underneath in mono,
because the first tells the user what failed and the second tells them what to
do.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean. The Vitest
suite is green at **370 tests** (355 before, plus 15): which URLs may be
precached, the scope set and the stale-grant comparison, and Google's two error
envelopes.

Driven in Chromium against a production build, with a persistent profile so the
service worker and its caches survive between runs:

| | result |
|---|---|
| gate off → worker installs, shell warms | `pages` cache holds all five routes |
| gate on, worker already installed | `/tasks` → `/gate?next=%2Ftasks`, password field present |
| unlock through the form | lands on `/tasks`, app renders |
| page cache after unlocking | app shells under app URLs, the gate page only under `/gate` |
| **previous** worker installed, new one deployed | gate on the first load |
| second visit | stale precache reduced to `/offline` |

Still not verified against Google: no OAuth client was configured in this
environment, so D-147's fix is proved against Google's published scope table and
its own tests, not against a live 403 becoming a 200. That first connect remains
the test that matters.

### D-149 · Ask GoTrue what it supports before offering the button — **Bug in the surfacing, not in the flow**

Third report from the same session, and the third time a configuration problem
reached the user as machine output: clicking **Masuk dengan Google** left the app
entirely and landed on

```json
{"code":400,"error_code":"validation_failed",
 "msg":"Unsupported provider: provider is not enabled"}
```

The cause was a dashboard setting — the Google provider was never switched on in
the Supabase project — and the fix for *that* is documentation, which the README
now spells out as three separate steps because only the first is a toggle.

The part worth a decision is why the app could not say so. `signInWithOAuth`
builds the authorize URL on the client and then navigates to it; there is no
request for it to fail on, so its `error` return is empty and the first thing
that knows the provider is disabled is GoTrue, by which point the browser has
already left. D-148's approach — show the server's own sentence — does not reach
here, because there is no response left to read.

So the app asks first. GoTrue publishes its configuration at
`/auth/v1/settings`, including an `external` map of which providers are on.
`probeAuthProviders` reads it when the Account section mounts, and a project with
Google off gets a warning naming the exact dashboard screen, with the button
disabled — offering a button whose only outcome is a page of JSON is worse than
not offering it.

Two deliberate limits:

- **An unreachable probe does not disable anything.** Being unable to ask is not
  evidence of a problem; the button stays live and the user can try.
- **A shape GoTrue did not promise reads as "off", not as a crash.** The result
  only decides whether to warn, and an unnecessary warning is cheaper than an
  exception in Settings.

`signInWithOAuth`'s own `error` is now also surfaced, for the cases where
supabase-js does refuse before redirecting.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean; the suite is
green at **374 tests** (370 before, plus 4 for reading the settings document).

Not verified against a live project with the provider disabled — that state
exists only in someone's dashboard. The parse is tested against GoTrue's
documented shape and against six shapes it does not promise.

### D-150 · State the origin the app cannot verify — **Bug in the surfacing, again**

Fourth configuration trap in the same session, and the least legible of them:
Google authenticated, the password was accepted, and Safari then bounced between
`localhost` and a blank page. Nothing failed. The only thing wrong was the last
hop.

Supabase's **Authentication → URL Configuration** ships a new project with
`Site URL = http://localhost:3000`, and GoTrue treats its Redirect URLs list as
an allow list: a `redirectTo` that is not on it is **discarded rather than
refused**, and the Site URL is used instead. FOQUS passes
`redirectTo: ${location.origin}/settings`, which is correct and stays correct
across preview deployments — but on a project whose allow list is untouched it
is thrown away, and a phone is sent to a development server that does not exist.

D-149's move does not work here. That one succeeded because GoTrue publishes
which providers are enabled; it publishes neither its Site URL nor its allow
list, so there is nothing to probe and no response to read — by the time anything
is observable, the browser has already left for `localhost`.

What the app *does* know is its own origin, which is precisely the fact the user
would otherwise have to assemble by hand, on a phone, from a page of
documentation. So the sign-in block carries a fold — **"Balik ke localhost
setelah login?"** — naming the two fields and showing this origin and its
`/**` glob ready to copy.

Folded by default, per D-132: it is an answer to a question most sessions never
ask. Not a warning, because nothing here is known to be wrong — the app cannot
tell a correct configuration from a broken one, and a permanent alert that may
be false is how alerts stop being read.

The pattern across D-148, D-149 and D-150 is worth naming, because it is the
same defect wearing three faces: **the app knew more than it said.** Once the
server's own sentence, once a published capability document, and once a fact the
client held all along.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean; the suite is
unchanged and green at **374 tests** — this touches no rule, which is the point.

Rendered in Chromium at 390×844 against a production build with the Supabase
keys inlined: the fold sits under the sign-in button, opens to the two fields
with the origin filled in, and horizontal overflow measures 0.

Not verified against a live project with the Site URL left at its default. That
state exists only in someone's dashboard, and there is nothing in the app to
assert against — which is the whole reason this is copy rather than a check.

### D-151 · One error, two causes: name the one that can be checked — **Extends D-150**

`Error 400: redirect_uri_mismatch` on the calendar connect, from a client whose
sign-in callback was already registered and working. The two causes are
indistinguishable from Google's page:

1. **The URI was never added.** The same OAuth client serves sign-in and
   calendar, through two unrelated redirect URIs —
   `https://<ref>.supabase.co/auth/v1/callback` and
   `https://<app>/api/gcal/callback`. Having the first is no evidence of the
   second, and sign-in working is exactly what makes the second easy to assume.
2. **`NEXT_PUBLIC_SITE_URL` names a different origin than the app is served
   from.** `googleClientConfig` builds the URI from it, so the value sent is one
   nobody would think to register.

The second is decidable — the app holds both origins and can compare them — so
it is a warning, stated in full, with the origin named. The first is not, so it
follows D-150: the exact value, ready to copy, folded, and no claim that
anything is wrong. Same distinction as before, now applied twice on one screen:
**assert what is known, state what is merely required.**

The redirect URI is reported by `/api/gcal/status`, which is where the client
already learns whether Google is configured at all. It is public by nature — it
travels in the OAuth URL on every connect — so publishing it costs nothing and
saves reading it out of Google's "see error details".

The fold opens by itself when the mismatch is detected, because in that case it
is no longer a reference: it is the evidence.

### Verification

`npm run lint`, `npm run typecheck` and `npm run build` are clean; **374 tests**,
unchanged — no rule is touched.

Rendered in Chromium at 390×844 against a production build, with
`/api/gcal/status` stubbed to both states. Matching origin: the fold sits closed
under the connect button and opens to the URI. Mismatched: the warning names the
served origin, the fold is already open, and the URI shown is the wrong one — the
whole diagnosis on one screen. Horizontal overflow 0 in both.

Not verified against Google itself; no OAuth client exists in this environment.
What is proved is that the app now shows the string Google is comparing against,
which is the fact the error page withholds.

