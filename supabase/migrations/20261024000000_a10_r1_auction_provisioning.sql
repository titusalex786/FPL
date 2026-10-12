ALTER TABLE auctions
    ADD COLUMN IF NOT EXISTS auction_name TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'auctions_name_length_check'
          AND conrelid = 'public.auctions'::regclass
    ) THEN
        ALTER TABLE auctions
            ADD CONSTRAINT auctions_name_length_check
            CHECK (
                auction_name IS NULL
                OR length(btrim(auction_name)) BETWEEN 2 AND 100
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION provision_auction_v1(
    p_tournament_id UUID,
    p_auction_name TEXT,
    p_starting_kitty INTEGER,
    p_required_players_to_buy INTEGER,
    p_base_bid INTEGER,
    p_bid_threshold INTEGER,
    p_low_increment INTEGER,
    p_high_increment INTEGER,
    p_minimum_reserve INTEGER,
    p_bid_timer_seconds INTEGER,
    p_maximum_bid INTEGER,
    p_allow_owner_self_purchase BOOLEAN,
    p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tournament tournaments;
    v_auction auctions;
    v_team_count INTEGER;
    v_budget_count INTEGER;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUCTION_PROVISIONING_UNAUTHORIZED';
    END IF;

    IF p_tournament_id IS NULL
       OR p_auction_name IS NULL
       OR length(btrim(p_auction_name)) NOT BETWEEN 2 AND 100
       OR p_starting_kitty IS NULL
       OR p_starting_kitty <= 0
       OR p_required_players_to_buy IS NULL
       OR p_required_players_to_buy <= 0
       OR p_base_bid IS NULL
       OR p_base_bid < 5000
       OR p_minimum_reserve IS NULL
       OR p_minimum_reserve < p_base_bid
       OR p_starting_kitty < p_required_players_to_buy::BIGINT * p_minimum_reserve
       OR p_bid_threshold IS NULL
       OR p_bid_threshold < p_base_bid
       OR p_low_increment IS NULL
       OR p_low_increment <= 0
       OR p_high_increment IS NULL
       OR p_high_increment <= 0
       OR (p_maximum_bid IS NOT NULL AND p_maximum_bid < p_base_bid)
       OR p_bid_timer_seconds IS NULL
       OR p_bid_timer_seconds NOT BETWEEN 1 AND 3600
       OR p_allow_owner_self_purchase IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_AUCTION_PROVISIONING_INPUT';
    END IF;

    SELECT *
    INTO v_tournament
    FROM tournaments
    WHERE id = p_tournament_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_TOURNAMENT_NOT_FOUND';
    END IF;

    IF v_tournament.tournament_type IS DISTINCT FROM 'OWNER_BASED' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AUCTION_REQUIRES_OWNER_BASED_TOURNAMENT';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM auctions
        WHERE tournament_id = p_tournament_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'AUCTION_ALREADY_EXISTS';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_team_count
    FROM team_owners owner_team
    JOIN registrations owner_registration
      ON owner_registration.id = owner_team.owner_registration_id
     AND owner_registration.tournament_id = owner_team.tournament_id
     AND owner_registration.registration_type = 'OWNER'
     AND owner_registration.registration_status = 'CONFIRMED'
    JOIN registrations icon_registration
      ON icon_registration.id = owner_team.icon_registration_id
     AND icon_registration.tournament_id = owner_team.tournament_id
     AND icon_registration.registration_type = 'ICON'
     AND icon_registration.registration_status = 'CONFIRMED'
    WHERE owner_team.tournament_id = p_tournament_id
      AND owner_team.status IN ('APPROVED', 'CONFIRMED')
      AND owner_team.player_id IS NOT NULL;

    IF v_team_count = 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUCTION_NO_ELIGIBLE_TEAMS';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM registrations player_registration
        WHERE player_registration.tournament_id = p_tournament_id
          AND player_registration.registration_type = 'PLAYER'
          AND player_registration.registration_status = 'CONFIRMED'
          AND NOT EXISTS (
              SELECT 1
              FROM team_owners owner_team
              WHERE owner_team.tournament_id = p_tournament_id
                AND (
                    owner_team.player_id = player_registration.player_id
                    OR owner_team.owner_registration_id = player_registration.id
                    OR owner_team.icon_registration_id = player_registration.id
                )
          )
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUCTION_NO_CONFIRMED_PLAYERS';
    END IF;

    INSERT INTO auctions (
        tournament_id,
        auction_name,
        status,
        starting_kitty,
        required_players_to_buy,
        icon_players_allocated,
        base_bid,
        bid_threshold,
        low_increment,
        high_increment,
        minimum_reserve,
        maximum_bid,
        allow_owner_self_purchase,
        bid_timer_seconds
    )
    VALUES (
        p_tournament_id,
        btrim(p_auction_name),
        'DRAFT',
        p_starting_kitty,
        p_required_players_to_buy,
        1,
        p_base_bid,
        p_bid_threshold,
        p_low_increment,
        p_high_increment,
        p_minimum_reserve,
        p_maximum_bid,
        p_allow_owner_self_purchase,
        p_bid_timer_seconds
    )
    RETURNING * INTO v_auction;

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
        owner_team.id,
        v_auction.starting_kitty,
        v_auction.starting_kitty,
        v_auction.required_players_to_buy,
        0,
        v_auction.required_players_to_buy,
        v_auction.icon_players_allocated,
        'ACTIVE'
    FROM team_owners owner_team
    JOIN registrations owner_registration
      ON owner_registration.id = owner_team.owner_registration_id
     AND owner_registration.tournament_id = owner_team.tournament_id
     AND owner_registration.registration_type = 'OWNER'
     AND owner_registration.registration_status = 'CONFIRMED'
    JOIN registrations icon_registration
      ON icon_registration.id = owner_team.icon_registration_id
     AND icon_registration.tournament_id = owner_team.tournament_id
     AND icon_registration.registration_type = 'ICON'
     AND icon_registration.registration_status = 'CONFIRMED'
    WHERE owner_team.tournament_id = p_tournament_id
      AND owner_team.status IN ('APPROVED', 'CONFIRMED')
      AND owner_team.player_id IS NOT NULL;

    GET DIAGNOSTICS v_budget_count = ROW_COUNT;
    IF v_budget_count <> v_team_count THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AUCTION_BUDGET_INITIALIZATION_MISMATCH';
    END IF;

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
            'action', 'AUCTION_PROVISIONED',
            'auction_name', v_auction.auction_name,
            'teams_initialized', v_budget_count,
            'configuration', jsonb_build_object(
                'starting_kitty', v_auction.starting_kitty,
                'required_players_to_buy', v_auction.required_players_to_buy,
                'icon_players_allocated', v_auction.icon_players_allocated,
                'base_bid', v_auction.base_bid,
                'bid_threshold', v_auction.bid_threshold,
                'low_increment', v_auction.low_increment,
                'high_increment', v_auction.high_increment,
                'minimum_reserve', v_auction.minimum_reserve,
                'bid_timer_seconds', v_auction.bid_timer_seconds,
                'maximum_bid', v_auction.maximum_bid,
                'allow_owner_self_purchase', v_auction.allow_owner_self_purchase
            )
        ),
        p_actor_id
    );

    RETURN jsonb_build_object(
        'auction_id', v_auction.id,
        'auction_name', v_auction.auction_name,
        'tournament_id', v_auction.tournament_id,
        'status', v_auction.status,
        'teams_initialized', v_budget_count,
        'starting_kitty', v_auction.starting_kitty,
        'required_players_to_buy', v_auction.required_players_to_buy
    );
END;
$$;

REVOKE ALL ON FUNCTION provision_auction_v1(
    UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
    INTEGER, INTEGER, INTEGER, BOOLEAN, UUID
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION provision_auction_v1(
    UUID, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER,
    INTEGER, INTEGER, INTEGER, BOOLEAN, UUID
) TO service_role;

NOTIFY pgrst, 'reload schema';
