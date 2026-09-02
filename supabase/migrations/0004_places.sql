-- Places, and the columns that let a commute buffer be computed rather than
-- typed.
--
-- Until now `commute` was only a *label* on a buffer: the collision rule in
-- §5.2 composed it correctly, the timeline drew it, the ticker announced it —
-- but the number was always entered by hand. A place is a pinned coordinate,
-- and the distance between two of them is what the estimate is made of.
--
-- A place is a table rather than inline coordinates on each row because the
-- same place is reused across many todos and events, and moving the pin has to
-- move every estimate with it.

create table if not exists public.places (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  latitude    double precision not null,
  longitude   double precision not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists places_user_updated_idx
  on public.places (user_id, updated_at);

-- Owner-only access and the staleness guard, exactly as every other synced
-- table gets in 0001.
alter table public.places enable row level security;

drop policy if exists places_owner on public.places;
create policy places_owner on public.places for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists places_no_stale on public.places;
create trigger places_no_stale before update on public.places
  for each row execute function public.reject_stale_update();

-- Where work happens.
--
-- Deliberately NOT foreign keys, for the reason 0001 gives for todos.parent_id
-- and 0002 for agendas.follows_agenda_id: the outbox drains in order but a
-- *pull* from another device can deliver a row before the place it points at,
-- and a hard FK would reject it rather than converge. A dangling place_id is
-- read as "no location", which is the same as null.
alter table public.todos
  add column if not exists place_id uuid;

alter table public.agendas
  add column if not exists place_id uuid;

alter table public.events
  add column if not exists place_id uuid;

-- While true, the row's *before* buffer is owned by the commute reconciler and
-- rewritten whenever the day's order changes. Typing a buffer by hand clears
-- it, and the estimate never overwrites the user again.
alter table public.agendas
  add column if not exists commute_auto boolean not null default true;

alter table public.events
  add column if not exists commute_auto boolean not null default true;

-- The origin of every day, and the speed the estimate assumes.
--
-- home_place_id has no default on purpose: the settings row already carries
-- latitude/longitude, but those are the *prayer* coordinates and default to a
-- city centre the user never confirmed. Adopting them as home would measure
-- every commute from a guess.
alter table public.settings
  add column if not exists home_place_id uuid;

alter table public.settings
  add column if not exists commute_speed_kmh integer not null default 22
    check (commute_speed_kmh > 0);
