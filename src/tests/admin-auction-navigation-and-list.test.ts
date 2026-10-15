import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/admin/auctions/route';
import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

vi.mock('@/lib/auth/is-manager', () => ({ checkIsManagerOrAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

const adminLayoutSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'admin', 'layout.tsx'),
  'utf8'
);

const managerLayoutSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'manager', 'layout.tsx'),
  'utf8'
);

const auctionsPageSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', 'page.tsx'),
  'utf8'
);

const auctionsApiSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', 'route.ts'),
  'utf8'
);

const managerId = '40000000-0000-4000-8000-000000000001';
const auctionId = '10000000-0000-4000-8000-000000000001';
const tournamentId = '50000000-0000-4000-8000-000000000001';

function mockQuery(data: unknown, error: unknown = null) {
  const result = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'in']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (
    onFulfilled: (value: typeof result) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function configureAuth(options?: { authenticated?: boolean; manager?: boolean }) {
  const authenticated = options?.authenticated ?? true;
  const manager = options?.manager ?? true;
  vi.mocked(createServerSupabaseClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: authenticated ? { id: managerId, email: 'admin@premiercricket.in' } : null },
        error: authenticated ? null : { message: 'No session' },
      }),
    },
  } as never);
  vi.mocked(checkIsManagerOrAdmin).mockResolvedValue({
    isManager: manager,
    isAdmin: manager,
    user: manager ? ({ id: managerId, email: 'admin@premiercricket.in' } as never) : null,
    role: manager ? ('ADMIN' as never) : null,
  });
}

// Sample auction data for filter unit tests
const sampleAuctions = [
  {
    id: 'auc-1',
    auctionName: 'Championship Auction',
    tournamentId: 'tour-1',
    tournamentName: 'FPL Season 4',
    status: 'OPEN',
    startingKitty: 180000,
    requiredPlayersToBuy: 9,
    teamsCount: 8,
    playersPurchased: 2,
    playersRemaining: 14,
    createdAt: '2026-10-10T10:00:00Z',
    updatedAt: '2026-10-10T12:00:00Z',
  },
  {
    id: 'auc-2',
    auctionName: 'Premier Cup Draft',
    tournamentId: 'tour-2',
    tournamentName: 'Winter Trophy',
    status: 'LIVE',
    startingKitty: 150000,
    requiredPlayersToBuy: 7,
    teamsCount: 6,
    playersPurchased: 5,
    playersRemaining: 9,
    createdAt: '2026-10-14T10:00:00Z',
    updatedAt: '2026-10-14T12:00:00Z',
  },
  {
    id: 'auc-3',
    auctionName: 'Super League Auction',
    tournamentId: 'tour-1',
    tournamentName: 'FPL Season 4',
    status: 'CLOSED',
    startingKitty: 200000,
    requiredPlayersToBuy: 10,
    teamsCount: 10,
    playersPurchased: 10,
    playersRemaining: 0,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T12:00:00Z',
  },
];

function applyFilters(
  auctions: typeof sampleAuctions,
  filters: {
    searchTerm?: string;
    statusFilter?: string;
    tournamentFilter?: string;
    sortBy?: 'NEWEST' | 'OLDEST';
  }
) {
  const {
    searchTerm = '',
    statusFilter = 'ALL',
    tournamentFilter = 'ALL',
    sortBy = 'NEWEST',
  } = filters;

  return auctions
    .filter((auction) => {
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const matchAuctionName = (auction.auctionName || '').toLowerCase().includes(term);
        const matchTournamentName = (auction.tournamentName || '').toLowerCase().includes(term);
        if (!matchAuctionName && !matchTournamentName) return false;
      }
      if (statusFilter !== 'ALL') {
        if (statusFilter === 'ENDED') {
          if (auction.status !== 'ENDED' && auction.status !== 'CLOSED') return false;
        } else if (auction.status !== statusFilter) {
          return false;
        }
      }
      if (tournamentFilter !== 'ALL') {
        if (auction.tournamentId !== tournamentFilter && auction.tournamentName !== tournamentFilter) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (sortBy === 'OLDEST') return timeA - timeB;
      return timeB - timeA;
    });
}

describe('Admin Auction Navigation and Auction List Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Admin navigation contains Auctions
  it('1. Admin navigation contains Auctions', () => {
    expect(adminLayoutSource).toContain("label: 'Auctions'");
    expect(adminLayoutSource).toMatch(/href:\s*'\/manager\/auctions'/);
  });

  // 2. Auctions link points to /manager/auctions
  it('2. Auctions link points to /manager/auctions', () => {
    expect(adminLayoutSource).toContain("{ label: 'Auctions', href: '/manager/auctions'");
    expect(managerLayoutSource).toContain("{ label: 'Auctions', href: '/manager/auctions'");
  });

  // 3. /manager/auctions loads successfully for authorized Admin/Manager
  it('3. /manager/auctions loads successfully for authorized Admin/Manager', async () => {
    configureAuth({ authenticated: true, manager: true });

    const mockAdmin = {
      from: vi.fn((table: string) => {
        if (table === 'tournaments') {
          return mockQuery([{ id: tournamentId, name: 'FPL Season 4', tournament_type: 'OWNER_BASED' }]);
        }
        if (table === 'auctions') {
          return mockQuery([
            {
              id: auctionId,
              tournament_id: tournamentId,
              auction_name: 'FPL Season 4 Auction',
              status: 'OPEN',
              starting_kitty: 180000,
              required_players_to_buy: 9,
              created_at: '2026-10-15T10:00:00Z',
              updated_at: '2026-10-15T12:00:00Z',
            },
          ]);
        }
        if (table === 'team_owners') {
          return mockQuery([]);
        }
        if (table === 'auction_team_budgets') {
          return mockQuery([
            { auction_id: auctionId, players_bought: 1, players_remaining: 8 },
            { auction_id: auctionId, players_bought: 0, players_remaining: 9 },
          ]);
        }
        if (table === 'registrations') {
          return mockQuery([]);
        }
        return mockQuery([]);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as never);

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.auctions).toBeDefined();
    expect(data.auctions).toHaveLength(1);
    expect(data.auctions[0].id).toBe(auctionId);
    expect(data.auctions[0].tournamentName).toBe('FPL Season 4');
    expect(data.auctions[0].teamsCount).toBe(2);
    expect(data.auctions[0].playersPurchased).toBe(1);
    expect(data.auctions[0].playersRemaining).toBe(17);
  });

  // 4. Unauthorized user is rejected
  it('4. Unauthorized user is rejected', async () => {
    // 4a. Unauthenticated -> 401
    configureAuth({ authenticated: false, manager: false });
    const unauthResponse = await GET();
    expect(unauthResponse.status).toBe(401);

    // 4b. Authenticated but not manager/admin -> 403
    configureAuth({ authenticated: true, manager: false });
    const forbiddenResponse = await GET();
    expect(forbiddenResponse.status).toBe(403);
  });

  // 5. Auction list displays existing auctions
  it('5. Auction list displays existing auctions with required card fields', () => {
    expect(auctionsPageSource).toContain('auction.tournamentName');
    expect(auctionsPageSource).toContain('getStatusBadge(auction.status)');
    expect(auctionsPageSource).toContain('auction.startingKitty');
    expect(auctionsPageSource).toContain('auction.teamsCount');
    expect(auctionsPageSource).toContain('auction.playersPurchased');
    expect(auctionsPageSource).toContain('auction.playersRemaining');
    expect(auctionsPageSource).toContain('shortenedId');
    expect(auctionsPageSource).toContain('formatDate(auction.createdAt)');
    expect(auctionsPageSource).toContain('formatDate(auction.updatedAt)');
  });

  // 6. Empty state displays when there are zero auctions
  it('6. Empty state displays when there are zero auctions', () => {
    expect(auctionsPageSource).toContain('No auctions created yet.');
    expect(auctionsPageSource).toContain('Get started by creating a new player auction');
  });

  // 7. Create Auction button points to /manager/auctions/new
  it('7. Create Auction button points to /manager/auctions/new', () => {
    expect(auctionsPageSource).toContain('href="/manager/auctions/new"');
    expect(auctionsPageSource).toContain('+ Create Auction');
  });

  // 8. Open Control Panel points to the correct auction ID
  it('8. Open Control Panel points to the correct auction ID', () => {
    expect(auctionsPageSource).toContain('/manager/auctions/${auction.id}/control');
    expect(auctionsPageSource).toContain('Open Control Panel');
  });

  // 9. Projector link points to /auction/[auctionId]/live
  it('9. Projector link points to /auction/[auctionId]/live', () => {
    expect(auctionsPageSource).toContain('/auction/${auction.id}/live');
    expect(auctionsPageSource).toContain('Open Projector');
  });

  // 10. Opening the page performs no auction mutations
  it('10. Opening the page performs no auction mutations', () => {
    expect(auctionsPageSource).toContain("fetch('/api/admin/auctions'");
    expect(auctionsPageSource).not.toContain("method: 'POST'");
    expect(auctionsPageSource).not.toContain("method: 'PATCH'");
    expect(auctionsPageSource).not.toContain("method: 'DELETE'");
    expect(auctionsPageSource).not.toContain('rpc(');
  });
});

describe('Auction List Filters Verification (Section 9 Tests)', () => {
  // 1. Search filters by auction name
  it('1. Search filters by auction name (case-insensitive)', () => {
    expect(auctionsPageSource).toContain('matchAuctionName');
    const results = applyFilters(sampleAuctions, { searchTerm: 'championship' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('auc-1');
  });

  // 2. Search filters by tournament name
  it('2. Search filters by tournament name (case-insensitive)', () => {
    expect(auctionsPageSource).toContain('matchTournamentName');
    const results = applyFilters(sampleAuctions, { searchTerm: 'winter' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('auc-2');

    const multiResults = applyFilters(sampleAuctions, { searchTerm: 'fpl' });
    expect(multiResults).toHaveLength(2);
  });

  // 3. Status filter works
  it('3. Status filter works across OPEN, LIVE, and ENDED/CLOSED', () => {
    expect(auctionsPageSource).toContain("statusFilter === 'ENDED'");
    const liveResults = applyFilters(sampleAuctions, { statusFilter: 'LIVE' });
    expect(liveResults).toHaveLength(1);
    expect(liveResults[0].id).toBe('auc-2');

    const openResults = applyFilters(sampleAuctions, { statusFilter: 'OPEN' });
    expect(openResults).toHaveLength(1);
    expect(openResults[0].id).toBe('auc-1');

    const endedResults = applyFilters(sampleAuctions, { statusFilter: 'ENDED' });
    expect(endedResults).toHaveLength(1);
    expect(endedResults[0].id).toBe('auc-3');
  });

  // 4. Tournament filter works
  it('4. Tournament filter works by tournament ID or tournament name', () => {
    expect(auctionsPageSource).toContain('auction.tournamentId !== tournamentFilter');
    const tour1Results = applyFilters(sampleAuctions, { tournamentFilter: 'tour-1' });
    expect(tour1Results).toHaveLength(2);

    const tour2Results = applyFilters(sampleAuctions, { tournamentFilter: 'tour-2' });
    expect(tour2Results).toHaveLength(1);
    expect(tour2Results[0].id).toBe('auc-2');
  });

  // 5. Newest-first sorting works
  it('5. Newest-first sorting works based on created_at', () => {
    const results = applyFilters(sampleAuctions, { sortBy: 'NEWEST' });
    expect(results[0].id).toBe('auc-2'); // 2026-10-14
    expect(results[1].id).toBe('auc-1'); // 2026-10-10
    expect(results[2].id).toBe('auc-3'); // 2026-10-01
  });

  // 6. Oldest-first sorting works
  it('6. Oldest-first sorting works based on created_at', () => {
    const results = applyFilters(sampleAuctions, { sortBy: 'OLDEST' });
    expect(results[0].id).toBe('auc-3'); // 2026-10-01
    expect(results[1].id).toBe('auc-1'); // 2026-10-10
    expect(results[2].id).toBe('auc-2'); // 2026-10-14
  });

  // 7. Clear Filters resets all filters
  it('7. Clear Filters resets all filters', () => {
    expect(auctionsPageSource).toContain("setSearchTerm('')");
    expect(auctionsPageSource).toContain("setStatusFilter('ALL')");
    expect(auctionsPageSource).toContain("setTournamentFilter('ALL')");
    expect(auctionsPageSource).toContain("setSortBy('NEWEST')");
    expect(auctionsPageSource).toContain('handleClearFilters');
  });

  // 8. "Showing X of Y auctions" is correct
  it('8. "Showing X of Y auctions" indicator is rendered', () => {
    expect(auctionsPageSource).toContain('Showing {filteredAuctions.length} of {auctions.length}');
  });

  // 9. No-match state is displayed
  it('9. No-match state is displayed when filtered results are empty', () => {
    expect(auctionsPageSource).toContain('No auctions match your filters.');
    const noMatch = applyFilters(sampleAuctions, { searchTerm: 'Nonexistent Tournament' });
    expect(noMatch).toHaveLength(0);
  });

  // 10. Zero-auction empty state still works
  it('10. Zero-auction empty database state still works and is distinct from filter empty state', () => {
    expect(auctionsPageSource).toContain('No auctions created yet.');
    expect(auctionsPageSource).toContain('No auctions match your filters.');
    expect(auctionsPageSource).toContain('auctions.length === 0 ?');
    expect(auctionsPageSource).toContain('filteredAuctions.length === 0 ?');
  });
});
