import { getAuctionBudgetState } from '@/lib/auction/rules';

export type DashboardTeamOwner = {
  id: string;
  tournament_id: string;
  player_id: string | null;
  owner_name: string;
  team_name: string | null;
  team_logo_url: string | null;
  icon_registration_id: string | null;
  icon_player_name: string | null;
  icon_player_role: string | null;
};

export type DashboardBudget = {
  starting_kitty: number;
  remaining_kitty: number;
  required_players_to_buy: number;
  players_bought: number;
  players_remaining: number;
  icon_players_allocated: number;
  status: string;
};

export type DashboardPurchase = {
  player_id: string;
  winning_bid: number;
  player_role: string | null;
  purchase_status: string;
  created_at: string;
  player: {
    full_name: string;
    profile_image_url: string | null;
    cricket_role: string | null;
  } | null;
};

export type DashboardAuction = {
  id: string;
  status: string;
  bid_timer_seconds: number;
  base_bid: number;
  minimum_reserve: number;
  bid_threshold: number;
  low_increment: number;
  high_increment: number;
  maximum_bid: number | null;
};

export type DashboardIcon = {
  allocated: boolean;
  player_id: string | null;
  player_name: string | null;
  profile_image_url: string | null;
  role: string | null;
};

export function resolveDashboardOwner(
  authenticatedPlayerId: string | null,
  tournamentId: string,
  owners: DashboardTeamOwner[]
): DashboardTeamOwner | null {
  if (!authenticatedPlayerId) return null;

  const matches = owners.filter(
    (owner) =>
      owner.tournament_id === tournamentId &&
      owner.player_id === authenticatedPlayerId
  );

  return matches.length === 1 ? matches[0] : null;
}

export function buildTeamAuctionDashboard(input: {
  auction: DashboardAuction;
  teamOwner: DashboardTeamOwner;
  budget: DashboardBudget;
  icon: DashboardIcon;
  purchases: DashboardPurchase[];
}) {
  const {
    auction,
    teamOwner,
    budget,
    icon,
    purchases: purchaseRows,
  } = input;
  const rules = {
    totalKitty: budget.starting_kitty,
    totalPlayersToBuy: budget.required_players_to_buy,
    baseBid: auction.base_bid,
    minimumReservePerPlayer: auction.minimum_reserve,
    bidThreshold: auction.bid_threshold,
    lowIncrement: auction.low_increment,
    highIncrement: auction.high_increment,
    maximumBid: auction.maximum_bid,
  };
  const budgetState = getAuctionBudgetState(
    budget.remaining_kitty,
    budget.players_bought,
    rules
  );

  const purchases = purchaseRows
    .filter((purchase) => purchase.player_id !== icon.player_id)
    .map((purchase) => ({
      playerId: purchase.player_id,
      playerName: purchase.player?.full_name || 'Player',
      profileImageUrl: purchase.player?.profile_image_url ?? null,
      role: purchase.player_role || purchase.player?.cricket_role || null,
      winningBid: purchase.winning_bid,
      purchaseStatus: purchase.purchase_status,
      purchasedAt: purchase.created_at,
    }));

  return {
    auction: {
      id: auction.id,
      status: auction.status,
      bidTimerSeconds: auction.bid_timer_seconds,
    },
    team: {
      teamOwnerId: teamOwner.id,
      teamName: teamOwner.team_name || teamOwner.owner_name,
      teamLogo: teamOwner.team_logo_url,
    },
    budget: {
      startingKitty: budget.starting_kitty,
      remainingKitty: budget.remaining_kitty,
      kittyUsed: budget.starting_kitty - budget.remaining_kitty,
      budgetUsedPercent: budgetState.budgetUsedPercentage,
      playersBought: budget.players_bought,
      playersRemaining: budget.players_remaining,
      averageAvailablePerRemainingPlayer:
        budget.players_remaining > 0
          ? budget.remaining_kitty / budget.players_remaining
          : 0,
      maximumAffordableCurrentBid: budgetState.maximumAffordableBid,
      totalSpent: purchases.reduce(
        (total, purchase) =>
          purchase.purchaseStatus === 'COMPLETED'
            ? total + purchase.winningBid
            : total,
        0
      ),
      status: budget.status,
    },
    icon: {
      playerId: icon.player_id,
      playerName: icon.player_name,
      profileImageUrl: icon.profile_image_url,
      role: icon.role,
      status:
        icon.allocated || icon.player_id || icon.player_name
          ? 'PRE_ALLOCATED'
          : 'NOT_ALLOCATED',
    },
    purchases,
  };
}
