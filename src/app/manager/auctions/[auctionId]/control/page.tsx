'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Check,
  Clock3,
  Coins,
  ExternalLink,
  Filter,
  Loader2,
  Monitor,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  SkipForward,
  Sliders,
  Square,
  Users,
  Wallet,
  X,
  XCircle,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useAuctionRealtime } from '@/lib/auction/use-auction-realtime';
import { toNumericJerseySize } from '@/lib/utils/jersey-size';

type AuctionConfiguration = {
  startingKitty: number;
  totalPlayersToBuy: number;
  iconPlayersAllocated: number;
  baseBid: number;
  bidThreshold: number;
  lowIncrement: number;
  highIncrement: number;
  minimumReserve: number;
  maximumBid: number | null;
  bidTimerSeconds: number;
  allowOwnerSelfPurchase: boolean;
};

type TeamBudget = {
  teamOwnerId: string;
  teamName: string;
  ownerName: string;
  teamLogo: string | null;
  startingKitty: number;
  remainingKitty: number;
  kittyUsed: number;
  budgetUsedPercent: number;
  playersBought: number;
  playersRemaining: number;
  averageAvailablePerRemainingPlayer: number;
  maximumAffordableCurrentBid: number;
  status: string;
};

type AuctionLot = {
  id: string;
  registrationId: string;
  playerId: string;
  lotNumber: number;
  status: string;
  roundId: string;
  roundNumber: number | null;
  roundType: string | null;
  currentBid: number | null;
  currentTeamOwnerId: string | null;
  currentTeamName: string | null;
  winningTeamName: string | null;
  soldAmount: number | null;
  soldAt: string | null;
  bidDeadlineAt: string | null;
  player: {
    id: string;
    name: string;
    image: string | null;
    role: string;
    battingStyle: string | null;
    bowlingStyle: string | null;
    jerseySize: string | null;
  } | null;
};

type ControlPanelData = {
  auction: {
    id: string;
    name: string;
    tournamentName: string;
    status: string;
    currentRoundNumber: number | null;
    configuration: AuctionConfiguration;
    configurationLocked: boolean;
  };
  overview: {
    playersSold: number;
    playersUnsold: number;
    retryPoolRemaining: number;
    totalMoneySpent: number;
  };
  teams: TeamBudget[];
  lots: AuctionLot[];
  rounds: Array<{
    id: string;
    roundNumber: number;
    roundType: string;
    status: string;
    players: number;
    sold: number;
    unsold: number;
    available: number;
  }>;
  selections: Array<{
    id: string;
    registrationId: string;
    playerId: string;
    candidateType: string;
    selectionStatus: string;
    reason: string | null;
    playerName: string;
    role: string | null;
  }>;
  liveLotId: string | null;
  bidHistory: Array<{
    id: string;
    teamName: string;
    amount: number | null;
    eventType: string;
    createdAt: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    playerId: string | null;
    teamName: string | null;
    amount: number | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
};

const money = (value: number | null | undefined) =>
  typeof value === 'number' ? value.toLocaleString('en-IN') : '—';

function getErrorMessage(payload: unknown, fallback: string) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }
  return fallback;
}

export default function AuctionControlPanelPage() {
  const params = useParams<{ auctionId: string }>();
  const auctionId = params.auctionId;
  const [data, setData] = useState<ControlPanelData | null>(null);
  const [configuration, setConfiguration] = useState<AuctionConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);

  // Financial Adjustment State
  const [adjustingTeam, setAdjustingTeam] = useState<{ id: string; name: string; current: number } | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState<number>(5000);
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');

  // Player search & filter
  const [playerSearch, setPlayerSearch] = useState<string>('');
  const [candidateFilter, setCandidateFilter] = useState<'ALL' | 'OWNER' | 'PLAYER' | 'ICON'>('ALL');

  const refresh = useCallback(async (showLoader = false) => {
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    if (showLoader) setLoading(true);
    try {
      const response = await fetch(`/api/admin/auctions/${auctionId}/control-panel`, {
        cache: 'no-store',
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'Unable to load auction control data.'));
      }
      const panel = payload as ControlPanelData;
      setData(panel);
      setConfiguration(panel.auction.configuration);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load auction control data.');
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  }, [auctionId]);

  const connectionStatus = useAuctionRealtime(auctionId, refresh, 10000);

  useEffect(() => {
    void refresh(true);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(clockTimer);
    };
  }, [refresh]);

  const liveLot = useMemo(
    () => data?.lots.find((lot) => lot.id === data.liveLotId) || null,
    [data]
  );
  const nextLot = useMemo(
    () => data?.lots.find((lot) => lot.status === 'AVAILABLE') || null,
    [data]
  );
  const availableLots = useMemo(
    () => (data?.lots || []).filter((lot) => lot.status === 'AVAILABLE'),
    [data]
  );
  const secondsRemaining = liveLot?.bidDeadlineAt
    ? Math.max(0, Math.ceil((new Date(liveLot.bidDeadlineAt).getTime() - now) / 1000))
    : null;
  const isAuctionActive = data ? ['DRAFT', 'OPEN', 'LIVE'].includes(data.auction.status) : false;
  const isAuctionPaused = data?.auction.status === 'PAUSED';
  const canEditSelection = data
    ? ['DRAFT', 'OPEN'].includes(data.auction.status)
    : false;

  const config = configuration || data?.auction.configuration;

  const nextValidBid = useMemo(() => {
    if (!config) return 5000;
    if (!liveLot || !liveLot.currentBid) return config.baseBid;
    return liveLot.currentBid < config.bidThreshold
      ? liveLot.currentBid + config.lowIncrement
      : liveLot.currentBid + config.highIncrement;
  }, [config, liveLot]);

  const filteredSelections = useMemo(() => {
    return (data?.selections || []).filter((s) => {
      if (candidateFilter !== 'ALL' && s.candidateType !== candidateFilter) return false;
      if (playerSearch.trim()) {
        const q = playerSearch.toLowerCase();
        return (
          s.playerName.toLowerCase().includes(q) ||
          (s.role && s.role.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [data?.selections, candidateFilter, playerSearch]);

  async function postAction(url: string, body?: Record<string, unknown>, method = 'POST') {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload: unknown = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, 'The auction action could not be completed.'));
      }
      setNotice('Action completed. Auction state refreshed from the server.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The auction action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function saveConfiguration() {
    if (!configuration) return;
    await postAction(
      `/api/admin/auctions/${auctionId}/configuration`,
      {
        totalKitty: configuration.startingKitty,
        totalPlayersToBuy: configuration.totalPlayersToBuy,
        baseBid: configuration.baseBid,
        minimumReservePerPlayer: configuration.minimumReserve,
        bidThreshold: configuration.bidThreshold,
        lowIncrement: configuration.lowIncrement,
        highIncrement: configuration.highIncrement,
        maximumBid: configuration.maximumBid,
        bidTimerSeconds: configuration.bidTimerSeconds,
        allowOwnerSelfPurchase: configuration.allowOwnerSelfPurchase,
      },
      'PATCH'
    );
  }

  function confirmEndAuction() {
    if (
      window.confirm(
        'End this auction? The existing server rules will mark any active lot UNSOLD and audit the action.'
      )
    ) {
      void postAction(`/api/admin/auctions/${auctionId}/end`);
    }
  }

  async function handleAdminBid(teamOwnerId: string, amount: number) {
    if (!liveLot) return;
    await postAction(`/api/admin/auctions/${auctionId}/bid`, {
      lotId: liveLot.id,
      teamOwnerId,
      bidAmount: amount,
    });
  }

  async function handleAdjustBudgetSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!adjustingTeam) return;
    if (!adjustmentReason.trim() || adjustmentReason.trim().length < 3) {
      setError('A reason of at least 3 characters is required for budget adjustment.');
      return;
    }
    await postAction(`/api/admin/auctions/${auctionId}/budget/adjust`, {
      teamOwnerId: adjustingTeam.id,
      adjustmentAmount,
      reason: adjustmentReason.trim(),
    });
    setAdjustingTeam(null);
    setAdjustmentReason('');
  }

  function setConfigurationField(
    field: keyof AuctionConfiguration,
    value: number | boolean | null
  ) {
    setConfiguration((previous) =>
      previous ? { ...previous, [field]: value } : previous
    );
  }

  async function handlePracticeCleanup() {
    if (
      !window.confirm(
        'Delete this Practice Auction?\n\n' +
        'This will delete ONLY records belonging to this disposable practice auction (lots, bids, purchases, rounds, events, budgets).\n\n' +
        'Protected tournament participants, players (164), registrations (100), payments (90), and team owners (10) will remain 100% untouched.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/auctions/${auctionId}/practice-cleanup`, {
        method: 'POST',
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Practice cleanup failed.');
      alert(
        `Practice auction cleaned up successfully.\nDeleted ${result.deletedCounts?.auction_lots ?? 0} lots and all practice records.\nProtected participant baseline verified unchanged.`
      );
      window.location.href = '/manager/auctions';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Practice cleanup failed.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin text-teal-400" />
        Loading auction control panel…
      </div>
    );
  }

  if (!data) {
    return (
      <section className="mx-auto max-w-3xl rounded-2xl border border-rose-500/30 bg-rose-950/20 p-6">
        <div className="flex items-center gap-3 text-rose-300">
          <AlertCircle className="h-5 w-5" />
          <h1 className="font-bold">Auction control panel unavailable</h1>
        </div>
        <p className="mt-3 text-sm text-rose-200/80">{error || 'No auction data was returned.'}</p>
        <button
          onClick={() => void refresh(true)}
          className="mt-5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Try again
        </button>
      </section>
    );
  }

  const currentConfig = config || data.auction.configuration;
  const isPracticeAuction = Boolean(data.auction.name?.startsWith('[PRACTICE]'));
  const configInputs: Array<{
    field: keyof Pick<
      AuctionConfiguration,
      | 'startingKitty'
      | 'totalPlayersToBuy'
      | 'baseBid'
      | 'bidThreshold'
      | 'lowIncrement'
      | 'highIncrement'
      | 'minimumReserve'
      | 'bidTimerSeconds'
    >;
    label: string;
  }> = [
    { field: 'startingKitty', label: 'Starting kitty' },
    { field: 'totalPlayersToBuy', label: 'Required purchases' },
    { field: 'baseBid', label: 'Base bid' },
    { field: 'bidThreshold', label: 'Bid threshold' },
    { field: 'lowIncrement', label: 'Low increment' },
    { field: 'highIncrement', label: 'High increment' },
    { field: 'minimumReserve', label: 'Minimum reserve' },
    { field: 'bidTimerSeconds', label: 'Bid timer (seconds)' },
  ];

  return (
    <main className="space-y-6">
      {/* Practice Auction Banner */}
      {isPracticeAuction && (
        <div className="rounded-2xl border border-purple-500/40 bg-purple-950/25 p-4 text-xs font-medium text-purple-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🧪</span>
            <div>
              <span className="font-bold text-purple-200 block text-sm">PRACTICE AUCTION (DISPOSABLE SANDBOX)</span>
              <span className="text-purple-300/80">
                Running in disposable practice mode with existing tournament participants. Real registrations (100), player profiles (164), payments (90), and team owners (10) are guaranteed protected.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePracticeCleanup}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/50 hover:bg-rose-900/80 px-3.5 py-2 font-bold text-rose-300 shrink-0 text-xs transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Clean Up Practice</span>
          </button>
        </div>
      )}

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/manager"
            className="mb-3 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Manager dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-black text-white sm:text-3xl">{data.auction.name}</h1>
            <span className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              isAuctionPaused
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                : 'border-teal-400/30 bg-teal-400/10 text-teal-300'
            }`}>
              {data.auction.status}
            </span>
            {isPracticeAuction && (
              <span className="rounded-full border border-purple-500/40 bg-purple-500/15 px-3 py-1 text-xs font-bold text-purple-300">
                🧪 Practice
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {data.auction.tournamentName}
            {data.auction.currentRoundNumber
              ? ` · Round ${data.auction.currentRoundNumber}`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Auction Lifecycle Controls */}
          {data.auction.status === 'DRAFT' ? (
            <button
              onClick={() => void postAction(`/api/admin/auctions/${auctionId}/open`)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg hover:bg-teal-500 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Start Auction
            </button>
          ) : isAuctionPaused ? (
            <button
              onClick={() => void postAction(`/api/admin/auctions/${auctionId}/resume`)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Resume Auction
            </button>
          ) : isAuctionActive ? (
            <button
              onClick={() => void postAction(`/api/admin/auctions/${auctionId}/pause`, { reason: 'Paused by manager' })}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm font-bold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              <Pause className="h-4 w-4" /> Pause Auction
            </button>
          ) : null}

          <Link
            href={`/auction/${auctionId}/live`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-teal-500/40 bg-teal-500/10 px-4 py-2.5 text-sm font-semibold text-teal-300 hover:bg-teal-500/20"
          >
            <Monitor className="h-4 w-4" /> Projector View
            <ExternalLink className="h-3 w-3 opacity-60" />
          </Link>
          <button
            onClick={() => void refresh(true)}
            disabled={loading || busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-teal-500/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh state
          </button>
          {isPracticeAuction && (
            <button
              onClick={() => void handlePracticeCleanup()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-900/60 disabled:opacity-50"
              title="Safely delete only this practice auction and verify protected tables"
            >
              <Trash2 className="h-4 w-4" />
              Clean Up Practice
            </button>
          )}
        </div>
      </header>

      <div className="flex items-center justify-end gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
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

      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            error
              ? 'border-rose-500/30 bg-rose-950/20 text-rose-200'
              : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
          }`}
        >
          {error || notice}
        </div>
      )}

      {/* Overview Stats */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Players sold', value: data.overview.playersSold, icon: Users },
          { label: 'Players unsold', value: data.overview.playersUnsold, icon: Activity },
          { label: 'Retry pool remaining', value: data.overview.retryPoolRemaining, icon: RefreshCw },
          { label: 'Total money spent', value: `₹${money(data.overview.totalMoneySpent)}`, icon: Coins },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400">
                {stat.label}
                <Icon className="h-4 w-4 text-teal-400" />
              </div>
              <p className="mt-3 text-2xl font-black text-white">{stat.value}</p>
            </div>
          );
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.8fr)]">
        <div className="space-y-6">
          {/* Current Live Lot */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Current live lot</h2>
                <p className="mt-1 text-xs text-slate-400">Live auction state is refreshed automatically via Realtime.</p>
              </div>
              {liveLot && (
                <span className={`rounded-lg px-3 py-1.5 font-mono text-sm font-bold ${
                  secondsRemaining === 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-400/10 text-amber-200'
                }`}>
                  {secondsRemaining === 0 ? 'Timer expired' : `${secondsRemaining}s remaining`}
                </span>
              )}
            </div>

            {liveLot ? (
              <div className="space-y-6">
                <div className="grid gap-5 md:grid-cols-[150px_1fr]">
                  {liveLot.player?.image ? (
                    <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 p-1 md:w-[150px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={liveLot.player.image}
                        alt=""
                        className="max-h-full max-w-full rounded-lg object-contain"
                        style={{ objectFit: 'contain' }}
                      />
                    </div>
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-xl bg-slate-800 text-slate-500 md:w-[150px]">
                      <Users className="h-8 w-8" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-teal-300">
                          Lot {liveLot.lotNumber} · {liveLot.player?.role || 'Player'}
                        </p>
                        <h3 className="mt-1 text-xl font-black text-white">
                          {liveLot.player?.name || 'Player details unavailable'}
                        </h3>
                        <p className="mt-1 text-sm text-slate-400">
                          {liveLot.player?.battingStyle || '—'} batting
                          {liveLot.player?.bowlingStyle ? ` · ${liveLot.player.bowlingStyle}` : ''}
                          {liveLot.player?.jerseySize ? ` · Size ${toNumericJerseySize(liveLot.player.jerseySize)}` : ''}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase text-emerald-300">
                        {liveLot.status}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Current bid</p>
                        <p className="mt-1 text-xl font-black text-white">₹{money(liveLot.currentBid)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-950/70 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Leading team</p>
                        <p className="mt-1 truncate text-base font-bold text-white">
                          {liveLot.currentTeamName || 'No bid yet'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        disabled={busy || secondsRemaining !== 0 || !liveLot.currentBid}
                        onClick={() => void postAction(
                          `/api/admin/auctions/${auctionId}/lots/${liveLot.id}`,
                          { action: 'SETTLE' }
                        )}
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Check className="h-4 w-4" /> Settle expired lot
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void postAction(
                          `/api/admin/auctions/${auctionId}/lots/${liveLot.id}`,
                          { action: 'END_UNSOLD' }
                        )}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-300 hover:border-amber-500/50 hover:text-amber-200 disabled:opacity-40"
                      >
                        <XCircle className="h-4 w-4" /> Mark Unsold
                      </button>
                      {/* Skip Lot Before Bids */}
                      {!liveLot.currentBid && (
                        <button
                          disabled={busy}
                          onClick={() => void postAction(
                            `/api/admin/auctions/${auctionId}/lots/${liveLot.id}`,
                            { action: 'SKIP' }
                          )}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-bold text-slate-300 hover:border-teal-500/50 hover:text-teal-200 disabled:opacity-40"
                        >
                          <SkipForward className="h-4 w-4" /> Skip lot
                        </button>
                      )}
                      <button
                        disabled={busy || !['OPEN', 'LIVE'].includes(data.auction.status)}
                        onClick={confirmEndAuction}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-4 py-2 text-sm font-bold text-rose-200 hover:bg-rose-950/60 disabled:opacity-40"
                      >
                        <Square className="h-4 w-4" /> End auction
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section 6: Admin-Controlled Bidding Grid */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-white">Admin Team Bidding</h4>
                      <p className="text-xs text-slate-400">
                        Next valid bid: <b className="text-teal-300">₹{money(nextValidBid)}</b>
                      </p>
                    </div>
                    <span className="text-xs text-slate-500">Only Admin places bids</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {data.teams.map((team) => {
                      const isLeading = team.teamOwnerId === liveLot.currentTeamOwnerId;
                      const reserveReq = team.playersRemaining > 1 ? (team.playersRemaining - 1) * currentConfig.minimumReserve : 0;
                      const canAfford = team.maximumAffordableCurrentBid >= nextValidBid;
                      const hasRemainingSlots = team.playersRemaining > 0;
                      const canBid = !isLeading && canAfford && hasRemainingSlots && secondsRemaining !== 0 && !busy && !isAuctionPaused;

                      return (
                        <div
                          key={team.teamOwnerId}
                          className={`rounded-lg border p-3 transition-colors ${
                            isLeading
                              ? 'border-emerald-500/50 bg-emerald-950/20'
                              : 'border-slate-800 bg-slate-900/60'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white">{team.teamName}</span>
                            {isLeading && (
                              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                LEADING
                              </span>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-slate-400">
                            <div>Kitty: <b className="text-slate-200">₹{money(team.remainingKitty)}</b></div>
                            <div>Spent: <b className="text-slate-200">₹{money(team.kittyUsed)}</b></div>
                            <div>Bought: <b className="text-slate-200">{team.playersBought}</b> (left: {team.playersRemaining})</div>
                            <div>Reserve: <b className="text-slate-200">₹{money(reserveReq)}</b></div>
                            <div className="col-span-2">
                              Max Bid: <b className="text-amber-200">₹{money(team.maximumAffordableCurrentBid)}</b>
                            </div>
                          </div>
                          <div className="mt-3">
                            <button
                              disabled={!canBid}
                              onClick={() => void handleAdminBid(team.teamOwnerId, nextValidBid)}
                              className={`w-full rounded-lg py-2 text-xs font-bold transition-all ${
                                isLeading
                                  ? 'cursor-not-allowed bg-emerald-800/40 text-emerald-300 opacity-60'
                                  : canBid
                                    ? 'bg-teal-600 text-white shadow-md hover:bg-teal-500 active:scale-95'
                                    : 'cursor-not-allowed bg-slate-800 text-slate-500 opacity-50'
                              }`}
                            >
                              {isLeading
                                ? 'Current Leader'
                                : !hasRemainingSlots
                                  ? 'Squad Full'
                                  : !canAfford
                                    ? 'Cannot Afford'
                                    : `BID ₹${money(nextValidBid)}`}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
                <Clock3 className="mx-auto h-7 w-7 text-slate-500" />
                <p className="mt-3 font-semibold text-white">No lot is live</p>
                <p className="mt-1 text-sm text-slate-400">Start the next available lot or reveal a random player when the auction is active.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {availableLots.length > 0 && isAuctionActive && !isAuctionPaused && (
                    <button
                      id="reveal-random-player-btn"
                      disabled={busy}
                      onClick={() => void postAction(
                        `/api/admin/auctions/${auctionId}/lots/random`,
                        {}
                      )}
                      className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:from-amber-400 hover:to-amber-500 disabled:opacity-50"
                    >
                      <span>🎲 Reveal Random Player</span>
                    </button>
                  )}
                  {data.auction.status === 'DRAFT' && (
                    <button
                      disabled={busy}
                      onClick={() => void postAction(`/api/admin/auctions/${auctionId}/open`)}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" /> Open Auction
                    </button>
                  )}
                  {nextLot && isAuctionActive && !isAuctionPaused && (
                    <button
                      disabled={busy}
                      onClick={() => void postAction(
                        `/api/admin/auctions/${auctionId}/lots/${nextLot.id}`,
                        { action: 'START' }
                      )}
                      className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-500 disabled:opacity-50"
                    >
                      <Play className="h-4 w-4" /> Start lot {nextLot.lotNumber}
                    </button>
                  )}
                  {['DRAFT', 'OPEN'].includes(data.auction.status) && (
                    <button
                      disabled={busy}
                      onClick={() => void postAction(`/api/admin/auctions/${auctionId}/pool`)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:border-teal-500/50 disabled:opacity-50"
                    >
                      <RefreshCw className="h-4 w-4" /> Populate pool
                    </button>
                  )}
                </div>
              </div>
            )}

            {liveLot && (
              <div className="mt-5 border-t border-slate-800 pt-4">
                <h3 className="mb-3 text-sm font-bold text-slate-200">Bid history</h3>
                {data.bidHistory.length ? (
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {data.bidHistory.map((bid) => (
                      <div key={bid.id} className="flex items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2 text-sm">
                        <span className="text-slate-300">{bid.teamName}</span>
                        <span className="font-bold text-white">₹{money(bid.amount)}</span>
                        <time className="text-xs text-slate-500">
                          {new Date(bid.createdAt).toLocaleTimeString()}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No bids recorded for this lot.</p>
                )}
              </div>
            )}
          </section>

          {/* Section 5 & 10: Team Budgets & Financial Adjustments */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Team budgets & Auditable Adjustments</h2>
                <p className="mt-1 text-xs text-slate-400">Authoritative balance and administrative point adjustment.</p>
              </div>
              <Wallet className="h-5 w-5 text-teal-400" />
            </div>
            {data.teams.length ? (
              <div className="space-y-3">
                {data.teams.map((team) => (
                  <article key={team.teamOwnerId} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-white">{team.teamName}</h3>
                        <p className="mt-0.5 text-xs text-slate-500">{team.ownerName}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400">
                          {team.playersBought}/{data.auction.configuration.totalPlayersToBuy} purchased
                        </span>
                        <button
                          disabled={busy}
                          onClick={() => {
                            setAdjustingTeam({
                              id: team.teamOwnerId,
                              name: team.teamName,
                              current: team.remainingKitty,
                            });
                            setAdjustmentAmount(5000);
                            setAdjustmentReason('');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-semibold text-teal-300 hover:border-teal-500/50 disabled:opacity-50"
                        >
                          <Sliders className="h-3 w-3" /> Adjust Points
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400"
                        style={{ width: `${Math.max(0, Math.min(100, team.budgetUsedPercent))}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                      <p className="text-slate-400">Remaining <b className="block pt-1 text-sm text-white">₹{money(team.remainingKitty)}</b></p>
                      <p className="text-slate-400">Spent <b className="block pt-1 text-sm text-white">₹{money(team.kittyUsed)}</b></p>
                      <p className="text-slate-400">Players left <b className="block pt-1 text-sm text-white">{team.playersRemaining}</b></p>
                      <p className="text-slate-400">Max affordable bid <b className="block pt-1 text-sm text-amber-200">₹{money(team.maximumAffordableCurrentBid)}</b></p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-slate-950/50 p-5 text-center text-sm text-slate-400">
                Budget records will appear when the auction is initialized.
              </p>
            )}
          </section>

          {/* Player Pool and Selections with Search & Filter */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">Player pool and selections</h2>
                <p className="mt-1 text-xs text-slate-400">Search, filter, and include/exclude participants before the auction begins.</p>
              </div>
              {['DRAFT', 'OPEN'].includes(data.auction.status) && (
                <button
                  disabled={busy}
                  onClick={() => void postAction(`/api/admin/auctions/${auctionId}/pool`)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:border-teal-500/50 disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Populate pool
                </button>
              )}
            </div>

            {/* Search and Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search player name or role..."
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                {(['ALL', 'PLAYER', 'OWNER', 'ICON'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setCandidateFilter(filter)}
                    className={`rounded-lg px-2.5 py-1.5 font-semibold transition-colors ${
                      candidateFilter === filter
                        ? 'bg-teal-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="pb-3 pr-3">Player</th>
                    <th className="pb-3 pr-3">Type / role</th>
                    <th className="pb-3 pr-3">Selection</th>
                    <th className="pb-3 pr-3">Lot status</th>
                    <th className="pb-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredSelections.map((selection) => {
                    const lot = data.lots.find(
                      (candidate) => candidate.registrationId === selection.registrationId
                    );
                    const isIcon = selection.candidateType === 'ICON';
                    const nextStatus = selection.selectionStatus === 'SELECTED' ? 'EXCLUDED' : 'SELECTED';
                    return (
                      <tr key={selection.id}>
                        <td className="py-3 pr-3 font-semibold text-white">{selection.playerName}</td>
                        <td className="py-3 pr-3 text-xs text-slate-400">
                          {selection.candidateType} · {selection.role || '—'}
                        </td>
                        <td className="py-3 pr-3">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                            selection.selectionStatus === 'SELECTED'
                              ? 'bg-emerald-400/10 text-emerald-300'
                              : selection.selectionStatus === 'LOCKED'
                                ? 'bg-amber-400/10 text-amber-200'
                                : 'bg-slate-800 text-slate-400'
                          }`}>
                            {selection.selectionStatus}
                          </span>
                        </td>
                        <td className="py-3 pr-3 text-xs text-slate-400">
                          {lot ? `#${lot.lotNumber} ${lot.status}` : 'Not in pool'}
                        </td>
                        <td className="py-3">
                          {!isIcon && canEditSelection && (
                            <button
                              disabled={busy}
                              onClick={() => void postAction(
                                `/api/admin/auctions/${auctionId}/selections`,
                                {
                                  registrationId: selection.registrationId,
                                  selectionStatus: nextStatus,
                                  reason: nextStatus === 'EXCLUDED' ? 'Excluded by auction manager' : null,
                                },
                                'PATCH'
                              )}
                              className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-teal-500/50 disabled:opacity-50"
                            >
                              {nextStatus === 'SELECTED' ? 'Include' : 'Exclude'}
                            </button>
                          )}
                          {isIcon && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-200"><Shield className="h-3 w-3" /> Protected</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {!filteredSelections.length && (
                    <tr><td colSpan={5} className="py-6 text-center text-sm text-slate-500">No auction candidates found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Auction Events History */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-bold text-white">Auction event history & Audit trail</h2>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {data.events.map((event) => (
                <article key={event.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-slate-950/50 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-bold text-slate-200">{event.eventType.replaceAll('_', ' ')}</p>
                    <p className="text-[11px] text-slate-500">
                      {event.teamName || 'Auction'}
                      {event.payload && typeof event.payload === 'object' && 'reason' in event.payload ? ` · Reason: ${String(event.payload.reason)}` : ''}
                      {event.playerId ? ` · ${event.playerId}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    {event.amount !== null && <p className="text-xs font-bold text-white">₹{money(event.amount)}</p>}
                    <time className="text-[10px] text-slate-500">{new Date(event.createdAt).toLocaleString()}</time>
                  </div>
                </article>
              ))}
              {!data.events.length && <p className="text-sm text-slate-500">No auction events recorded.</p>}
            </div>
          </section>
        </div>

        {/* Aside: Configuration and Rounds */}
        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Auction configuration</h2>
                <p className="mt-1 text-xs text-slate-400">Updates use the validated configuration RPC.</p>
              </div>
              <Coins className="h-5 w-5 text-teal-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {configInputs.map(({ field, label }) => (
                <label key={field} className="text-xs font-medium text-slate-400">
                  {label}
                  <input
                    type="number"
                    min={field === 'bidTimerSeconds' ? 1 : 0}
                    value={currentConfig[field]}
                    disabled={data.auction.configurationLocked || busy}
                    onChange={(event) => setConfigurationField(field, Number(event.target.value))}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-teal-500 disabled:opacity-50"
                  />
                </label>
              ))}
              <label className="text-xs font-medium text-slate-400">
                Maximum bid (optional)
                <input
                  type="number"
                  min={currentConfig.baseBid}
                  value={currentConfig.maximumBid ?? ''}
                  disabled={data.auction.configurationLocked || busy}
                  onChange={(event) => setConfigurationField(
                    'maximumBid',
                    event.target.value === '' ? null : Number(event.target.value)
                  )}
                  className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-teal-500 disabled:opacity-50"
                />
              </label>
              <label className="col-span-2 flex items-center justify-between rounded-lg bg-slate-950 px-3 py-3 text-xs font-semibold text-slate-300">
                Allow owner self-purchase
                <input
                  type="checkbox"
                  checked={currentConfig.allowOwnerSelfPurchase}
                  disabled={data.auction.configurationLocked || busy}
                  onChange={(event) => setConfigurationField('allowOwnerSelfPurchase', event.target.checked)}
                  className="h-4 w-4 accent-teal-500"
                />
              </label>
              <div className="col-span-2 rounded-lg bg-slate-950 px-3 py-3 text-xs text-slate-400">
                Icon players allocated before auction: <b className="text-white">{currentConfig.iconPlayersAllocated}</b>
              </div>
            </div>
            {data.auction.configurationLocked ? (
              <p className="mt-3 text-xs text-amber-200">Configuration is locked by the auction state or existing financial records.</p>
            ) : (
              <button
                disabled={busy}
                onClick={() => void saveConfiguration()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-500 disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> Save configuration
              </button>
            )}
            {isAuctionActive && !liveLot && (
              <button
                disabled={busy}
                onClick={confirmEndAuction}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/30 px-4 py-2.5 text-sm font-bold text-rose-200 hover:bg-rose-950/40 disabled:opacity-50"
              >
                <Square className="h-4 w-4" /> End auction
              </button>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-bold text-white">Rounds and retry pool</h2>
            <div className="space-y-2">
              {data.rounds.map((round) => (
                <div key={round.id} className="rounded-xl bg-slate-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-white">
                      Round {round.roundNumber}
                      {round.roundType === 'UNSOLD_RETRY' ? ' · Retry' : ''}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-slate-400">{round.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>{round.players} lots</span>
                    <span>{round.sold} sold</span>
                    <span>{round.unsold} unsold</span>
                    <span>{round.available} available</span>
                  </div>
                </div>
              ))}
              {!data.rounds.length && <p className="text-sm text-slate-500">No auction rounds yet.</p>}
            </div>
          </section>
        </aside>
      </section>

      {/* Financial Adjustment Modal */}
      {adjustingTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Adjust Team Budget</h3>
              <button
                onClick={() => setAdjustingTeam(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAdjustBudgetSubmit} className="mt-4 space-y-4">
              <div>
                <p className="text-xs text-slate-400">Team</p>
                <p className="text-base font-bold text-white">{adjustingTeam.name}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950 p-3 text-center text-xs">
                <div>
                  <span className="text-slate-400">Before</span>
                  <p className="mt-1 font-bold text-white">₹{money(adjustingTeam.current)}</p>
                </div>
                <div>
                  <span className="text-slate-400">Adjustment</span>
                  <p className={`mt-1 font-bold ${adjustmentAmount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {adjustmentAmount >= 0 ? `+₹${money(adjustmentAmount)}` : `-₹${money(Math.abs(adjustmentAmount))}`}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400">After</span>
                  <p className="mt-1 font-bold text-teal-300">₹{money(adjustingTeam.current + adjustmentAmount)}</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  Adjustment Amount (₹)
                  <div className="mt-1.5 flex gap-2">
                    <input
                      type="number"
                      step={1000}
                      value={adjustmentAmount}
                      onChange={(e) => setAdjustmentAmount(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white focus:border-teal-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setAdjustmentAmount((v) => -Math.abs(v))}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                        adjustmentAmount < 0 ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Deduct
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdjustmentAmount((v) => Math.abs(v))}
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                        adjustmentAmount > 0 ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      Add
                    </button>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300">
                  Mandatory Audit Reason
                  <input
                    type="text"
                    required
                    minLength={3}
                    placeholder="e.g. Penalty fine / Manual points adjustment"
                    value={adjustmentReason}
                    onChange={(e) => setAdjustmentReason(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-teal-500 focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustingTeam(null)}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || !adjustmentReason.trim() || adjustmentAmount === 0}
                  className="flex-1 rounded-xl bg-teal-600 py-2.5 text-xs font-bold text-white hover:bg-teal-500 disabled:opacity-50"
                >
                  Confirm & Audit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
