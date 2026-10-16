-- Migration: 20261030000000_auction_pool_registration_identity.sql
-- Purpose:
--   Support multiple registrations sharing the same player_id in auction selections,
--   auction lots, and auction purchases by treating registration_id as the primary
--   candidate identity.
--   1. Drop player_id-based unique constraints on selections, lots, and purchases.
--   2. Add registration_id-based unique constraints and foreign keys.
--   3. Add registration_id to auction_purchases.
--   4. Update sync_auction_player_candidates to populate all distinct registrations.
--   5. Update populate_auction_player_pool to create lots for all 90 eligible registrations (80 PLAYER + 10 OWNER).
--   6. Update start_auction_lot_v1, place_auction_bid_v1, place_admin_auction_bid_v1,
--      reveal_random_auction_lot_v1, and settle_auction_lot_v1 to respect registration_id.

-- ============================================================
-- 1. Schema & Constraint Updates
-- ============================================================

-- Drop player-based unique constraint on auction_player_selections
ALTER TABLE auction_player_selections
    DROP CONSTRAINT IF EXISTS unique_auction_selection_player;

-- Ensure registration-based unique constraint exists on auction_player_selections
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_auction_selection_registration'
    ) THEN
        ALTER TABLE auction_player_selections
            ADD CONSTRAINT unique_auction_selection_registration
            UNIQUE (auction_id, registration_id);
    END IF;
END $$;

-- Drop player-based unique constraints on auction_lots
ALTER TABLE auction_lots
    DROP CONSTRAINT IF EXISTS unique_auction_lot_per_player,
    DROP CONSTRAINT IF EXISTS unique_auction_lot_per_round_player;

-- Add registration-based unique constraint per round on auction_lots
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_auction_lot_per_round_registration'
    ) THEN
        ALTER TABLE auction_lots
            ADD CONSTRAINT unique_auction_lot_per_round_registration
            UNIQUE (auction_id, round_id, registration_id);
    END IF;
END $$;

-- Update auction_purchases and auction_lots sale constraints
ALTER TABLE auction_purchases
    ADD COLUMN IF NOT EXISTS registration_id UUID REFERENCES registrations(id);

ALTER TABLE auction_purchases
    DROP CONSTRAINT IF EXISTS unique_player_purchase_per_auction,
    DROP CONSTRAINT IF EXISTS auction_purchases_sold_lot_fkey;

ALTER TABLE auction_lots
    DROP CONSTRAINT IF EXISTS unique_auction_lot_sale CASCADE;

ALTER TABLE auction_lots
    ADD CONSTRAINT unique_auction_lot_sale
    UNIQUE (auction_id, registration_id, winning_team_owner_id, sold_amount);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'unique_registration_purchase_per_auction'
    ) THEN
        ALTER TABLE auction_purchases
            ADD CONSTRAINT unique_registration_purchase_per_auction
            UNIQUE (auction_id, registration_id);
    END IF;
END $$;

ALTER TABLE auction_purchases
    ADD CONSTRAINT auction_purchases_sold_lot_fkey
    FOREIGN KEY (auction_id, registration_id, team_owner_id, winning_bid)
    REFERENCES auction_lots (auction_id, registration_id, winning_team_owner_id, sold_amount);

CREATE INDEX IF NOT EXISTS idx_auction_purchases_registration
    ON auction_purchases(registration_id);
CREATE INDEX IF NOT EXISTS idx_auction_lots_registration
    ON auction_lots(registration_id);

-- ============================================================
-- 2. sync_auction_player_candidates
-- ============================================================
CREATE OR REPLACE FUNCTION sync_auction_player_candidates(
    p_auction_id UUID,
    p_actor_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_status auction_status;
    v_inserted_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION 'Manager or admin access required'
            USING ERRCODE = '42501';
    END IF;

    SELECT tournament_id, status
    INTO v_tournament_id, v_status
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_status NOT IN ('DRAFT', 'OPEN') THEN
        RAISE EXCEPTION 'Auction selection is locked after auction start'
            USING ERRCODE = '55000';
    END IF;

    INSERT INTO auction_player_selections (
        auction_id,
        tournament_id,
        registration_id,
        player_id,
        candidate_type,
        selection_status,
        reason,
        selected_by,
        selected_at,
        locked_by,
        locked_at
    )
    SELECT
        p_auction_id,
        v_tournament_id,
        candidates.registration_id,
        candidates.player_id,
        candidates.candidate_type,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN 'LOCKED'::auction_player_selection_status
            ELSE 'SELECTED'::auction_player_selection_status
        END,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN 'Icon is pre-allocated to its registered team'
            ELSE NULL
        END,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN NULL
            ELSE p_actor_id
        END,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN NULL
            ELSE NOW()
        END,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN p_actor_id
            ELSE NULL
        END,
        CASE
            WHEN candidates.candidate_type = 'ICON' THEN NOW()
            ELSE NULL
        END
    FROM (
        SELECT DISTINCT ON (r.id)
            r.id AS registration_id,
            r.player_id,
            CASE
                WHEN r.registration_type = 'ICON' OR EXISTS (
                    SELECT 1 FROM team_owners owner_team
                    WHERE owner_team.tournament_id = r.tournament_id
                      AND owner_team.icon_registration_id = r.id
                ) THEN 'ICON'::auction_candidate_type
                WHEN r.registration_type = 'OWNER' OR EXISTS (
                    SELECT 1 FROM team_owners owner_team
                    WHERE owner_team.tournament_id = r.tournament_id
                      AND owner_team.owner_registration_id = r.id
                ) THEN 'OWNER'::auction_candidate_type
                ELSE 'PLAYER'::auction_candidate_type
            END AS candidate_type,
            r.registered_at
        FROM registrations r
        WHERE r.tournament_id = v_tournament_id
          AND r.registration_status NOT IN ('REJECTED', 'CANCELLED')
          AND (
              r.registration_type IN ('PLAYER', 'OWNER', 'ICON')
              OR EXISTS (
                  SELECT 1
                  FROM team_owners owner_team
                  WHERE owner_team.tournament_id = r.tournament_id
                    AND (
                        owner_team.player_id = r.player_id
                        OR owner_team.owner_registration_id = r.id
                        OR owner_team.icon_registration_id = r.id
                    )
              )
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_purchases purchase
              WHERE purchase.auction_id = p_auction_id
                AND (
                    purchase.registration_id = r.id
                    OR (purchase.registration_id IS NULL AND purchase.player_id = r.player_id)
                )
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_lots existing_lot
              WHERE existing_lot.auction_id = p_auction_id
                AND existing_lot.registration_id = r.id
          )
        ORDER BY r.id, r.registered_at ASC NULLS LAST
    ) candidates
    ON CONFLICT (auction_id, registration_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

-- ============================================================
-- 3. populate_auction_player_pool
-- ============================================================
CREATE OR REPLACE FUNCTION populate_auction_player_pool(
    p_auction_id UUID,
    p_actor_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament_id UUID;
    v_status auction_status;
    v_initial_round_id UUID;
    v_inserted_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION 'Manager or admin access required'
            USING ERRCODE = '42501';
    END IF;

    SELECT tournament_id, status
    INTO v_tournament_id, v_status
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_status NOT IN ('DRAFT', 'OPEN') THEN
        RAISE EXCEPTION 'Auction pool is locked after auction start'
            USING ERRCODE = '55000';
    END IF;

    SELECT id
    INTO v_initial_round_id
    FROM auction_rounds
    WHERE auction_id = p_auction_id
      AND round_number = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Initial auction round is missing'
            USING ERRCODE = '55000';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_auction_id::TEXT, 0));

    -- Sync selections first so selections table stays consistent
    PERFORM sync_auction_player_candidates(p_auction_id, p_actor_id);

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
        v_tournament_id,
        sel.registration_id,
        sel.player_id,
        current_lots.max_lot_number + ROW_NUMBER() OVER (
            ORDER BY reg.registered_at NULLS LAST, sel.registration_id
        )::INTEGER,
        'AVAILABLE',
        v_initial_round_id
    FROM auction_player_selections sel
    JOIN registrations reg
      ON reg.id = sel.registration_id
     AND reg.tournament_id = sel.tournament_id
     AND reg.player_id = sel.player_id
    CROSS JOIN (
        SELECT COALESCE(MAX(lot_number), 0)::INTEGER AS max_lot_number
        FROM auction_lots
        WHERE auction_id = p_auction_id
    ) current_lots
    WHERE sel.auction_id = p_auction_id
      AND sel.selection_status = 'SELECTED'
      AND sel.candidate_type <> 'ICON'
      AND reg.registration_status NOT IN ('REJECTED', 'CANCELLED')
      AND reg.registration_type <> 'ICON'
      AND NOT EXISTS (
          SELECT 1
          FROM team_owners owner_team
          WHERE owner_team.tournament_id = sel.tournament_id
            AND owner_team.icon_registration_id = sel.registration_id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM auction_purchases purchase
          WHERE purchase.auction_id = p_auction_id
            AND (
                purchase.registration_id = sel.registration_id
                OR (purchase.registration_id IS NULL AND purchase.player_id = sel.player_id)
            )
      )
      AND NOT EXISTS (
          SELECT 1
          FROM auction_lots existing_lot
          WHERE existing_lot.auction_id = p_auction_id
            AND existing_lot.registration_id = sel.registration_id
      )
    ON CONFLICT (auction_id, round_id, registration_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count > 0 THEN
        INSERT INTO auction_events (
            auction_id,
            tournament_id,
            event_type,
            event_payload,
            created_by
        )
        VALUES (
            p_auction_id,
            v_tournament_id,
            'ADMIN_ACTION',
            jsonb_build_object(
                'action', 'AUCTION_PLAYER_POOL_POPULATED',
                'lots_added', v_inserted_count
            ),
            p_actor_id
        );
    END IF;

    RETURN v_inserted_count;
END;
$$;

-- ============================================================
-- 4. start_auction_lot_v1
-- ============================================================
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
        'LOT_STARTED',
        jsonb_build_object(
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

-- ============================================================
-- 5. place_admin_auction_bid_v1
-- ============================================================
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

    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = p_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    INSERT INTO auction_bids (
        auction_id,
        lot_id,
        team_owner_id,
        bid_amount,
        bidder_user_id
    )
    VALUES (
        p_auction_id,
        p_lot_id,
        p_team_owner_id,
        p_bid_amount,
        p_actor_id
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
            'bid_deadline_at', v_lot.bid_deadline_at,
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

-- ============================================================
-- 6. place_auction_bid_v1
-- ============================================================
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
    v_configuration JSONB;
    v_now TIMESTAMPTZ;
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

    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = v_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
        updated_at = v_now
    WHERE id = p_lot_id
    RETURNING * INTO v_lot;

    INSERT INTO auction_bids (
        auction_id,
        lot_id,
        team_owner_id,
        bid_amount,
        bidder_user_id
    )
    VALUES (
        p_auction_id,
        p_lot_id,
        v_team_owner_id,
        p_bid_amount,
        p_bidder_user_id
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

-- ============================================================
-- 7. reveal_random_auction_lot_v1
-- ============================================================
CREATE OR REPLACE FUNCTION reveal_random_auction_lot_v1(
    p_auction_id UUID,
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
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NOT_AUTHORIZED';
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

    IF EXISTS (
        SELECT 1
        FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status = 'LIVE'
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_ALREADY_LIVE';
    END IF;

    SELECT lot.* INTO v_lot
    FROM auction_lots lot
    JOIN auction_player_selections sel
      ON sel.auction_id = lot.auction_id
     AND sel.registration_id = lot.registration_id
     AND sel.player_id = lot.player_id
    JOIN registrations reg
      ON reg.id = lot.registration_id
     AND reg.tournament_id = lot.tournament_id
     AND reg.player_id = lot.player_id
    WHERE lot.auction_id = p_auction_id
      AND lot.status = 'AVAILABLE'
      AND sel.selection_status = 'SELECTED'
      AND sel.candidate_type <> 'ICON'
      AND reg.registration_status NOT IN ('REJECTED', 'CANCELLED')
      AND reg.registration_type <> 'ICON'
      AND NOT EXISTS (
          SELECT 1
          FROM team_owners ot
          WHERE ot.tournament_id = lot.tournament_id
            AND ot.icon_registration_id = lot.registration_id
      )
      AND NOT EXISTS (
          SELECT 1
          FROM auction_purchases ap
          WHERE ap.auction_id = p_auction_id
            AND (
                ap.registration_id = lot.registration_id
                OR (ap.registration_id IS NULL AND ap.player_id = lot.player_id)
            )
      )
    ORDER BY random()
    LIMIT 1
    FOR UPDATE OF lot;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'NO_AVAILABLE_LOTS';
    END IF;

    RETURN start_auction_lot_v1(p_auction_id, v_lot.id, p_actor_id);
END;
$$;

-- ============================================================
-- 8. settle_auction_lot_v1
-- ============================================================
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
                'ROUND_STARTED',
                jsonb_build_object(
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
REVOKE ALL ON FUNCTION sync_auction_player_candidates(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_auction_player_candidates(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION populate_auction_player_pool(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION populate_auction_player_pool(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION place_admin_auction_bid_v1(UUID, UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_admin_auction_bid_v1(UUID, UUID, UUID, INTEGER, UUID) TO service_role;

REVOKE ALL ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO service_role;

REVOKE ALL ON FUNCTION reveal_random_auction_lot_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reveal_random_auction_lot_v1(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
