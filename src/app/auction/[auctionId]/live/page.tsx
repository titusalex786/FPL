'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useAuctionRealtime } from '@/lib/auction/use-auction-realtime';

type PublicPlayer = {
  name: string;
  image: string | null;
  role: string | null;
  battingStyle: string | null;
};

type PublicLot = {
  id: string;
  lotNumber: number;
  status: string;
  roundNumber: number | null;
  roundType: string | null;
  currentBid: number | null;
  soldAmount: number | null;
  soldAt: string | null;
  bidDeadlineAt: string | null;
  currentTeamName: string | null;
  currentTeamLogo: string | null;
  winningTeamName: string | null;
  winningTeamLogo: string | null;
  player: PublicPlayer | null;
};

type LiveState = {
  auction: {
    id: string;
    name: string;
    tournamentName: string;
    status: string;
    baseBid: number;
    bidTimerSeconds: number;
    currentRoundNumber: number | null;
    currentRoundType: string | null;
  };
  liveLot: PublicLot | null;
  nextLot: PublicLot | null;
  recentlySold: PublicLot[];
  stats: {
    totalLots: number;
    sold: number;
    unsold: number;
    available: number;
  };
};

type RouteParams = { auctionId: string };

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function fmt(paise: number | null | undefined) {
  return typeof paise === 'number' ? inr.format(paise) : '—';
}

function TimerRing({
  secondsRemaining,
  totalSeconds,
}: {
  secondsRemaining: number;
  totalSeconds: number;
}) {
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, secondsRemaining / totalSeconds));
  const offset = circ * (1 - ratio);
  const urgent = secondsRemaining <= 10;
  const color = urgent ? '#ef4444' : secondsRemaining <= 20 ? '#f59e0b' : '#10b981';

  return (
    <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
      <svg
        viewBox="0 0 120 120"
        width={140}
        height={140}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
      >
        <circle cx={60} cy={60} r={radius} fill="none" stroke="#1e293b" strokeWidth={10} />
        <circle
          cx={60}
          cy={60}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
        />
      </svg>
      <div className="relative text-center">
        <p
          className="font-black tabular-nums leading-none"
          style={{
            fontSize: 38,
            color,
            textShadow: urgent ? `0 0 20px ${color}55` : undefined,
          }}
        >
          {secondsRemaining}
        </p>
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          seconds
        </p>
      </div>
    </div>
  );
}

function PlayerPhoto({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-3xl bg-slate-800/60 text-slate-500"
        style={{ width: 220, height: 260 }}
      >
        <svg width={64} height={64} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      className="rounded-3xl object-cover shadow-2xl"
      style={{ width: 220, height: 260 }}
    />
  );
}

function RoleChip({ role, batting }: { role: string | null; batting: string | null }) {
  const label = [role, batting].filter(Boolean).join(' · ');
  if (!label) return null;
  return (
    <span className="inline-block rounded-full border border-teal-500/30 bg-teal-500/10 px-4 py-1.5 text-sm font-bold uppercase tracking-widest text-teal-300">
      {label}
    </span>
  );
}

function SoldCard({ lot }: { lot: PublicLot }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-700/50 bg-slate-800/50 px-4 py-3">
      <PlayerPhoto src={lot.player?.image || null} name={lot.player?.name || 'Player'} />
      <div className="min-w-0 flex-1" style={{ width: 100, height: 80 }}>
        <p className="truncate text-sm font-bold text-white">{lot.player?.name || '—'}</p>
        <p className="mt-0.5 text-xs text-slate-400">{lot.winningTeamName || '—'}</p>
        <p className="mt-1 text-base font-black text-emerald-400">{fmt(lot.soldAmount)}</p>
      </div>
    </div>
  );
}

export default function ProjectorLivePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { auctionId } = use(params);
  const [state, setState] = useState<LiveState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [connectionStatus, setConnectionStatus] = useState<
    'CONNECTING' | 'LIVE' | 'OFFLINE' | 'RECONNECTING'
  >('CONNECTING');
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) {
      refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    try {
      const res = await fetch(`/api/auctions/${auctionId}/live-state`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as LiveState;
        setState(data);
      }
    } catch {
      // silent — show stale data
    } finally {
      refreshInFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  }, [auctionId]);

  const rtStatus = useAuctionRealtime(auctionId, refresh, 8000);

  useEffect(() => {
    setConnectionStatus(rtStatus as typeof connectionStatus);
  }, [rtStatus]);

  useEffect(() => {
    void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(clock);
  }, [refresh]);

  const liveLot = state?.liveLot || null;
  const bidDeadline = liveLot?.bidDeadlineAt
    ? new Date(liveLot.bidDeadlineAt).getTime()
    : null;
  const secondsRemaining = bidDeadline
    ? Math.max(0, Math.ceil((bidDeadline - now) / 1000))
    : null;
  const totalSeconds = state?.auction.bidTimerSeconds ?? 30;

  const isLive = liveLot?.status === 'LIVE';
  const isSold = liveLot?.status === 'SOLD';

  // Determine color accent for current bid
  const bidColor =
    isSold
      ? '#10b981'
      : !liveLot?.currentBid
      ? '#64748b'
      : '#f59e0b';

  if (!state) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center bg-[#030712]"
        style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}
      >
        <div
          className="h-10 w-10 animate-spin rounded-full border-4 border-teal-400/20"
          style={{ borderTopColor: '#2dd4bf' }}
        />
        <p className="mt-5 text-lg font-bold text-slate-400">
          Connecting to live auction…
        </p>
      </div>
    );
  }

  const auction = state.auction;

  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden bg-[#030712]"
      style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}
    >
      {/* Background glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% -10%, #0f3460 0%, transparent 70%)',
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-slate-800/60 px-8 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-teal-400">
            {auction.tournamentName}
          </p>
          <h1 className="text-2xl font-black text-white sm:text-3xl">
            {auction.name}
          </h1>
        </div>
        <div className="flex items-center gap-5">
          {auction.currentRoundNumber && (
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Round
              </p>
              <p className="text-2xl font-black text-white">
                {auction.currentRoundNumber}
                {auction.currentRoundType === 'UNSOLD_RETRY' && (
                  <span className="ml-2 text-sm font-bold text-amber-400">RETRY</span>
                )}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                connectionStatus === 'LIVE'
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                  : connectionStatus === 'OFFLINE'
                  ? 'bg-rose-500'
                  : 'animate-pulse bg-amber-400'
              }`}
            />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
              {connectionStatus === 'LIVE'
                ? 'LIVE'
                : connectionStatus === 'OFFLINE'
                ? 'OFFLINE'
                : 'CONNECTING'}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Status
            </p>
            <p
              className={`text-sm font-black uppercase tracking-wide ${
                auction.status === 'LIVE'
                  ? 'text-emerald-400'
                  : auction.status === 'CLOSED' || auction.status === 'FINALIZED'
                  ? 'text-slate-400'
                  : 'text-amber-400'
              }`}
            >
              {auction.status}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex flex-1 gap-6 p-8">
        {/* LEFT: Player + Bid */}
        <section className="flex flex-1 flex-col items-center justify-center gap-6">
          {liveLot ? (
            <>
              {/* Player photo */}
              <div className="relative">
                <div
                  className="absolute inset-0 -m-3 rounded-[2rem] blur-2xl"
                  style={{
                    background: isSold
                      ? 'radial-gradient(circle, #10b98133, transparent)'
                      : isLive
                      ? 'radial-gradient(circle, #f59e0b22, transparent)'
                      : 'none',
                  }}
                />
                <PlayerPhoto
                  src={liveLot.player?.image || null}
                  name={liveLot.player?.name || 'Player'}
                />
                {/* Lot badge */}
                <div className="absolute -right-4 -top-4 flex h-12 w-12 items-center justify-center rounded-full border-2 border-slate-700 bg-slate-900 text-sm font-black text-white shadow-xl">
                  #{liveLot.lotNumber}
                </div>
              </div>

              {/* Player info */}
              <div className="text-center">
                <h2
                  className="font-black text-white"
                  style={{ fontSize: 'clamp(1.8rem, 4vw, 3rem)', lineHeight: 1.1 }}
                >
                  {liveLot.player?.name || 'Player'}
                </h2>
                <div className="mt-2 flex items-center justify-center gap-3">
                  <RoleChip
                    role={liveLot.player?.role || null}
                    batting={liveLot.player?.battingStyle || null}
                  />
                </div>
              </div>

              {/* SOLD / Current bid */}
              {isSold ? (
                <div className="mt-2 text-center">
                  <div
                    className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-10 py-6"
                    style={{ boxShadow: '0 0 40px #10b98130' }}
                  >
                    <p className="text-sm font-bold uppercase tracking-[0.25em] text-emerald-400">
                      ✓ SOLD
                    </p>
                    <p
                      className="mt-1 font-black text-white"
                      style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}
                    >
                      {fmt(liveLot.soldAmount)}
                    </p>
                    <p className="mt-1 text-lg font-bold text-emerald-300">
                      {liveLot.winningTeamName || '—'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-center">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">
                    {liveLot.currentBid ? 'CURRENT BID' : 'BASE BID'}
                  </p>
                  <p
                    className="mt-1 font-black tabular-nums"
                    style={{
                      fontSize: 'clamp(2.5rem, 7vw, 5rem)',
                      color: bidColor,
                      lineHeight: 1,
                      textShadow:
                        liveLot.currentBid
                          ? `0 0 40px ${bidColor}55`
                          : undefined,
                    }}
                  >
                    {fmt(liveLot.currentBid ?? auction.baseBid)}
                  </p>
                </div>
              )}
            </>
          ) : auction.status === 'CLOSED' || auction.status === 'FINALIZED' ? (
            <div className="text-center">
              <p className="text-4xl font-black text-white">🏏 Auction Complete</p>
              <p className="mt-3 text-xl text-slate-400">
                {state.stats.sold} players sold
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-3xl font-black text-white">Waiting for next player…</p>
              {state.nextLot && (
                <div className="mt-6 text-center">
                  <p className="text-sm font-bold uppercase tracking-widest text-slate-400">
                    Up next
                  </p>
                  <p className="mt-1 text-xl font-black text-white">
                    {state.nextLot.player?.name || 'Player'}
                  </p>
                  <RoleChip
                    role={state.nextLot.player?.role || null}
                    batting={state.nextLot.player?.battingStyle || null}
                  />
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT: Timer + Highest Bidder + Stats */}
        <aside className="flex w-[340px] shrink-0 flex-col gap-5">
          {/* Timer */}
          {isLive && secondsRemaining !== null && (
            <div className="flex flex-col items-center rounded-3xl border border-slate-700/60 bg-slate-900/80 p-6 shadow-2xl">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Time Remaining
              </p>
              <TimerRing
                secondsRemaining={secondsRemaining}
                totalSeconds={totalSeconds}
              />
            </div>
          )}

          {/* Highest Bidder */}
          {liveLot && !isSold && (
            <div
              className="rounded-3xl border p-6 shadow-2xl"
              style={{
                borderColor: liveLot.currentTeamName
                  ? '#f59e0b44'
                  : '#334155',
                background: liveLot.currentTeamName
                  ? 'linear-gradient(135deg, #422006cc, #0f172acc)'
                  : '#0f172acc',
              }}
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Highest Bidder
              </p>
              {liveLot.currentTeamName ? (
                <>
                  <p
                    className="mt-2 font-black leading-tight text-white"
                    style={{ fontSize: 'clamp(1.2rem, 2.5vw, 1.7rem)' }}
                  >
                    {liveLot.currentTeamName}
                  </p>
                  <p className="mt-1 font-black text-amber-400">
                    {fmt(liveLot.currentBid)}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-lg font-bold text-slate-500">
                  No bid yet
                </p>
              )}
            </div>
          )}

          {/* Stats bar */}
          <div className="rounded-3xl border border-slate-700/60 bg-slate-900/80 p-5">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
              Auction Progress
            </p>
            <div className="space-y-3 text-sm">
              {[
                {
                  label: 'Players Sold',
                  value: state.stats.sold,
                  color: '#10b981',
                },
                {
                  label: 'Remaining',
                  value: state.stats.available,
                  color: '#f59e0b',
                },
                {
                  label: 'Unsold',
                  value: state.stats.unsold,
                  color: '#64748b',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="font-semibold text-slate-400">{item.label}</span>
                  <span
                    className="text-xl font-black"
                    style={{ color: item.color }}
                  >
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Recently sold */}
          {state.recentlySold.length > 0 && (
            <div className="rounded-3xl border border-slate-700/60 bg-slate-900/80 p-5">
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Recently Sold
              </p>
              <div className="space-y-2">
                {state.recentlySold.map((lot) => (
                  <div
                    key={lot.id}
                    className="flex items-center justify-between rounded-xl bg-slate-800/60 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-white">
                        {lot.player?.name || '—'}
                      </p>
                      <p className="truncate text-[10px] text-slate-400">
                        {lot.winningTeamName || '—'}
                      </p>
                    </div>
                    <p className="ml-3 shrink-0 text-sm font-black text-emerald-400">
                      {fmt(lot.soldAmount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next player preview */}
          {state.nextLot && liveLot && (
            <div className="rounded-3xl border border-slate-700/40 bg-slate-900/60 p-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Up Next · Lot #{state.nextLot.lotNumber}
              </p>
              <p className="font-black text-white">
                {state.nextLot.player?.name || 'Player'}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {[
                  state.nextLot.player?.role,
                  state.nextLot.player?.battingStyle,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
