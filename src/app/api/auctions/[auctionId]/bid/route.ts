import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_INTEGER = 2147483647;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

type BidErrorCode =
  | 'AUCTION_NOT_LIVE'
  | 'LOT_NOT_LIVE'
  | 'LOT_ALREADY_SOLD'
  | 'BID_DEADLINE_EXPIRED'
  | 'PLAYER_NOT_AVAILABLE'
  | 'TEAM_NOT_ELIGIBLE'
  | 'BIDDER_NOT_AUTHORIZED'
  | 'SELF_BIDDING_NOT_ALLOWED'
  | 'BID_BELOW_BASE'
  | 'BID_NOT_HIGHER_THAN_CURRENT'
  | 'INVALID_BID_INCREMENT'
  | 'BID_ABOVE_MAX_AFFORDABLE'
  | 'INSUFFICIENT_KITTY'
  | 'RESERVE_VIOLATION'
  | 'INVALID_BID_AMOUNT'
  | 'AUCTION_NOT_FOUND'
  | 'LOT_NOT_FOUND';

const BID_ERROR_MESSAGES: Record<BidErrorCode, string> = {
  AUCTION_NOT_LIVE: 'The auction is not accepting bids.',
  LOT_NOT_LIVE: 'This player is no longer live.',
  LOT_ALREADY_SOLD: 'This player is no longer live.',
  BID_DEADLINE_EXPIRED: 'The bidding timer has expired.',
  PLAYER_NOT_AVAILABLE: 'This player is not available for bidding.',
  TEAM_NOT_ELIGIBLE: 'You are not registered as an auction team.',
  BIDDER_NOT_AUTHORIZED: 'You are not authorized to bid in this auction.',
  SELF_BIDDING_NOT_ALLOWED: 'Your team cannot bid on its own player.',
  BID_BELOW_BASE: 'Your bid is below the minimum bid.',
  BID_NOT_HIGHER_THAN_CURRENT: 'You have been outbid. The auction state has changed.',
  INVALID_BID_INCREMENT: 'Please use the next valid bid amount.',
  BID_ABOVE_MAX_AFFORDABLE: 'Your bid exceeds your maximum affordable bid.',
  INSUFFICIENT_KITTY: 'Insufficient budget for this bid.',
  RESERVE_VIOLATION: 'Your bid exceeds your maximum affordable bid.',
  INVALID_BID_AMOUNT: 'Please enter a valid bid amount.',
  AUCTION_NOT_FOUND: 'Auction not found.',
  LOT_NOT_FOUND: 'This player is no longer available.',
};

function responseForBidError(error: unknown) {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : error instanceof Error
        ? error.message
        : '';
  const code = (Object.keys(BID_ERROR_MESSAGES) as BidErrorCode[]).find(
    (candidate) => message.includes(candidate)
  );

  if (!code) {
    console.error('Auction bid RPC failed', error);
    return NextResponse.json(
      { error: 'Unable to place your bid right now.' },
      { status: 500 }
    );
  }

  const status =
    code === 'BIDDER_NOT_AUTHORIZED'
      ? 403
      : code === 'AUCTION_NOT_FOUND' || code === 'LOT_NOT_FOUND'
        ? 404
        : code === 'AUCTION_NOT_LIVE' ||
            code === 'LOT_NOT_LIVE' ||
            code === 'LOT_ALREADY_SOLD' ||
            code === 'BID_DEADLINE_EXPIRED' ||
            code === 'BID_NOT_HIGHER_THAN_CURRENT'
          ? 409
          : 422;
  return NextResponse.json(
    { error: BID_ERROR_MESSAGES[code], errorCode: code },
    { status }
  );
}

async function getAuthenticatedUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { user, error };
}

async function resolveAuctionOwner(
  auctionId: string,
  tournamentId: string,
  userId: string
) {
  const supabase = createAdminClient();
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (playerError) throw playerError;

  // Find user's registrations in this tournament
  const queryParts = [`created_by_auth_id.eq.${userId}`, `user_id.eq.${userId}`];
  if (player) {
    queryParts.push(`player_id.eq.${player.id}`);
  }
  const { data: userRegs } = await supabase
    .from('registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .or(queryParts.join(','));

  const userRegIds = new Set((userRegs || []).map((r: any) => r.id));

  // Find team_owners by owner player_id, owner_registration_id, or icon_registration_id
  const { data: allOwners, error: ownerError } = await supabase
    .from('team_owners')
    .select('id, owner_name, team_name, player_id, icon_registration_id, owner_registration_id')
    .eq('tournament_id', tournamentId);
  if (ownerError) throw ownerError;

  const matchedOwners = (allOwners || []).filter((owner: any) => {
    if (player && owner.player_id === player.id) return true;
    if (owner.owner_registration_id && userRegIds.has(owner.owner_registration_id)) return true;
    if (owner.icon_registration_id && userRegIds.has(owner.icon_registration_id)) return true;
    return false;
  });

  if (matchedOwners.length !== 1) return null;

  const { data: budget, error: budgetError } = await supabase
    .from('auction_team_budgets')
    .select('id')
    .eq('auction_id', auctionId)
    .eq('tournament_id', tournamentId)
    .eq('team_owner_id', matchedOwners[0].id)
    .maybeSingle();
  if (budgetError) throw budgetError;
  return budget ? matchedOwners[0] : null;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { auctionId } = await params;
  if (!UUID_PATTERN.test(auctionId)) {
    return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select(
        'id, tournament_id, status, bid_timer_seconds, base_bid, bid_threshold, low_increment, high_increment, minimum_reserve, maximum_bid'
      )
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found.' }, { status: 404 });
    }

    const owner = await resolveAuctionOwner(
      auctionId,
      auction.tournament_id,
      user.id
    );
    if (!owner) {
      return NextResponse.json(
        { error: 'You are not registered as an auction team.' },
        { status: 403 }
      );
    }

    let liveLot = null;
    if (auction.status === 'LIVE') {
      const { data, error } = await supabase
        .from('auction_lots')
        .select(`
          id, lot_number, status, current_highest_bid,
          current_highest_team_owner_id, bid_deadline_at,
          round:auction_rounds (round_number, round_type),
          player:players (
            id, full_name, profile_image_url, cricket_role, batting_style, jersey_size
          ),
          registration:registrations (
            registered_name_snapshot, registered_role_snapshot,
            registered_batting_style_snapshot, registered_bowling_style_snapshot,
            registered_jersey_size_snapshot
          )
        `)
        .eq('auction_id', auctionId)
        .eq('tournament_id', auction.tournament_id)
        .eq('status', 'LIVE')
        .maybeSingle();
      if (error) throw error;
      liveLot = data;
    }

    let highestBidderName: string | null = null;
    let isHighestBidder = false;
    if (liveLot?.current_highest_team_owner_id) {
      const { data: highestOwner, error } = await supabase
        .from('team_owners')
        .select('id, owner_name, team_name')
        .eq('id', liveLot.current_highest_team_owner_id)
        .eq('tournament_id', auction.tournament_id)
        .maybeSingle();
      if (error) throw error;
      highestBidderName =
        highestOwner?.team_name || highestOwner?.owner_name || 'Auction team';
      isHighestBidder = highestOwner?.id === owner.id;
    }

    const { data: events, error: eventsError } = liveLot
      ? await supabase
          .from('auction_events')
          .select('id, team_owner_id, amount, created_at')
          .eq('auction_id', auctionId)
          .eq('event_type', 'BID_PLACED')
          .contains('event_payload', { lot_id: liveLot.id })
          .order('created_at', { ascending: true })
          .limit(25)
      : { data: [], error: null };
    if (eventsError) throw eventsError;

    const bidderIds = [
      ...new Set(
        (events || [])
          .map((event) => event.team_owner_id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ].filter((id) => id !== owner.id);
    const { data: publicTeams, error: teamsError } = bidderIds.length
      ? await supabase
          .from('team_owners')
          .select('id, owner_name, team_name')
          .eq('tournament_id', auction.tournament_id)
          .in('id', bidderIds)
      : { data: [], error: null };
    if (teamsError) throw teamsError;
    const publicTeamNames = new Map(
      (publicTeams || []).map((team) => [
        team.id,
        team.team_name || team.owner_name || 'Auction team',
      ])
    );

    const player = liveLot
      ? Array.isArray(liveLot.player)
        ? liveLot.player[0]
        : liveLot.player
      : null;
    const registration = liveLot
      ? Array.isArray(liveLot.registration)
        ? liveLot.registration[0]
        : liveLot.registration
      : null;
    const round = liveLot
      ? Array.isArray(liveLot.round)
        ? liveLot.round[0]
        : liveLot.round
      : null;

    return NextResponse.json(
      {
        auction: {
          id: auction.id,
          status: auction.status,
          rules: {
            baseBid: auction.base_bid,
            bidThreshold: auction.bid_threshold,
            lowIncrement: auction.low_increment,
            highIncrement: auction.high_increment,
            minimumReserve: auction.minimum_reserve,
            maximumBid: auction.maximum_bid,
            bidTimerSeconds: auction.bid_timer_seconds,
          },
        },
        liveLot: liveLot
          ? {
              lotId: liveLot.id,
              lotNumber: liveLot.lot_number,
              status: liveLot.status,
              currentBid: liveLot.current_highest_bid,
              highestBidderName,
              isHighestBidder,
              bidDeadlineAt: liveLot.bid_deadline_at,
              roundNumber: round?.round_number || null,
              roundType: round?.round_type || null,
              player: player
                ? {
                    name:
                      registration?.registered_name_snapshot ||
                      player.full_name,
                    image: player.profile_image_url,
                    role:
                      registration?.registered_role_snapshot ||
                      player.cricket_role,
                    battingStyle:
                      registration?.registered_batting_style_snapshot ||
                      player.batting_style,
                    bowlingStyle:
                      registration?.registered_bowling_style_snapshot || null,
                    jerseySize:
                      registration?.registered_jersey_size_snapshot ||
                      player.jersey_size,
                  }
                : null,
            }
          : null,
        bidHistory: (events || []).map((event) => ({
          amount: event.amount,
          teamName:
            event.team_owner_id === owner.id
              ? 'Your team'
              : publicTeamNames.get(event.team_owner_id) || 'Auction team',
          createdAt: event.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('Unable to load owner auction bidding state', error);
    return NextResponse.json(
      { error: 'Unable to load the live auction right now.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { user, error: authError } = await getAuthenticatedUser();
  if (authError || !user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const { auctionId } = await params;
  if (!UUID_PATTERN.test(auctionId)) {
    return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'lotId' && key !== 'proposedBid') ||
    !('lotId' in body) ||
    typeof body.lotId !== 'string' ||
    !UUID_PATTERN.test(body.lotId) ||
    !('proposedBid' in body) ||
    typeof body.proposedBid !== 'number' ||
    !Number.isSafeInteger(body.proposedBid) ||
    body.proposedBid < 1 ||
    body.proposedBid > MAX_POSTGRES_INTEGER
  ) {
    return NextResponse.json(
      { error: 'Only a valid lotId and integer proposedBid are accepted.' },
      { status: 400 }
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('id, tournament_id')
      .eq('id', auctionId)
      .maybeSingle();
    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found.' }, { status: 404 });
    }

    const owner = await resolveAuctionOwner(
      auctionId,
      auction.tournament_id,
      user.id
    );
    if (!owner) {
      return NextResponse.json(
        {
          error: 'You are not registered as an auction team.',
          errorCode: 'TEAM_NOT_ELIGIBLE',
        },
        { status: 403 }
      );
    }

    const { data: lot, error } = await supabase.rpc('place_auction_bid_v1', {
      p_auction_id: auctionId,
      p_lot_id: body.lotId,
      p_bid_amount: body.proposedBid,
      p_bidder_user_id: user.id,
    });

    if (error) return responseForBidError(error);
    return NextResponse.json({ success: true, lot });
  } catch (error) {
    console.error('Unable to place owner auction bid', error);
    return NextResponse.json(
      { error: 'Unable to place your bid right now.' },
      { status: 500 }
    );
  }
}
