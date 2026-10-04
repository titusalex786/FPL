'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { Header } from '@/components/public/Header';
import { Modal } from '@/components/ui/Modal';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DeleteTournamentModal } from '@/components/admin/DeleteTournamentModal';
import { useRouter } from 'next/navigation';
import { formatPaiseToINR, formatDate } from '@/lib/utils/format';
import {
  Users,
  CheckCircle2,
  Clock,
  DollarSign,
  Copy,
  ExternalLink,
  Crown,
  ChevronLeft,
  Check,
  XCircle,
  FileImage,
  Filter,
  Search,
  Loader2,
  Eye,
  Trash2,
  FileSpreadsheet,
  Download,
  MessageSquare,
  Edit3,
} from 'lucide-react';

export default function SingleTournamentAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = use(params);

  const router = useRouter();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'registrations' | 'owners' | 'payments'>('overview');
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Approving & Modal State
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);

  // Correction Request State
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [correctionRegId, setCorrectionRegId] = useState<string | null>(null);
  const [correctionRequestedFields, setCorrectionRequestedFields] = useState<string[]>([]);
  const [correctionRemark, setCorrectionRemark] = useState('');
  const [submittingCorrectionReq, setSubmittingCorrectionReq] = useState(false);
  
  const correctionFieldOptions = [
    'Jersey Name', 'Jersey Number', 'Jersey Size', 
    'Profile Image', 'Cricket Role', 'Batting Style', 'Bowling Style', 
    'Payment Screenshot', 'Transaction Reference'
  ];

  const handleViewReceipt = async (url: string | null | undefined) => {
    if (!url || url.trim() === '') return;
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:image/')) {
      setPreviewImageUrl(url);
      return;
    }
    setLoadingReceipt(true);
    try {
      const res = await fetch(`/api/admin/payments/screenshot-url?path=${encodeURIComponent(url)}`);
      const resData = await res.json();
      if (res.ok && resData.signedUrl) {
        setPreviewImageUrl(resData.signedUrl);
      } else {
        setActionMessage(`Error loading receipt: ${resData.error || 'Failed to generate signed URL'}`);
      }
    } catch {
      setActionMessage('Network error fetching signed screenshot URL');
    } finally {
      setLoadingReceipt(false);
    }
  };

  const fetchSummary = () => {
    setLoading(true);
    fetch(`/api/admin/tournament/${tournamentId}/summary`)
      .then((res) => res.json())
      .then((resData) => {
        if (!resData.error) {
          setData(resData);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSummary();
  }, [tournamentId]);

  const handleCopyLink = () => {
    const url = `${window.location.origin}/tournament/${tournamentId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleApprovalAction = async (regId: string, action: 'APPROVE' | 'REJECT' | 'ACKNOWLEDGE_AND_APPROVE') => {
    setActionLoadingId(regId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/registrations/${regId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(data.message || `Registration ${action.toLowerCase()}d successfully!`);
        fetchSummary();
      } else {
        setActionMessage(`Error: ${data.error || 'Failed to update registration'}`);
      }
    } catch (err) {
      setActionMessage('Network error updating registration');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRequestCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctionRegId) return;
    
    setSubmittingCorrectionReq(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/registrations/${correctionRegId}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requestedFields: correctionRequestedFields, 
          remark: correctionRemark 
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage('Correction requested successfully.');
        setCorrectionModalOpen(false);
        setCorrectionRequestedFields([]);
        setCorrectionRemark('');
        fetchSummary();
      } else {
        setActionMessage(`Error: ${data.error || 'Failed to request correction'}`);
      }
    } catch (err) {
      setActionMessage('Network error requesting correction');
    } finally {
      setSubmittingCorrectionReq(false);
    }
  };

  const handleExportExcel = (scope: 'approved' | 'complete') => {
    window.open(`/api/admin/export/excel?tournamentId=${tournamentId}&scope=${scope}`, '_blank');
  };

  const handleCopyWhatsApp = async () => {
    try {
      const res = await fetch(`/api/admin/export/whatsapp?tournamentId=${tournamentId}`);
      const resData = await res.json();
      if (res.ok && resData.text) {
        await navigator.clipboard.writeText(resData.text);
        setActionMessage('🎉 WhatsApp formatted text copied to clipboard!');
        setTimeout(() => setActionMessage(null), 3000);
      } else {
        setActionMessage(`Error: ${resData.error || 'Failed to export WhatsApp text'}`);
      }
    } catch (err) {
      setActionMessage('Failed to copy WhatsApp format to clipboard');
    }
  };

  const handleDeleteRegistration = async (regId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete registration for "${name}"? This will permanently remove the entry.`)) {
      return;
    }
    setActionLoadingId(regId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/registrations/${regId}`, {
        method: 'DELETE',
      });
      const resData = await res.json();
      if (res.ok) {
        setActionMessage(resData.message || 'Registration deleted successfully!');
        fetchSummary();
      } else {
        setActionMessage(`Error: ${resData.error || 'Failed to delete registration'}`);
      }
    } catch (err) {
      setActionMessage('Network error deleting registration');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteOwner = async (ownerId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete Team Owner "${name}" and all associated squad entries? This action cannot be undone.`)) {
      return;
    }
    setActionLoadingId(ownerId);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/team-owners/${ownerId}`, {
        method: 'DELETE',
      });
      const resData = await res.json();
      if (res.ok) {
        setActionMessage(resData.message || 'Team Owner entry deleted successfully!');
        fetchSummary();
      } else {
        setActionMessage(`Error: ${resData.error || 'Failed to delete team owner'}`);
      }
    } catch (err) {
      setActionMessage('Network error deleting team owner');
    } finally {
      setActionLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
        <Header />
        <div className="flex-1 min-h-[400px] flex items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span>Loading tournament data...</span>
        </div>
      </div>
    );
  }

  const tournament = data?.tournament;
  const registrations: any[] = data?.registrations || [];
  const teamOwners: any[] = data?.teamOwners || [];
  const stats = data?.stats;

  const filteredRegistrations = registrations.filter((r) => {
    const nameMatch = r.registered_name_snapshot?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      r.players?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      r.registration_number?.toLowerCase().includes(searchTerm.toLowerCase());
    const statusMatch = statusFilter === 'ALL' || r.registration_status === statusFilter || r.status === statusFilter;
    return nameMatch && statusMatch;
  });

  const pendingApprovals: any[] = data?.pendingApprovals || [];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full space-y-6">
        {actionMessage && (
          <div className="p-4 bg-emerald-950/90 border border-emerald-500/50 rounded-2xl text-emerald-300 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-xl">
            <span>{actionMessage}</span>
            <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-white">✕</button>
          </div>
        )}
      {/* Back to Dashboard Nav */}
      <div className="flex items-center justify-between">
        <Link href="/admin">
          <Button variant="outline" size="sm" leftIcon={<ChevronLeft className="w-4 h-4" />}>
            Back to Dashboard
          </Button>
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExportExcel('approved')} leftIcon={<FileSpreadsheet className="w-4 h-4 text-emerald-400" />}>
            Export Approved Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExportExcel('complete')} leftIcon={<Download className="w-4 h-4 text-teal-400" />}>
            Export Complete List
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyWhatsApp} leftIcon={<MessageSquare className="w-4 h-4 text-emerald-400" />}>
            Copy WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyLink} leftIcon={copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-emerald-400" />}>
            {copiedLink ? 'Link Copied' : 'Shareable Link'}
          </Button>
          <Link href={`/tournament/${tournamentId}`} target="_blank">
            <Button variant="primary" size="sm" rightIcon={<ExternalLink className="w-3.5 h-3.5" />}>
              Public View
            </Button>
          </Link>
          <Button variant="danger" size="sm" onClick={() => setIsDeleteModalOpen(true)} leftIcon={<Trash2 className="w-3.5 h-3.5" />}>
            Delete Tournament
          </Button>
        </div>
      </div>

      {/* Header Banner */}
      <Card className="space-y-4 border-2 border-emerald-500/30 bg-slate-900/90">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40">
                {tournament?.tournament_type === 'OWNER_BASED' ? '👑 Owner-Based Tournament' : '🏏 Standard Tournament'}
              </span>
              <Badge status={tournament?.registration_open ? 'ACTIVE' : 'INACTIVE'}>
                {tournament?.registration_open ? 'Registration Open' : 'Closed'}
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">{tournament?.name}</h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Date: {formatDate(tournament?.tournament_date)} | Player Fee: {formatPaiseToINR(tournament?.registration_fee || 0)} | Capacity: {tournament?.max_players} Players
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Available Slots</span>
              <span className="text-xl font-extrabold text-teal-400">{stats?.availableSlots || 0}</span>
            </div>
            <div className="text-right pl-3 border-l border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Total Registered</span>
              <span className="text-xl font-extrabold text-emerald-400">{stats?.totalRegistered || 0}</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors shrink-0 ${activeTab === 'overview' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('registrations')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors shrink-0 ${activeTab === 'registrations' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
          >
            Player Registrations ({registrations.length})
          </button>


          {tournament?.tournament_type === 'OWNER_BASED' && (
            <button
              onClick={() => setActiveTab('owners')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors shrink-0 flex items-center gap-1.5 ${activeTab === 'owners' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
            >
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>Team Owners ({teamOwners.length}/{tournament.max_teams || 8})</span>
            </button>
          )}

          <button
            onClick={() => setActiveTab('payments')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors shrink-0 ${activeTab === 'payments' ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-400 hover:text-white'}`}
          >
            Payments Verification ({stats?.pendingPayments || 0} Pending)
          </button>
        </div>
      </Card>

      {/* TAB CONTENT 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-bold text-white">Tournament Overview</h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              {tournament?.description || 'No custom description provided for this tournament.'}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold block uppercase">Confirmed</span>
                <span className="text-lg font-bold text-emerald-400">{stats?.confirmedCount || 0}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold block uppercase">Waitlisted</span>
                <span className="text-lg font-bold text-sky-400">{stats?.waitlistCount || 0}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold block uppercase">Paid Count</span>
                <span className="text-lg font-bold text-teal-400">{stats?.successfulPayments || 0}</span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-bold block uppercase">Pending Review</span>
                <span className="text-lg font-bold text-amber-400">{stats?.pendingPayments || 0}</span>
              </div>
            </div>
          </Card>

          <Card className="space-y-4">
            <h3 className="font-bold text-white text-sm">UPI Payment Configuration</h3>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">UPI ID:</span>
                <span className="font-mono text-emerald-400 font-semibold">{tournament?.upi_id || 'Not Set'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fee per player:</span>
                <span className="font-bold text-slate-200">{formatPaiseToINR(tournament?.registration_fee || 0)}</span>
              </div>
              {tournament?.tournament_type === 'OWNER_BASED' && (
                <div className="flex justify-between border-t border-slate-800 pt-2">
                  <span className="text-slate-400">Team Owner Fee:</span>
                  <span className="font-bold text-amber-400">{formatPaiseToINR(tournament?.owner_registration_fee || 0)}</span>
                </div>
              )}
            </div>

            {tournament?.payment_qr_url && (
              <div className="text-center p-3 bg-white rounded-xl inline-block w-full">
                <img src={tournament.payment_qr_url} alt="QR Code" className="max-h-40 mx-auto object-contain" />
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB CONTENT 2: REGISTRATIONS TABLE */}
      {activeTab === 'registrations' && (
        <Card className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                placeholder="Search player name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-semibold">Filter Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="WAITING_LIST">Waiting List</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>

          {filteredRegistrations.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-6 text-center">No player registrations found matching your criteria.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase font-bold text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="p-3">Ref #</th>
                    <th className="p-3">Player</th>
                    <th className="p-3">Type / Team</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Waitlist Pos</th>
                    <th className="p-3">Payment</th>
                    <th className="p-3">Date</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredRegistrations.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-900/60 transition-colors">
                      <td className="p-3 font-mono text-emerald-400 font-semibold">{r.registration_number}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <img
                            src={r.registered_image_snapshot || r.players?.profile_image_url || '/logo.png'}
                            alt=""
                            className="w-7 h-7 rounded-full object-cover bg-slate-800"
                          />
                          <div>
                            <span className="font-bold text-white block">{r.registered_name_snapshot}</span>
                            <span className="text-[10px] text-slate-400 block">{r.players?.email}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3">
                        {r.registration_type === 'OWNER' || r.registration_type === 'TEAM_OWNER' ? (
                          <span className="text-[10px] font-bold text-amber-300 bg-amber-950 px-2 py-0.5 rounded-full border border-amber-500/40 inline-block mb-1">
                            👑 Owner
                          </span>
                        ) : r.registration_type === 'ICON' || r.registration_type === 'ICON_PLAYER' ? (
                          <span className="text-[10px] font-bold text-teal-300 bg-teal-950 px-2 py-0.5 rounded-full border border-teal-500/40 inline-block mb-1">
                            ⭐ Icon
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800 inline-block mb-1">
                            🏏 Player
                          </span>
                        )}
                        {r.team_name && (
                          <span className="text-[10px] font-semibold text-amber-300 block">
                            🛡️ {r.team_name}
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-semibold">{r.registered_role_snapshot}</td>
                      <td className="p-3">
                        <Badge status={r.registration_status}>{r.registration_status}</Badge>
                      </td>
                      <td className="p-3 text-center">{r.waitlist_position ? `#${r.waitlist_position}` : '-'}</td>
                      <td className="p-3">
                        <Badge status={r.payment?.payment_status || 'PENDING'}>
                          {r.payment?.payment_status || 'PENDING'}
                        </Badge>
                      </td>
                      <td className="p-3 text-slate-400">{formatDate(r.registered_at)}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleDeleteRegistration(r.id, r.registered_name_snapshot || 'Player')}
                          disabled={actionLoadingId === r.id}
                          className="px-2.5 py-1 bg-rose-950/80 border border-rose-500/40 text-rose-300 hover:bg-rose-900 font-semibold text-[11px] rounded-lg transition-colors inline-flex items-center gap-1"
                          title="Delete Registration Entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* TAB CONTENT 3: PAYMENTS VERIFICATION */}
      {activeTab === 'payments' && (
        <Card className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-white">Payment Proof Verification</h2>
            <p className="text-xs text-slate-400">
              Review and approve player & owner registrations.
            </p>
          </div>

          {pendingApprovals.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-6 text-center">No pending registrations requiring review.</p>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.map((r) => {
                const isOrganiserAck =
                  r.payment?.payment_method === 'ACKNOWLEDGE_BY_ORGANISER' ||
                  r.payment?.payment_status === 'AWAITING_ORGANISER_ACKNOWLEDGEMENT';

                return (
                  <div key={r.id} className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg">
                    <div className="flex items-center gap-3">
                      <img
                        src={r.registered_image_snapshot || '/logo.png'}
                        alt=""
                        className="w-12 h-12 rounded-xl object-cover bg-slate-800 border border-slate-700 shrink-0"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-white text-base">{r.registered_name_snapshot}</span>
                          {r.registration_type === 'OWNER' ? (
                            <span className="text-[10px] font-bold text-amber-300 bg-amber-950 px-2 py-0.5 rounded-full border border-amber-500/40">
                              👑 Owner
                            </span>
                          ) : r.registration_type === 'ICON' ? (
                            <span className="text-[10px] font-bold text-teal-300 bg-teal-950 px-2 py-0.5 rounded-full border border-teal-500/40">
                              ⭐ Icon Player
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                              🏏 Player
                            </span>
                          )}
                          <Badge status={r.registration_status}>{r.registration_status}</Badge>
                          {isOrganiserAck && (
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-950/80 px-2 py-0.5 rounded-full border border-amber-500/50">
                              🤝 Organiser Ack Requested
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Ref: <code className="text-emerald-400 font-bold">{r.registration_number}</code> | Role: {r.registered_role_snapshot} {r.team_name ? `| Team: ${r.team_name}` : ''}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Email: {r.players?.email || 'N/A'} | Payment Status: <span className="font-bold text-amber-400">{r.payment?.payment_status || 'PENDING'}</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Amount: <span className="font-semibold text-emerald-400">₹{(r.payment?.amount || 0)/100}</span> | 
                          Method: <span className="font-semibold text-white">{r.payment?.payment_method || 'N/A'}</span>
                          {r.payment?.transaction_id && <span> | Ref: <code className="text-white bg-slate-800 px-1 rounded">{r.payment.transaction_id}</code></span>}
                        </p>
                        {r.admin_remarks && (
                          <p className="text-[11px] text-rose-300 mt-0.5 bg-rose-950/30 p-1 rounded border border-rose-500/20 inline-block">
                            Admin Remark: {r.admin_remarks}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                      {r.payment?.payment_screenshot_url ? (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={loadingReceipt}
                          onClick={() => handleViewReceipt(r.payment.payment_screenshot_url)}
                          leftIcon={<Eye className="w-3.5 h-3.5 text-sky-400" />}
                        >
                          View Receipt
                        </Button>
                      ) : (
                        <span className="text-[11px] italic text-rose-400/80 mr-2 flex items-center gap-1">
                          Payment screenshot not submitted
                        </span>
                      )}

                      <Button
                        variant="danger"
                        size="sm"
                        isLoading={actionLoadingId === r.id}
                        onClick={() => handleApprovalAction(r.id, 'REJECT')}
                        leftIcon={<XCircle className="w-4 h-4" />}
                      >
                        Reject
                      </Button>
                      
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCorrectionRegId(r.id);
                          setCorrectionModalOpen(true);
                        }}
                        leftIcon={<Edit3 className="w-4 h-4 text-amber-400" />}
                      >
                        Send for Re-verification
                      </Button>

                      {isOrganiserAck ? (
                        <Button
                          variant="gold"
                          size="sm"
                          isLoading={actionLoadingId === r.id}
                          onClick={() => handleApprovalAction(r.id, 'ACKNOWLEDGE_AND_APPROVE')}
                          leftIcon={<CheckCircle2 className="w-4 h-4 text-amber-950" />}
                        >
                          Acknowledge & Approve
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          size="sm"
                          isLoading={actionLoadingId === r.id}
                          onClick={() => handleApprovalAction(r.id, 'APPROVE')}
                          leftIcon={<CheckCircle2 className="w-4 h-4" />}
                        >
                          Approve & Confirm
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* TAB CONTENT 4: TEAM OWNERS (OWNER_BASED ONLY) */}
      {activeTab === 'owners' && tournament?.tournament_type === 'OWNER_BASED' && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-400" />
                Team Owner Slots ({teamOwners.length} / {tournament.max_teams || 8})
              </h2>
              <p className="text-xs text-slate-400">
                Registered team owners for squad bidding and auction management.
              </p>
            </div>

            <Badge status={teamOwners.length >= (tournament.max_teams || 8) ? 'CANCELLED' : 'CONFIRMED'}>
              {teamOwners.length >= (tournament.max_teams || 8) ? 'All Slots Filled' : `${(tournament.max_teams || 8) - teamOwners.length} Slots Open`}
            </Badge>
          </div>

          {teamOwners.length === 0 ? (
            <p className="text-xs text-slate-500 italic p-6 text-center">No team owners registered yet for this tournament.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {teamOwners.map((o) => (
                <div key={o.id} className="p-4 bg-slate-950 rounded-2xl border border-amber-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400">Team Slot #{o.slot_number}</span>
                    <Badge status={o.status === 'APPROVED' ? 'CONFIRMED' : 'WAITING_LIST'}>{o.status}</Badge>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {o.team_logo_url ? (
                      <img src={o.team_logo_url} alt="" className="w-10 h-10 rounded-xl object-contain bg-slate-900 border border-slate-800 shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-amber-950/60 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold shrink-0">
                        🛡️
                      </div>
                    )}
                    <div>
                      <h3 className="font-extrabold text-white text-base">{o.team_name || o.owner_name}</h3>
                      <span className="text-xs text-slate-300 font-medium">Owner: {o.owner_name}</span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-400 space-y-1 pt-2 border-t border-slate-800">
                    <p>Email: {o.contact_email}</p>
                    {o.contact_phone && <p>Phone: {o.contact_phone}</p>}
                    {o.icon_player_name && (
                      <p className="text-teal-300 font-semibold pt-1">
                        ⭐ Icon Player: {o.icon_player_name} ({o.icon_player_role || 'Batsman'})
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                    {o.payment_screenshot_url ? (
                      <button
                        onClick={() => handleViewReceipt(o.payment_screenshot_url)}
                        disabled={loadingReceipt}
                        className="px-2.5 py-1 bg-sky-950/80 border border-sky-500/40 text-sky-300 hover:bg-sky-900 font-semibold text-xs rounded-xl transition-colors inline-flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5 text-sky-400" />
                        <span>View Receipt</span>
                      </button>
                    ) : (
                      <span className="text-[10px] text-slate-500 italic">No Screenshot</span>
                    )}

                    <div className="flex items-center gap-2">
                      {o.status !== 'APPROVED' && o.owner_registration_id && (
                        <button
                          onClick={() => handleApprovalAction(o.owner_registration_id, 'APPROVE')}
                          disabled={actionLoadingId === o.owner_registration_id}
                          className="px-2.5 py-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900 font-semibold text-xs rounded-xl transition-colors inline-flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Approve & Mark Paid</span>
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteOwner(o.id, o.owner_name || o.team_name || 'Team Owner')}
                        disabled={actionLoadingId === o.id}
                        className="px-2.5 py-1 bg-rose-950/80 border border-rose-500/40 text-rose-300 hover:bg-rose-900 font-semibold text-xs rounded-xl transition-colors inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}


      </main>

      {previewImageUrl && (
        <Modal
          isOpen={Boolean(previewImageUrl)}
          onClose={() => setPreviewImageUrl(null)}
          title="📷 Payment Proof Receipt Screenshot"
          maxWidth="lg"
        >
          <div className="p-2 space-y-4 text-center">
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-2 flex items-center justify-center">
              <img
                src={previewImageUrl}
                alt="Payment Screenshot Preview"
                className="max-w-full h-auto object-contain rounded-lg shadow-2xl"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <a href={previewImageUrl} target="_blank" rel="noreferrer">
                <Button variant="outline" size="sm" leftIcon={<ExternalLink className="w-4 h-4" />}>
                  Open Full Resolution
                </Button>
              </a>
              <Button variant="secondary" size="sm" onClick={() => setPreviewImageUrl(null)}>
                Close Preview
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Correction Request Modal */}
      <Modal isOpen={correctionModalOpen} onClose={() => setCorrectionModalOpen(false)} title="Request Correction">
        <form onSubmit={handleRequestCorrection} className="space-y-4 pt-2">
          <p className="text-sm text-slate-300">
            Select the fields the player needs to correct and provide a reason/instruction.
          </p>
          
          <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
            {correctionFieldOptions.map((field) => (
              <label key={field} className="flex items-center gap-2 text-sm text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  checked={correctionRequestedFields.includes(field)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setCorrectionRequestedFields([...correctionRequestedFields, field]);
                    } else {
                      setCorrectionRequestedFields(correctionRequestedFields.filter(f => f !== field));
                    }
                  }}
                />
                {field}
              </label>
            ))}
          </div>

          <div className="space-y-1 mt-4">
            <label className="text-xs font-bold text-slate-400">Reason / Instructions</label>
            <textarea
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500"
              placeholder="e.g. Please re-upload a clear payment screenshot"
              rows={3}
              required
              value={correctionRemark}
              onChange={(e) => setCorrectionRemark(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Button variant="outline" type="button" onClick={() => setCorrectionModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              isLoading={submittingCorrectionReq}
              disabled={correctionRequestedFields.length === 0 || !correctionRemark.trim()}
            >
              Send Correction Request
            </Button>
          </div>
        </form>
      </Modal>

      {/* DELETE TOURNAMENT CONFIRMATION MODAL */}
      <DeleteTournamentModal
        isOpen={isDeleteModalOpen}
        tournament={tournament}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeleted={() => {
          router.push('/admin');
        }}
      />
    </div>
  );
}
