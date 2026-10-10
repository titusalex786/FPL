'use client';

import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatDate, formatPaiseToINR, cricketRoleLabels } from '@/lib/utils/format';
import {
  AdminPlayerDetailsResponse,
  TournamentRegistrationDTO,
  PlayerProfileDTO,
} from '@/lib/admin/player-details';
import {
  User,
  ShieldCheck,
  Calendar,
  CreditCard,
  History,
  AlertTriangle,
  ExternalLink,
  Crown,
  Sparkles,
  Shirt,
  Info,
  CheckCircle2,
  Clock,
  Eye,
  X,
  Loader2,
} from 'lucide-react';

interface PlayerDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerId?: string | null;
  registrationId?: string | null;
}

export const PlayerDetailsModal: React.FC<PlayerDetailsModalProps> = ({
  isOpen,
  onClose,
  playerId,
  registrationId,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<AdminPlayerDetailsResponse | null>(null);
  const [selectedRegId, setSelectedRegId] = useState<string | null>(null);
  const [screenshotModalUrl, setScreenshotModalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setDetails(null);
      setError(null);
      setSelectedRegId(null);
      return;
    }

    const idToFetch = playerId || registrationId;
    if (!idToFetch) return;

    setLoading(true);
    setError(null);

    const url = `/api/admin/players/${idToFetch}${
      registrationId ? `?registrationId=${encodeURIComponent(registrationId)}` : ''
    }`;

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load details (${res.status})`);
        }
        return res.json();
      })
      .then((data: AdminPlayerDetailsResponse) => {
        setDetails(data);
        setSelectedRegId(data.selectedRegistrationId || data.registrations?.[0]?.id || null);
      })
      .catch((err) => {
        setError(err.message || 'Error fetching player details');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, playerId, registrationId]);

  if (!isOpen) return null;

  const player: PlayerProfileDTO | undefined = details?.player;
  const registrations: TournamentRegistrationDTO[] = details?.registrations || [];
  const activeReg: TournamentRegistrationDTO | undefined =
    registrations.find((r) => r.id === selectedRegId) || registrations[0];

  const mapBadgeVariant = (v?: string): 'success' | 'warning' | 'error' | 'info' | 'neutral' => {
    if (v === 'danger') return 'error';
    if (v === 'success' || v === 'warning' || v === 'error' || v === 'info') return v;
    return 'neutral';
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} maxWidth="xl" title="Player & Registration Details">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            <span className="text-sm font-medium">Loading complete player record...</span>
          </div>
        )}

        {error && (
          <div className="bg-rose-950/40 border border-rose-800/80 rounded-2xl p-5 text-rose-300 text-sm flex items-start gap-3 my-4">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-rose-400" />
            <div>
              <div className="font-bold">Unable to load details</div>
              <div className="text-xs text-rose-400 mt-1">{error}</div>
            </div>
          </div>
        )}

        {!loading && !error && details && player && (
          <div className="space-y-6 text-slate-200">
            {/* TOURNAMENT REGISTRATION SELECTOR (If player registered for multiple tournaments) */}
            {registrations.length > 1 && (
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Select Tournament Registration ({registrations.length} total)</span>
                </div>
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {registrations.map((reg) => (
                    <button
                      key={reg.id}
                      onClick={() => setSelectedRegId(reg.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-all border ${
                        reg.id === selectedRegId
                          ? 'bg-emerald-600/30 border-emerald-500 text-white shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {reg.tournament_name} ({reg.registration_number})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* SECTION 1: CURRENT PLAYER PROFILE */}
            <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800 flex items-center justify-center text-sky-400">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">
                      Current Player Profile
                    </h4>
                    <span className="text-[10px] text-slate-400">
                      Reusable account profile (independent of tournament registration snapshots)
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start gap-4">
                {/* Profile Photo */}
                <div className="w-20 h-20 rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 flex-shrink-0 flex items-center justify-center">
                  {player.profile_image_url ? (
                    <img
                      src={player.profile_image_url}
                      alt={player.full_name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-10 h-10 text-slate-600" />
                  )}
                </div>

                {/* Profile Info Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Full Name</span>
                    <span className="font-semibold text-white">{player.full_name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Email</span>
                    <span className="font-medium text-slate-300 break-all">{player.email}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Mobile</span>
                    <span className="font-mono text-slate-300">{player.mobile || '—'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Role</span>
                    <span className="font-medium text-emerald-400">
                      {cricketRoleLabels[player.cricket_role as keyof typeof cricketRoleLabels] || player.cricket_role}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Batting Style</span>
                    <span className="text-slate-300">{player.batting_style || 'RIGHT_HAND'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Bowling Style</span>
                    <span className="text-slate-300">{player.bowling_style || 'NONE'}</span>
                  </div>
                </div>
              </div>

              {/* Jersey Defaults */}
              <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3">
                <div className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1 mb-2">
                  <Shirt className="w-3 h-3 text-amber-400" />
                  <span>Jersey Defaults (Profile Level)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Default Name</span>
                    <span className="font-mono font-medium text-slate-200">
                      {player.jersey_name || player.full_name}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Default Number</span>
                    <span className="font-mono font-bold text-amber-400">
                      {player.jersey_number ? `#${player.jersey_number}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">Default Size</span>
                    <span className="font-bold text-slate-200">{player.jersey_size || 'M'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 2: TOURNAMENT REGISTRATION SNAPSHOT */}
            {activeReg && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">
                        Tournament Registration
                      </h4>
                      <span className="text-[10px] text-slate-400">
                        Immutable tournament registration snapshot for this event
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
                      {activeReg.registration_number}
                    </span>
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md border flex items-center gap-1 ${
                        activeReg.registration_type === 'OWNER'
                          ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                          : activeReg.registration_type === 'ICON'
                          ? 'bg-purple-950/80 border-purple-600 text-purple-300'
                          : 'bg-sky-950/80 border-sky-600 text-sky-300'
                      }`}
                    >
                      {activeReg.registration_type === 'OWNER' && <Crown className="w-3 h-3 text-amber-400" />}
                      {activeReg.registration_type === 'ICON' && <Sparkles className="w-3 h-3 text-purple-400" />}
                      <span>{activeReg.registration_type}</span>
                    </span>
                  </div>
                </div>

                {/* OWNER / ICON SPECIFIC DETAILS */}
                {(activeReg.registration_type === 'OWNER' || activeReg.registration_type === 'ICON') && activeReg.team_owner && (
                  <div className="bg-amber-950/20 border border-amber-800/50 rounded-xl p-3 space-y-2">
                    <div className="text-[10px] uppercase font-bold text-amber-400 flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5" />
                      <span>{activeReg.registration_type === 'OWNER' ? 'Team Owner Association' : 'Icon Player Team Association'}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">Team Name</span>
                        <span className="font-bold text-white text-sm">{activeReg.team_owner.team_name}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">Allocated Slot</span>
                        <span className="font-bold text-amber-400">Slot #{activeReg.team_owner.slot_number}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-semibold">Owner Contact</span>
                        <span className="text-slate-300 font-medium">{activeReg.team_owner.owner_name}</span>
                        <span className="text-[10px] text-slate-400 block truncate">{activeReg.team_owner.contact_email}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tournament Metadata */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Tournament</span>
                    <span className="font-semibold text-white">{activeReg.tournament_name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Tournament Date</span>
                    <span className="text-slate-300">{formatDate(activeReg.tournament_date)}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Registered On</span>
                    <span className="text-slate-300">{formatDate(activeReg.registration_date)}</span>
                  </div>
                </div>

                {/* REGISTERED SNAPSHOT ATTRIBUTES */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
                  <div className="text-[11px] uppercase font-bold text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Registered Details (Tournament Snapshot)</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Registered Name</span>
                      <span className="font-semibold text-white">{activeReg.registered_name}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Registered Role</span>
                      <span className="font-medium text-emerald-400">
                        {cricketRoleLabels[activeReg.registered_cricket_role as keyof typeof cricketRoleLabels] || activeReg.registered_cricket_role}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Batting Style</span>
                      <span className="text-slate-300">{activeReg.registered_batting_style || 'RIGHT_HAND'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Bowling Style</span>
                      <span className="text-slate-300">{activeReg.registered_bowling_style || 'NONE'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Jersey Name</span>
                      <span className="font-mono text-slate-200">{activeReg.registered_jersey_name || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Jersey Number</span>
                      <span className="font-mono font-bold text-amber-400">
                        {activeReg.registered_jersey_number ? `#${activeReg.registered_jersey_number}` : '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Jersey Size</span>
                      <span className="font-bold text-slate-200">{activeReg.registered_jersey_size || 'M'}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 3: PAYMENT */}
            {activeReg && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-950 border border-amber-800 flex items-center justify-center text-amber-400">
                      <CreditCard className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">Payment</h4>
                      <span className="text-[10px] text-slate-400">Payment verification record & screenshot</span>
                    </div>
                  </div>
                  {activeReg.payment && (
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${
                        activeReg.payment.payment_status === 'SUCCESSFUL'
                          ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                          : 'bg-amber-950/80 border-amber-600 text-amber-300'
                      }`}
                    >
                      {activeReg.payment.payment_status}
                    </span>
                  )}
                </div>

                {activeReg.payment ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block font-semibold">Amount</span>
                        <span className="font-bold text-emerald-400 text-sm">
                          {formatPaiseToINR(activeReg.payment.amount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-semibold">Method</span>
                        <span className="text-slate-300 font-medium">
                          {activeReg.payment.payment_method || 'UPI_QR'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-semibold">UPI / Tx Reference</span>
                        <span className="font-mono text-slate-200">
                          {activeReg.payment.transaction_reference || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block font-semibold">Payment Date</span>
                        <span className="text-slate-300">{formatDate(activeReg.payment.payment_date)}</span>
                      </div>
                    </div>

                    {/* Screenshot Preview */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {activeReg.payment.payment_screenshot_url ? (
                          <div
                            onClick={() => setScreenshotModalUrl(activeReg.payment?.payment_screenshot_url || null)}
                            className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-700 overflow-hidden cursor-pointer flex-shrink-0 hover:border-emerald-500 transition-colors"
                          >
                            <img
                              src={activeReg.payment.payment_screenshot_url}
                              alt="Payment Screenshot"
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-slate-600 flex-shrink-0">
                            <CreditCard className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <span className="text-xs font-semibold text-white block">
                            {activeReg.payment.payment_screenshot_url
                              ? 'Payment Screenshot Available'
                              : 'No payment screenshot available'}
                          </span>
                          <span className="text-[10px] text-slate-500 block">
                            {activeReg.payment.payment_screenshot_url
                              ? 'Protected signed link generated for authorized admin'
                              : 'Player has not submitted a screenshot for this registration'}
                          </span>
                        </div>
                      </div>

                      {activeReg.payment.payment_screenshot_url && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setScreenshotModalUrl(activeReg.payment?.payment_screenshot_url || null)}
                          leftIcon={<Eye className="w-3.5 h-3.5 text-emerald-400" />}
                        >
                          View Full Screenshot
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 py-3 text-center">
                    No payment recorded for this registration.
                  </div>
                )}
              </div>
            )}

            {/* SECTION 4: REGISTRATION STATUS */}
            {activeReg && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">
                        Registration Status
                      </h4>
                      <span className="text-[10px] text-slate-400">Canonical derived status and audit notes</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={mapBadgeVariant(activeReg.derived_status.badgeVariant)}>
                      {activeReg.derived_status.fullLabel}
                    </Badge>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Raw Registration Status</span>
                    <span className="font-mono text-slate-200">{activeReg.registration_status}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Raw Payment Status</span>
                    <span className="font-mono text-slate-200">{activeReg.payment?.payment_status || 'PENDING'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase font-bold block">Status Description</span>
                    <span className="text-slate-300">{activeReg.derived_status.description}</span>
                  </div>
                </div>

                {activeReg.admin_remark && (
                  <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-3 text-xs">
                    <span className="text-[10px] text-amber-400 font-bold uppercase block mb-1">
                      Admin Remark / Verification Note
                    </span>
                    <p className="text-slate-200">{activeReg.admin_remark}</p>
                  </div>
                )}
              </div>
            )}

            {/* SECTION 5: CORRECTION HISTORY */}
            {activeReg && (
              <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-sky-950 border border-sky-800 flex items-center justify-center text-sky-400">
                      <History className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">
                        Correction History
                      </h4>
                      <span className="text-[10px] text-slate-400">Audit trail of requested and resubmitted corrections</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400">
                    {activeReg.correction_history.length} {activeReg.correction_history.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>

                {activeReg.correction_history.length === 0 ? (
                  <div className="text-xs text-slate-500 py-3 text-center bg-slate-900/50 rounded-xl border border-slate-800/60">
                    No correction history
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeReg.correction_history.map((corr, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 text-xs space-y-2.5"
                      >
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                          <span className="font-bold text-amber-400">
                            Correction #{corr.resubmission_count || idx + 1}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Requested: {formatDate(corr.requested_date)}
                          </span>
                        </div>

                        {corr.remark && (
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block">Remark</span>
                            <span className="text-slate-200">{corr.remark}</span>
                          </div>
                        )}

                        {corr.changed_fields && corr.changed_fields.length > 0 && (
                          <div>
                            <span className="text-[10px] text-slate-500 uppercase font-semibold block mb-1">
                              Changed Fields
                            </span>
                            <div className="flex flex-wrap gap-1">
                              {corr.changed_fields.map((f, i) => (
                                <span
                                  key={i}
                                  className="text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-2 py-0.5 rounded font-mono"
                                >
                                  {f}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                          <div>
                            <span className="block text-[10px] text-slate-500 font-semibold">Resubmitted</span>
                            <span>{corr.submitted_date ? formatDate(corr.submitted_date) : 'Pending Player Resubmit'}</span>
                          </div>
                          <div>
                            <span className="block text-[10px] text-slate-500 font-semibold">Resolved</span>
                            <span>{corr.resolved_date ? formatDate(corr.resolved_date) : 'Unresolved'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* MODAL FOOTER: STRICTLY [CLOSE] BUTTON ONLY (NO EDIT/SAVE/UPDATE IN PHASE 3) */}
            <div className="flex items-center justify-end pt-4 border-t border-slate-800">
              <Button variant="secondary" size="md" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Full Screenshot Preview Modal */}
      {screenshotModalUrl && (
        <Modal
          isOpen={Boolean(screenshotModalUrl)}
          onClose={() => setScreenshotModalUrl(null)}
          title="Payment Screenshot"
          maxWidth="lg"
        >
          <div className="space-y-4">
            <div className="max-h-[70vh] overflow-auto rounded-xl bg-slate-950 border border-slate-800 p-2 flex items-center justify-center">
              <img
                src={screenshotModalUrl}
                alt="Payment Screenshot Full Preview"
                className="max-h-[65vh] w-auto object-contain rounded"
              />
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setScreenshotModalUrl(null)}>
                Close Preview
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
