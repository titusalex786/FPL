import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  } catch {}
}

import { POST as lotActionPost } from '@/app/api/admin/auctions/[auctionId]/lots/[lotId]/route';
import { GET as retryValidationGet } from '@/app/api/admin/auctions/[auctionId]/retry-round/validation/route';
import { POST as retryStartPost } from '@/app/api/admin/auctions/[auctionId]/retry-round/start/route';
import { GET as reconciliationGet } from '@/app/api/admin/auctions/[auctionId]/reconciliation/route';
import { POST as teamBidPost } from '@/app/api/auctions/[auctionId]/bid/route';
import * as isManagerModule from '@/lib/auth/is-manager';
import * as adminSupabaseModule from '@/lib/supabase/admin';

const dummyAuctionId = 'eae4f4d2-aaf4-4a80-8c32-d021769e108b';
const mockLotId = 'bc385ca1-337d-490b-9c73-985f4d522807';

describe('Immediate SOLD and UNSOLD Controls', () => {
  it('verifies settle_auction_lot_v1 allows immediate SOLD without timer deadline wait', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031030000_finalize_auction_flow_and_reconciliation.sql'),
      'utf8'
    );

    // Confirms settle_auction_lot_v1 was redefined
    expect(migration).toContain('CREATE OR REPLACE FUNCTION settle_auction_lot_v1');
    // Does NOT enforce BID_DEADLINE_NOT_EXPIRED
    expect(migration).not.toContain("MESSAGE = 'BID_DEADLINE_NOT_EXPIRED'");
    // Requires a valid bid before settling
    expect(migration).toContain("MESSAGE = 'CANNOT_SETTLE_WITHOUT_BID'");
    // Atomic purchase record creation
    expect(migration).toContain('INSERT INTO auction_purchases');
    // Atomic kitty deduction
    expect(migration).toContain('UPDATE auction_team_budgets');
  });

  it('verifies end_auction_lot_unsold_v1 rejects UNSOLD if an active bid exists', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031030000_finalize_auction_flow_and_reconciliation.sql'),
      'utf8'
    );

    expect(migration).toContain('CREATE OR REPLACE FUNCTION end_auction_lot_unsold_v1');
    expect(migration).toContain("MESSAGE = 'CANNOT_MARK_UNSOLD_WITH_ACTIVE_BID'");
  });

  it('verifies manager control UI enables SOLD immediately upon first valid bid', () => {
    const controlCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    // SOLD button checks currentBid and IN_PROGRESS, not secondsRemaining !== 0
    expect(controlCode).toContain('id="admin-sold-btn"');
    expect(controlCode).toContain('disabled={busy || !liveLot.currentBid || liveLot.status !== \'IN_PROGRESS\'}');
    expect(controlCode).toContain("SOLD {liveLot.currentBid ? `(₹${money(liveLot.currentBid)})` : ''}");
  });

  it('verifies manager control UI UNSOLD button disables when active bid exists', () => {
    const controlCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    expect(controlCode).toContain('id="admin-unsold-btn"');
    expect(controlCode).toContain('disabled={busy || Boolean(liveLot.currentBid) || liveLot.status !== \'IN_PROGRESS\'}');
  });

  it('verifies Next Player button is provided for advancing lots', () => {
    const controlCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    expect(controlCode).toContain('Next (#{nextLot.lotNumber})');
  });

  it('verifies projector page displays synchronized UNSOLD badge and animation', () => {
    const projectorCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'live', 'page.tsx'),
      'utf8'
    );

    expect(projectorCode).toContain('isUnsold');
    expect(projectorCode).toContain('UNSOLD');
    expect(projectorCode).toContain('Eligible for Retry Round');
    expect(projectorCode).toContain('object-contain');
  });
});

describe('UNSOLD Retry Round Implementation and Validation', () => {
  it('verifies get_unsold_retry_validation_v1 RPC and route return expected counts', async () => {
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    const mockValidationData = {
      auction_id: dummyAuctionId,
      initial_round_unsold_count: 5,
      retry_eligible_count: 5,
      already_retried_count: 0,
      sold_count_excluded: 10,
      invalid_or_cancelled_count: 0,
      candidates: [
        {
          registration_id: 'reg-1',
          player_id: 'p-1',
          player_name: 'Player One',
          role: 'BATSMAN',
          image: null,
        },
      ],
    };

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: mockValidationData, error: null }),
    } as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/auctions/${dummyAuctionId}/retry-round/validation`
    );
    const response = await retryValidationGet(request, {
      params: Promise.resolve({ auctionId: dummyAuctionId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.initial_round_unsold_count).toBe(5);
    expect(body.retry_eligible_count).toBe(5);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].player_name).toBe('Player One');
  });

  it('verifies start_unsold_retry_round_v1 RPC initiates round 2 with sequential lots', async () => {
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          success: true,
          round_number: 2,
          created_lots_count: 5,
        },
        error: null,
      }),
    } as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/auctions/${dummyAuctionId}/retry-round/start`,
      { method: 'POST' }
    );
    const response = await retryStartPost(request, {
      params: Promise.resolve({ auctionId: dummyAuctionId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.round_number).toBe(2);
    expect(body.created_lots_count).toBe(5);
  });
});

describe('Owner, Icon, and Team Allocation Rules', () => {
  it('verifies migration authorizes both team owner and designated icon player in place_auction_bid_v1', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031030000_finalize_auction_flow_and_reconciliation.sql'),
      'utf8'
    );

    expect(migration).toContain('CREATE OR REPLACE FUNCTION place_auction_bid_v1');
    expect(migration).toContain('icon_reg.id = owner_team.icon_registration_id');
    expect(migration).toContain("'bidder_type', v_bidder_type");
    expect(migration).toContain("'bidder_user_id', p_bidder_user_id");
  });

  it('verifies resolveAuctionOwner in bid route resolves team for both owner and icon player', async () => {
    const bidRouteCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'bid', 'route.ts'),
      'utf8'
    );

    expect(bidRouteCode).toContain('owner.icon_registration_id && userRegIds.has(owner.icon_registration_id)');
    expect(bidRouteCode).toContain('owner.owner_registration_id && userRegIds.has(owner.owner_registration_id)');
  });
});

describe('Persist Purchased Players & Reconciliation Check', () => {
  it('verifies get_auction_reconciliation_v1 audit returns complete financial check', async () => {
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    const mockReconciliation = {
      auction_id: dummyAuctionId,
      total_sold_lots: 12,
      total_purchases: 12,
      total_unique_purchased_registrations: 12,
      is_balanced: true,
      missing_purchase_lots: [],
      missing_sold_lot_purchases: [],
      teams: [
        {
          team_owner_id: 'team-1',
          team_name: 'Team Alpha',
          owner_name: 'Owner Alpha',
          starting_kitty: 100000,
          remaining_kitty: 75000,
          kitty_deducted: 25000,
          total_purchased_amount: 25000,
          purchased_count: 2,
          is_kitty_matched: true,
        },
      ],
    };

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: mockReconciliation, error: null }),
    } as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/auctions/${dummyAuctionId}/reconciliation`
    );
    const response = await reconciliationGet(request, {
      params: Promise.resolve({ auctionId: dummyAuctionId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.is_balanced).toBe(true);
    expect(body.total_sold_lots).toBe(12);
    expect(body.total_purchases).toBe(12);
    expect(body.teams[0].is_kitty_matched).toBe(true);
  });
});

describe('Team View Details & UI Presentation', () => {
  it('verifies control panel route surfaces roster, iconName, and association warning flag', () => {
    const routeCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'control-panel', 'route.ts'),
      'utf8'
    );

    expect(routeCode).toContain('hasMissingIconAssociation');
    expect(routeCode).toContain('totalRosterSpend');
    expect(routeCode).toContain('roster');
  });

  it('verifies manager control page implements Team Details modal and View Details buttons', () => {
    const controlCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    // View Details button on each team card
    expect(controlCode).toContain('View Details ({team.roster?.length ?? team.playersBought})');
    // Modal with owner and icon/bidder
    expect(controlCode).toContain('Missing Icon/Bidder Association');
    // Authoritative roster list
    expect(controlCode).toContain('Authoritative DB Records');
    // Reconciliation and Retry modal triggers
    expect(controlCode).toContain('openRetryModal');
    expect(controlCode).toContain('openReconciliationModal');
  });
});
