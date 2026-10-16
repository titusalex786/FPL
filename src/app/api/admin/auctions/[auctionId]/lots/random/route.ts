import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  const status = message.includes('Unauthorized') || code === '42501'
    ? 403
    : code === 'P0002'
      ? 404
      : code === '22023'
        ? 400
        : code === '55000'
          ? 409
          : 500;

  return NextResponse.json({ error: message }, { status });
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 1. Verify auction status
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('id, status, tournament_id')
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    if (!['DRAFT', 'OPEN', 'LIVE'].includes(auction.status)) {
      return NextResponse.json({ error: 'Auction is not open or live' }, { status: 409 });
    }

    if (auction.status === 'DRAFT') {
      await supabase
        .from('auctions')
        .update({ status: 'OPEN', updated_at: new Date().toISOString() })
        .eq('id', auctionId)
        .eq('status', 'DRAFT');
    }

    // 2. Ensure no live lot currently exists
    const { data: liveLot, error: liveError } = await supabase
      .from('auction_lots')
      .select('id')
      .eq('auction_id', auctionId)
      .eq('status', 'LIVE')
      .maybeSingle();

    if (liveError) throw liveError;
    if (liveLot) {
      return NextResponse.json({ error: 'An active lot is already live' }, { status: 409 });
    }

    // 3. Find available lots in current round
    const { data: availableLots, error: lotsError } = await supabase
      .from('auction_lots')
      .select('id, lot_number, player_id, registration_id, round_id')
      .eq('auction_id', auctionId)
      .eq('status', 'AVAILABLE');

    if (lotsError) throw lotsError;
    if (!availableLots || availableLots.length === 0) {
      return NextResponse.json(
        { error: 'No available players remaining in the auction pool' },
        { status: 400 }
      );
    }

    // 4. Select a random available lot
    const randomIndex = Math.floor(Math.random() * availableLots.length);
    const selectedLot = availableLots[randomIndex];

    // 5. Start the selected lot via start_auction_lot_v1
    const { data: startedLot, error: startError } = await supabase.rpc('start_auction_lot_v1', {
      p_auction_id: auctionId,
      p_lot_id: selectedLot.id,
      p_actor_id: user.id,
    });

    if (startError) throw startError;

    return NextResponse.json({
      success: true,
      lot: startedLot,
      selectedLotId: selectedLot.id,
      lotNumber: selectedLot.lot_number,
      poolRemainingCount: availableLots.length - 1,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
