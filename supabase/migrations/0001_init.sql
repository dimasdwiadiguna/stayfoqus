-- FOQUS — initial schema.
-- Mirrors lib/db/schema.ts. Keep the two in sync by hand; the Dexie schema is
-- the source the UI reads and this is the replica the sync engine pushes to.
--
-- Conventions:
--   * every table carries id / user_id / created_at / updated_at / deleted_at
--   * ids are client-generated UUIDs so offline creation needs no reconciliation
--   * deletes are soft; nothing is ever removed by the sync path
--   * updated_at is the last-write-wins clock and is supplied by the client

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- helper: reject a write that would move updated_at backwards
-- ---------------------------------------------------------------------------
-- Last-write-wins is resolved on the client, but a retried outbox entry can
-- arrive after a newer write from another device. This trigger makes the
-- server idempotent under that race instead of resurrecting stale values.
create or replace function public.reject_stale_update()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  color       text not null,
  icon        text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- todos
-- ---------------------------------------------------------------------------
create table if not exists public.todos (
  id                  uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  title               text not null,
  notes               text,
  category_id         uuid,
  priority            smallint not null default 4 check (priority between 1 and 4),
  tags                text[] not null default '{}',
  due_date            date,
  estimated_pomodoro  integer not null default 1 check (estimated_pomodoro >= 0),
  parent_id           uuid,
  blocked_by          uuid[] not null default '{}',
  status              text not null default 'inbox'
                        check (status in ('inbox', 'active', 'done', 'archived')),
  completed_at        timestamptz,
  focus_week          text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

-- Self-references are intentionally NOT foreign keys: the outbox drains in
-- insertion order but a pull from another device can deliver a child before its
-- parent, and a hard FK would reject the row instead of converging.
create index if not exists todos_user_updated_idx on public.todos (user_id, updated_at);
create index if not exists todos_parent_idx on public.todos (user_id, parent_id);
create index if not exists todos_focus_week_idx on public.todos (user_id, focus_week);

-- ---------------------------------------------------------------------------
-- agendas
-- ---------------------------------------------------------------------------
create table if not exists public.agendas (
  id                  uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  todo_id             uuid not null,
  title_override      text,
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  allocated_pomodoro  integer not null default 1 check (allocated_pomodoro >= 0),
  buffer_before_min   integer not null default 0 check (buffer_before_min >= 0),
  buffer_before_type  text not null default 'switch'
                        check (buffer_before_type in ('switch', 'commute')),
  buffer_after_min    integer not null default 0 check (buffer_after_min >= 0),
  buffer_after_type   text not null default 'switch'
                        check (buffer_after_type in ('switch', 'commute')),
  status              text not null default 'planned'
                        check (status in ('planned', 'draft', 'done', 'partial', 'missed', 'cancelled')),
  outside_window      boolean not null default false,
  gcal_event_id       text,
  gcal_synced_at      timestamptz,
  gcal_conflict       boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists agendas_user_updated_idx on public.agendas (user_id, updated_at);
create index if not exists agendas_range_idx on public.agendas (user_id, start_at, end_at);
create index if not exists agendas_todo_idx on public.agendas (user_id, todo_id);
create unique index if not exists agendas_gcal_event_idx
  on public.agendas (user_id, gcal_event_id)
  where gcal_event_id is not null;

-- ---------------------------------------------------------------------------
-- pomodoro_logs
-- ---------------------------------------------------------------------------
create table if not exists public.pomodoro_logs (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  agenda_id     uuid,
  todo_id       uuid,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  duration_sec  integer not null default 0 check (duration_sec >= 0),
  type          text not null check (type in ('focus', 'short_break', 'long_break')),
  outcome       text not null check (outcome in ('completed', 'aborted')),
  is_overtime   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists pomodoro_logs_user_updated_idx
  on public.pomodoro_logs (user_id, updated_at);
create index if not exists pomodoro_logs_started_idx
  on public.pomodoro_logs (user_id, started_at);

-- ---------------------------------------------------------------------------
-- availability_windows
-- ---------------------------------------------------------------------------
create table if not exists public.availability_windows (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  start_time   text not null,
  end_time     text not null,
  enabled      boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists availability_windows_user_updated_idx
  on public.availability_windows (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- time_blocks / time_block_exceptions
-- ---------------------------------------------------------------------------
create table if not exists public.time_blocks (
  id                   uuid primary key,
  user_id              uuid not null references auth.users (id) on delete cascade,
  name                 text not null,
  start_time           text not null,
  end_time             text not null,
  recurrence           text not null check (recurrence in ('once', 'weekly')),
  days_of_week         smallint[] not null default '{}',
  specific_date        date,
  end_date             date,
  filter_category_ids  uuid[] not null default '{}',
  filter_tags          text[] not null default '{}',
  filter_priorities    smallint[] not null default '{}',
  color                text not null,
  enabled              boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists time_blocks_user_updated_idx
  on public.time_blocks (user_id, updated_at);

create table if not exists public.time_block_exceptions (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  time_block_id  uuid not null,
  date           date not null,
  action         text not null default 'skipped' check (action in ('skipped')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index if not exists time_block_exceptions_user_updated_idx
  on public.time_block_exceptions (user_id, updated_at);

-- ---------------------------------------------------------------------------
-- settings (one row per user)
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id                         uuid primary key,
  user_id                    uuid not null references auth.users (id) on delete cascade,
  timezone                   text not null default 'Asia/Jakarta',
  latitude                   double precision not null default -6.9175,
  longitude                  double precision not null default 107.6191,
  prayer_calculation_method  text not null default 'Kemenag',
  prayer_blocks              jsonb not null,
  friday_dhuhr_duration_min  integer not null default 90,
  default_buffer_before_min  integer not null default 0,
  default_buffer_after_min   integer not null default 10,
  default_buffer_type        text not null default 'switch'
                               check (default_buffer_type in ('switch', 'commute')),
  pomodoro_focus_min         integer not null default 25,
  pomodoro_short_break_min   integer not null default 5,
  pomodoro_long_break_min    integer not null default 15,
  pomodoro_long_break_every  integer not null default 4,
  ticking_enabled            boolean not null default true,
  ticking_volume             double precision not null default 0.35,
  bell_enabled               boolean not null default true,
  bell_volume                double precision not null default 0.6,
  theme                      text not null default 'dark'
                               check (theme in ('dark', 'light', 'system')),
  gcal_calendar_id           text,
  gcal_sync_token            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  deleted_at                 timestamptz
);

-- The settings row id is a client-side constant shared by every device, so it
-- must be unique per user rather than globally.
create unique index if not exists settings_one_per_user_idx on public.settings (user_id);

-- ---------------------------------------------------------------------------
-- google_credentials — never readable by the browser (§3.3)
-- ---------------------------------------------------------------------------
create table if not exists public.google_credentials (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  refresh_token  text not null,
  access_token   text,
  expires_at     timestamptz,
  scope          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'categories', 'todos', 'agendas', 'pomodoro_logs',
    'availability_windows', 'time_blocks', 'time_block_exceptions', 'settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('drop policy if exists %I on public.%I', tbl || '_owner', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      tbl || '_owner', tbl
    );
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.reject_stale_update()',
      tbl || '_no_stale', tbl
    );
  end loop;
end;
$$;

-- google_credentials has RLS enabled and *no policies at all*: the anon and
-- authenticated roles therefore cannot see a single row. Only the service role
-- used by /app/api/gcal/* bypasses RLS and can read the refresh token.
alter table public.google_credentials enable row level security;
revoke all on public.google_credentials from anon, authenticated;
