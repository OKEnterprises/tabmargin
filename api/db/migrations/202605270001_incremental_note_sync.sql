-- Support incremental note sync that includes active notes and tombstones.

create index if not exists notes_user_updated_all_idx
  on public.notes (user_id, updated_at desc);
