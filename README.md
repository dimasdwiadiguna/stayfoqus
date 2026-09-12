# FOQUS

A mobile-first, offline-capable PWA that turns **todos** (intentions) into
**agendas** (committed blocks of time), executed through **pomodoro** focus
sessions and mirrored to Google Calendar.

Built from [`BRIEF.md`](./BRIEF.md). Every judgement call made along the way is
recorded in [`DECISIONS.md`](./DECISIONS.md); the Phase 2 scope is written up in
[`docs/PHASE2.md`](./docs/PHASE2.md).

- Code, identifiers and comments are in **English**.
- All user-facing copy is **Bahasa Indonesia**, in one dictionary:
  [`lib/i18n/id.ts`](./lib/i18n/id.ts).

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

**No configuration is required to run the app.** With no environment variables
set, FOQUS runs in local-only mode: IndexedDB is the database, the access gate
is open, and every feature except cross-device sync and Google Calendar works
normally. Settings → Sinkronisasi says so plainly.

Configuration splits along one line, deliberately: the environment holds
*credentials and addresses*; the app holds *preferences*. Which calendar
agendas are written to, whether they are written at all, which calendars count
as busy and how wide the sync window is are all set in **Pengaturan → Google
Calendar**, stored in the settings row, and synced between devices.

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `next build`, then compiles the service worker |
| `npm start` | Serve the production build |
| `npm test` | Vitest — the scheduling core, timer and data rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run icons` | Regenerate the PWA icon set from `scripts/generate-icons.mjs` |

`npm run build` has two steps because Serwist runs in configurator mode rather
than as a webpack plugin — see D-002 in `DECISIONS.md`.

---

## Architecture in one page

**IndexedDB is the read source of truth.** Every screen reads through Dexie
live queries, so the UI is instant and fully functional offline. Every mutation:

1. writes to Dexie immediately, stamping `updated_at` and `dirty`
2. appends an entry to the `outbox` table in the same transaction
3. updates the UI from the live query
4. drains in the background when online

```
components/         screens and UI primitives (shadcn-style, on Radix)
hooks/              live-query hooks; one place assembles the working set
lib/
  db/               Dexie schema, mutations + outbox, seed
  scheduling/       the rules from §5 — pure, no React, no Dexie
  pomodoro/         wall-clock timer machine (pure) + its host store
  gcal/             client half of Google sync; server half is in app/api
  time/             the single timezone boundary
  todos/ agendas/   repositories and derived counters
  places/           pinned coordinates, behind the commute estimate
app/api/gcal/*      server-side Google Calendar access
supabase/migrations schema + RLS, kept in sync with lib/db/schema.ts by hand
```

Two modules are pure and carry the bulk of the test suite:

- **`lib/scheduling/`** — availability windows, prayer times, the typed-buffer
  collision rule, the free-space map, slot suggestion, time-block matching and
  the greedy allocator. No React, no Dexie, no ambient clock.
- **`lib/pomodoro/machine.ts`** — the timer as a state machine returning
  effects, which is what makes background/foreground recovery testable.

**All datetimes are stored in UTC** and converted only at the presentation
boundary, through `lib/time`. There is no ambient local time in the codebase:
every function that needs one takes the timezone explicitly.

---

## Supabase setup (optional — enables sync and Google Calendar)

### 1. Create the project

Create a Supabase project, then copy from **Project Settings → API**:

```bash
cp .env.example .env.local
```

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role — **server-only** |

The service-role key must never be prefixed with `NEXT_PUBLIC_`. It is used by
exactly one place — `/app/api/gcal/*` — to read the Google refresh token, which
RLS hides from every client-side role.

### 2. Run the migration

```bash
supabase db push          # or paste supabase/migrations/*.sql, in order, into the SQL editor
```

`0001_init.sql` creates the synced tables plus `google_credentials`, enables RLS
on all of them, and adds an owner-only policy per table. `google_credentials`
deliberately gets **no policy at all**, so `anon` and `authenticated` match
nothing and can see nothing. `0002`–`0005` add the agenda chain, events, places
and the in-app Google Calendar configuration; run them in order.

**Pengaturan → Sinkronisasi → "Periksa koneksi database"** answers whether this
worked, and distinguishes the three ways it usually has not: env vars missing,
migrations not run, or nobody signed in so RLS hides every row.

Data created before the first sign-in belongs to a local sentinel user. Signing
in hands it to the account, queues it, and says how many rows moved — without
that step the RLS policy would reject every one of them and the outbox would
park them as `blocked`.

### 3. Enable Google as an auth provider

Google is the only provider FOQUS uses (§2), and it is **off by default** in a
new Supabase project. Three things have to line up:

1. **Supabase → Authentication → Sign In / Providers → Google.** Switch it
   **on** — this is the toggle, separate from filling the fields below it.
2. Paste the **Client ID** and **Client Secret** of the OAuth client from the
   Google Cloud section below. The same client serves both sign-in and calendar
   access.
3. Copy the **callback URL** Supabase shows on that screen — it looks like
   `https://<project-ref>.supabase.co/auth/v1/callback` — into that Google
   client's **Authorized redirect URIs**.

Step 3 is the one most often missed, because FOQUS needs a *second*,
unrelated redirect URI on the same client: `/api/gcal/callback` on your own
domain, for the calendar connection. Both must be listed.

Skipping step 1 produces this, in the address bar rather than in the app:

```json
{"code":400,"error_code":"validation_failed",
 "msg":"Unsupported provider: provider is not enabled"}
```

Pengaturan now asks GoTrue's public `/auth/v1/settings` document before it
offers the button, so a project with the provider still off says so in
Indonesian instead of navigating you into that JSON.

### 4. Tell Supabase where your app lives

**Authentication → URL Configuration.** A new project ships with
`Site URL = http://localhost:3000`, and this is the setting that decides where
the browser lands *after* Google has authenticated.

| Field | Value |
|---|---|
| Site URL | `https://<your-app>` — exact origin, https, no trailing slash |
| Redirect URLs | `https://<your-app>/**`, plus `http://localhost:3000/**` for dev |

The allow list takes glob patterns, and it is not advisory: FOQUS passes
`redirectTo: <this origin>/settings`, and a `redirectTo` that is **not** on the
list is discarded rather than refused — GoTrue silently falls back to the Site
URL. Leave the default in place and a successful sign-in on your phone ends at
`http://localhost:3000/settings`, which on a phone is nothing at all. The login
worked; only the last hop was wrong, which is what makes this one hard to read.

Nothing in the app can detect this — GoTrue publishes which providers are
enabled, but not its Site URL or its allow list — so Pengaturan instead states
the requirement with the current origin already filled in, under
**"Balik ke localhost setelah login?"** beside the sign-in button.

---

## Google Cloud setup (optional — enables Google Calendar)

> One OAuth client serves both purposes, and it needs **two** unrelated redirect
> URIs: `https://<project-ref>.supabase.co/auth/v1/callback` for sign-in, and
> `https://<your-app>/api/gcal/callback` for the calendar connection.

### 1. Enable the API

**APIs & Services → Library → Google Calendar API → Enable.**

### 2. Configure the consent screen

**APIs & Services → OAuth consent screen.**

- User type: **External** (unless you have a Workspace org).
- Scopes: add all three of
  `.../auth/calendar.calendars`, `.../auth/calendar.events` and
  `.../auth/calendar.readonly`.

  `calendar.calendars` is the one that permits *creating* a calendar
  (`calendars.insert`); `calendar.events` and `calendar.readonly` do not, which
  is why "find or create the FOQUS calendar" used to fail with a 403 about
  insufficient scopes. The broad `calendar` scope would also work and grants far
  more than this app touches.
- While the app is unverified, add your own account under **Test users**. An
  unverified app is limited to test users and its refresh tokens expire after
  seven days — fine for personal use, and the reason FOQUS treats a failed
  refresh as "reconnect" rather than a hard error.

### 3. Create the OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID → Web
application.**

Authorized redirect URIs — add one per environment:

```
http://localhost:3000/api/gcal/callback
https://<your-app>.vercel.app/api/gcal/callback
```

Then fill in:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXT_PUBLIC_SITE_URL=http://localhost:3000    # must match the redirect origin
```

`NEXT_PUBLIC_SITE_URL` is what the callback URL is built from, so it has to
match exactly — including scheme and any trailing-slash-free form.

### 4. Connect from inside the app

Sign in with Google first, then **Pengaturan → Hubungkan Google Calendar**.
The calendar scopes are requested *after* login, as incremental authorization
(§6.1) — the login itself asks for nothing beyond identity.

If you connected before the `calendar.calendars` scope was added, the stored
token cannot create a calendar and Pengaturan says so with a
**"Hubungkan ulang Google Calendar"** button — a token's scopes cannot be
widened in place.

On first connect FOQUS finds or creates a secondary calendar named **FOQUS** so
there is somewhere to write immediately. Everything after that is yours to set,
in **Pengaturan → Google Calendar**:

| Setting | What it does |
|---|---|
| Sinkronisasi aktif | Master switch. Off means no pull, no write, no busy cache. |
| Kalender tujuan | Pick any writable calendar, or create a new one by name. The primary is listed but refused — §6.1, enforced server-side as well as in the picker. |
| Tulis agenda ke Google | The §6.2 write path on its own. Off leaves the read half running. |
| Kalender lain sebagai sibuk | Whether other calendars block the scheduler, and which ones. |
| Jendela sinkron | How far back and forward Google is read. Defaults to the −7/+30 days of §4.10. |

Changing the target calendar forgets every stored Google event id and the sync
token, so the next sync recreates the agendas where they now belong. Events left
on the old calendar are not deleted — that would mean writing to a calendar you
have just said to stop using.

---

## Access gate (optional — recommended for a public deployment)

FOQUS is a single-user app on a public URL. Set one variable and the whole
deployment stands behind a password:

```bash
FOQUS_ACCESS_PASSWORD=something-long-and-yours
```

- `middleware.ts` checks every request. A locked visitor gets a redirect to
  `/gate`, or a `401` for anything under `/api/` — never a page with the data
  already in it.
- Unlocking sets an `HttpOnly`, `SameSite=Lax`, `Secure` cookie carrying an
  expiry and an HMAC over it. The signing key is the password itself, so
  **changing the password signs every device out**.
- The session lasts 30 days. **Pengaturan → Akses → "Kunci sekarang"** ends it
  on this device.
- Wrong guesses are throttled per IP, 8 per 15 minutes. That is per serverless
  instance and forgotten on a cold start — it turns a script into a nuisance,
  it does not make a short password safe. Pick a long one.
- Leave the variable empty and the gate is off, which is what keeps
  `npm run dev` frictionless.

**The service worker must not precache the app's documents**, or there is no
gate at all. Serwist registers its precache route ahead of every runtime route,
so a precached `/tasks` is answered from the cache and the request never reaches
the middleware — online or off. FOQUS therefore precaches only assets and the
`/offline` fallback, serves navigations network-first, and warms the page cache
after boot (`lib/pwa/`) so every tab still opens on a cold start with no
connection. A cached document is never a redirect, so a locked session cannot be
stored under an app URL.

The consequence: an already-installed PWA keeps working offline with whatever it
last cached while unlocked. The gate protects the deployment, not the device —
and the device's copy is already the user's own.

---

## Vercel deployment

1. Import the repository.
2. Framework preset: **Next.js**. The default build command is correct — the
   `build` script already chains the service worker step.
3. Add the environment variables from `.env.example`. Set
   `NEXT_PUBLIC_SITE_URL` to the deployment's own origin, and set
   `FOQUS_ACCESS_PASSWORD` unless you want the URL to be the only secret.
4. Add `https://<your-app>.vercel.app/api/gcal/callback` to the Google OAuth
   client's redirect URIs, and the Supabase callback URL alongside it.

Preview deployments get their own origin, so either add each preview URL to
Google or connect Google only from production.

---

## Testing

```bash
npm test
```

The suite covers what `BRIEF.md` §13 asks for:

- the buffer collision rule, including all three worked examples from §5.2 —
  driven end to end through the free-space map, not just the formula
- free-space computation (windows, prayer blocks, busy time, overlaps, edges)
- the allocation algorithm against fixture scenarios, including determinism
- prayer time calculation, with a regression test that pins the host timezone
- time-block filter matching (OR within a dimension, AND across)
- timer recovery after a simulated background/foreground cycle
- the ISO-week and timezone boundary, including a DST transition
- todo hierarchy, dependency cycles and derived counters
- the §5.9 agenda↔todo coupling rule and the §9 streak
- the access gate's token: expiry, forgery, and rotation revoking old sessions
- which URLs may be precached, so a document never shadows the gate again
- the Google scope set, and reading Google's error envelope
- reading GoTrue's settings document, so a disabled provider is caught early
- claiming local rows for the account at first sign-in
- reading the Google configuration from a settings row older than the migration
  that added it

---

## Notes for reviewers

- **Nothing blocks on the network.** If a screen appears to wait on a request,
  that is a bug, not a slow connection.
- **The scheduler lives in one place.** No component reimplements a rule from
  §5; they import it. If a rule needs changing, `lib/scheduling/` is the only
  file to touch and the tests will say whether it broke.
- **Soft deletes only.** Nothing is ever hard-deleted by user action, which is
  what makes every destructive gesture undoable with a real inverse.
