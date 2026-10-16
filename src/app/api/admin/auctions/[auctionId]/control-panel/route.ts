import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/is-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuctionBudgetState } from '@/lib/auction/rules';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

type DbError = { message: string; code?: string };

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function failureStatus(error: unknown) {
  if (hasErrorCode(error, 'P0002')) return 404;
  if (hasErrorCode(error, '42501')) return 403;
  if (hasErrorCode(error, '22023')) return 400;
  if (hasErrorCode(error, '55000')) return 409;
  return 500;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const server = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await server.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  try {
    await requireManager();
  } catch {
    return NextResponse.json(
      { error: 'You are not authorized to manage this auction.' },
      { status: 403 }
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
        'id, tournament_id, auction_name, status, starting_kitty, required_players_to_buy, icon_players_allocated, base_bid, bid_threshold, low_increment, high_increment, minimum_reserve, maximum_bid, allow_owner_self_purchase, bid_timer_seconds'
      )
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    const [
      tournamentResult,
      budgetsResult,
      lotsResult,
      roundsResult,
      selectionsResult,
      purchasesResult,
      eventsResult,
    ] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, name')
        .eq('id', auction.tournament_id)
        .maybeSingle(),
      supabase
        .from('auction_team_budgets')
        .select(
          'team_owner_id, starting_kitty, remaining_kitty, players_bought, players_remaining, required_players_to_buy, status'
        )
        .eq('auction_id', auctionId)
        .eq('tournament_id', auction.tournament_id),
      supabase
        .from('auction_lots')
        .select(`
          id, registration_id, player_id, lot_number, status, round_id,
          current_highest_bid, current_highest_team_owner_id,
          winning_team_owner_id, sold_amount, sold_at, bid_deadline_at,
          registration:registrations (
            registered_name_snapshot, registered_role_snapshot,
            registered_batting_style_snapshot, registered_bowling_style_snapshot,
            registered_jersey_size_snapshot
          )
        `)
        .eq('auction_id', auctionId)
        .order('lot_number', { ascending: true }),
      supabase
        .from('auction_rounds')
        .select('id, round_number, round_type, status, started_at, completed_at')
        .eq('auction_id', auctionId)
        .order('round_number', { ascending: true }),
      supabase
        .from('auction_player_selections')
        .select(`
          id, registration_id, player_id, candidate_type, selection_status,
          reason,
          registration:registrations (registered_name_snapshot, registered_role_snapshot)
        `)
        .eq('auction_id', auctionId)
        .order('candidate_type', { ascending: true })
        .order('player_id', { ascending: true }),
      supabase
        .from('auction_purchases')
        .select('team_owner_id, winning_bid, purchase_status')
        .eq('auction_id', auctionId)
        .eq('tournament_id', auction.tournament_id),
      supabase
        .from('auction_events')
        .select('id, team_owner_id, player_id, event_type, event_payload, amount, created_at')
        .eq('auction_id', auctionId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    const queryErrors: Array<DbError | null> = [
      tournamentResult.error,
      budgetsResult.error,
      lotsResult.error,
      roundsResult.error,
      selectionsResult.error,
      purchasesResult.error,
      eventsResult.error,
    ];
    const firstError = queryErrors.find((error) => error !== null);
    if (firstError) throw firstError;

    const budgets = budgetsResult.data || [];
    const lots = lotsResult.data || [];
    const rounds = roundsResult.data || [];
    const selections = selectionsResult.data || [];
    const purchases = purchasesResult.data || [];
    const events = eventsResult.data || [];
    const roundById = new Map(rounds.map((round) => [round.id, round]));

    const missingPlayerIds = [
      ...new Set([
        ...lots
          .filter((lot) => !lot.registration && lot.player_id)
          .map((lot) => lot.player_id),
        ...selections
          .filter((selection) => !selection.registration && selection.player_id)
          .map((selection) => selection.player_id),
      ].filter((id): id is string => typeof id === 'string')),
    ];

    const { data: fallbackPlayers, error: fallbackPlayersError } = missingPlayerIds.length > 0
      ? await supabase
          .from('players')
          .select('id, full_name, profile_image_url, cricket_role, batting_style, jersey_size')
          .in('id', missingPlayerIds)
      : { data: [], error: null };
    if (fallbackPlayersError) throw fallbackPlayersError;
    const playerById = new Map((fallbackPlayers || []).map((p) => [p.id, p]));

    const ownerIds = [
      ...new Set([
        ...budgets.map((budget) => budget.team_owner_id),
        ...lots.flatMap((lot) => [
          lot.current_highest_team_owner_id,
          lot.winning_team_owner_id,
        ]),
        ...events.map((event) => event.team_owner_id),
      ].filter((id): id is string => typeof id === 'string')),
    ];

    const { data: owners, error: ownersError } = ownerIds.length
      ? await supabase
          .from('team_owners')
          .select('id, owner_name, team_name, team_logo_url')
          .in('id', ownerIds)
      : { data: [], error: null };
    if (ownersError) throw ownersError;
    const ownerById = new Map((owners || []).map((owner) => [owner.id, owner]));

    const teamBudgets = budgets.map((budget) => {
      const rulesState = getAuctionBudgetState(
        budget.remaining_kitty,
        budget.players_bought,
        {
          totalKitty: budget.starting_kitty,
          totalPlayersToBuy: budget.required_players_to_buy,
          baseBid: auction.base_bid,
          minimumReservePerPlayer: auction.minimum_reserve,
          bidThreshold: auction.bid_threshold,
          lowIncrement: auction.low_increment,
          highIncrement: auction.high_increment,
          maximumBid: auction.maximum_bid,
        }
      );
      const owner = ownerById.get(budget.team_owner_id);
      return {
        teamOwnerId: budget.team_owner_id,
        teamName: owner?.team_name || owner?.owner_name || 'Team',
        ownerName: owner?.owner_name || 'Owner',
        teamLogo: owner?.team_logo_url || null,
        startingKitty: budget.starting_kitty,
        remainingKitty: budget.remaining_kitty,
        kittyUsed: budget.starting_kitty - budget.remaining_kitty,
        budgetUsedPercent: rulesState.budgetUsedPercentage,
        playersBought: budget.players_bought,
        playersRemaining: budget.players_remaining,
        averageAvailablePerRemainingPlayer:
          budget.players_remaining > 0
            ? budget.remaining_kitty / budget.players_remaining
            : 0,
        maximumAffordableCurrentBid: rulesState.maximumAffordableBid,
        status: budget.status,
      };
    });

    const liveLot = lots.find((lot) => lot.status === 'LIVE') || null;
    let liveLotImage: string | null = null;
    if (liveLot?.registration_id) {
      const { data: regImage } = await supabase
        .from('registrations')
        .select('registered_image_snapshot')
        .eq('id', liveLot.registration_id)
        .maybeSingle();
      liveLotImage = regImage?.registered_image_snapshot || null;
    }

    let bidHistory: Array<{
      id: string;
      teamName: string;
      amount: number | null;
      eventType: string;
      createdAt: string;
    }> = [];
    if (liveLot) {
      const { data: bidEvents, error: bidEventsError } = await supabase
        .from('auction_events')
        .select('id, team_owner_id, event_type, amount, created_at')
        .eq('auction_id', auctionId)
        .eq('event_type', 'BID_PLACED')
        .contains('event_payload', { lot_id: liveLot.id })
        .order('created_at', { ascending: true })
        .limit(100);
      if (bidEventsError) throw bidEventsError;
      bidHistory = (bidEvents || []).map((event) => ({
        id: event.id,
        teamName: event.team_owner_id
          ? ownerById.get(event.team_owner_id)?.team_name ||
            ownerById.get(event.team_owner_id)?.owner_name ||
            'Team'
          : 'Team',
        amount: event.amount,
        eventType: event.event_type,
        createdAt: event.created_at,
      }));
    }

    const roundSummaries = rounds.map((round) => {
      const roundLots = lots.filter((lot) => lot.round_id === round.id);
      return {
        id: round.id,
        roundNumber: round.round_number,
        roundType: round.round_type,
        status: round.status,
        players: roundLots.length,
        sold: roundLots.filter((lot) => lot.status === 'SOLD').length,
        unsold: roundLots.filter((lot) => lot.status === 'UNSOLD').length,
        available: roundLots.filter((lot) => lot.status === 'AVAILABLE').length,
      };
    });
    const currentRound =
      (liveLot && roundSummaries.find((round) => round.id === liveLot.round_id)) ||
      roundSummaries.find((round) => round.status === 'OPEN' || round.status === 'LIVE') ||
      roundSummaries[roundSummaries.length - 1] ||
      null;
    const retryPoolRemaining = lots.filter((lot) => {
      const round = roundById.get(lot.round_id);
      return round?.round_type === 'UNSOLD_RETRY' && lot.status === 'AVAILABLE';
    }).length;
    const totalMoneySpent = purchases.reduce(
      (total, purchase) =>
        purchase.purchase_status === 'COMPLETED'
          ? total + purchase.winning_bid
          : total,
      0
    );
    const configurationLocked =
      !['DRAFT', 'OPEN'].includes(auction.status) ||
      budgets.length > 0 ||
      purchases.length > 0 ||
      lots.some((lot) => lot.status !== 'AVAILABLE');

    const { data: tournament } = tournamentResult;
    return NextResponse.json(
      {
        auction: {
          id: auction.id,
          name: auction.auction_name || tournament?.name || 'Auction',
          tournamentName: tournament?.name || 'Tournament',
          status: auction.status,
          currentRoundNumber: currentRound?.roundNumber || null,
          configuration: {
            startingKitty: auction.starting_kitty,
            totalPlayersToBuy: auction.required_players_to_buy,
            iconPlayersAllocated: auction.icon_players_allocated,
            baseBid: auction.base_bid,
            bidThreshold: auction.bid_threshold,
            lowIncrement: auction.low_increment,
            highIncrement: auction.high_increment,
            minimumReserve: auction.minimum_reserve,
            maximumBid: auction.maximum_bid,
            bidTimerSeconds: auction.bid_timer_seconds,
            allowOwnerSelfPurchase: auction.allow_owner_self_purchase,
          },
          configurationLocked,
        },
        overview: {
          playersSold: lots.filter((lot) => lot.status === 'SOLD').length,
          playersUnsold: lots.filter((lot) => lot.status === 'UNSOLD').length,
          retryPoolRemaining,
          totalMoneySpent,
        },
        teams: teamBudgets,
        lots: lots.map((lot) => {
          const liveOwner = lot.current_highest_team_owner_id
            ? ownerById.get(lot.current_highest_team_owner_id)
            : null;
          const winningOwner = lot.winning_team_owner_id
            ? ownerById.get(lot.winning_team_owner_id)
            : null;
          const registration = Array.isArray(lot.registration)
            ? lot.registration[0]
            : lot.registration;
          const fallbackPlayer = lot.player_id ? playerById.get(lot.player_id) : null;
          const round = roundById.get(lot.round_id);
          return {
            id: lot.id,
            registrationId: lot.registration_id,
            playerId: lot.player_id,
            lotNumber: lot.lot_number,
            status: lot.status,
            roundId: lot.round_id,
            roundNumber: round?.round_number || null,
            roundType: round?.round_type || null,
            currentBid: lot.current_highest_bid,
            currentTeamOwnerId: lot.current_highest_team_owner_id,
            currentTeamName: liveOwner?.team_name || liveOwner?.owner_name || null,
            winningTeamName: winningOwner?.team_name || winningOwner?.owner_name || null,
            soldAmount: lot.sold_amount,
            soldAt: lot.sold_at,
            bidDeadlineAt: lot.bid_deadline_at,
            player: (registration || fallbackPlayer || lot.player_id)
              ? {
                  id: fallbackPlayer?.id || lot.player_id,
                  name:
                    registration?.registered_name_snapshot ||
                    fallbackPlayer?.full_name ||
                    'Player',
                  image:
                    lot.status === 'LIVE'
                      ? liveLotImage || fallbackPlayer?.profile_image_url || null
                      : null,
                  role:
                    registration?.registered_role_snapshot ||
                    fallbackPlayer?.cricket_role ||
                    null,
                  battingStyle:
                    registration?.registered_batting_style_snapshot ||
                    fallbackPlayer?.batting_style ||
                    null,
                  bowlingStyle:
                    registration?.registered_bowling_style_snapshot || null,
                  jerseySize:
                    registration?.registered_jersey_size_snapshot ||
                    fallbackPlayer?.jersey_size ||
                    null,
                }
              : null,
          };
        }),
        rounds: roundSummaries,
        selections: selections.map((selection) => {
          const registration = Array.isArray(selection.registration)
            ? selection.registration[0]
            : selection.registration;
          const fallbackPlayer = selection.player_id
            ? playerById.get(selection.player_id)
            : null;
          return {
            id: selection.id,
            registrationId: selection.registration_id,
            playerId: selection.player_id,
            candidateType: selection.candidate_type,
            selectionStatus: selection.selection_status,
            reason: selection.reason,
            playerName:
              registration?.registered_name_snapshot ||
              fallbackPlayer?.full_name ||
              'Player',
            role:
              registration?.registered_role_snapshot ||
              fallbackPlayer?.cricket_role ||
              null,
          };
        }),
        liveLotId: liveLot?.id || null,
        bidHistory,
        events: events.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          playerId: event.player_id,
          teamName: event.team_owner_id
            ? ownerById.get(event.team_owner_id)?.team_name ||
              ownerById.get(event.team_owner_id)?.owner_name ||
              null
            : null,
          amount: event.amount,
          payload: event.event_payload,
          createdAt: event.created_at,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('Unable to load auction control panel', error);
    return NextResponse.json(
      { error: 'Unable to load auction control data.' },
      { status: failureStatus(error) }
    );
  }
}
