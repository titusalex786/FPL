import { NextRequest, NextResponse } from 'next/server';
import { checkIsManagerOrAdmin } from '@/lib/auth/is-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EXPECTED_PROTECTED_BASELINE = {
  players: 164,
  registrations: 100,
  payments: 90,
  team_owners: 10,
};

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
        { error: 'You are not authorized to perform practice cleanup.' },
        { status: 403 }
      ),
    };
  }

  return { kind: 'authorized', user: authorization.user };
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ auctionId: string }> }
) {
  try {
    const auth = await authenticatedManager();
    if (auth.kind === 'unauthorized') return auth.response;

    const { auctionId } = await context.params;
    if (!UUID_PATTERN.test(auctionId)) {
      return NextResponse.json({ error: 'Invalid auction ID format.' }, { status: 400 });
    }

    const client = createAdminClient();

    // 1. Fetch auction and verify it is a Practice Auction
    const { data: auction, error: fetchError } = await client
      .from('auctions')
      .select('id, auction_name, status, tournament_id')
      .eq('id', auctionId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: 'Failed to look up auction.' }, { status: 500 });
    }
    if (!auction) {
      return NextResponse.json({ error: 'Auction not found.' }, { status: 404 });
    }

    const isPractice = Boolean(auction.auction_name?.startsWith('[PRACTICE]'));
    if (!isPractice) {
      return NextResponse.json(
        { error: 'Only practice auctions (tagged [PRACTICE]) can be cleaned up using this action.' },
        { status: 400 }
      );
    }

    // 2. Pre-cleanup Safety Check: Count protected tables
    const [playersBefore, regsBefore, paymentsBefore, ownersBefore] = await Promise.all([
      client.from('players').select('*', { count: 'exact', head: true }),
      client.from('registrations').select('*', { count: 'exact', head: true }),
      client.from('payments').select('*', { count: 'exact', head: true }),
      client.from('team_owners').select('*', { count: 'exact', head: true }),
    ]);

    const currentProtected = {
      players: playersBefore.count ?? 0,
      registrations: regsBefore.count ?? 0,
      payments: paymentsBefore.count ?? 0,
      team_owners: ownersBefore.count ?? 0,
    };

    if (
      currentProtected.players !== EXPECTED_PROTECTED_BASELINE.players ||
      currentProtected.registrations !== EXPECTED_PROTECTED_BASELINE.registrations ||
      currentProtected.payments !== EXPECTED_PROTECTED_BASELINE.payments ||
      currentProtected.team_owners !== EXPECTED_PROTECTED_BASELINE.team_owners
    ) {
      return NextResponse.json(
        {
          error: 'PROTECTED_DATA_MISMATCH: Protected table counts do not match baseline. Cleanup aborted to protect database.',
          baseline: EXPECTED_PROTECTED_BASELINE,
          current: currentProtected,
        },
        { status: 422 }
      );
    }

    // 3. Count records created during practice before deleting
    const [
      purchasesCount,
      eventsCount,
      lotsCount,
      roundsCount,
      selectionsCount,
      budgetsCount,
    ] = await Promise.all([
      client.from('auction_purchases').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_events').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_lots').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_rounds').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_player_selections').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_team_budgets').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
    ]);

    const practiceRecordCounts = {
      auctions: 1,
      auction_lots: lotsCount.count ?? 0,
      auction_purchases: purchasesCount.count ?? 0,
      auction_events: eventsCount.count ?? 0,
      auction_team_budgets: budgetsCount.count ?? 0,
      auction_rounds: roundsCount.count ?? 0,
      auction_player_selections: selectionsCount.count ?? 0,
    };

    // 4. Safe Deletion of ONLY practice auction records (cascade delete through FKs)
    await client.from('auctions').delete().eq('id', auctionId);

    // 5. Post-Cleanup Verification: No orphan auction records
    const [
      orphanAuctions,
      orphanLots,
      orphanPurchases,
      orphanEvents,
      orphanBudgets,
      orphanRounds,
      orphanSelections,
      playersAfter,
      regsAfter,
      paymentsAfter,
      ownersAfter,
    ] = await Promise.all([
      client.from('auctions').select('*', { count: 'exact', head: true }).eq('id', auctionId),
      client.from('auction_lots').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_purchases').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_events').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_team_budgets').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_rounds').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('auction_player_selections').select('*', { count: 'exact', head: true }).eq('auction_id', auctionId),
      client.from('players').select('*', { count: 'exact', head: true }),
      client.from('registrations').select('*', { count: 'exact', head: true }),
      client.from('payments').select('*', { count: 'exact', head: true }),
      client.from('team_owners').select('*', { count: 'exact', head: true }),
    ]);

    const totalOrphanRecords =
      (orphanAuctions.count ?? 0) +
      (orphanLots.count ?? 0) +
      (orphanPurchases.count ?? 0) +
      (orphanEvents.count ?? 0) +
      (orphanBudgets.count ?? 0) +
      (orphanRounds.count ?? 0) +
      (orphanSelections.count ?? 0);

    const finalProtected = {
      players: playersAfter.count ?? 0,
      registrations: regsAfter.count ?? 0,
      payments: paymentsAfter.count ?? 0,
      team_owners: ownersAfter.count ?? 0,
    };

    const protectedDataUnchanged =
      finalProtected.players === EXPECTED_PROTECTED_BASELINE.players &&
      finalProtected.registrations === EXPECTED_PROTECTED_BASELINE.registrations &&
      finalProtected.payments === EXPECTED_PROTECTED_BASELINE.payments &&
      finalProtected.team_owners === EXPECTED_PROTECTED_BASELINE.team_owners;

    return NextResponse.json({
      success: true,
      practiceAuctionId: auctionId,
      deletedCounts: practiceRecordCounts,
      orphanRecords: totalOrphanRecords,
      finalProtectedCounts: finalProtected,
      protectedDataUnchanged,
    });
  } catch (error) {
    console.error('Practice cleanup error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Practice cleanup failed.' },
      { status: 500 }
    );
  }
}
