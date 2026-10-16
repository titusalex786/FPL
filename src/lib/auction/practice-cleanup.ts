export interface PracticeCleanupResponse {
  success: boolean;
  practiceAuctionId: string;
  deletedCounts: {
    auctions: number;
    auction_lots: number;
    auction_purchases: number;
    auction_events: number;
    auction_team_budgets: number;
    auction_rounds: number;
    auction_player_selections: number;
  };
  orphanRecords: number;
  finalProtectedCounts: {
    players: number;
    registrations: number;
    payments: number;
    team_owners: number;
  };
  protectedDataUnchanged: boolean;
  error?: string;
}

export async function requestPracticeCleanup(auctionId: string): Promise<PracticeCleanupResponse> {
  const response = await fetch(`/api/admin/auctions/${auctionId}/practice-cleanup`, {
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Practice cleanup failed.');
  }
  return data as PracticeCleanupResponse;
}
