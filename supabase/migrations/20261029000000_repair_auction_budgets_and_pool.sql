-- Migration: 20261029000000_repair_auction_budgets_and_pool.sql
-- Purpose: Additive repair migration.
--   1. Creates reprovision_auction_budgets_v1 — inserts missing auction_team_budgets
--      for all valid team owners WITHOUT requiring registration_status = CONFIRMED.
--      Fully idempotent; existing budgets are preserved via ON CONFLICT DO NOTHING.
--   2. Does NOT touch provision_auction_v1 (historical migration, already applied).
--   3. populate_auction_player_pool (20261028000000) is already payment-agnostic;
--      no changes needed to that function.
-- Safety: READ EXISTING STATE FIRST. No deletes, no resets, no tournament changes.

-- ============================================================
-- 1.  reprovision_auction_budgets_v1
--     Inserts ONE budget per team_owner that has player_id set,
--     skipping any team_owner that already has a budget row.
-- ============================================================
CREATE OR REPLACE FUNCTION reprovision_auction_budgets_v1(
    p_auction_id UUID,
    p_actor_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction       auctions;
    v_inserted      INTEGER;
    v_total_budgets INTEGER;
BEGIN
    -- Auth guard: must be admin or active manager
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'REPROVISION_BUDGETS_UNAUTHORIZED';
    END IF;

    -- Lock the auction row
    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    -- Only allow repair while auction is still DRAFT
    IF v_auction.status <> 'DRAFT' THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'REPROVISION_ONLY_ALLOWED_IN_DRAFT';
    END IF;

    -- Insert one budget row per team_owner that:
    --   * belongs to the same tournament
    --   * has player_id set (is a complete team)
    --   * does NOT already have a budget for this auction
    -- Eligibility is intentionally NOT filtered by registration_status
    -- or payment_status -- all registered teams participate in the auction.
    INSERT INTO auction_team_budgets (
        auction_id,
        tournament_id,
        team_owner_id,
        starting_kitty,
        remaining_kitty,
        required_players_to_buy,
        players_bought,
        players_remaining,
        icon_players_allocated,
        status
    )
    SELECT
        v_auction.id,
        v_auction.tournament_id,
        ot.id,
        v_auction.starting_kitty,
        v_auction.starting_kitty,
        v_auction.required_players_to_buy,
        0,
        v_auction.required_players_to_buy,
        v_auction.icon_players_allocated,
        'ACTIVE'
    FROM team_owners ot
    WHERE ot.tournament_id = v_auction.tournament_id
      AND ot.player_id IS NOT NULL
    ON CONFLICT (auction_id, team_owner_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Count total budgets now (including pre-existing ones)
    SELECT COUNT(*)::INTEGER
    INTO v_total_budgets
    FROM auction_team_budgets
    WHERE auction_id = p_auction_id;

    -- Audit event only if new rows were actually added
    IF v_inserted > 0 THEN
        INSERT INTO auction_events (
            auction_id,
            tournament_id,
            event_type,
            event_payload,
            created_by
        )
        VALUES (
            v_auction.id,
            v_auction.tournament_id,
            'ADMIN_ACTION',
            jsonb_build_object(
                'action',          'AUCTION_BUDGETS_REPAIRED',
                'budgets_added',   v_inserted,
                'total_budgets',   v_total_budgets
            ),
            p_actor_id
        );
    END IF;

    RETURN jsonb_build_object(
        'auction_id',      v_auction.id,
        'budgets_added',   v_inserted,
        'total_budgets',   v_total_budgets,
        'status',          v_auction.status
    );
END;
$$;

-- Restrict execution to service_role only
REVOKE ALL ON FUNCTION reprovision_auction_budgets_v1(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reprovision_auction_budgets_v1(UUID, UUID)
    TO service_role;

-- Tell PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
