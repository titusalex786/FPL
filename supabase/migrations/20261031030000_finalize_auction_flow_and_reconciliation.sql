-- ============================================================
-- Migration: 20261031030000_finalize_auction_flow_and_reconciliation.sql
-- Description:
--   1. Update settle_auction_lot_v1 to allow immediate SOLD settlement
--      without waiting for the timer to expire, provided a valid bid exists.
--      Prevents settlement if no bid exists.
--   2. Update end_auction_lot_unsold_v1 to mark lot UNSOLD immediately,
--      while strictly rejecting UNSOLD if an active bid exists.
--   3. Update place_auction_bid_v1 to allow both team owner and the associated
--      icon player/bidder to place bids on behalf of their owner/team.
--   4. Add get_unsold_retry_validation_v1 function for pre-retry round validation.
--   5. Add start_unsold_retry_round_v1 function to safely initialize retry round.
--   6. Add get_auction_reconciliation_v1 for authoritative end-of-auction audit.
-- ============================================================

-- 1. settle_auction_lot_v1: immediate SOLD settlement when valid bid exists
CREATE OR REPLACE FUNCTION settle_auction_lot_v1(
    p_auction_id UUID,
    p_lot_id UUID,
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
    v_registration registrations;
    v_round auction_rounds;
    v_last_bid_event auction_events;
    v_now TIMESTAMPTZ;
    v_players_remaining INTEGER;
    v_reserve_required INTEGER;
    v_maximum_affordable INTEGER;
    v_previous_team_owner_id UUID;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_UNAUTHORIZED';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status NOT IN ('LIVE', 'PAUSED') THEN
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

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_SETTLED';
    END IF;

    -- Settle (SOLD) requires a valid leading bid.
    -- Admin is allowed to settle immediately without waiting for timer deadline.
    IF v_lot.current_highest_bid IS NULL OR v_lot.current_highest_team_owner_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CANNOT_SETTLE_WITHOUT_BID';
    END IF;

    v_now := clock_timestamp();

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND registration_id = v_lot.registration_id
      AND player_id = v_lot.player_id
    FOR SHARE;

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

    SELECT * INTO v_registration
    FROM registrations
    WHERE id = v_lot.registration_id
      AND tournament_id = v_auction.tournament_id
      AND player_id = v_lot.player_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_registration.registration_status IN ('REJECTED', 'CANCELLED')
       OR v_registration.registration_type = 'ICON' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auction_purchases purchase
        WHERE purchase.auction_id = p_auction_id
          AND (
              purchase.registration_id = v_lot.registration_id
              OR (purchase.registration_id IS NULL AND purchase.player_id = v_lot.player_id)
          )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_ALREADY_PURCHASED';
    END IF;

    SELECT * INTO v_round
    FROM auction_rounds round
    WHERE round.id = v_lot.round_id
      AND round.auction_id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND OR v_round.status NOT IN ('OPEN', 'LIVE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ROUND_NOT_OPEN';
    END IF;

    IF v_lot.current_highest_bid < v_auction.base_bid THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_HIGHEST_BID_STATE';
    END IF;

    -- Verify last bid event
    SELECT * INTO v_last_bid_event
    FROM auction_events event
    WHERE event.auction_id = p_auction_id
      AND event.event_type = 'BID_PLACED'
      AND event.event_payload ->> 'lot_id' = v_lot.id::TEXT
    ORDER BY COALESCE(
        (event.event_payload ->> 'last_bid_at')::TIMESTAMPTZ,
        event.created_at
    ) DESC, event.id DESC
    LIMIT 1;

    IF NOT FOUND
       OR v_last_bid_event.amount <> v_lot.current_highest_bid
       OR v_last_bid_event.team_owner_id <> v_lot.current_highest_team_owner_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_HIGHEST_BID_STATE';
    END IF;

    SELECT * INTO v_budget
    FROM auction_team_budgets
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND team_owner_id = v_lot.current_highest_team_owner_id
    FOR UPDATE;

    IF NOT FOUND OR v_budget.status <> 'ACTIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    v_players_remaining := v_auction.required_players_to_buy - v_budget.players_bought;
    IF v_players_remaining <= 0
       OR v_budget.players_remaining <> v_players_remaining THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    v_reserve_required := (v_players_remaining - 1) * v_auction.minimum_reserve;
    v_maximum_affordable := GREATEST(0, v_budget.remaining_kitty - v_reserve_required);

    IF v_lot.current_highest_bid > v_budget.remaining_kitty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_KITTY';
    END IF;

    IF v_lot.current_highest_bid > v_maximum_affordable THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESERVE_VIOLATION';
    END IF;

    IF v_auction.maximum_bid IS NOT NULL
       AND v_lot.current_highest_bid > v_auction.maximum_bid THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_ABOVE_MAX_AFFORDABLE';
    END IF;

    v_previous_team_owner_id := v_registration.team_owner_id;

    -- Deduct kitty and increment count exactly once
    UPDATE auction_team_budgets
    SET remaining_kitty = remaining_kitty - v_lot.current_highest_bid,
        players_bought = players_bought + 1,
        players_remaining = players_remaining - 1,
        updated_at = v_now
    WHERE id = v_budget.id;

    -- Update registration ownership
    UPDATE registrations
    SET team_owner_id = v_lot.current_highest_team_owner_id
    WHERE id = v_registration.id
      AND tournament_id = v_auction.tournament_id;

    -- Mark lot SOLD
    UPDATE auction_lots
    SET status = 'SOLD',
        winning_team_owner_id = v_lot.current_highest_team_owner_id,
        sold_amount = v_lot.current_highest_bid,
        sold_at = v_now,
        settled_at = v_now,
        paused_remaining_seconds = NULL,
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    -- Insert authoritative purchase record
    INSERT INTO auction_purchases (
        auction_id,
        tournament_id,
        team_owner_id,
        registration_id,
        player_id,
        winning_bid,
        player_role,
        purchase_status
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        v_lot.winning_team_owner_id,
        v_lot.registration_id,
        v_lot.player_id,
        v_lot.sold_amount,
        COALESCE(v_registration.registered_role_snapshot, 'ALL_ROUNDER'),
        'COMPLETED'
    );

    -- Log PLAYER_SOLD event
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
        v_lot.winning_team_owner_id,
        v_lot.player_id,
        'PLAYER_SOLD',
        jsonb_build_object(
            'lot_id', v_lot.id,
            'registration_id', v_lot.registration_id,
            'round_id', v_lot.round_id,
            'round_number', v_round.round_number,
            'team_owner_id', v_lot.winning_team_owner_id,
            'winning_bid', v_lot.sold_amount,
            'previous_team_owner_id', v_previous_team_owner_id,
            'settled_at', v_now,
            'bid_deadline_at', v_lot.bid_deadline_at
        ),
        v_lot.sold_amount,
        NULL,
        v_lot.sold_amount,
        p_actor_id
    );

    -- Check if round is complete
    IF NOT EXISTS (
        SELECT 1
        FROM auction_lots remaining_lot
        WHERE remaining_lot.auction_id = p_auction_id
          AND remaining_lot.round_id = v_round.id
          AND remaining_lot.status IN ('AVAILABLE', 'LIVE')
    ) THEN
        UPDATE auction_rounds
        SET status = 'COMPLETED',
            completed_at = v_now
        WHERE id = v_round.id
          AND auction_id = p_auction_id;
    END IF;

    RETURN v_lot;
END;
$$;


-- 2. end_auction_lot_unsold_v1: immediate UNSOLD when no bid exists
CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1(
    p_auction_id UUID,
    p_lot_id UUID,
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
    v_round auction_rounds;
    v_now TIMESTAMPTZ;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_UNAUTHORIZED';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status NOT IN ('LIVE', 'PAUSED') THEN
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

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_SETTLED';
    END IF;

    -- REJECT UNSOLD if an active bid exists
    IF v_lot.current_highest_bid IS NOT NULL OR v_lot.current_highest_team_owner_id IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CANNOT_MARK_UNSOLD_WITH_ACTIVE_BID';
    END IF;

    v_now := clock_timestamp();

    SELECT * INTO v_round
    FROM auction_rounds round
    WHERE round.id = v_lot.round_id
      AND round.auction_id = p_auction_id
    FOR UPDATE;

    -- Mark lot as UNSOLD
    UPDATE auction_lots
    SET status = 'UNSOLD',
        settled_at = v_now,
        paused_remaining_seconds = NULL,
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    -- Log PLAYER_UNSOLD event
    INSERT INTO auction_events (
        auction_id,
        tournament_id,
        player_id,
        event_type,
        event_payload,
        created_by
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        v_lot.player_id,
        'PLAYER_UNSOLD',
        jsonb_build_object(
            'lot_id', v_lot.id,
            'registration_id', v_lot.registration_id,
            'round_id', v_lot.round_id,
            'round_number', COALESCE(v_round.round_number, 1),
            'reason', 'CLOSED_AS_UNSOLD_BY_MANAGER',
            'settled_at', v_now
        ),
        p_actor_id
    );

    -- Check if round is complete
    IF v_round.id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM auction_lots remaining_lot
        WHERE remaining_lot.auction_id = p_auction_id
          AND remaining_lot.round_id = v_round.id
          AND remaining_lot.status IN ('AVAILABLE', 'LIVE')
    ) THEN
        UPDATE auction_rounds
        SET status = 'COMPLETED',
            completed_at = v_now
        WHERE id = v_round.id
          AND auction_id = p_auction_id;
    END IF;

    RETURN v_lot;
END;
$$;


-- 3. place_auction_bid_v1: allows team owner AND associated icon player to place bids
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
    v_bidder_type TEXT;
BEGIN
    IF p_bidder_user_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_bidder_user_id) THEN
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

    IF v_lot.bid_deadline_at IS NULL OR v_now >= v_lot.bid_deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'BID_DEADLINE_EXPIRED';
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

    -- Authorize bidder: team owner OR designated icon player
    SELECT
        COUNT(*),
        (ARRAY_AGG(budget.team_owner_id))[1],
        CASE
            WHEN bool_or(
                EXISTS (
                    SELECT 1 FROM registrations icon_reg
                    LEFT JOIN players icon_player ON icon_player.id = icon_reg.player_id
                    WHERE icon_reg.id = owner_team.icon_registration_id
                      AND (
                          icon_reg.created_by_auth_id = p_bidder_user_id
                          OR icon_reg.user_id = p_bidder_user_id
                          OR icon_player.auth_user_id = p_bidder_user_id
                      )
                )
            ) THEN 'ICON'
            ELSE 'OWNER'
        END
    INTO v_owner_count, v_team_owner_id, v_bidder_type
    FROM auction_team_budgets budget
    JOIN team_owners owner_team
      ON owner_team.id = budget.team_owner_id
     AND owner_team.tournament_id = budget.tournament_id
    LEFT JOIN players owner_player
      ON owner_player.id = owner_team.player_id
    WHERE budget.auction_id = p_auction_id
      AND budget.tournament_id = v_auction.tournament_id
      AND budget.status = 'ACTIVE'
      AND (
          -- Owner matches
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
          -- Icon player matches
          OR EXISTS (
              SELECT 1
              FROM registrations icon_reg
              LEFT JOIN players icon_player ON icon_player.id = icon_reg.player_id
              WHERE icon_reg.id = owner_team.icon_registration_id
                AND (
                    icon_reg.created_by_auth_id = p_bidder_user_id
                    OR icon_reg.user_id = p_bidder_user_id
                    OR icon_player.auth_user_id = p_bidder_user_id
                    OR EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = p_bidder_user_id
                          AND (u.phone = icon_reg.contact_phone OR u.raw_user_meta_data->>'phone' = icon_reg.contact_phone)
                    )
                )
          )
      )
    GROUP BY budget.team_owner_id;

    IF v_owner_count IS NULL OR v_owner_count = 0 THEN
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

    v_reserve_required := (v_players_remaining - 1) * v_auction.minimum_reserve;
    v_dynamic_maximum := GREATEST(0, v_budget.remaining_kitty - v_reserve_required);
    v_effective_maximum := CASE
        WHEN v_auction.maximum_bid IS NULL THEN v_dynamic_maximum
        ELSE LEAST(v_dynamic_maximum, v_auction.maximum_bid)
    END;

    IF p_bid_amount > v_budget.remaining_kitty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_KITTY';
    END IF;

    IF p_bid_amount > v_dynamic_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESERVE_VIOLATION';
    END IF;

    IF p_bid_amount > v_effective_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_ABOVE_MAX_AFFORDABLE';
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
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_BELOW_BASE';
        END IF;
    ELSE
        v_expected_next_bid := CASE
            WHEN v_lot.current_highest_bid < v_auction.bid_threshold THEN
                v_lot.current_highest_bid + v_auction.low_increment
            ELSE
                v_lot.current_highest_bid + v_auction.high_increment
        END;

        IF p_bid_amount < v_expected_next_bid THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_BID_INCREMENT';
        END IF;
    END IF;

    v_previous_bid := v_lot.current_highest_bid;

    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = v_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
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
            'team_owner_id', v_team_owner_id,
            'amount', p_bid_amount,
            'previous_amount', v_previous_bid,
            'last_bid_at', v_now,
            'bidder_user_id', p_bidder_user_id,
            'bidder_type', v_bidder_type,
            'bid_deadline_at', v_lot.bid_deadline_at
        ),
        p_bid_amount,
        v_previous_bid,
        p_bid_amount,
        p_bidder_user_id
    );

    RETURN v_lot;
END;
$$;


-- 4. get_unsold_retry_validation_v1: Pre-retry round validation check
CREATE OR REPLACE FUNCTION get_unsold_retry_validation_v1(
    p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_initial_unsold_count INTEGER := 0;
    v_retry_eligible_count INTEGER := 0;
    v_already_retried_count INTEGER := 0;
    v_sold_count_excluded INTEGER := 0;
    v_invalid_or_cancelled_count INTEGER := 0;
    v_eligible_candidates JSONB := '[]'::jsonb;
    v_has_live_or_available_lots BOOLEAN := false;
BEGIN
    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    -- Check if current active round still has remaining available/live lots
    SELECT EXISTS (
        SELECT 1 FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status IN ('AVAILABLE', 'LIVE')
    ) INTO v_has_live_or_available_lots;

    -- 1. Initial round unsold count (from round 1)
    SELECT COUNT(*)::INTEGER INTO v_initial_unsold_count
    FROM auction_lots lot
    JOIN auction_rounds rnd ON rnd.id = lot.round_id
    WHERE lot.auction_id = p_auction_id
      AND rnd.round_number = 1
      AND lot.status = 'UNSOLD';

    -- 2. Sold count excluded
    SELECT COUNT(*)::INTEGER INTO v_sold_count_excluded
    FROM auction_lots
    WHERE auction_id = p_auction_id
      AND status = 'SOLD';

    -- 3. Already retried count (in rounds > 1)
    SELECT COUNT(*)::INTEGER INTO v_already_retried_count
    FROM auction_lots lot
    JOIN auction_rounds rnd ON rnd.id = lot.round_id
    WHERE lot.auction_id = p_auction_id
      AND rnd.round_number > 1;

    -- 4. Eligible candidates
    SELECT
        COUNT(*)::INTEGER,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'registration_id', c.registration_id,
                    'player_id', c.player_id,
                    'player_name', c.player_name,
                    'role', c.role,
                    'original_lot_number', c.original_lot_number
                )
            ),
            '[]'::jsonb
        )
    INTO v_retry_eligible_count, v_eligible_candidates
    FROM (
        SELECT
            lot.registration_id,
            lot.player_id,
            reg.registered_name_snapshot AS player_name,
            reg.registered_role_snapshot AS role,
            lot.lot_number AS original_lot_number
        FROM auction_lots lot
        JOIN auction_rounds rnd ON rnd.id = lot.round_id
        JOIN auction_player_selections sel
          ON sel.auction_id = lot.auction_id
         AND sel.registration_id = lot.registration_id
        JOIN registrations reg
          ON reg.id = lot.registration_id
        WHERE lot.auction_id = p_auction_id
          AND rnd.round_number = 1
          AND lot.status = 'UNSOLD'
          AND sel.selection_status = 'SELECTED'
          AND sel.candidate_type <> 'ICON'
          AND reg.registration_status NOT IN ('REJECTED', 'CANCELLED')
          AND reg.registration_type <> 'ICON'
          AND NOT EXISTS (
              SELECT 1 FROM team_owners o
              WHERE o.tournament_id = v_auction.tournament_id
                AND o.icon_registration_id = lot.registration_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_purchases p
              WHERE p.auction_id = p_auction_id
                AND (p.registration_id = lot.registration_id OR p.player_id = lot.player_id)
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_lots retry_lot
              JOIN auction_rounds retry_rnd ON retry_rnd.id = retry_lot.round_id
              WHERE retry_lot.auction_id = p_auction_id
                AND retry_rnd.round_number > 1
                AND retry_lot.registration_id = lot.registration_id
          )
        ORDER BY lot.lot_number ASC
    ) c;

    -- Invalid or cancelled
    v_invalid_or_cancelled_count := GREATEST(0, v_initial_unsold_count - v_retry_eligible_count - v_already_retried_count);

    RETURN jsonb_build_object(
        'initial_unsold_count', v_initial_unsold_count,
        'retry_eligible_count', v_retry_eligible_count,
        'already_retried_count', v_already_retried_count,
        'sold_count_excluded', v_sold_count_excluded,
        'invalid_or_duplicate_count', v_invalid_or_cancelled_count,
        'has_active_round_pending_lots', v_has_live_or_available_lots,
        'can_start_retry_round', (v_retry_eligible_count > 0 AND NOT v_has_live_or_available_lots),
        'eligible_candidates', v_eligible_candidates
    );
END;
$$;


-- 5. start_unsold_retry_round_v1: Explicit manager start of retry round
CREATE OR REPLACE FUNCTION start_unsold_retry_round_v1(
    p_auction_id UUID,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_now TIMESTAMPTZ;
    v_next_round_number INTEGER;
    v_next_round_id UUID;
    v_lot_number_base INTEGER;
    v_inserted_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_UNAUTHORIZED';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status NOT IN ('OPEN', 'LIVE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_ACTIVE';
    END IF;

    -- Check if existing lots are still active
    IF EXISTS (
        SELECT 1 FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status IN ('AVAILABLE', 'LIVE')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'CANNOT_START_RETRY_ROUND_WHILE_LOTS_ACTIVE';
    END IF;

    v_now := clock_timestamp();

    SELECT COALESCE(MAX(round_number), 0) + 1
    INTO v_next_round_number
    FROM auction_rounds
    WHERE auction_id = p_auction_id;

    INSERT INTO auction_rounds (
        auction_id,
        tournament_id,
        round_number,
        round_type,
        status
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        v_next_round_number,
        'UNSOLD_RETRY',
        'OPEN'
    )
    RETURNING id INTO v_next_round_id;

    SELECT COALESCE(MAX(lot_number), 0)
    INTO v_lot_number_base
    FROM auction_lots
    WHERE auction_id = p_auction_id;

    INSERT INTO auction_lots (
        auction_id,
        tournament_id,
        registration_id,
        player_id,
        lot_number,
        status,
        round_id
    )
    SELECT
        p_auction_id,
        v_auction.tournament_id,
        candidates.registration_id,
        candidates.player_id,
        v_lot_number_base + ROW_NUMBER() OVER (
            ORDER BY candidates.original_lot_number, candidates.registration_id
        )::INTEGER,
        'AVAILABLE',
        v_next_round_id
    FROM (
        SELECT
            lot.registration_id,
            lot.player_id,
            lot.lot_number AS original_lot_number
        FROM auction_lots lot
        JOIN auction_rounds rnd ON rnd.id = lot.round_id
        JOIN auction_player_selections sel
          ON sel.auction_id = lot.auction_id
         AND sel.registration_id = lot.registration_id
        JOIN registrations reg
          ON reg.id = lot.registration_id
        WHERE lot.auction_id = p_auction_id
          AND lot.status = 'UNSOLD'
          AND sel.selection_status = 'SELECTED'
          AND sel.candidate_type <> 'ICON'
          AND reg.registration_status NOT IN ('REJECTED', 'CANCELLED')
          AND reg.registration_type <> 'ICON'
          AND NOT EXISTS (
              SELECT 1 FROM team_owners o
              WHERE o.tournament_id = v_auction.tournament_id
                AND o.icon_registration_id = lot.registration_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_purchases p
              WHERE p.auction_id = p_auction_id
                AND (p.registration_id = lot.registration_id OR p.player_id = lot.player_id)
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_lots retry_lot
              JOIN auction_rounds retry_rnd ON retry_rnd.id = retry_lot.round_id
              WHERE retry_lot.auction_id = p_auction_id
                AND retry_rnd.round_number >= v_next_round_number
                AND retry_lot.registration_id = lot.registration_id
          )
    ) candidates
    ON CONFLICT (auction_id, round_id, registration_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count = 0 THEN
        -- No eligible candidates found
        DELETE FROM auction_rounds WHERE id = v_next_round_id;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'NO_ELIGIBLE_UNSOLD_PLAYERS_FOR_RETRY';
    END IF;

    -- Update auction current round
    UPDATE auctions
    SET current_round_id = v_next_round_id,
        updated_at = v_now
    WHERE id = p_auction_id;

    -- Audit log
    INSERT INTO auction_events (
        auction_id,
        tournament_id,
        event_type,
        event_payload,
        created_by
    )
    VALUES (
        p_auction_id,
        v_auction.tournament_id,
        'ADMIN_ACTION',
        jsonb_build_object(
            'action', 'RETRY_ROUND_STARTED',
            'round_id', v_next_round_id,
            'round_number', v_next_round_number,
            'lots_created', v_inserted_count,
            'started_by', p_actor_id,
            'started_at', v_now
        ),
        p_actor_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'round_id', v_next_round_id,
        'round_number', v_next_round_number,
        'lots_created', v_inserted_count
    );
END;
$$;


-- 6. get_auction_reconciliation_v1: End of auction reconciliation audit
CREATE OR REPLACE FUNCTION get_auction_reconciliation_v1(
    p_auction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_total_sold_lots INTEGER := 0;
    v_total_purchases INTEGER := 0;
    v_total_unique_registrations INTEGER := 0;
    v_missing_purchase_lots JSONB := '[]'::jsonb;
    v_orphan_purchases JSONB := '[]'::jsonb;
    v_team_breakdowns JSONB := '[]'::jsonb;
    v_discrepancies INTEGER := 0;
BEGIN
    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    -- Total SOLD lots
    SELECT COUNT(*)::INTEGER INTO v_total_sold_lots
    FROM auction_lots
    WHERE auction_id = p_auction_id
      AND status = 'SOLD';

    -- Total purchase records
    SELECT COUNT(*)::INTEGER, COUNT(DISTINCT registration_id)::INTEGER
    INTO v_total_purchases, v_total_unique_registrations
    FROM auction_purchases
    WHERE auction_id = p_auction_id;

    -- Sold lots missing purchase records
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'lot_id', lot.id,
                'lot_number', lot.lot_number,
                'registration_id', lot.registration_id,
                'winning_team_owner_id', lot.winning_team_owner_id,
                'sold_amount', lot.sold_amount
            )
        ),
        '[]'::jsonb
    )
    INTO v_missing_purchase_lots
    FROM auction_lots lot
    WHERE lot.auction_id = p_auction_id
      AND lot.status = 'SOLD'
      AND NOT EXISTS (
          SELECT 1 FROM auction_purchases p
          WHERE p.auction_id = p_auction_id
            AND p.registration_id = lot.registration_id
      );

    -- Orphan purchases without matching SOLD lot
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'purchase_id', p.id,
                'registration_id', p.registration_id,
                'team_owner_id', p.team_owner_id,
                'winning_bid', p.winning_bid
            )
        ),
        '[]'::jsonb
    )
    INTO v_orphan_purchases
    FROM auction_purchases p
    WHERE p.auction_id = p_auction_id
      AND NOT EXISTS (
          SELECT 1 FROM auction_lots lot
          WHERE lot.auction_id = p_auction_id
            AND lot.registration_id = p.registration_id
            AND lot.status = 'SOLD'
      );

    -- Team breakdowns
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'team_owner_id', tb.team_owner_id,
                'team_name', tb.team_name,
                'budget_spent', tb.budget_spent,
                'purchases_total', tb.purchases_total,
                'players_bought', tb.players_bought,
                'purchases_count', tb.purchases_count,
                'is_matched', (tb.budget_spent = tb.purchases_total AND tb.players_bought = tb.purchases_count)
            )
        ),
        '[]'::jsonb
    )
    INTO v_team_breakdowns
    FROM (
        SELECT
            b.team_owner_id,
            COALESCE(t.team_name, t.owner_name, 'Team') AS team_name,
            (b.starting_kitty - b.remaining_kitty)::INTEGER AS budget_spent,
            COALESCE(SUM(p.winning_bid), 0)::INTEGER AS purchases_total,
            b.players_bought::INTEGER AS players_bought,
            COUNT(p.id)::INTEGER AS purchases_count
        FROM auction_team_budgets b
        JOIN team_owners t ON t.id = b.team_owner_id
        LEFT JOIN auction_purchases p
          ON p.auction_id = b.auction_id
         AND p.team_owner_id = b.team_owner_id
        WHERE b.auction_id = p_auction_id
        GROUP BY b.team_owner_id, t.team_name, t.owner_name, b.starting_kitty, b.remaining_kitty, b.players_bought
        ORDER BY t.team_name ASC
    ) tb;

    -- Calculate total discrepancies
    v_discrepancies := jsonb_array_length(v_missing_purchase_lots) +
                       jsonb_array_length(v_orphan_purchases) +
                       (v_total_sold_lots - v_total_purchases) +
                       (v_total_purchases - v_total_unique_registrations);

    RETURN jsonb_build_object(
        'auction_id', p_auction_id,
        'total_sold_lots', v_total_sold_lots,
        'total_purchase_records', v_total_purchases,
        'total_unique_purchased_registrations', v_total_unique_registrations,
        'missing_purchase_lots', v_missing_purchase_lots,
        'orphan_purchases', v_orphan_purchases,
        'team_breakdowns', v_team_breakdowns,
        'discrepancies_count', v_discrepancies,
        'is_reconciled', (v_discrepancies = 0)
    );
END;
$$;


-- 7. Permissions
REVOKE ALL ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION get_unsold_retry_validation_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_unsold_retry_validation_v1(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION start_unsold_retry_round_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION start_unsold_retry_round_v1(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION get_auction_reconciliation_v1(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_auction_reconciliation_v1(UUID) TO authenticated, service_role;
