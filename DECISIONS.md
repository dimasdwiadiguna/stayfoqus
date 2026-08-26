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
