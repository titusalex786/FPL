import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createAdminClient } from '@/lib/supabase/admin';

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
      : 500;

  return NextResponse.json({ error: message }, { status });
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select('id')
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    const { data: lots, error } = await supabase
      .from('auction_lots')
      .select(`
        id,
        auction_id,
        tournament_id,
        registration_id,
        player_id,
        lot_number,
        status,
        round_id,
        current_highest_bid,
        current_highest_team_owner_id,
        winning_team_owner_id,
        sold_amount,
        sold_at,
        lot_started_at,
        last_bid_at,
        bid_deadline_at,
        settled_at,
        created_at,
        round:auction_rounds (
          round_number,
          round_type,
          status
        ),
        registration:registrations (
          registration_number,
          registration_status,
          registered_name_snapshot,
          registered_role_snapshot
        ),
        player:players (
          id,
          full_name,
          cricket_role
        )
      `)
      .eq('auction_id', auctionId)
      .order('lot_number', { ascending: true });

    if (error) throw error;

    const teamOwnerIds = [...new Set(
      (lots || [])
        .map((lot) => lot.current_highest_team_owner_id)
        .filter((id): id is string => typeof id === 'string')
    )];
    const teamOwners = teamOwnerIds.length > 0
      ? await supabase.from('team_owners').select('id, owner_name, team_name').in('id', teamOwnerIds)
      : { data: [], error: null };
    if (teamOwners.error) throw teamOwners.error;

    const teamsById = new Map((teamOwners.data || []).map((team) => [team.id, team]));
    const lotsWithTeam = (lots || []).map((lot) => ({
      ...lot,
      current_team: lot.current_highest_team_owner_id
        ? teamsById.get(lot.current_highest_team_owner_id) || null
        : null,
    }));
    return NextResponse.json({ lots: lotsWithTeam });
  } catch (error) {
    return getErrorResponse(error);
  }
}

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { user } = await requireManager();
    const { auctionId } = await params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
    }

    const { data: insertedCount, error } = await createAdminClient().rpc(
      'populate_auction_player_pool',
      {
        p_auction_id: auctionId,
        p_actor_id: user.id,
      }
    );

    if (error) throw error;
    return NextResponse.json({
      success: true,
      insertedCount,
    });
  } catch (error) {
    return getErrorResponse(error);
  }
}
