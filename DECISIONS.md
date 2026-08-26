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
