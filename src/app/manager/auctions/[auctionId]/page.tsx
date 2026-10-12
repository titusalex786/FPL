'use client';

import React, { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type AuctionLot = {
  id: string;
  lot_number: number;
  status: 'AVAILABLE' | 'LIVE' | 'SOLD' | 'UNSOLD' | 'CANCELLED';
  current_highest_bid: number | null;
  current_highest_team_owner_id: string | null;
  current_team?: { owner_name: string; team_name: string | null } | null;
  sold_amount: number | null;
  bid_deadline_at: string | null;
  round?: { round_number: number; round_type: string; status: string } | null;
  player?: { full_name: string; cricket_role: string | null } | null;
};

type RouteParams = { auctionId: string };

export default function AuctionSettlementPage({ params }: { params: Promise<RouteParams> }) {
  const { auctionId } = use(params);
  const router = useRouter();
  const [lots, setLots] = useState<AuctionLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busyLotIds, setBusyLotIds] = useState<string[]>([]);
  const [ending, setEnding] = useState(false);
  const [autoSettleReady, setAutoSettleReady] = useState(true);
  const [reason, setReason] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/admin/auctions/${auctionId}/pool`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load auction lots');
    setLots(data.lots || []);
    setError(null);
  }, [auctionId]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        await refresh();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load auction lots');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const refreshTimer = window.setInterval(() => {
      void refresh().catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to refresh auction lots');
      });
    }, 5000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [refresh]);

  const settle = useCallback(async (lotId: string) => {
    setAutoSettleReady(false);
    setBusyLotIds((current) => current.includes(lotId) ? current : [...current, lotId]);
    try {
      const response = await fetch(`/api/admin/auctions/${auctionId}/lots/${lotId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SETTLE' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Settlement was rejected');
      await refresh();
    } catch (settleError) {
      const message = settleError instanceof Error ? settleError.message : 'Settlement failed';
      if (message === 'BID_DEADLINE_NOT_EXPIRED') {
        await refresh().catch((refreshError) => {
          setError(refreshError instanceof Error ? refreshError.message : 'Unable to refresh auction lots');
        });
        window.setTimeout(() => setAutoSettleReady(true), 1000);
      } else {
        setError(message);
      }
    } finally {
      setBusyLotIds((current) => current.filter((id) => id !== lotId));
    }
  }, [auctionId, refresh]);

  const liveLot = useMemo(() => lots.find((lot) => lot.status === 'LIVE'), [lots]);
  const liveSecondsLeft = liveLot?.bid_deadline_at
    ? Math.max(0, Math.ceil((Date.parse(liveLot.bid_deadline_at) - now) / 1000))
    : null;

  useEffect(() => {
    if (
      liveLot
      && liveSecondsLeft === 0
      && autoSettleReady
      && !busyLotIds.includes(liveLot.id)
    ) {
      void settle(liveLot.id);
    }
  }, [autoSettleReady, busyLotIds, liveLot, liveSecondsLeft, settle]);

  const startLot = async (lotId: string) => {
    setBusyLotIds((current) => [...current, lotId]);
    try {
      const response = await fetch(`/api/admin/auctions/${auctionId}/lots/${lotId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'START' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to start lot');
      await refresh();
      setAutoSettleReady(true);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start lot');
    } finally {
      setBusyLotIds((current) => current.filter((id) => id !== lotId));
    }
  };

  const endAuction = async () => {
    if (!window.confirm('End this auction? Open players will remain UNSOLD.')) return;
    setEnding(true);
    try {
      const response = await fetch(`/api/admin/auctions/${auctionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to end auction');
      await refresh();
      router.refresh();
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : 'Unable to end auction');
    } finally {
      setEnding(false);
    }
  };

  if (loading) return <p className="text-slate-300">Loading auction…</p>;

  return (
    <main className="mx-auto max-w-5xl space-y-6 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Auction settlement</h1>
          <p className="mt-1 text-sm text-slate-400">Server time determines bid acceptance and settlement.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/manager/auctions/${auctionId}/control`}
            className="rounded-lg border border-teal-500/40 px-4 py-2 text-sm font-semibold text-teal-200 hover:bg-teal-950/40"
          >
            Admin control panel
          </Link>
          <button
            type="button"
            onClick={endAuction}
            disabled={ending}
            className="rounded-lg border border-rose-500/50 px-4 py-2 text-sm font-semibold text-rose-300 disabled:opacity-50"
          >
            {ending ? 'Ending…' : 'End auction'}
          </button>
        </div>
      </header>

      <label className="block max-w-xl text-sm text-slate-300">
        End reason (optional)
        <input
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"
        />
      </label>

      {error && <p role="alert" className="rounded-lg bg-rose-950/60 p-3 text-sm text-rose-200">{error}</p>}

      {liveLot && (
        <section aria-live="polite" className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-5">
          <h2 className="text-lg font-semibold">{liveLot.player?.full_name || 'Live player'}</h2>
          <p className="mt-2 text-sm text-slate-300">
            Current bid: {liveLot.current_highest_bid === null ? 'No bids' : `₹${liveLot.current_highest_bid.toLocaleString('en-IN')}`}
          </p>
          {liveLot.current_team && (
            <p className="mt-1 text-sm text-slate-300">
              Leading team: {liveLot.current_team.team_name || liveLot.current_team.owner_name}
            </p>
          )}
          <p className="mt-1 text-sm font-semibold text-emerald-300">
            {liveSecondsLeft === 0
              ? 'SETTLING…'
              : `TIME LEFT ${String(Math.floor((liveSecondsLeft || 0) / 60)).padStart(2, '0')}:${String((liveSecondsLeft || 0) % 60).padStart(2, '0')}`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Deadline: {liveLot.bid_deadline_at ? new Date(liveLot.bid_deadline_at).toLocaleString() : 'Unavailable'}
          </p>
          <button
            type="button"
            onClick={() => settle(liveLot.id)}
            disabled={liveSecondsLeft !== 0 || busyLotIds.includes(liveLot.id)}
            className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busyLotIds.includes(liveLot.id) ? 'Settling…' : 'Settle expired lot'}
          </button>
        </section>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-800">
        <h2 className="border-b border-slate-800 bg-slate-900 px-4 py-3 font-semibold">Lots</h2>
        <div className="divide-y divide-slate-800">
          {lots.map((lot) => (
            <div key={lot.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium">
                  #{lot.lot_number} · {lot.player?.full_name || 'Player'}
                </p>
                <p className="text-xs text-slate-400">
                  Round {lot.round?.round_number || 1} · {lot.status}
                  {lot.status === 'SOLD' && lot.sold_amount !== null
                    ? ` · SOLD ₹${lot.sold_amount.toLocaleString('en-IN')}`
                    : ''}
                </p>
              </div>
              {lot.status === 'AVAILABLE' && !liveLot && (
                <button
                  type="button"
                  onClick={() => startLot(lot.id)}
                  disabled={busyLotIds.includes(lot.id)}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-50"
                >
                  {busyLotIds.includes(lot.id) ? 'Starting…' : 'Start lot'}
                </button>
              )}
            </div>
          ))}
          {lots.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No auction lots found.</p>}
        </div>
      </section>
    </main>
  );
}
