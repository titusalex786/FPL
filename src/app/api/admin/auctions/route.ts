import { NextRequest, NextResponse } from 'next/server';
import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateAuctionRules } from '@/lib/auction/rules';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULTS = {
  startingKitty: 180000,
  requiredPlayersToBuy: 9,
  baseBid: 5000,
  bidThreshold: 20000,
  lowIncrement: 1000,
  highIncrement: 2000,
  minimumReserve: 5000,
  bidTimerSeconds: 30,
  maximumBid: null,
  allowOwnerSelfPurchase: false,
} as const;

type ProvisioningBody = {
  tournamentId: string;
  auctionName: string;
  startingKitty: number;
  requiredPlayersToBuy: number;
  baseBid: number;
  bidThreshold: number;
  lowIncrement: number;
  highIncrement: number;
  minimumReserve: number;
  bidTimerSeconds: number;
  maximumBid: number | null;
  allowOwnerSelfPurchase: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rpcErrorResponse(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '';

  if (message.includes('AUCTION_ALREADY_EXISTS') || code === '23505') {
    return NextResponse.json(
      { error: 'An auction already exists for this tournament.' },
      { status: 409 }
    );
  }
  if (message.includes('AUCTION_TOURNAMENT_NOT_FOUND') || code === 'P0002') {
    return NextResponse.json(
      { error: 'Selected tournament could not be found.' },
      { status: 404 }
    );
  }
  if (message.includes('AUCTION_PROVISIONING_UNAUTHORIZED') || code === '42501') {
    return NextResponse.json(
      { error: 'You are not authorized to create auctions.' },
      { status: 403 }
    );
  }
  if (message.includes('AUCTION_NO_ELIGIBLE_TEAMS')) {
    return NextResponse.json(
      { error: 'No eligible team owners were found.' },
      { status: 422 }
    );
  }
  if (message.includes('AUCTION_NO_CONFIRMED_PLAYERS')) {
    return NextResponse.json(
      { error: 'No eligible confirmed player registrations were found.' },
      { status: 422 }
    );
  }
  if (message.includes('AUCTION_REQUIRES_OWNER_BASED_TOURNAMENT')) {
    return NextResponse.json(
      { error: 'Auction provisioning is currently supported only for owner-based tournaments.' },
      { status: 422 }
    );
  }
  if (code === '22023') {
    return NextResponse.json(
      { error: 'Auction configuration is invalid.' },
      { status: 400 }
    );
  }

  console.error('Auction provisioning RPC failed', { code: code || 'UNKNOWN' });
  return NextResponse.json(
    { error: 'Auction creation could not be completed. No partial auction was created.' },
    { status: 500 }
  );
}

async function authenticatedManager(): Promise<
  | { kind: 'unauthorized'; response: NextResponse }
  | { kind: 'authorized'; user: { id: string } }
> {
  const server = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await server.auth.getUser();

  if (authError || !user) {
    return {
      kind: 'unauthorized',
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }

  const authorization = await checkIsManagerOrAdmin();
  if (!authorization.isManager || !authorization.user) {
    return {
      kind: 'unauthorized',
      response: NextResponse.json(
        { error: 'You are not authorized to create auctions.' },
        { status: 403 }
      ),
    };
  }

  return { kind: 'authorized', user: authorization.user };
}

export async function GET() {
  try {
    const auth = await authenticatedManager();
    if (auth.kind === 'unauthorized') return auth.response;

    const client = createAdminClient();
    const [tournamentsResult, auctionsResult, ownersResult, budgetsResult] = await Promise.all([
      client
        .from('tournaments')
        .select('id, name, tournament_type')
        .eq('tournament_type', 'OWNER_BASED')
        .order('name', { ascending: true }),
      client
        .from('auctions')
        .select('id, tournament_id, auction_name, status, starting_kitty, required_players_to_buy, created_at, updated_at, tournaments(name)')
        .order('created_at', { ascending: false }),
      client
        .from('team_owners')
        .select('id, tournament_id, player_id, owner_registration_id, icon_registration_id, status')
        .in('status', ['APPROVED', 'CONFIRMED']),
      client
        .from('auction_team_budgets')
        .select('auction_id, players_bought, players_remaining'),
    ]);
    if (tournamentsResult.error) throw tournamentsResult.error;
    if (auctionsResult.error) throw auctionsResult.error;
    if (ownersResult.error) throw ownersResult.error;

    const tournamentsById = new Map(
      (tournamentsResult.data || []).map((tournament) => [tournament.id, tournament.name])
    );
    const budgetsByAuction = new Map<
      string,
      { teamsCount: number; playersPurchased: number; playersRemaining: number }
    >();
    for (const b of (budgetsResult.data || [])) {
      const current = budgetsByAuction.get(b.auction_id) || {
        teamsCount: 0,
        playersPurchased: 0,
        playersRemaining: 0,
      };
      current.teamsCount += 1;
      current.playersPurchased += Number(b.players_bought || 0);
      current.playersRemaining += Number(b.players_remaining || 0);
      budgetsByAuction.set(b.auction_id, current);
    }

    const auctionList = (auctionsResult.data || []).map((auction: any) => {
      const stats = budgetsByAuction.get(auction.id) || {
        teamsCount: 0,
        playersPurchased: 0,
        playersRemaining: 0,
      };
      const tournamentName =
        tournamentsById.get(auction.tournament_id) ||
        (auction.tournaments as { name?: string } | null)?.name ||
        'Tournament';
      const isPractice = Boolean(auction.auction_name?.startsWith('[PRACTICE]'));
      return {
        id: auction.id,
        auctionName: auction.auction_name,
        tournamentId: auction.tournament_id,
        tournamentName,
        status: auction.status,
        isPractice,
        startingKitty: auction.starting_kitty ?? 180000,
        requiredPlayersToBuy: auction.required_players_to_buy ?? 9,
        teamsCount: stats.teamsCount,
        playersPurchased: stats.playersPurchased,
        playersRemaining: stats.playersRemaining,
        createdAt: auction.created_at,
        updatedAt: auction.updated_at,
      };
    });

    const tournamentIds = (tournamentsResult.data || []).map((tournament) => tournament.id);
    const ownerRows = (ownersResult.data || []).filter(
      (owner) =>
        tournamentIds.includes(owner.tournament_id) &&
        owner.player_id &&
        owner.owner_registration_id &&
        owner.icon_registration_id
    );
    const registrationIds = [
      ...new Set(
        ownerRows.flatMap((owner) => [
          owner.owner_registration_id,
          owner.icon_registration_id,
        ])
      ),
    ];
    const registrationsResult = registrationIds.length
      ? await client
          .from('registrations')
          .select('id, tournament_id, registration_type, registration_status')
          .in('id', registrationIds)
      : { data: [], error: null };
    if (registrationsResult.error) throw registrationsResult.error;
    const registrationsById = new Map(
      (registrationsResult.data || []).map((registration) => [registration.id, registration])
    );
    const auctionsByTournament = new Map(
      (auctionsResult.data || []).map((auction) => [auction.tournament_id, auction])
    );

    return NextResponse.json({
      auctions: auctionList,
      tournaments: (tournamentsResult.data || []).map((tournament) => {
        const eligibleTeamCount = ownerRows.filter((owner) => {
          if (owner.tournament_id !== tournament.id) return false;
          const ownerRegistration = registrationsById.get(owner.owner_registration_id!);
          const iconRegistration = registrationsById.get(owner.icon_registration_id!);
          return (
            !!ownerRegistration &&
            ownerRegistration.tournament_id === tournament.id &&
            ownerRegistration.registration_type === 'OWNER' &&
            ownerRegistration.registration_status === 'CONFIRMED' &&
            !!iconRegistration &&
            iconRegistration.tournament_id === tournament.id &&
            iconRegistration.registration_type === 'ICON' &&
            iconRegistration.registration_status === 'CONFIRMED'
          );
        }).length;
        const auction = auctionsByTournament.get(tournament.id);
        return {
          id: tournament.id,
          name: tournament.name,
          eligibleTeamCount,
          existingAuction: auction
            ? {
                id: auction.id,
                name: auction.auction_name,
                status: auction.status,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error('Unable to load auction provisioning options', {
      code:
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'Unable to load auction provisioning options.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticatedManager();
  if (auth.kind === 'unauthorized') return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: 'Invalid auction provisioning request.' }, { status: 400 });
  }
  const allowedFields = new Set([
    'tournamentId',
    'auctionName',
    'startingKitty',
    'requiredPlayersToBuy',
    'baseBid',
    'bidThreshold',
    'lowIncrement',
    'highIncrement',
    'minimumReserve',
    'bidTimerSeconds',
    'maximumBid',
    'allowOwnerSelfPurchase',
    'isPractice',
  ]);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return NextResponse.json(
      { error: 'Only tournament, auction name, and auction configuration may be submitted.' },
      { status: 400 }
    );
  }
  const numericFields = [
    'startingKitty',
    'requiredPlayersToBuy',
    'baseBid',
    'bidThreshold',
    'lowIncrement',
    'highIncrement',
    'minimumReserve',
    'bidTimerSeconds',
  ] as const;
  if (
    numericFields.some(
      (field) => field in body && typeof body[field] !== 'number'
    ) ||
    ('maximumBid' in body &&
      body.maximumBid !== null &&
      typeof body.maximumBid !== 'number') ||
    ('allowOwnerSelfPurchase' in body &&
      typeof body.allowOwnerSelfPurchase !== 'boolean') ||
    ('isPractice' in body &&
      typeof body.isPractice !== 'boolean')
  ) {
    return NextResponse.json(
      { error: 'Auction configuration is invalid.' },
      { status: 400 }
    );
  }

  const isPractice = Boolean(body.isPractice);
  let rawAuctionName = typeof body.auctionName === 'string' ? body.auctionName.trim() : '';
  if (isPractice && !rawAuctionName.startsWith('[PRACTICE]')) {
    rawAuctionName = `[PRACTICE] ${rawAuctionName || 'Practice Auction'}`;
  }

  const payload: ProvisioningBody = {
    tournamentId: typeof body.tournamentId === 'string' ? body.tournamentId : '',
    auctionName: rawAuctionName,
    startingKitty: typeof body.startingKitty === 'number' ? body.startingKitty : DEFAULTS.startingKitty,
    requiredPlayersToBuy:
      typeof body.requiredPlayersToBuy === 'number'
        ? body.requiredPlayersToBuy
        : DEFAULTS.requiredPlayersToBuy,
    baseBid: typeof body.baseBid === 'number' ? body.baseBid : DEFAULTS.baseBid,
    bidThreshold: typeof body.bidThreshold === 'number' ? body.bidThreshold : DEFAULTS.bidThreshold,
    lowIncrement: typeof body.lowIncrement === 'number' ? body.lowIncrement : DEFAULTS.lowIncrement,
    highIncrement: typeof body.highIncrement === 'number' ? body.highIncrement : DEFAULTS.highIncrement,
    minimumReserve: typeof body.minimumReserve === 'number' ? body.minimumReserve : DEFAULTS.minimumReserve,
    bidTimerSeconds:
      typeof body.bidTimerSeconds === 'number' ? body.bidTimerSeconds : DEFAULTS.bidTimerSeconds,
    maximumBid:
      body.maximumBid === null || body.maximumBid === undefined
        ? DEFAULTS.maximumBid
        : typeof body.maximumBid === 'number'
          ? body.maximumBid
          : Number.NaN,
    allowOwnerSelfPurchase:
      typeof body.allowOwnerSelfPurchase === 'boolean'
        ? body.allowOwnerSelfPurchase
        : DEFAULTS.allowOwnerSelfPurchase,
  };

  if (
    !UUID_PATTERN.test(payload.tournamentId) ||
    payload.auctionName.length < 2 ||
    payload.auctionName.length > 100 ||
    typeof payload.maximumBid !== 'number' && payload.maximumBid !== null
  ) {
    return NextResponse.json({ error: 'Invalid auction provisioning request.' }, { status: 400 });
  }

  const validationErrors = validateAuctionRules({
    totalKitty: payload.startingKitty,
    totalPlayersToBuy: payload.requiredPlayersToBuy,
    baseBid: payload.baseBid,
    minimumReservePerPlayer: payload.minimumReserve,
    bidThreshold: payload.bidThreshold,
    lowIncrement: payload.lowIncrement,
    highIncrement: payload.highIncrement,
    maximumBid: payload.maximumBid,
    allowOwnerSelfPurchase: payload.allowOwnerSelfPurchase,
  });
  if (
    validationErrors.length > 0 ||
    !Number.isSafeInteger(payload.bidTimerSeconds) ||
    payload.bidTimerSeconds < 1 ||
    payload.bidTimerSeconds > 3600 ||
    (payload.maximumBid !== null && !Number.isSafeInteger(payload.maximumBid))
  ) {
    return NextResponse.json(
      { error: 'Auction configuration is invalid.', details: validationErrors },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await createAdminClient().rpc('provision_auction_v1', {
      p_tournament_id: payload.tournamentId,
      p_auction_name: payload.auctionName,
      p_starting_kitty: payload.startingKitty,
      p_required_players_to_buy: payload.requiredPlayersToBuy,
      p_base_bid: payload.baseBid,
      p_bid_threshold: payload.bidThreshold,
      p_low_increment: payload.lowIncrement,
      p_high_increment: payload.highIncrement,
      p_minimum_reserve: payload.minimumReserve,
      p_bid_timer_seconds: payload.bidTimerSeconds,
      p_maximum_bid: payload.maximumBid,
      p_allow_owner_self_purchase: payload.allowOwnerSelfPurchase,
      p_actor_id: auth.user.id,
    });

    if (error) return rpcErrorResponse(error);

    const client = createAdminClient();
    if (isPractice && data?.auction_id) {
      const { data: allOwners } = await client
        .from('team_owners')
        .select('id')
        .eq('tournament_id', payload.tournamentId);

      const { data: existingBudgets } = await client
        .from('auction_team_budgets')
        .select('team_owner_id')
        .eq('auction_id', data.auction_id);

      const existingOwnerIds = new Set((existingBudgets || []).map((b) => b.team_owner_id));
      const missingOwners = (allOwners || []).filter((o) => !existingOwnerIds.has(o.id));

      if (missingOwners.length > 0) {
        await client.from('auction_team_budgets').insert(
          missingOwners.map((o) => ({
            auction_id: data.auction_id,
            tournament_id: payload.tournamentId,
            team_owner_id: o.id,
            starting_kitty: payload.startingKitty,
            remaining_kitty: payload.startingKitty,
            players_bought: 0,
            players_remaining: payload.requiredPlayersToBuy,
            status: 'ACTIVE',
          }))
        );
      }
    }

    return NextResponse.json({
      provisioning: {
        ...data,
        isPractice,
      },
    }, { status: 201 });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
