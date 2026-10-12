-- Phase A3: Authoritative, idempotent auction player pool population.

ALTER TABLE auction_lots
    ADD CONSTRAINT unique_auction_lot_number UNIQUE (auction_id, lot_number);

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
    v_inserted_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION 'Manager or admin access required'
            USING ERRCODE = '42501';
    END IF;

    SELECT tournament_id
    INTO v_tournament_id
    FROM auctions
    WHERE id = p_auction_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Auction not found'
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(p_auction_id::TEXT, 0));

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
            r.id AS registration_id,
            r.player_id,
            r.registered_at
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
    ON CONFLICT (auction_id, player_id) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
    RETURN v_inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION populate_auction_player_pool(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION populate_auction_player_pool(UUID, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION populate_auction_player_pool(UUID, UUID) TO service_role;
