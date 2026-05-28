-- Make the notes primary key per-tenant so client-generated ids cannot collide
-- across users. Before: a global `id` PK let one user's id collide with another's
-- and (under RLS) permanently fail the second writer's upsert. After: (user_id, id).
alter table public.notes drop constraint notes_pkey;
alter table public.notes add constraint notes_pkey primary key (user_id, id);
