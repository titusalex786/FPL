-- ============================================================
-- Migration: 20261031000000_fix_auction_event_types_and_rpc.sql
-- Description: Fix auction event types in start_auction_lot_v1
--              and settle_auction_lot_v1 to use canonical
--              auction_event_type enum values ('ADMIN_ACTION'
--              and 'AUCTION_STATE_CHANGE') with action payload.
-- ============================================================

-- 1. start_auction_lot_v1
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
    v_registration_type TEXT;
    v_now TIMESTAMPTZ;
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

    IF EXISTS (
        SELECT 1
        FROM auction_lots active_lot
        WHERE active_lot.auction_id = p_auction_id
          AND active_lot.status = 'LIVE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ACTIVE_LOT_EXISTS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auction_rounds round
        WHERE round.id = v_lot.round_id
          AND round.status NOT IN ('OPEN', 'LIVE')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'ROUND_NOT_OPEN';
    END IF;

    v_now := clock_timestamp();

    IF v_auction.status = 'OPEN' THEN
        UPDATE auctions
        SET status = 'LIVE',
            updated_at = v_now
        WHERE id = p_auction_id;
    END IF;

    UPDATE auction_rounds
    SET status = 'LIVE',
        started_at = COALESCE(started_at, v_now)
    WHERE id = v_lot.round_id
      AND auction_id = p_auction_id
      AND status = 'OPEN';

    UPDATE auction_lots
    SET status = 'LIVE',
        lot_started_at = v_now,
        last_bid_at = NULL,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
        current_highest_bid = NULL,
        current_highest_team_owner_id = NULL,
        updated_at = v_now
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
        jsonb_build_object(
            'action', 'LOT_STARTED',
            'lot_id', v_lot.id,
            'registration_id', v_lot.registration_id,
            'lot_number', v_lot.lot_number,
            'round_id', v_lot.round_id,
            'started_at', v_now,
            'bid_deadline_at', v_lot.bid_deadline_at
        ),
        p_actor_id
    );

    RETURN v_lot;
END;
$$;

-- 2. settle_auction_lot_v1
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
    v_retry_count INTEGER;
    v_lot_number_base INTEGER;
    v_next_round_id UUID;
    v_next_round_number INTEGER;
    v_skipped_unsold_count INTEGER;
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

    v_now := clock_timestamp();

    IF v_lot.bid_deadline_at IS NULL OR v_now < v_lot.bid_deadline_at THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'BID_DEADLINE_NOT_EXPIRED';
    END IF;

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

    IF v_lot.current_highest_bid IS NULL THEN
        IF v_lot.current_highest_team_owner_id IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_HIGHEST_BID_STATE';
        END IF;

        UPDATE auction_lots
        SET status = 'UNSOLD',
            settled_at = v_now,
            updated_at = v_now
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
            'PLAYER_UNSOLD',
            jsonb_build_object(
                'lot_id', v_lot.id,
                'registration_id', v_lot.registration_id,
                'round_id', v_lot.round_id,
                'round_number', v_round.round_number,
                'reason', 'BID_DEADLINE_EXPIRED_WITHOUT_BIDS',
                'settled_at', v_now,
                'bid_deadline_at', v_lot.bid_deadline_at
            ),
            p_actor_id
        );
    ELSE
        IF v_lot.current_highest_team_owner_id IS NULL
           OR v_lot.current_highest_bid < v_auction.base_bid THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_HIGHEST_BID_STATE';
        END IF;

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
           OR v_last_bid_event.team_owner_id <> v_lot.current_highest_team_owner_id
           OR (
               v_lot.last_bid_at IS NOT NULL
               AND (v_last_bid_event.event_payload ->> 'last_bid_at')::TIMESTAMPTZ
                   IS DISTINCT FROM v_lot.last_bid_at
           ) THEN
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

        IF NOT v_auction.allow_owner_self_purchase
           AND v_selection.candidate_type = 'OWNER'
           AND EXISTS (
               SELECT 1
               FROM team_owners original_owner
               WHERE original_owner.tournament_id = v_auction.tournament_id
                 AND original_owner.owner_registration_id = v_lot.registration_id
                 AND original_owner.id = v_lot.current_highest_team_owner_id
           ) THEN
            RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SELF_BIDDING_NOT_ALLOWED';
        END IF;

        v_previous_team_owner_id := v_registration.team_owner_id;

        UPDATE auction_team_budgets
        SET remaining_kitty = remaining_kitty - v_lot.current_highest_bid,
            players_bought = players_bought + 1,
            players_remaining = players_remaining - 1,
            updated_at = v_now
        WHERE id = v_budget.id;

        UPDATE registrations
        SET team_owner_id = v_lot.current_highest_team_owner_id
        WHERE id = v_registration.id
          AND tournament_id = v_auction.tournament_id;

        UPDATE auction_lots
        SET status = 'SOLD',
            winning_team_owner_id = v_lot.current_highest_team_owner_id,
            sold_amount = v_lot.current_highest_bid,
            sold_at = v_now,
            settled_at = v_now,
            updated_at = v_now
        WHERE id = p_lot_id
        RETURNING * INTO v_lot;

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
        VALUES
        (
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
    END IF;

    -- Handle unsold retry rounds transition when all lots in round are finished
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

        SELECT COUNT(*)::INTEGER
        INTO v_retry_count
        FROM auction_lots previous_lot
        JOIN auction_player_selections selection
          ON selection.auction_id = previous_lot.auction_id
         AND selection.registration_id = previous_lot.registration_id
         AND selection.player_id = previous_lot.player_id
        JOIN registrations registration
          ON registration.id = previous_lot.registration_id
         AND registration.tournament_id = previous_lot.tournament_id
         AND registration.player_id = previous_lot.player_id
        WHERE previous_lot.auction_id = p_auction_id
          AND previous_lot.round_id = v_round.id
          AND previous_lot.status = 'UNSOLD'
          AND selection.selection_status = 'SELECTED'
          AND selection.candidate_type <> 'ICON'
          AND registration.registration_status NOT IN ('REJECTED', 'CANCELLED')
          AND registration.registration_type <> 'ICON'
          AND NOT EXISTS (
              SELECT 1
              FROM team_owners owner_team
              WHERE owner_team.tournament_id = v_auction.tournament_id
                AND owner_team.icon_registration_id = previous_lot.registration_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM auction_purchases purchase
              WHERE purchase.auction_id = p_auction_id
                AND (
                    purchase.registration_id = previous_lot.registration_id
                    OR (purchase.registration_id IS NULL AND purchase.player_id = previous_lot.player_id)
                )
          );

        IF v_retry_count > 0 THEN
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
                retry.registration_id,
                retry.player_id,
                v_lot_number_base + ROW_NUMBER() OVER (
                    ORDER BY retry.original_lot_number, retry.registration_id
                )::INTEGER,
                'AVAILABLE',
                v_next_round_id
            FROM (
                SELECT
                    previous_lot.registration_id,
                    previous_lot.player_id,
                    previous_lot.lot_number AS original_lot_number
                FROM auction_lots previous_lot
                JOIN auction_player_selections selection
                  ON selection.auction_id = previous_lot.auction_id
                 AND selection.registration_id = previous_lot.registration_id
                 AND selection.player_id = previous_lot.player_id
                JOIN registrations registration
                  ON registration.id = previous_lot.registration_id
                 AND registration.tournament_id = previous_lot.tournament_id
                 AND registration.player_id = previous_lot.player_id
                WHERE previous_lot.auction_id = p_auction_id
                  AND previous_lot.round_id = v_round.id
                  AND previous_lot.status = 'UNSOLD'
                  AND selection.selection_status = 'SELECTED'
                  AND selection.candidate_type <> 'ICON'
                  AND registration.registration_status NOT IN ('REJECTED', 'CANCELLED')
                  AND registration.registration_type <> 'ICON'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM team_owners owner_team
                      WHERE owner_team.tournament_id = v_auction.tournament_id
                        AND owner_team.icon_registration_id = previous_lot.registration_id
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM auction_purchases purchase
                      WHERE purchase.auction_id = p_auction_id
                        AND (
                            purchase.registration_id = previous_lot.registration_id
                            OR (purchase.registration_id IS NULL AND purchase.player_id = previous_lot.player_id)
                        )
                  )
            ) retry;

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
                jsonb_build_object(
                    'action', 'UNSOLD_ROUND_CREATED',
                    'round_id', v_next_round_id,
                    'round_number', v_next_round_number,
                    'round_type', 'UNSOLD_RETRY',
                    'retry_lots_created', v_retry_count
                ),
                p_actor_id
            );
        END IF;
    END IF;

    RETURN v_lot;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) TO service_role;
