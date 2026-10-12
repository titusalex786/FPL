import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH as updateConfiguration } from '@/app/api/admin/auctions/[auctionId]/configuration/route';
import { PATCH as updateSelection } from '@/app/api/admin/auctions/[auctionId]/selections/route';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261020000000_auction_selection_and_dynamic_rules.sql'),
  'utf8'
);

const auctionId = '10000000-0000-4000-8000-000000000001';
const registrationId = '30000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ auctionId }) };

describe('Auction player selections and dynamic rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireManager).mockResolvedValue({
      user: { id: actorId } as never,
      isAdmin: true,
      role: 'ADMIN' as never,
    });
  });

  it('models selections independently of lot status and defaults icons to locked', () => {
    expect(migration).toMatch(/CREATE TYPE auction_player_selection_status AS ENUM \('SELECTED', 'LOCKED', 'EXCLUDED'\)/);
    expect(migration).toMatch(/CREATE TYPE auction_candidate_type AS ENUM \('OWNER', 'ICON', 'PLAYER'\)/);
    expect(migration).toMatch(/WHEN candidates\.candidate_type = 'ICON' THEN 'LOCKED'/);
    expect(migration).toMatch(/ELSE 'SELECTED'::auction_player_selection_status/);
    expect(migration).toMatch(/selection_status = 'SELECTED'/);
  });

  it('uses registration and team owner references to classify Owner and Icon candidates', () => {
    expect(migration).toMatch(/owner_team\.owner_registration_id = r\.id/);
    expect(migration).toMatch(/owner_team\.icon_registration_id = r\.id/);
    expect(migration).toMatch(/owner_team\.player_id = r\.player_id/);
    expect(migration).not.toMatch(/full_name\s*=|contact_email\s*=/i);
  });

  it('filters inactive, purchased, or already-lotted candidates', () => {
    expect(migration).toMatch(/registration_status IN \('CONFIRMED', 'PENDING'\)/);
    expect(migration).toMatch(/purchase\.auction_id = p_auction_id[\s\S]*?purchase\.player_id = r\.player_id/);
    expect(migration).toMatch(/existing_lot\.auction_id = p_auction_id[\s\S]*?existing_lot\.player_id = r\.player_id/);
  });

  it('keeps pool population idempotent, ordered, and AVAILABLE-only', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION populate_auction_player_pool/);
    expect(migration).toMatch(/'AVAILABLE'/);
    expect(migration).toMatch(/ROW_NUMBER\(\) OVER \([\s\S]*?eligible\.registered_at NULLS LAST, eligible\.registration_id/);
    expect(migration).toMatch(/ON CONFLICT \(auction_id, player_id\) DO NOTHING/);
    expect(migration).toMatch(/FOR UPDATE/);
  });

  it('prevents direct selection writes and restricts RPC execution to service role', () => {
    expect(migration).toMatch(/ALTER TABLE auction_player_selections ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/FOR INSERT WITH CHECK \(false\)/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION set_auction_player_selection[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION populate_auction_player_pool[\s\S]*TO service_role/);
    expect(migration).toMatch(/is_manager\(p_actor_id\)/);
  });

  it('does not permit changing Icon players out of their locked allocation', () => {
    expect(migration).toMatch(/candidate_type = 'ICON' AND p_selection_status <> 'LOCKED'/);
  });

  it('prevents selection and configuration changes after LIVE starts', () => {
    expect(migration).toMatch(/v_status NOT IN \('DRAFT', 'OPEN'\)/);
    expect(migration).toMatch(/v_auction_status NOT IN \('DRAFT', 'OPEN'\)/);
    expect(migration).toMatch(/Configuration cannot change after budgets or auction activity exist/);
  });

  it('records selection, configuration, and pool changes in auction events', () => {
    expect(migration).toMatch(/'PLAYER_SELECTION_CHANGED'/);
    expect(migration).toMatch(/'AUCTION_CONFIGURATION_CHANGED'/);
    expect(migration).toMatch(/'AUCTION_PLAYER_POOL_POPULATED'/);
    expect(migration).toMatch(/'ADMIN_ACTION'/);
  });

  it('removes stale available lots when a registration is no longer eligible', () => {
    expect(migration).toMatch(/DELETE FROM auction_lots lot[\s\S]*?registration\.registration_status IN \('CONFIRMED', 'PENDING'\)/);
    expect(migration).toMatch(/AND status = 'AVAILABLE'/);
  });

  it('stores auction-specific increments, threshold, and optional maximum bid', () => {
    expect(migration).toMatch(/ADD COLUMN bid_threshold INTEGER/);
    expect(migration).toMatch(/ADD COLUMN maximum_bid INTEGER/);
    expect(migration).toMatch(/SET starting_kitty = p_starting_kitty/);
    expect(migration).toMatch(/low_increment = p_low_increment/);
    expect(migration).toMatch(/maximum_bid = p_maximum_bid/);
  });

  it('allows a manager to update a candidate through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { registration_id: registrationId }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/selections`, {
      method: 'PATCH',
      body: JSON.stringify({
        registrationId,
        selectionStatus: 'EXCLUDED',
        reason: 'Not participating',
      }),
    });

    const response = await updateSelection(request, context);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('set_auction_player_selection', {
      p_auction_id: auctionId,
      p_registration_id: registrationId,
      p_selection_status: 'EXCLUDED',
      p_reason: 'Not participating',
      p_actor_id: actorId,
    });
  });

  it('rejects invalid auction configuration before invoking the RPC', async () => {
    const rpc = vi.fn();
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/configuration`, {
      method: 'PATCH',
      body: JSON.stringify({
        totalKitty: 10000,
        totalPlayersToBuy: 9,
        baseBid: 5000,
        minimumReservePerPlayer: 5000,
        bidThreshold: 20000,
        lowIncrement: 1000,
        highIncrement: 2000,
      }),
    });

    const response = await updateConfiguration(request, context);

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('persists a valid per-auction rules configuration through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { starting_kitty: 90000 }, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/configuration`, {
      method: 'PATCH',
      body: JSON.stringify({
        totalKitty: 90000,
        totalPlayersToBuy: 3,
        baseBid: 5000,
        minimumReservePerPlayer: 10000,
        bidThreshold: 20000,
        lowIncrement: 500,
        highIncrement: 1000,
        maximumBid: 30000,
        allowOwnerSelfPurchase: true,
      }),
    });

    const response = await updateConfiguration(request, context);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('update_auction_configuration_with_self_bid', {
      p_auction_id: auctionId,
      p_actor_id: actorId,
      p_starting_kitty: 90000,
      p_required_players_to_buy: 3,
      p_base_bid: 5000,
      p_minimum_reserve: 10000,
      p_bid_threshold: 20000,
      p_low_increment: 500,
      p_high_increment: 1000,
      p_maximum_bid: 30000,
      p_allow_owner_self_purchase: true,
    });
  });

  it('does not access the service database when a selection request is unauthorized', async () => {
    vi.mocked(requireManager).mockRejectedValue(new Error('Unauthorized: Manager or Admin access required'));
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/selections`, {
      method: 'PATCH',
      body: JSON.stringify({
        registrationId,
        selectionStatus: 'EXCLUDED',
      }),
    });

    const response = await updateSelection(request, context);

    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
