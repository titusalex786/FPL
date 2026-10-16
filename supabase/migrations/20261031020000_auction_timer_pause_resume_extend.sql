-- ============================================================
-- Migration: 20261031020000_auction_timer_pause_resume_extend.sql
-- Description: Add paused_remaining_seconds to auction_lots.
--              Update pause_auction_v1 to preserve remaining time.
--              Update resume_auction_v1 to continue from remaining time.
--              Add extend_auction_lot_timer_v1 to add seconds (e.g. 60s)
--              to active lot deadline.
-- ============================================================

-- 1. Schema addition
ALTER TABLE auction_lots
ADD COLUMN IF NOT EXISTS paused_remaining_seconds INTEGER;

-- 2. Update pause_auction_v1
CREATE OR REPLACE FUNCTION pause_auction_v1(
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
    v_lot auction_lots;
    v_rem INTEGER;
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

    IF v_auction.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_LIVE';
    END IF;

    v_now := clock_timestamp();

    UPDATE auctions
    SET status = 'PAUSED',
        updated_at = v_now
    WHERE id = p_auction_id
    RETURNING * INTO v_auction;

    -- Freeze remaining time on any active lot
    FOR v_lot IN
        SELECT * FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status = 'LIVE'
        FOR UPDATE
    LOOP
        IF v_lot.bid_deadline_at IS NOT NULL AND v_lot.bid_deadline_at > v_now THEN
            v_rem := GREATEST(1, EXTRACT(EPOCH FROM (v_lot.bid_deadline_at - v_now))::INTEGER);
        ELSE
            v_rem := 0;
        END IF;

        UPDATE auction_lots
        SET paused_remaining_seconds = v_rem,
            updated_at = v_now
        WHERE id = v_lot.id;
    END LOOP;

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
            'action', 'AUCTION_PAUSED',
            'reason', p_reason,
            'paused_at', v_now,
            'paused_by', p_actor_id
        ),
        p_actor_id
    );

    RETURN v_auction;
END;
$$;

-- 3. Update resume_auction_v1
CREATE OR REPLACE FUNCTION resume_auction_v1(
    p_auction_id UUID,
    p_actor_id UUID
)
RETURNS auctions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_auction auctions;
    v_now TIMESTAMPTZ;
    v_lot auction_lots;
    v_rem INTEGER;
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

    IF v_auction.status <> 'PAUSED' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_PAUSED';
    END IF;

    v_now := clock_timestamp();

    UPDATE auctions
    SET status = 'LIVE',
        updated_at = v_now
    WHERE id = p_auction_id
    RETURNING * INTO v_auction;

    -- Resume active lot with exact preserved remaining time
    FOR v_lot IN
        SELECT * FROM auction_lots
        WHERE auction_id = p_auction_id
          AND status = 'LIVE'
        FOR UPDATE
    LOOP
        IF v_lot.paused_remaining_seconds IS NOT NULL AND v_lot.paused_remaining_seconds > 0 THEN
            v_rem := v_lot.paused_remaining_seconds;
        ELSE
            v_rem := COALESCE(v_auction.bid_timer_seconds, 30);
        END IF;

        UPDATE auction_lots
        SET bid_deadline_at = v_now + make_interval(secs => v_rem::DOUBLE PRECISION),
            paused_remaining_seconds = NULL,
            updated_at = v_now
        WHERE id = v_lot.id;
    END LOOP;

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
            'action', 'AUCTION_RESUMED',
            'resumed_at', v_now,
            'resumed_by', p_actor_id
        ),
        p_actor_id
    );

    RETURN v_auction;
END;
$$;

-- 4. Extend active lot timer RPC: extend_auction_lot_timer_v1
CREATE OR REPLACE FUNCTION extend_auction_lot_timer_v1(
    p_auction_id UUID,
    p_lot_id UUID,
    p_seconds INTEGER,
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
    v_now TIMESTAMPTZ;
    v_new_deadline TIMESTAMPTZ;
BEGIN
    IF p_actor_id IS NULL OR NOT is_manager(p_actor_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ADMIN_UNAUTHORIZED';
    END IF;

    IF p_seconds IS NULL OR p_seconds <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SECONDS';
    END IF;

    SELECT * INTO v_auction
    FROM auctions
    WHERE id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'AUCTION_NOT_FOUND';
    END IF;

    IF v_auction.status NOT IN ('LIVE', 'PAUSED') THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUCTION_NOT_ACTIVE';
    END IF;

    SELECT * INTO v_lot
    FROM auction_lots
    WHERE id = p_lot_id
      AND auction_id = p_auction_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'LOT_NOT_FOUND';
    END IF;

    IF v_lot.status <> 'LIVE' THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LOT_NOT_LIVE';
    END IF;

    v_now := clock_timestamp();

    IF v_auction.status = 'PAUSED' THEN
        -- If paused, increment paused_remaining_seconds
        v_lot.paused_remaining_seconds := COALESCE(v_lot.paused_remaining_seconds, 0) + p_seconds;
        UPDATE auction_lots
        SET paused_remaining_seconds = v_lot.paused_remaining_seconds,
            updated_at = v_now
        WHERE id = p_lot_id
        RETURNING * INTO v_lot;
    ELSE
        -- If live, add p_seconds to bid_deadline_at (or from now if expired)
        IF v_lot.bid_deadline_at IS NOT NULL AND v_lot.bid_deadline_at > v_now THEN
            v_new_deadline := v_lot.bid_deadline_at + make_interval(secs => p_seconds::DOUBLE PRECISION);
        ELSE
            v_new_deadline := v_now + make_interval(secs => p_seconds::DOUBLE PRECISION);
        END IF;

        UPDATE auction_lots
        SET bid_deadline_at = v_new_deadline,
            updated_at = v_now
        WHERE id = p_lot_id
        RETURNING * INTO v_lot;
    END IF;

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
            'action', 'TIMER_EXTENDED',
            'lot_id', p_lot_id,
            'seconds_added', p_seconds,
            'bid_deadline_at', v_lot.bid_deadline_at,
            'paused_remaining_seconds', v_lot.paused_remaining_seconds,
            'extended_by', p_actor_id,
            'extended_at', v_now
        ),
        p_actor_id
    );

    RETURN v_lot;
END;
$$;

-- 5. Permissions
REVOKE ALL ON FUNCTION pause_auction_v1(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pause_auction_v1(UUID, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION resume_auction_v1(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION resume_auction_v1(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION extend_auction_lot_timer_v1(UUID, UUID, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION extend_auction_lot_timer_v1(UUID, UUID, INTEGER, UUID) TO service_role;
