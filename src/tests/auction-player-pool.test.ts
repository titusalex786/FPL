import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/admin/auctions/[auctionId]/pool/route';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/auth/is-manager', () => ({
  requireManager: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase',
    'migrations',
    '20261019000000_phase_a3_auction_player_pool.sql'
  ),
  'utf8'
);

const auctionId = '10000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';

describe('Phase A3 auction player pool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireManager).mockResolvedValue({
      user: { id: actorId } as never,
      isAdmin: true,
      role: 'ADMIN' as never,
    });
  });

  it('includes active PLAYER registrations belonging to the auction tournament', () => {
    expect(migration).toMatch(/r\.tournament_id = v_tournament_id/);
    expect(migration).toMatch(/r\.registration_status IN \('CONFIRMED', 'PENDING'\)/);
    expect(migration).toMatch(/r\.registration_type = 'PLAYER'/);
  });

  it('excludes owner and icon registrations using existing identity references', () => {
    expect(migration).toMatch(/owner_team\.player_id = r\.player_id/);
    expect(migration).toMatch(/owner_team\.owner_registration_id = r\.id/);
    expect(migration).toMatch(/owner_team\.icon_registration_id = r\.id/);
    expect(migration).not.toMatch(/full_name\s*=|owner_name\s*=|contact_email\s*=/i);
  });

  it('excludes rejected, cancelled, waitlisted, and other non-active statuses', () => {
    expect(migration).toMatch(/registration_status IN \('CONFIRMED', 'PENDING'\)/);
    expect(migration).not.toMatch(/registration_status\s+IN\s*\([^)]*REJECTED/i);
    expect(migration).not.toMatch(/registration_status\s+IN\s*\([^)]*CANCELLED/i);
  });

  it('excludes players already purchased in the auction', () => {
    expect(migration).toMatch(/FROM auction_purchases purchase[\s\S]*?purchase\.auction_id = p_auction_id[\s\S]*?purchase\.player_id = r\.player_id/);
  });

  it('excludes players that already have a lot in the auction', () => {
    expect(migration).toMatch(/FROM auction_lots existing_lot[\s\S]*?existing_lot\.auction_id = p_auction_id[\s\S]*?existing_lot\.player_id = r\.player_id/);
    expect(migration).toMatch(/ON CONFLICT \(auction_id, player_id\) DO NOTHING/);
  });

  it('creates only AVAILABLE lots with deterministic, unique lot numbers', () => {
    expect(migration).toMatch(/'AVAILABLE'/);
    expect(migration).toMatch(/ROW_NUMBER\(\) OVER \([\s\S]*?ORDER BY eligible\.registered_at NULLS LAST, eligible\.registration_id/);
    expect(migration).toMatch(/ADD CONSTRAINT unique_auction_lot_number UNIQUE \(auction_id, lot_number\)/);
  });

  it('serializes repeated population and appends after existing lot numbers', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_auction_id::TEXT, 0\)\)/);
    expect(migration).toMatch(/COALESCE\(MAX\(lot_number\), 0\)/);
    expect(migration).toMatch(/NOT EXISTS[\s\S]*?FROM auction_lots existing_lot/);
  });

  it('rejects a missing auction and requires DB-backed manager authorization', () => {
    expect(migration).toMatch(/IF p_actor_id IS NULL OR NOT is_manager\(p_actor_id\)/);
    expect(migration).toMatch(/IF NOT FOUND THEN[\s\S]*?Auction not found/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION populate_auction_player_pool\(UUID, UUID\) FROM PUBLIC/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION populate_auction_player_pool\(UUID, UUID\) FROM anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION populate_auction_player_pool\(UUID, UUID\) TO service_role/);
  });

  it('rejects unauthenticated pool reads and mutations before using the admin client', async () => {
    vi.mocked(requireManager).mockRejectedValue(new Error('Unauthorized: Manager or Admin access required'));
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/pool`);
    const context = { params: Promise.resolve({ auctionId }) };

    const getResponse = await GET(request, context);
    const postResponse = await POST(request, context);

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('allows an authorized admin to populate through the protected RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/pool`, {
      method: 'POST',
    });

    const response = await POST(request, { params: Promise.resolve({ auctionId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, insertedCount: 3 });
    expect(rpc).toHaveBeenCalledWith('populate_auction_player_pool', {
      p_auction_id: auctionId,
      p_actor_id: actorId,
    });
  });

  it('returns the authorized pool ordered by lot number', async () => {
    const lots = [{ id: 'lot-1', lot_number: 1, status: 'AVAILABLE' }];
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: auctionId }, error: null }),
      then: (resolvePromise: (result: { data: typeof lots; error: null }) => unknown) =>
        Promise.resolve({ data: lots, error: null }).then(resolvePromise),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn().mockReturnValue(query),
    } as never);
    const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/pool`);

    const response = await GET(request, { params: Promise.resolve({ auctionId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lots: [{ ...lots[0], current_team: null }],
    });
    expect(query.order).toHaveBeenCalledWith('lot_number', { ascending: true });
  });

  it('rejects malformed auction IDs without calling the database', async () => {
    const request = new NextRequest('http://localhost/api/admin/auctions/not-a-uuid/pool');
    const response = await POST(request, { params: Promise.resolve({ auctionId: 'not-a-uuid' }) });

    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
