'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { getNextBid } from '@/lib/auction/rules';
import { useAuctionRealtime } from '@/lib/auction/use-auction-realtime';

type RouteParams = { auctionId: string };

type TeamDashboard = {
  auction: {
    id: string;
    status: string;
    bidTimerSeconds: number;
  };
  team: {
    teamName: string;
    teamLogo: string | null;
  };
  budget: {
    startingKitty: number;
    remainingKitty: number;
    kittyUsed: number;
    playersBought: number;
    playersRemaining: number;
    averageAvailablePerRemainingPlayer: number;
    maximumAffordableCurrentBid: number;
  };
  icon: {
    playerName: string | null;
    profileImageUrl: string | null;
    role: string | null;
    status: 'PRE_ALLOCATED' | 'NOT_ALLOCATED';
  };
  purchases: Array<{
    playerId: string;
    playerName: string;
    profileImageUrl: string | null;
    role: string | null;
    winningBid: number;
    purchaseStatus: string;
    purchasedAt: string;
  }>;
};

type BidRules = {
  baseBid: number;
  bidThreshold: number;
  lowIncrement: number;
  highIncrement: number;
  minimumReserve: number;
  maximumBid: number | null;
  bidTimerSeconds: number;
};

type BiddingState = {
  auction: {
    id: string;
    status: string;
    rules: BidRules;
  };
  liveLot: {
    lotId: string;
    lotNumber: number;
    status: string;
    currentBid: number | null;
    highestBidderName: string | null;
    isHighestBidder: boolean;
    bidDeadlineAt: string | null;
    roundNumber: number | null;
    roundType: string | null;
    player: {
      name: string;
      image: string | null;
      role: string | null;
      battingStyle: string | null;
      bowlingStyle: string | null;
      jerseySize: string | null;
    } | null;
  } | null;
  bidHistory: Array<{
    amount: number | null;
    teamName: string;
    createdAt: string;
  }>;
};

type ApiError = {
  error?: string;
  errorCode?: string;
};

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number | null | undefined) {
  return typeof value === 'number' ? currency.format(value) : '—';
}

function userFacingApiError(status: number, payload: ApiError, fallback: string) {
  if (status === 401) return 'Please sign in to join this auction.';
  if (status === 403) return 'You are not authorized to bid in this auction.';
  if (payload.errorCode === 'BID_NOT_HIGHER_THAN_CURRENT') {
    return 'You have been outbid. The latest auction state has been refreshed.';
  }
  if (payload.errorCode === 'BID_DEADLINE_EXPIRED') {
    return 'The bidding timer has expired.';
  }
  return payload.error || fallback;
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-base font-black text-white sm:text-lg">{value}</p>
    </div>
  );
}

export default function OwnerAuctionBiddingPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { auctionId } = use(params);
  const [bidding, setBidding] = useState<BiddingState | null>(null);
  const [dashboard, setDashboard] = useState<TeamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const expiredLotRef = useRef<string | null>(null);

  const refresh = useCallback(async (initial = false): Promise<BiddingState | null> => {
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return null;
    }
    refreshInFlight.current = true;
    if (initial) setLoading(true);
    else setRefreshing(true);

    try {
      const [bidResponse, dashboardResponse] = await Promise.all([
        fetch(`/api/auctions/${auctionId}/bid`, { cache: 'no-store' }),
        fetch(`/api/auctions/${auctionId}/team-dashboard`, { cache: 'no-store' }),
      ]);
      const [bidPayload, dashboardPayload] = await Promise.all([
        bidResponse.json() as Promise<BiddingState & ApiError>,
        dashboardResponse.json() as Promise<TeamDashboard & ApiError>,
      ]);

      if (!bidResponse.ok) {
        throw new Error(
          userFacingApiError(
            bidResponse.status,
            bidPayload,
            'Unable to load the live auction.'
          )
        );
      }
      if (!dashboardResponse.ok) {
        throw new Error(
          userFacingApiError(
            dashboardResponse.status,
            dashboardPayload,
            'Unable to load your team budget.'
          )
        );
      }

      setBidding(bidPayload);
      setDashboard(dashboardPayload);
      setError(null);
      return bidPayload;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load the live auction. Please try again.'
      );
      return null;
    } finally {
      refreshInFlight.current = false;
      setLoading(false);
      setRefreshing(false);
      if (refreshQueued.current) {
        refreshQueued.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  }, [auctionId]);

  const connectionStatus = useAuctionRealtime(auctionId, refresh, 10000);

  useEffect(() => {
    void refresh(true);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(clock);
    };
  }, [refresh]);

  const lot = bidding?.liveLot || null;
  const rules = bidding?.auction.rules;
  const nextBid = rules ? getNextBid(lot?.currentBid ?? 0, {
    totalKitty: dashboard?.budget.startingKitty || 1,
    totalPlayersToBuy: 1,
    baseBid: rules.baseBid,
    minimumReservePerPlayer: rules.minimumReserve,
    bidThreshold: rules.bidThreshold,
    lowIncrement: rules.lowIncrement,
    highIncrement: rules.highIncrement,
    maximumBid: rules.maximumBid,
  }) : null;
  const maximumAffordable = dashboard?.budget.maximumAffordableCurrentBid ?? 0;
  const secondsRemaining = lot?.bidDeadlineAt
    ? Math.max(0, Math.ceil((Date.parse(lot.bidDeadlineAt) - now) / 1000))
    : null;
  const auctionAcceptsBids = bidding?.auction.status === 'LIVE' && lot?.status === 'LIVE';
  const quotaComplete = (dashboard?.budget.playersRemaining ?? 0) <= 0;
  const bidIsAffordable = nextBid !== null && nextBid <= maximumAffordable;
  const canBid =
    Boolean(auctionAcceptsBids) &&
    !quotaComplete &&
    secondsRemaining !== null &&
    secondsRemaining > 0 &&
    bidIsAffordable;

  useEffect(() => {
    if (!lot || secondsRemaining !== 0 || expiredLotRef.current === lot.lotId) return;
    expiredLotRef.current = lot.lotId;
    void refresh();
  }, [lot, refresh, secondsRemaining]);

  const leadingStatus = useMemo(() => {
    if (!lot || !dashboard) return null;
    if (lot.isHighestBidder) return 'YOU ARE LEADING';
    if (lot.currentBid !== null) {
      return 'You have been outbid.';
    }
    return 'No team has placed a bid yet.';
  }, [dashboard, lot]);

  async function placeBid() {
    if (!lot || nextBid === null || !canBid || submitting) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/auctions/${auctionId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId: lot.lotId, proposedBid: nextBid }),
      });
      const result = (await response.json()) as ApiError;
      if (!response.ok) {
        const freshState = await refresh();
        const errorMessage =
          result.errorCode === 'BID_NOT_HIGHER_THAN_CURRENT' &&
          freshState?.liveLot?.currentBid !== null &&
          freshState?.liveLot?.currentBid !== undefined
            ? `You have been outbid. Current bid: ${formatCurrency(freshState.liveLot.currentBid)}.`
            : userFacingApiError(
                response.status,
                result,
                'Your bid could not be accepted. Please refresh and try again.'
              );
        throw new Error(
          errorMessage
        );
      }
      await refresh();
      setNotice('Bid placed successfully.');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your bid could not be accepted. Please refresh and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && (!bidding || !dashboard)) {
    return (
      <main className="flex min-h-screen items-center justify-center gap-3 bg-slate-950 px-4 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
        Loading live auction…
      </main>
    );
  }

  if (!dashboard || !bidding) {
    return (
      <main className="mx-auto min-h-screen max-w-xl bg-slate-950 px-4 py-10 text-slate-100">
        <div className="rounded-2xl border border-rose-900 bg-rose-950/40 p-5">
          <AlertCircle className="h-6 w-6 text-rose-300" />
          <p role="alert" className="mt-3 text-sm text-rose-100">
            {error || 'Unable to load this auction.'}
          </p>
          <div className="mt-4 flex gap-3">
            {error?.toLowerCase().includes('sign in') && (
              <Link
                href={`/auth/login?redirect=/auction/${auctionId}/bid`}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white"
              >
                Sign in
              </Link>
            )}
            <button
              onClick={() => void refresh(true)}
              className="rounded-lg border border-rose-700 px-4 py-2 text-sm font-bold text-rose-100"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { team, budget, icon, purchases } = dashboard;
  const timerExpired = secondsRemaining === 0;

  return (
    <main className="min-h-screen bg-slate-950 px-3 pb-36 pt-4 text-slate-100 sm:px-6 sm:pb-32 sm:pt-8">
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/auction/${auctionId}/dashboard`}
              aria-label="Back to team dashboard"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            {team.teamLogo ? (
              <Image
                src={team.teamLogo}
                alt=""
                width={44}
                height={44}
                unoptimized
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-900 font-black text-emerald-100">
                {team.teamName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-white">{team.teamName}</p>
              <p className="text-xs text-slate-400">FPL Auction · {bidding.auction.status}</p>
            </div>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={refreshing || submitting}
            aria-label="Refresh auction"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-900 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </header>

        <div className="flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span className={`h-2 w-2 rounded-full ${
            connectionStatus === 'LIVE'
              ? 'bg-emerald-400'
              : connectionStatus === 'OFFLINE'
                ? 'bg-rose-400'
                : 'animate-pulse bg-amber-300'
          }`} />
          {connectionStatus === 'LIVE'
            ? 'LIVE'
            : connectionStatus === 'OFFLINE'
              ? 'OFFLINE — RECONNECTING'
              : 'RECONNECTING…'}
        </div>

        {error && (
          <div role="alert" className="flex gap-2 rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-sm text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {notice && (
          <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm font-semibold text-emerald-200">
            {notice}
          </p>
        )}

        <section aria-label="Your team budget" className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/50 to-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-200/70">Kitty remaining</p>
              <p className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl">
                {formatCurrency(budget.remainingKitty)}
              </p>
            </div>
            <Wallet className="h-7 w-7 text-emerald-300" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Players bought" value={`${budget.playersBought}`} />
            <Metric label="Players remaining" value={`${budget.playersRemaining}`} />
            <Metric label="Average available" value={formatCurrency(budget.averageAvailablePerRemainingPlayer)} />
            <Metric label="Max affordable" value={formatCurrency(maximumAffordable)} />
          </div>
        </section>

        {lot ? (
          <section aria-label="Current player" className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
            <div className="relative flex min-h-52 items-center justify-center bg-slate-800 sm:min-h-64">
              {lot.player?.image ? (
                <Image
                  src={lot.player.image}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="(max-width: 768px) 100vw, 768px"
                />
              ) : (
                <Users className="h-14 w-14 text-slate-600" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/10 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-200">
                  <span>Lot {lot.lotNumber}</span>
                  {lot.roundNumber && <span>· Round {lot.roundNumber}</span>}
                  {lot.roundType === 'UNSOLD_RETRY' && <span>· Retry</span>}
                </div>
                <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
                  {lot.player?.name || 'Current player'}
                </h1>
                <p className="mt-1 text-sm text-slate-200">
                  {lot.player?.role || 'Role not specified'}
                  {lot.player?.battingStyle ? ` · ${lot.player.battingStyle}` : ''}
                  {lot.player?.bowlingStyle ? ` · ${lot.player.bowlingStyle}` : ''}
                  {lot.player?.jerseySize ? ` · Jersey ${lot.player.jerseySize}` : ''}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
              <div className="rounded-xl bg-slate-950 p-3 sm:p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Current bid</p>
                <p className="mt-1 text-2xl font-black text-white sm:text-3xl">
                  {lot.currentBid === null ? 'No bids' : formatCurrency(lot.currentBid)}
                </p>
              </div>
              <div className="rounded-xl bg-slate-950 p-3 sm:p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Highest bidder</p>
                <p className="mt-1 truncate text-lg font-black text-white sm:text-xl">
                  {lot.highestBidderName || '—'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <Clock3 className={`h-5 w-5 ${timerExpired ? 'text-rose-300' : 'text-amber-300'}`} />
                <span className="text-sm font-semibold text-slate-300">Time remaining</span>
              </div>
              <time
                dateTime={lot.bidDeadlineAt || undefined}
                className={`font-mono text-2xl font-black tabular-nums sm:text-3xl ${
                  timerExpired ? 'text-rose-300' : 'text-amber-200'
                }`}
              >
                {secondsRemaining === null ? '--:--' : formatTime(secondsRemaining)}
              </time>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center sm:p-12">
            <Clock3 className="mx-auto h-10 w-10 text-slate-500" />
            <h1 className="mt-4 text-xl font-black text-white">No player is currently up for auction.</h1>
            <p className="mt-2 text-sm text-slate-400">
              {bidding.auction.status === 'LIVE'
                ? 'The next player will appear here when the auction manager starts the lot.'
                : bidding.auction.status === 'CLOSED'
                  ? 'Auction Closed'
                  : `Auction status: ${bidding.auction.status}`}
            </p>
          </section>
        )}

        {lot && (
          <section aria-label="Bidding status" className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <p className={`text-center text-sm font-black uppercase tracking-wider ${
              lot.isHighestBidder ? 'text-emerald-300' : 'text-slate-200'
            }`}>
              {leadingStatus}
            </p>
            {quotaComplete && (
              <p className="mt-2 text-center text-sm font-semibold text-amber-200">
                You have completed your player quota.
              </p>
            )}
            {!quotaComplete && nextBid !== null && !bidIsAffordable && (
              <p className="mt-2 text-center text-sm font-semibold text-amber-200">
                Maximum affordable bid is {formatCurrency(maximumAffordable)}.
              </p>
            )}
          </section>
        )}

        <section aria-label="Icon player" className="flex items-center gap-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3">
          {icon.profileImageUrl ? (
            <Image src={icon.profileImageUrl} alt="" width={44} height={44} unoptimized className="h-11 w-11 rounded-full object-cover" />
          ) : (
            <ShieldCheck className="h-8 w-8 text-amber-300" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-200">
              {icon.status === 'PRE_ALLOCATED' ? 'Icon · Allocated' : 'Icon not allocated'}
            </p>
            <p className="truncate text-sm font-semibold text-white">
              {icon.playerName || 'Icon player'}
              {icon.role ? ` · ${icon.role}` : ''}
            </p>
          </div>
        </section>

        <section aria-label="Purchased players" className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-white">Purchased players</h2>
            <span className="text-xs text-slate-400">{purchases.length}</span>
          </div>
          {purchases.length ? (
            <ul className="divide-y divide-slate-800">
              {purchases.map((purchase) => (
                <li key={purchase.playerId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  {purchase.profileImageUrl ? (
                    <Image src={purchase.profileImageUrl} alt="" width={40} height={40} unoptimized className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-slate-800" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{purchase.playerName}</p>
                    <p className="text-xs text-slate-500">{purchase.role || 'Player'}</p>
                  </div>
                  <p className="text-right text-sm font-bold text-emerald-200">
                    {formatCurrency(purchase.winningBid)}
                    <span className="block text-[10px] font-medium uppercase text-slate-500">{purchase.purchaseStatus}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No players purchased yet.</p>
          )}
        </section>

        <p className="pb-4 text-center text-[11px] text-slate-500">
          Auction state and budgets are verified by the server. Realtime updates trigger an authoritative refresh.
        </p>
      </div>

      {lot && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-700 bg-slate-950/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center gap-3">
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Next valid bid</p>
              <p className="truncate text-lg font-black text-white">
                {nextBid === null ? '—' : formatCurrency(nextBid)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void placeBid()}
              disabled={!canBid || submitting}
              className="min-h-14 flex-1 rounded-xl bg-emerald-500 px-4 py-3 text-lg font-black text-slate-950 shadow-lg shadow-emerald-950/50 transition hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none sm:text-xl"
            >
              {submitting
                ? 'PLACING BID…'
                : nextBid === null
                  ? 'BID UNAVAILABLE'
                  : `BID ${formatCurrency(nextBid)}`}
            </button>
          </div>
          {!canBid && !submitting && lot && !quotaComplete && (
            <p className="mx-auto mt-1 max-w-3xl text-center text-[11px] text-slate-400 sm:hidden">
              {timerExpired
                ? 'Bidding timer expired.'
                : !auctionAcceptsBids
                  ? 'The auction is not accepting bids.'
                  : !bidIsAffordable
                    ? `Maximum affordable bid: ${formatCurrency(maximumAffordable)}`
                    : 'Bidding unavailable.'}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
