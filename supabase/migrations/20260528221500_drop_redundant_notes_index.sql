-- Drop the partial index notes_user_updated_idx. It indexes
-- (user_id, updated_at desc) WHERE deleted_at IS NULL — a subset of what the
-- unconditional notes_user_updated_all_idx (user_id, updated_at desc) already
-- covers, including the default GET /notes query that filters deleted_at IS NULL.
-- Keeping both just doubles write-time index maintenance for a marginal read gain
-- on the active-notes list. Apply with `supabase db push`.
drop index if exists public.notes_user_updated_idx;
