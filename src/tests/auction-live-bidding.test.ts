import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as manageLot } from '@/app/api/admin/auctions/[auctionId]/lots/[lotId]/route';
import { POST as placeBid } from '@/app/api/auctions/[auctionId]/lots/[lotId]/bids/route';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isBidAllowed, type AuctionRules } from '@/lib/auction/rules';

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261021000000_phase_a4_live_bidding.sql'),
  'utf8'
);

const auctionId = '10000000-0000-4000-8000-000000000001';
const lotId = '30000000-0000-4000-8000-000000000001';
const ownerId = '20000000-0000-4000-8000-000000000001';
const adminId = '40000000-0000-4000-8000-000000000001';
const routeContext = { params: Promise.resolve({ auctionId, lotId }) };

describe('Phase A4 live bidding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireManager).mockResolvedValue({
      user: { id: adminId } as never,
      isAdmin: true,
      role: 'ADMIN' as never,
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: ownerId } },
          error: null,
        }),
      },
    } as never);
  });

  it('starts selected non-Icon lots only through an authorized locked RPC', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION start_auction_lot_v1/);
    expect(migration).toMatch(/IF p_actor_id IS NULL OR NOT is_manager\(p_actor_id\)/);
    expect(migration).toMatch(/v_auction\.status NOT IN \('OPEN', 'LIVE'\)/);
    expect(migration).toMatch(/v_lot\.status <> 'AVAILABLE'/);
    expect(migration).toMatch(/v_selection\.selection_status <> 'SELECTED'/);
    expect(migration).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(migration).toMatch(/v_registration_status NOT IN \('CONFIRMED', 'PENDING'\)/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX unique_live_auction_lot_per_auction/);
    expect(migration).toMatch(/WHERE status = 'LIVE'/);
    expect(migration).toMatch(/SET status = 'LIVE'[\s\S]*?current_highest_bid = NULL/);
  });

  it('serializes bid submissions by locking auction, lot, and budget rows', () => {
    const bidRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'));
    expect(bidRpc).toMatch(/FROM auctions[\s\S]*?FOR UPDATE/);
    expect(bidRpc).toMatch(/FROM auction_lots[\s\S]*?FOR UPDATE/);
    expect(bidRpc).toMatch(/FROM auction_team_budgets[\s\S]*?FOR UPDATE/);
    expect(bidRpc).toMatch(/UPDATE auction_lots[\s\S]*?current_highest_bid = p_bid_amount/);
    expect(bidRpc).toMatch(/event_type,[\s\S]*?'BID_PLACED'/);
  });

  it('validates every auction/lot/selection/purchase state in the database', () => {
    const bidRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'));
    expect(bidRpc).toMatch(/v_auction\.status <> 'LIVE'/);
    expect(bidRpc).toMatch(/v_lot\.status = 'SOLD'/);
    expect(bidRpc).toMatch(/v_lot\.status <> 'LIVE'/);
    expect(bidRpc).toMatch(/v_selection\.selection_status <> 'SELECTED'/);
    expect(bidRpc).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(bidRpc).toMatch(/FROM auction_purchases purchase/);
    expect(bidRpc).toMatch(/v_registration_status NOT IN \('CONFIRMED', 'PENDING'\)/);
    expect(bidRpc).toMatch(/FROM registrations registration[\s\S]*?FOR SHARE/);
    for (const reason of [
      'AUCTION_NOT_LIVE',
      'LOT_NOT_LIVE',
      'LOT_ALREADY_SOLD',
      'PLAYER_NOT_AVAILABLE',
      'TEAM_NOT_ELIGIBLE',
      'BID_BELOW_BASE',
      'BID_NOT_HIGHER_THAN_CURRENT',
      'INVALID_BID_INCREMENT',
      'BID_ABOVE_MAX_AFFORDABLE',
      'INSUFFICIENT_KITTY',
      'RESERVE_VIOLATION',
    ]) {
      expect(bidRpc).toContain(reason);
    }
  });

  it('derives team authorization from the authenticated owner instead of trusting client team IDs', () => {
    const bidRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'));
    expect(bidRpc).toMatch(/owner_player\.auth_user_id = p_bidder_user_id/);
    expect(bidRpc).toMatch(/v_owner_count <> 1/);
    expect(bidRpc).toMatch(/BIDDER_NOT_AUTHORIZED/);
    expect(bidRpc).toMatch(/TEAM_NOT_ELIGIBLE/);
    expect(bidRpc).not.toMatch(/p_team_owner_id/);
  });

  it('uses auction-specific bid increments, reserve, kitty, and optional maximum bid', () => {
    const bidRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'));
    expect(bidRpc).toMatch(/v_auction\.base_bid/);
    expect(bidRpc).toMatch(/v_auction\.bid_threshold/);
    expect(bidRpc).toMatch(/v_auction\.low_increment/);
    expect(bidRpc).toMatch(/v_auction\.high_increment/);
    expect(bidRpc).toMatch(/v_auction\.minimum_reserve/);
    expect(bidRpc).toMatch(/v_auction\.maximum_bid IS NOT NULL/);
    expect(bidRpc).toMatch(/v_budget\.remaining_kitty/);
    expect(bidRpc).toMatch(/v_auction\.required_players_to_buy - v_budget\.players_bought/);
    expect(bidRpc).toMatch(/'remaining_kitty_at_bid', v_budget\.remaining_kitty/);
    expect(bidRpc).toMatch(/'players_remaining_at_bid', v_players_remaining/);
  });

  it('has configurable owner self-bidding behavior, disabled by default', () => {
    expect(migration).toMatch(/allow_owner_self_purchase BOOLEAN NOT NULL DEFAULT FALSE/);
    expect(migration).toMatch(/NOT v_auction\.allow_owner_self_purchase/);
    expect(migration).toMatch(/SELF_BIDDING_NOT_ALLOWED/);
    expect(migration).toMatch(/update_auction_configuration_with_self_bid/);
  });

  it('records bid amount, bidder, team, lot, player, prior bid, and rule snapshot', () => {
    const bidRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'));
    expect(bidRpc).toMatch(/'lot_id', v_lot\.id/);
    expect(bidRpc).toMatch(/'bidder_user_id', p_bidder_user_id/);
    expect(bidRpc).toMatch(/'configuration', v_configuration/);
    expect(bidRpc).toMatch(/'BID_PLACED'/);
    expect(bidRpc).toMatch(/previous_value,[\s\S]*?new_value/);
    expect(bidRpc).toMatch(/v_previous_bid := v_lot\.current_highest_bid/);
  });

  it('does not deduct kitty, create purchases, assign players, or mark lots sold', () => {
    const bidRpc = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'),
      migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
    );
    expect(bidRpc).not.toMatch(/UPDATE auction_team_budgets/);
    expect(bidRpc).not.toMatch(/INSERT INTO auction_purchases/);
    expect(bidRpc).not.toMatch(/winning_team_owner_id\s*=/);
    expect(bidRpc).not.toMatch(/SET status\s*=\s*'SOLD'/);
  });

  it('allows ending a live lot as UNSOLD without creating a purchase', () => {
    const endRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1'));
    expect(endRpc).toMatch(/SET status = 'UNSOLD'/);
    expect(endRpc).toMatch(/'PLAYER_UNSOLD'/);
    expect(endRpc).not.toMatch(/INSERT INTO auction_purchases/);
    expect(endRpc).not.toMatch(/UPDATE auction_team_budgets/);
  });

  it('revokes direct RPC access from clients and grants only server role execution', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION place_auction_bid_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION place_auction_bid_v1[\s\S]*TO service_role/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION start_auction_lot_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION start_auction_lot_v1[\s\S]*TO service_role/);
  });

  it('validates configured bid steps with the shared AuctionRules behavior', () => {
    const rules: AuctionRules = {
      totalKitty: 90000,
      totalPlayersToBuy: 3,
      baseBid: 10000,
      minimumReservePerPlayer: 10000,
      bidThreshold: 30000,
      lowIncrement: 2500,
      highIncrement: 5000,
      maximumBid: 40000,
      allowOwnerSelfPurchase: false,
    };

    expect(isBidAllowed(10000, 90000, 0, undefined, rules).allowed).toBe(true);
    expect(isBidAllowed(12500, 90000, 0, 10000, rules).allowed).toBe(true);
    expect(isBidAllowed(15000, 90000, 0, 10000, rules).allowed).toBe(false);
    expect(isBidAllowed(35000, 90000, 0, 30000, rules).allowed).toBe(true);
    expect(isBidAllowed(45000, 90000, 0, 40000, rules).reason).toBe('BID_EXCEEDS_MAXIMUM_AFFORDABLE');
  });

  it('does not invoke the start RPC for an unauthorized admin request', async () => {
    vi.mocked(requireManager).mockRejectedValue(new Error('Unauthorized: Manager or Admin access required'));
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest('http://localhost/api/admin/auctions/auction/lots/lot', {
      method: 'POST',
      body: JSON.stringify({ action: 'START' }),
    });

    const response = await manageLot(request, routeContext);

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('routes authorized start and end operations through database RPCs', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: lotId, status: 'LIVE' }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const startResponse = await manageLot(
      new NextRequest('http://localhost/api/admin/auctions/x/lots/y', {
        method: 'POST',
        body: JSON.stringify({ action: 'START' }),
      }),
      routeContext
    );
    const endResponse = await manageLot(
      new NextRequest('http://localhost/api/admin/auctions/x/lots/y', {
        method: 'POST',
        body: JSON.stringify({ action: 'END_UNSOLD' }),
      }),
      routeContext
    );

    expect(startResponse.status).toBe(200);
    expect(endResponse.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, 'start_auction_lot_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_actor_id: adminId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'end_auction_lot_unsold_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_actor_id: adminId,
    });
  });

  it('rejects unauthenticated bid attempts before invoking the database', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: null,
    });
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: { getUser },
    } as never);
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await placeBid(
      new NextRequest('http://localhost/api/auctions/x/lots/y/bids', {
        method: 'POST',
        body: JSON.stringify({ bidAmount: 5000 }),
      }),
      routeContext
    );

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('does not forward a browser-supplied team ID or financial state to the bid RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: lotId, current_highest_bid: 5000, current_highest_team_owner_id: 'team-a' },
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await placeBid(
      new NextRequest(`http://localhost/api/auctions/${auctionId}/lots/${lotId}/bids`, {
        method: 'POST',
        body: JSON.stringify({
          bidAmount: 5000,
          teamOwnerId: 'team-b',
          remainingKitty: 999999,
          currentBid: 1000,
          maximumBid: 999999,
        }),
      }),
      routeContext
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('place_auction_bid_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_bid_amount: 5000,
      p_bidder_user_id: ownerId,
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_team_owner_id');
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_remaining_kitty');
    expect(await response.json()).toMatchObject({
      kittyDeducted: false,
      purchaseCreated: false,
      playerSold: false,
    });
  });

  it('rejects non-integer client bid amounts', async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await placeBid(
      new NextRequest(`http://localhost/api/auctions/${auctionId}/lots/${lotId}/bids`, {
        method: 'POST',
        body: JSON.stringify({ bidAmount: 5000.5 }),
      }),
      routeContext
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a specific validation error when the database rejects a bid', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'BID_BELOW_BASE' },
    });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);

    const response = await placeBid(
      new NextRequest(`http://localhost/api/auctions/${auctionId}/lots/${lotId}/bids`, {
        method: 'POST',
        body: JSON.stringify({ bidAmount: 5000 }),
      }),
      routeContext
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'BID_BELOW_BASE' });
  });
});
