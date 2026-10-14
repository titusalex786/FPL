'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { formatPaiseToINR } from '@/lib/utils/format';
import { compressImageFile } from '@/lib/utils/image';
import { UnifiedParticipantForm, ParticipantFormData } from './UnifiedParticipantForm';
import { UPIPaymentChoice } from '@/components/ui/UPIPaymentChoice';
import { createClient } from '@/lib/supabase/client';
import {
  Crown,
  CheckCircle2,
  ShieldAlert,
  Image as ImageIcon,
  UserCheck,
  Shield,
  Star,
  QrCode,
  Lock,
} from 'lucide-react';

interface TeamOwnerRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournament: any;
  currentUser?: any;
  isAdmin?: boolean;
  onSuccess?: () => void;
}

export const TeamOwnerRegistrationModal: React.FC<TeamOwnerRegistrationModalProps> = ({
  isOpen,
  onClose,
  tournament,
  currentUser,
  isAdmin = false,
  onSuccess,
}) => {
  const [authChecking, setAuthChecking] = useState<boolean>(!isAdmin && !currentUser);
  const [authUser, setAuthUser] = useState<any>(currentUser || null);

  // Synchronize auth state with Supabase client
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const supabase = createClient();

    if (currentUser) {
      setAuthUser(currentUser);
      setAuthChecking(false);
    } else {
      setAuthChecking(!isAdmin);
      supabase.auth.getUser().then(({ data, error }) => {
        if (!isMounted) return;
        if (!error && data?.user) {
          setAuthUser(data.user);
        } else {
          setAuthUser(null);
        }
        setAuthChecking(false);
      }).catch(() => {
        if (isMounted) {
          setAuthUser(null);
          setAuthChecking(false);
        }
      });
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      if (session?.user) {
        setAuthUser(session.user);
      } else {
        setAuthUser(null);
      }
      setAuthChecking(false);
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [isOpen, currentUser, isAdmin]);

  // Owner Participant Data
  const [ownerData, setOwnerData] = useState<ParticipantFormData>({
    fullName: !isAdmin ? (currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || '') : '',
    email: !isAdmin ? (currentUser?.email || '') : '',
    mobile: '',
    cricketRole: 'BATSMAN',
    battingStyle: 'RIGHT_HAND',
    bowlingStyle: '',
    jerseyName: '',
    jerseyNumber: '',
    jerseySize: 'M',
    photoUrl: '',
  });

  // Sync owner defaults when auth user is resolved (non-admin mode only)
  useEffect(() => {
    if (!isAdmin && authUser) {
      setOwnerData((prev) => ({
        ...prev,
        fullName: prev.fullName || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || '',
        email: authUser.email || prev.email,
      }));
    }
  }, [authUser, isAdmin]);

  // Team Data
  const [teamName, setTeamName] = useState('');
  const [teamLogoUrl, setTeamLogoUrl] = useState('');
  const [teamLogoBase64, setTeamLogoBase64] = useState('');

  // Icon Participant Data
  const [iconData, setIconData] = useState<ParticipantFormData>({
    fullName: '',
    email: !isAdmin ? (currentUser?.email || authUser?.email || '') : '',
    mobile: '',
    cricketRole: 'BATSMAN',
    battingStyle: 'RIGHT_HAND',
    bowlingStyle: '',
    jerseyName: '',
    jerseyNumber: '',
    jerseySize: 'M',
    photoUrl: '',
  });

  // Payment Data
  const [paymentMethod, setPaymentMethod] = useState<'UPI_QR' | 'ACKNOWLEDGE_BY_ORGANISER' | 'DIRECT_ADMIN_ENTRY'>(
    isAdmin ? 'DIRECT_ADMIN_ENTRY' : 'UPI_QR'
  );
  const [autoApprove, setAutoApprove] = useState<boolean>(true);
  const [screenshotBase64, setScreenshotBase64] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Fee calculation
  const ownerFeePaise = tournament?.owner_registration_fee || 900000;
  const playerFeePaise = tournament?.registration_fee || 90000;
  const totalClubbedFeePaise = ownerFeePaise + playerFeePaise;
  const ownerFeeDisplay = formatPaiseToINR(ownerFeePaise);
  const playerFeeDisplay = formatPaiseToINR(playerFeePaise);
  const totalClubbedFeeDisplay = formatPaiseToINR(totalClubbedFeePaise);

  const handleLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg('Team logo image must be 5 MB or smaller');
      return;
    }
    try {
      const compressed = await compressImageFile(file, 600, 600, 0.8);
      if (compressed) {
        setTeamLogoBase64(compressed);
        setTeamLogoUrl(compressed);
        setErrorMsg(null);
        return;
      }
    } catch {
      // Fallback to FileReader
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setTeamLogoBase64(result);
      setTeamLogoUrl(result);
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file);
      if (compressed) {
        setScreenshotBase64(compressed);
        return;
      }
    } catch {
      // Fallback
    }
    const reader = new FileReader();
    reader.onloadend = () => setScreenshotBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Helper for initials avatar fallback in admin mode
    const generateInitialsAvatar = (name: string, bg: string, fg: string) => {
      const initial = (name.trim()[0] || 'P').toUpperCase();
      return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="100%" height="100%" fill="${encodeURIComponent(bg)}"/><text x="50%" y="55%" font-size="52" font-family="sans-serif" font-weight="bold" fill="${encodeURIComponent(fg)}" text-anchor="middle" dominant-baseline="middle">${initial}</text></svg>`;
    };

    const effectiveOwnerPhoto = ownerData.photoUrl || (isAdmin ? generateInitialsAvatar(ownerData.fullName || 'Owner', '#1e293b', '#f59e0b') : '');
    const effectiveIconPhoto = iconData.photoUrl || (isAdmin ? generateInitialsAvatar(iconData.fullName || 'Icon', '#042f2e', '#14b8a6') : '');

    // Validation
    if (!effectiveOwnerPhoto) {
      setErrorMsg('Please upload the owner profile photo');
      return;
    }

    if (!ownerData.fullName.trim() || !ownerData.email.trim() || !teamName.trim()) {
      setErrorMsg('Team Name, Owner Name, and Contact Email are required');
      return;
    }

    if (!ownerData.mobile.trim()) {
      setErrorMsg('Owner mobile number is required');
      return;
    }

    if (!tournament?.id) {
      setErrorMsg('Tournament ID missing. Please reload the page.');
      return;
    }

    // Mandatory Icon data validation
    if (!effectiveIconPhoto) {
      setErrorMsg('Icon player profile photo is required');
      return;
    }

    if (!iconData.fullName.trim()) {
      setErrorMsg('Icon player full name is required');
      return;
    }

    if (!iconData.mobile.trim()) {
      setErrorMsg('Icon player mobile number is required');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const res = await fetch('/api/registrations/owner', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          tournamentId: tournament.id,
          isAdminEntry: Boolean(isAdmin),
          autoApprove: Boolean(isAdmin && autoApprove),
          // Owner identity
          ownerName: ownerData.fullName.trim(),
          contactEmail: ownerData.email.trim().toLowerCase(),
          contactPhone: ownerData.mobile.trim(),
          // Owner Player #1 snapshot fields
          ownerRole: ownerData.cricketRole,
          ownerBattingStyle: ownerData.battingStyle,
          ownerBowlingStyle: ownerData.bowlingStyle || null,
          ownerJerseySize: ownerData.jerseySize,
          ownerJerseyName: (ownerData.jerseyName || ownerData.fullName).trim(),
          ownerJerseyNumber: (ownerData.jerseyNumber || '').trim(),
          ownerProfileImageUrl: effectiveOwnerPhoto || null,
          // Team
          teamName: teamName.trim(),
          teamLogoBase64: teamLogoBase64 || null,
          // Payment
          paymentMethod,
          paymentScreenshotBase64: screenshotBase64 || null,
          // Icon Player #2 fields
          iconPlayerName: iconData.fullName.trim(),
          iconPlayerMobile: iconData.mobile.trim(),
          iconPlayerRole: iconData.cricketRole,
          iconPlayerBattingStyle: iconData.battingStyle,
          iconPlayerBowlingStyle: iconData.bowlingStyle || null,
          iconJerseySize: iconData.jerseySize || 'M',
          iconJerseyName: (iconData.jerseyName || iconData.fullName).trim(),
          iconJerseyNumber: (iconData.jerseyNumber || '').trim(),
          iconProfileImageUrl: effectiveIconPhoto,
        }),
      });

      let data: any = null;
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await res.json();
      }

      if (!res.ok || (data && data.error)) {
        const errorText =
          data?.error ||
          (res.status === 413
            ? 'Uploaded image files are too large. Please use smaller images.'
            : `Unable to complete registration (${res.statusText || res.status})`);
        setErrorMsg(errorText);
        setSubmitting(false);
        return;
      }

      setSuccessMsg(data?.message || (isAdmin ? 'Team Owner & Icon registered successfully!' : 'Registered as Team Owner successfully!'));
      setSubmitting(false);
      setTimeout(() => {
        onClose();
        if (onSuccess) {
          onSuccess();
        } else {
          window.location.reload();
        }
      }, 1200);
    } catch (err: any) {
      setErrorMsg(
        err?.message && !err.message.includes('Failed to fetch')
          ? err.message
          : 'Network error submitting Team Owner registration'
      );
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isAdmin ? "👑 Admin: Register Owner & Icon" : "👑 Team Owner Registration"}
      maxWidth="md"
    >
      {authChecking ? (
        <div className="flex flex-col items-center justify-center p-8 space-y-3 text-center">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-semibold text-amber-200">Checking authorization...</p>
        </div>
      ) : (!isAdmin && !authUser) ? (
        <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-2xl text-center space-y-4">
          <Lock className="w-10 h-10 text-amber-400 mx-auto" />
          <h3 className="text-base font-bold text-white">Please sign in to register as a team owner.</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Team owner registration requires a verified account so your franchise ownership, slot allocation, and icon player are securely bound to your identity.
          </p>
          <div className="pt-2">
            <Link href={`/auth/login?redirect=/tournament/${tournament?.id}?type=owner`}>
              <Button size="md" className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold px-6">
                Sign In to Register
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 text-xs sm:text-sm">
        {/* CLUBBED FEE SUMMARY BANNER */}
        <div className="p-4 bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-500/50 rounded-2xl space-y-2 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-amber-300 text-sm">
              {tournament?.name}
              {isAdmin && <span className="ml-2 text-xs bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded-full">ADMIN ON-BEHALF</span>}
            </span>
            <Crown className="w-6 h-6 text-amber-400 shrink-0" />
          </div>
          <div className="pt-2 border-t border-amber-500/20 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Owner Entry</span>
              <span className="font-bold text-amber-300">{ownerFeeDisplay}</span>
            </div>
            <div className="bg-slate-950/60 p-2 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Player Entry</span>
              <span className="font-bold text-emerald-300">{playerFeeDisplay}</span>
            </div>
            <div className="bg-amber-950 border border-amber-500/60 p-2 rounded-xl">
              <span className="text-[10px] text-amber-300 uppercase font-bold block">Total</span>
              <span className="font-extrabold text-amber-400 text-sm">{totalClubbedFeeDisplay}</span>
            </div>
          </div>
          <p className="text-[10px] text-amber-200/70 text-center">
            {/* Owner + Icon combined fee */}
            1 Owner slot + 2 Player slots (Owner #1 + Icon #2) allocated atomically
          </p>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* SECTION 1: OWNER PARTICIPANT DETAILS */}
        <div className="p-4 bg-amber-950/20 border border-amber-500/40 rounded-2xl space-y-3">
          <UnifiedParticipantForm
            title={isAdmin ? "Register Owner on behalf of participant" : "Owner / Player #1 Details"}
            subtitle={isAdmin ? "Enter owner details. A dedicated player profile is linked or created for this owner." : "Your details as team owner and first player of the squad."}
            badge="Player Slot #1"
            badgeColor="text-amber-400 bg-amber-950 border-amber-500/40"
            initialData={ownerData}
            onChange={setOwnerData}
            currentUserEmail={!isAdmin ? currentUser?.email : undefined}
            photoRequired={!isAdmin}
          />
        </div>

        {/* SECTION 2: TEAM DETAILS */}
        <div className="p-4 bg-slate-900/80 border border-slate-700 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <span className="text-xs font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-400" />
              Team Details
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Team / Franchise Name *"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Royal Strikers Mumbai"
            />
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Team Logo Image (Optional)
              </label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleLogoFileChange}
                className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-teal-950 file:text-teal-300 hover:file:bg-teal-900 cursor-pointer bg-slate-950 border border-slate-700 rounded-xl p-1"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">JPEG, PNG or WebP image (Max 5 MB)</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: ICON PARTICIPANT DETAILS */}
        <div className="p-4 bg-slate-900/80 border border-slate-700 rounded-2xl space-y-3">
          <UnifiedParticipantForm
            title={isAdmin ? "Register Icon on behalf of participant" : "Icon / Player #2 Details *"}
            subtitle={isAdmin ? "Enter nominated icon details. A dedicated player profile and icon tournament registration will be created." : "Nominated Icon player for this franchise. A dedicated tournament profile is allocated."}
            badge="Player Slot #2"
            badgeColor="text-emerald-400 bg-emerald-950 border-emerald-500/40"
            initialData={iconData}
            onChange={setIconData}
            currentUserEmail={undefined}
            photoRequired={!isAdmin}
          />
        </div>

        {/* SECTION 4: PAYMENT OPTIONS */}
        <div className="p-4 bg-slate-900/80 border border-slate-700 rounded-2xl space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <span className="text-xs font-extrabold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              Payment Options
            </span>
          </div>

          <div className="space-y-3">
            <label className="text-[11px] font-semibold text-slate-300 block">Select Payment Method *</label>
            <div className={`grid grid-cols-1 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('DIRECT_ADMIN_ENTRY')}
                  className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-colors ${
                    paymentMethod === 'DIRECT_ADMIN_ENTRY'
                      ? 'bg-amber-950/70 border-amber-500 text-amber-300 ring-1 ring-amber-500'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="font-bold text-xs">⚡ Direct Admin / Cash</span>
                  <span className="text-[10px] text-slate-400">Offline direct or cash entry</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setPaymentMethod('UPI_QR')}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-colors ${
                  paymentMethod === 'UPI_QR'
                    ? 'bg-amber-950/70 border-amber-500 text-amber-300 ring-1 ring-amber-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="font-bold text-xs">📱 Pay via UPI QR Code</span>
                <span className="text-[10px] text-slate-400">Scan QR code & upload receipt</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('ACKNOWLEDGE_BY_ORGANISER')}
                className={`p-3 rounded-xl border text-left flex flex-col gap-1 transition-colors ${
                  paymentMethod === 'ACKNOWLEDGE_BY_ORGANISER'
                    ? 'bg-amber-950/70 border-amber-500 text-amber-300 ring-1 ring-amber-500'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="font-bold text-xs">🤝 Acknowledge by Organiser</span>
                <span className="text-[10px] text-slate-400">Offline arrangement</span>
              </button>
            </div>

            {isAdmin && (
              <label className="flex items-center gap-3 p-3 bg-emerald-950/40 border border-emerald-500/40 rounded-xl cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => setAutoApprove(e.target.checked)}
                  className="w-4 h-4 rounded text-emerald-500 bg-slate-900 border-slate-700 focus:ring-emerald-500 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-emerald-300 block">
                    Auto-approve team & confirm owner & icon slots immediately
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Automatically approves team owner status and marks both owner and icon registrations as CONFIRMED.
                  </span>
                </div>
              </label>
            )}

            {paymentMethod === 'DIRECT_ADMIN_ENTRY' ? (
              <div className="p-3 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
                ✅ Direct entry registered under Admin authority.
              </div>
            ) : paymentMethod === 'ACKNOWLEDGE_BY_ORGANISER' ? (
              <div className="p-3 bg-amber-950/40 border border-amber-500/30 rounded-xl text-amber-300 text-xs">
                ℹ️ Organiser will verify payment offline. Your registration will enter <strong>PENDING</strong> review queue for Organiser acknowledgement.
              </div>
            ) : (
              <div className="space-y-4">
                <UPIPaymentChoice
                  upiId={tournament?.upi_id}
                  payeeName={tournament?.name || 'FairPlay Premier League'}
                  amountPaise={totalClubbedFeePaise}
                  referenceNote={`Owner Fee ${teamName || 'Team'}`}
                  qrUrlFallback={tournament?.payment_qr_url}
                />

                {/* Screenshot Upload */}
                <div className="flex items-center gap-4 p-3 bg-slate-950 rounded-xl border border-slate-800">
                  {screenshotBase64 ? (
                    <img
                      src={screenshotBase64}
                      alt="Payment Screenshot"
                      className="w-16 h-16 object-contain rounded bg-slate-900 border border-emerald-500"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-800 rounded flex items-center justify-center text-slate-500">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}
                  <div className="flex-1 space-y-1">
                    <label className="cursor-pointer px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 inline-block">
                      Upload Payment Proof ({totalClubbedFeeDisplay})
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleScreenshotUpload}
                      />
                    </label>
                    <span className="text-[10px] text-slate-400 block">
                      After payment, upload your UPI transaction receipt for admin verification.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" isLoading={submitting} disabled={submitting} variant="gold">
            {submitting ? 'Registering Squad...' : (isAdmin ? '👑 Register Owner & Icon' : `Register Owner + Icon (${totalClubbedFeeDisplay})`)}
          </Button>
        </div>
        </form>
      )}
    </Modal>
  );
};
