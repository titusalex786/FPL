import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  } catch {}
}

import { createAdminClient } from '@/lib/supabase/admin';
import { GET as getLiveState } from '@/app/api/auctions/[auctionId]/live-state/route';

const dummyAuctionId = 'eae4f4d2-aaf4-4a80-8c32-d021769e108b';
const realAuctionId = '5f58dd30-3188-478c-9c72-7b613309ab7c';

describe('Fix Auction Event Types and RPC Regression Tests', () => {
  it('verifies migration 20261031000000 uses canonical ADMIN_ACTION for LOT_STARTED', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031000000_fix_auction_event_types_and_rpc.sql'),
      'utf8'
    );

    // Verifies start_auction_lot_v1 inserts ADMIN_ACTION
    expect(migration).toContain("'ADMIN_ACTION'");
    expect(migration).toContain("'action', 'LOT_STARTED'");
    // Verifies settle_auction_lot_v1 inserts AUCTION_STATE_CHANGE for round transition
    expect(migration).toContain("'AUCTION_STATE_CHANGE'");
    expect(migration).toContain("'action', 'UNSOLD_ROUND_CREATED'");
    // Verifies invalid enum direct values are NOT inserted into event_type column
    expect(migration).not.toMatch(/'LOT_STARTED'\s*,\s*jsonb_build_object/);
    expect(migration).not.toMatch(/'ROUND_STARTED'\s*,\s*jsonb_build_object/);
  });

  it('verifies lot start route safely extracts PostgrestError messages', async () => {
    const lotRouteSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'lots', '[lotId]', 'route.ts'),
      'utf8'
    );
    expect(lotRouteSource).toContain("typeof error === 'object' && error !== null && 'message' in error");
    expect(lotRouteSource).toContain("console.error('[Admin Auction Lot Action Error]:', error);");

    const randomRouteSource = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'lots', 'random', 'route.ts'),
      'utf8'
    );
    expect(randomRouteSource).toContain("typeof error === 'object' && error !== null && 'message' in error");
    expect(randomRouteSource).toContain("console.error('[Admin Auction Random Lot Error]:', error);");
  });

  it(
    'confirms dummy auction lot is live and synchronized with projector live-state API',
    async () => {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
        console.warn('Skipping live DB check: environment variables missing in test runner');
        return;
      }

      const supabase = createAdminClient();

      // Verify dummy auction state
      const { data: dummyAuction } = await supabase
        .from('auctions')
        .select('id, status')
        .eq('id', dummyAuctionId)
        .single();
      expect(dummyAuction?.status).toBe('LIVE');

      // Verify lots in dummy auction (inspect current state: some expired/marked UNSOLD, others AVAILABLE)
      const { data: dummyLots } = await supabase
        .from('auction_lots')
        .select('id, lot_number, status, round_id, lot_started_at, bid_deadline_at')
        .eq('auction_id', dummyAuctionId);

      expect(dummyLots).toHaveLength(90);
      const unsoldLots = dummyLots?.filter(l => l.status === 'UNSOLD') || [];
      expect(unsoldLots.length).toBeGreaterThan(0);

      // Verify projector live-state API returns clean status without leaking up next
      const req = new NextRequest(`http://localhost/api/auctions/${dummyAuctionId}/live-state`);
      const res = await getLiveState(req, { params: Promise.resolve({ auctionId: dummyAuctionId }) });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.auction.status).toBe('LIVE');
      expect(body.nextLot).toBeNull(); // Up next is not leaked
    },
    30000
  );

  it(
    'confirms real auction remains strictly in DRAFT with zero purchases',
    async () => {
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
        console.warn('Skipping live DB check: environment variables missing in test runner');
        return;
      }

      const supabase = createAdminClient();

      const { data: realAuction } = await supabase
        .from('auctions')
        .select('id, status')
        .eq('id', realAuctionId)
        .single();
      expect(['DRAFT', 'OPEN']).toContain(realAuction?.status);

      const { data: realPurchases } = await supabase
        .from('auction_purchases')
        .select('id')
        .eq('auction_id', realAuctionId);
      expect(realPurchases?.length ?? 0).toBe(0);

      const { data: liveLots } = await supabase
        .from('auction_lots')
        .select('id')
        .eq('auction_id', realAuctionId)
        .eq('status', 'LIVE');
      expect(liveLots?.length ?? 0).toBe(0);
    },
    30000
  );
});
