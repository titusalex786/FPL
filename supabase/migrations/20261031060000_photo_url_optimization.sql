-- ============================================================
-- Migration: 20261031060000_photo_url_optimization.sql
-- Description: Optimize get_auction_live_state_v1 to return cached
--              HTTP image URLs (/api/registrations/{id}/photo)
--              instead of 2MB raw inlined base64 data.
--              Reduces live-state JSON payload from 2.5MB to <1KB!
-- ============================================================

CREATE OR REPLACE FUNCTION get_auction_live_state_v1(p_auction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_tournament tournaments;
    v_live_lot_row RECORD;
    v_current_round auction_rounds;
    v_recently_sold JSONB;
    v_live_lot JSONB := NULL;
    v_stats JSONB;
BEGIN
    SELECT * INTO v_auction FROM auctions WHERE id = p_auction_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT * INTO v_tournament FROM tournaments WHERE id = v_auction.tournament_id;

    -- Current active round
    SELECT * INTO v_current_round
    FROM auction_rounds
    WHERE auction_id = p_auction_id AND status IN ('LIVE', 'OPEN')
    ORDER BY round_number DESC
    LIMIT 1;

    -- Live lot with player and leading team
    SELECT
        l.id,
        l.lot_number,
        l.status,
        l.current_highest_bid,
        l.sold_amount,
        l.sold_at,
        l.bid_deadline_at,
        l.paused_remaining_seconds,
        r.round_number,
        r.round_type,
        to_cur.team_name AS current_team_name,
        to_win.team_name AS winning_team_name,
        COALESCE(reg.registered_name_snapshot, p.full_name, 'Player') AS player_name,
        CASE
            WHEN reg.id IS NOT NULL THEN '/api/registrations/' || reg.id::text || '/photo'
            WHEN p.profile_image_url IS NOT NULL THEN p.profile_image_url
            ELSE NULL
        END AS player_image,
        COALESCE(reg.registered_role_snapshot, p.cricket_role) AS player_role,
        COALESCE(reg.registered_batting_style_snapshot, p.batting_style) AS batting_style,
        reg.registered_bowling_style_snapshot AS bowling_style
    INTO v_live_lot_row
    FROM auction_lots l
    LEFT JOIN auction_rounds r ON r.id = l.round_id
    LEFT JOIN team_owners to_cur ON to_cur.id = l.current_highest_team_owner_id
    LEFT JOIN team_owners to_win ON to_win.id = l.winning_team_owner_id
    LEFT JOIN registrations reg ON reg.id = l.registration_id
    LEFT JOIN players p ON p.id = l.player_id
    WHERE l.auction_id = p_auction_id AND l.status = 'LIVE'
    LIMIT 1;

    IF v_live_lot_row.id IS NOT NULL THEN
        v_live_lot := jsonb_build_object(
            'id', v_live_lot_row.id,
            'lotNumber', v_live_lot_row.lot_number,
            'status', v_live_lot_row.status,
            'roundNumber', v_live_lot_row.round_number,
            'roundType', v_live_lot_row.round_type,
            'currentBid', v_live_lot_row.current_highest_bid,
            'soldAmount', v_live_lot_row.sold_amount,
            'soldAt', v_live_lot_row.sold_at,
            'bidDeadlineAt', v_live_lot_row.bid_deadline_at,
            'pausedRemainingSeconds', v_live_lot_row.paused_remaining_seconds,
            'currentTeamName', v_live_lot_row.current_team_name,
            'currentTeamLogo', NULL,
            'winningTeamName', v_live_lot_row.winning_team_name,
            'winningTeamLogo', NULL,
            'player', jsonb_build_object(
                'name', v_live_lot_row.player_name,
                'image', v_live_lot_row.player_image,
                'role', v_live_lot_row.player_role,
                'battingStyle', v_live_lot_row.batting_style,
                'bowlingStyle', v_live_lot_row.bowling_style
            )
        );
    END IF;

    -- Recently sold lots (top 3)
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', s.id,
            'lotNumber', s.lot_number,
            'status', s.status,
            'roundNumber', s.round_number,
            'roundType', s.round_type,
            'currentBid', NULL,
            'soldAmount', s.sold_amount,
            'soldAt', s.sold_at,
            'bidDeadlineAt', NULL,
            'pausedRemainingSeconds', NULL,
            'currentTeamName', NULL,
            'currentTeamLogo', NULL,
            'winningTeamName', s.winning_team_name,
            'winningTeamLogo', NULL,
            'player', jsonb_build_object(
                'name', s.player_name,
                'image', s.player_image,
                'role', s.player_role,
                'battingStyle', s.batting_style,
                'bowlingStyle', s.bowling_style
            )
        )
    ), '[]'::jsonb)
    INTO v_recently_sold
    FROM (
        SELECT
            l.id,
            l.lot_number,
            l.status,
            l.sold_amount,
            l.sold_at,
            r.round_number,
            r.round_type,
            to_win.team_name AS winning_team_name,
            COALESCE(reg.registered_name_snapshot, p.full_name, 'Player') AS player_name,
            CASE
                WHEN reg.id IS NOT NULL THEN '/api/registrations/' || reg.id::text || '/photo'
                WHEN p.profile_image_url IS NOT NULL THEN p.profile_image_url
                ELSE NULL
            END AS player_image,
            COALESCE(reg.registered_role_snapshot, p.cricket_role) AS player_role,
            COALESCE(reg.registered_batting_style_snapshot, p.batting_style) AS batting_style,
            reg.registered_bowling_style_snapshot AS bowling_style
        FROM auction_lots l
        LEFT JOIN auction_rounds r ON r.id = l.round_id
        LEFT JOIN team_owners to_win ON to_win.id = l.winning_team_owner_id
        LEFT JOIN registrations reg ON reg.id = l.registration_id
        LEFT JOIN players p ON p.id = l.player_id
        WHERE l.auction_id = p_auction_id AND l.status = 'SOLD'
        ORDER BY l.sold_at DESC
        LIMIT 3
    ) s;

    -- Stats
    SELECT jsonb_build_object(
        'totalLots', COUNT(*),
        'sold', COUNT(*) FILTER (WHERE status = 'SOLD'),
        'unsold', COUNT(*) FILTER (WHERE status = 'UNSOLD'),
        'available', COUNT(*) FILTER (WHERE status = 'AVAILABLE')
    )
    INTO v_stats
    FROM auction_lots
    WHERE auction_id = p_auction_id;

    RETURN jsonb_build_object(
        'auction', jsonb_build_object(
            'id', v_auction.id,
            'name', COALESCE(v_auction.auction_name, v_tournament.name, 'FPL Auction'),
            'tournamentName', COALESCE(v_tournament.name, ''),
            'status', v_auction.status,
            'baseBid', v_auction.base_bid,
            'bidTimerSeconds', v_auction.bid_timer_seconds,
            'currentRoundNumber', v_current_round.round_number,
            'currentRoundType', v_current_round.round_type
        ),
        'liveLot', v_live_lot,
        'nextLot', NULL,
        'recentlySold', v_recently_sold,
        'stats', v_stats
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_auction_live_state_v1(UUID) TO anon, authenticated, service_role;
