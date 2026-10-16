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
          id, registration_id, player_id, lot_number, status,
          current_highest_bid, current_highest_team_owner_id,
          winning_team_owner_id, sold_amount, sold_at, bid_deadline_at, paused_remaining_seconds,
          round_id,
          registration:registrations (
            registered_name_snapshot, registered_role_snapshot,
            registered_batting_style_snapshot, registered_bowling_style_snapshot
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
    const roundById = new Map((rounds || []).map((r) => [r.id, r]));

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

    const displayedLots = [
      liveLot,
      ...recentlySold,
    ].filter((lot): lot is NonNullable<typeof lot> => lot !== null);

    const displayedRegIds = [
      ...new Set(
        displayedLots
          .map((lot) => lot.registration_id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ];
    const { data: regImages, error: regImagesError } = displayedRegIds.length > 0
      ? await supabase
          .from('registrations')
          .select('id, registered_image_snapshot')
          .in('id', displayedRegIds)
      : { data: [], error: null };
    if (regImagesError) throw regImagesError;
    const imageByRegId = new Map(
      (regImages || []).map((img) => [img.id, img.registered_image_snapshot])
    );

    const missingPlayerIds = [
      ...new Set(
        displayedLots
          .filter((lot) => !lot.registration && lot.player_id)
          .map((lot) => lot.player_id)
          .filter((id): id is string => typeof id === 'string')
      ),
    ];
    const { data: fallbackPlayers, error: fallbackPlayersError } = missingPlayerIds.length > 0
      ? await supabase
          .from('players')
          .select('id, full_name, profile_image_url, cricket_role, batting_style')
          .in('id', missingPlayerIds)
      : { data: [], error: null };
    if (fallbackPlayersError) throw fallbackPlayersError;
    const playerById = new Map((fallbackPlayers || []).map((p) => [p.id, p]));

    function buildPublicLot(lot: (typeof lots)[number]) {
      const rawLot = lot as Record<string, unknown>;
      const playerMock = Array.isArray(rawLot.player)
        ? rawLot.player[0]
        : (rawLot.player as Record<string, unknown> | null);
      const reg = Array.isArray(lot.registration)
        ? lot.registration[0]
        : lot.registration;
      const fallbackPlayer = playerMock || (lot.player_id ? playerById.get(lot.player_id) : null);
      const roundMock = Array.isArray(rawLot.round)
        ? rawLot.round[0]
        : (rawLot.round as Record<string, unknown> | null);
      const round = roundMock || roundById.get(lot.round_id);
      const liveOwner = lot.current_highest_team_owner_id
        ? ownerById.get(lot.current_highest_team_owner_id)
        : null;
      const winOwner = lot.winning_team_owner_id
        ? ownerById.get(lot.winning_team_owner_id)
        : null;

      const playerImage =
        (lot.registration_id ? imageByRegId.get(lot.registration_id) : null) ||
        (reg as { registered_image_snapshot?: string } | null)?.registered_image_snapshot ||
        (fallbackPlayer as { profile_image_url?: string } | null)?.profile_image_url ||
        null;

      return {
        id: lot.id,
        lotNumber: lot.lot_number,
        status: lot.status,
        roundNumber: (round as { round_number?: number } | null)?.round_number || null,
        roundType: (round as { round_type?: string } | null)?.round_type || null,
        currentBid: lot.current_highest_bid,
        soldAmount: lot.sold_amount,
        soldAt: lot.sold_at,
        bidDeadlineAt: lot.bid_deadline_at,
        pausedRemainingSeconds: (lot as any).paused_remaining_seconds ?? null,
        // Leading team — only team name, team logos explicitly excluded from projector
        currentTeamName:
          liveOwner?.team_name || liveOwner?.owner_name || null,
        currentTeamLogo: null,
        // Winning team for sold lots
        winningTeamName:
          winOwner?.team_name || winOwner?.owner_name || null,
        winningTeamLogo: null,
        // Player info — registration-specific details prioritized over shared player record
        player: (playerMock || reg || fallbackPlayer || lot.player_id)
          ? {
              name:
                reg?.registered_name_snapshot ||
                (fallbackPlayer as { full_name?: string } | null)?.full_name ||
                'Player',
              image: playerImage,
              role:
                reg?.registered_role_snapshot ||
                (fallbackPlayer as { cricket_role?: string } | null)?.cricket_role ||
                null,
              battingStyle:
                reg?.registered_batting_style_snapshot ||
                (fallbackPlayer as { batting_style?: string } | null)?.batting_style ||
                null,
              bowlingStyle:
                reg?.registered_bowling_style_snapshot ||
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
        nextLot: null,
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
