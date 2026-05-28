-- Support incremental note sync that includes active notes and tombstones.
-- The GET /notes?since= query scans all rows (not just deleted_at is null), so it
-- needs an index without the partial predicate that notes_user_updated_idx has.
create index if not exists notes_user_updated_all_idx
  on public.notes (user_id, updated_at desc);
