-- "Immediately after" — an agenda pinned to the end of another agenda's buffer
-- rather than to a clock time. Moving the predecessor moves this one with it.
--
-- Deliberately not a foreign key, for the same reason as todos.parent_id (see
-- 0001): a pull from another device can deliver the follower before the agenda
-- it follows, and a hard FK would reject the row instead of converging. The
-- client resolves and repairs dangling links.

alter table public.agendas
  add column if not exists follows_agenda_id uuid;

create index if not exists agendas_follows_idx
  on public.agendas (user_id, follows_agenda_id)
  where follows_agenda_id is not null;

-- An agenda may not follow itself. Cycles longer than one are prevented on the
-- client, where the whole chain is visible.
alter table public.agendas
  drop constraint if exists agendas_follows_not_self;
alter table public.agendas
  add constraint agendas_follows_not_self check (follows_agenda_id is null or follows_agenda_id <> id);
