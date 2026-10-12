-- Ensure the legacy players table supports the v2 profile linkage.
-- Nullable linkage preserves existing and tournament-only player records.
ALTER TABLE public.players
    ADD COLUMN IF NOT EXISTS auth_user_id UUID
        REFERENCES auth.users(id) ON DELETE CASCADE;
