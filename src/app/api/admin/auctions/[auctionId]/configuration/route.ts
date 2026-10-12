import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateAuctionRules, type AuctionRules } from '@/lib/auction/rules';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

function getErrorResponse(error: unknown) {
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

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from('auctions')
      .select(`
        id,
        status,
        starting_kitty,
        required_players_to_buy,
        icon_players_allocated,
        base_bid,
        minimum_reserve,
        bid_threshold,
        low_increment,
        high_increment,
        maximum_bid,
        allow_owner_self_purchase,
        bid_timer_seconds
      `)
      .eq('id', auctionId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    return NextResponse.json({ configuration: data });
  } catch (error) {
    return getErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
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

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid auction configuration' }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const fields = [
      'totalKitty',
      'totalPlayersToBuy',
      'baseBid',
      'minimumReservePerPlayer',
      'bidThreshold',
      'lowIncrement',
      'highIncrement',
    ] as const;
    if (
      fields.some((field) => typeof payload[field] !== 'number')
      || (payload.maximumBid !== null && payload.maximumBid !== undefined
        && typeof payload.maximumBid !== 'number')
      || (payload.allowOwnerSelfPurchase !== undefined
        && typeof payload.allowOwnerSelfPurchase !== 'boolean')
      || (payload.bidTimerSeconds !== undefined
        && (!Number.isSafeInteger(payload.bidTimerSeconds)
          || Number(payload.bidTimerSeconds) < 1
          || Number(payload.bidTimerSeconds) > 3600))
    ) {
      return NextResponse.json({ error: 'Invalid auction configuration' }, { status: 400 });
    }

    const rules: AuctionRules = {
      totalKitty: Number(payload.totalKitty),
      totalPlayersToBuy: Number(payload.totalPlayersToBuy),
      baseBid: Number(payload.baseBid),
      minimumReservePerPlayer: Number(payload.minimumReservePerPlayer),
      bidThreshold: Number(payload.bidThreshold),
      lowIncrement: Number(payload.lowIncrement),
      highIncrement: Number(payload.highIncrement),
      maximumBid: typeof payload.maximumBid === 'number' ? payload.maximumBid : null,
      allowOwnerSelfPurchase: typeof payload.allowOwnerSelfPurchase === 'boolean'
        ? payload.allowOwnerSelfPurchase
        : undefined,
    };
    const validationErrors = validateAuctionRules(rules);
    if (validationErrors.length > 0) {
      return NextResponse.json({ error: 'Invalid auction configuration', details: validationErrors }, {
        status: 400,
      });
    }

    const client = createAdminClient();
    const rpcName = typeof payload.bidTimerSeconds === 'number'
      ? 'update_auction_configuration_with_timer'
      : 'update_auction_configuration_with_self_bid';
    const rpcArguments = {
      p_auction_id: auctionId,
      p_actor_id: user.id,
      p_starting_kitty: rules.totalKitty,
      p_required_players_to_buy: rules.totalPlayersToBuy,
      p_base_bid: rules.baseBid,
      p_minimum_reserve: rules.minimumReservePerPlayer,
      p_bid_threshold: rules.bidThreshold,
      p_low_increment: rules.lowIncrement,
      p_high_increment: rules.highIncrement,
      p_maximum_bid: rules.maximumBid ?? null,
      p_allow_owner_self_purchase: rules.allowOwnerSelfPurchase ?? null,
    };
    const { data, error } = typeof payload.bidTimerSeconds === 'number'
      ? await client.rpc(rpcName, { ...rpcArguments, p_bid_timer_seconds: payload.bidTimerSeconds })
      : await client.rpc(rpcName, rpcArguments);

    if (error) throw error;
    return NextResponse.json({ configuration: data });
  } catch (error) {
    return getErrorResponse(error);
  }
}
