import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTeamAuctionDashboard,
  resolveDashboardOwner,
  type DashboardAuction,
  type DashboardBudget,
  type DashboardIcon,
  type DashboardPurchase,
  type DashboardTeamOwner,
} from '@/lib/auction/team-dashboard';

const auction: DashboardAuction = {
  id: 'auction-a',
  status: 'LIVE',
  bid_timer_seconds: 30,
  base_bid: 5000,
  minimum_reserve: 5000,
  bid_threshold: 20000,
  low_increment: 1000,
  high_increment: 2000,
  maximum_bid: null,
};

const owner: DashboardTeamOwner = {
  id: 'owner-a',
  tournament_id: 'tournament-a',
  player_id: 'player-owner-a',
  owner_name: 'Owner A',
  team_name: 'Team A',
  team_logo_url: null,
  icon_registration_id: 'icon-registration-a',
  icon_player_name: null,
  icon_player_role: null,
};

const budget: DashboardBudget = {
  starting_kitty: 180000,
  remaining_kitty: 120000,
  required_players_to_buy: 9,
  players_bought: 1,
  players_remaining: 8,
  icon_players_allocated: 1,
  status: 'ACTIVE',
};

const icon: DashboardIcon = {
  allocated: true,
  player_id: 'icon-player',
  player_name: 'Icon Player',
  profile_image_url: null,
  role: 'BATSMAN',
};

const purchasedPlayer: DashboardPurchase = {
  player_id: 'player-bought',
  winning_bid: 60000,
  player_role: 'ALL_ROUNDER',
  purchase_status: 'COMPLETED',
  created_at: '2026-10-11T00:00:00.000Z',
  player: {
    full_name: 'Purchased Player',
    profile_image_url: 'https://example.test/player.png',
    cricket_role: 'BATSMAN',
  },
};

function build(overrides: {
  auction?: Partial<DashboardAuction>;
  budget?: Partial<DashboardBudget>;
  icon?: Partial<DashboardIcon>;
  purchases?: DashboardPurchase[];
} = {}) {
  return buildTeamAuctionDashboard({
    auction: { ...auction, ...overrides.auction },
    teamOwner: owner,
    budget: { ...budget, ...overrides.budget },
    icon: { ...icon, ...overrides.icon },
    purchases: overrides.purchases ?? [purchasedPlayer],
  });
}

describe('A6 team auction dashboard', () => {
  it('shows the authoritative starting kitty', () => {
    expect(build().budget.startingKitty).toBe(180000);
  });

  it('shows the authoritative remaining kitty', () => {
    expect(build().budget.remainingKitty).toBe(120000);
  });

  it('calculates kitty used from the database budget values', () => {
    expect(build().budget.kittyUsed).toBe(60000);
  });

  it('calculates the budget percentage from the budget values', () => {
    expect(build().budget.budgetUsedPercent).toBeCloseTo(33.33);
  });

  it('shows players bought from the team budget', () => {
    expect(build().budget.playersBought).toBe(1);
  });

  it('shows players remaining from the team budget', () => {
    expect(build().budget.playersRemaining).toBe(8);
  });

  it('calculates average available per remaining player', () => {
    expect(build().budget.averageAvailablePerRemainingPlayer).toBe(15000);
  });

  it('calculates the reserve-aware maximum current bid', () => {
    expect(build().budget.maximumAffordableCurrentBid).toBe(85000);
  });

  it('returns zero average and maximum when no players remain', () => {
    const result = build({
      budget: {
        remaining_kitty: 0,
        players_bought: 9,
        players_remaining: 0,
      },
    });
    expect(result.budget.averageAvailablePerRemainingPlayer).toBe(0);
    expect(result.budget.maximumAffordableCurrentBid).toBe(0);
  });

  it('handles zero kitty used as zero-percent budget usage', () => {
    const result = build({
      budget: { remaining_kitty: 180000, players_bought: 0, players_remaining: 9 },
      purchases: [],
    });
    expect(result.budget.kittyUsed).toBe(0);
    expect(result.budget.budgetUsedPercent).toBe(0);
  });

  it('handles 100-percent budget usage', () => {
    const result = build({
      budget: { remaining_kitty: 0, players_bought: 9, players_remaining: 0 },
    });
    expect(result.budget.budgetUsedPercent).toBe(100);
  });

  it('maps purchased players from purchase records', () => {
    expect(build().purchases).toEqual([
      expect.objectContaining({
        playerId: 'player-bought',
        playerName: 'Purchased Player',
        winningBid: 60000,
        purchaseStatus: 'COMPLETED',
      }),
    ]);
  });

  it('excludes the icon player from auction purchases', () => {
    const result = build({
      purchases: [
        purchasedPlayer,
        { ...purchasedPlayer, player_id: 'icon-player', winning_bid: 0 },
      ],
    });
    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0].playerId).toBe('player-bought');
  });

  it('counts a sold purchase once and reports its amount as spent', () => {
    const result = build({ purchases: [purchasedPlayer] });
    expect(result.purchases).toHaveLength(1);
    expect(result.budget.totalSpent).toBe(60000);
  });

  it('does not treat pending or reversed records as completed spend', () => {
    const result = build({
      purchases: [
        purchasedPlayer,
        { ...purchasedPlayer, player_id: 'pending-player', purchase_status: 'PENDING' },
        { ...purchasedPlayer, player_id: 'reversed-player', purchase_status: 'REVERSED' },
      ],
    });
    expect(result.purchases).toHaveLength(3);
    expect(result.budget.totalSpent).toBe(60000);
  });

  it('does not include unsold lots because its input is purchase records', () => {
    const result = build({ purchases: [] });
    expect(result.purchases).toEqual([]);
    expect(result.budget.totalSpent).toBe(0);
    expect(result.budget.playersBought).toBe(1);
  });

  it('does not expose another owner when resolving the signed-in owner', () => {
    const other = { ...owner, id: 'owner-b', player_id: 'player-owner-b' };
    expect(
      resolveDashboardOwner('player-owner-a', 'tournament-a', [owner, other])?.id
    ).toBe('owner-a');
  });

  it('resolves Owner B only to Owner B', () => {
    const other = { ...owner, id: 'owner-b', player_id: 'player-owner-b' };
    expect(
      resolveDashboardOwner('player-owner-b', 'tournament-a', [owner, other])?.id
    ).toBe('owner-b');
  });

  it('rejects a missing authenticated player', () => {
    expect(resolveDashboardOwner(null, 'tournament-a', [owner])).toBeNull();
  });

  it('rejects an authenticated non-owner', () => {
    expect(
      resolveDashboardOwner('non-owner-player', 'tournament-a', [owner])
    ).toBeNull();
  });

  it('rejects an owner linked to a different tournament', () => {
    expect(
      resolveDashboardOwner('player-owner-a', 'tournament-b', [owner])
    ).toBeNull();
  });

  it('rejects ambiguous duplicate owner links instead of guessing', () => {
    expect(
      resolveDashboardOwner('player-owner-a', 'tournament-a', [
        owner,
        { ...owner, id: 'owner-a-duplicate' },
      ])
    ).toBeNull();
  });

  it('resolves the requested team owner when multiple teams are owned by the same player', () => {
    const secondOwner = { ...owner, id: 'owner-a-second', team_name: 'Team B' };
    const resolved = resolveDashboardOwner(
      'player-owner-a',
      'tournament-a',
      [owner, secondOwner],
      'owner-a-second'
    );
    expect(resolved).toEqual(secondOwner);
  });

  it('rejects requested team owner ID if it does not belong to the authenticated player', () => {
    const otherOwner = {
      ...owner,
      id: 'owner-other-player',
      player_id: 'different-player',
      team_name: 'Other Team',
    };
    const resolved = resolveDashboardOwner(
      'player-owner-a',
      'tournament-a',
      [owner, otherOwner],
      'owner-other-player'
    );
    expect(resolved).toBeNull();
  });

  it('returns a clean empty purchase list', () => {
    expect(build({ purchases: [] }).purchases).toEqual([]);
  });

  it('keeps final budget data available for a CLOSED auction', () => {
    const result = build({ auction: { status: 'CLOSED' } });
    expect(result.auction.status).toBe('CLOSED');
    expect(result.budget.remainingKitty).toBe(120000);
  });

  it('keeps final budget data available for a FINALIZED auction', () => {
    const result = build({ auction: { status: 'FINALIZED' } });
    expect(result.auction.status).toBe('FINALIZED');
    expect(result.budget.remainingKitty).toBe(120000);
  });

  it('uses the configured minimum reserve', () => {
    const result = build({
      auction: { minimum_reserve: 10000 },
    });
    expect(result.budget.maximumAffordableCurrentBid).toBe(50000);
  });

  it('uses the budget required-player count rather than a hardcoded squad size', () => {
    const result = build({
      budget: {
        required_players_to_buy: 5,
        players_bought: 1,
        players_remaining: 4,
      },
    });
    expect(result.budget.playersRemaining).toBe(4);
    expect(result.budget.maximumAffordableCurrentBid).toBe(105000);
  });

  it('uses the configured starting kitty', () => {
    const result = build({
      budget: {
        starting_kitty: 200000,
        remaining_kitty: 150000,
        required_players_to_buy: 9,
        players_bought: 1,
        players_remaining: 8,
      },
    });
    expect(result.budget.startingKitty).toBe(200000);
    expect(result.budget.kittyUsed).toBe(50000);
  });

  it('respects the configured maximum bid', () => {
    expect(
      build({ auction: { maximum_bid: 70000 } }).budget.maximumAffordableCurrentBid
    ).toBe(70000);
  });

  it('represents an allocated icon distinctly from auction purchases', () => {
    const result = build({ purchases: [] });
    expect(result.icon).toMatchObject({
      playerName: 'Icon Player',
      status: 'PRE_ALLOCATED',
    });
    expect(result.purchases).toEqual([]);
  });

  it('marks a missing icon as not allocated', () => {
    const result = build({
      budget: { icon_players_allocated: 0 },
      icon: { allocated: false, player_id: null, player_name: null },
    });
    expect(result.icon.status).toBe('NOT_ALLOCATED');
  });

  it('keeps an icon marked pre-allocated when the profile reference is unavailable', () => {
    const result = build({
      icon: {
        allocated: true,
        player_id: null,
        player_name: null,
      },
    });
    expect(result.icon.status).toBe('PRE_ALLOCATED');
  });

  it('keeps auction and team identity in the safe dashboard DTO', () => {
    expect(build()).toMatchObject({
      auction: { id: 'auction-a', status: 'LIVE', bidTimerSeconds: 30 },
      team: { teamOwnerId: 'owner-a', teamName: 'Team A', teamLogo: null },
    });
  });

  it('authenticates server-side and never accepts a browser owner id', () => {
    const route = readFileSync(
      resolve(
        process.cwd(),
        'src',
        'app',
        'api',
        'auctions',
        '[auctionId]',
        'team-dashboard',
        'route.ts'
      ),
      'utf8'
    );
    expect(route).toContain('userClient.auth.getUser()');
    expect(route).toContain(".eq('auth_user_id', user.id)");
    expect(route).toContain(".eq('player_id', player.id)");
    expect(route).not.toMatch(/searchParams\.get\(['"]team_owner_id/);
    expect(route).toContain(".eq('team_owner_id', teamOwner.id)");
  });

  it('scopes the read-only purchase query to the resolved owner and auction', () => {
    const route = readFileSync(
      resolve(
        process.cwd(),
        'src',
        'app',
        'api',
        'auctions',
        '[auctionId]',
        'team-dashboard',
        'route.ts'
      ),
      'utf8'
    );
    expect(route).toContain(".eq('auction_id', auctionId)");
    expect(route).toContain(".eq('team_owner_id', teamOwner.id)");
    expect(route).not.toMatch(/\.from\('auction_purchases'\)[\s\S]{0,500}\.insert\(/);
    expect(route).not.toMatch(/\.from\('auction_team_budgets'\)[\s\S]{0,500}\.(?:insert|update|delete)\(/);
  });
});
