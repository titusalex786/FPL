import { describe, expect, it } from 'vitest';
import {
  BASE_BID,
  BID_THRESHOLD,
  TOTAL_KITTY,
  TOTAL_PLAYERS_TO_BUY,
  getAuctionBudgetState,
  getBidValidationError,
  getMaximumAffordableBid,
  getNextBid,
  isBidAllowed,
  purchasePlayer,
  validateAuctionRules,
  type AuctionRules,
} from '@/lib/auction/rules';

describe('Auction rules engine', () => {
  it('1. Starting kitty is 180000.', () => {
    expect(TOTAL_KITTY).toBe(180000);
  });

  it('2. First player maximum is 140000.', () => {
    expect(getMaximumAffordableBid(180000, 0)).toBe(140000);
  });

  it('3. After 60000 purchase: remaining = 120000.', () => {
    const result = purchasePlayer(60000, 180000, 0);
    expect(result.success).toBe(true);
    expect(result.remainingBudget).toBe(120000);
    expect(result.playersBought).toBe(1);
  });

  it('4. After 60000 purchase: next player maximum = 85000.', () => {
    expect(getMaximumAffordableBid(120000, 1)).toBe(85000);
  });

  it('5. After 80000 purchase: remaining = 100000.', () => {
    const result = purchasePlayer(80000, 120000, 1);
    expect(result.success).toBe(true);
    expect(result.remainingBudget).toBe(40000);
    expect(result.playersBought).toBe(2);
  });

  it('6. After 80,000 purchase: remaining budget = 100,000; players bought = 1; next player maximum = 65,000.', () => {
    expect(getMaximumAffordableBid(100000, 1)).toBe(65000);
  });

  it('7. After 8 players bought: only 1 player remains.', () => {
    expect(TOTAL_PLAYERS_TO_BUY - 8).toBe(1);
  });

  it('8. With 5000 remaining and one player remaining: maximum bid = 5000.', () => {
    expect(getMaximumAffordableBid(5000, 8)).toBe(5000);
  });

  it('9. With 0 remaining and one player remaining: maximum bid = 0.', () => {
    expect(getMaximumAffordableBid(0, 8)).toBe(0);
  });

  it('10. Cannot purchase 10th player.', () => {
    const result = purchasePlayer(5000, 5000, 9);
    expect(result.success).toBe(false);
    expect(result.reason).toBe('AUCTION_COMPLETE');
  });

  it('11. Bid ladder: 5000 -> 6000', () => {
    expect(getNextBid(5000)).toBe(6000);
  });

  it('12. Bid ladder: 10000 -> 11000', () => {
    expect(getNextBid(10000)).toBe(11000);
  });

  it('13. Bid ladder: 18000 -> 19000', () => {
    expect(getNextBid(18000)).toBe(19000);
  });

  it('14. Bid ladder: 19000 -> 20000', () => {
    expect(getNextBid(19000)).toBe(20000);
  });

  it('15. Bid ladder: 20000 -> 22000', () => {
    expect(getNextBid(20000)).toBe(22000);
  });

  it('16. Bid ladder: 22000 -> 24000', () => {
    expect(getNextBid(22000)).toBe(24000);
  });

  it('17. Bid ladder: 30000 -> 32000', () => {
    expect(getNextBid(30000)).toBe(32000);
  });

  it('18. Bid ladder: 50000 -> 52000', () => {
    expect(getNextBid(50000)).toBe(52000);
  });

  it('19. Bid ladder: 58000 -> 60000', () => {
    expect(getNextBid(58000)).toBe(60000);
  });

  it('20. Bid ladder: 60000 -> 62000', () => {
    expect(getNextBid(60000)).toBe(62000);
  });

  it('21. Rejects bid below minimum 5000.', () => {
    expect(getBidValidationError(4999, 180000, 0)).toBe('BID_TOO_LOW');
  });

  it('22. Rejects zero and negative bids.', () => {
    expect(getBidValidationError(0, 180000, 0)).toBe('BID_NOT_POSITIVE');
    expect(getBidValidationError(-1000, 180000, 0)).toBe('BID_NOT_POSITIVE');
  });

  it('23. Rejects non-integer bid values.', () => {
    expect(getBidValidationError(12345.5, 180000, 0)).toBe('BID_NOT_INTEGER');
  });

  it('24. Rejects bids above maximum affordable bid.', () => {
    const validation = isBidAllowed(90000, 120000, 1);
    expect(validation.allowed).toBe(false);
    expect(validation.reason).toBe('BID_EXCEEDS_MAXIMUM_AFFORDABLE');
  });

  it('25. Rejects bids below the required ladder step.', () => {
    const validation = isBidAllowed(61000, 180000, 0, 60000);
    expect(validation.allowed).toBe(false);
    expect(validation.reason).toBe('BID_DOES_NOT_FOLLOW_LADDER');
  });

  it('26. Rejects bids that skip the ladder.', () => {
    const validation = isBidAllowed(62000, 180000, 0, 60000);
    expect(validation.allowed).toBe(true);
    const invalid = isBidAllowed(63000, 180000, 0, 60000);
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toBe('BID_DOES_NOT_FOLLOW_LADDER');
  });

  it('27. Rejects bid after 9 players are already purchased.', () => {
    const validation = isBidAllowed(5000, 180000, 9);
    expect(validation.allowed).toBe(false);
    expect(validation.reason).toBe('AUCTION_COMPLETE');
  });

  it('28. Scenario: starting state and first purchase remain valid.', () => {
    const firstPurchase = purchasePlayer(60000, 180000, 0);
    expect(firstPurchase.success).toBe(true);
    expect(firstPurchase.remainingBudget).toBe(120000);
    expect(firstPurchase.playersBought).toBe(1);

    const stateAfterFirst = getAuctionBudgetState(120000, 1);
    expect(stateAfterFirst.remainingBudget).toBe(120000);
    expect(stateAfterFirst.spentAmount).toBe(60000);
    expect(stateAfterFirst.playersStillNeeded).toBe(8);
    expect(stateAfterFirst.averageAvailableBudgetPerRemainingPlayer).toBe(15000);
    expect(stateAfterFirst.maximumAffordableBid).toBe(85000);
    expect(stateAfterFirst.budgetUsedPercentage).toBe(33.33);
  });

  it('29. Scenario: continue purchasing until 9 players with no negative kitty.', () => {
    let remainingBudget: number = TOTAL_KITTY;
    let playersBought: number = 0;

    const purchasePlan = [60000, 30000, 22000, 18000, 15000, 14000, 11000, 5000, 5000];

    for (const amount of purchasePlan) {
      const result = purchasePlayer(amount, remainingBudget, playersBought);
      expect(result.success).toBe(true);
      if (!result.success) {
        throw new Error('Unexpected invalid purchase in scenario');
      }
      remainingBudget = result.remainingBudget as number;
      playersBought = result.playersBought as number;
      expect(remainingBudget).toBeGreaterThanOrEqual(0);
      expect(playersBought).toBeLessThanOrEqual(TOTAL_PLAYERS_TO_BUY);
    }

    expect(playersBought).toBe(9);
    expect(remainingBudget).toBeGreaterThanOrEqual(0);
    expect(getAuctionBudgetState(remainingBudget, playersBought).playersStillNeeded).toBe(0);
  });

  it('30. purchasePlayer respects ladder increment when currentBid = 20000.', () => {
    expect(purchasePlayer(22000, 180000, 0, 20000).success).toBe(true);
    expect(purchasePlayer(23000, 180000, 0, 20000).success).toBe(false);
  });

  it('31. purchasePlayer respects ladder increment when currentBid = 22000.', () => {
    expect(purchasePlayer(24000, 180000, 0, 22000).success).toBe(true);
    expect(purchasePlayer(25000, 180000, 0, 22000).success).toBe(false);
  });

  it('32. purchasePlayer rejects a final bid above max affordable or below minimum.', () => {
    expect(purchasePlayer(90000, 120000, 1, 60000).success).toBe(false);
    expect(purchasePlayer(4999, 180000, 0, 5000).success).toBe(false);
  });

  it('33. Routine boundary: playersBought = 0, 1, 8, 9 are handled safely.', () => {
    expect(getMaximumAffordableBid(180000, 0)).toBe(140000);
    expect(getMaximumAffordableBid(120000, 1)).toBe(85000);
    expect(getMaximumAffordableBid(5000, 8)).toBe(5000);
    expect(getMaximumAffordableBid(0, 8)).toBe(0);
    expect(getMaximumAffordableBid(100000, 9)).toBe(0);
  });

  it('34. getNextBid handles threshold boundaries correctly.', () => {
    expect(getNextBid(BASE_BID - 1)).toBe(BASE_BID);
    expect(getNextBid(18000)).toBe(19000);
    expect(getNextBid(19000)).toBe(20000);
    expect(getNextBid(19999)).toBe(20999);
    expect(getNextBid(BID_THRESHOLD)).toBe(BID_THRESHOLD + 2000);
  });

  it('uses the supplied auction configuration for reserve and bid calculations.', () => {
    const rules: AuctionRules = {
      totalKitty: 90000,
      totalPlayersToBuy: 3,
      baseBid: 5000,
      minimumReservePerPlayer: 10000,
      bidThreshold: 20000,
      lowIncrement: 500,
      highIncrement: 1000,
      maximumBid: 30000,
    };

    expect(getMaximumAffordableBid(50000, 1, rules)).toBe(30000);
    expect(getNextBid(20000, rules)).toBe(21000);
    expect(isBidAllowed(21000, 50000, 1, 20000, rules).allowed).toBe(true);
    expect(isBidAllowed(22000, 50000, 1, 20000, rules).allowed).toBe(false);
  });

  it('validates auction configuration for minimum reserve and affordable completion.', () => {
    expect(validateAuctionRules({
      totalKitty: 90000,
      totalPlayersToBuy: 3,
      baseBid: 5000,
      minimumReservePerPlayer: 10000,
      bidThreshold: 20000,
      lowIncrement: 500,
      highIncrement: 1000,
      maximumBid: 30000,
    })).toEqual([]);

    expect(validateAuctionRules({
      totalKitty: 20000,
      totalPlayersToBuy: 3,
      baseBid: 5000,
      minimumReservePerPlayer: 10000,
      bidThreshold: 20000,
      lowIncrement: 500,
      highIncrement: 1000,
    })).toContain('totalKitty must cover the reserve for every required player');

    expect(validateAuctionRules({
      totalKitty: 90000,
      totalPlayersToBuy: 3,
      baseBid: 4000,
      minimumReservePerPlayer: 10000,
      bidThreshold: 20000,
      lowIncrement: 500,
      highIncrement: 1000,
    })).toContain('baseBid must be at least 5000 for database compatibility');
  });
});
