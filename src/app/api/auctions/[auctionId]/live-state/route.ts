import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

/**
 * Public projector/live screen endpoint.
 * Deliberately exposes ONLY non-private auction state:
 *   - Auction name, status, round
 *   - Current LIVE lot: player name, photo, role, batting style
 *   - Current bid + highest bidder team name
 *   - Bid deadline (for client-side countdown)
 *   - Last 3 sold lots
 * NEVER exposes: budgets, purchase history, payments, player emails,
 * player private mobile, admin audit information, or any team's private spend.
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { auctionId } = await params;

  if (!UUID_PATTERN.test(auctionId)) {
    return NextResponse.json({ error: 'Invalid auction ID' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();

    const { data: auction, error: auctionError } = await supabase
      .from('auctions')
      .select(
        'id, auction_name, status, base_bid, bid_timer_seconds, tournament_id'
      )
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    const [tournamentResult, lotsResult, roundsResult] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, name')
        .eq('id', auction.tournament_id)
        .maybeSingle(),
      supabase
        .from('auction_lots')
        .select(`
          id, lot_number, status,
          current_highest_bid, current_highest_team_owner_id,
          winning_team_owner_id, sold_amount, sold_at, bid_deadline_at,
          round_id,
          round:auction_rounds (round_number, round_type),
          player:players (
            id, full_name, profile_image_url, cricket_role, batting_style
          ),
          registration:registrations (
            registered_name_snapshot, registered_role_snapshot,
            registered_batting_style_snapshot
          )
        `)
        .eq('auction_id', auctionId)
        .order('lot_number', { ascending: true }),
      supabase
        .from('auction_rounds')
        .select('id, round_number, round_type, status')
        .eq('auction_id', auctionId)
        .order('round_number', { ascending: true }),
    ]);

    if (tournamentResult.error) throw tournamentResult.error;
    if (lotsResult.error) throw lotsResult.error;
    if (roundsResult.error) throw roundsResult.error;

    const lots = lotsResult.data || [];
    const rounds = roundsResult.data || [];

    // Collect all team_owner_ids needed for public name lookup only
    const teamOwnerIds = [
      ...new Set(
        lots
          .flatMap((lot) => [
            lot.current_highest_team_owner_id,
            lot.winning_team_owner_id,
          ])
          .filter((id): id is string => typeof id === 'string')
      ),
    ];

    const { data: owners } = teamOwnerIds.length
      ? await supabase
          .from('team_owners')
          .select('id, team_name, owner_name, team_logo_url')
          .in('id', teamOwnerIds)
      : { data: [] };

    const ownerById = new Map((owners || []).map((o) => [o.id, o]));

    const liveLot = lots.find((lot) => lot.status === 'LIVE') || null;
    const recentlySold = lots
      .filter((lot) => lot.status === 'SOLD' && lot.sold_at)
      .sort(
        (a, b) =>
          new Date(b.sold_at!).getTime() - new Date(a.sold_at!).getTime()
      )
      .slice(0, 3);
    const nextLot = lots.find((lot) => lot.status === 'AVAILABLE') || null;

    const currentRound =
      rounds.find((r) => r.status === 'LIVE' || r.status === 'OPEN') ||
      rounds[rounds.length - 1] ||
      null;

    function buildPublicLot(lot: (typeof lots)[number]) {
      const player = Array.isArray(lot.player) ? lot.player[0] : lot.player;
      const reg = Array.isArray(lot.registration)
        ? lot.registration[0]
        : lot.registration;
      const round = Array.isArray(lot.round) ? lot.round[0] : lot.round;
      const liveOwner = lot.current_highest_team_owner_id
        ? ownerById.get(lot.current_highest_team_owner_id)
        : null;
      const winOwner = lot.winning_team_owner_id
        ? ownerById.get(lot.winning_team_owner_id)
        : null;

      return {
        id: lot.id,
        lotNumber: lot.lot_number,
        status: lot.status,
        roundNumber: round?.round_number || null,
        roundType: round?.round_type || null,
        currentBid: lot.current_highest_bid,
        soldAmount: lot.sold_amount,
        soldAt: lot.sold_at,
        bidDeadlineAt: lot.bid_deadline_at,
        // Leading team — only team name, never budget
        currentTeamName:
          liveOwner?.team_name || liveOwner?.owner_name || null,
        currentTeamLogo: liveOwner?.team_logo_url || null,
        // Winning team for sold lots
        winningTeamName:
          winOwner?.team_name || winOwner?.owner_name || null,
        winningTeamLogo: winOwner?.team_logo_url || null,
        // Player info — no private contact info
        player: player
          ? {
              name:
                reg?.registered_name_snapshot ||
                player.full_name ||
                'Player',
              image: player.profile_image_url || null,
              role:
                reg?.registered_role_snapshot ||
                player.cricket_role ||
                null,
              battingStyle:
                reg?.registered_batting_style_snapshot ||
                player.batting_style ||
                null,
            }
          : null,
      };
    }

    return NextResponse.json(
      {
        auction: {
          id: auction.id,
          name: auction.auction_name || tournamentResult.data?.name || 'FPL Auction',
          tournamentName: tournamentResult.data?.name || '',
          status: auction.status,
          baseBid: auction.base_bid,
          bidTimerSeconds: auction.bid_timer_seconds,
          currentRoundNumber: currentRound?.round_number || null,
          currentRoundType: currentRound?.round_type || null,
        },
        liveLot: liveLot ? buildPublicLot(liveLot) : null,
        nextLot: nextLot && !liveLot ? buildPublicLot(nextLot) : null,
        recentlySold: recentlySold.map(buildPublicLot),
        stats: {
          totalLots: lots.length,
          sold: lots.filter((l) => l.status === 'SOLD').length,
          unsold: lots.filter((l) => l.status === 'UNSOLD').length,
          available: lots.filter((l) => l.status === 'AVAILABLE').length,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error) {
    console.error('Live state error', error);
    return NextResponse.json(
      { error: 'Unable to load live auction state' },
      { status: 500 }
    );
  }
}
