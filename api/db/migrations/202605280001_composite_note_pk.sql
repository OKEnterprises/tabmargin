-- Make the notes primary key per-tenant so client-generated ids cannot collide
-- across users.
--
-- Before: `id text primary key` was a GLOBAL key. Note ids are generated
-- client-side, so two users could produce the same id. The second user's
-- `upsert(..., { onConflict: 'id' })` would resolve to the first user's row,
-- which the RLS UPDATE policy (auth.uid() = user_id) hides from them, so the
-- write failed permanently as an opaque 500 — a cross-tenant denial-of-write.
--
-- After: the key is (user_id, id), so the same id under two different users is
-- two distinct rows and never collides.

alter table public.notes drop constraint notes_pkey;
alter table public.notes add constraint notes_pkey primary key (user_id, id);
