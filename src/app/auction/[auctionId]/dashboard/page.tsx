'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { RefreshCw, ShieldCheck } from 'lucide-react';

type Purchase = {
  playerId: string;
  playerName: string;
  profileImageUrl: string | null;
  role: string | null;
  winningBid: number;
  purchaseStatus: string;
  purchasedAt: string;
};

type TeamDashboard = {
  auction: {
    id: string;
    status: string;
    bidTimerSeconds: number;
  };
  team: {
    teamOwnerId: string;
    teamName: string;
    teamLogo: string | null;
  };
  budget: {
    startingKitty: number;
    remainingKitty: number;
    kittyUsed: number;
    budgetUsedPercent: number;
    playersBought: number;
    playersRemaining: number;
    averageAvailablePerRemainingPlayer: number;
    maximumAffordableCurrentBid: number;
    totalSpent: number;
    status: string;
  };
  icon: {
    playerId: string | null;
    playerName: string | null;
    profileImageUrl: string | null;
    role: string | null;
    status: 'PRE_ALLOCATED' | 'NOT_ALLOCATED';
  };
  purchases: Purchase[];
};

type RouteParams = { auctionId: string };

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatCurrency(value: number) {
  return currency.format(value);
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold text-white">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}
    </div>
  );
}

export default function TeamAuctionDashboardPage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { auctionId } = use(params);
  const [dashboard, setDashboard] = useState<TeamDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (background) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch(
        `/api/auctions/${auctionId}/team-dashboard`,
        { cache: 'no-store' }
      );
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          setError('Please sign in to view your team dashboard.');
        } else if (response.status === 403) {
          setError('You are not authorized to view this team.');
        } else if (response.status === 404) {
          setError(result.error || 'Auction dashboard is not available yet.');
        } else {
          setError('Unable to load your auction dashboard.');
        }
        return;
      }

      setDashboard(result as TeamDashboard);
      setError(null);
    } catch {
      setError('Network error. Please try refreshing the dashboard.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [auctionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 text-slate-300">
        Loading team auction dashboard…
      </main>
    );
  }

  if (error || !dashboard) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-5 text-rose-200">
          <p role="alert">{error || 'Auction dashboard is unavailable.'}</p>
          <div className="mt-4 flex gap-3">
            {error?.includes('sign in') && (
              <Link
                href="/auth/login"
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Sign in
              </Link>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-rose-700 px-4 py-2 text-sm font-semibold text-rose-100"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { auction, team, budget, icon, purchases } = dashboard;
  const budgetUsedPercent = Math.max(
    0,
    Math.min(100, budget.budgetUsedPercent)
  );

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 text-slate-100 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {team.teamLogo ? (
            <Image
              src={team.teamLogo}
              alt=""
              width={48}
              height={48}
              unoptimized
              className="h-12 w-12 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-900 text-lg font-bold text-emerald-200">
              {team.teamName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-bold sm:text-3xl">
              {team.teamName}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Team auction dashboard · {auction.status}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {['OPEN', 'LIVE'].includes(auction.status) && (
            <Link
              href={`/auction/${auctionId}/bid`}
              className="inline-flex min-h-10 items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
            >
              Open live bidding
            </Link>
          )}
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      <section aria-label="Kitty" className="space-y-3">
        <h2 className="text-lg font-semibold">Kitty</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Starting kitty" value={formatCurrency(budget.startingKitty)} />
          <Metric label="Kitty remaining" value={formatCurrency(budget.remainingKitty)} />
          <Metric label="Kitty used" value={formatCurrency(budget.kittyUsed)} />
          <Metric
            label="Total spent on purchases"
            value={formatCurrency(budget.totalSpent)}
          />
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-slate-300">Budget used</span>
            <span className="font-semibold text-white">
              {budgetUsedPercent.toFixed(1)}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Budget used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={budgetUsedPercent}
            className="h-2 overflow-hidden rounded-full bg-slate-700"
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${budgetUsedPercent}%` }}
            />
          </div>
        </div>
      </section>

      <section aria-label="Squad and bidding power" className="space-y-3">
        <h2 className="text-lg font-semibold">Squad &amp; bidding power</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Players bought" value={String(budget.playersBought)} />
          <Metric label="Players remaining" value={String(budget.playersRemaining)} />
          <Metric
            label="Average available"
            value={formatCurrency(budget.averageAvailablePerRemainingPlayer)}
            detail="Per remaining player"
          />
          <Metric
            label="Maximum current bid"
            value={formatCurrency(budget.maximumAffordableCurrentBid)}
            detail="Reserve-aware maximum"
          />
        </div>
      </section>

      <section
        aria-label="Icon player"
        className="flex items-center gap-4 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4"
      >
        {icon.profileImageUrl ? (
          <Image
            src={icon.profileImageUrl}
            alt=""
            width={56}
            height={56}
            unoptimized
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <ShieldCheck className="h-9 w-9 shrink-0 text-amber-300" />
        )}
        <div>
          <h2 className="font-semibold text-amber-100">Icon player</h2>
          <p className="mt-1 text-sm text-slate-200">
            {icon.playerName || 'No icon player recorded'}
            {icon.role ? ` · ${icon.role}` : ''}
          </p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-amber-300">
            {icon.status === 'PRE_ALLOCATED'
              ? 'Pre-allocated · Locked · Not purchased through auction'
              : 'Not allocated'}
          </p>
        </div>
      </section>

      <section aria-label="Purchased players" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Purchased players</h2>
          <span className="text-sm text-slate-400">
            {purchases.length} {purchases.length === 1 ? 'player' : 'players'}
          </span>
        </div>
        {purchases.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
            No players purchased yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
            {purchases.map((purchase) => (
              <li
                key={purchase.playerId}
                className="flex flex-wrap items-center gap-3 p-4"
              >
                {purchase.profileImageUrl ? (
                  <Image
                    src={purchase.profileImageUrl}
                    alt=""
                    width={44}
                    height={44}
                    unoptimized
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-11 w-11 rounded-full bg-slate-800" />
                )}
                <div className="min-w-[8rem] flex-1">
                  <p className="font-semibold text-white">{purchase.playerName}</p>
                  <p className="text-xs text-slate-400">
                    {purchase.role || 'Role not specified'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-emerald-300">
                    {formatCurrency(purchase.winningBid)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {purchase.purchaseStatus}
                  </p>
                </div>
                <time
                  className="w-full text-xs text-slate-500 sm:w-auto"
                  dateTime={purchase.purchasedAt}
                >
                  {new Date(purchase.purchasedAt).toLocaleString('en-IN')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Figures are read from the auction budget and purchase records. Auction state: {auction.status}.
      </p>
    </main>
  );
}
