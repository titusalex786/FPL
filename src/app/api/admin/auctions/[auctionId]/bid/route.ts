import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

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
  | 'CANNOT_OUTBID_SELF'
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
  TEAM_NOT_ELIGIBLE: 'Team is not eligible to bid.',
  BIDDER_NOT_AUTHORIZED: 'You are not authorized to place bids.',
  CANNOT_OUTBID_SELF: 'Team is already the leading bidder.',
  SELF_BIDDING_NOT_ALLOWED: 'Team cannot bid on its own player.',
  BID_BELOW_BASE: 'Bid is below the minimum bid.',
  BID_NOT_HIGHER_THAN_CURRENT: 'Bid must be higher than current bid.',
  INVALID_BID_INCREMENT: 'Please use the next valid bid amount.',
  BID_ABOVE_MAX_AFFORDABLE: 'Bid exceeds maximum affordable bid.',
  INSUFFICIENT_KITTY: 'Insufficient budget for this bid.',
  RESERVE_VIOLATION: 'Bid exceeds maximum affordable bid (reserve protected).',
  INVALID_BID_AMOUNT: 'Please enter a valid bid amount.',
  AUCTION_NOT_FOUND: 'Auction not found.',
  LOT_NOT_FOUND: 'This lot is no longer available.',
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
    console.error('[Admin Auction Bid RPC Error]:', error);
    return NextResponse.json(
      { error: 'Unable to place bid right now.' },
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
            code === 'CANNOT_OUTBID_SELF' ||
            code === 'BID_NOT_HIGHER_THAN_CURRENT'
          ? 409
          : 422;
  return NextResponse.json(
    { error: BID_ERROR_MESSAGES[code], errorCode: code },
    { status }
  );
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;

    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { lotId, teamOwnerId, bidAmount } = body || {};

    if (!lotId || !UUID_PATTERN.test(lotId)) {
      return NextResponse.json({ error: 'Valid lotId is required' }, { status: 400 });
    }
    if (!teamOwnerId || !UUID_PATTERN.test(teamOwnerId)) {
      return NextResponse.json({ error: 'Valid teamOwnerId is required' }, { status: 400 });
    }
    if (!Number.isSafeInteger(bidAmount) || bidAmount < 1 || bidAmount > MAX_POSTGRES_INTEGER) {
      return NextResponse.json({ error: 'Valid integer bidAmount is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: lot, error } = await supabase.rpc('place_admin_auction_bid_v1', {
      p_auction_id: auctionId,
      p_lot_id: lotId,
      p_team_owner_id: teamOwnerId,
      p_bid_amount: bidAmount,
      p_actor_id: user.id,
    });

    if (error) return responseForBidError(error);

    // Non-blocking realtime broadcast for instant projector sync
    if (typeof (supabase as any).channel === 'function') {
      try {
        const syncChannel = supabase.channel(`auction-sync:${auctionId}`);
        syncChannel
          .send({
            type: 'broadcast',
            event: 'AUCTION_STATE_CHANGED',
            payload: { lotId, teamOwnerId, bidAmount },
          })
          .catch(() => {});
      } catch {
        // Non-blocking
      }
    }

    return NextResponse.json({ success: true, lot });
  } catch (error: any) {
    const status = error.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Error placing admin bid' }, { status });
  }
}
