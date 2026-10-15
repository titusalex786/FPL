'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Gavel,
  Plus,
  Loader2,
  AlertCircle,
  Tv,
  Eye,
  Sliders,
  Search,
  ChevronDown,
  RotateCcw,
  X,
  Filter,
} from 'lucide-react';

interface AuctionItem {
  id: string;
  auctionName: string;
  tournamentId: string;
  tournamentName: string;
  status: string;
  startingKitty: number;
  requiredPlayersToBuy: number;
  teamsCount: number;
  playersPurchased: number;
  playersRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export default function AuctionsListPage() {
  const [auctions, setAuctions] = useState<AuctionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tournamentFilter, setTournamentFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'NEWEST' | 'OLDEST'>('NEWEST');

  useEffect(() => {
    let active = true;

    async function loadAuctions() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/admin/auctions', { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Unauthorized: Manager or Admin access required');
          }
          throw new Error('Failed to load auctions.');
        }
        const data = await res.json();
        if (active) {
          setAuctions(data.auctions || []);
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadAuctions();

    return () => {
      active = false;
    };
  }, []);

  // Dynamically populated tournaments from loaded auctions
  const tournamentOptions = useMemo(() => {
    const map = new Map<string, string>();
    auctions.forEach((a) => {
      if (a.tournamentId && a.tournamentName) {
        map.set(a.tournamentId, a.tournamentName);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [auctions]);

  // Client-side filtering & sorting
  const filteredAuctions = useMemo(() => {
    return auctions
      .filter((auction) => {
        // 1. Search filter: case-insensitive by auctionName OR tournamentName
        if (searchTerm.trim()) {
          const term = searchTerm.trim().toLowerCase();
          const matchAuctionName = (auction.auctionName || '').toLowerCase().includes(term);
          const matchTournamentName = (auction.tournamentName || '').toLowerCase().includes(term);
          if (!matchAuctionName && !matchTournamentName) {
            return false;
          }
        }

        // 2. Status filter
        if (statusFilter !== 'ALL') {
          if (statusFilter === 'ENDED') {
            if (auction.status !== 'ENDED' && auction.status !== 'CLOSED') {
              return false;
            }
          } else if (auction.status !== statusFilter) {
            return false;
          }
        }

        // 3. Tournament filter
        if (tournamentFilter !== 'ALL') {
          if (auction.tournamentId !== tournamentFilter && auction.tournamentName !== tournamentFilter) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (sortBy === 'OLDEST') {
          return timeA - timeB;
        }
        return timeB - timeA;
      });
  }, [auctions, searchTerm, statusFilter, tournamentFilter, sortBy]);

  const isFiltered =
    searchTerm.trim() !== '' ||
    statusFilter !== 'ALL' ||
    tournamentFilter !== 'ALL' ||
    sortBy !== 'NEWEST';

  const handleClearFilters = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setTournamentFilter('ALL');
    setSortBy('NEWEST');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'LIVE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            LIVE
          </span>
        );
      case 'OPEN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            OPEN
          </span>
        );
      case 'PAUSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            PAUSED
          </span>
        );
      case 'ENDED':
      case 'CLOSED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            ENDED
          </span>
        );
      case 'DRAFT':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/40">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            DRAFT
          </span>
        );
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '—';
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-teal-950 border border-teal-500/40 text-teal-300 text-xs font-bold uppercase tracking-wider">
              Draft & Bidding
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Auctions
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage tournament auctions
          </p>
        </div>
        <Link
          href="/manager/auctions/new"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-4 py-2.5 text-sm transition-colors shadow-lg shadow-teal-500/20 shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>+ Create Auction</span>
        </Link>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-200 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="min-h-[300px] flex flex-col items-center justify-center text-slate-400 gap-3 rounded-2xl border border-slate-800 bg-slate-900/40">
          <Loader2 className="w-7 h-7 animate-spin text-teal-500" />
          <span className="text-sm font-medium">Loading auctions...</span>
        </div>
      ) : auctions.length === 0 ? (
        /* Empty Database State */
        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-4 shadow-inner">
            <Gavel className="w-7 h-7 text-teal-400" />
          </div>
          <h3 className="text-lg font-bold text-white">No auctions created yet.</h3>
          <p className="mt-1.5 text-sm text-slate-400 max-w-sm mx-auto">
            Get started by creating a new player auction for an owner-based tournament.
          </p>
          <div className="mt-6">
            <Link
              href="/manager/auctions/new"
              className="inline-flex items-center gap-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-5 py-2.5 text-sm transition-colors shadow-lg shadow-teal-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>+ Create Auction</span>
            </Link>
          </div>
        </div>
      ) : (
        /* Main Auctions Workspace with Filters */
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Search Filter */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search auctions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-8 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm placeholder-slate-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                    title="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* 2. Status Filter */}
              <div className="relative">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-teal-500 cursor-pointer appearance-none pr-9 transition-colors"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="DRAFT">DRAFT</option>
                  <option value="OPEN">OPEN</option>
                  <option value="PAUSED">PAUSED</option>
                  <option value="LIVE">LIVE</option>
                  <option value="ENDED">ENDED</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>

              {/* 3. Tournament Filter */}
              <div className="relative">
                <select
                  value={tournamentFilter}
                  onChange={(e) => setTournamentFilter(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-teal-500 cursor-pointer appearance-none pr-9 truncate transition-colors"
                >
                  <option value="ALL">All Tournaments</option>
                  {tournamentOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>

              {/* 4. Sort Filter */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'NEWEST' | 'OLDEST')}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-teal-500 cursor-pointer appearance-none pr-9 transition-colors"
                >
                  <option value="NEWEST">Newest first</option>
                  <option value="OLDEST">Oldest first</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>

            {/* Clear Filters bar if any filter is active */}
            {isFiltered && (
              <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-teal-400" />
                  Active filters applied
                </span>
                <button
                  onClick={handleClearFilters}
                  className="text-teal-400 hover:text-teal-300 font-semibold flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-slate-800/50"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear Filters</span>
                </button>
              </div>
            )}
          </div>

          {/* Result Count Indicator */}
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <span>
              Showing {filteredAuctions.length} of {auctions.length} {auctions.length === 1 ? 'auction' : 'auctions'}
            </span>
            {isFiltered && (
              <button
                onClick={handleClearFilters}
                className="text-teal-400 hover:text-teal-300 font-semibold transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* List or No-Match Empty State */}
          {filteredAuctions.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-12 text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400">
                <Search className="w-5 h-5 text-slate-400" />
              </div>
              <h3 className="text-base font-bold text-white">No auctions match your filters.</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Try adjusting your search query, status, or tournament filter to find the auction you are looking for.
              </p>
              <div className="pt-2">
                <button
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-teal-300 hover:bg-slate-700 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Clear Filters</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredAuctions.map((auction) => {
                const shortenedId = auction.id ? `${auction.id.slice(0, 8)}...` : '';
                return (
                  <div
                    key={auction.id}
                    className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6 hover:border-slate-700 transition-colors shadow-xl"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      {/* Left: Tournament & Status */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                            {auction.tournamentName}
                          </h2>
                          {getStatusBadge(auction.status)}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                          <span className="font-mono text-slate-500">ID: {shortenedId}</span>
                          <span>•</span>
                          <span>Created: {formatDate(auction.createdAt)}</span>
                          {auction.updatedAt && (
                            <>
                              <span>•</span>
                              <span>Updated: {formatDate(auction.updatedAt)} {formatTime(auction.updatedAt)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Middle: Metrics Chips */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4 py-2 border-y sm:border-y-0 sm:border-x border-slate-800/80 px-0 sm:px-5">
                        <div className="rounded-xl bg-slate-950/60 p-2.5 text-center">
                          <span className="block text-[11px] font-semibold uppercase text-slate-500">Starting Kitty</span>
                          <span className="block text-sm font-bold text-teal-300 mt-0.5">
                            ₹{auction.startingKitty?.toLocaleString('en-IN') ?? '1,80,000'}
                          </span>
                        </div>
                        <div className="rounded-xl bg-slate-950/60 p-2.5 text-center">
                          <span className="block text-[11px] font-semibold uppercase text-slate-500">Teams</span>
                          <span className="block text-sm font-bold text-white mt-0.5">
                            {auction.teamsCount ?? 0}
                          </span>
                        </div>
                        <div className="rounded-xl bg-slate-950/60 p-2.5 text-center">
                          <span className="block text-[11px] font-semibold uppercase text-slate-500">Purchased</span>
                          <span className="block text-sm font-bold text-emerald-400 mt-0.5">
                            {auction.playersPurchased ?? 0}
                          </span>
                        </div>
                        <div className="rounded-xl bg-slate-950/60 p-2.5 text-center">
                          <span className="block text-[11px] font-semibold uppercase text-slate-500">Remaining</span>
                          <span className="block text-sm font-bold text-amber-300 mt-0.5">
                            {auction.playersRemaining ?? 0}
                          </span>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <Link
                          href={`/manager/auctions/${auction.id}/control`}
                          className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold px-4 py-2.5 text-xs sm:text-sm transition-colors shadow-md"
                        >
                          <Sliders className="w-4 h-4" />
                          <span>Open Control Panel</span>
                        </Link>
                        <Link
                          href={`/manager/auctions/${auction.id}`}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold px-3 py-2.5 text-xs transition-colors"
                          title="View Auction Details"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Auction</span>
                        </Link>
                        <Link
                          href={`/auction/${auction.id}/live`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold px-3 py-2.5 text-xs transition-colors"
                          title="Open Live Projector"
                        >
                          <Tv className="w-3.5 h-3.5 text-rose-400" />
                          <span>Open Projector</span>
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
