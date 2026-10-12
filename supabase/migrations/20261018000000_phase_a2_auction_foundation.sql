-- Supabase Migration: 20261018000000_phase_a2_auction_foundation.sql
-- Phase A2: Auction database foundation
-- Scope: additive schema only; no production data mutation, no UI, no live bidding logic

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_status') THEN
        CREATE TYPE auction_status AS ENUM ('DRAFT', 'OPEN', 'LIVE', 'CLOSED', 'FINALIZED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_lot_status') THEN
        CREATE TYPE auction_lot_status AS ENUM ('AVAILABLE', 'LIVE', 'SOLD', 'UNSOLD', 'CANCELLED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_purchase_status') THEN
        CREATE TYPE auction_purchase_status AS ENUM ('PENDING', 'COMPLETED', 'REVERSED');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'auction_event_type') THEN
        CREATE TYPE auction_event_type AS ENUM (
            'BID_PLACED',
            'PLAYER_SOLD',
            'PLAYER_UNSOLD',
            'PLAYER_ASSIGNED',
            'KITTY_DEDUCTION',
            'AUCTION_STATE_CHANGE',
            'ADMIN_ACTION'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    status auction_status NOT NULL DEFAULT 'DRAFT',
    starting_kitty INTEGER NOT NULL DEFAULT 180000 CHECK (starting_kitty >= 0),
    required_players_to_buy INTEGER NOT NULL DEFAULT 9 CHECK (required_players_to_buy >= 0),
    icon_players_allocated INTEGER NOT NULL DEFAULT 1 CHECK (icon_players_allocated >= 0),
    base_bid INTEGER NOT NULL DEFAULT 5000 CHECK (base_bid > 0),
    low_increment INTEGER NOT NULL DEFAULT 1000 CHECK (low_increment > 0),
    high_increment INTEGER NOT NULL DEFAULT 2000 CHECK (high_increment > 0),
    minimum_reserve INTEGER NOT NULL DEFAULT 5000 CHECK (minimum_reserve > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_auction_per_tournament UNIQUE (tournament_id),
    CONSTRAINT unique_auction_id_tournament UNIQUE (id, tournament_id),
    CONSTRAINT unique_auction_id_tournament_config UNIQUE (
        id,
        tournament_id,
        starting_kitty,
        required_players_to_buy,
        icon_players_allocated
    )
);

CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);

ALTER TABLE team_owners
    ADD CONSTRAINT auction_team_owners_id_tournament_key UNIQUE (id, tournament_id);

ALTER TABLE registrations
    ADD CONSTRAINT auction_registrations_identity_key UNIQUE (id, tournament_id, player_id);

CREATE TABLE IF NOT EXISTS auction_team_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    team_owner_id UUID NOT NULL,
    starting_kitty INTEGER NOT NULL DEFAULT 180000 CHECK (starting_kitty >= 0),
    remaining_kitty INTEGER NOT NULL DEFAULT 180000 CHECK (remaining_kitty >= 0),
    required_players_to_buy INTEGER NOT NULL DEFAULT 9 CHECK (required_players_to_buy > 0),
    players_bought INTEGER NOT NULL DEFAULT 0 CHECK (players_bought >= 0),
    players_remaining INTEGER NOT NULL DEFAULT 9 CHECK (players_remaining >= 0),
    icon_players_allocated INTEGER NOT NULL DEFAULT 1 CHECK (icon_players_allocated >= 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LOCKED', 'ELIMINATED', 'FINALIZED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_auction_budget_per_team UNIQUE (auction_id, team_owner_id),
    CONSTRAINT auction_team_budgets_auction_config_fkey
        FOREIGN KEY (
            auction_id,
            tournament_id,
            starting_kitty,
            required_players_to_buy,
            icon_players_allocated
        )
        REFERENCES auctions (
            id,
            tournament_id,
            starting_kitty,
            required_players_to_buy,
            icon_players_allocated
        ) ON DELETE CASCADE,
    CONSTRAINT auction_team_budgets_team_owner_tournament_fkey
        FOREIGN KEY (team_owner_id, tournament_id)
        REFERENCES team_owners (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT chk_team_budget_remaining_leq_starting CHECK (remaining_kitty <= starting_kitty),
    CONSTRAINT chk_team_budget_players_consistent
        CHECK (players_bought + players_remaining = required_players_to_buy)
);

CREATE INDEX IF NOT EXISTS idx_auction_team_budgets_owner_tournament
    ON auction_team_budgets(team_owner_id, tournament_id);
CREATE INDEX IF NOT EXISTS idx_auction_team_budgets_status ON auction_team_budgets(status);

CREATE TABLE IF NOT EXISTS auction_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    registration_id UUID NOT NULL,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    lot_number INTEGER NOT NULL CHECK (lot_number > 0),
    status auction_lot_status NOT NULL DEFAULT 'AVAILABLE',
    current_highest_bid INTEGER CHECK (current_highest_bid IS NULL OR current_highest_bid >= 5000),
    current_highest_team_owner_id UUID,
    winning_team_owner_id UUID,
    sold_amount INTEGER CHECK (sold_amount IS NULL OR sold_amount >= 5000),
    sold_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_auction_lot_per_player UNIQUE (auction_id, player_id),
    CONSTRAINT auction_lots_auction_tournament_fkey
        FOREIGN KEY (auction_id, tournament_id)
        REFERENCES auctions (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT auction_lots_tournament_registration_player_fkey
        FOREIGN KEY (registration_id, tournament_id, player_id)
        REFERENCES registrations (id, tournament_id, player_id) ON DELETE RESTRICT,
    CONSTRAINT auction_lots_current_highest_owner_budget_fkey
        FOREIGN KEY (auction_id, current_highest_team_owner_id)
        REFERENCES auction_team_budgets (auction_id, team_owner_id),
    CONSTRAINT auction_lots_winning_owner_budget_fkey
        FOREIGN KEY (auction_id, winning_team_owner_id)
        REFERENCES auction_team_budgets (auction_id, team_owner_id),
    CONSTRAINT unique_auction_lot_sale
        UNIQUE (auction_id, player_id, winning_team_owner_id, sold_amount),
    CONSTRAINT chk_lot_sold_value CHECK (
        (status = 'SOLD'
            AND sold_amount IS NOT NULL
            AND winning_team_owner_id IS NOT NULL
            AND sold_at IS NOT NULL)
        OR (status <> 'SOLD'
            AND sold_amount IS NULL
            AND winning_team_owner_id IS NULL
            AND sold_at IS NULL)
    ),
    CONSTRAINT chk_lot_winning_bid CHECK (
        (current_highest_team_owner_id IS NULL AND current_highest_bid IS NULL)
        OR (current_highest_team_owner_id IS NOT NULL AND current_highest_bid IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_auction_lots_auction_status ON auction_lots(auction_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_lots_player ON auction_lots(player_id);
CREATE INDEX IF NOT EXISTS idx_auction_lots_tournament ON auction_lots(tournament_id);

CREATE TABLE IF NOT EXISTS auction_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    team_owner_id UUID NOT NULL,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
    winning_bid INTEGER NOT NULL CHECK (winning_bid >= 5000),
    player_role TEXT,
    purchase_status auction_purchase_status NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_player_purchase_per_auction UNIQUE (auction_id, player_id),
    CONSTRAINT auction_purchases_auction_tournament_fkey
        FOREIGN KEY (auction_id, tournament_id)
        REFERENCES auctions (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT auction_purchases_auction_team_budget_fkey
        FOREIGN KEY (auction_id, team_owner_id)
        REFERENCES auction_team_budgets (auction_id, team_owner_id),
    CONSTRAINT auction_purchases_sold_lot_fkey
        FOREIGN KEY (auction_id, player_id, team_owner_id, winning_bid)
        REFERENCES auction_lots (auction_id, player_id, winning_team_owner_id, sold_amount)
);

CREATE INDEX IF NOT EXISTS idx_auction_purchases_auction_team ON auction_purchases(auction_id, team_owner_id);
CREATE INDEX IF NOT EXISTS idx_auction_purchases_player ON auction_purchases(player_id);
CREATE INDEX IF NOT EXISTS idx_auction_purchases_tournament ON auction_purchases(tournament_id);

CREATE TABLE IF NOT EXISTS auction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    tournament_id UUID NOT NULL,
    team_owner_id UUID,
    player_id UUID REFERENCES players(id) ON DELETE SET NULL,
    event_type auction_event_type NOT NULL,
    event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    amount INTEGER,
    previous_value INTEGER,
    new_value INTEGER,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT auction_events_auction_tournament_fkey
        FOREIGN KEY (auction_id, tournament_id)
        REFERENCES auctions (id, tournament_id) ON DELETE CASCADE,
    CONSTRAINT auction_events_auction_team_budget_fkey
        FOREIGN KEY (auction_id, team_owner_id)
        REFERENCES auction_team_budgets (auction_id, team_owner_id)
);

CREATE INDEX IF NOT EXISTS idx_auction_events_auction_created_at ON auction_events(auction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auction_events_team_owner ON auction_events(team_owner_id);
CREATE INDEX IF NOT EXISTS idx_auction_events_player ON auction_events(player_id);

ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_team_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auction read access for admin, manager, or linked owners"
ON auctions
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM team_owners to_own
        JOIN players p ON p.id = to_own.player_id
        WHERE to_own.tournament_id = auctions.tournament_id
          AND p.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Auction write access is server-side only"
ON auctions
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction update access is server-side only"
ON auctions
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction delete access is server-side only"
ON auctions
FOR DELETE USING (false);

CREATE POLICY "Auction budget read access for admin, manager, or owner"
ON auction_team_budgets
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM team_owners to_own
        JOIN players p ON p.id = to_own.player_id
        WHERE to_own.id = auction_team_budgets.team_owner_id
          AND to_own.tournament_id = auction_team_budgets.tournament_id
          AND p.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Auction budgets are not client-writable"
ON auction_team_budgets
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction budgets are not client-updateable"
ON auction_team_budgets
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction budgets are not client-deletable"
ON auction_team_budgets
FOR DELETE USING (false);

CREATE POLICY "Auction lots visibility for authorized users"
ON auction_lots
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM team_owners to_own
        JOIN players p ON p.id = to_own.player_id
        WHERE to_own.tournament_id = auction_lots.tournament_id
          AND p.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Auction lots insert server-side only"
ON auction_lots
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction lots update server-side only"
ON auction_lots
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction lots delete server-side only"
ON auction_lots
FOR DELETE USING (false);

CREATE POLICY "Auction purchases visibility for admin, owner, or manager"
ON auction_purchases
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR EXISTS (
        SELECT 1
        FROM team_owners to_own
        JOIN players p ON p.id = to_own.player_id
        WHERE to_own.id = auction_purchases.team_owner_id
          AND p.auth_user_id = auth.uid()
    )
);

CREATE POLICY "Auction purchases insert immutable"
ON auction_purchases
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction purchases update immutable"
ON auction_purchases
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction purchases delete immutable"
ON auction_purchases
FOR DELETE USING (false);

CREATE POLICY "Auction events visibility for admin, owner, or manager"
ON auction_events
FOR SELECT
USING (
    is_admin(auth.uid())
    OR is_manager(auth.uid())
    OR (
        team_owner_id IS NOT NULL AND EXISTS (
            SELECT 1
            FROM team_owners to_own
            JOIN players p ON p.id = to_own.player_id
            WHERE to_own.id = auction_events.team_owner_id
              AND p.auth_user_id = auth.uid()
        )
    )
);

CREATE POLICY "Auction events insert server-side only"
ON auction_events
FOR INSERT WITH CHECK (false);

CREATE POLICY "Auction events update server-side only"
ON auction_events
FOR UPDATE USING (false) WITH CHECK (false);

CREATE POLICY "Auction events delete server-side only"
ON auction_events
FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
