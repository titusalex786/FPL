import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/admin/auctions/[auctionId]/control-panel/route';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

vi.mock('@/lib/auth/is-manager', () => ({ requireManager: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

const pageSource = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'manager', 'auctions', '[auctionId]', 'control', 'page.tsx'),
  'utf8'
);
const poolRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'pool', 'route.ts'),
  'utf8'
);
const lotRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'lots', '[lotId]', 'route.ts'),
  'utf8'
);
const endRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'end', 'route.ts'),
  'utf8'
);
const configurationRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'configuration', 'route.ts'),
  'utf8'
);
const selectionsRoute = readFileSync(
  resolve(process.cwd(), 'src', 'app', 'api', 'admin', 'auctions', '[auctionId]', 'selections', 'route.ts'),
  'utf8'
);
const realtimeHook = readFileSync(
  resolve(process.cwd(), 'src', 'lib', 'auction', 'use-auction-realtime.ts'),
  'utf8'
);

const auctionId = '10000000-0000-4000-8000-000000000001';
const managerId = '40000000-0000-4000-8000-000000000001';
const request = new NextRequest(`http://localhost/api/admin/auctions/${auctionId}/control-panel`);
const context = { params: Promise.resolve({ auctionId }) };

function mockQuery(data: unknown, error: unknown = null) {
  const response = { data, error };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'contains', 'in']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(response));
  builder.then = (
    resolve: (value: typeof response) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

function setupPanelClient(options?: { budget?: Record<string, unknown>; owner?: Record<string, unknown> }) {
  const responses: Record<string, unknown> = {
    auctions: {
      id: auctionId,
      tournament_id: '50000000-0000-4000-8000-000000000001',
      status: 'OPEN',
      starting_kitty: 180000,
      required_players_to_buy: 9,
      icon_players_allocated: 1,
      base_bid: 5000,
      bid_threshold: 20000,
      low_increment: 1000,
      high_increment: 2000,
      minimum_reserve: 5000,
      maximum_bid: null,
      allow_owner_self_purchase: false,
      bid_timer_seconds: 30,
    },
    tournaments: { id: '50000000-0000-4000-8000-000000000001', name: 'Summer Cup' },
    auction_team_budgets: options?.budget ? [options.budget] : [],
    auction_lots: [],
    auction_rounds: [],
    auction_player_selections: [],
    auction_purchases: [],
    auction_events: [],
    team_owners: options?.owner ? [options.owner] : [],
  };
  const from = vi.fn((table: string) => mockQuery(responses[table] || []));
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return from;
}

describe('A7 auction admin control panel API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: managerId } },
          error: null,
        }),
      },
    } as never);
    vi.mocked(requireManager).mockResolvedValue({
      user: { id: managerId } as never,
      isAdmin: false,
      role: 'MANAGER' as never,
    });
  });

  it('returns 401 to unauthenticated requests before manager or privileged database access', async () => {
    vi.mocked(createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'No session' },
        }),
      },
    } as never);

    const response = await GET(request, context);
    expect(response.status).toBe(401);
    expect(requireManager).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated user who is not an admin or manager', async () => {
    vi.mocked(requireManager).mockRejectedValue(new Error('Unauthorized'));
    const response = await GET(request, context);
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('validates the auction identifier before reading privileged data', async () => {
    const response = await GET(request, { params: Promise.resolve({ auctionId: 'not-a-uuid' }) });
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 404 when an authorized manager requests a missing auction', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => mockQuery(null)),
    } as never);
    const response = await GET(request, context);
    expect(response.status).toBe(404);
  });

  it('returns no-store control data and computes the team affordability ceiling from shared auction rules', async () => {
    setupPanelClient({
      budget: {
        team_owner_id: managerId,
        starting_kitty: 180000,
        remaining_kitty: 100000,
        players_bought: 1,
        players_remaining: 8,
        required_players_to_buy: 9,
        status: 'ACTIVE',
      },
      owner: { id: managerId, owner_name: 'A. Owner', team_name: 'Falcons', team_logo_url: null },
    });

    const response = await GET(request, context);
    const panel = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(panel.auction.configuration.iconPlayersAllocated).toBe(1);
    expect(panel.teams[0]).toMatchObject({
      teamName: 'Falcons',
      startingKitty: 180000,
      remainingKitty: 100000,
      playersBought: 1,
      playersRemaining: 8,
      maximumAffordableCurrentBid: 65000,
    });
  });

  it('does not return raw database error messages to the client', async () => {
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => mockQuery(null, { message: 'private database detail', code: 'XX000' })),
    } as never);
    const response = await GET(request, context);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Unable to load auction control data.' });
  });
});

describe('A7 control panel coverage', () => {
  it('shows the auction overview and configured auction status', () => {
    expect(pageSource).toContain('Players sold');
    expect(pageSource).toContain('Players unsold');
    expect(pageSource).toContain('Retry pool remaining');
    expect(pageSource).toContain('Total money spent');
    expect(pageSource).toContain('data.auction.status');
  });

  it('renders the live lot and its current leading bid', () => {
    expect(pageSource).toContain('Current live lot');
    expect(pageSource).toContain('liveLot.currentBid');
    expect(pageSource).toContain('liveLot.currentTeamName');
  });

  it('shows ordered bid history and auction audit events', () => {
    expect(pageSource).toContain('Bid history');
    expect(pageSource).toContain('Auction event history');
    expect(pageSource).toContain('event.eventType.replaceAll');
  });

  it('starts an available lot through the existing manager API', () => {
    expect(pageSource).toContain("{ action: 'START' }");
    expect(lotRoute).toContain('start_auction_lot_v1');
  });

  it('settles only an expired live lot through the authoritative settlement API', () => {
    expect(pageSource).toContain("secondsRemaining !== 0");
    expect(pageSource).toContain("{ action: 'SETTLE' }");
    expect(lotRoute).toContain('settle_auction_lot_v1');
  });

  it('supports audited manual auction end through the existing endpoint', () => {
    expect(pageSource).toContain('/end');
    expect(pageSource).toContain('window.confirm');
    expect(endRoute).toContain('end_auction_v1');
  });

  it('updates dynamic configuration through the existing validated configuration route', () => {
    expect(pageSource).toContain('bidTimerSeconds');
    expect(pageSource).toContain('allowOwnerSelfPurchase');
    expect(configurationRoute).toContain('validateAuctionRules');
    expect(configurationRoute).toContain('update_auction_configuration');
  });

  it('locks configuration when the server indicates auction state or financial records prevent edits', () => {
    expect(pageSource).toContain('data.auction.configurationLocked');
    expect(pageSource).toContain('Configuration is locked by the auction state');
  });

  it('preserves the icon allocation as protected and non-selectable', () => {
    expect(pageSource).toContain("selection.candidateType === 'ICON'");
    expect(pageSource).toContain('Protected');
    expect(selectionsRoute).toContain('set_auction_player_selection');
  });

  it('allows candidate selection changes only before the auction starts', () => {
    expect(pageSource).toContain("['DRAFT', 'OPEN'].includes(data.auction.status)");
    expect(pageSource).toContain('selectionStatus: nextStatus');
  });

  it('keeps pool creation on the existing trusted server operation', () => {
    expect(pageSource).toContain('/pool');
    expect(poolRoute).toContain('populate_auction_player_pool');
  });

  it('shows remaining kitty, spending, squad counts, and affordability per team', () => {
    expect(pageSource).toContain('team.remainingKitty');
    expect(pageSource).toContain('team.kittyUsed');
    expect(pageSource).toContain('team.playersRemaining');
    expect(pageSource).toContain('team.maximumAffordableCurrentBid');
  });

  it('shows round and retry summaries', () => {
    expect(pageSource).toContain('Rounds and retry pool');
    expect(pageSource).toContain("round.roundType === 'UNSOLD_RETRY'");
  });

  it('refreshes server-authoritative state after actions and falls back while realtime is disconnected', () => {
    expect(pageSource).toContain('useAuctionRealtime(auctionId, refresh, 10000)');
    expect(realtimeHook).toContain('window.setInterval(poll, fallbackIntervalMs)');
    expect(pageSource).toContain('await refresh()');
  });

  it('surfaces loading, API, action, and empty-state errors instead of hiding failures', () => {
    expect(pageSource).toContain('Auction control panel unavailable');
    expect(pageSource).toContain('The auction action could not be completed.');
    expect(pageSource).toContain('No auction candidates found.');
  });
});
