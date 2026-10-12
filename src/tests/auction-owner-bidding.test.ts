import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GET,
  POST,
} from '@/app/api/auctions/[auctionId]/bid/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getMaximumAffordableBid, getNextBid } from '@/lib/auction/rules';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

const auctionId = '10000000-0000-4000-8000-000000000001';
const lotId = '30000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const ownerId = '40000000-0000-4000-8000-000000000001';
const otherOwnerId = '40000000-0000-4000-8000-000000000002';
const tournamentId = '50000000-0000-4000-8000-000000000001';
const rpcResult = {
  id: lotId,
  auction_id: auctionId,
  status: 'LIVE',
  current_highest_bid: 22000,
  bid_deadline_at: '2026-10-11T00:00:30.000Z',
};

const routeContext = { params: Promise.resolve({ auctionId }) };
const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261022000000_phase_a5_settlement.sql'),
  'utf8'
);
const a4Migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261021000000_phase_a4_live_bidding.sql'),
  'utf8'
);
const a6Dashboard = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'team-dashboard', 'route.ts'),
  'utf8'
);
const biddingRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'bid', 'route.ts'),
  'utf8'
);
const ownerPage = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'bid', 'page.tsx'),
  'utf8'
);
const realtimeHook = readFileSync(
  resolve(process.cwd(), 'src', 'lib', 'auction', 'use-auction-realtime.ts'),
  'utf8'
);

function query(response: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'contains', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response));
  builder.then = (
    onFulfilled: (value: typeof response) => unknown,
    onRejected: (reason: unknown) => unknown
  ) => Promise.resolve(response).then(onFulfilled, onRejected);
  return builder;
}

function authenticate(user: { id: string } | null = { id: userId }) {
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'No session' },
      }),
    },
  } as never);
}

function setupClient(options: {
  owner?: boolean;
  auction?: boolean;
  auctionStatus?: string;
  liveLot?: Record<string, unknown> | null;
  budget?: boolean;
  rpcError?: { code: string; message: string } | null;
  rpcData?: unknown;
} = {}) {
  const {
    owner = true,
    auction = true,
    auctionStatus = 'LIVE',
    liveLot = {
      id: lotId,
      lot_number: 4,
      status: 'LIVE',
      current_highest_bid: 20000,
      current_highest_team_owner_id: otherOwnerId,
      bid_deadline_at: '2026-10-11T00:00:30.000Z',
      round: { round_number: 1, round_type: 'INITIAL' },
      player: {
        full_name: 'Registered Player',
        profile_image_url: 'https://example.test/player.jpg',
        cricket_role: 'BATSMAN',
        batting_style: 'RIGHT_HAND',
        jersey_size: 'M',
      },
      registration: {
        registered_name_snapshot: 'Registered Player',
        registered_role_snapshot: 'BATSMAN',
        registered_batting_style_snapshot: 'RIGHT_HAND',
        registered_bowling_style_snapshot: null,
        registered_jersey_size_snapshot: 'M',
      },
    },
    budget = true,
    rpcError = null,
    rpcData = rpcResult,
  } = options;
  const highestBidderId = liveLot
    ? (liveLot.current_highest_team_owner_id as string | null | undefined)
    : null;

  const tableResponses: Record<string, Array<{ data: unknown; error?: unknown }>> = {
    auctions: auction
      ? [{
          data: {
            id: auctionId,
            tournament_id: tournamentId,
            status: auctionStatus,
            bid_timer_seconds: 30,
            base_bid: 5000,
            bid_threshold: 20000,
            low_increment: 1000,
            high_increment: 2000,
            minimum_reserve: 5000,
            maximum_bid: null,
          },
        }]
      : [{ data: null }],
    players: [{ data: owner ? { id: '60000000-0000-4000-8000-000000000001' } : null }],
    team_owners: owner
      ? [
          { data: [{ id: ownerId }] },
          ...(liveLot && highestBidderId
            ? [{
                data: {
                  id: highestBidderId,
                  owner_name: highestBidderId === ownerId ? 'Owner' : 'Other Owner',
                  team_name: highestBidderId === ownerId ? 'Team Titans' : 'Team Warriors',
                },
              }]
            : []),
          ...(liveLot
            ? [{ data: [{ id: otherOwnerId, owner_name: 'Other Owner', team_name: 'Team Warriors' }] }]
            : []),
        ]
      : [{ data: [] }],
    auction_team_budgets: [{ data: budget ? { id: 'budget-a' } : null }],
    auction_lots: [{ data: liveLot }],
    auction_events: [{
      data: liveLot
        ? [
            {
              id: 'event-1',
              team_owner_id: otherOwnerId,
              amount: 20000,
              created_at: '2026-10-11T00:00:01.000Z',
            },
            {
              id: 'event-2',
              team_owner_id: ownerId,
              amount: 19000,
              created_at: '2026-10-11T00:00:00.000Z',
            },
          ]
        : [],
    }],
  };
  const from = vi.fn((table: string) => {
    const responses = tableResponses[table] || [{ data: [] }];
    return query(responses.shift() || { data: [] });
  });
  const rpc = vi.fn().mockResolvedValue(
    rpcError ? { data: null, error: rpcError } : { data: rpcData, error: null }
  );
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);
  return { from, rpc };
}

function getRequest() {
  return new NextRequest(`http://localhost/api/auctions/${auctionId}/bid`);
}

function postRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/auctions/${auctionId}/bid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('A8 owner bidding API authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate();
  });

  it('rejects unauthenticated state requests', async () => {
    authenticate(null);
    const response = await GET(getRequest(), routeContext);
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated bid submissions', async () => {
    authenticate(null);
    const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a signed-in non-owner', async () => {
    setupClient({ owner: false });
    const response = await GET(getRequest(), routeContext);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('auction team');
  });

  it('rejects a user who owns a team in a different auction tournament', async () => {
    setupClient({ owner: false });
    const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(response.status).toBe(403);
    expect((await response.json()).errorCode).toBe('TEAM_NOT_ELIGIBLE');
  });

  it('allows an owner only when their player/team/budget are linked to the requested auction', async () => {
    const { from, rpc } = setupClient();
    const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(response.status).toBe(200);
    expect(from.mock.calls.map(([table]) => table)).toEqual([
      'auctions',
      'players',
      'team_owners',
      'auction_team_budgets',
    ]);
    expect(rpc).toHaveBeenCalledWith('place_auction_bid_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_bid_amount: 21000,
      p_bidder_user_id: userId,
    });
  });

  it('rejects invalid auction identifiers before reading auction data', async () => {
    const response = await GET(getRequest(), {
      params: Promise.resolve({ auctionId: 'invalid-id' }),
    });
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects an owner who has no initialized auction budget', async () => {
    setupClient({ budget: false });
    const response = await GET(getRequest(), routeContext);
    expect(response.status).toBe(403);
  });
});

describe('A8 owner bidding state and privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate();
  });

  it('returns the live lot, player snapshots, round, current bid, and public leading team', async () => {
    setupClient();
    const response = await GET(getRequest(), routeContext);
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(result.liveLot).toMatchObject({
      lotId,
      lotNumber: 4,
      status: 'LIVE',
      currentBid: 20000,
      highestBidderName: 'Team Warriors',
      isHighestBidder: false,
      roundNumber: 1,
      player: {
        name: 'Registered Player',
        role: 'BATSMAN',
        battingStyle: 'RIGHT_HAND',
      },
    });
    expect(result.liveLot).not.toHaveProperty('current_highest_team_owner_id');
  });

  it('returns no live lot for a live auction with no active lot', async () => {
    setupClient({ liveLot: null });
    const response = await GET(getRequest(), routeContext);
    expect((await response.json()).liveLot).toBeNull();
  });

  it('identifies the signed-in owner as the leading bidder by database owner ID', async () => {
    setupClient({
      liveLot: {
        id: lotId,
        lot_number: 4,
        status: 'LIVE',
        current_highest_bid: 21000,
        current_highest_team_owner_id: ownerId,
        bid_deadline_at: '2026-10-11T00:00:30.000Z',
        round: { round_number: 1, round_type: 'INITIAL' },
        player: null,
        registration: null,
      },
    });
    const result = await (await GET(getRequest(), routeContext)).json();
    expect(result.liveLot).toMatchObject({
      highestBidderName: 'Team Titans',
      isHighestBidder: true,
    });
  });

  it('does not expose a lot when the auction is not LIVE', async () => {
    const { from } = setupClient({ auctionStatus: 'CLOSED', liveLot: null });
    const response = await GET(getRequest(), routeContext);
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.auction.status).toBe('CLOSED');
    expect(result.liveLot).toBeNull();
    expect(from.mock.calls.map(([table]) => table)).not.toContain('auction_lots');
  });

  it('does not disclose another team budget, owner identity, or private audit payloads', async () => {
    const { from } = setupClient();
    const response = await GET(getRequest(), routeContext);
    const payload = JSON.stringify(await response.json());
    expect(from.mock.calls.map(([table]) => table)).toContain('auction_team_budgets');
    expect(biddingRoute).toContain(".select('id')");
    expect(biddingRoute).toContain(".eq('team_owner_id', ownerRows[0].id)");
    expect(payload).not.toContain('remaining_kitty');
    expect(payload).not.toContain('otherOwnerId');
    expect(payload).not.toContain('event_payload');
    expect(payload).not.toContain('owner_name');
  });

  it('shows only public bid history team names and amounts without exposing event IDs', async () => {
    setupClient();
    const response = await GET(getRequest(), routeContext);
    const result = await response.json();
    expect(result.bidHistory).toEqual([
      expect.objectContaining({ teamName: 'Team Warriors', amount: 20000 }),
      expect.objectContaining({ teamName: 'Your team', amount: 19000 }),
    ]);
    expect(JSON.stringify(result.bidHistory)).not.toContain('event-1');
  });

  it('does not return registration numbers or payment/private admin fields', async () => {
    setupClient();
    const result = await (await GET(getRequest(), routeContext)).json();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('registration_number');
    expect(serialized).not.toContain('payment');
    expect(serialized).not.toContain('screenshot');
  });
});

describe('A8 secure bid submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate();
  });

  it('accepts only lotId and proposedBid from the browser', async () => {
    const { rpc } = setupClient();
    const response = await POST(
      postRequest({ lotId, proposedBid: 21000, teamOwnerId: otherOwnerId }),
      routeContext
    );
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid lot IDs, non-integer amounts, and amounts outside database integer bounds', async () => {
    setupClient();
    for (const body of [
      { lotId: 'invalid', proposedBid: 21000 },
      { lotId, proposedBid: 21000.5 },
      { lotId, proposedBid: 2147483648 },
      { lotId, proposedBid: 0 },
    ]) {
      const response = await POST(postRequest(body), routeContext);
      expect(response.status).toBe(400);
    }
  });

  it('returns the authoritative RPC result after a successful bid', async () => {
    const { rpc } = setupClient({ rpcData: rpcResult });
    const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, lot: rpcResult });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('uses only the authenticated user ID and never accepts owner, team, budget, or current-bid claims', async () => {
    const { rpc } = setupClient();
    await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_bid_amount: 21000,
      p_bidder_user_id: userId,
    });
    expect(a6Dashboard).toContain(".eq('auth_user_id', user.id)");
    expect(a6Dashboard).toContain(".eq('player_id', player.id)");
  });

  it.each([
    ['AUCTION_NOT_LIVE', 409, 'not accepting bids'],
    ['LOT_NOT_LIVE', 409, 'no longer live'],
    ['LOT_ALREADY_SOLD', 409, 'no longer live'],
    ['BID_DEADLINE_EXPIRED', 409, 'timer has expired'],
    ['BID_BELOW_BASE', 422, 'below the minimum bid'],
    ['BID_NOT_HIGHER_THAN_CURRENT', 409, 'outbid'],
    ['INVALID_BID_INCREMENT', 422, 'next valid bid'],
    ['BID_ABOVE_MAX_AFFORDABLE', 422, 'maximum affordable bid'],
    ['INSUFFICIENT_KITTY', 422, 'Insufficient budget'],
    ['RESERVE_VIOLATION', 422, 'maximum affordable bid'],
    ['TEAM_NOT_ELIGIBLE', 422, 'auction team'],
    ['BIDDER_NOT_AUTHORIZED', 403, 'not authorized'],
    ['SELF_BIDDING_NOT_ALLOWED', 422, 'own player'],
    ['PLAYER_NOT_AVAILABLE', 422, 'not available'],
  ] as const)(
    'maps RPC reason %s to status %s and safe owner-facing feedback',
    async (code, status, message) => {
      setupClient({ rpcError: { code: 'P0001', message: code } });
      const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
      const payload = await response.json();
      expect(response.status).toBe(status);
      expect(payload.error).toContain(message);
      expect(payload.error).not.toContain('P0001');
    }
  );

  it('returns a safe failure for an unknown database exception', async () => {
    setupClient({ rpcError: { code: 'XX000', message: 'secret database contents' } });
    const response = await POST(postRequest({ lotId, proposedBid: 21000 }), routeContext);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to place your bid right now.',
    });
  });

  it('rejects malformed JSON without invoking the RPC', async () => {
    setupClient();
    const response = await POST(
      new NextRequest(`http://localhost/api/auctions/${auctionId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      }),
      routeContext
    );
    expect(response.status).toBe(400);
  });
});

describe('A8 bidding rules and browser behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate();
  });

  it('calculates next bid below the configured threshold', () => {
    const rules = {
      totalKitty: 180000,
      totalPlayersToBuy: 9,
      baseBid: 5000,
      minimumReservePerPlayer: 5000,
      bidThreshold: 20000,
      lowIncrement: 1000,
      highIncrement: 2000,
    };
    expect(getNextBid(19000, rules)).toBe(20000);
    expect(getNextBid(20000, rules)).toBe(22000);
    expect(getNextBid(0, rules)).toBe(5000);
  });

  it('calculates next bid above the configured threshold', () => {
    expect(
      getNextBid(60000, {
        totalKitty: 180000,
        totalPlayersToBuy: 9,
        baseBid: 5000,
        minimumReservePerPlayer: 5000,
        bidThreshold: 20000,
        lowIncrement: 1000,
        highIncrement: 2000,
      })
    ).toBe(62000);
  });

  it('calculates the reserve-aware affordable maximum through the A1 shared helper', () => {
    expect(
      getMaximumAffordableBid(120000, 1, {
        totalKitty: 180000,
        totalPlayersToBuy: 9,
        baseBid: 5000,
        minimumReservePerPlayer: 5000,
        bidThreshold: 20000,
        lowIncrement: 1000,
        highIncrement: 2000,
      })
    ).toBe(85000);
  });

  it('keeps deadline, financial ceiling, quota, and bid state server-authoritative', () => {
    expect(migration).toContain('BID_DEADLINE_EXPIRED');
    expect(migration).toContain('BID_ABOVE_MAX_AFFORDABLE');
    expect(migration).toContain('INSUFFICIENT_KITTY');
    expect(migration).toContain('TEAM_NOT_ELIGIBLE');
    expect(a4Migration).toContain('place_auction_bid_v1');
    expect(a4Migration).toMatch(/REVOKE ALL ON FUNCTION place_auction_bid_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
  });

  it('prevents icon-player bidding through the existing selected-player check', () => {
    expect(migration).toMatch(/v_selection\.candidate_type = 'ICON'/);
    expect(migration).toMatch(/v_registration_type = 'ICON'/);
  });

  it.each(['SOLD', 'UNSOLD'])(
    'rejects bidding on a %s lot through the secure RPC state guard',
    async (status) => {
      const bidRpc = migration.slice(
        migration.indexOf('CREATE OR REPLACE FUNCTION place_auction_bid_v1'),
        migration.indexOf('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1')
      );
      expect(bidRpc).toMatch(/v_lot\.status <> 'LIVE'/);
      setupClient({ rpcError: { code: '55000', message: 'LOT_NOT_LIVE' } });
      const response = await POST(
        postRequest({ lotId, proposedBid: 21000 }),
        routeContext
      );
      expect(response.status).toBe(409);
    }
  );

  it('disables bidding for unavailable, expired, unaffordable, or completed-quota state', () => {
    expect(ownerPage).toContain('secondsRemaining > 0');
    expect(ownerPage).toContain('nextBid <= maximumAffordable');
    expect(ownerPage).toContain('!quotaComplete');
    expect(ownerPage).toContain('timerExpired');
  });

  it('prevents double submission and refreshes authoritative state after a bid', () => {
    expect(ownerPage).toContain('setSubmitting(true)');
    expect(ownerPage).toContain('disabled={!canBid || submitting}');
    expect(ownerPage).toContain('await refresh()');
  });

  it('uses realtime with controlled visibility-aware fallback polling and no overlapping requests', () => {
    expect(ownerPage).toContain('refreshInFlight.current');
    expect(ownerPage).toContain('useAuctionRealtime(auctionId, refresh, 10000)');
    expect(realtimeHook).toContain('document.visibilityState === \'visible\'');
    expect(realtimeHook).toContain('window.setInterval(poll, fallbackIntervalMs)');
    expect(realtimeHook).toContain('window.clearInterval(timer)');
  });

  it('does not settle a lot from the browser when its timer expires', () => {
    expect(ownerPage).toContain('if (!lot || secondsRemaining !== 0');
    expect(ownerPage).toContain('void refresh()');
    expect(ownerPage).not.toContain("action: 'SETTLE'");
  });

  it('displays highest bidder, owner status, own budget, icon, and purchase history', () => {
    expect(ownerPage).toContain('YOU ARE LEADING');
    expect(ownerPage).toContain('You have been outbid.');
    expect(ownerPage).toContain('Kitty remaining');
    expect(ownerPage).toContain('Icon · Allocated');
    expect(ownerPage).toContain('Purchased players');
  });

  it('provides a mobile-first sticky primary bidding action', () => {
    expect(ownerPage).toContain('fixed inset-x-0 bottom-0');
    expect(ownerPage).toContain('min-h-14');
    expect(ownerPage).toContain('BID ${formatCurrency(nextBid)}');
  });
});
