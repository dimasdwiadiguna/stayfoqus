# FOQUS — Phase 2

§11 of `BRIEF.md` lists what is explicitly **out of scope for Phase 1**. This
document records each item, why it was deferred, and what the Phase 1 codebase
already does (or deliberately does not do) to leave room for it.

Nothing here is implemented. If a Phase 1 feature ever appears to need one of
these, that is a signal to stop and ask — §11 says so directly.

---

## 1. Web Push notifications (service worker + VAPID, agenda reminders)

**Why deferred.** Push needs a stable public endpoint, a VAPID key pair, a
subscription store per device, and renewal logic when a subscription expires.
§10 is explicit: "In-app notifications only in Phase 1."

**What Phase 1 does instead.** `notifyLocal()` in `lib/reward.ts` uses the
Notification API directly, only while the document is available, and only for
pomodoro/break completion. Permission is requested lazily at the first
notification rather than on load.

**What is already in place.** The service worker (`app/sw.ts`) is a real
Serwist worker with a lifecycle, so adding a `push` listener is additive. What
is *not* in place, on purpose: any subscription table, any VAPID configuration,
any server route that could send a push.

**Rough shape of the work.** A `push_subscriptions` table with RLS; a
`/api/push/subscribe` route; a `push` + `notificationclick` handler in the
worker; a scheduled sender that reads upcoming agendas. The sender is the
expensive part — it needs a cron surface FOQUS does not currently have.

---

## 2. Deep statistics and analytics dashboards

**Why deferred.** The data to build them is already being collected honestly —
that was the point of logging aborted sessions (§4.4) and of separating
`allocated` from `used` (§4.2). What is missing is only the presentation, and
presentation without a clear question to answer tends to become decoration.

**What Phase 1 does instead.** The narrow, actionable numbers only: today's
progress ring, the streak counter, the "Hari Selesai" summary, and the weekly
capacity meter.

**What is already in place.** `pomodoro_logs` carries `type`, `outcome`,
`is_overtime`, `duration_sec` and both `agenda_id` and `todo_id`, so per-day,
per-category and per-todo aggregates are all derivable without a migration.

---

## 3. Data export / import

**Why deferred.** Export is easy; *import* is where the difficulty is — merging
an arbitrary dump into a live last-write-wins dataset without duplicating rows
or resurrecting deletions is its own design problem.

**What is already in place.** Client-generated UUIDs and soft deletes mean an
export is a straightforward dump of the Dexie tables, and a re-import of an
export from the *same* account would converge. The unsolved case is importing
into a different account, where every `user_id` and every id would need
rewriting.

---

## 4. Rich multi-device conflict-resolution UI

**Why deferred.** §3.2 is explicit: "Do not build a merge UI in Phase 1."

**What Phase 1 does instead.** Last-write-wins by `updated_at`, with the losing
value recorded in `conflict_log` and a dismissible badge telling the user how
many changes from another device were applied.

**What is already in place.** `conflict_log` stores both timestamps and the row
id for every resolution, so a future UI can show exactly what was overwritten —
though not the overwritten *values*, which are not retained. Storing those is
the first thing this feature would need.

---

## 5. Non-Google calendar providers (CalDAV, Outlook)

**Why deferred.** Each provider brings a different auth dance, a different
event model, and a different incremental-sync mechanism. §6 specifies Google
Calendar API v3 concretely.

**What is already in place.** The provider boundary is narrower than it looks:
the client only ever talks to `/api/gcal/*` and only ever speaks the small
vocabulary in `lib/gcal/types.ts` (`upsert_event`, `delete_event`, a pull that
returns events plus busy intervals). A second provider would implement that
same surface behind a different route prefix.

**What is *not* in place.** `agendas` has a single `gcal_event_id` column, not a
provider-tagged mapping table. Supporting two providers at once needs that
column to become a row set.

---

## 6. Natural-language quick capture

**Why deferred.** "Besok jam 3 sore, rapat tim" is a parsing problem with a
long tail, and getting it wrong is worse than not having it: a silently
mis-parsed date produces a commitment the user did not make.

**What Phase 1 does instead.** §7.1's compact attribute row — one tap for
priority, estimate and today's date — which covers the common cases with no
ambiguity.

**What is already in place.** Capture already goes through one function
(`createTodo`), so a parser would slot in ahead of it rather than beside it.

---

## 7. Collaboration / multi-user

**Why deferred.** §1 states the product is "for a single user". Sharing changes
the meaning of nearly every rule in §5 — whose availability window, whose
prayer blocks, whose pomodoro counted.

**What is already in place.** Every table already carries `user_id` and every
RLS policy is written against `auth.uid()`, so the data model is not
single-tenant by accident. Adding collaboration would mean adding a sharing
relation, not rewriting ownership.

**What is *not* in place.** No concept of a row visible to more than one user;
no per-row permissions; no presence or realtime channel.

---

## Deliberate non-goals (not scheduled for Phase 2 either)

These came up while building Phase 1 and were rejected rather than deferred:

- **A merge UI for the outbox.** Blocked entries are shown with their error and
  can be retried or dropped. Anything richer implies the user should be
  debugging sync, which they should not.
- **Server-side scheduling.** The whole scheduler is pure and runs on-device,
  which is what makes it work offline. Moving it to a server would trade the
  app's defining property for nothing.
- **Guilt mechanics.** §9 rules them out and the reasoning generalises: no
  shaming notifications, no streak-loss animations, no "you missed 3 days".
