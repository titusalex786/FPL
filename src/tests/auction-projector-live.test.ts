import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/auctions/[auctionId]/live-state/route';
import { createAdminClient } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const projectorPageSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'auction', '[auctionId]', 'live', 'page.tsx'),
  'utf8'
);
const liveStateRouteSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'auctions', '[auctionId]', 'live-state', 'route.ts'),
  'utf8'
);

const auctionId = '20000000-0000-4000-8000-000000000001';
const tournamentId = '30000000-0000-4000-8000-000000000001';
const teamOwnerId = '40000000-0000-4000-8000-000000000001';
const request = new NextRequest(`http://localhost/api/auctions/${auctionId}/live-state`);
const context = { params: Promise.resolve({ auctionId }) };

function mockQuery(data: unknown, error: unknown = null) {
  const response = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'in']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response));
  builder.then = (
    res: (value: typeof response) => unknown,
    rej: (reason: unknown) => unknown
  ) => Promise.resolve(response).then(res, rej);
  return builder;
}

function setupClient(options?: {
  auction?: Record<string, unknown> | null;
  tournament?: Record<string, unknown> | null;
  lots?: unknown[];
  rounds?: unknown[];
  owners?: unknown[];
}) {
  const responses: Record<string, unknown> = {
    auctions:
      options?.auction !== undefined
        ? options.auction
        : {
            id: auctionId,
            auction_name: 'FPL 4th Anniversary Auction',
            tournament_id: tournamentId,
            status: 'LIVE',
            base_bid: 5000,
            bid_timer_seconds: 30,
          },
    tournaments:
      options?.tournament !== undefined
        ? options.tournament
        : {
            id: tournamentId,
            name: 'FPL Season 4',
          },
    auction_lots: options?.lots || [],
    auction_rounds: options?.rounds || [],
    team_owners: options?.owners || [],
  };

  const from = vi.fn((table: string) =>
    mockQuery(table in responses ? responses[table] : [])
  );
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return from;
}

describe('Projector Live State API — GET /api/auctions/[auctionId]/live-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid auction UUID with status 400', async () => {
    const res = await GET(request, { params: Promise.resolve({ auctionId: 'not-a-uuid' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid auction ID');
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 404 when the requested auction does not exist', async () => {
    setupClient({ auction: null });
    const res = await GET(request, context);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Auction not found');
  });

  it('serves live lot, leading team name, and round info without private budgets', async () => {
    setupClient({
      lots: [
        {
          id: 'lot-1',
          lot_number: 1,
          status: 'LIVE',
          current_highest_bid: 25000,
          current_highest_team_owner_id: teamOwnerId,
          winning_team_owner_id: null,
          sold_amount: null,
          sold_at: null,
          bid_deadline_at: new Date(Date.now() + 25000).toISOString(),
          round_id: 'round-1',
          round: { round_number: 1, round_type: 'MAIN' },
          player: {
            id: 'player-1',
            full_name: 'Rohit Sharma',
            profile_image_url: 'https://images.fpl.com/rohit.jpg',
            cricket_role: 'BATSMAN',
            batting_style: 'RIGHT_HAND',
          },
          registration: {
            registered_name_snapshot: 'Rohit Sharma',
            registered_role_snapshot: 'BATSMAN',
            registered_batting_style_snapshot: 'RIGHT_HAND',
          },
        },
      ],
      rounds: [{ id: 'round-1', round_number: 1, round_type: 'MAIN', status: 'LIVE' }],
      owners: [{ id: teamOwnerId, team_name: 'Mumbai Strikers', owner_name: 'R. Ambani', team_logo_url: null }],
    });

    const res = await GET(request, context);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const json = await res.json();
    expect(json.auction.status).toBe('LIVE');
    expect(json.liveLot).not.toBeNull();
    expect(json.liveLot.currentBid).toBe(25000);
    expect(json.liveLot.currentTeamName).toBe('Mumbai Strikers');
    expect(json.liveLot.player.name).toBe('Rohit Sharma');
    expect(json.liveLot.player.role).toBe('BATSMAN');

    // Strict privacy assurance: budgets and purchases are never returned
    expect(json.liveLot.remainingKitty).toBeUndefined();
    expect(json.liveLot.budgetUsedPercent).toBeUndefined();
    expect(json.teams).toBeUndefined();
    expect(json.budgets).toBeUndefined();
  });

  it('masks database errors with generic 500 error', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => mockQuery(null, { message: 'db internal err', code: '50000' })),
    } as never);

    const res = await GET(request, context);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Unable to load live auction state');
  });
});

describe('Projector Public Screen — /auction/[auctionId]/live UI Source Audit', () => {
  it('connects to real-time sync with fallback polling', () => {
    expect(projectorPageSource).toContain('useAuctionRealtime');
    expect(projectorPageSource).toContain('/api/auctions/${auctionId}/live-state');
  });

  it('renders prominent current bid and player visual details', () => {
    expect(projectorPageSource).toContain('currentBid');
    expect(projectorPageSource).toContain('currentTeamName');
    expect(projectorPageSource).toContain('TimerRing');
    expect(projectorPageSource).toContain('recentlySold');
  });

  it('does not leak or import private team budget structures', () => {
    expect(projectorPageSource).not.toContain('startingKitty');
    expect(projectorPageSource).not.toContain('remainingKitty');
    expect(projectorPageSource).not.toContain('maximumAffordableCurrentBid');
    expect(liveStateRouteSource).not.toContain('starting_kitty');
    expect(liveStateRouteSource).not.toContain('remaining_kitty');
  });
});
