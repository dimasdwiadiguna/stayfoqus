-- Google Calendar, configured in the app rather than behind it.
--
-- Until now the integration had exactly one thing the user could influence —
-- connect or disconnect — and everything else was decided by the code: the
-- calendar was found or created by the literal name "FOQUS", every other
-- calendar counted as busy, and the sync window was fixed at −7/+30 days inside
-- the route handler.
--
-- These columns move all of that into the settings row, which means it syncs
-- across devices like every other preference. The OAuth *client* stays in the
-- environment: a client secret is a deployment credential, not a preference,
-- and putting it in a table the app can write would be a step backwards.

alter table public.settings
  add column if not exists gcal_enabled boolean not null default true;

-- Kept so Pengaturan can name the chosen calendar without a round trip to
-- Google, which matters because that screen must render offline.
alter table public.settings
  add column if not exists gcal_calendar_name text;

alter table public.settings
  add column if not exists gcal_write_enabled boolean not null default true;

alter table public.settings
  add column if not exists gcal_busy_enabled boolean not null default true;

-- Null means "every calendar except the chosen one" — §6.3's default. An empty
-- array is a different statement: no calendar is busy. The distinction is why
-- this is nullable rather than `default '{}'`.
alter table public.settings
  add column if not exists gcal_busy_calendar_ids text[];

alter table public.settings
  add column if not exists gcal_window_past_days integer not null default 7
    check (gcal_window_past_days between 0 and 365);

alter table public.settings
  add column if not exists gcal_window_future_days integer not null default 30
    check (gcal_window_future_days between 1 and 365);
