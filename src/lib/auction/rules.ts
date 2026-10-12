export interface AuctionRules {
  totalKitty: number;
  totalPlayersToBuy: number;
  baseBid: number;
  minimumReservePerPlayer: number;
  bidThreshold: number;
  lowIncrement: number;
  highIncrement: number;
  maximumBid?: number | null;
  allowOwnerSelfPurchase?: boolean;
}

export const DEFAULT_AUCTION_RULES: Readonly<AuctionRules> = Object.freeze({
  totalKitty: 180000,
  totalPlayersToBuy: 9,
  baseBid: 5000,
  minimumReservePerPlayer: 5000,
  bidThreshold: 20000,
  lowIncrement: 1000,
  highIncrement: 2000,
  maximumBid: null,
  allowOwnerSelfPurchase: false,
});

export const TOTAL_KITTY = DEFAULT_AUCTION_RULES.totalKitty;
export const TOTAL_PLAYERS_TO_BUY = DEFAULT_AUCTION_RULES.totalPlayersToBuy;
export const ICON_PLAYERS_ALLOCATED = 1 as const;
export const BASE_BID = DEFAULT_AUCTION_RULES.baseBid;
export const BID_THRESHOLD = DEFAULT_AUCTION_RULES.bidThreshold;
export const LOW_INCREMENT = DEFAULT_AUCTION_RULES.lowIncrement;
export const HIGH_INCREMENT = DEFAULT_AUCTION_RULES.highIncrement;
export const MINIMUM_RESERVE_PER_PLAYER = DEFAULT_AUCTION_RULES.minimumReservePerPlayer;
const MAX_POSTGRES_INTEGER = 2147483647;

export type BidValidationReason =
  | 'AUCTION_COMPLETE'
  | 'NEGATIVE_REMAINING_BUDGET'
  | 'BID_NOT_POSITIVE'
  | 'BID_NOT_INTEGER'
  | 'BID_TOO_LOW'
  | 'BID_EXCEEDS_MAXIMUM_AFFORDABLE'
  | 'BID_DOES_NOT_FOLLOW_LADDER';

export type BidValidationResult =
  | {
      allowed: true;
      maximumAffordableBid: number;
      nextValidBid: number;
      reason: null;
    }
  | {
      allowed: false;
      maximumAffordableBid: number;
      nextValidBid: number;
      reason: BidValidationReason;
    };

export interface PurchasePlayerResult {
  success: boolean;
  remainingBudget?: number;
  playersBought?: number;
  playersStillNeeded?: number;
  totalPlayers?: number;
  reason?: BidValidationReason | null;
}

export function validateAuctionRules(rules: AuctionRules): string[] {
  const errors: string[] = [];
  const integerFields: Array<Exclude<keyof AuctionRules, 'maximumBid' | 'allowOwnerSelfPurchase'>> = [
    'totalKitty',
    'totalPlayersToBuy',
    'baseBid',
    'minimumReservePerPlayer',
    'bidThreshold',
    'lowIncrement',
    'highIncrement',
  ];

  for (const field of integerFields) {
    if (!Number.isSafeInteger(rules[field]) || rules[field] > MAX_POSTGRES_INTEGER) {
      errors.push(`${field} must be a PostgreSQL integer`);
    }
  }

  if (rules.totalKitty <= 0) errors.push('totalKitty must be greater than zero');
  if (rules.totalPlayersToBuy <= 0) errors.push('totalPlayersToBuy must be greater than zero');
  if (rules.baseBid < 5000) errors.push('baseBid must be at least 5000 for database compatibility');
  if (rules.minimumReservePerPlayer <= 0) {
    errors.push('minimumReservePerPlayer must be greater than zero');
  }
  if (rules.minimumReservePerPlayer < rules.baseBid) {
    errors.push('minimumReservePerPlayer must be at least baseBid');
  }
  if (rules.bidThreshold < rules.baseBid) errors.push('bidThreshold must be at least baseBid');
  if (rules.lowIncrement <= 0) errors.push('lowIncrement must be greater than zero');
  if (rules.highIncrement <= 0) errors.push('highIncrement must be greater than zero');
  if (rules.totalKitty < rules.totalPlayersToBuy * rules.minimumReservePerPlayer) {
    errors.push('totalKitty must cover the reserve for every required player');
  }

  if (rules.maximumBid !== undefined && rules.maximumBid !== null) {
    if (!Number.isSafeInteger(rules.maximumBid) || rules.maximumBid > MAX_POSTGRES_INTEGER) {
      errors.push('maximumBid must be a PostgreSQL integer');
    } else if (rules.maximumBid < rules.baseBid) {
      errors.push('maximumBid must be at least baseBid');
    }
    if (
      rules.allowOwnerSelfPurchase !== undefined
      && typeof rules.allowOwnerSelfPurchase !== 'boolean'
    ) {
      errors.push('allowOwnerSelfPurchase must be a boolean');
    }
  }

  return errors;
}

function assertValidRules(rules: AuctionRules): void {
  const errors = validateAuctionRules(rules);
  if (errors.length > 0) {
    throw new RangeError(`Invalid auction rules: ${errors.join('; ')}`);
  }
}

function normalizePlayersBought(playersBought: number, rules: AuctionRules): number {
  return Number.isFinite(playersBought)
    ? Math.max(0, Math.min(Math.trunc(playersBought), rules.totalPlayersToBuy))
    : 0;
}

export function getMaximumAffordableBid(
  remainingBudget: number,
  playersBought: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): number {
  assertValidRules(rules);
  const normalizedBudget = Number.isFinite(remainingBudget) ? remainingBudget : 0;
  const normalizedPlayersBought = normalizePlayersBought(playersBought, rules);
  const playersRemaining = rules.totalPlayersToBuy - normalizedPlayersBought;

  if (playersRemaining <= 0) return 0;

  const reserveRequired = (playersRemaining - 1) * rules.minimumReservePerPlayer;
  const dynamicMaximum = Math.max(0, normalizedBudget - reserveRequired);
  return rules.maximumBid == null
    ? dynamicMaximum
    : Math.min(dynamicMaximum, rules.maximumBid);
}

export function getNextBid(
  currentBid: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): number {
  assertValidRules(rules);
  const normalizedBid = Number.isFinite(currentBid) ? currentBid : 0;

  if (normalizedBid < rules.baseBid) return rules.baseBid;
  if (normalizedBid < rules.bidThreshold) return normalizedBid + rules.lowIncrement;
  return normalizedBid + rules.highIncrement;
}

export function getBidValidationError(
  proposedBid: number,
  remainingBudget: number,
  playersBought: number,
  currentBid?: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): BidValidationReason | null {
  return isBidAllowed(proposedBid, remainingBudget, playersBought, currentBid, rules).reason;
}

export function isBidAllowed(
  proposedBid: number,
  remainingBudget: number,
  playersBought: number,
  currentBid?: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): BidValidationResult {
  assertValidRules(rules);
  const normalizedPlayersBought = Number.isFinite(playersBought)
    ? Math.max(0, Math.trunc(playersBought))
    : 0;
  const normalizedBudget = Number.isFinite(remainingBudget) ? remainingBudget : 0;
  const maximumAffordableBid = getMaximumAffordableBid(
    normalizedBudget,
    normalizedPlayersBought,
    rules
  );
  const nextValidBid = currentBid !== undefined
    ? getNextBid(currentBid, rules)
    : rules.baseBid;
  const result = (reason: BidValidationReason): BidValidationResult => ({
    allowed: false,
    maximumAffordableBid,
    nextValidBid,
    reason,
  });

  if (normalizedPlayersBought >= rules.totalPlayersToBuy) return result('AUCTION_COMPLETE');
  if (normalizedBudget < 0) return result('NEGATIVE_REMAINING_BUDGET');
  if (!Number.isFinite(proposedBid) || !Number.isInteger(proposedBid)) return result('BID_NOT_INTEGER');
  if (proposedBid <= 0) return result('BID_NOT_POSITIVE');
  if (proposedBid < rules.baseBid) return result('BID_TOO_LOW');
  if (proposedBid > maximumAffordableBid) return result('BID_EXCEEDS_MAXIMUM_AFFORDABLE');
  if (currentBid !== undefined && proposedBid !== nextValidBid) {
    return result('BID_DOES_NOT_FOLLOW_LADDER');
  }

  return { allowed: true, maximumAffordableBid, nextValidBid, reason: null };
}

export function purchasePlayer(
  finalBid: number,
  remainingBudget: number,
  playersBought: number,
  currentBid?: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): PurchasePlayerResult {
  assertValidRules(rules);
  const normalizedBudget = Number.isFinite(remainingBudget) ? remainingBudget : 0;
  const normalizedPlayersBought = normalizePlayersBought(playersBought, rules);
  const playersStillNeeded = Math.max(0, rules.totalPlayersToBuy - normalizedPlayersBought);

  const failure = (reason: BidValidationReason): PurchasePlayerResult => ({
    success: false,
    remainingBudget: normalizedBudget,
    playersBought: normalizedPlayersBought,
    playersStillNeeded,
    totalPlayers: rules.totalPlayersToBuy,
    reason,
  });

  if (normalizedPlayersBought >= rules.totalPlayersToBuy) return failure('AUCTION_COMPLETE');
  if (normalizedBudget < 0) return failure('NEGATIVE_REMAINING_BUDGET');

  const validation = isBidAllowed(
    finalBid,
    normalizedBudget,
    normalizedPlayersBought,
    currentBid,
    rules
  );
  if (!validation.allowed) return failure(validation.reason);

  const nextPlayersBought = normalizedPlayersBought + 1;
  return {
    success: true,
    remainingBudget: normalizedBudget - finalBid,
    playersBought: nextPlayersBought,
    playersStillNeeded: rules.totalPlayersToBuy - nextPlayersBought,
    totalPlayers: rules.totalPlayersToBuy,
  };
}

export function getAuctionBudgetState(
  remainingBudget: number,
  playersBought: number,
  rules: AuctionRules = DEFAULT_AUCTION_RULES
): {
  startingKitty: number;
  remainingBudget: number;
  spentAmount: number;
  playersBought: number;
  playersStillNeeded: number;
  totalPlayersToBuy: number;
  averageAvailableBudgetPerRemainingPlayer: number;
  maximumAffordableBid: number;
  budgetUsedPercentage: number;
} {
  assertValidRules(rules);
  const normalizedBudget = Number.isFinite(remainingBudget) ? Math.max(0, remainingBudget) : 0;
  const normalizedPlayersBought = normalizePlayersBought(playersBought, rules);
  const playersStillNeeded = rules.totalPlayersToBuy - normalizedPlayersBought;
  const spentAmount = rules.totalKitty - normalizedBudget;
  const averageAvailableBudgetPerRemainingPlayer = playersStillNeeded > 0
    ? normalizedBudget / playersStillNeeded
    : 0;
  const maximumAffordableBid = getMaximumAffordableBid(
    normalizedBudget,
    normalizedPlayersBought,
    rules
  );
  const budgetUsedPercentage = Number(((spentAmount / rules.totalKitty) * 100).toFixed(2));

  return {
    startingKitty: rules.totalKitty,
    remainingBudget: normalizedBudget,
    spentAmount,
    playersBought: normalizedPlayersBought,
    playersStillNeeded,
    totalPlayersToBuy: rules.totalPlayersToBuy,
    averageAvailableBudgetPerRemainingPlayer,
    maximumAffordableBid,
    budgetUsedPercentage,
  };
}
