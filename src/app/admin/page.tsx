'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { DeleteTournamentModal } from '@/components/admin/DeleteTournamentModal';
import { formatPaiseToINR, formatDate } from '@/lib/utils/format';
import { DbTournament, TournamentType } from '@/types';
import {
  Trophy,
  Users,
  CheckCircle2,
  Clock,
  DollarSign,
  Plus,
  Copy,
  Trash2,
  Edit,
  ExternalLink,
  ShieldCheck,
  UserCheck,
  UserX,
  Briefcase,
  AlertTriangle,
  Download,
  Check,
  Crown,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

export default function AdminDashboardPage() {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Managers State
  const [managers, setManagers] = useState<any[]>([]);
  const [newManagerEmail, setNewManagerEmail] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [grantingManager, setGrantingManager] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerSuccess, setManagerSuccess] = useState<string | null>(null);

  // Tournament Create/Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTournament, setEditingTournament] = useState<DbTournament | null>(null);

  // Tournament Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletingTournament, setDeletingTournament] = useState<DbTournament | null>(null);

  const handleOpenDelete = (t: DbTournament) => {
    setDeletingTournament(t);
    setIsDeleteModalOpen(true);
  };

  const [tName, setTName] = useState('');
  const [tDescription, setTDescription] = useState('');
  const [tDate, setTDate] = useState('');
  const [tFeeRupees, setTFeeRupees] = useState(500);
  const [tMaxPlayers, setTMaxPlayers] = useState(100);
  const [tType, setTType] = useState<TournamentType>('NON_OWNER_BASED');
  const [tMaxTeams, setTMaxTeams] = useState(8);
  const [tOwnerFeeRupees, setTOwnerFeeRupees] = useState(2500);
  const [tIconPlayerEnabled, setTIconPlayerEnabled] = useState(false);
  const [tOwnerIsPlayingEnabled, setTOwnerIsPlayingEnabled] = useState(true);
  const [tWaitlistEnabled, setTWaitlistEnabled] = useState(true);
  const [tUpiId, setTUpiId] = useState('titusalex786@okaxis');
  const [tPaymentQrUrl, setTPaymentQrUrl] = useState('/images/qr/titusalex786.png');
  const [tBannerUrl, setTBannerUrl] = useState('');
  const [tRegistrationEndDate, setTRegistrationEndDate] = useState('');
  const [tRegistrationOpen, setTRegistrationOpen] = useState(true);
  const [savingTournament, setSavingTournament] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchDashboard = () => {
    setLoading(true);
    fetch('/api/admin/dashboard')
      .then((res) => res.json())
      .then((resData) => {
        if (!resData.error) {
          setData(resData);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchManagers = () => {
    fetch('/api/admin/managers')
      .then((res) => res.json())
      .then((resData) => {
        if (resData.managers) setManagers(resData.managers);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchDashboard();
    fetchManagers();
  }, []);

  const resetForm = () => {
    setEditingTournament(null);
    setTName('');
    setTDescription('');
    setTDate('');
    setTFeeRupees(500);
    setTMaxPlayers(100);
    setTType('NON_OWNER_BASED');
    setTMaxTeams(8);
    setTOwnerFeeRupees(2500);
    setTIconPlayerEnabled(false);
    setTOwnerIsPlayingEnabled(true);
    setTWaitlistEnabled(true);
    setTUpiId('titusalex786@okaxis');
    setTPaymentQrUrl('/images/qr/titusalex786.png');
    setTBannerUrl('');
    setTRegistrationEndDate('');
    setTRegistrationOpen(true);
    setModalError(null);
  };

  const handleOpenEdit = (t: DbTournament) => {
    setEditingTournament(t);
    setTName(t.name);
    setTDescription(t.description || '');
    setTDate(t.tournament_date ? t.tournament_date.slice(0, 10) : '');
    setTFeeRupees(t.registration_fee / 100);
    setTMaxPlayers(t.max_players);
    setTType(t.tournament_type || 'NON_OWNER_BASED');
    setTMaxTeams(t.max_teams || 8);
    setTOwnerFeeRupees((t.owner_registration_fee || 250000) / 100);
    setTIconPlayerEnabled(Boolean(t.icon_player_enabled));
    setTOwnerIsPlayingEnabled(t.owner_is_playing_enabled !== false);
    setTWaitlistEnabled(t.waitlist_enabled !== false);
    setTUpiId(t.upi_id || '');
    setTPaymentQrUrl(t.payment_qr_url || '');
    setTBannerUrl(t.banner_url || '');
    setTRegistrationEndDate(t.registration_end_date ? t.registration_end_date.slice(0, 10) : '');
    setTRegistrationOpen(t.registration_open);
    setIsModalOpen(true);
  };

  const handleQrUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setModalError('QR image file exceeds maximum 5 MB limit');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setModalError('QR image must be JPEG, PNG, or WebP format');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result && result.startsWith('data:image/')) {
        setTPaymentQrUrl(result);
        setModalError(null);
      } else {
        setModalError('Failed to encode QR image as data URI');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setModalError('Banner image file exceeds maximum 5 MB limit');
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      setModalError('Banner image must be JPEG, PNG, or WebP format');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (result && result.startsWith('data:image/')) {
        setTBannerUrl(result);
        setModalError(null);
      } else {
        setModalError('Failed to encode banner image as data URI');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTournament(true);
    setModalError(null);

    try {
      const res = await fetch('/api/admin/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTournament?.id,
          name: tName,
          description: tDescription,
          tournamentDate: tDate,
          registrationEndDate: tRegistrationEndDate,
          registrationFeeRupees: tFeeRupees,
          maxPlayers: tMaxPlayers,
          tournamentType: tType,
          maxTeams: tMaxTeams,
          ownerRegistrationFeeRupees: tOwnerFeeRupees,
          iconPlayerEnabled: tIconPlayerEnabled,
          ownerIsPlayingEnabled: tOwnerIsPlayingEnabled,
          waitlistEnabled: tWaitlistEnabled,
          upiId: tUpiId,
          paymentQrUrl: tPaymentQrUrl,
          bannerUrl: tBannerUrl,
          registrationOpen: tRegistrationOpen,
        }),
      });

      const resData = await res.json();

      if (!res.ok || resData.error) {
        setModalError(resData.error || 'Failed to save tournament');
        setSavingTournament(false);
        return;
      }

      setIsModalOpen(false);
      resetForm();
      fetchDashboard();
    } catch (err: any) {
      setModalError('Network error saving tournament');
    } finally {
      setSavingTournament(false);
    }
  };

  const handleGrantManager = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newManagerEmail.trim()) return;

    setGrantingManager(true);
    setManagerError(null);
    setManagerSuccess(null);

    try {
      const res = await fetch('/api/admin/managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newManagerEmail, displayName: newManagerName }),
      });

      const resData = await res.json();
      if (!res.ok || resData.error) {
        setManagerError(resData.error || 'Failed to grant manager role');
        setGrantingManager(false);
        return;
      }

      setManagerSuccess(resData.message || 'Manager added successfully!');
      setNewManagerEmail('');
      setNewManagerName('');
      fetchManagers();
    } catch (err: any) {
      setManagerError('Network error adding manager');
    } finally {
      setGrantingManager(false);
    }
  };

  const handleRevokeManager = async (id: string) => {
    if (!confirm('Are you sure you want to revoke manager access for this user?')) return;
    try {
      const res = await fetch(`/api/admin/managers?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchManagers();
      }
    } catch (err) {}
  };

  const tournaments: DbTournament[] = data?.tournaments || [];

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            Admin Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Super Admin Control Center: Multi-tournament management, Team Owners, and Manager role delegation.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          leftIcon={<Plus className="w-4 h-4" />}
        >
          Create New Tournament
        </Button>
      </div>

      {/* Global Overview KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="space-y-2 border-l-4 border-l-emerald-500">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Tournaments</span>
          <p className="text-2xl sm:text-3xl font-extrabold text-white">
            {loading ? '...' : tournaments.length}
          </p>
          <span className="text-[11px] text-slate-400 block">Published in system</span>
        </Card>

        <Card className="space-y-2 border-l-4 border-l-teal-500">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Players Registered</span>
          <p className="text-2xl sm:text-3xl font-extrabold text-teal-300">
            {loading ? '...' : data?.globalStats?.totalRegisteredPlayers || 0}
          </p>
          <span className="text-[11px] text-slate-400 block">Across all tournaments</span>
        </Card>

        <Card className="space-y-2 border-l-4 border-l-emerald-400">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Verified Payments</span>
          <p className="text-2xl sm:text-3xl font-extrabold text-emerald-300">
            {loading ? '...' : data?.globalStats?.totalSuccessfulPayments || 0}
          </p>
          <span className="text-[11px] text-slate-400 block">Successful payments</span>
        </Card>

        <Card className="space-y-2 border-l-4 border-l-amber-500">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Revenue</span>
          <p className="text-2xl sm:text-3xl font-extrabold text-amber-300">
            {loading ? '...' : formatPaiseToINR(data?.globalStats?.totalRevenuePaise || 0)}
          </p>
          <span className="text-[11px] text-slate-400 block">Gross collected</span>
        </Card>
      </div>

      {/* TOURNAMENTS SECTION */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            Tournaments Directory ({tournaments.length})
          </h2>
          <span className="text-xs text-slate-400">Click any tournament to drill down and manage</span>
        </div>

        {tournaments.length === 0 ? (
          <Card className="text-center p-8 space-y-4">
            <h3 className="text-lg font-bold text-white">No Tournaments Created Yet</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Create your first cricket tournament. You can choose between Standard Non-Owner or Owner-Based (Auction Style) tournaments.
            </p>
            <Button variant="primary" onClick={() => setIsModalOpen(true)} leftIcon={<Plus className="w-4 h-4" />}>
              Create Tournament Now
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tournaments.map((t: any) => (
              <Card key={t.id} className="space-y-4 border border-slate-800 hover:border-emerald-500/50 transition-all flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-800 text-emerald-400 border border-slate-700">
                        {t.tournament_type === 'OWNER_BASED' ? '👑 Owner-Based' : '🏏 Standard'}
                      </span>
                      <h3 className="font-extrabold text-white text-lg mt-1">{t.name}</h3>
                    </div>
                    <Badge status={t.registration_open ? 'ACTIVE' : 'INACTIVE'}>
                      {t.registration_open ? 'Open' : 'Closed'}
                    </Badge>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2">
                    {t.description || 'Official Premier League Cricket Tournament.'}
                  </p>

                  <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950 p-3 rounded-xl border border-slate-850">
                    <div>
                      <span className="text-slate-500 text-[10px] block">Fee (INR)</span>
                      <span className="font-bold text-slate-200">{formatPaiseToINR(t.registration_fee)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Capacity</span>
                      <span className="font-bold text-slate-200">{t.max_players} Players</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Registered</span>
                      <span className="font-bold text-emerald-400">{t.stats?.totalRegistered || 0}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block">Pending Payment Verification</span>
                      <span className="font-bold text-amber-400">{t.stats?.pendingPayments || 0}</span>
                    </div>
                  </div>

                  {t.tournament_type === 'OWNER_BASED' && (
                    <div className="p-2.5 bg-amber-950/30 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1">
                        <Crown className="w-3.5 h-3.5 text-amber-400" />
                        Team Owners:
                      </span>
                      <span className="font-bold">{t.stats?.ownerCount || 0} / {t.max_teams || 8} Slots</span>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenEdit(t)}
                      className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors text-xs font-semibold flex items-center gap-1"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleOpenDelete(t)}
                      className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors text-xs font-semibold flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>

                  <Link href={`/admin/tournament/${t.id}`}>
                    <Button variant="primary" size="sm" rightIcon={<ChevronRight className="w-4 h-4" />}>
                      Manage Tournament
                    </Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* MANAGERS DELEGATION SECTION (ADMIN ONLY RIGHTS) */}
      <Card className="space-y-6 border-2 border-teal-500/30 bg-slate-900/90">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-teal-400" />
              Manage Designated Managers
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Grant selected registered users Manager permissions. Managers can approve players and verify payments on your behalf.
            </p>
          </div>
          <span className="text-[11px] font-bold text-teal-400 px-3 py-1 bg-teal-950 border border-teal-500/40 rounded-full self-start sm:self-auto">
            Super Admin Access Only
          </span>
        </div>

        {/* Grant Manager Form */}
        <form onSubmit={handleGrantManager} className="space-y-3 bg-slate-950 p-4 rounded-2xl border border-slate-800">
          <span className="font-bold text-xs text-white block">Grant New Manager Access</span>
          {managerError && (
            <div className="p-2.5 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs">
              {managerError}
            </div>
          )}
          {managerSuccess && (
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs">
              {managerSuccess}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              placeholder="User Email Address (e.g. manager@gmail.com)"
              type="email"
              required
              value={newManagerEmail}
              onChange={(e) => setNewManagerEmail(e.target.value)}
            />
            <Input
              placeholder="Display Name (Optional)"
              value={newManagerName}
              onChange={(e) => setNewManagerName(e.target.value)}
            />
            <Button type="submit" isLoading={grantingManager} variant="primary" leftIcon={<UserCheck className="w-4 h-4" />}>
              Grant Manager Role
            </Button>
          </div>
        </form>

        {/* Active Managers List */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-slate-200">Current Active Managers ({managers.filter(m => m.is_active).length})</h3>
          {managers.filter(m => m.is_active).length === 0 ? (
            <p className="text-xs text-slate-500 italic p-3 bg-slate-950 rounded-xl border border-slate-800">
              No managers granted yet. Only atulpawar07@gmail.com currently has management permissions.
            </p>
          ) : (
            <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl bg-slate-950 overflow-hidden">
              {managers.filter(m => m.is_active).map((mgr) => (
                <div key={mgr.id} className="p-3 sm:p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-teal-950 border border-teal-500/40 flex items-center justify-center text-teal-400 font-bold text-xs shrink-0">
                      M
                    </div>
                    <div>
                      <span className="font-bold text-sm text-white block">{mgr.display_name || mgr.user_email}</span>
                      <span className="text-xs text-slate-400 block">{mgr.user_email} • Granted {formatDate(mgr.granted_at)}</span>
                    </div>
                  </div>

                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRevokeManager(mgr.id)}
                    leftIcon={<UserX className="w-3.5 h-3.5" />}
                  >
                    Revoke Manager Access
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* CREATE / EDIT TOURNAMENT MODAL */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingTournament ? 'Edit Tournament Settings' : 'Create New Tournament'}
        maxWidth="lg"
      >
        <form onSubmit={handleSaveTournament} className="space-y-4 text-xs sm:text-sm">
          {modalError && (
            <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs">
              {modalError}
            </div>
          )}

          <Input
            label="Tournament Name"
            required
            value={tName}
            onChange={(e) => setTName(e.target.value)}
            placeholder="e.g. FairPlay Premier League T20 2026"
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 block">Tournament Type</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={`p-3 rounded-xl border cursor-pointer flex items-start gap-3 transition-colors ${tType === 'NON_OWNER_BASED' ? 'bg-emerald-950/60 border-emerald-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <input
                  type="radio"
                  name="tType"
                  checked={tType === 'NON_OWNER_BASED'}
                  onChange={() => setTType('NON_OWNER_BASED')}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-slate-200">Standard Player Registration</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">Players register directly into open capacity pool.</span>
                </div>
              </label>

              <label className={`p-3 rounded-xl border cursor-pointer flex items-start gap-3 transition-colors ${tType === 'OWNER_BASED' ? 'bg-amber-950/60 border-amber-500 text-white' : 'bg-slate-950 border-slate-800 text-slate-400'}`}>
                <input
                  type="radio"
                  name="tType"
                  checked={tType === 'OWNER_BASED'}
                  onChange={() => setTType('OWNER_BASED')}
                  className="mt-0.5"
                />
                <div>
                  <span className="font-bold text-xs block text-slate-200">👑 Owner-Based (Auction Style)</span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">Includes Team Owner registration slots for squad bidding.</span>
                </div>
              </label>
            </div>
          </div>

          {tType === 'OWNER_BASED' && (
            <div className="p-3.5 bg-amber-950/40 border border-amber-500/30 rounded-xl space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Total Team Owner Slots *"
                  type="number"
                  required
                  min={1}
                  value={tMaxTeams}
                  onChange={(e) => setTMaxTeams(parseInt(e.target.value, 10) || 8)}
                  helperText="e.g. 8 teams = 8 owner slots maximum"
                />

                <Input
                  label="Team Owner Fee (₹ INR) *"
                  type="number"
                  required
                  value={tOwnerFeeRupees}
                  onChange={(e) => setTOwnerFeeRupees(parseFloat(e.target.value) || 0)}
                  helperText="Registration fee per team owner"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-amber-500/20">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tOwnerIsPlayingEnabled}
                    onChange={(e) => setTOwnerIsPlayingEnabled(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded"
                  />
                  <div>
                    <span className="text-xs font-bold text-amber-300 block">
                      🏏 Allow Team Owners to Play as Players in Tournament Roster
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      When enabled, owners can choose to play as a player and will be automatically added to the confirmed roster.
                    </span>
                  </div>
                </label>

                <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-amber-500/20">
                  <input
                    type="checkbox"
                    checked={tIconPlayerEnabled}
                    onChange={(e) => setTIconPlayerEnabled(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded"
                  />
                  <div>
                    <span className="text-xs font-bold text-amber-300 block">
                      ⭐ Require Icon Player Registration for Team Owners
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      When checked, team owners will register their squad's Icon Player into the tournament roster.
                    </span>
                  </div>
                </label>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Tournament Date"
              type="date"
              required
              value={tDate}
              onChange={(e) => setTDate(e.target.value)}
            />

            <Input
              label="Registration End Date (Deadline)"
              type="date"
              value={tRegistrationEndDate}
              onChange={(e) => setTRegistrationEndDate(e.target.value)}
              helperText="After this date, registration automatically closes"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Player Registration Fee (₹ INR)"
              type="number"
              required
              value={tFeeRupees}
              onChange={(e) => setTFeeRupees(parseFloat(e.target.value) || 0)}
              helperText="Fee collected via personal UPI QR"
            />

            <Input
              label="Maximum Player Capacity"
              type="number"
              required
              min={1}
              value={tMaxPlayers}
              onChange={(e) => setTMaxPlayers(parseInt(e.target.value, 10) || 100)}
              helperText="Player N+1 automatically enters Waitlist!"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 block">
              Default UPI Payment Options & QR Code
            </label>
            <div className="flex flex-wrap gap-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setTUpiId('titusalex786@okaxis');
                  setTPaymentQrUrl('/images/qr/titusalex786.png');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                  tUpiId === 'titusalex786@okaxis'
                    ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-md'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                💳 Canonical Organiser UPI (titusalex786@okaxis)
              </button>
            </div>

            <Input
              label="Admin UPI ID"
              value={tUpiId}
              onChange={(e) => setTUpiId(e.target.value)}
              placeholder="titusalex786@okaxis"
              helperText="Single canonical organiser UPI: titusalex786@okaxis"
            />
          </div>

          {/* Tournament Banner Image Upload */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300 block">Tournament Banner Image</label>
            <div className="flex flex-col sm:flex-row items-center gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
              {tBannerUrl ? (
                <img src={tBannerUrl} alt="Banner Preview" className="w-full sm:w-36 h-20 object-cover rounded-lg border border-slate-700" />
              ) : (
                <div className="w-full sm:w-36 h-20 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-[10px]">
                  No Banner Image
                </div>
              )}
              <div className="flex-1">
                <label className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors inline-block">
                  Upload Banner Image
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleBannerUpload} />
                </label>
                <p className="text-[11px] text-slate-400 mt-1">
                  Shown on Home Page & Tournament details screen (JPEG, PNG, WebP — Max 5 MB)
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-300 block">Personal UPI QR Code Image</label>
            <div className="flex items-center gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
              {tPaymentQrUrl ? (
                <img src={tPaymentQrUrl} alt="UPI QR Preview" className="w-16 h-16 object-contain bg-white p-1 rounded-lg border border-emerald-500" />
              ) : (
                <div className="w-16 h-16 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-[10px]">
                  No QR
                </div>
              )}
              <div>
                <label className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors inline-block">
                  Choose Custom QR Image
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleQrUpload} />
                </label>
                <p className="text-[11px] text-slate-400 mt-1">
                  JPEG, PNG, WebP — Max 5 MB
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tRegistrationOpen}
                onChange={(e) => setTRegistrationOpen(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 bg-slate-950 border-slate-700"
              />
              <span className="text-xs font-semibold text-slate-200">Registration Status: OPEN</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={tWaitlistEnabled}
                onChange={(e) => setTWaitlistEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 bg-slate-950 border-slate-700"
              />
              <span className="text-xs font-semibold text-slate-200">Enable Waitlist after capacity limit</span>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={savingTournament}>
              Save Tournament
            </Button>
          </div>
        </form>
      </Modal>

      {/* DELETE TOURNAMENT CONFIRMATION MODAL */}
      <DeleteTournamentModal
        isOpen={isDeleteModalOpen}
        tournament={deletingTournament}
        onClose={() => {
          setIsDeleteModalOpen(false);
          setDeletingTournament(null);
        }}
        onDeleted={() => {
          fetchDashboard();
        }}
      />
    </div>
  );
}
