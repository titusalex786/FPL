-- ============================================================
-- Migration: 20261031040000_disable_timer_after_first_bid.sql
-- Description: Disables the countdown timer once the first bid
--              has been placed for any player lot.
--              - Before the first bid, the initial timer counts down.
--              - After the first bid is placed, the timer is cleared (bid_deadline_at = NULL)
--                and BID_DEADLINE_EXPIRED is NEVER thrown.
--              - Bidding remains open at the floor pace until the manager settles as SOLD.
-- ============================================================

-- 1. Update place_admin_auction_bid_v1
CREATE OR REPLACE FUNCTION place_admin_auction_bid_v1(
    p_auction_id UUID,
    p_lot_id UUID,
    p_team_owner_id UUID,
    p_bid_amount INTEGER,
    p_actor_id UUID
)
RETURNS auction_lots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_lot auction_lots;
    v_selection auction_player_selections;
    v_budget auction_team_budgets;
    v_registration_status TEXT;
    v_registration_type TEXT;
    v_players_remaining INTEGER;
    v_reserve_required INTEGER;
    v_dynamic_maximum INTEGER;
    v_effective_maximum INTEGER;
    v_expected_next_bid INTEGER;
    v_previous_bid INTEGER;
    v_now TIMESTAMPTZ;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BIDDER_NOT_AUTHORIZED';
    END IF;

    IF p_bid_amount IS NULL OR p_bid_amount <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BID_AMOUNT';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_LIVE';
    END IF;

    SELECT * INTO v_lot
    FROM auction_lots
    WHERE id = p_lot_id
      AND auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LOT_NOT_FOUND';
    END IF;

    v_now := clock_timestamp();

    IF v_lot.status = 'SOLD' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_SOLD';
    END IF;

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_LIVE';
    END IF;

    -- Enforce deadline ONLY if no bid has been placed yet.
    -- Once 1st bid exists, the timer is disabled and bidding stays open.
    IF v_lot.current_highest_bid IS NULL THEN
        IF v_lot.bid_deadline_at IS NOT NULL AND v_now >= v_lot.bid_deadline_at THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'BID_DEADLINE_EXPIRED';
        END IF;
    END IF;

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND registration_id = v_lot.registration_id
      AND player_id = v_lot.player_id;

    IF NOT FOUND
       OR v_selection.selection_status <> 'SELECTED'
       OR v_selection.candidate_type = 'ICON'
       OR EXISTS (
           SELECT 1
           FROM team_owners owner_team
           WHERE owner_team.tournament_id = v_auction.tournament_id
             AND owner_team.icon_registration_id = v_lot.registration_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT registration.registration_status::TEXT, registration.registration_type::TEXT
    INTO v_registration_status, v_registration_type
    FROM registrations registration
    WHERE registration.id = v_lot.registration_id
      AND registration.tournament_id = v_auction.tournament_id
      AND registration.player_id = v_lot.player_id
    FOR SHARE;

    IF NOT FOUND
       OR v_registration_status IN ('REJECTED', 'CANCELLED')
       OR v_registration_type = 'ICON'
       OR EXISTS (
           SELECT 1
           FROM auction_purchases purchase
           WHERE purchase.auction_id = p_auction_id
             AND (
                 purchase.registration_id = v_lot.registration_id
                 OR (purchase.registration_id IS NULL AND purchase.player_id = v_lot.player_id)
             )
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT * INTO v_budget
    FROM auction_team_budgets
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND team_owner_id = p_team_owner_id
      AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    v_players_remaining := v_auction.required_players_to_buy - v_budget.players_bought;
    IF v_players_remaining <= 0
       OR v_budget.players_remaining <> v_players_remaining THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    IF v_lot.current_highest_team_owner_id = p_team_owner_id THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CANNOT_OUTBID_SELF';
    END IF;

    IF NOT v_auction.allow_owner_self_purchase
       AND v_selection.candidate_type = 'OWNER'
       AND EXISTS (
           SELECT 1
           FROM team_owners original_owner
           WHERE original_owner.tournament_id = v_auction.tournament_id
             AND original_owner.owner_registration_id = v_lot.registration_id
             AND original_owner.id = p_team_owner_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SELF_BIDDING_NOT_ALLOWED';
    END IF;

    IF v_lot.current_highest_bid IS NULL THEN
        IF p_bid_amount < v_auction.base_bid THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BID_BELOW_BASE';
        END IF;
    ELSE
        IF v_lot.current_highest_bid < v_auction.bid_threshold THEN
            v_expected_next_bid := v_lot.current_highest_bid + v_auction.low_increment;
        ELSE
            v_expected_next_bid := v_lot.current_highest_bid + v_auction.high_increment;
        END IF;

        IF p_bid_amount <> v_expected_next_bid THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BID_INCREMENT';
        END IF;
    END IF;

    IF p_bid_amount > v_budget.remaining_kitty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_KITTY';
    END IF;

    v_reserve_required := (v_players_remaining - 1) * v_auction.minimum_reserve;
    v_dynamic_maximum := GREATEST(0, v_budget.remaining_kitty - v_reserve_required);

    IF p_bid_amount > v_dynamic_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESERVE_VIOLATION';
    END IF;

    v_effective_maximum := v_dynamic_maximum;
    IF v_auction.maximum_bid IS NOT NULL THEN
        v_effective_maximum := LEAST(v_effective_maximum, v_auction.maximum_bid);
    END IF;

    IF p_bid_amount > v_effective_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_ABOVE_MAX_AFFORDABLE';
    END IF;

    v_previous_bid := v_lot.current_highest_bid;

    -- Update lot: clear bid_deadline_at so timer is disabled after 1st bid
    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = p_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = NULL,
        paused_remaining_seconds = NULL,
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    INSERT INTO auction_events (
        auction_id,
        tournament_id,
        team_owner_id,
        player_id,
        event_type,
        event_payload,
        amount,
        previous_value,
        new_value,
        created_by
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        p_team_owner_id,
        v_lot.player_id,
        'BID_PLACED',
        jsonb_build_object(
            'lot_id', v_lot.id,
            'registration_id', v_lot.registration_id,
            'round_id', v_lot.round_id,
            'bid_amount', p_bid_amount,
            'previous_bid', v_previous_bid,
            'team_owner_id', p_team_owner_id,
            'bidder_user_id', p_actor_id,
            'last_bid_at', v_now,
            'bid_deadline_at', NULL,
            'placed_by_admin', true
        ),
        p_bid_amount,
        v_previous_bid,
        p_bid_amount,
        p_actor_id
    );

    RETURN v_lot;
END;
$$;

-- 2. Update place_auction_bid_v1
CREATE OR REPLACE FUNCTION place_auction_bid_v1(
    p_auction_id UUID,
    p_lot_id UUID,
    p_bid_amount INTEGER,
    p_bidder_user_id UUID
)
RETURNS auction_lots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_lot auction_lots;
    v_selection auction_player_selections;
    v_budget auction_team_budgets;
    v_registration_status TEXT;
    v_registration_type TEXT;
    v_team_owner_id UUID;
    v_owner_count INTEGER;
    v_players_remaining INTEGER;
    v_reserve_required INTEGER;
    v_dynamic_maximum INTEGER;
    v_effective_maximum INTEGER;
    v_expected_next_bid INTEGER;
    v_previous_bid INTEGER;
    v_now TIMESTAMPTZ;
BEGIN
    IF p_bidder_user_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BIDDER_NOT_AUTHORIZED';
    END IF;

    IF p_bid_amount IS NULL OR p_bid_amount <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BID_AMOUNT';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_LIVE';
    END IF;

    SELECT * INTO v_lot
    FROM auction_lots
    WHERE id = p_lot_id
      AND auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LOT_NOT_FOUND';
    END IF;

    v_now := clock_timestamp();

    IF v_lot.status = 'SOLD' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_SOLD';
    END IF;

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_LIVE';
    END IF;

    -- Enforce deadline ONLY if no bid has been placed yet
    IF v_lot.current_highest_bid IS NULL THEN
        IF v_lot.bid_deadline_at IS NOT NULL AND v_now >= v_lot.bid_deadline_at THEN
            RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'BID_DEADLINE_EXPIRED';
        END IF;
    END IF;

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND registration_id = v_lot.registration_id
      AND player_id = v_lot.player_id;

    IF NOT FOUND
       OR v_selection.selection_status <> 'SELECTED'
       OR v_selection.candidate_type = 'ICON'
       OR EXISTS (
           SELECT 1
           FROM team_owners owner_team
           WHERE owner_team.tournament_id = v_auction.tournament_id
             AND owner_team.icon_registration_id = v_lot.registration_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT registration.registration_status::TEXT, registration.registration_type::TEXT
    INTO v_registration_status, v_registration_type
    FROM registrations registration
    WHERE registration.id = v_lot.registration_id
      AND registration.tournament_id = v_auction.tournament_id
      AND registration.player_id = v_lot.player_id
    FOR SHARE;

    IF NOT FOUND
       OR v_registration_status IN ('REJECTED', 'CANCELLED')
       OR v_registration_type = 'ICON'
       OR EXISTS (
           SELECT 1
           FROM auction_purchases purchase
           WHERE purchase.auction_id = p_auction_id
             AND (
                 purchase.registration_id = v_lot.registration_id
                 OR (purchase.registration_id IS NULL AND purchase.player_id = v_lot.player_id)
             )
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT COUNT(*), (ARRAY_AGG(budget.team_owner_id))[1]
    INTO v_owner_count, v_team_owner_id
    FROM auction_team_budgets budget
    JOIN team_owners owner_team
      ON owner_team.id = budget.team_owner_id
     AND owner_team.tournament_id = budget.tournament_id
    JOIN players owner_player
      ON owner_player.id = owner_team.player_id
    WHERE budget.auction_id = p_auction_id
      AND budget.tournament_id = v_auction.tournament_id
      AND budget.status = 'ACTIVE'
      AND (
          owner_player.auth_user_id = p_bidder_user_id
          OR owner_team.created_by_auth_id = p_bidder_user_id
          OR EXISTS (
              SELECT 1
              FROM registrations reg
              WHERE reg.tournament_id = budget.tournament_id
                AND reg.team_owner_id = owner_team.id
                AND reg.registration_type = 'OWNER'
                AND (reg.created_by_auth_id = p_bidder_user_id OR reg.user_id = p_bidder_user_id)
          )
      );

    IF v_owner_count = 0 THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BIDDER_NOT_AUTHORIZED';
    END IF;

    IF v_owner_count > 1 THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MULTIPLE_TEAMS_NOT_SUPPORTED';
    END IF;

    SELECT * INTO v_budget
    FROM auction_team_budgets
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND team_owner_id = v_team_owner_id
      AND status = 'ACTIVE'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    v_players_remaining := v_auction.required_players_to_buy - v_budget.players_bought;
    IF v_players_remaining <= 0
       OR v_budget.players_remaining <> v_players_remaining THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    IF v_lot.current_highest_team_owner_id = v_team_owner_id THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CANNOT_OUTBID_SELF';
    END IF;

    IF NOT v_auction.allow_owner_self_purchase
       AND v_selection.candidate_type = 'OWNER'
       AND EXISTS (
           SELECT 1
           FROM team_owners original_owner
           WHERE original_owner.tournament_id = v_auction.tournament_id
             AND original_owner.owner_registration_id = v_lot.registration_id
             AND original_owner.id = v_team_owner_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SELF_BIDDING_NOT_ALLOWED';
    END IF;

    IF v_lot.current_highest_bid IS NULL THEN
        IF p_bid_amount < v_auction.base_bid THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'BID_BELOW_BASE';
        END IF;
    ELSE
        IF v_lot.current_highest_bid < v_auction.bid_threshold THEN
            v_expected_next_bid := v_lot.current_highest_bid + v_auction.low_increment;
        ELSE
            v_expected_next_bid := v_lot.current_highest_bid + v_auction.high_increment;
        END IF;

        IF p_bid_amount <> v_expected_next_bid THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BID_INCREMENT';
        END IF;
    END IF;

    IF p_bid_amount > v_budget.remaining_kitty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_KITTY';
    END IF;

    v_reserve_required := (v_players_remaining - 1) * v_auction.minimum_reserve;
    v_dynamic_maximum := GREATEST(0, v_budget.remaining_kitty - v_reserve_required);

    IF p_bid_amount > v_dynamic_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESERVE_VIOLATION';
    END IF;

    v_effective_maximum := v_dynamic_maximum;
    IF v_auction.maximum_bid IS NOT NULL THEN
        v_effective_maximum := LEAST(v_effective_maximum, v_auction.maximum_bid);
    END IF;

    IF p_bid_amount > v_effective_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_ABOVE_MAX_AFFORDABLE';
    END IF;

    v_previous_bid := v_lot.current_highest_bid;

    -- Update lot: clear bid_deadline_at so timer is disabled after 1st bid
    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = v_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = NULL,
        paused_remaining_seconds = NULL,
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    INSERT INTO auction_events (
        auction_id,
        tournament_id,
        team_owner_id,
        player_id,
        event_type,
        event_payload,
        amount,
        previous_value,
        new_value,
        created_by
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        v_team_owner_id,
        v_lot.player_id,
        'BID_PLACED',
        jsonb_build_object(
            'lot_id', v_lot.id,
            'registration_id', v_lot.registration_id,
            'round_id', v_lot.round_id,
            'bid_amount', p_bid_amount,
            'previous_bid', v_previous_bid,
            'team_owner_id', v_team_owner_id,
            'bidder_user_id', p_bidder_user_id,
            'last_bid_at', v_now,
            'bid_deadline_at', NULL
        ),
        p_bid_amount,
        v_previous_bid,
        p_bid_amount,
        p_bidder_user_id
    );

    RETURN v_lot;
END;
$$;

-- 3. Clear deadline for any currently live lot that already has bids placed
UPDATE auction_lots
SET bid_deadline_at = NULL,
    paused_remaining_seconds = NULL
WHERE status = 'LIVE'
  AND current_highest_bid IS NOT NULL;

-- 4. Permissions
REVOKE ALL ON FUNCTION place_admin_auction_bid_v1(UUID, UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_admin_auction_bid_v1(UUID, UUID, UUID, INTEGER, UUID) TO service_role;

REVOKE ALL ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO authenticated, service_role;
