-- Events — a commitment that is not a todo: a meeting, a class, an
-- appointment. The deliberate manual stand-in for the Google Calendar sync, so
-- that hours which are genuinely spoken for stop being handed out by the
-- allocator.
--
-- Shaped after time_blocks (wall-clock times plus a recurrence) rather than
-- absolute instants, so "every Tuesday at 09:00" stays 09:00 in the user's own
-- timezone. Unlike a time block, an event carries buffers of its own, and
-- end_time <= start_time means it ends on the following day.

create table if not exists public.events (
  id                  uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  title               text not null,
  location            text,
  notes               text,
  start_time          text not null,
  end_time            text not null,
  recurrence          text not null check (recurrence in ('once', 'weekly')),
  days_of_week        smallint[] not null default '{}',
  specific_date       date,
  end_date            date,
  buffer_before_min   integer not null default 0,
  buffer_before_type  text not null default 'switch' check (buffer_before_type in ('switch', 'commute')),
  buffer_after_min    integer not null default 0,
  buffer_after_type   text not null default 'switch' check (buffer_after_type in ('switch', 'commute')),
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists events_user_updated_idx
  on public.events (user_id, updated_at);

-- §4.7's shape, for events: skip a single occurrence of a repeat. Deliberately
-- not a foreign key on event_id, for the same reason as todos.parent_id in
-- 0001: a pull from another device can deliver the exception before the event
-- it belongs to, and a hard FK would reject the row instead of converging.
create table if not exists public.event_exceptions (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  event_id    uuid not null,
  date        date not null,
  action      text not null default 'skipped' check (action in ('skipped')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists event_exceptions_user_updated_idx
  on public.event_exceptions (user_id, updated_at);

create unique index if not exists event_exceptions_one_per_day_idx
  on public.event_exceptions (user_id, event_id, date);

-- Same row level security and staleness guard as every other synced table
-- (0001): owner-only access, and reject_stale_update so a retried outbox entry
-- cannot resurrect an older value.
do $$
declare
  tbl text;
begin
  foreach tbl in array array['events', 'event_exceptions']
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_owner', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      tbl || '_owner', tbl
    );
    execute format('drop trigger if exists %I on public.%I', tbl || '_no_stale', tbl);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.reject_stale_update()',
      tbl || '_no_stale', tbl
    );
  end loop;
end;
$$;
