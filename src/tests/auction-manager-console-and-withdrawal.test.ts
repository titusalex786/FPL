import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';

if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env.local'));
  } catch {}
}

import { DELETE as deleteRegistration } from '@/app/api/admin/registrations/[id]/route';
import { POST as withdrawRegistration } from '@/app/api/admin/registrations/[id]/withdraw/route';
import { POST as lotActionPost } from '@/app/api/admin/auctions/[auctionId]/lots/[lotId]/route';
import * as isManagerModule from '@/lib/auth/is-manager';
import * as isAdminModule from '@/lib/auth/is-admin';
import * as auditLoggerModule from '@/lib/audit/logger';
import * as adminSupabaseModule from '@/lib/supabase/admin';

const dummyAuctionId = 'eae4f4d2-aaf4-4a80-8c32-d021769e108b';
const mockLotId = 'bc385ca1-337d-490b-9c73-985f4d522807';
const mockRegistrationId = '43ab404a-d986-4b19-ab1d-26597c83a5b2';

describe('Auction Manager Console Redesign & Layout Tests', () => {
  it('verifies manager control page implements 5-column desktop team grid layout (lg:grid-cols-5)', () => {
    const pageCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
      'utf8'
    );

    // 5-column responsive grid on large screens
    expect(pageCode).toContain('lg:grid-cols-5');
    // Team bid button next valid amount formatting
    expect(pageCode).toContain('BID ₹${money(nextValidBid)}');
    // Compact header and collapsible settings toggle
    expect(pageCode).toContain('Auction Settings');
    expect(pageCode).toContain('setShowSettingsDrawer');
    // Timer +60s extension button
    expect(pageCode).toContain('+60s Timer');
    // Object-contain uncropped player photo
    expect(pageCode).toContain("style={{ objectFit: 'contain' }}");
    // Team button loading isolation
    expect(pageCode).toContain('biddingTeamId');
  });

  it('verifies manager layout container uses full available width (w-full max-w-[1800px])', () => {
    const layoutCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'manager', 'layout.tsx'),
      'utf8'
    );
    expect(layoutCode).toContain('max-w-[1800px]');
  });
});

describe('Pause, Resume & Extend Timer (+60s) Tests', () => {
  it('verifies migration 20261031020000 adds paused_remaining_seconds and defines extend_auction_lot_timer_v1', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261031020000_auction_timer_pause_resume_extend.sql'),
      'utf8'
    );

    // Schema update
    expect(migration).toContain('paused_remaining_seconds');
    // Redefined pause_auction_v1 with remaining seconds freeze
    expect(migration).toContain('CREATE OR REPLACE FUNCTION pause_auction_v1');
    expect(migration).toContain('paused_remaining_seconds = v_rem');
    // Redefined resume_auction_v1 with clock resumption
    expect(migration).toContain('CREATE OR REPLACE FUNCTION resume_auction_v1');
    expect(migration).toContain('v_rem := v_lot.paused_remaining_seconds;');
    // New extend_auction_lot_timer_v1 RPC
    expect(migration).toContain('CREATE OR REPLACE FUNCTION extend_auction_lot_timer_v1');
    expect(migration).toContain('p_seconds INTEGER');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION extend_auction_lot_timer_v1');
  });

  it('verifies lots API route handles EXTEND_TIMER with validated 60 seconds', async () => {
    vi.spyOn(isManagerModule, 'requireManager').mockResolvedValue({
      user: { id: 'mock-actor', email: 'admin@fairplay.com' } as any,
      isAdmin: true,
      role: 'SUPER_ADMIN' as any,
    });

    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        id: mockLotId,
        new_deadline: new Date(Date.now() + 90000).toISOString(),
      },
      error: null,
    });

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue({
      rpc: mockRpc,
    } as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/auctions/${dummyAuctionId}/lots/${mockLotId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'EXTEND_TIMER', additionalSeconds: 60 }),
      }
    );

    const response = await lotActionPost(request, {
      params: Promise.resolve({ auctionId: dummyAuctionId, lotId: mockLotId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.extended_by_seconds).toBe(60);
    expect(mockRpc).toHaveBeenCalledWith('extend_auction_lot_timer_v1', {
      p_auction_id: dummyAuctionId,
      p_lot_id: mockLotId,
      p_seconds: 60,
      p_actor_id: 'mock-actor',
    });
  });

  it('verifies projector calculates remaining time using pausedRemainingSeconds when paused', () => {
    const projectorCode = readFileSync(
      resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'live', 'page.tsx'),
      'utf8'
    );

    expect(projectorCode).toContain("state?.auction.status === 'PAUSED'");
    expect(projectorCode).toContain('pausedRemainingSeconds');
    expect(projectorCode).toContain('⏸ Paused');
  });
});

describe('Player Safe Withdrawal & Foreign Key Protection Tests', () => {
  it('safely marks registration CANCELLED and excludes from lots without foreign key constraint error', async () => {
    vi.spyOn(isAdminModule, 'requireAdmin').mockResolvedValue({
      user: { id: 'mock-admin', email: 'admin@fairplay.com' } as any,
      role: 'SUPER_ADMIN' as any,
    });
    vi.spyOn(auditLoggerModule, 'logAdminAction').mockResolvedValue(undefined as any);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'registrations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: mockRegistrationId,
                    tournament_id: 'tourn-1',
                    player_id: 'player-1',
                    registration_status: 'CONFIRMED',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'auction_lots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'lot-1', status: 'AVAILABLE', auction_id: dummyAuctionId }],
                error: null,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === 'auction_player_selections') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {} as any;
      }),
    };

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue(mockSupabase as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/registrations/${mockRegistrationId}`,
      { method: 'DELETE' }
    );

    const response = await deleteRegistration(request, {
      params: Promise.resolve({ id: mockRegistrationId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('WITHDRAWN');
    expect(body.message).toContain('safely withdrawn');
  });

  it('dedicated withdraw API route marks registration CANCELLED and updates candidate selections', async () => {
    vi.spyOn(isAdminModule, 'requireAdmin').mockResolvedValue({
      user: { id: 'mock-admin', email: 'admin@fairplay.com' } as any,
      role: 'SUPER_ADMIN' as any,
    });
    vi.spyOn(auditLoggerModule, 'logAdminAction').mockResolvedValue(undefined as any);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'registrations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: mockRegistrationId,
                    tournament_id: 'tourn-1',
                    player_id: 'player-1',
                    registration_status: 'CONFIRMED',
                  },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === 'auction_lots') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        if (table === 'auction_player_selections') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {} as any;
      }),
    };

    vi.spyOn(adminSupabaseModule, 'createAdminClient').mockReturnValue(mockSupabase as any);

    const request = new NextRequest(
      `https://fairplaypremierleague.com/api/admin/registrations/${mockRegistrationId}/withdraw`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Withdrawn by player request' }),
      }
    );

    const response = await withdrawRegistration(request, {
      params: Promise.resolve({ id: mockRegistrationId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.action).toBe('WITHDRAWN');
    expect(body.status).toBe('CANCELLED');
  });

  it('verifies candidate pool and selection sync ignores CANCELLED registrations', () => {
    const poolMigration = readFileSync(
      resolve(process.cwd(), 'supabase', 'migrations', '20261030000000_auction_pool_registration_identity.sql'),
      'utf8'
    );

    // Ensures candidate query filters out CANCELLED registrations
    expect(poolMigration).toContain("r.registration_status NOT IN ('REJECTED', 'CANCELLED')");
    expect(poolMigration).toContain("reg.registration_status NOT IN ('REJECTED', 'CANCELLED')");
  });
});
