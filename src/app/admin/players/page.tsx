'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { formatDate, cricketRoleLabels } from '@/lib/utils/format';
import { Download, Eye, CheckCircle2, ShieldCheck, Trophy, History, Trash2, AlertCircle, ExternalLink } from 'lucide-react';
import { PlayerDetailsModal } from '@/components/admin/PlayerDetailsModal';

export default function AdminPlayersPage() {
  const [players, setPlayers] = useState<any[]>([]);
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [tournamentFilter, setTournamentFilter] = useState('ALL');

  // Approve Modal
  const [selectedPlayerForPayment, setSelectedPlayerForPayment] = useState<any | null>(null);
  const [txRefInput, setTxRefInput] = useState('');
  const [verifyNoteInput, setVerifyNoteInput] = useState('');
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Pending/Re-upload Modal
  const [selectedPlayerForPending, setSelectedPlayerForPending] = useState<any | null>(null);
  const [pendingReason, setPendingReason] = useState('');
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);

  // History Modal
  const [selectedPlayerHistory, setSelectedPlayerHistory] = useState<any | null>(null);

  // Screenshot Viewer
  const [screenshotViewUrl, setScreenshotViewUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  // Player Details Modal
  const [selectedDetailsItem, setSelectedDetailsItem] = useState<{ playerId: string; registrationId: string } | null>(null);

  const fetchPlayers = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (roleFilter !== 'ALL') params.set('role', roleFilter);
    if (statusFilter !== 'ALL') params.set('status', statusFilter);
    if (tournamentFilter !== 'ALL') params.set('tournamentId', tournamentFilter);

    fetch(`/api/admin/players?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setPlayers(data.players || []);
          setTournaments(data.tournaments || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPlayers();
  }, [search, roleFilter, statusFilter, tournamentFilter]);

  // Authoritative: use registration_status, not payment_status
  const isConfirmed = (item: any) => item.registration_status === 'CONFIRMED';

  const getScreenshotPath = (item: any): string | null => {
    const pay = Array.isArray(item.payments) ? item.payments[0] : item.payments;
    return pay?.screenshot_object_path || pay?.payment_screenshot_url || null;
  };

  const handleViewScreenshot = async (item: any) => {
    const pay = Array.isArray(item.payments) ? item.payments[0] : item.payments;
    // The API already resolved object paths to signed URLs
    const resolvedUrl = pay?.payment_screenshot_url;
    const objectPath = pay?.screenshot_object_path;

    if (resolvedUrl && (resolvedUrl.startsWith('http://') || resolvedUrl.startsWith('https://'))) {
      setScreenshotViewUrl(resolvedUrl);
      return;
    }

    const path = objectPath || resolvedUrl;
    if (!path) return;

    setScreenshotLoading(true);
    try {
      const res = await fetch(`/api/admin/payments/screenshot-url?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.signedUrl) {
        setScreenshotViewUrl(data.signedUrl);
      } else {
        alert('Could not load screenshot: ' + (data.error || 'Unknown error'));
      }
    } catch {
      alert('Network error loading screenshot');
    } finally {
      setScreenshotLoading(false);
    }
  };

  const handleDeletePlayerRegistration = async (id: string, name: string) => {
    if (!window.confirm(`Delete registration for "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/registrations/${id}`, { method: 'DELETE' });
      const resData = await res.json();
      if (res.ok) fetchPlayers();
      else alert(resData.error || 'Failed to delete entry');
    } catch {
      alert('Network error deleting entry');
    }
  };

  const handleOpenApproveModal = (playerItem: any) => {
    setSelectedPlayerForPayment(playerItem);
    const pay = Array.isArray(playerItem.payments) ? playerItem.payments[0] : playerItem.payments;
    setTxRefInput(pay?.transaction_reference || '');
    setVerifyNoteInput('');
    setModalError(null);
  };

  const handleOpenPendingModal = (playerItem: any) => {
    setSelectedPlayerForPending(playerItem);
    setPendingReason('');
    setPendingError(null);
  };

  // Approve & Mark Paid — sets registration_status=CONFIRMED, payment_status=SUCCESSFUL
  const handleConfirmManualPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayerForPayment) return;

    setVerifyingPayment(true);
    setModalError(null);

    try {
      const res = await fetch(`/api/admin/registrations/${selectedPlayerForPayment.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'APPROVE',
          transactionReference: txRefInput,
          verificationNote: verifyNoteInput || 'Payment verified and approved by admin.',
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setModalError(data.error || 'Failed to approve registration');
      } else {
        // Immediately close modal and refresh — no artificial delay
        setSelectedPlayerForPayment(null);
        fetchPlayers();
      }
    } catch {
      setModalError('Network error. Please retry.');
    } finally {
      setVerifyingPayment(false);
    }
  };

  // Payment Pending / Re-upload — records admin reason, resets status to PENDING
  const handleMarkPending = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlayerForPending) return;
    if (!pendingReason.trim()) {
      setPendingError('Please provide a reason for requesting re-upload.');
      return;
    }

    setPendingLoading(true);
    setPendingError(null);

    try {
      const res = await fetch(`/api/admin/registrations/${selectedPlayerForPending.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PAYMENT_PENDING',
          verificationNote: pendingReason.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setPendingError(data.error || 'Failed to update status');
      } else {
        setSelectedPlayerForPending(null);
        fetchPlayers();
      }
    } catch {
      setPendingError('Network error. Please retry.');
    } finally {
      setPendingLoading(false);
    }
  };

  const handleExportCsv = () => {
    window.open(`/api/admin/export?tournamentId=${tournamentFilter}`, '_blank');
  };

  const getBadgeStatus = (item: any) => {
    const rs = item.registration_status;
    if (rs === 'CONFIRMED') return 'CONFIRMED';
    if (rs === 'REJECTED') return 'REJECTED';
    if (rs === 'CANCELLED') return 'CANCELLED';
    if (rs === 'WAITING_LIST') return 'WAITING_LIST';
    return 'WAITING_LIST';
  };

  const getBadgeLabel = (item: any) => {
    const rs = item.registration_status;
    if (rs === 'CONFIRMED') return 'Confirmed ✓';
    if (rs === 'REJECTED') return 'Rejected';
    if (rs === 'CANCELLED') return 'Cancelled';
    if (rs === 'CORRECTION_REQUESTED') return 'Correction Requested';
    if (rs === 'WAITING_LIST') return 'Waitlist';
    const pay = Array.isArray(item.payments) ? item.payments[0] : item.payments;
    if (pay?.screenshot_object_path || pay?.payment_screenshot_url) return 'Screenshot Uploaded';
    return 'Pending Verification';
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2">
            <Trophy className="w-7 h-7 text-emerald-400" />
            <span>Player Directory & Tournament Approvals</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Approve registrations, view payment screenshots, request re-uploads, or delete entries.
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={handleExportCsv}
          leftIcon={<Download className="w-4 h-4 text-emerald-400" />}
        >
          Export Tournament CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input
            placeholder="Search Name, Ref ID, Email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            value={tournamentFilter}
            onChange={(e) => setTournamentFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Tournaments' },
              ...tournaments.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Cricket Roles' },
              { value: 'BATSMAN', label: 'Batsman' },
              { value: 'BOWLER', label: 'Bowler' },
              { value: 'ALL_ROUNDER', label: 'All-rounder' },
              { value: 'BATSMAN_WICKETKEEPER', label: 'Batsman + WK' },
              { value: 'BOWLER_WICKETKEEPER', label: 'Bowler + WK' },
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'ALL', label: 'All Statuses' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'PENDING', label: 'Pending Verification' },
              { value: 'WAITING_LIST', label: 'Waitlist' },
              { value: 'REJECTED', label: 'Rejected' },
            ]}
          />
        </div>
      </Card>

      {/* MOBILE CARD VIEW */}
      <div className="block md:hidden space-y-4">
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">Loading player directory...</div>
        ) : players.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">No registered players found.</div>
        ) : (
          players.map((item) => {
            const p = item.player || {};
            const confirmed = isConfirmed(item);
            const hasScreenshot = Boolean(getScreenshotPath(item));

            return (
              <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-mono text-xs font-bold text-emerald-400">
                    {item.registration_number}
                  </span>
                  <Badge status={getBadgeStatus(item)}>{getBadgeLabel(item)}</Badge>
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">{item.registered_name_snapshot || p.full_name}</h3>
                  <p className="text-xs text-slate-400">{p.email}</p>
                  <span className="text-[11px] text-emerald-400 font-medium block mt-0.5">
                    {item.tournament?.name || 'FairPlay Premier League'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Role</span>
                    <span className="font-medium text-slate-200">
                      {cricketRoleLabels[item.registered_role_snapshot as keyof typeof cricketRoleLabels] || item.registered_role_snapshot}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Jersey</span>
                    <span className="font-bold text-amber-400 block">{item.registered_jersey_size_snapshot || 'M'}</span>
                    {(item.registered_jersey_name_snapshot || item.registered_jersey_number_snapshot) && (
                      <span className="text-[9px] text-slate-300 font-mono block">
                        {item.registered_jersey_name_snapshot} #{item.registered_jersey_number_snapshot}
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block font-bold">Type</span>
                    <span className="font-bold text-sky-400">{item.registration_type || 'PLAYER'}</span>
                  </div>
                </div>
                {hasScreenshot && (
                  <button
                    onClick={() => handleViewScreenshot(item)}
                    disabled={screenshotLoading}
                    className="w-full text-xs text-emerald-400 border border-emerald-800/50 rounded-xl py-1.5 hover:bg-emerald-950/30 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" /> View Payment Screenshot
                  </button>
                )}
                <div className="pt-1 flex items-center gap-2 flex-wrap">
                  {!confirmed ? (
                    <>
                      <Button variant="primary" size="sm" onClick={() => handleOpenApproveModal(item)} leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                        Approve
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => handleOpenPendingModal(item)} leftIcon={<AlertCircle className="w-3.5 h-3.5 text-amber-400" />}>
                        Pending
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="w-4 h-4" /> Confirmed
                    </span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDetailsItem({ playerId: item.player_id, registrationId: item.id })}
                    leftIcon={<Eye className="w-3.5 h-3.5 text-emerald-400" />}
                  >
                    Details
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedPlayerHistory(item)} leftIcon={<History className="w-3.5 h-3.5 text-sky-400" />}>
                    History
                  </Button>
                  <Link href={`/registration/${item.id}`}>
                    <Button variant="outline" size="sm" leftIcon={<Eye className="w-3.5 h-3.5" />}>Pass</Button>
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* DESKTOP TABLE VIEW */}
      <div className="hidden md:block bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase text-[11px] font-bold tracking-wider border-b border-slate-800">
              <tr>
                <th className="px-5 py-4">Reg #</th>
                <th className="px-5 py-4">Player</th>
                <th className="px-5 py-4">Tournament</th>
                <th className="px-5 py-4">Role & Jersey</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4">Screenshot</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading player directory...</td></tr>
              ) : players.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No matching player registrations found.</td></tr>
              ) : (
                players.map((item) => {
                  const p = item.player || {};
                  const confirmed = isConfirmed(item);
                  const hasScreenshot = Boolean(getScreenshotPath(item));
                  const pay = Array.isArray(item.payments) ? item.payments[0] : item.payments || {};

                  return (
                    <tr key={item.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-5 py-4 font-mono font-bold text-emerald-400 whitespace-nowrap">
                        <div>{item.registration_number}</div>
                        <div className="text-[10px] text-slate-500 font-normal">{item.registration_type || 'PLAYER'}</div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="block font-bold text-slate-100">{item.registered_name_snapshot || p.full_name}</span>
                        <span className="text-xs text-slate-400 font-normal">{p.email}</span>
                      </td>
                      <td className="px-5 py-4 text-slate-300 text-xs">{item.tournament?.name || 'FairPlay Premier League'}</td>
                      <td className="px-5 py-4">
                        <span className="block font-semibold text-slate-200 text-xs">
                          {cricketRoleLabels[item.registered_role_snapshot as keyof typeof cricketRoleLabels] || item.registered_role_snapshot}
                        </span>
                        <span className="text-xs text-amber-400 font-bold block">
                          Size: {item.registered_jersey_size_snapshot || 'M'}
                        </span>
                        {(item.registered_jersey_name_snapshot || item.registered_jersey_number_snapshot) && (
                          <span className="text-[11px] text-slate-300 block font-mono">
                            {item.registered_jersey_name_snapshot || ''} {item.registered_jersey_number_snapshot ? `#${item.registered_jersey_number_snapshot}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <Badge status={getBadgeStatus(item)}>{getBadgeLabel(item)}</Badge>
                        {pay?.transaction_reference && (
                          <div className="text-[10px] text-slate-500 mt-1 font-mono">Ref: {pay.transaction_reference}</div>
                        )}
                        {pay?.verification_note && (
                          <div className="text-[10px] text-amber-400/80 mt-0.5 max-w-[160px] truncate" title={pay.verification_note}>
                            {pay.verification_note}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {hasScreenshot ? (
                          <button
                            onClick={() => handleViewScreenshot(item)}
                            disabled={screenshotLoading}
                            className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-800/50 rounded-lg px-2 py-1 transition-colors hover:bg-emerald-950/30"
                          >
                            <Eye className="w-3 h-3" /> View
                          </button>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {!confirmed ? (
                            <>
                              <Button variant="primary" size="sm" onClick={() => handleOpenApproveModal(item)} leftIcon={<CheckCircle2 className="w-3.5 h-3.5" />}>
                                Approve & Mark Paid
                              </Button>
                              <Button variant="secondary" size="sm" onClick={() => handleOpenPendingModal(item)} leftIcon={<AlertCircle className="w-3.5 h-3.5 text-amber-400" />}>
                                Payment Pending
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs font-bold text-emerald-400 inline-flex items-center gap-1 mr-1">
                              <ShieldCheck className="w-4 h-4" /> Confirmed
                            </span>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedDetailsItem({ playerId: item.player_id, registrationId: item.id })}
                            leftIcon={<Eye className="w-3.5 h-3.5 text-emerald-400" />}
                          >
                            Details
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setSelectedPlayerHistory(item)} leftIcon={<History className="w-3.5 h-3.5 text-sky-400" />}>
                            History ({item.tournamentHistoryCount || 1})
                          </Button>
                          <Link href={`/registration/${item.id}`}>
                            <Button variant="ghost" size="sm" leftIcon={<Eye className="w-4 h-4 text-emerald-400" />}>Pass</Button>
                          </Link>
                          <Button variant="danger" size="sm" onClick={() => handleDeletePlayerRegistration(item.id, item.registered_name_snapshot || p.full_name || 'Player')} leftIcon={<Trash2 className="w-3.5 h-3.5" />}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SCREENSHOT VIEWER MODAL */}
      <Modal isOpen={Boolean(screenshotViewUrl)} onClose={() => setScreenshotViewUrl(null)} title="Payment Receipt Screenshot">
        {screenshotViewUrl && (
          <div className="space-y-4">
            <div className="w-full max-h-[70vh] rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center">
              <img src={screenshotViewUrl} alt="Payment Receipt" className="max-h-[70vh] max-w-full object-contain" />
            </div>
            <div className="flex justify-between gap-3 pt-2 border-t border-slate-800">
              <a href={screenshotViewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:underline">
                <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
              </a>
              <Button variant="secondary" onClick={() => setScreenshotViewUrl(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* TOURNAMENT HISTORY MODAL */}
      <Modal isOpen={Boolean(selectedPlayerHistory)} onClose={() => setSelectedPlayerHistory(null)} title="Player Tournament History">
        {selectedPlayerHistory && (
          <div className="space-y-6 text-xs sm:text-sm">
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <h3 className="text-lg font-bold text-white">{selectedPlayerHistory.registered_name_snapshot || selectedPlayerHistory.player?.full_name}</h3>
              <p className="text-xs text-slate-400">{selectedPlayerHistory.player?.email}</p>
              <div className="flex items-center gap-3 mt-1.5 text-xs">
                <span className="text-emerald-400 font-bold">
                  Role: {cricketRoleLabels[selectedPlayerHistory.registered_role_snapshot as keyof typeof cricketRoleLabels] || selectedPlayerHistory.registered_role_snapshot}
                </span>
                <span className="text-amber-400 font-bold">Jersey: {selectedPlayerHistory.registered_jersey_size_snapshot || 'M'}</span>
              </div>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {(selectedPlayerHistory.tournamentHistory || []).map((t: any, idx: number) => (
                <div key={idx} className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-white block">{t.tournamentName}</span>
                    <span className="font-mono text-[11px] text-slate-400">Ref: {t.registrationNumber}</span>
                  </div>
                  <div className="text-right">
                    <Badge status={t.status === 'CONFIRMED' ? 'CONFIRMED' : 'WAITING_LIST'}>
                      {t.status === 'CONFIRMED' ? 'Confirmed' : t.status || 'Pending'}
                    </Badge>
                    <span className="text-[10px] text-slate-400 block mt-1">{formatDate(t.registeredAt)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedPlayerHistory(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* APPROVE & MARK PAID MODAL */}
      <Modal isOpen={Boolean(selectedPlayerForPayment)} onClose={() => setSelectedPlayerForPayment(null)} title="Approve & Mark Paid — Admin Verification">
        {selectedPlayerForPayment && (
          <form onSubmit={handleConfirmManualPayment} className="space-y-4 text-xs sm:text-sm">
            {modalError && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs">{modalError}</div>
            )}
            <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Player:</span>
                <span className="font-bold text-white">{selectedPlayerForPayment.registered_name_snapshot || selectedPlayerForPayment.player?.full_name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Tournament:</span>
                <span className="font-bold text-emerald-400">{selectedPlayerForPayment.tournament?.name}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Reg #:</span>
                <span className="font-mono font-bold text-emerald-400">{selectedPlayerForPayment.registration_number}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Current Status:</span>
                <span className="font-bold text-amber-400">{selectedPlayerForPayment.registration_status}</span>
              </div>
            </div>

            {/* Screenshot preview — use the already-resolved signed URL from API */}
            {selectedPlayerForPayment.payments?.[0]?.payment_screenshot_url ? (
              <div className="p-4 bg-slate-950/90 border border-emerald-500/40 rounded-2xl space-y-3">
                <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block">Uploaded Payment Receipt</span>
                <div className="w-full h-48 rounded-xl overflow-hidden bg-slate-900 border border-slate-800 flex items-center justify-center">
                  <img
                    src={selectedPlayerForPayment.payments[0].payment_screenshot_url}
                    alt="Payment Receipt"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <button type="button" onClick={() => setScreenshotViewUrl(selectedPlayerForPayment.payments[0].payment_screenshot_url)} className="text-xs text-emerald-400 hover:underline flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Open in full viewer
                </button>
              </div>
            ) : (
              <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl text-amber-300 text-xs">
                💡 No payment screenshot attached. You can still approve manually.
              </div>
            )}

            <Input label="Transaction Reference / UTR Number" placeholder="e.g. 429381048201" value={txRefInput} onChange={(e) => setTxRefInput(e.target.value)} />
            <Input label="Admin Approval Note (Optional)" placeholder="e.g. Verified UPI statement" value={verifyNoteInput} onChange={(e) => setVerifyNoteInput(e.target.value)} />

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setSelectedPlayerForPayment(null)}>Cancel</Button>
              <Button type="submit" isLoading={verifyingPayment} leftIcon={<CheckCircle2 className="w-4 h-4" />}>
                Approve & Mark Paid
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* PAYMENT PENDING / RE-UPLOAD MODAL */}
      <Modal isOpen={Boolean(selectedPlayerForPending)} onClose={() => setSelectedPlayerForPending(null)} title="Payment Pending / Request Re-upload">
        {selectedPlayerForPending && (
          <form onSubmit={handleMarkPending} className="space-y-4 text-xs sm:text-sm">
            {pendingError && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs">{pendingError}</div>
            )}
            <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-900">
                <span className="text-slate-400">Player:</span>
                <span className="font-bold text-white">{selectedPlayerForPending.registered_name_snapshot || selectedPlayerForPending.player?.full_name}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Reg #:</span>
                <span className="font-mono font-bold text-emerald-400">{selectedPlayerForPending.registration_number}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Reason for Payment Pending / Re-upload Request <span className="text-rose-400">*</span>
              </label>
              <textarea
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none min-h-[80px]"
                placeholder="e.g. Screenshot is blurry. Please re-upload a clear screenshot showing UPI transaction ID and amount."
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                required
              />
              <p className="text-[10px] text-slate-500 mt-1">This reason will be shown to the player.</p>
            </div>
            <div className="pt-3 border-t border-slate-800 flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setSelectedPlayerForPending(null)}>Cancel</Button>
              <Button type="submit" isLoading={pendingLoading} leftIcon={<AlertCircle className="w-4 h-4 text-amber-400" />}>
                Mark Payment Pending
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* PLAYER DETAILS MODAL */}
      <PlayerDetailsModal
        isOpen={Boolean(selectedDetailsItem)}
        onClose={() => setSelectedDetailsItem(null)}
        playerId={selectedDetailsItem?.playerId}
        registrationId={selectedDetailsItem?.registrationId}
      />
    </div>
  );
}
