-- Admin-controlled auction selection and tournament-specific auction rules.

ALTER TABLE auctions
    ADD COLUMN bid_threshold INTEGER NOT NULL DEFAULT 20000,
    ADD COLUMN maximum_bid INTEGER,
    ADD CONSTRAINT chk_auction_bid_threshold CHECK (bid_threshold >= base_bid),
    ADD CONSTRAINT chk_auction_maximum_bid CHECK (maximum_bid IS NULL OR maximum_bid >= base_bid);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'auction_player_selection_status'
    ) THEN
        CREATE TYPE auction_player_selection_status AS ENUM ('SELECTED', 'LOCKED', 'EXCLUDED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'auction_candidate_type'
    ) THEN
        CREATE TYPE auction_candidate_type AS ENUM ('OWNER', 'ICON', 'PLAYER');
    END IF;
END $$;

CREATE TABLE auction_player_selections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    registration_id UUID NOT NULL,
    player_id UUID NOT NULL,
    candidate_type auction_candidate_type NOT NULL,
    selection_status auction_player_selection_status NOT NULL,
    reason TEXT,
    selected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    selected_at TIMESTAMPTZ,
    locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    locked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_auction_selection_player UNIQUE (auction_id, player_id),
    CONSTRAINT unique_auction_selection_registration UNIQUE (auction_id, registration_id),
    CONSTRAINT auction_selections_auction_tournament_fkey
        FOREIGN KEY (auction_id, tournament_id)
        REFERENCES auctions (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT auction_selections_registration_player_fkey
        FOREIGN KEY (registration_id, tournament_id, player_id)
        REFERENCES registrations (id, tournament_id, player_id) ON DELETE RESTRICT
);

CREATE INDEX idx_auction_player_selections_status
    ON auction_player_selections(auction_id, selection_status, candidate_type);

ALTER TABLE auction_player_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auction selections visible to admins and managers"
ON auction_player_selections
FOR SELECT
USING (is_admin(auth.uid()) OR is_manager(auth.uid()));

CREATE POLICY "Auction selections insert server-side only"
ON auction_player_selections
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction selections update server-side only"
ON auction_player_selections
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction selections delete server-side only"
ON auction_player_selections
FOR DELETE USING (false);

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
            WHEN candidates.candidate_type = 'ICON' THEN NOW()
            ELSE NULL
        END
    FROM (
        SELECT DISTINCT ON (r.player_id)
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
                      AND (
                          owner_team.owner_registration_id = r.id
                          OR owner_team.player_id = r.player_id
                      )
                ) THEN 'OWNER'::auction_candidate_type
                ELSE 'PLAYER'::auction_candidate_type
            END AS candidate_type,
            r.registered_at
        FROM registrations r
        WHERE r.tournament_id = v_tournament_id
          AND r.registration_status IN ('CONFIRMED', 'PENDING')
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
                AND purchase.player_id = r.player_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_lots existing_lot
              WHERE existing_lot.auction_id = p_auction_id
                AND existing_lot.player_id = r.player_id
          )
        ORDER BY r.player_id,
            CASE
                WHEN r.registration_type = 'ICON' OR EXISTS (
                    SELECT 1 FROM team_owners owner_team
                    WHERE owner_team.tournament_id = r.tournament_id
                      AND owner_team.icon_registration_id = r.id
                ) THEN 0
                WHEN r.registration_type = 'OWNER' OR EXISTS (
                    SELECT 1 FROM team_owners owner_team
                    WHERE owner_team.tournament_id = r.tournament_id
                      AND (
                          owner_team.owner_registration_id = r.id
                          OR owner_team.player_id = r.player_id
                      )
                ) THEN 1
                ELSE 2
            END,
            r.registered_at NULLS LAST,
            r.id
    ) candidates
    ON CONFLICT (auction_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION set_auction_player_selection(
    p_auction_id UUID,
    p_registration_id UUID,
    p_selection_status auction_player_selection_status,
    p_reason TEXT,
    p_actor_id UUID
)
RETURNS auction_player_selections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_selection auction_player_selections;
    v_auction_status auction_status;
    v_previous_status auction_player_selection_status;
    v_tournament_id UUID;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION 'Manager or admin access required'
            USING ERRCODE = '42501';
    END IF;

    PERFORM sync_auction_player_candidates(p_auction_id, p_actor_id);

    SELECT status INTO v_auction_status
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF v_auction_status NOT IN ('DRAFT', 'OPEN') THEN
        RAISE EXCEPTION 'Auction selection is locked after auction start'
            USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_selection
    FROM auction_player_selections
    WHERE auction_id = p_auction_id
      AND registration_id = p_registration_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Eligible auction candidate not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_selection.candidate_type = 'ICON' AND p_selection_status <> 'LOCKED' THEN
        RAISE EXCEPTION 'Icon players remain locked as pre-allocated players'
            USING ERRCODE = '55000';
    END IF;

    v_previous_status := v_selection.selection_status;
    v_tournament_id := v_selection.tournament_id;

    UPDATE auction_player_selections
    SET selection_status = p_selection_status,
        reason = NULLIF(BTRIM(p_reason), ''),
        selected_by = CASE WHEN p_selection_status = 'SELECTED' THEN p_actor_id ELSE NULL END,
        selected_at = CASE WHEN p_selection_status = 'SELECTED' THEN NOW() ELSE NULL END,
        locked_by = CASE WHEN p_selection_status = 'LOCKED' THEN p_actor_id ELSE NULL END,
        locked_at = CASE WHEN p_selection_status = 'LOCKED' THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE auction_id = p_auction_id
      AND registration_id = p_registration_id
    RETURNING * INTO v_selection;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Eligible auction candidate not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_selection_status <> 'SELECTED' THEN
        DELETE FROM auction_lots
        WHERE auction_id = p_auction_id
          AND registration_id = p_registration_id
          AND status = 'AVAILABLE';
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
        v_tournament_id,
        v_selection.player_id,
        'ADMIN_ACTION',
        jsonb_build_object(
            'action', 'PLAYER_SELECTION_CHANGED',
            'registration_id', p_registration_id,
            'previous_status', v_previous_status,
            'selection_status', p_selection_status,
            'reason', NULLIF(BTRIM(p_reason), '')
        ),
        p_actor_id
    );

    RETURN v_selection;
END;
$$;

CREATE OR REPLACE FUNCTION update_auction_configuration(
    p_auction_id UUID,
    p_actor_id UUID,
    p_starting_kitty INTEGER,
    p_required_players_to_buy INTEGER,
    p_base_bid INTEGER,
    p_minimum_reserve INTEGER,
    p_bid_threshold INTEGER,
    p_low_increment INTEGER,
    p_high_increment INTEGER,
    p_maximum_bid INTEGER DEFAULT NULL
)
RETURNS auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_previous_configuration JSONB;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION 'Manager or admin access required'
            USING ERRCODE = '42501';
    END IF;

    IF p_starting_kitty <= 0
       OR p_required_players_to_buy <= 0
       OR p_base_bid < 5000
       OR p_minimum_reserve < p_base_bid
       OR p_starting_kitty < p_required_players_to_buy * p_minimum_reserve
       OR p_bid_threshold < p_base_bid
       OR p_low_increment <= 0
       OR p_high_increment <= 0
       OR (p_maximum_bid IS NOT NULL AND p_maximum_bid < p_base_bid) THEN
        RAISE EXCEPTION 'Invalid auction configuration'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_auction.status NOT IN ('DRAFT', 'OPEN') THEN
        RAISE EXCEPTION 'Auction configuration is locked after auction start'
            USING ERRCODE = '55000';
    END IF;

    IF EXISTS (SELECT 1 FROM auction_team_budgets WHERE auction_id = p_auction_id)
       OR EXISTS (SELECT 1 FROM auction_purchases WHERE auction_id = p_auction_id)
       OR EXISTS (
           SELECT 1 FROM auction_lots
           WHERE auction_id = p_auction_id AND status <> 'AVAILABLE'
       ) THEN
        RAISE EXCEPTION 'Configuration cannot change after budgets or auction activity exist'
            USING ERRCODE = '55000';
    END IF;

    v_previous_configuration := jsonb_build_object(
        'starting_kitty', v_auction.starting_kitty,
        'required_players_to_buy', v_auction.required_players_to_buy,
        'base_bid', v_auction.base_bid,
        'minimum_reserve', v_auction.minimum_reserve,
        'bid_threshold', v_auction.bid_threshold,
        'low_increment', v_auction.low_increment,
        'high_increment', v_auction.high_increment,
        'maximum_bid', v_auction.maximum_bid
    );

    UPDATE auctions
    SET starting_kitty = p_starting_kitty,
        required_players_to_buy = p_required_players_to_buy,
        base_bid = p_base_bid,
        minimum_reserve = p_minimum_reserve,
        bid_threshold = p_bid_threshold,
        low_increment = p_low_increment,
        high_increment = p_high_increment,
        maximum_bid = p_maximum_bid,
        updated_at = NOW()
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
            'action', 'AUCTION_CONFIGURATION_CHANGED',
            'previous', v_previous_configuration,
            'updated', jsonb_build_object(
                'starting_kitty', p_starting_kitty,
                'required_players_to_buy', p_required_players_to_buy,
                'base_bid', p_base_bid,
                'minimum_reserve', p_minimum_reserve,
                'bid_threshold', p_bid_threshold,
                'low_increment', p_low_increment,
                'high_increment', p_high_increment,
                'maximum_bid', p_maximum_bid
            )
        ),
        p_actor_id
    );

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

    PERFORM sync_auction_player_candidates(p_auction_id, p_actor_id);

    DELETE FROM auction_lots lot
    WHERE lot.auction_id = p_auction_id
      AND lot.status = 'AVAILABLE'
      AND NOT EXISTS (
          SELECT 1
          FROM auction_player_selections selection
          JOIN registrations registration
            ON registration.id = selection.registration_id
           AND registration.tournament_id = selection.tournament_id
           AND registration.player_id = selection.player_id
          WHERE selection.auction_id = lot.auction_id
            AND selection.player_id = lot.player_id
            AND selection.selection_status = 'SELECTED'
            AND registration.registration_status IN ('CONFIRMED', 'PENDING')
            AND NOT EXISTS (
                SELECT 1 FROM auction_purchases purchase
                WHERE purchase.auction_id = lot.auction_id
                  AND purchase.player_id = lot.player_id
            )
      );

    INSERT INTO auction_lots (
        auction_id,
        tournament_id,
        registration_id,
        player_id,
        lot_number,
        status
    )
    SELECT
        p_auction_id,
        v_tournament_id,
        eligible.registration_id,
        eligible.player_id,
        current_lots.max_lot_number + ROW_NUMBER() OVER (
            ORDER BY eligible.registered_at NULLS LAST, eligible.registration_id
        )::INTEGER,
        'AVAILABLE'
    FROM (
        SELECT
            selection.registration_id,
            selection.player_id,
            registration.registered_at
        FROM auction_player_selections selection
        JOIN registrations registration
          ON registration.id = selection.registration_id
         AND registration.tournament_id = selection.tournament_id
         AND registration.player_id = selection.player_id
        WHERE selection.auction_id = p_auction_id
          AND selection.selection_status = 'SELECTED'
          AND registration.registration_status IN ('CONFIRMED', 'PENDING')
          AND NOT EXISTS (
              SELECT 1 FROM auction_purchases purchase
              WHERE purchase.auction_id = p_auction_id
                AND purchase.player_id = selection.player_id
          )
          AND NOT EXISTS (
              SELECT 1 FROM auction_lots existing_lot
              WHERE existing_lot.auction_id = p_auction_id
                AND existing_lot.player_id = selection.player_id
          )
    ) eligible
    CROSS JOIN (
        SELECT COALESCE(MAX(lot_number), 0)::INTEGER AS max_lot_number
        FROM auction_lots
        WHERE auction_id = p_auction_id
    ) current_lots
    ORDER BY eligible.registered_at NULLS LAST, eligible.registration_id;

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

REVOKE ALL ON FUNCTION sync_auction_player_candidates(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION set_auction_player_selection(UUID, UUID, auction_player_selection_status, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION update_auction_configuration(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION populate_auction_player_pool(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_auction_player_candidates(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION set_auction_player_selection(UUID, UUID, auction_player_selection_status, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_auction_configuration(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION populate_auction_player_pool(UUID, UUID) TO service_role;
