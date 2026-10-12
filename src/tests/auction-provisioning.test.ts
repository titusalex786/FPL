import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/admin/auctions/route';
import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

vi.mock('@/lib/auth/is-manager', () => ({ checkIsManagerOrAdmin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));

const migration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261024000000_a10_r1_auction_provisioning.sql'),
  'utf8'
);
const foundationMigration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261018000000_phase_a2_auction_foundation.sql'),
  'utf8'
);
const configMigration = readFileSync(
  resolve(process.cwd(), 'supabase', 'migrations', '20261020000000_auction_selection_and_dynamic_rules.sql'),
  'utf8'
);

const managerId = '40000000-0000-4000-8000-000000000001';
const tournamentId = '50000000-0000-4000-8000-000000000001';
const auctionId = '10000000-0000-4000-8000-000000000001';

const defaultBody = {
  tournamentId,
  auctionName: 'Summer Cup Auction',
};

function request(body: unknown, url = 'http://localhost/api/admin/auctions') {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function query(data: unknown, error: unknown = null) {
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
        data: { user: authenticated ? { id: managerId } : null },
        error: authenticated ? null : { message: 'No session' },
      }),
    },
  } as never);
  vi.mocked(checkIsManagerOrAdmin).mockResolvedValue({
    isManager: manager,
    isAdmin: false,
    user: manager ? { id: managerId } as never : null,
    role: manager ? 'MANAGER' as never : null,
  });
}

function configureAdmin(options?: {
  rpc?: { data: unknown; error: unknown };
  tables?: Record<string, { data: unknown; error?: unknown }>;
}) {
  const rpc = vi.fn().mockResolvedValue(
    options?.rpc || {
      data: {
        auction_id: auctionId,
        auction_name: 'Summer Cup Auction',
        tournament_id: tournamentId,
        status: 'DRAFT',
        teams_initialized: 2,
        starting_kitty: 180000,
        required_players_to_buy: 9,
      },
      error: null,
    }
  );
  const tables = options?.tables || {};
  const from = vi.fn((table: string) =>
    query(tables[table]?.data ?? [], tables[table]?.error ?? null)
  );
  vi.mocked(createAdminClient).mockReturnValue({ from, rpc } as never);
  return { from, rpc };
}

function firstRpcArgs(rpc: ReturnType<typeof vi.fn>) {
  const call = rpc.mock.calls[0];
  if (!call) throw new Error('Expected the provisioning RPC to be called.');
  return call[1] as Record<string, unknown>;
}

describe('A10-R1 auction provisioning API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureAuth();
    configureAdmin();
  });

  it('returns 401 to unauthenticated tournament-list requests', async () => {
    configureAuth({ authenticated: false });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 403 to an authenticated non-manager', async () => {
    configureAuth({ manager: false });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns only owner-based tournament choices', async () => {
    configureAdmin({
      tables: {
        tournaments: { data: [{ id: tournamentId, name: 'Summer Cup', tournament_type: 'OWNER_BASED' }] },
        auctions: { data: [] },
        team_owners: { data: [] },
      },
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tournaments: [{ id: tournamentId, name: 'Summer Cup', eligibleTeamCount: 0, existingAuction: null }],
    });
  });

  it('returns the existing auction so duplicate creation can be disabled in the form', async () => {
    configureAdmin({
      tables: {
        tournaments: { data: [{ id: tournamentId, name: 'Summer Cup' }] },
        auctions: { data: [{ id: auctionId, tournament_id: tournamentId, auction_name: 'Cup Auction', status: 'DRAFT' }] },
        team_owners: { data: [] },
      },
    });
    const response = await GET();
    expect((await response.json()).tournaments[0].existingAuction).toMatchObject({
      id: auctionId,
      name: 'Cup Auction',
      status: 'DRAFT',
    });
  });

  it('rejects unauthenticated provisioning before privileged access', async () => {
    configureAuth({ authenticated: false });
    const response = await POST(request(defaultBody));
    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a normal authenticated user', async () => {
    configureAuth({ manager: false });
    const response = await POST(request(defaultBody));
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('provisions through the server RPC for an authorized manager', async () => {
    const { rpc } = configureAdmin();
    const response = await POST(request(defaultBody));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('provision_auction_v1', expect.objectContaining({
      p_tournament_id: tournamentId,
      p_auction_name: 'Summer Cup Auction',
      p_actor_id: managerId,
    }));
  });

  it('uses the configured default kitty of 180000', async () => {
    const { rpc } = configureAdmin();
    await POST(request(defaultBody));
    expect(firstRpcArgs(rpc)).toMatchObject({ p_starting_kitty: 180000 });
  });

  it('uses the configured default additional player quota of nine', async () => {
    const { rpc } = configureAdmin();
    await POST(request(defaultBody));
    expect(firstRpcArgs(rpc)).toMatchObject({ p_required_players_to_buy: 9 });
  });

  it('uses the configured default base bid, threshold, and increments', async () => {
    const { rpc } = configureAdmin();
    await POST(request(defaultBody));
    expect(firstRpcArgs(rpc)).toMatchObject({
      p_base_bid: 5000,
      p_bid_threshold: 20000,
      p_low_increment: 1000,
      p_high_increment: 2000,
    });
  });

  it('uses the configured default reserve and timer', async () => {
    const { rpc } = configureAdmin();
    await POST(request(defaultBody));
    expect(firstRpcArgs(rpc)).toMatchObject({
      p_minimum_reserve: 5000,
      p_bid_timer_seconds: 30,
    });
  });

  it('passes supported custom configuration without replacing it with defaults', async () => {
    const { rpc } = configureAdmin();
    await POST(request({
      ...defaultBody,
      startingKitty: 200000,
      requiredPlayersToBuy: 8,
      baseBid: 6000,
      bidThreshold: 24000,
      lowIncrement: 2000,
      highIncrement: 3000,
      minimumReserve: 6000,
      bidTimerSeconds: 45,
      maximumBid: 50000,
      allowOwnerSelfPurchase: true,
    }));
    expect(firstRpcArgs(rpc)).toMatchObject({
      p_starting_kitty: 200000,
      p_required_players_to_buy: 8,
      p_base_bid: 6000,
      p_bid_threshold: 24000,
      p_low_increment: 2000,
      p_high_increment: 3000,
      p_minimum_reserve: 6000,
      p_bid_timer_seconds: 45,
      p_maximum_bid: 50000,
      p_allow_owner_self_purchase: true,
    });
  });

  it('does not accept caller-supplied remaining kitty', async () => {
    const response = await POST(request({ ...defaultBody, remainingKitty: 1 }));
    expect(response.status).toBe(400);
  });

  it('does not accept caller-supplied players bought or remaining', async () => {
    expect((await POST(request({ ...defaultBody, playersBought: 3 }))).status).toBe(400);
    expect((await POST(request({ ...defaultBody, playersRemaining: 6 }))).status).toBe(400);
  });

  it('does not accept caller-supplied creator identity', async () => {
    const response = await POST(request({ ...defaultBody, createdBy: 'fake-user' }));
    expect(response.status).toBe(400);
  });

  it('rejects an invalid tournament identifier', async () => {
    const response = await POST(request({ ...defaultBody, tournamentId: 'not-a-uuid' }));
    expect(response.status).toBe(400);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ['empty name', ''],
    ['one-character name', 'A'],
    ['overlong name', 'a'.repeat(101)],
  ])('rejects an %s', async (_label, auctionName) => {
    expect((await POST(request({ ...defaultBody, auctionName }))).status).toBe(400);
  });

  it('rejects invalid configuration before invoking the RPC', async () => {
    const { rpc } = configureAdmin();
    const response = await POST(request({ ...defaultBody, startingKitty: -1 }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an invalid timer before invoking the RPC', async () => {
    const { rpc } = configureAdmin();
    const response = await POST(request({ ...defaultBody, bidTimerSeconds: 3601 }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const malformed = new NextRequest('http://localhost/api/admin/auctions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect((await POST(malformed)).status).toBe(400);
  });

  it('maps duplicate tournament auctions to a safe conflict response', async () => {
    configureAdmin({ rpc: { data: null, error: { code: '23505', message: 'AUCTION_ALREADY_EXISTS' } } });
    const response = await POST(request(defaultBody));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'An auction already exists for this tournament.' });
  });

  it('maps missing tournament to a safe not-found response', async () => {
    configureAdmin({ rpc: { data: null, error: { code: 'P0002', message: 'AUCTION_TOURNAMENT_NOT_FOUND' } } });
    expect((await POST(request(defaultBody))).status).toBe(404);
  });

  it('maps no eligible owners to a clear validation response', async () => {
    configureAdmin({ rpc: { data: null, error: { code: 'P0001', message: 'AUCTION_NO_ELIGIBLE_TEAMS' } } });
    expect((await POST(request(defaultBody))).status).toBe(422);
  });

  it('maps a non-owner-based tournament to a supported-scope response', async () => {
    configureAdmin({ rpc: { data: null, error: { code: '22023', message: 'AUCTION_REQUIRES_OWNER_BASED_TOURNAMENT' } } });
    expect((await POST(request(defaultBody))).status).toBe(422);
  });

  it('does not expose raw database errors on failure', async () => {
    configureAdmin({ rpc: { data: null, error: { code: 'XX000', message: 'private database detail' } } });
    const response = await POST(request(defaultBody));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Auction creation could not be completed. No partial auction was created.',
    });
  });

  it('returns the created auction and exact initialized team count', async () => {
    const response = await POST(request(defaultBody));
    expect(await response.json()).toMatchObject({
      provisioning: {
        auction_id: auctionId,
        status: 'DRAFT',
        teams_initialized: 2,
      },
    });
  });
});

describe('A10-R1 database provisioning contract', () => {
  it('adds an optional auction name without destructive table changes', () => {
    expect(migration).toMatch(/ALTER TABLE auctions\s+ADD COLUMN IF NOT EXISTS auction_name TEXT/);
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b/i);
  });

  it('creates a single SECURITY DEFINER provisioning RPC with a fixed search path', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION provision_auction_v1\(/);
    expect(migration).toMatch(/SECURITY DEFINER\s+SET search_path = public/);
  });

  it('uses existing database-backed manager authorization and server actor identity', () => {
    expect(migration).toMatch(/p_actor_id IS NULL OR NOT is_manager\(p_actor_id\)/);
    expect(migration).not.toMatch(/@gmail\.com|@outlook\.com|@hotmail\.com/i);
  });

  it('accepts only owner-based tournaments and requires the tournament row to exist', () => {
    expect(migration).toMatch(/FROM tournaments\s+WHERE id = p_tournament_id\s+FOR UPDATE/);
    expect(migration).toContain("v_tournament.tournament_type IS DISTINCT FROM 'OWNER_BASED'");
  });

  it('retains the existing one-auction-per-tournament database uniqueness rule', () => {
    expect(foundationMigration).toMatch(/CONSTRAINT unique_auction_per_tournament UNIQUE \(tournament_id\)/);
    expect(migration).toContain('AUCTION_ALREADY_EXISTS');
  });

  it('derives participating teams from approved owners and confirmed owner registrations', () => {
    expect(migration).toContain("owner_team.status IN ('APPROVED', 'CONFIRMED')");
    expect(migration).toContain("owner_registration.registration_type = 'OWNER'");
    expect(migration).toContain("owner_registration.registration_status = 'CONFIRMED'");
  });

  it('requires each initialized team to retain its confirmed icon registration', () => {
    expect(migration).toContain("icon_registration.registration_type = 'ICON'");
    expect(migration).toContain("icon_registration.registration_status = 'CONFIRMED'");
    expect(migration).toMatch(/p_required_players_to_buy,\s+1,\s+p_base_bid/);
  });

  it('requires at least one eligible confirmed PLAYER registration', () => {
    expect(migration).toContain("player_registration.registration_type = 'PLAYER'");
    expect(migration).toContain("player_registration.registration_status = 'CONFIRMED'");
    expect(migration).toContain('AUCTION_NO_CONFIRMED_PLAYERS');
  });

  it('validates configurable financial rules and timer in the database', () => {
    expect(migration).toContain('p_base_bid < 5000');
    expect(migration).toContain('p_starting_kitty < p_required_players_to_buy::BIGINT * p_minimum_reserve');
    expect(migration).toContain('p_bid_timer_seconds NOT BETWEEN 1 AND 3600');
  });

  it('creates auction and all eligible budgets within one transactional function call', () => {
    expect(migration.indexOf('INSERT INTO auctions (')).toBeGreaterThan(-1);
    expect(migration.indexOf('INSERT INTO auction_team_budgets (')).toBeGreaterThan(migration.indexOf('INSERT INTO auctions ('));
    expect(migration).toContain('AUCTION_BUDGET_INITIALIZATION_MISMATCH');
  });

  it('derives every budget value from the persisted auction configuration', () => {
    expect(migration).toMatch(/v_auction\.starting_kitty,\s+v_auction\.starting_kitty,\s+v_auction\.required_players_to_buy,\s+0,\s+v_auction\.required_players_to_buy/);
  });

  it('uses the existing unique auction/team budget constraint', () => {
    expect(foundationMigration).toMatch(/CONSTRAINT unique_auction_budget_per_team UNIQUE \(auction_id, team_owner_id\)/);
  });

  it('does not populate lots, create purchases, or change icon registrations', () => {
    expect(migration).not.toMatch(/INSERT INTO auction_lots\b/i);
    expect(migration).not.toMatch(/INSERT INTO auction_purchases\b/i);
    expect(migration).not.toMatch(/UPDATE registrations\b/i);
  });

  it('records a provisioning event with actor, configuration, and team count', () => {
    expect(migration).toContain("'AUCTION_PROVISIONED'");
    expect(migration).toMatch(/'teams_initialized', v_budget_count/);
    expect(migration).toMatch(/'created_by'|created_by/);
  });

  it('revokes direct execution from public client roles and grants the RPC to service_role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION provision_auction_v1[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION provision_auction_v1[\s\S]*TO service_role/);
  });

  it('keeps dynamic auction configuration in the existing configuration RPC architecture', () => {
    expect(configMigration).toContain('CREATE OR REPLACE FUNCTION update_auction_configuration(');
    expect(migration).toMatch(/p_starting_kitty INTEGER[\s\S]*p_required_players_to_buy INTEGER[\s\S]*p_bid_timer_seconds INTEGER/);
  });
});
