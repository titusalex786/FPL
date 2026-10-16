'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

type TournamentOption = {
  id: string;
  name: string;
  eligibleTeamCount: number;
  existingAuction: { id: string; name: string | null; status: string } | null;
};

type AuctionConfiguration = {
  startingKitty: number;
  requiredPlayersToBuy: number;
  baseBid: number;
  bidThreshold: number;
  lowIncrement: number;
  highIncrement: number;
  minimumReserve: number;
  bidTimerSeconds: number;
  maximumBid: number | null;
  allowOwnerSelfPurchase: boolean;
};

type ProvisioningResult = {
  auction_id: string;
  auction_name: string;
  status: string;
  teams_initialized: number;
  starting_kitty: number;
  required_players_to_buy: number;
};

const initialConfiguration: AuctionConfiguration = {
  startingKitty: 180000,
  requiredPlayersToBuy: 9,
  baseBid: 5000,
  bidThreshold: 20000,
  lowIncrement: 1000,
  highIncrement: 2000,
  minimumReserve: 5000,
  bidTimerSeconds: 30,
  maximumBid: null,
  allowOwnerSelfPurchase: false,
};

function getError(payload: unknown) {
  return typeof payload === 'object' && payload !== null && 'error' in payload
    && typeof payload.error === 'string'
    ? payload.error
    : 'Auction provisioning failed.';
}

function formatRupees(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

export default function NewAuctionPage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [auctionName, setAuctionName] = useState('');
  const [isPractice, setIsPractice] = useState(false);
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProvisioningResult | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/admin/auctions', { cache: 'no-store' })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error(getError(payload));
        return payload as { tournaments: TournamentOption[] };
      })
      .then((payload) => {
        if (active) setTournaments(payload.tournaments);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Unable to load tournaments.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedTournament = useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) || null,
    [selectedTournamentId, tournaments]
  );

  function setNumber(
    field: Exclude<keyof AuctionConfiguration, 'maximumBid' | 'allowOwnerSelfPurchase'>,
    value: string
  ) {
    setConfiguration((current) => ({ ...current, [field]: value === '' ? 0 : Number(value) }));
  }

  function handlePracticeToggle(checked: boolean) {
    setIsPractice(checked);
    if (checked) {
      setAuctionName((prev) => {
        const base = prev.replace(/^\[PRACTICE\]\s*/, '').trim();
        return `[PRACTICE] ${base || (selectedTournament ? `${selectedTournament.name} Auction` : 'Practice Auction')}`;
      });
    } else {
      setAuctionName((prev) => prev.replace(/^\[PRACTICE\]\s*/, '').trim());
    }
  }

  async function createAuction() {
    if (!selectedTournament || selectedTournament.existingAuction) return;
    const confirmMsg = isPractice
      ? 'Create a SAFE Disposable Practice Auction? You can test bidding, reveals, and rounds, and delete only practice records with 1 click.'
      : 'Create this auction and initialize team budgets?';
    if (!window.confirm(confirmMsg)) return;

    setCreating(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournament.id,
          auctionName,
          isPractice,
          ...configuration,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(getError(payload));
      const provisioned = (payload as { provisioning: ProvisioningResult }).provisioning;
      setResult(provisioned);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Auction creation could not be completed.');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center gap-3 text-slate-300">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading tournaments...
      </div>
    );
  }

  if (result) {
    return (
      <main className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-300" />
            <h1 className="text-2xl font-black text-white">Auction Created Successfully</h1>
          </div>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">Auction</dt><dd className="mt-1 font-bold">{result.auction_name}</dd></div>
            <div><dt className="text-slate-400">Auction ID</dt><dd className="mt-1 break-all font-mono">{result.auction_id}</dd></div>
            <div><dt className="text-slate-400">Teams Initialized</dt><dd className="mt-1 font-bold">{result.teams_initialized} / {result.teams_initialized}</dd></div>
            <div><dt className="text-slate-400">Starting Kitty</dt><dd className="mt-1 font-bold">{formatRupees(result.starting_kitty)}</dd></div>
            <div><dt className="text-slate-400">Players Per Team</dt><dd className="mt-1 font-bold">{result.required_players_to_buy}</dd></div>
            <div><dt className="text-slate-400">Status</dt><dd className="mt-1 font-bold">{result.status}</dd></div>
          </dl>
          <p className="mt-5 text-sm text-slate-300">Configuration and team budgets are initialized. Player selection and pool preparation remain pending. The auction has not been started.</p>
          <Link
            href={`/manager/auctions/${result.auction_id}/control`}
            onClick={() => router.refresh()}
            className="mt-6 inline-flex rounded-lg bg-teal-400 px-4 py-2.5 font-bold text-slate-950 hover:bg-teal-300"
          >
            Open Auction Control Panel
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <Link href="/manager" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Manager Portal
      </Link>
      <header>
        <h1 className="text-3xl font-black text-white">Create Auction</h1>
        <p className="mt-2 text-sm text-slate-400">Provision an owner-based tournament auction and initialize its team budgets.</p>
      </header>

      {error && (
        <div role="alert" className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200">
          <ShieldAlert className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}

      <section className="grid gap-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
        <label className="grid gap-2 text-sm font-semibold text-slate-200">
          Tournament
          <select
            value={selectedTournamentId}
            onChange={(event) => setSelectedTournamentId(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
          >
            <option value="">Select an owner-based tournament</option>
            {tournaments.map((tournament) => (
              <option key={tournament.id} value={tournament.id} disabled={Boolean(tournament.existingAuction)}>
                {tournament.name}{tournament.existingAuction ? ' — auction already exists' : ''}
              </option>
            ))}
          </select>
        </label>

        {/* Practice Mode Toggle */}
        <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isPractice}
              onChange={(e) => handlePracticeToggle(e.target.checked)}
              className="mt-1 h-5 w-5 rounded border-purple-500 text-purple-600 accent-purple-500 focus:ring-purple-400"
            />
            <div className="space-y-1">
              <span className="text-sm font-bold text-purple-200 flex items-center gap-2">
                <span>🧪 Practice Auction Mode (Disposable & Safe)</span>
              </span>
              <p className="text-xs text-purple-300/80">
                Runs an end-to-end sandbox auction using current tournament participants. All real player registrations, profiles, and payments remain 100% protected and isolated. Provides a 1-click safe cleanup action that deletes ONLY practice auction records.
              </p>
            </div>
          </label>
        </div>

        <label className="grid gap-2 text-sm font-semibold text-slate-200">
          Auction name
          <input
            value={auctionName}
            onChange={(event) => setAuctionName(event.target.value)}
            maxLength={100}
            minLength={2}
            placeholder={`${selectedTournament?.name || 'Tournament'} Auction`}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5"
          />
        </label>

        <div>
          <h2 className="text-lg font-bold text-white">Auction Configuration</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['Starting kitty', 'startingKitty'],
              ['Players to buy', 'requiredPlayersToBuy'],
              ['Base bid', 'baseBid'],
              ['Bid threshold', 'bidThreshold'],
              ['Low increment', 'lowIncrement'],
              ['High increment', 'highIncrement'],
              ['Minimum reserve', 'minimumReserve'],
              ['Bid timer (seconds)', 'bidTimerSeconds'],
            ] as const).map(([label, field]) => (
              <label key={field} className="grid gap-2 text-xs font-semibold text-slate-400">
                {label}
                <input
                  type="number"
                  min={field === 'bidTimerSeconds' ? 1 : 1}
                  step={1}
                  value={configuration[field]}
                  onChange={(event) => setNumber(field, event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
                />
              </label>
            ))}
            <label className="grid gap-2 text-xs font-semibold text-slate-400">
              Maximum bid (optional)
              <input
                type="number"
                min={configuration.baseBid}
                step={1}
                value={configuration.maximumBid ?? ''}
                onChange={(event) => setConfiguration((current) => ({
                  ...current,
                  maximumBid: event.target.value === '' ? null : Number(event.target.value),
                }))}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white"
              />
            </label>
            <label className="flex items-center gap-3 self-end rounded-lg border border-slate-700 p-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={configuration.allowOwnerSelfPurchase}
                onChange={(event) => setConfiguration((current) => ({
                  ...current,
                  allowOwnerSelfPurchase: event.target.checked,
                }))}
                className="h-4 w-4 accent-teal-400"
              />
              Allow owner self-purchase
            </label>
          </div>
        </div>

        {selectedTournament && (
          <div className="rounded-xl border border-teal-500/20 bg-slate-950/80 p-5">
            <h2 className="text-lg font-bold text-white">Review</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Tournament</dt><dd>{selectedTournament.name}</dd></div>
              <div><dt className="text-slate-500">Auction</dt><dd>{auctionName || `${selectedTournament.name} Auction`}</dd></div>
              <div><dt className="text-slate-500">Starting Kitty</dt><dd>{formatRupees(configuration.startingKitty)}</dd></div>
              <div><dt className="text-slate-500">Teams / Expected Budgets</dt><dd>{selectedTournament.eligibleTeamCount} / {selectedTournament.eligibleTeamCount}</dd></div>
              <div><dt className="text-slate-500">Players To Buy</dt><dd>{configuration.requiredPlayersToBuy}</dd></div>
              <div><dt className="text-slate-500">Icon</dt><dd>1 preallocated per team</dd></div>
              <div><dt className="text-slate-500">Base / Threshold</dt><dd>{formatRupees(configuration.baseBid)} / {formatRupees(configuration.bidThreshold)}</dd></div>
              <div><dt className="text-slate-500">Low / High Increment</dt><dd>{formatRupees(configuration.lowIncrement)} / {formatRupees(configuration.highIncrement)}</dd></div>
              <div><dt className="text-slate-500">Minimum Reserve</dt><dd>{formatRupees(configuration.minimumReserve)}</dd></div>
              <div><dt className="text-slate-500">Bid Timer</dt><dd>{configuration.bidTimerSeconds} seconds</dd></div>
              <div>
                <dt className="text-slate-500">Mode</dt>
                <dd className={isPractice ? 'font-bold text-purple-300' : 'text-slate-200'}>
                  {isPractice ? '🧪 Practice Auction (Disposable)' : 'Standard Auction'}
                </dd>
              </div>
            </dl>
            {selectedTournament.existingAuction && (
              <p className="mt-4 text-sm font-semibold text-amber-300">
                An auction already exists for this tournament.
              </p>
            )}
            {selectedTournament.eligibleTeamCount === 0 && !selectedTournament.existingAuction && (
              <p className="mt-4 text-sm font-semibold text-amber-300">
                No eligible team owners were found.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void createAuction()}
          disabled={
            creating ||
            !selectedTournament ||
            Boolean(selectedTournament.existingAuction) ||
            selectedTournament.eligibleTeamCount === 0 ||
            auctionName.trim().length < 2
          }
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-400 px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {creating ? 'Creating auction...' : 'Create Auction and Initialize Budgets'}
        </button>
      </section>
    </main>
  );
}
