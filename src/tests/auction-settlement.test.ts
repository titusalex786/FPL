import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as endAuction } from '@/app/api/admin/auctions/[auctionId]/end/route';
import { POST as manageLot } from '@/app/api/admin/auctions/[auctionId]/lots/[lotId]/route';
import { PATCH as updateConfiguration } from '@/app/api/admin/auctions/[auctionId]/configuration/route';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261022000000_phase_a5_settlement.sql'),
  'utf8'
);
const foundationMigration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261018000000_phase_a2_auction_foundation.sql'),
  'utf8'
);

const auctionId = '10000000-0000-4000-8000-000000000001';
const lotId = '30000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';
const auctionContext = { params: Promise.resolve({ auctionId }) };
const lotContext = { params: Promise.resolve({ auctionId, lotId }) };

describe('Phase A5 timer and settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireManager).mockResolvedValue({
      user: { id: actorId } as never,
      isAdmin: true,
      role: 'ADMIN' as never,
    });
  });

  it('stores a configurable per-auction timer with a 30-second default', () => {
    expect(migration).toMatch(/ADD COLUMN bid_timer_seconds INTEGER NOT NULL DEFAULT 30/);
    expect(migration).toMatch(/CHECK \(bid_timer_seconds BETWEEN 1 AND 3600\)/);
    expect(migration).toMatch(/bid_timer_seconds INTEGER DEFAULT NULL/);
  });

  it('starts lots with a PostgreSQL deadline derived from auction configuration', () => {
    const start = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION start_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1')
    );
    expect(start).toMatch(/v_now := clock_timestamp\(\)/);
    expect(start).toMatch(/lot_started_at = v_now/);
    expect(start).toMatch(/bid_deadline_at = v_now \+ make_interval\(secs => v_auction\.bid_timer_seconds\)/);
    expect(start).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(start).toMatch(/selection_status <> 'SELECTED'/);
  });

  it('resets the deadline on every accepted bid and rejects bids at or after it', () => {
    const bid = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1')
    );
    expect(bid).toMatch(/v_now := clock_timestamp\(\)/);
    expect(bid).toMatch(/v_now >= v_lot\.bid_deadline_at/);
    expect(bid).toMatch(/last_bid_at = v_now/);
    expect(bid).toMatch(/bid_deadline_at = v_now \+ make_interval\(secs => v_auction\.bid_timer_seconds\)/);
    expect(bid).toMatch(/'BID_DEADLINE_EXPIRED'/);
  });

  it('settles only after the server deadline and serializes auction, lot, and budget rows', () => {
    const settle = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    expect(settle).toMatch(/FROM auctions[\s\S]*?FOR UPDATE/);
    expect(settle).toMatch(/FROM auction_lots[\s\S]*?FOR UPDATE/);
    expect(settle).toMatch(/v_now := clock_timestamp\(\)/);
    expect(settle).toMatch(/v_now < v_lot\.bid_deadline_at/);
    expect(settle).toMatch(/FROM auction_team_budgets[\s\S]*?FOR UPDATE/);
    expect(settle).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(settle).toMatch(/selection_status <> 'SELECTED'/);
  });

  it('performs all SOLD financial and assignment changes inside the settlement transaction', () => {
    const settle = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    expect(settle).toMatch(/remaining_kitty = remaining_kitty - v_lot\.current_highest_bid/);
    expect(settle).toMatch(/players_bought = players_bought \+ 1/);
    expect(settle).toMatch(/players_remaining = players_remaining - 1/);
    expect(settle).toMatch(/INSERT INTO auction_purchases/);
    expect(settle).toMatch(/SET status = 'SOLD'/);
    expect(settle).toMatch(/SET team_owner_id = v_lot\.current_highest_team_owner_id/);
    expect(settle).toMatch(/'PLAYER_SOLD'/);
    expect(settle).toMatch(/'KITTY_DEDUCTION'/);
    expect(settle).toMatch(/'PLAYER_ASSIGNED'/);
    expect(settle).toMatch(/v_maximum_affordable := GREATEST\(0, v_budget\.remaining_kitty - v_reserve_required\)/);
  });

  it('marks no-bid expired lots UNSOLD without changing budget, purchase, or assignment', () => {
    const settle = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    const noBid = settle.slice(settle.indexOf('IF v_lot.current_highest_bid IS NULL'));
    const nextBranch = noBid.slice(0, noBid.indexOf('ELSE'));
    expect(nextBranch).toMatch(/SET status = 'UNSOLD'/);
    expect(nextBranch).toMatch(/'PLAYER_UNSOLD'/);
    expect(nextBranch).not.toMatch(/UPDATE auction_team_budgets/);
    expect(nextBranch).not.toMatch(/INSERT INTO auction_purchases/);
    expect(nextBranch).not.toMatch(/UPDATE registrations/);
  });

  it('protects duplicate settlements and historical purchase/event rows', () => {
    const settle = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    expect(settle).toMatch(/IF v_lot\.status <> 'LIVE'[\s\S]*LOT_ALREADY_SETTLED/);
    expect(foundationMigration).toMatch(/unique_player_purchase_per_auction UNIQUE \(auction_id, player_id\)/);
    expect(migration).toMatch(/CREATE TRIGGER auction_purchases_are_immutable/);
    expect(migration).toMatch(/CREATE TRIGGER auction_events_are_immutable/);
    expect(migration).toMatch(/is immutable/);
  });

  it('keeps the existing Owner self-bid rule and rejects Icon settlement', () => {
    const settle = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION settle_auction_lot_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    expect(settle).toMatch(/NOT v_auction\.allow_owner_self_purchase/);
    expect(settle).toMatch(/v_selection\.candidate_type = 'OWNER'/);
    expect(settle).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(settle).toMatch(/owner_team\.icon_registration_id = v_lot\.registration_id/);
  });

  it('exposes a manager-only settlement API and derives the actor server-side', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'SOLD' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/lots/${lotId}`, {
      method: 'POST',
      body: JSON.stringify({
        action: 'SETTLE',
        winningBid: 1,
        teamOwnerId: '40000000-0000-4000-8000-000000000001',
      }),
    });

    const response = await manageLot(request, lotContext);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('settle_auction_lot_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_actor_id: actorId,
    });
  });

  it('writes an explicit admin end reason through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'CLOSED' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Tournament ended early' }),
    });

    const response = await endAuction(request, auctionContext);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('end_auction_v1', {
      p_auction_id: auctionId,
      p_actor_id: actorId,
      p_reason: 'Tournament ended early',
    });
  });

  it('allows validated per-auction timer configuration through the existing manager API', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { bid_timer_seconds: 45 }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/configuration`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalKitty: 90000,
        totalPlayersToBuy: 3,
        baseBid: 5000,
        minimumReservePerPlayer: 10000,
        bidThreshold: 20000,
        lowIncrement: 500,
        highIncrement: 1000,
        bidTimerSeconds: 45,
      }),
    });

    const response = await updateConfiguration(request, auctionContext);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('update_auction_configuration_with_timer', expect.objectContaining({
      p_auction_id: auctionId,
      p_actor_id: actorId,
      p_bid_timer_seconds: 45,
    }));
  });

  it('rejects invalid timer values before reaching PostgreSQL', async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/configuration`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalKitty: 90000,
        totalPlayersToBuy: 3,
        baseBid: 5000,
        minimumReservePerPlayer: 10000,
        bidThreshold: 20000,
        lowIncrement: 500,
        highIncrement: 1000,
        bidTimerSeconds: 0,
      }),
    });

    const response = await updateConfiguration(request, auctionContext);

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('limits settlement/configuration RPC execution to the server role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION settle_auction_lot_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION settle_auction_lot_v1[\s\S]*TO service_role/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION end_auction_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION end_auction_v1[\s\S]*TO service_role/);
    expect(migration).toMatch(/UPDATE USING \(false\) WITH CHECK \(false\)/);
  });

  it('provides a visual countdown but requests settlement instead of deciding the result locally', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'page.tsx'),
      'utf8'
    );
    expect(page).toMatch(/Date\.parse\(liveLot\.bid_deadline_at\) - now/);
    expect(page).toMatch(/action: 'SETTLE'/);
    expect(page).toMatch(/SETTLING/);
  });
});
