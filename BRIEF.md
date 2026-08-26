# FOQUS — Build Brief for Claude Code

> **How to use this document.** This is the complete specification for a greenfield app. Read the whole thing before writing code. Build it milestone by milestone in the order given in §12 — do not jump ahead. After each milestone, stop, summarize what you built, and confirm the app still builds and runs before continuing.
>
> **Language convention:** all code, identifiers, comments, and commit messages in **English**. All user-facing UI copy in **Bahasa Indonesia**. Keep UI strings in a single `lib/i18n/id.ts` dictionary — do not hardcode Indonesian strings inside components.

---

## 1. Product summary

FOQUS is a mobile-first, offline-capable Progressive Web App for a single user. It is a Getting-Things-Done system whose defining idea is the conversion of a **Todo** (an intention) into one or more **Agendas** (committed blocks of time on a calendar), executed through **Pomodoro** focus sessions, with the results reflected back into Google Calendar.

The user's day is dynamic. The app must make it cheap to reschedule, and it must make finishing things feel good.

**Three core loops:**

1. **Capture → Organize.** Todos with category, priority, tags, due date, subtasks, dependencies, and an estimate expressed in pomodoros.
2. **Plan → Commit.** Todos become Agendas — either manually or via smart allocation — respecting availability windows, buffers, prayer blocks, and time-blocking rules. Agendas mirror to Google Calendar.
3. **Execute → Reflect.** Focus sessions consume pomodoros against an Agenda. Missed agendas are reviewed and rescheduled in a few taps. Completion is celebrated.

---

## 2. Tech stack (fixed — do not substitute)

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, strict mode |
| Deployment | Vercel |
| Styling | Tailwind CSS + shadcn/ui |
| Local database | Dexie.js (IndexedDB) |
| Remote database | Supabase (Postgres + Auth + Row Level Security) |
| Auth | Supabase Auth with Google OAuth provider only |
| Calendar | Google Calendar API v3 |
| Drag & drop | `dnd-kit` (with `PointerSensor`, activation constraint tuned for touch) |
| Prayer times | `adhan` |
| Dates | `date-fns` + `date-fns-tz` |
| Animation | `motion` (Framer Motion) |
| Celebration | `canvas-confetti` |
| PWA / service worker | `next-pwa` (or Serwist if `next-pwa` is incompatible with the installed Next version — state which you chose and why) |
| Audio | Web Audio API, synthesized — **no audio files** |
| State | Zustand for ephemeral UI state; Dexie live queries (`dexie-react-hooks`) for data |

Target: modern mobile Safari and Chrome. Design for a 390×844 viewport first; the layout may widen gracefully on desktop but desktop is not a design priority.

---

## 3. Architecture

### 3.1 Local-first with an outbox

IndexedDB is the **read source of truth for the UI**. Every screen reads from Dexie via live queries so the app is instantly responsive and fully functional offline.

Every mutation follows the same path:

1. Write to Dexie immediately (optimistic), stamping `updated_at` and `dirty = true`.
2. Append an entry to the `outbox` table describing the operation.
3. UI updates instantly from the live query.
4. A background sync engine drains the outbox when online.

The user must be able to create, edit, complete, delete, schedule, reschedule, and run pomodoro sessions **entirely offline**. Nothing in the UI may block on network availability. Show a subtle connection/sync indicator in the header: synced, syncing, offline with N pending, or error.

### 3.2 Sync engine

- Trigger drain on: app foreground, `online` event, after any mutation (debounced 2s), and every 60s while online.
- Process outbox entries **in insertion order**, one at a time. On failure, retry with exponential backoff (2s, 4s, 8s… capped at 5 min). After 5 consecutive failures on the same entry, mark it `blocked`, surface it in Settings → Sync, and continue with the rest of the queue.
- Pull remote changes using `updated_at > last_pulled_at` per table.
- **Conflict resolution: last-write-wins by `updated_at`.** When a conflict is detected (remote `updated_at` is newer than the local base version), the remote wins, but record the event in a `conflict_log` table and show a dismissible badge: *"2 perubahan dari perangkat lain diterapkan."* Do not build a merge UI in Phase 1.
- Soft deletes only: every table has `deleted_at`. Never hard-delete rows during sync.
- Use client-generated UUIDs for all primary keys so offline-created records need no ID reconciliation.

### 3.3 Google Calendar access is server-side

The Google refresh token must **never** reach the browser. Store it in Supabase (in a table the client cannot read via RLS). All Google Calendar calls go through Next.js Route Handlers under `/app/api/gcal/*`, which read the token server-side, refresh it when expired, and proxy the request.

Calendar writes are queued in the same outbox as everything else, so scheduling an agenda offline works and syncs later.

---

## 4. Data model

Define this as a Dexie schema and a matching set of Supabase migrations. Keep them in sync; generate TypeScript types from a single source in `lib/db/schema.ts`.

Every table carries: `id` (uuid, client-generated), `user_id`, `created_at`, `updated_at`, `deleted_at | null`.

### 4.1 `categories`
```
name          string          // user-defined
color         string          // hex
icon          string          // lucide icon name
sort_order    number
```
Seed on first launch (all deletable): **Kerja**, **Riset**, **Personal**, **Ibadah**.

### 4.2 `todos`
```
title              string
notes              string | null
category_id        uuid | null
priority           1 | 2 | 3 | 4        // 1 = highest (red), 4 = none (gray)
tags               string[]             // flat, free-form
due_date           ISO date | null
estimated_pomodoro number               // default 1
parent_id          uuid | null          // hierarchy, max depth 3
blocked_by         uuid[]               // cross-todo dependencies
status             'inbox' | 'active' | 'done' | 'archived'
completed_at       ISO datetime | null
focus_week         string | null        // e.g. "2026-W35"
sort_order         number
```

**Hierarchy rules**
- Maximum depth 3 (root → child → grandchild). Reject deeper nesting in the UI with a clear message.
- Every node at every level is a first-class todo: it can have its own category, estimate, and its own agendas.
- Completing a parent that has incomplete children shows a **soft warning** dialog: *"3 subtask belum selesai. Tetap selesaikan?"* with **Batal** / **Tetap selesaikan**. Never hard-block.
- Deleting a parent asks whether to delete or promote children to the parent's level.

**Dependency rules**
- `blocked_by` is a separate concept from hierarchy. A todo is *blocked* if any todo in `blocked_by` is not `done`.
- Blocked todos are visually dimmed with a lock icon and a tooltip naming the blockers.
- Smart allocation **skips** blocked todos entirely. Manual scheduling of a blocked todo is allowed with a confirmation.
- Prevent cycles: validate on save, reject with a message naming the cycle.

**Derived (computed, not stored):** `allocated_pomodoro` = sum of `allocated_pomodoro` across the todo's non-deleted agendas; `used_pomodoro` = count of completed pomodoro logs across those agendas; `remaining_to_allocate` = `estimated_pomodoro − allocated_pomodoro`. Show `remaining_to_allocate` prominently in the task list — it is the signal that drives planning.

### 4.3 `agendas`
```
todo_id             uuid                 // 1 todo : N agendas
title_override      string | null        // defaults to todo title
start_at            ISO datetime (UTC)
end_at              ISO datetime (UTC)
allocated_pomodoro  number
buffer_before_min   number               // default from settings
buffer_before_type  'switch' | 'commute'
buffer_after_min    number
buffer_after_type   'switch' | 'commute'
status              'planned' | 'draft' | 'done' | 'partial' | 'missed' | 'cancelled'
outside_window      boolean              // true if placed outside availability windows
gcal_event_id       string | null
gcal_synced_at      ISO datetime | null
gcal_conflict       boolean
```

- `status = 'draft'` means it came from smart allocation and has not been applied yet. Drafts render with a dashed border and are **not** written to Google Calendar.
- Deleting an agenda never deletes its todo. This must be explicit in the confirmation copy: *"Agenda dihapus, todo tetap ada di daftar."*

### 4.4 `pomodoro_logs`
```
agenda_id      uuid | null    // null = untethered focus session
todo_id        uuid | null
started_at     ISO datetime
ended_at       ISO datetime | null
duration_sec   number
type           'focus' | 'short_break' | 'long_break'
outcome        'completed' | 'aborted'
is_overtime    boolean        // beyond the agenda's allocation
```
Only `type='focus'` + `outcome='completed'` counts toward "used pomodoro". Aborted sessions are still logged (they are honest data) but never counted.

### 4.5 `availability_windows`
```
day_of_week   0..6              // 0 = Sunday
start_time    "HH:mm"           // local time
end_time      "HH:mm"
enabled       boolean
```
Multiple windows per day are allowed (e.g. Monday 04:00–07:00 **and** 09:00–22:00).

Seed defaults:
- Mon–Fri: one window, 04:00–22:00
- Sat–Sun: one window, 06:00–20:00

### 4.6 `time_blocks`
```
name                  string
start_time            "HH:mm"
end_time              "HH:mm"
recurrence            'once' | 'weekly'
days_of_week          number[]           // for weekly
specific_date         ISO date | null    // for once
end_date              ISO date | null    // optional recurrence end
filter_category_ids   uuid[]
filter_tags           string[]
filter_priorities     number[]
color                 string
enabled               boolean
```

### 4.7 `time_block_exceptions`
```
time_block_id   uuid
date            ISO date
action          'skipped'
```
Lets the user skip a single instance of a recurring block.

### 4.8 `settings` (single row)
```
timezone                    string    // default "Asia/Jakarta"
latitude                    number    // default -6.9175  (Bandung)
longitude                   number    // default 107.6191
prayer_calculation_method   string    // default "Kemenag"
prayer_blocks               { fajr, dhuhr, asr, maghrib, isha: { enabled: boolean, duration_min: number } }
friday_dhuhr_duration_min   number    // default 90
default_buffer_before_min   number    // default 0
default_buffer_after_min    number    // default 10
default_buffer_type         'switch'
pomodoro_focus_min          number    // default 25
pomodoro_short_break_min    number    // default 5
pomodoro_long_break_min     number    // default 15
pomodoro_long_break_every   number    // default 4
ticking_enabled             boolean   // default true
ticking_volume              number    // 0..1
bell_enabled                boolean
bell_volume                 number
theme                       'dark' | 'light' | 'system'   // default 'dark'
gcal_calendar_id            string | null
```

### 4.9 `outbox`
```
entity        'todo' | 'agenda' | 'category' | 'pomodoro_log' | 'settings' | 'time_block' | 'gcal'
entity_id     uuid
operation     'create' | 'update' | 'delete'
payload       json
attempts      number
last_error    string | null
status        'pending' | 'blocked'
created_at    ISO datetime
```

### 4.10 `gcal_busy_cache`
Read-only mirror of busy intervals from the user's *other* Google calendars, used by the scheduler. Store `start_at`, `end_at`, `calendar_id`, `summary`, `fetched_at`. Refresh on foreground for a rolling window of −7 to +30 days.

---

## 5. Business rules — the heart of the app

These rules are the reason this app exists. Implement them in a **pure, framework-free, fully unit-tested** module at `lib/scheduling/`. No React, no Dexie imports in that folder. This is non-negotiable: the scheduler must be testable in isolation.

### 5.1 Availability windows — soft constraint

- **Smart allocation never places anything outside an availability window.** Hard rule.
- **Manual drag/create outside a window is allowed**, but shows a confirmation: *"Di luar jam produktif kamu. Tetap jadwalkan?"* If confirmed, set `outside_window = true` and render the agenda with a distinct warning stripe.

### 5.2 Buffers — typed, with asymmetric collision math

Each side of an agenda has a buffer with a **duration** and a **type**:
- `switch` — mental context-switching time.
- `commute` — physical travel time.

They mean different things, so they compose differently. For a gap between agenda A (ending) and agenda B (starting):

```
switch_need  = max( A.buffer_after_min  where type == 'switch',
                    B.buffer_before_min where type == 'switch' )

commute_need = max( A.buffer_after_min  where type == 'commute',
                    B.buffer_before_min where type == 'commute' )

required_gap = switch_need + commute_need
```

**Within the same type, take the max. Across types, sum.** Rationale: two mental-switch buffers overlap in purpose, so the larger one absorbs the smaller. But you cannot do your mental reset *while* you are commuting — those needs stack.

Worked examples:
- A.after = 10 (switch), B.before = 15 (switch) → gap = 15
- A.after = 10 (switch), B.before = 15 (commute) → gap = 25
- A.after = 20 (commute), B.before = 15 (commute) → gap = 20

Additional buffer rules:
- Buffers consume schedulable space — no other agenda may occupy them.
- Buffers are **not** written to Google Calendar as separate events.
- Render buffers as a thin, muted stripe attached to the agenda block in the calendar view.
- Buffers are clamped by the availability window edges (a buffer may extend past the window end without triggering the outside-window warning).

### 5.3 Prayer blocks

- Computed **offline** with `adhan`, using stored coordinates and the Kemenag calculation method.
- Five daily blocks, default 20 minutes each, starting at the prayer time.
- **Friday Dhuhr is a special case:** duration `friday_dhuhr_duration_min` (default 90) instead of 20.
- Each prayer can be toggled off and have its duration adjusted individually in Settings.
- Prayer blocks are **local only** — never written to Google Calendar.
- They are treated as **busy** by the scheduler: smart allocation never overlaps them. Manual placement over a prayer block requires confirmation.
- Render them with a distinct, calm visual treatment (not the same as todo agendas).

### 5.4 Time blocking — hard for the machine, soft for the human

A time block declares: *during this window, only tasks matching this filter may be scheduled.*

**Filter semantics: OR within a dimension, AND across dimensions.**
```
matches = (category_id ∈ filter_category_ids OR filter_category_ids is empty)
      AND (todo.tags ∩ filter_tags ≠ ∅       OR filter_tags is empty)
      AND (priority ∈ filter_priorities      OR filter_priorities is empty)
```

- **Smart allocation treats this as a hard rule.** Only matching todos may be placed inside the block. **If no matching todo exists, the slot is left empty** — never backfill with a non-matching task.
- **Manual drag into a block is allowed** with a confirmation: *"Slot ini khusus [nama blok]. Tetap tempatkan di sini?"*
- Recurring blocks (weekly, chosen days) or one-time, with an optional end date, and per-instance skip via `time_block_exceptions`.
- Render time blocks as a tinted background band behind the timeline, clearly *behind* agendas, not competing with them.

### 5.5 Smart allocation — deterministic greedy

Given a set of todos (typically the current `focus_week` set) and a date range:

**Step 1 — Build the free-space map.** For each day in range: start with the availability windows, then subtract prayer blocks, existing non-draft agendas *with their buffers*, and `gcal_busy_cache` intervals. Result: a list of free intervals per day.

**Step 2 — Sort candidates.** Strictly in this order:
1. Todos whose dependencies are all satisfied (blocked todos are excluded entirely)
2. Earliest `due_date` first (null due dates last)
3. Highest priority first (P1 → P4)
4. Largest `remaining_to_allocate` first
5. `created_at` ascending (tiebreaker — guarantees determinism)

**Step 3 — Place each candidate.** For each todo, while `remaining_to_allocate > 0`:
- Session size = `min(remaining_to_allocate, 4)` pomodoros, minimum 1.
- Session duration = `n × focus_min + (n − 1) × short_break_min`. So 1→25m, 2→55m, 3→85m, 4→115m.
- Walk free intervals **chronologically from the earliest**. Take the first interval that (a) fits the session plus required buffers, and (b) satisfies any time block covering it.
- Try progressively smaller session sizes (4→3→2→1) before giving up on a day.
- **Cap: at most 2 sessions for the same todo per day.**
- On placement, create an agenda with `status = 'draft'` and update the free-space map.

**Step 4 — Report the remainder.** Any todo that could not be fully allocated goes into a panel:

> **Tidak muat minggu ini (5 todo)**
> Coba: perpanjang jam produktif · kurangi target minggu ini · turunkan estimasi

**Never silently spill into the following week.** Never place anything outside an availability window. Never overlap a prayer block or a GCal busy interval.

**Step 5 — Preview and apply.** All results are drafts, rendered with a dashed border. The user may drag, resize, or delete individual drafts. Only on **Terapkan** are they promoted to `planned` and queued for Google Calendar. Show a toast with **Urungkan** (Undo) that reverts the entire batch for 10 seconds.

### 5.6 Pomodoro mechanics

- Default cycle: 25 focus / 5 short break; long break of 15 min after every 4 focus sessions.
- **Breaks auto-start.** The next focus session waits for an explicit tap. (Rationale: rest should be frictionless, work should be chosen.)
- **Timing must be wall-clock based.** Persist `started_at` and compute elapsed time from `Date.now()` on every tick and on every visibility change. Never accumulate time with `setInterval` counters — background tabs throttle and the timer would drift. On returning to the app after the target end time has passed, immediately resolve the session as completed.
- Request a **Screen Wake Lock** while a focus session runs; release it on pause/finish. Handle the case where it is unavailable.
- Persist the running session so a refresh, crash, or app close resumes it correctly.
- A focus session counts as **used** only if the full 25 minutes elapse. Aborting logs `outcome='aborted'` and counts for nothing.
- **Overtime is allowed.** Running more pomodoros than allocated is fine; mark those logs `is_overtime = true` and render them in a distinct accent color.
- Focus can also be started without an agenda (an untethered session), logged with `agenda_id = null`.

**Audio — synthesize with the Web Audio API, no files.**
- Ticking: a short synthesized click once per second (a brief oscillator burst through a fast-decay gain envelope — keep it soft, not sharp).
- Bell: a warm two-tone chime at session end.
- **iOS requires user interaction to unlock audio.** Create and resume the `AudioContext` inside the tap handler on **"Mulai fokus"** — never on page load. Play a silent buffer at unlock time.
- Independent on/off and volume for ticking and bell in Settings.
- Handle `AudioContext` suspension when the tab backgrounds; resume on foreground.

### 5.7 Pomodoro symbols on agendas

Render allocation as a row of small circles on each agenda block:
- `○` empty circle = allocated but not yet used
- `●` filled circle = completed
- `◐` half/dashed = currently in progress
- filled circle in accent color = overtime (beyond allocation)

Example: an agenda allocated 4 with 2 done, 1 running → `● ● ◐ ○`.

### 5.8 Missed agenda review

An agenda is **missed** when `end_at` is in the past and `status` is still `planned`. Detect this on app foreground.

Show a dismissible banner at the top of the Tasks screen: *"Review 3 agenda yang terlewat"*. Tapping opens a review sheet listing each missed agenda with four one-tap actions:

1. **Selesai** — asks how many pomodoros were actually used (pre-filled with the allocation, adjustable with +/−), sets `status='done'`.
2. **Sebagian** — same pomodoro prompt, sets `status='partial'`, and offers to schedule the remainder.
3. **Jadwalkan ulang** — computes and offers **3 nearest valid slots** (using the same free-space engine as smart allocation) as one-tap chips, plus "Pilih waktu lain…".
4. **Lepas ke inbox** — deletes the agenda (and its GCal event), returning the todo to unscheduled.

Support bulk selection: select several, apply one action to all.

### 5.9 Agenda ↔ todo status coupling

- Completing an agenda does **not** auto-complete its todo.
- **But:** when an agenda is completed and that todo has no remaining allocation and no future agendas, prompt once: *"Todo '[judul]' sudah selesai?"* with **Ya, selesai** / **Belum**. One tap.
- Completing a todo that still has future `planned` agendas asks: *"Hapus 2 agenda yang belum jalan?"* — default yes.

---

## 6. Google Calendar integration

### 6.1 Setup
- On first connect, find or create a secondary calendar named **"FOQUS"**. Store its ID in `settings.gcal_calendar_id`. **Never write to the primary calendar.**
- OAuth scopes: `calendar.events` and `calendar.readonly`. Request incremental authorization after login, not during it.

### 6.2 Write (FOQUS → Google)
- Only agendas with `status='planned' | 'done' | 'partial'` are written. Drafts and cancelled agendas are not.
- Set `extendedProperties.private.foqusAgendaId = <agenda id>` for reliable round-trip matching.
- Event body: title = agenda title, description = todo notes + a pomodoro summary line, no attendees, no reminders (Phase 1).
- All writes go through the outbox, so scheduling works offline.
- Deleting an agenda deletes its Google event.

### 6.3 Read (Google → FOQUS)
- **From the FOQUS calendar:** incremental sync with a stored `syncToken`. If a returned event carries a `foqusAgendaId`, apply its time changes to the local agenda (last-write-wins by timestamp). If the token is invalidated (410), fall back to a full resync of the −7/+30 day window.
- **From all other calendars:** use the `freebusy` endpoint to populate `gcal_busy_cache`. These are read-only obstacles for the scheduler and render as muted "busy" bands in the calendar view.
- Sync triggers: app foreground, manual pull-to-refresh, and every 5 minutes while the app is open and online. **No webhooks or push channels in Phase 1** — they require a stable public endpoint and renewal logic that is not worth the cost yet.

### 6.4 Conflicts
If a Google event was modified more recently than the local agenda, the Google version wins. Set `gcal_conflict = true`, show a small badge on the agenda for 24 hours, and log it. Never lose data silently without at least the badge.

---

## 7. Screens & navigation

Bottom tab bar with four items: **Tugas** · **Kalender** · **Pekan Ini** · **Pengaturan**.

The **Fokus** screen is a full-screen overlay, not a tab. When minimized it collapses into a floating pill above the tab bar showing the remaining time and the task title; tapping it restores the full view. The timer keeps running regardless.

### 7.1 Tugas (Tasks)
- Header: today's progress ring (pomodoros used / allocated today), streak counter, sync indicator.
- Missed-agenda review banner when applicable.
- Grouping toggle: by category / by due date / by priority. Filter chips for tags.
- Each row shows: checkbox, title, category color dot, priority indicator, due date, `remaining_to_allocate` badge, expand chevron if it has children, lock icon if blocked.
- Subtasks are nested with indentation and are collapsible.
- FAB for quick capture: a single text field plus a compact row of optional attributes. Capture must be fast — one tap to open, type, enter.
- Tapping a row opens a detail bottom sheet with all fields, subtask list, dependency picker, and the list of that todo's agendas.

### 7.2 Kalender (Calendar)
- Views: **Hari** (default), **3 Hari**, **Daftar Agenda**. **No week view** — seven columns is unreadable on a phone.
- Vertical timeline. Current-time indicator line. Auto-scroll to the current hour on open.
- Layers, back to front: availability window shading → time block bands → GCal busy bands → prayer blocks → agendas (with buffer stripes) → draft agendas.
- Header shows the day's totals: agenda count, allocated pomodoros, free hours remaining.

### 7.3 Pekan Ini (Weekly Plan)
- Week picker (defaults to the current ISO week).
- Two sections: **Target pekan ini** (todos with `focus_week` set) and **Kandidat** (everything else, searchable).
- Capacity meter: *"Terpakai 32 / kapasitas 48 pomodoro"* — capacity derived from availability windows minus prayer blocks and existing commitments.
- Primary button: **Alokasikan otomatis** → runs smart allocation → drops the user into the calendar in draft-preview mode with **Terapkan** / **Batalkan** bar pinned at the bottom.
- The unallocated remainder panel from §5.5 Step 4 appears here.

### 7.4 Fokus (Focus)
- Large circular progress ring, remaining time, task title, session counter (*"Pomodoro 2 dari 4"*).
- Controls: Jeda / Lanjut, Lewati, Selesai.
- Break screen is visually distinct (calmer palette) and auto-starts.
- On completion: bell, ring-fill animation, haptic, and the pomodoro dot fills with a satisfying transition.

### 7.5 Pengaturan (Settings)
Sections: Akun & Google Calendar · Jam produktif (availability window editor) · Buffer default · Waktu sholat (per-prayer toggles + durations + location/timezone override) · Pomodoro (durations, audio toggles and volumes) · Kategori · Blok waktu (time block manager) · Tampilan (theme) · Sinkronisasi (queue status, blocked items, force resync) · Tentang.

---

## 8. Gesture vocabulary

Lock these down precisely — gesture conflicts with vertical scrolling are the most common failure mode in this kind of app. Use `dnd-kit` with a touch activation constraint (delay ~200ms, tolerance ~5px) so drags never hijack scroll.

| Screen | Gesture | Action |
|---|---|---|
| Tugas | swipe right | Complete (with animation) |
| Tugas | swipe left | Reveal menu: Jadwalkan · Edit · Hapus |
| Tugas | long-press + drag | Reorder; drop onto a category header to reassign |
| Tugas | tap | Open detail sheet |
| Kalender | drag agenda block | Move in time, snapping to 5-minute increments |
| Kalender | drag top/bottom edge | Resize, snapping to whole pomodoro durations |
| Kalender | horizontal swipe on canvas | Previous / next day |
| Kalender | long-press empty area | Create an agenda or time block starting there |

**Drag and drop never crosses screens.** Because Tasks and Calendar are separate screens on mobile, converting a todo into an agenda goes through an explicit flow: swipe left → **Jadwalkan** → a sheet offers **3 recommended slots** (from the free-space engine) as one-tap chips, plus **Pilih waktu lain…** which opens a mini calendar picker.

All destructive gestures are undoable via a toast with **Urungkan** for 5 seconds.

---

## 9. Reward system

The goal is earned satisfaction, not slot-machine noise. Celebrate meaningful completions; keep routine ones crisp and quiet.

- **Confetti** (`canvas-confetti`) fires only for: completing a todo that has subtasks, or clearing every agenda for the day. Not on every tap — scarcity is what makes it feel like a reward.
- **Routine completion:** animated checkmark, a brief strikethrough sweep, and a haptic tap (`navigator.vibrate` where supported).
- **Pomodoro end:** bell chime, the progress ring fills and pulses once, the corresponding dot fills.
- **Daily progress ring** in the Tasks header — pomodoros used vs allocated today.
- **Streak counter** — consecutive days with ≥1 completed pomodoro. Display it plainly. **No guilt messaging when a streak breaks** — show the new count and move on. Never send a shaming notification.
- **"Hari Selesai" screen** when all of today's agendas have been reviewed: pomodoro total, top category, streak, and one honest line of encouragement.
- Every animation must respect `prefers-reduced-motion`: replace motion with instant state changes, and skip confetti entirely.

---

## 10. Offline & PWA requirements

- Full app shell precached; the app opens and is usable with the network off.
- Web app manifest with proper icons (192, 512, maskable), `display: standalone`, theme color matching the dark palette.
- Installable on iOS home screen; handle safe-area insets (`env(safe-area-inset-*)`) so the tab bar is not eaten by the home indicator.
- **In-app notifications only in Phase 1**: use the Notification API for pomodoro/break completion when the document is available. Do **not** build push infrastructure.
- Offline indicator in the header with the pending-operation count.

---

## 11. Scope boundary

**Phase 1 — build all of this now:**
Todo CRUD with hierarchy and dependencies · categories, tags, priorities · Tasks screen with full gesture vocabulary · Calendar day/3-day/list views · agenda CRUD · buffer engine · availability windows · prayer blocks · time blocking · pomodoro engine, logs, and dot symbols · Google Calendar two-way sync · offline outbox and sync engine · missed-agenda review · Weekly Plan with smart allocation and draft preview · reward and animation system · Settings.

**Phase 2 — document in `docs/PHASE2.md`, do not implement:**
Web Push notifications (service worker + VAPID, agenda reminders) · deep statistics and analytics dashboards · data export/import · a rich multi-device conflict-resolution UI · non-Google calendar providers (CalDAV, Outlook) · natural-language quick capture · collaboration or multi-user.

If you find yourself wanting to build something in the Phase 2 list to make Phase 1 work, stop and ask instead.

---

## 12. Implementation order

Build in these milestones. **After each one: verify it builds, verify it runs, write a short summary of what changed, then continue.** Do not start a milestone before the previous one works.

**M0 — Foundation.** Next.js + TypeScript + Tailwind + shadcn/ui scaffold. PWA manifest and service worker. Dark theme tokens and the base mobile layout with the bottom tab bar (empty screens). Supabase project wiring, Google OAuth login, RLS policies. Deployable to Vercel.

**M1 — Data layer.** Dexie schema, Supabase migrations, shared TypeScript types, the outbox table, and the sync engine with backoff and conflict logging. Seed data (categories, settings, availability windows). Prove it with a temporary debug screen that creates and syncs a record offline and online.

**M2 — Tasks.** Full todo CRUD, hierarchy with depth limit, dependencies with cycle detection, categories, tags, priorities, quick capture, detail sheet, grouping/filtering, and the complete gesture vocabulary for this screen. Derived pomodoro counters.

**M3 — Scheduling core (pure module).** `lib/scheduling/` with: availability window resolution, prayer time computation, the typed-buffer collision rule, the free-space map builder, and the slot-suggestion function. **Comprehensive unit tests, including every buffer example in §5.2.** No UI in this milestone.

**M4 — Calendar.** Day / 3-day / list views, the layered timeline rendering, agenda CRUD, drag-to-move and drag-to-resize with snapping, the "Jadwalkan" flow from Tasks with 3 suggested slots, and prayer block rendering.

**M5 — Google Calendar sync.** Server-side route handlers, FOQUS calendar creation, write path through the outbox, incremental read of the FOQUS calendar, freebusy caching from other calendars, conflict badge.

**M6 — Pomodoro.** Wall-clock timer engine with persistence and recovery, the Focus screen, the minimized pill, Web Audio ticking and bell with iOS unlock handling, wake lock, logging, and the dot symbols on agenda blocks.

**M7 — Time blocking.** Time block CRUD, recurrence, per-instance skip, filter matching, hard enforcement in the scheduler, soft confirmation on manual drag, and timeline band rendering.

**M8 — Weekly Plan & smart allocation.** The `focus_week` flag, the Weekly Plan screen, the capacity meter, the greedy allocation algorithm (unit-tested against fixture scenarios), draft preview mode, Terapkan/Urungkan.

**M9 — Missed agenda review.** Detection, banner, review sheet with the four actions, reschedule suggestions, bulk actions, and the agenda↔todo status coupling prompts.

**M10 — Reward layer & polish.** Confetti rules, completion animations, progress ring, streak, Day Complete screen, `prefers-reduced-motion` handling, haptics, empty states, loading skeletons, error boundaries, and an accessibility pass (touch targets ≥44px, focus order, labels).

---

## 13. Engineering standards

- **TypeScript strict.** No `any`. Model states as discriminated unions rather than boolean soup.
- `lib/scheduling/` is pure and framework-free. All scheduling rules live there, are unit-tested with Vitest, and are imported by the UI — never reimplemented inside components.
- All datetimes stored in **UTC**, converted at the presentation boundary using the user's configured timezone. Never construct dates from naive local strings.
- Optimistic UI everywhere. No spinner should ever block a user action that can be performed locally.
- Keep components small; extract data access into hooks under `hooks/`.
- Write tests for: the buffer collision rule, free-space computation, the allocation algorithm, prayer time calculation, time block filter matching, and timer recovery after a simulated background/foreground cycle.
- Provide a `.env.example` and a `README.md` covering Supabase setup, Google Cloud OAuth configuration (redirect URIs, scopes, consent screen), and Vercel deployment.
- Conventional commits, one milestone per logical group of commits.

---

## 14. Questions to raise rather than guess

If any of the following is ambiguous when you reach it, **stop and ask** rather than inventing behavior:

- Any conflict between two rules in §5.
- Google API quota, consent-screen verification, or scope issues that would change the architecture.
- A library in §2 that turns out to be incompatible with the installed Next.js version.
- Anything that would require Phase 2 infrastructure to make a Phase 1 feature work.

Everything else in this document is decided. Build it.
