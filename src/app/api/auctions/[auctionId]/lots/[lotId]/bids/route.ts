import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_POSTGRES_INTEGER = 2147483647;
const BID_REASONS = new Set([
  'AUCTION_NOT_LIVE',
  'LOT_NOT_LIVE',
  'LOT_ALREADY_SOLD',
  'BID_DEADLINE_EXPIRED',
  'PLAYER_NOT_AVAILABLE',
  'TEAM_NOT_ELIGIBLE',
  'BIDDER_NOT_AUTHORIZED',
  'SELF_BIDDING_NOT_ALLOWED',
  'BID_BELOW_BASE',
  'BID_NOT_HIGHER_THAN_CURRENT',
  'INVALID_BID_INCREMENT',
  'BID_ABOVE_MAX_AFFORDABLE',
  'INSUFFICIENT_KITTY',
  'RESERVE_VIOLATION',
  'INVALID_BID_AMOUNT',
  'AUCTION_NOT_FOUND',
  'LOT_NOT_FOUND',
]);

type RouteContext = {
  params: Promise<{ auctionId: string; lotId: string }>;
};

function getErrorCode(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '';
  const reason = [...BID_REASONS].find((candidate) => message.includes(candidate));
  if (reason) return reason;

  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : 'INTERNAL_ERROR';
  }

  return 'INTERNAL_ERROR';
}

function getErrorStatus(code: string) {
  if (code === 'BIDDER_NOT_AUTHORIZED') return 403;
  if (code === 'AUCTION_NOT_FOUND' || code === 'LOT_NOT_FOUND') return 404;
  if (
    code === 'AUCTION_NOT_LIVE'
    || code === 'LOT_NOT_LIVE'
    || code === 'LOT_ALREADY_SOLD'
    || code === 'BID_DEADLINE_EXPIRED'
  ) {
    return 409;
  }
  if (BID_REASONS.has(code)) return 422;
  return 500;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const serverSupabase = await createServerSupabaseClient();
  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const { auctionId, lotId } = await params;
  if (!UUID_PATTERN.test(auctionId) || !UUID_PATTERN.test(lotId)) {
    return NextResponse.json({ error: 'Invalid auction or lot ID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object'
    || body === null
    || Array.isArray(body)
    || !('bidAmount' in body)
    || typeof body.bidAmount !== 'number'
    || !Number.isSafeInteger(body.bidAmount)
    || body.bidAmount > MAX_POSTGRES_INTEGER
  ) {
    return NextResponse.json({ error: 'bidAmount must be an integer' }, { status: 400 });
  }

  const { data, error } = await createAdminClient().rpc('place_auction_bid_v1', {
    p_auction_id: auctionId,
    p_lot_id: lotId,
    p_bid_amount: body.bidAmount,
    p_bidder_user_id: user.id,
  });

  if (error) {
    const code = getErrorCode(error);
    return NextResponse.json({ error: code }, { status: getErrorStatus(code) });
  }

  return NextResponse.json({
    lot: data,
    kittyDeducted: false,
    purchaseCreated: false,
    playerSold: false,
  });
}
