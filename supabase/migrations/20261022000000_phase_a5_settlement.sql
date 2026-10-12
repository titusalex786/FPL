-- Phase A5: server-authoritative bid deadlines, atomic settlement, and unsold rounds.

ALTER TABLE auctions
    ADD COLUMN bid_timer_seconds INTEGER NOT NULL DEFAULT 30
        CHECK (bid_timer_seconds BETWEEN 1 AND 3600);

ALTER TABLE auction_lots
    ADD COLUMN round_id UUID,
    ADD COLUMN lot_started_at TIMESTAMPTZ,
    ADD COLUMN last_bid_at TIMESTAMPTZ,
    ADD COLUMN bid_deadline_at TIMESTAMPTZ,
    ADD COLUMN settled_at TIMESTAMPTZ;

CREATE TABLE auction_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    round_number INTEGER NOT NULL CHECK (round_number > 0),
    round_type TEXT NOT NULL CHECK (round_type IN ('INITIAL', 'UNSOLD_RETRY')),
    status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'LIVE', 'COMPLETED', 'CANCELLED')),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT auction_rounds_auction_tournament_fkey
        FOREIGN KEY (auction_id, tournament_id)
        REFERENCES auctions (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT unique_auction_round_number UNIQUE (auction_id, round_number),
    CONSTRAINT unique_auction_round_id UNIQUE (id, auction_id)
);

INSERT INTO auction_rounds (
    auction_id,
    tournament_id,
    round_number,
    round_type,
    status,
    started_at,
    completed_at
)
SELECT
    auction.id,
    auction.tournament_id,
    1,
    'INITIAL',
    CASE
        WHEN auction.status = 'LIVE' THEN 'LIVE'
        WHEN auction.status IN ('CLOSED', 'FINALIZED') THEN 'COMPLETED'
        ELSE 'OPEN'
    END,
    CASE WHEN auction.status = 'LIVE' THEN clock_timestamp() END,
    CASE WHEN auction.status IN ('CLOSED', 'FINALIZED') THEN clock_timestamp() END
FROM auctions auction;

CREATE OR REPLACE FUNCTION create_initial_auction_round()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO auction_rounds (
        auction_id,
        tournament_id,
        round_number,
        round_type,
        status
    )
    VALUES (
        NEW.id,
        NEW.tournament_id,
        1,
        'INITIAL',
        'OPEN'
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER auctions_create_initial_round
AFTER INSERT ON auctions
FOR EACH ROW EXECUTE FUNCTION create_initial_auction_round();

UPDATE auction_lots lot
SET round_id = round.id
FROM auction_rounds round
WHERE round.auction_id = lot.auction_id
  AND round.round_number = 1;

UPDATE auction_lots lot
SET lot_started_at = clock_timestamp(),
    bid_deadline_at = clock_timestamp()
        + make_interval(secs => auction.bid_timer_seconds)
FROM auctions auction
WHERE auction.id = lot.auction_id
  AND lot.status = 'LIVE'
  AND lot.bid_deadline_at IS NULL;

ALTER TABLE auction_lots
    ALTER COLUMN round_id SET NOT NULL,
    ADD CONSTRAINT auction_lots_round_auction_fkey
        FOREIGN KEY (round_id, auction_id)
        REFERENCES auction_rounds (id, auction_id) ON DELETE CASCADE,
    DROP CONSTRAINT unique_auction_lot_per_player,
    ADD CONSTRAINT unique_auction_lot_per_round_player
        UNIQUE (auction_id, round_id, player_id);

CREATE INDEX idx_auction_lots_bid_deadline
    ON auction_lots(auction_id, bid_deadline_at)
    WHERE status = 'LIVE';
CREATE INDEX idx_auction_rounds_status
    ON auction_rounds(auction_id, status, round_number);

ALTER TABLE auction_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auction rounds visible to authorized participants"
ON auction_rounds
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM team_owners owner_team
        JOIN players owner_player ON owner_player.id = owner_team.player_id
        WHERE owner_team.tournament_id = auction_rounds.tournament_id
          AND owner_player.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Auction rounds insert server-side only"
ON auction_rounds
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction rounds update server-side only"
ON auction_rounds
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction rounds delete server-side only"
ON auction_rounds
FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION reject_auction_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER auction_purchases_are_immutable
BEFORE UPDATE OR DELETE ON auction_purchases
FOR EACH ROW EXECUTE FUNCTION reject_auction_history_mutation();

CREATE TRIGGER auction_events_are_immutable
BEFORE UPDATE OR DELETE ON auction_events
FOR EACH ROW EXECUTE FUNCTION reject_auction_history_mutation();

CREATE OR REPLACE FUNCTION update_auction_configuration_with_timer(
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
    p_allow_owner_self_purchase BOOLEAN,
    p_bid_timer_seconds INTEGER DEFAULT NULL
)
RETURNS auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
BEGIN
    IF p_bid_timer_seconds IS NOT NULL
       AND p_bid_timer_seconds NOT BETWEEN 1 AND 3600 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_BID_TIMER';
    END IF;

    v_auction := update_auction_configuration_with_self_bid(
        p_auction_id,
        p_actor_id,
        p_starting_kitty,
        p_required_players_to_buy,
        p_base_bid,
        p_minimum_reserve,
        p_bid_threshold,
        p_low_increment,
        p_high_increment,
        p_maximum_bid,
        p_allow_owner_self_purchase
    );

    IF p_bid_timer_seconds IS NOT NULL THEN
        UPDATE auctions
        SET bid_timer_seconds = p_bid_timer_seconds,
            updated_at = clock_timestamp()
        WHERE id = p_auction_id
        RETURNING * INTO v_auction;

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
                'action', 'BID_TIMER_CONFIGURATION_CHANGED',
                'bid_timer_seconds', p_bid_timer_seconds
            ),
            p_actor_id
        );
    END IF;

    RETURN v_auction;
END;
$$;

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
        eligible.registration_id,
        eligible.player_id,
        current_lots.max_lot_number + ROW_NUMBER() OVER (
            ORDER BY eligible.registered_at NULLS LAST, eligible.registration_id
        )::INTEGER,
        'AVAILABLE',
        v_initial_round_id
    FROM (
        SELECT r.id AS registration_id, r.player_id, r.registered_at
        FROM registrations r
        WHERE r.tournament_id = v_tournament_id
          AND r.registration_status IN ('CONFIRMED', 'PENDING')
          AND r.registration_type = 'PLAYER'
          AND NOT EXISTS (
              SELECT 1
              FROM team_owners owner_team
              WHERE owner_team.tournament_id = r.tournament_id
                AND (
                    owner_team.player_id = r.player_id
                    OR owner_team.owner_registration_id = r.id
                    OR owner_team.icon_registration_id = r.id
                )
          )
          AND NOT EXISTS (
              SELECT 1
              FROM auction_purchases purchase
              WHERE purchase.auction_id = p_auction_id
                AND purchase.player_id = r.player_id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM auction_lots existing_lot
              WHERE existing_lot.auction_id = p_auction_id
                AND existing_lot.player_id = r.player_id
          )
    ) eligible
    CROSS JOIN (
        SELECT COALESCE(MAX(lot_number), 0)::INTEGER AS max_lot_number
        FROM auction_lots
        WHERE auction_id = p_auction_id
    ) current_lots
    ORDER BY eligible.registered_at NULLS LAST, eligible.registration_id
    ON CONFLICT (auction_id, round_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

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
       OR v_registration_status NOT IN ('CONFIRMED', 'PENDING')
       OR v_registration_type = 'ICON'
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

    UPDATE auction_rounds
    SET status = 'LIVE',
        started_at = COALESCE(started_at, v_now)
    WHERE id = v_lot.round_id
      AND status = 'OPEN';

    UPDATE auction_lots
    SET status = 'LIVE',
        current_highest_bid = NULL,
        current_highest_team_owner_id = NULL,
        lot_started_at = v_now,
        last_bid_at = NULL,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
        settled_at = NULL,
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
            'round_id', v_lot.round_id,
            'bid_timer_seconds', v_auction.bid_timer_seconds,
            'lot_started_at', v_lot.lot_started_at,
            'bid_deadline_at', v_lot.bid_deadline_at
        ),
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
       OR v_registration_status NOT IN ('CONFIRMED', 'PENDING')
       OR v_registration_type = 'ICON'
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
        'allow_owner_self_purchase', v_auction.allow_owner_self_purchase,
        'bid_timer_seconds', v_auction.bid_timer_seconds
    );

    v_previous_bid := v_lot.current_highest_bid;

    UPDATE auction_lots
    SET current_highest_bid = p_bid_amount,
        current_highest_team_owner_id = v_team_owner_id,
        last_bid_at = v_now,
        bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds),
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
            'round_id', v_lot.round_id,
            'bidder_user_id', p_bidder_user_id,
            'maximum_affordable_bid', v_effective_maximum,
            'dynamic_maximum_bid', v_dynamic_maximum,
            'reserve_required', v_reserve_required,
            'remaining_kitty_at_bid', v_budget.remaining_kitty,
            'players_bought_at_bid', v_budget.players_bought,
            'players_remaining_at_bid', v_players_remaining,
            'bid_timer_seconds', v_auction.bid_timer_seconds,
            'last_bid_at', v_lot.last_bid_at,
            'bid_deadline_at', v_lot.bid_deadline_at,
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
       OR v_registration.registration_status NOT IN ('CONFIRMED', 'PENDING')
       OR v_registration.registration_type = 'ICON' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PLAYER_NOT_AVAILABLE';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auction_purchases purchase
        WHERE purchase.auction_id = p_auction_id
          AND purchase.player_id = v_lot.player_id
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
                 AND (
                     original_owner.owner_registration_id = v_lot.registration_id
                     OR original_owner.player_id = v_lot.player_id
                 )
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
          AND tournament_id = v_auction.tournament_id
          AND player_id = v_lot.player_id;

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
            player_id,
            winning_bid,
            player_role,
            purchase_status
        )
        VALUES (
            p_auction_id,
            v_auction.tournament_id,
            v_lot.winning_team_owner_id,
            v_lot.player_id,
            v_lot.sold_amount,
            v_registration.registered_role_snapshot,
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
                'round_id', v_lot.round_id,
                'round_number', v_round.round_number,
                'team_owner_id', v_lot.winning_team_owner_id,
                'winning_bid', v_lot.sold_amount,
                'sold_at', v_lot.sold_at,
                'purchase_status', 'COMPLETED'
            ),
            v_lot.sold_amount,
            NULL,
            v_lot.sold_amount,
            p_actor_id
        ),
        (
            p_auction_id,
            v_auction.tournament_id,
            v_lot.winning_team_owner_id,
            v_lot.player_id,
            'KITTY_DEDUCTION',
            jsonb_build_object(
                'lot_id', v_lot.id,
                'round_id', v_lot.round_id,
                'winning_bid', v_lot.sold_amount,
                'players_bought_before', v_budget.players_bought,
                'players_bought_after', v_budget.players_bought + 1,
                'players_remaining_before', v_budget.players_remaining,
                'players_remaining_after', v_budget.players_remaining - 1,
                'minimum_reserve', v_auction.minimum_reserve
            ),
            v_lot.sold_amount,
            v_budget.remaining_kitty,
            v_budget.remaining_kitty - v_lot.sold_amount,
            p_actor_id
        ),
        (
            p_auction_id,
            v_auction.tournament_id,
            v_lot.winning_team_owner_id,
            v_lot.player_id,
            'PLAYER_ASSIGNED',
            jsonb_build_object(
                'lot_id', v_lot.id,
                'registration_id', v_registration.id,
                'previous_team_owner_id', v_previous_team_owner_id,
                'team_owner_id', v_lot.winning_team_owner_id,
                'assigned_at', v_now
            ),
            NULL,
            NULL,
            NULL,
            p_actor_id
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM auction_lots round_lot
        WHERE round_lot.auction_id = p_auction_id
          AND round_lot.round_id = v_round.id
          AND round_lot.status IN ('AVAILABLE', 'LIVE')
    ) THEN
        UPDATE auction_rounds
        SET status = 'COMPLETED',
            completed_at = v_now
        WHERE id = v_round.id;

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
          AND registration.registration_status IN ('CONFIRMED', 'PENDING')
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
                AND purchase.player_id = previous_lot.player_id
          );

        SELECT COUNT(*)::INTEGER
        INTO v_skipped_unsold_count
        FROM auction_lots previous_lot
        WHERE previous_lot.auction_id = p_auction_id
          AND previous_lot.round_id = v_round.id
          AND previous_lot.status = 'UNSOLD'
          AND NOT EXISTS (
              SELECT 1
              FROM auction_player_selections selection
              JOIN registrations registration
                ON registration.id = selection.registration_id
               AND registration.tournament_id = selection.tournament_id
               AND registration.player_id = selection.player_id
              WHERE selection.auction_id = p_auction_id
                AND selection.registration_id = previous_lot.registration_id
                AND selection.player_id = previous_lot.player_id
                AND selection.selection_status = 'SELECTED'
                AND selection.candidate_type <> 'ICON'
                AND registration.registration_status IN ('CONFIRMED', 'PENDING')
                AND registration.registration_type <> 'ICON'
                AND NOT EXISTS (
                    SELECT 1
                    FROM auction_purchases purchase
                    WHERE purchase.auction_id = p_auction_id
                      AND purchase.player_id = previous_lot.player_id
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
                  AND registration.registration_status IN ('CONFIRMED', 'PENDING')
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
                        AND purchase.player_id = previous_lot.player_id
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
                    'previous_round_id', v_round.id,
                    'previous_round_number', v_round.round_number,
                    'round_id', v_next_round_id,
                    'round_number', v_next_round_number,
                    'round_type', 'UNSOLD_RETRY',
                    'players_carried_forward', v_retry_count,
                    'unsold_players_not_requeued', v_skipped_unsold_count,
                    'created_at', v_now
                ),
                p_actor_id
            );
        ELSE
            UPDATE auctions
            SET status = 'CLOSED',
                updated_at = v_now
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
                jsonb_build_object(
                    'previous_status', v_auction.status,
                    'status', 'CLOSED',
                    'reason', 'ALL_ELIGIBLE_ROUNDS_SETTLED',
                    'unsold_players_not_requeued', v_skipped_unsold_count,
                    'closed_at', v_now
                ),
                p_actor_id
            );
        END IF;
    END IF;

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
BEGIN
    RETURN settle_auction_lot_v1(p_auction_id, p_lot_id, p_actor_id);
END;
$$;

CREATE OR REPLACE FUNCTION end_auction_v1(
    p_auction_id UUID,
    p_actor_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_now TIMESTAMPTZ;
    v_invalid_lot_count INTEGER;
    v_previous_status auction_status;
    v_lot RECORD;
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

    IF v_auction.status IN ('CLOSED', 'FINALIZED') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_ALREADY_CLOSED';
    END IF;

    v_previous_status := v_auction.status;

    SELECT COUNT(*)::INTEGER
    INTO v_invalid_lot_count
    FROM auction_lots lot
    LEFT JOIN auction_player_selections selection
      ON selection.auction_id = lot.auction_id
     AND selection.registration_id = lot.registration_id
     AND selection.player_id = lot.player_id
    LEFT JOIN registrations registration
      ON registration.id = lot.registration_id
     AND registration.tournament_id = lot.tournament_id
     AND registration.player_id = lot.player_id
    WHERE lot.auction_id = p_auction_id
      AND lot.status IN ('AVAILABLE', 'LIVE')
      AND (
          selection.id IS NULL
          OR selection.selection_status <> 'SELECTED'
          OR selection.candidate_type = 'ICON'
          OR registration.id IS NULL
          OR registration.registration_status NOT IN ('CONFIRMED', 'PENDING')
          OR registration.registration_type = 'ICON'
          OR EXISTS (
              SELECT 1
              FROM team_owners owner_team
              WHERE owner_team.tournament_id = v_auction.tournament_id
                AND owner_team.icon_registration_id = lot.registration_id
          )
      );

    IF v_invalid_lot_count > 0 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'INVALID_AUCTION_LOT';
    END IF;

    v_now := clock_timestamp();

    FOR v_lot IN
        SELECT id, round_id, player_id, current_highest_bid, current_highest_team_owner_id
        FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status IN ('AVAILABLE', 'LIVE')
        ORDER BY lot_number
        FOR UPDATE
    LOOP
        UPDATE auction_lots
        SET status = 'UNSOLD',
            settled_at = v_now,
            updated_at = v_now
        WHERE id = v_lot.id;

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
                'round_id', v_lot.round_id,
                'reason', 'ADMIN_ENDED_AUCTION',
                'last_bid', v_lot.current_highest_bid,
                'last_bidder_team_owner_id', v_lot.current_highest_team_owner_id,
                'settled_at', v_now
            ),
            p_actor_id
        );
    END LOOP;

    UPDATE auction_rounds
    SET status = 'CANCELLED',
        completed_at = v_now
    WHERE auction_id = p_auction_id
      AND status IN ('OPEN', 'LIVE');

    UPDATE auctions
    SET status = 'CLOSED',
        updated_at = v_now
    WHERE id = p_auction_id
    RETURNING * INTO v_auction;

    INSERT INTO auction_events (
        auction_id,
        tournament_id,
        event_type,
        event_payload,
        created_by
    )
    VALUES
    (
        p_auction_id,
        v_auction.tournament_id,
        'AUCTION_STATE_CHANGE',
        jsonb_build_object(
            'previous_status', v_previous_status,
            'status', 'CLOSED',
            'reason', NULLIF(BTRIM(p_reason), ''),
            'ended_at', v_now
        ),
        p_actor_id
    ),
    (
        p_auction_id,
        v_auction.tournament_id,
        'ADMIN_ACTION',
        jsonb_build_object(
            'action', 'AUCTION_MANUALLY_ENDED',
            'admin_id', p_actor_id,
            'reason', NULLIF(BTRIM(p_reason), ''),
            'ended_at', v_now
        ),
        p_actor_id
    );

    RETURN v_auction;
END;
$$;

REVOKE ALL ON FUNCTION reject_auction_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_initial_auction_round() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_auction_configuration_with_timer(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION populate_auction_player_pool(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION end_auction_v1(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION update_auction_configuration_with_timer(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION populate_auction_player_pool(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION start_auction_lot_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION settle_auction_lot_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION end_auction_lot_unsold_v1(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION end_auction_v1(UUID, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
