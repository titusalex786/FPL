-- Phase A4: transactional live bidding. Final sale processing remains deferred.

ALTER TABLE auctions
    ADD COLUMN allow_owner_self_purchase BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX unique_live_auction_lot_per_auction
    ON auction_lots(auction_id)
    WHERE status = 'LIVE';

CREATE OR REPLACE FUNCTION start_auction_lot_v1(
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
    v_registration_status TEXT;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BIDDER_NOT_AUTHORIZED';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status NOT IN ('OPEN', 'LIVE') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_OPEN';
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

    IF v_lot.status <> 'AVAILABLE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_AVAILABLE';
    END IF;

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND registration_id = v_lot.registration_id
      AND player_id = v_lot.player_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_selection.selection_status <> 'SELECTED'
       OR v_selection.candidate_type = 'ICON' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT registration.registration_status::TEXT
    INTO v_registration_status
    FROM registrations registration
    WHERE registration.id = v_lot.registration_id
      AND registration.tournament_id = v_auction.tournament_id
      AND registration.player_id = v_lot.player_id
    FOR SHARE;

    IF NOT FOUND OR v_registration_status NOT IN ('CONFIRMED', 'PENDING')
       OR EXISTS (
           SELECT 1
           FROM auction_purchases purchase
           WHERE purchase.auction_id = p_auction_id
             AND purchase.player_id = v_lot.player_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auction_lots active_lot
        WHERE active_lot.auction_id = p_auction_id
          AND active_lot.status = 'LIVE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ACTIVE_LOT_EXISTS';
    END IF;

    IF v_auction.status = 'OPEN' THEN
        UPDATE auctions
        SET status = 'LIVE',
            updated_at = NOW()
        WHERE id = p_auction_id;

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
            'AUCTION_STATE_CHANGE',
            jsonb_build_object('previous_status', 'OPEN', 'status', 'LIVE'),
            p_actor_id
        );
    END IF;

    UPDATE auction_lots
    SET status = 'LIVE',
        current_highest_bid = NULL,
        current_highest_team_owner_id = NULL,
        updated_at = NOW()
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

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
        'ADMIN_ACTION',
        jsonb_build_object('action', 'LOT_STARTED', 'lot_id', v_lot.id),
        p_actor_id
    );

    RETURN v_lot;
END;
$$;

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
    v_team_owner_id UUID;
    v_owner_count INTEGER;
    v_players_remaining INTEGER;
    v_reserve_required INTEGER;
    v_dynamic_maximum INTEGER;
    v_effective_maximum INTEGER;
    v_expected_next_bid INTEGER;
    v_previous_bid INTEGER;
    v_configuration JSONB;
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

    IF v_lot.status = 'SOLD' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_SOLD';
    END IF;

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_LIVE';
    END IF;

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND registration_id = v_lot.registration_id
      AND player_id = v_lot.player_id;

    IF NOT FOUND
       OR v_selection.selection_status <> 'SELECTED'
       OR v_selection.candidate_type = 'ICON' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    SELECT registration.registration_status::TEXT
    INTO v_registration_status
    FROM registrations registration
    WHERE registration.id = v_lot.registration_id
      AND registration.tournament_id = v_auction.tournament_id
      AND registration.player_id = v_lot.player_id
    FOR SHARE;

    IF NOT FOUND OR v_registration_status NOT IN ('CONFIRMED', 'PENDING')
       OR EXISTS (
           SELECT 1
           FROM auction_purchases purchase
           WHERE purchase.auction_id = p_auction_id
             AND purchase.player_id = v_lot.player_id
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
      AND owner_player.auth_user_id = p_bidder_user_id;

    IF v_owner_count <> 1 THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    SELECT * INTO v_budget
    FROM auction_team_budgets
    WHERE auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND team_owner_id = v_team_owner_id
    FOR UPDATE;

    IF NOT FOUND OR v_budget.status <> 'ACTIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    IF NOT v_auction.allow_owner_self_purchase
       AND v_selection.candidate_type = 'OWNER'
       AND EXISTS (
           SELECT 1
           FROM team_owners original_owner
           WHERE original_owner.tournament_id = v_auction.tournament_id
             AND (
                 original_owner.owner_registration_id = v_lot.registration_id
                 OR original_owner.player_id = v_lot.player_id
             )
             AND original_owner.id = v_team_owner_id
       ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SELF_BIDDING_NOT_ALLOWED';
    END IF;

    IF p_bid_amount < v_auction.base_bid THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_BELOW_BASE';
    END IF;

    IF v_lot.current_highest_bid IS NULL THEN
        v_expected_next_bid := v_auction.base_bid;
    ELSE
        IF p_bid_amount <= v_lot.current_highest_bid THEN
            RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_NOT_HIGHER_THAN_CURRENT';
        END IF;

        v_expected_next_bid := v_lot.current_highest_bid
            + CASE
                WHEN v_lot.current_highest_bid < v_auction.bid_threshold
                    THEN v_auction.low_increment
                ELSE v_auction.high_increment
              END;
    END IF;

    IF p_bid_amount <> v_expected_next_bid THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INVALID_BID_INCREMENT';
    END IF;

    v_players_remaining := v_auction.required_players_to_buy - v_budget.players_bought;
    IF v_players_remaining <= 0 OR v_budget.players_remaining <> v_players_remaining THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'TEAM_NOT_ELIGIBLE';
    END IF;

    IF p_bid_amount > v_budget.remaining_kitty THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'INSUFFICIENT_KITTY';
    END IF;

    v_reserve_required := (v_players_remaining - 1) * v_auction.minimum_reserve;
    v_dynamic_maximum := GREATEST(0, v_budget.remaining_kitty - v_reserve_required);
    v_effective_maximum := v_dynamic_maximum;

    IF v_auction.maximum_bid IS NOT NULL THEN
        v_effective_maximum := LEAST(v_effective_maximum, v_auction.maximum_bid);
    END IF;

    IF p_bid_amount > v_dynamic_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RESERVE_VIOLATION';
    END IF;

    IF p_bid_amount > v_effective_maximum THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'BID_ABOVE_MAX_AFFORDABLE';
    END IF;

    v_configuration := jsonb_build_object(
        'starting_kitty', v_auction.starting_kitty,
        'required_players_to_buy', v_auction.required_players_to_buy,
        'base_bid', v_auction.base_bid,
        'minimum_reserve', v_auction.minimum_reserve,
        'bid_threshold', v_auction.bid_threshold,
        'low_increment', v_auction.low_increment,
        'high_increment', v_auction.high_increment,
        'maximum_bid', v_auction.maximum_bid,
        'allow_owner_self_purchase', v_auction.allow_owner_self_purchase
    );

    v_previous_bid := v_lot.current_highest_bid;

    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = v_team_owner_id,
        updated_at = NOW()
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
            'bidder_user_id', p_bidder_user_id,
            'maximum_affordable_bid', v_effective_maximum,
            'dynamic_maximum_bid', v_dynamic_maximum,
            'reserve_required', v_reserve_required,
            'remaining_kitty_at_bid', v_budget.remaining_kitty,
            'players_bought_at_bid', v_budget.players_bought,
            'players_remaining_at_bid', v_players_remaining,
            'configuration', v_configuration
        ),
        p_bid_amount,
        v_previous_bid,
        p_bid_amount,
        p_bidder_user_id
    );

    RETURN v_lot;
END;
$$;

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
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'BIDDER_NOT_AUTHORIZED';
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

    UPDATE auction_lots
    SET status = 'UNSOLD',
        updated_at = NOW()
    WHERE id = p_lot_id
      AND auction_id = p_auction_id
      AND tournament_id = v_auction.tournament_id
      AND status = 'LIVE'
    RETURNING * INTO v_lot;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_LIVE';
    END IF;

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
            'last_bid', v_lot.current_highest_bid,
            'last_bidder_team_owner_id', v_lot.current_highest_team_owner_id
        ),
        p_actor_id
    );

    RETURN v_lot;
END;
$$;

CREATE OR REPLACE FUNCTION update_auction_configuration_with_self_bid(
    p_auction_id UUID,
    p_actor_id UUID,
    p_starting_kitty INTEGER,
    p_required_players_to_buy INTEGER,
    p_base_bid INTEGER,
    p_minimum_reserve INTEGER,
    p_bid_threshold INTEGER,
    p_low_increment INTEGER,
    p_high_increment INTEGER,
    p_maximum_bid INTEGER,
    p_allow_owner_self_purchase BOOLEAN
)
RETURNS auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_previous_self_bid BOOLEAN;
BEGIN
    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    v_previous_self_bid := v_auction.allow_owner_self_purchase;

    v_auction := update_auction_configuration(
        p_auction_id,
        p_actor_id,
        p_starting_kitty,
        p_required_players_to_buy,
        p_base_bid,
        p_minimum_reserve,
        p_bid_threshold,
        p_low_increment,
        p_high_increment,
        p_maximum_bid
    );

    IF p_allow_owner_self_purchase IS NOT NULL THEN
        UPDATE auctions
        SET allow_owner_self_purchase = p_allow_owner_self_purchase,
            updated_at = NOW()
        WHERE id = p_auction_id
        RETURNING * INTO v_auction;
    END IF;

    IF p_allow_owner_self_purchase IS NOT NULL
       AND v_previous_self_bid IS DISTINCT FROM p_allow_owner_self_purchase THEN
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
                'action', 'OWNER_SELF_PURCHASE_RULE_CHANGED',
                'previous', v_previous_self_bid,
                'updated', p_allow_owner_self_purchase
            ),
            p_actor_id
        );
    END IF;

    RETURN v_auction;
END;
$$;

REVOKE ALL ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_auction_configuration_with_self_bid(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_auction_configuration_with_self_bid(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';
