-- Migration: 20261031070000_fix_owner_auction_settlement_and_self_purchase.sql
-- Purpose: 
--   1. Fix settle_auction_lot_v1 so that when an OWNER registration is bought by another team,
--      its registration_type becomes 'PLAYER' (preventing uq_registrations_owner_team_owner collision).
--   2. Enable allow_owner_self_purchase on the live auction so owner teams can bid on their captain/owner.

-- 1. Enable allow_owner_self_purchase on live auction
UPDATE auctions
SET allow_owner_self_purchase = TRUE
WHERE id = '5f58dd30-3188-478c-9c72-7b613309ab7c';

-- 2. Update settle_auction_lot_v1
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
    v_winning_team_name TEXT;
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

    -- Fetch winning team name
    SELECT team_name INTO v_winning_team_name
    FROM team_owners
    WHERE id = v_lot.current_highest_team_owner_id;

    -- Deduct kitty and increment count exactly once
    UPDATE auction_team_budgets
    SET remaining_kitty = remaining_kitty - v_lot.current_highest_bid,
        players_bought = players_bought + 1,
        players_remaining = players_remaining - 1,
        updated_at = v_now
    WHERE id = v_budget.id;

    -- Update registration ownership
    -- If an OWNER registration is bought by another team, update registration_type to 'PLAYER'
    -- to prevent violating the uq_registrations_owner_team_owner unique constraint.
    UPDATE registrations
    SET team_owner_id = v_lot.current_highest_team_owner_id,
        team_name = COALESCE(v_winning_team_name, team_name),
        registration_type = CASE 
            WHEN registration_type = 'OWNER' 
                 AND team_owner_id IS NOT NULL 
                 AND team_owner_id <> v_lot.current_highest_team_owner_id 
            THEN 'PLAYER'
            ELSE registration_type
        END
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

REVOKE ALL ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) TO service_role;
