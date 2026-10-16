import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  } catch {}
}

import { POST as bidPost } from '@/app/api/admin/auctions/[auctionId]/bid/route';
import * as isManagerModule from '@/lib/auth/is-manager';
import * as adminSupabaseModule from '@/lib/supabase/admin';

const dummyAuctionId = 'eae4f4d2-aaf4-4a80-8c32-d021769e108b';
const mockLotId = 'bc385ca1-337d-490b-9c73-985f4d522807';
const mockTeam1 = '70102164-fd88-4b10-95f6-4ce6783394d7';
const mockTeam2 = '4e1bd3ec-5cda-4384-a129-3b6dadaddbc8';
const mockActorId = 'dcbf3872-eeab-4534-846c-b661bf7f4f43';

describe('Auction Bidding Fix & Regression Tests', () => {
  it('verifies migration 20261031010000 completely eliminates auction_bids and uses canonical auction_events', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031010000_fix_auction_bid_rpcs.sql'),
      'utf8'
    );

    // Verifies neither function references the non-existent auction_bids table
    expect(migration).not.toContain('INSERT INTO auction_bids');
    expect(migration).not.toContain('FROM auction_bids');

    // Verifies canonical insertion into auction_events with BID_PLACED
    expect(migration).toContain("'BID_PLACED'");
    expect(migration).toContain("INSERT INTO auction_events");

    // Verifies atomic update to auction_lots
    expect(migration).toContain("UPDATE auction_lots");
    expect(migration).toContain("current_highest_bid = p_bid_amount");
    expect(migration).toContain("bid_deadline_at = v_now + make_interval(secs => v_auction.bid_timer_seconds)");

    // Verifies self-bidding prevention
    expect(migration).toContain("'CANNOT_OUTBID_SELF'");
    expect(migration).toContain("'SELF_BIDDING_NOT_ALLOWED'");

    // Verifies base and increment validations
    expect(migration).toContain("'BID_BELOW_BASE'");
    expect(migration).toContain("'INVALID_BID_INCREMENT'");

    // Verifies kitty and reserve validations
    expect(migration).toContain("'INSUFFICIENT_KITTY'");
    expect(migration).toContain("'RESERVE_VIOLATION'");
    expect(migration).toContain("'BID_ABOVE_MAX_AFFORDABLE'");

    // Verifies permissions
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION place_admin_auction_bid_v1(UUID, UUID, UUID, INTEGER, UUID) TO service_role;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION place_auction_bid_v1(UUID, UUID, INTEGER, UUID) TO authenticated, service_role;");
  });

  it('verifies bid API route handles CANNOT_OUTBID_SELF and returns 409 status with clean message', async () => {
    const bidRouteSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'bid', 'route.ts'),
      'utf8'
    );

    expect(bidRouteSource).toContain("'CANNOT_OUTBID_SELF'");
    expect(bidRouteSource).toContain("'Team is already the leading bidder.'");
    expect(bidRouteSource).toContain("code === 'CANNOT_OUTBID_SELF'");
    expect(bidRouteSource).toContain("[Admin Auction Bid RPC Error]:");

    // Mock manager authorization
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: mockActorId, email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    // Mock RPC returning CANNOT_OUTBID_SELF
    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'CANNOT_OUTBID_SELF', code: '55000' },
      }),
    } as any);

    const req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam1,
        bidAmount: 5000,
      }),
    });

    const res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Team is already the leading bidder.');
    expect(body.errorCode).toBe('CANNOT_OUTBID_SELF');
  });

  it('verifies bid API route handles first bid at base bid, increments, and kitty violations', async () => {
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: mockActorId, email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    // 1. Success first bid at 5,000
    const mockRpc = vi.fn().mockResolvedValue({
      data: { id: mockLotId, current_highest_bid: 5000, current_highest_team_owner_id: mockTeam1 },
      error: null,
    });
    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({ rpc: mockRpc } as any);

    let req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam1,
        bidAmount: 5000,
      }),
    });
    let res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.success).toBe(true);
    expect(body.lot.current_highest_bid).toBe(5000);

    // 2. Success subsequent increment at 6,000 (+1,000)
    mockRpc.mockResolvedValueOnce({
      data: { id: mockLotId, current_highest_bid: 6000, current_highest_team_owner_id: mockTeam2 },
      error: null,
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam2,
        bidAmount: 6000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.success).toBe(true);
    expect(body.lot.current_highest_bid).toBe(6000);

    // 3. Invalid bid: Below base bid (< 5,000)
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'BID_BELOW_BASE', code: '22023' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam1,
        bidAmount: 4000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe('Bid is below the minimum bid.');

    // 4. Invalid increment: +500 instead of +1,000
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'INVALID_BID_INCREMENT', code: '22023' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam2,
        bidAmount: 5500,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe('Please use the next valid bid amount.');

    // 5. Insufficient kitty
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'INSUFFICIENT_KITTY', code: 'P0001' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam2,
        bidAmount: 200000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe('Insufficient budget for this bid.');

    // 6. Reserve violation
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RESERVE_VIOLATION', code: 'P0001' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam2,
        bidAmount: 90000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe('Bid exceeds maximum affordable bid (reserve protected).');

    // 7. Self bidding not allowed (owner bidding on own registration)
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'SELF_BIDDING_NOT_ALLOWED', code: '42501' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam1,
        bidAmount: 7000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(422);
    body = await res.json();
    expect(body.error).toBe('Team cannot bid on its own player.');

    // 8. Duplicate submission (same team sends duplicate bid or outdated amount)
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'CANNOT_OUTBID_SELF', code: '55000' },
    });
    req = new NextRequest(`http://localhost/api/admin/auctions/${dummyAuctionId}/bid`, {
      method: 'POST',
      body: JSON.stringify({
        lotId: mockLotId,
        teamOwnerId: mockTeam1,
        bidAmount: 6000,
      }),
    });
    res = await bidPost(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
    expect(res.status).toBe(409);
    body = await res.json();
    expect(body.error).toBe('Team is already the leading bidder.');
  });

  it('verifies projector and admin preview use object-contain without cropping the player photo', () => {
    const projectorSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'live', 'page.tsx'),
      'utf8'
    );
    // Projector must use object-contain
    expect(projectorSource).toContain("object-contain");
    expect(projectorSource).toContain("style={{ objectFit: 'contain' }}");
    expect(projectorSource).not.toContain("className=\"rounded-3xl object-cover shadow-2xl\"");

    const controlSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );
    // Admin preview must use object-contain
    expect(controlSource).toContain("object-contain");
    expect(controlSource).toContain("style={{ objectFit: 'contain' }}");
    expect(controlSource).not.toContain("className=\"h-40 w-full rounded-xl object-cover md:w-[150px]\"");
  });

  it('verifies migration 20261031040000 disables countdown timer after first bid is placed', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031040000_disable_timer_after_first_bid.sql'),
      'utf8'
    );

    // Verifies deadline is only enforced before first bid
    expect(migration).toContain('IF v_lot.current_highest_bid IS NULL THEN');
    expect(migration).toContain("RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'BID_DEADLINE_EXPIRED';");

    // Verifies bid_deadline_at is set to NULL on bid placement to disable timer
    expect(migration).toContain('bid_deadline_at = NULL');
  });

  it('verifies control page disables timer and performs fast optimistic bidding updates', () => {
    const controlSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    // Verifies secondsRemaining returns null when currentBid is present
    expect(controlSource).toContain('if (liveLot.currentBid) return null;');

    // Verifies Bidding Open badge displays when timer is disabled
    expect(controlSource).toContain('⚡ Bidding Open (Timer Disabled)');

    // Verifies canBid does not block bids when opening bid has been placed
    expect(controlSource).toContain('const isOpeningBidExpired = !liveLot?.currentBid && secondsRemaining === 0;');
    expect(controlSource).toContain('!isOpeningBidExpired');

    // Verifies optimistic local state update in handleAdminBid
    expect(controlSource).toContain('setBiddingTeamId(null);');
    expect(controlSource).toContain('void refresh(false);');
  });
});

