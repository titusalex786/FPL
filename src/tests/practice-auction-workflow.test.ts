import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/auth/is-manager', () => ({
  checkIsManagerOrAdmin: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { POST as cleanupPOST } from '@/app/api/admin/auctions/[auctionId]/practice-cleanup/route';
import { GET as baselineGET } from '@/app/api/admin/auctions/practice/baseline/route';

describe('Safe Disposable Practice Auction Workflow', () => {
  const practiceAuctionId = 'c8b9d31e-4567-4890-a123-abcdef012345';
  const realAuctionId = 'd9c0e42f-5678-4901-b234-bcdef0123456';
  const managerUserId = 'e0d1f53a-6789-4012-c345-cdef01234567';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default authorized manager
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: managerUserId, email: 'admin@fpl.com' } },
          error: null,
        }),
      },
    } as never);

    vi.mocked(checkIsManagerOrAdmin).mockResolvedValue({
      isManager: true,
      isAdmin: true,
      role: 'ADMIN',
      user: { id: managerUserId, email: 'admin@fpl.com' } as never,
    });
  });

  it('1. Captures database baseline for the 9 specified tables', async () => {
    const mockQuery = (count: number) => ({
      select: vi.fn().mockReturnValue({
        count,
        error: null,
      }),
    });

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'auctions') return mockQuery(0);
        if (table === 'auction_lots') return mockQuery(0);
        if (table === 'auction_purchases') return mockQuery(0);
        if (table === 'auction_events') return mockQuery(0);
        if (table === 'auction_team_budgets') return mockQuery(0);
        if (table === 'players') return mockQuery(164);
        if (table === 'registrations') return mockQuery(100);
        if (table === 'payments') return mockQuery(90);
        if (table === 'team_owners') return mockQuery(10);
        return mockQuery(0);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

    const res = await baselineGET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.baseline).toEqual({
      auctions: 0,
      auction_lots: 0,
      auction_purchases: 0,
      auction_events: 0,
      auction_team_budgets: 0,
      players: 164,
      registrations: 100,
      payments: 90,
      team_owners: 10,
    });
  });

  it('2. Practice Cleanup rejects non-practice real auctions', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: realAuctionId,
                auction_name: 'FPL Official Real Auction',
                status: 'OPEN',
              },
              error: null,
            }),
          }),
        }),
      })),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

    const req = new NextRequest(`http://localhost/api/admin/auctions/${realAuctionId}/practice-cleanup`, {
      method: 'POST',
    });
    const res = await cleanupPOST(req, { params: Promise.resolve({ auctionId: realAuctionId }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Only practice auctions');
  });

  it('3. Practice Cleanup STOPS and aborts if any protected-table count changed', async () => {
    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'auctions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: practiceAuctionId,
                    auction_name: '[PRACTICE] FPL Test Auction',
                    status: 'OPEN',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        // Simulate a mismatch in registrations (e.g. 99 instead of 100)
        if (table === 'registrations') {
          return {
            select: vi.fn().mockReturnValue({ count: 99, error: null }),
          };
        }
        if (table === 'players') {
          return {
            select: vi.fn().mockReturnValue({ count: 164, error: null }),
          };
        }
        if (table === 'payments') {
          return {
            select: vi.fn().mockReturnValue({ count: 90, error: null }),
          };
        }
        if (table === 'team_owners') {
          return {
            select: vi.fn().mockReturnValue({ count: 10, error: null }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({ count: 0, error: null }),
        };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

    const req = new NextRequest(`http://localhost/api/admin/auctions/${practiceAuctionId}/practice-cleanup`, {
      method: 'POST',
    });
    const res = await cleanupPOST(req, { params: Promise.resolve({ auctionId: practiceAuctionId }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('PROTECTED_DATA_MISMATCH');
    expect(body.current.registrations).toBe(99);
  });

  it('4. Practice Cleanup deletes ONLY practice auction records and verifies 0 orphans', async () => {
    const deletedTables: string[] = [];

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'auctions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: practiceAuctionId,
                    auction_name: '[PRACTICE] FPL Season 4 Auction',
                    status: 'OPEN',
                  },
                  error: null,
                }),
                count: 0,
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col, val) => {
                deletedTables.push(
                  'auctions',
                  'auction_lots',
                  'auction_purchases',
                  'auction_events',
                  'auction_rounds',
                  'auction_player_selections',
                  'auction_team_budgets'
                );
                return Promise.resolve({ error: null });
              }),
            }),
          };
        }

        // Child auction tables
        if ([
          'auction_lots',
          'auction_purchases',
          'auction_events',
          'auction_rounds',
          'auction_player_selections',
          'auction_team_budgets',
        ].includes(table)) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation(() => {
                const isDeleted = deletedTables.includes(table);
                return {
                  count: isDeleted ? 0 : (table === 'auction_lots' ? 85 : 10),
                  error: null,
                };
              }),
            }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col, val) => {
                deletedTables.push(table);
                return Promise.resolve({ error: null });
              }),
            }),
          };
        }

        // Protected tables
        if (table === 'players') return { select: vi.fn().mockReturnValue({ count: 164, error: null }) };
        if (table === 'registrations') return { select: vi.fn().mockReturnValue({ count: 100, error: null }) };
        if (table === 'payments') return { select: vi.fn().mockReturnValue({ count: 90, error: null }) };
        if (table === 'team_owners') return { select: vi.fn().mockReturnValue({ count: 10, error: null }) };

        return { select: vi.fn().mockReturnValue({ count: 0, error: null }) };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

    const req = new NextRequest(`http://localhost/api/admin/auctions/${practiceAuctionId}/practice-cleanup`, {
      method: 'POST',
    });
    const res = await cleanupPOST(req, { params: Promise.resolve({ auctionId: practiceAuctionId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.practiceAuctionId).toBe(practiceAuctionId);
    expect(body.protectedDataUnchanged).toBe(true);
    expect(body.orphanRecords).toBe(0);

    // Verify ONLY auction tables were deleted
    expect(deletedTables).toContain('auction_purchases');
    expect(deletedTables).toContain('auction_events');
    expect(deletedTables).toContain('auction_lots');
    expect(deletedTables).toContain('auction_player_selections');
    expect(deletedTables).toContain('auction_rounds');
    expect(deletedTables).toContain('auction_team_budgets');
    expect(deletedTables).toContain('auctions');

    // Verify protected tables were NEVER deleted
    expect(deletedTables).not.toContain('players');
    expect(deletedTables).not.toContain('registrations');
    expect(deletedTables).not.toContain('payments');
    expect(deletedTables).not.toContain('team_owners');
  });
});
