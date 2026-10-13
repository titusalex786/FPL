import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildTeamAuctionDashboard,
  resolveDashboardOwner,
  type DashboardAuction,
  type DashboardBudget,
  type DashboardIcon,
  type DashboardPurchase,
  type DashboardTeamOwner,
} from '@/lib/auction/team-dashboard';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ auctionId: string }>;
};

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

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
    const { data: auctionRow, error: auctionError } = await supabase
      .from('auctions')
      .select(
        'id, tournament_id, status, bid_timer_seconds, base_bid, minimum_reserve, bid_threshold, low_increment, high_increment, maximum_bid'
      )
      .eq('id', auctionId)
      .maybeSingle();

    if (auctionError) throw auctionError;
    if (!auctionRow) {
      return NextResponse.json({ error: 'Auction not found' }, { status: 404 });
    }

    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (playerError) throw playerError;
    if (!player) {
      return NextResponse.json(
        { error: 'You are not authorized to view this team.' },
        { status: 403 }
      );
    }

    const { data: ownerRows, error: ownerError } = await supabase
      .from('team_owners')
      .select(
        'id, tournament_id, player_id, owner_name, team_name, team_logo_url, icon_registration_id, icon_player_name, icon_player_role'
      )
      .eq('tournament_id', auctionRow.tournament_id)
      .eq('player_id', player.id);

    if (ownerError) throw ownerError;
    const requestedTeamOwnerId = _request.nextUrl.searchParams.get('teamOwnerId');
    const teamOwner = resolveDashboardOwner(
      player.id,
      auctionRow.tournament_id,
      (ownerRows || []) as DashboardTeamOwner[],
      requestedTeamOwnerId
    );

    if (!teamOwner) {
      return NextResponse.json(
        { error: 'You are not authorized to view this team.' },
        { status: 403 }
      );
    }

    const { data: budget, error: budgetError } = await supabase
      .from('auction_team_budgets')
      .select(
        'starting_kitty, remaining_kitty, required_players_to_buy, players_bought, players_remaining, icon_players_allocated, status'
      )
      .eq('auction_id', auctionId)
      .eq('tournament_id', auctionRow.tournament_id)
      .eq('team_owner_id', teamOwner.id)
      .maybeSingle();

    if (budgetError) throw budgetError;
    if (!budget) {
      return NextResponse.json(
        { error: 'No auction budget is available yet.' },
        { status: 404 }
      );
    }

    let icon: DashboardIcon = {
      allocated:
        budget.icon_players_allocated > 0 ||
        Boolean(teamOwner.icon_registration_id || teamOwner.icon_player_name),
      player_id: null,
      player_name: teamOwner.icon_player_name,
      profile_image_url: null,
      role: teamOwner.icon_player_role,
    };

    if (teamOwner.icon_registration_id) {
      const { data: iconRegistration, error: iconRegistrationError } =
        await supabase
          .from('registrations')
          .select(
            'id, tournament_id, player_id, registered_name_snapshot, registered_role_snapshot'
          )
          .eq('id', teamOwner.icon_registration_id)
          .eq('tournament_id', auctionRow.tournament_id)
          .maybeSingle();

      if (iconRegistrationError) throw iconRegistrationError;

      if (iconRegistration) {
        icon = {
          ...icon,
          player_id: iconRegistration.player_id,
          player_name:
            iconRegistration.registered_name_snapshot || icon.player_name,
          role:
            iconRegistration.registered_role_snapshot || icon.role,
        };

        if (iconRegistration.player_id) {
          const { data: iconPlayer, error: iconPlayerError } = await supabase
            .from('players')
            .select('id, full_name, profile_image_url, cricket_role')
            .eq('id', iconRegistration.player_id)
            .maybeSingle();

          if (iconPlayerError) throw iconPlayerError;
          if (iconPlayer) {
            icon = {
              ...icon,
              player_name: icon.player_name || iconPlayer.full_name,
              profile_image_url: iconPlayer.profile_image_url,
              role: icon.role || iconPlayer.cricket_role,
            };
          }
        }
      }
    }

    const { data: purchaseRows, error: purchasesError } = await supabase
      .from('auction_purchases')
      .select(
        'player_id, winning_bid, player_role, purchase_status, created_at'
      )
      .eq('auction_id', auctionId)
      .eq('tournament_id', auctionRow.tournament_id)
      .eq('team_owner_id', teamOwner.id)
      .order('created_at', { ascending: false });

    if (purchasesError) throw purchasesError;
    const purchases = (purchaseRows || []) as DashboardPurchase[];
    const playerIds = [
      ...new Set(
        purchases
          .map((purchase) => purchase.player_id)
          .filter((id) => id !== icon.player_id)
      ),
    ];

    const playersById = new Map<
      string,
      NonNullable<DashboardPurchase['player']>
    >();
    if (playerIds.length > 0) {
      const { data: players, error: purchasesPlayerError } = await supabase
        .from('players')
        .select('id, full_name, profile_image_url, cricket_role')
        .in('id', playerIds);

      if (purchasesPlayerError) throw purchasesPlayerError;
      for (const purchasedPlayer of players || []) {
        playersById.set(purchasedPlayer.id, {
          full_name: purchasedPlayer.full_name,
          profile_image_url: purchasedPlayer.profile_image_url,
          cricket_role: purchasedPlayer.cricket_role,
        });
      }
    }

    const auction = auctionRow as DashboardAuction;
    const dashboard = buildTeamAuctionDashboard({
      auction,
      teamOwner,
      budget: budget as DashboardBudget,
      icon,
      purchases: purchases.map((purchase) => ({
        ...purchase,
        player: playersById.get(purchase.player_id) || null,
      })),
    });

    return NextResponse.json(dashboard, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('Unable to load team auction dashboard', error);
    return NextResponse.json(
      { error: 'Unable to load the team auction dashboard.' },
      { status: 500 }
    );
  }
}
