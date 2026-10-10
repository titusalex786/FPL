'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/public/Header';
import { Footer } from '@/components/public/Footer';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { JerseyInfoTooltip } from '@/components/ui/JerseyInfoTooltip';
import { formatPaiseToINR, formatDate, cricketRoleLabels } from '@/lib/utils/format';
import { DbTournament, CricketRole, BattingStyle, JerseySize } from '@/types';
import { Trophy, Calendar, Users, ShieldAlert, CheckCircle2, ArrowRight, Upload, Image as ImageIcon, Lock, Crown, Clock, UserCheck, UserPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { TeamOwnerRegistrationModal } from '@/components/register/TeamOwnerRegistrationModal';

export default function PublicTournamentPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params?.id as string;
  const regTypeParam = searchParams?.get('type');
  const supabase = createClient();

  const [tournament, setTournament] = useState<DbTournament | null>(null);
  const [confirmedCount, setConfirmedCount] = useState<number>(0);
  const [waitlistCount, setWaitlistCount] = useState<number>(0);
  const [availableSlots, setAvailableSlots] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState(false);

  // Registration Target: 'SELF' | 'OTHER'
  const [regTarget, setRegTarget] = useState<'SELF' | 'OTHER'>('SELF');

  // Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [cricketRole, setCricketRole] = useState<CricketRole>('BATSMAN');
  const [battingStyle, setBattingStyle] = useState<BattingStyle>('RIGHT_HAND');
  const [jerseyName, setJerseyName] = useState('');
  const [jerseyNumber, setJerseyNumber] = useState('');
  const [jerseySize, setJerseySize] = useState<JerseySize>('M');
  const [termsAccepted, setTermsAccepted] = useState(false);

  // Field error states for dynamic validation
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [confirmedPlayers, setConfirmedPlayers] = useState<any[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (regTypeParam === 'owner') {
      setIsOwnerModalOpen(true);
    }
  }, [regTypeParam]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    // 1. Fetch Tournament details & Confirmed Players Roster
    const tPromise = fetch(`/api/tournaments/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setErrorMsg(data.error);
        } else {
          setTournament(data.tournament);
          setConfirmedCount(data.confirmedCount || 0);
          setWaitlistCount(data.waitlistCount || 0);
          setAvailableSlots(data.availableSlots || 0);
          setConfirmedPlayers(data.confirmedPlayers || []);
        }
      })
      .catch(() => setErrorMsg('Failed to load tournament details'))
      .finally(() => setLoading(false));

    // 2. Fetch authenticated user & prefill persistent profile
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setCurrentUser(user);
        setEmail(user.email || '');

        fetch('/api/players/profile')
          .then((res) => res.json())
          .then((pData) => {
            const defaultName = (user.email || '')
              .split('@')[0]
              .replace(/[._-]/g, ' ')
              .replace(/\b\w/g, (c: string) => c.toUpperCase());

            if (pData.player) {
              setFullName(pData.player.full_name || defaultName);
              setProfileImageUrl(pData.player.profile_image_url || '');
              setCricketRole(pData.player.cricket_role || 'BATSMAN');
              setBattingStyle(pData.player.batting_style || 'RIGHT_HAND');
              setJerseySize(pData.player.jersey_size || 'M');
              setJerseyName(pData.player.jersey_name || pData.player.full_name || defaultName);
              setJerseyNumber(pData.player.jersey_number || '');
            } else {
              setFullName(defaultName);
              setJerseyName(defaultName);
            }
          })
          .catch(() => {});
      }
    });
  }, [id, supabase]);

  const handleTargetChange = (target: 'SELF' | 'OTHER') => {
    setRegTarget(target);
    setFieldErrors({});
    setErrorMsg(null);

    if (target === 'OTHER') {
      setFullName('');
      setEmail('');
      setProfileImageUrl('');
      setCricketRole('BATSMAN');
      setBattingStyle('RIGHT_HAND');
      setJerseySize('M');
      setJerseyName('');
      setJerseyNumber('');
    } else if (currentUser) {
      setEmail(currentUser.email || '');
      fetch('/api/players/profile')
        .then((res) => res.json())
        .then((pData) => {
          if (pData.player) {
            setFullName(pData.player.full_name || '');
            setProfileImageUrl(pData.player.profile_image_url || '');
            setCricketRole(pData.player.cricket_role || 'BATSMAN');
            setBattingStyle(pData.player.batting_style || 'RIGHT_HAND');
            setJerseySize(pData.player.jersey_size || 'M');
            setJerseyName(pData.player.jersey_name || pData.player.full_name || '');
            setJerseyNumber(pData.player.jersey_number || '');
          }
        })
        .catch(() => {});
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please upload a JPG, PNG or WebP image');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('File size must be under 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setProfileImageUrl(reader.result as string);
      setErrorMsg(null);
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next.profileImageUrl;
        return next;
      });
    };
    reader.readAsDataURL(file);
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentUser) {
      router.push(`/auth/login?redirect=/tournament/${id}`);
      return;
    }

    // Dynamic Mandatory Validation & Error Collection
    const newErrors: Record<string, string> = {};
    const firstMissingFieldIds: string[] = [];

    if (!fullName || fullName.trim().length < 2) {
      newErrors.fullName = 'Please enter player full name (at least 2 characters)';
      firstMissingFieldIds.push('field-full-name');
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Please enter a valid email address';
      firstMissingFieldIds.push('field-email');
    }

    if (!profileImageUrl) {
      newErrors.profileImageUrl = 'Please upload a profile photo to complete registration';
      firstMissingFieldIds.push('field-profile-image');
    }

    const effectiveJerseyName = (jerseyName.trim() || fullName.trim());
    if (!effectiveJerseyName || effectiveJerseyName.length < 1) {
      newErrors.jerseyName = 'Please enter name for jersey back';
      firstMissingFieldIds.push('field-jersey-name');
    }

    if (!jerseyNumber || !jerseyNumber.trim()) {
      newErrors.jerseyNumber = 'Please enter desired jersey number';
      firstMissingFieldIds.push('field-jersey-number');
    }

    if (!termsAccepted) {
      newErrors.termsAccepted = 'You must accept the terms and code of conduct to proceed';
      firstMissingFieldIds.push('field-terms');
    }

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      setErrorMsg('Please complete all missing required fields highlighted below.');

      // Auto-scroll and focus first missing field
      if (firstMissingFieldIds.length > 0) {
        setTimeout(() => {
          const el = document.getElementById(firstMissingFieldIds[0]);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
          }
        }, 100);
      }
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/tournaments/${id}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: regTarget,
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          profileImageUrl,
          cricketRole,
          battingStyle,
          jerseySize,
          jerseyName: effectiveJerseyName,
          jerseyNumber: jerseyNumber.trim(),
          termsAccepted: true,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setErrorMsg(data.error || 'Registration failed');
        setSubmitting(false);
        return;
      }

      // Redirect to registration confirmation details page
      router.push(`/registration/${data.registrationId}`);
    } catch (err: any) {
      setErrorMsg('Network error submitting registration');
      setSubmitting(false);
    }
  };

  const isWaitlistMode = availableSlots <= 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-8">
          {loading ? (
            <div className="text-center py-20 text-slate-400">Loading tournament details...</div>
          ) : !tournament ? (
            <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-3">
              <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto" />
              <h2 className="text-xl font-bold text-white">Tournament Not Found</h2>
              <p className="text-xs text-slate-400">The requested tournament link may be expired or invalid.</p>
            </div>
          ) : (
            <>
              {/* Registration Deadline Banner Notice if closed */}
              {(() => {
                const isDeadlinePassed = tournament.registration_end_date ? new Date(tournament.registration_end_date) < new Date() : false;
                const isClosed = !tournament.registration_open || isDeadlinePassed;
                if (isClosed) {
                  return (
                    <div className="p-4 bg-rose-950/90 border border-rose-500/50 rounded-2xl text-rose-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 shadow-xl">
                      <Clock className="w-5 h-5 text-rose-400 shrink-0" />
                      <span>
                        Registration for <strong>{tournament.name}</strong> is <strong>CLOSED</strong>
                        {isDeadlinePassed && tournament.registration_end_date ? ` (Registration deadline passed on ${formatDate(tournament.registration_end_date)})` : ''}.
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Tournament Header Banner Card */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 relative overflow-hidden">
                {tournament.banner_url && (
                  <div className="relative w-full rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center min-h-[200px] overflow-hidden">
                    <img
                      src={tournament.banner_url}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-25 scale-110 pointer-events-none"
                    />
                    <img
                      src={tournament.banner_url}
                      alt={tournament.name}
                      className="w-full h-auto max-h-[420px] object-contain relative z-10"
                    />
                  </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shrink-0 shadow-xl">
                      <Trophy className="w-9 h-9" />
                    </div>
                    <div>
                      <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                        {tournament.name}
                      </h1>
                      <p className="text-xs sm:text-sm text-slate-300 mt-1">{tournament.description}</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-3 self-start md:self-auto">
                    {tournament.tournament_type === 'OWNER_BASED' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setIsOwnerModalOpen(true)}
                        className="border-amber-500/40 text-amber-300 hover:bg-amber-950/50"
                        leftIcon={<Crown className="w-4 h-4 text-amber-400" />}
                      >
                        Register as Team Owner
                      </Button>
                    )}

                    <Badge status={tournament.registration_open ? 'ACTIVE' : 'INACTIVE'}>
                      {tournament.registration_open ? 'Registration Open' : 'Registration Closed'}
                    </Badge>
                  </div>
                </div>

                {/* Capacity & Fee Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-800/80">
                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Fee
                    </span>
                    <span className="text-lg font-extrabold text-emerald-400">
                      {formatPaiseToINR(tournament.registration_fee)}
                    </span>
                  </div>

                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Date
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-slate-200">
                      {formatDate(tournament.tournament_date)}
                    </span>
                  </div>

                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Capacity
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-slate-200">
                      {confirmedCount} / {tournament.max_players} Filled
                    </span>
                  </div>

                  <div className="bg-slate-950/60 p-3.5 rounded-2xl border border-slate-800">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                      Deadline
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-amber-300">
                      {tournament.registration_end_date ? formatDate(tournament.registration_end_date) : 'Until Capacity'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Registration Form Card */}
              <Card className="space-y-6">
                <div className="border-b border-slate-800 pb-4">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-emerald-400" />
                    <span>{isWaitlistMode ? 'Join Tournament Waitlist' : 'Player Registration'}</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-400 mt-1">
                    {isWaitlistMode
                      ? 'Main squad slots are full. Complete the form to be assigned a waitlist position.'
                      : 'Fill in your player details or confirm your prefilled saved profile.'}
                  </p>
                </div>

                {errorMsg && (
                  <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs sm:text-sm flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 shrink-0 text-rose-400" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {!currentUser ? (
                  <div className="p-6 bg-slate-950/80 border border-slate-800 rounded-2xl text-center space-y-4">
                    <Lock className="w-10 h-10 text-emerald-400 mx-auto" />
                    <h3 className="text-base font-bold text-white">Authentication Required</h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                      Please sign in or create an account to register. Your player details will be saved to your reusable profile.
                    </p>
                    <Link href={`/auth/login?redirect=/tournament/${id}`}>
                      <Button size="lg" className="w-full sm:w-auto">
                        Sign In to Register
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <form onSubmit={handleRegisterSubmit} className="space-y-6">
                    {/* TARGET SELECTOR: MYSELF VS ANOTHER PLAYER */}
                    <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-2">
                      <label className="text-xs font-bold text-slate-300 uppercase tracking-wider block">
                        Registering For:
                      </label>
                      <div className="flex flex-col sm:flex-row items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleTargetChange('SELF')}
                          className={`w-full sm:w-1/2 p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            regTarget === 'SELF'
                              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-md'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <UserCheck className="w-4 h-4 text-emerald-400" />
                          <span>Myself (Use My Saved Profile)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTargetChange('OTHER')}
                          className={`w-full sm:w-1/2 p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                            regTarget === 'OTHER'
                              ? 'bg-emerald-950/80 border-emerald-500 text-emerald-300 shadow-md'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                          }`}
                        >
                          <UserPlus className="w-4 h-4 text-emerald-400" />
                          <span>Another Player / Teammate</span>
                        </button>
                      </div>
                    </div>

                    {/* 1st Field: Profile Image Upload / Preview */}
                    <div id="field-profile-image" tabIndex={-1} className="space-y-2 outline-none">
                      <label className="text-xs sm:text-sm font-medium text-slate-300 block">
                        Profile Photo <span className="text-rose-400">*</span>
                      </label>
                      <div className={`flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/60 border border-dashed rounded-2xl transition-colors ${fieldErrors.profileImageUrl ? 'border-rose-500 bg-rose-950/20' : 'border-slate-700'}`}>
                        {profileImageUrl ? (
                          <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-emerald-500 shrink-0">
                            <img src={profileImageUrl} alt="Player Photo" className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                            <ImageIcon className="w-10 h-10" />
                          </div>
                        )}
                        <div className="flex-1 text-center sm:text-left">
                          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium rounded-xl border border-slate-700 transition-colors">
                            <Upload className="w-4 h-4 text-emerald-400" />
                            <span>Choose Photo</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={handleImageUpload}
                            />
                          </label>
                          <p className="text-[11px] text-slate-400 mt-1">
                            Required: JPG, PNG or WebP (Max 2 MB)
                          </p>
                          {fieldErrors.profileImageUrl && (
                            <p className="text-xs text-rose-400 font-semibold mt-1">{fieldErrors.profileImageUrl}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Full Name */}
                      <div>
                        <label className="text-xs sm:text-sm font-medium text-slate-300 block mb-1">
                          Player Full Name <span className="text-rose-400">*</span>
                        </label>
                        <input
                          id="field-full-name"
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => {
                            const newName = e.target.value;
                            if (!jerseyName || jerseyName === fullName) {
                              setJerseyName(newName);
                            }
                            setFullName(newName);
                            if (fieldErrors.fullName) setFieldErrors((prev) => { const n = { ...prev }; delete n.fullName; return n; });
                            if (fieldErrors.jerseyName) setFieldErrors((prev) => { const n = { ...prev }; delete n.jerseyName; return n; });
                          }}
                          placeholder="e.g. Rahul Patil"
                          className={`w-full bg-slate-950 border text-slate-100 rounded-xl px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-emerald-500 transition-colors ${fieldErrors.fullName ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-800'}`}
                        />
                        {fieldErrors.fullName && (
                          <p className="text-xs text-rose-400 font-semibold mt-1">{fieldErrors.fullName}</p>
                        )}
                        <p className="text-[11px] text-slate-500 mt-1">Official player registration name</p>
                      </div>

                      {/* Email Address */}
                      <div>
                        <label className="text-xs sm:text-sm font-medium text-slate-300 block mb-1">
                          Email Address <span className="text-rose-400">*</span>
                        </label>
                        <input
                          id="field-email"
                          type="email"
                          required
                          disabled={regTarget === 'SELF'}
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            if (fieldErrors.email) setFieldErrors((prev) => { const n = { ...prev }; delete n.email; return n; });
                          }}
                          placeholder="player@example.com"
                          className={`w-full bg-slate-950 border text-slate-100 rounded-xl px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-emerald-500 transition-colors ${regTarget === 'SELF' ? 'opacity-75 cursor-not-allowed border-slate-800' : fieldErrors.email ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-800'}`}
                        />
                        {fieldErrors.email && (
                          <p className="text-xs text-rose-400 font-semibold mt-1">{fieldErrors.email}</p>
                        )}
                        <p className="text-[11px] text-slate-500 mt-1">
                          {regTarget === 'SELF' ? 'Authenticated account email' : 'Participant contact email'}
                        </p>
                      </div>

                      {/* Cricket Role */}
                      <Select
                        label="Cricket Role *"
                        required
                        value={cricketRole}
                        onChange={(e) => setCricketRole(e.target.value as CricketRole)}
                        options={[
                          { value: 'BATSMAN', label: 'Batsman' },
                          { value: 'BOWLER', label: 'Bowler' },
                          { value: 'ALL_ROUNDER', label: 'All-rounder' },
                          { value: 'BATSMAN_WICKETKEEPER', label: 'Batsman + Wicketkeeper' },
                          { value: 'BOWLER_WICKETKEEPER', label: 'Bowler + Wicketkeeper' },
                        ]}
                      />

                      {/* Batting Style */}
                      <Select
                        label="Batting Style *"
                        required
                        value={battingStyle}
                        onChange={(e) => setBattingStyle(e.target.value as BattingStyle)}
                        options={[
                          { value: 'RIGHT_HAND', label: 'Right-hand' },
                          { value: 'LEFT_HAND', label: 'Left-hand' },
                        ]}
                      />
                    </div>

                    {/* Official Kit & Jersey Specifications Section */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                        <span className="text-xs font-bold text-amber-400 tracking-wider uppercase flex items-center gap-1.5">
                          Official Kit & Jersey Specifications
                        </span>
                        <JerseyInfoTooltip />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {/* Jersey Name */}
                        <div>
                          <label className="text-xs sm:text-sm font-medium text-slate-300 block mb-1">
                            Jersey Name <span className="text-rose-400">*</span>
                          </label>
                          <input
                            id="field-jersey-name"
                            type="text"
                            required
                            value={jerseyName}
                            onChange={(e) => {
                              setJerseyName(e.target.value);
                              if (fieldErrors.jerseyName) setFieldErrors((prev) => { const n = { ...prev }; delete n.jerseyName; return n; });
                            }}
                            placeholder="Name on jersey"
                            className={`w-full bg-slate-950 border text-slate-100 rounded-xl px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-emerald-500 transition-colors ${fieldErrors.jerseyName ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-800'}`}
                          />
                          {fieldErrors.jerseyName && (
                            <p className="text-xs text-rose-400 font-semibold mt-1">{fieldErrors.jerseyName}</p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-1">Printed on back of kit</p>
                        </div>

                        {/* Jersey Number */}
                        <div>
                          <label className="text-xs sm:text-sm font-medium text-slate-300 block mb-1">
                            Jersey Number <span className="text-rose-400">*</span>
                          </label>
                          <input
                            id="field-jersey-number"
                            type="text"
                            required
                            value={jerseyNumber}
                            onChange={(e) => {
                              setJerseyNumber(e.target.value);
                              if (fieldErrors.jerseyNumber) setFieldErrors((prev) => { const n = { ...prev }; delete n.jerseyNumber; return n; });
                            }}
                            placeholder="e.g. 7 or 18"
                            className={`w-full bg-slate-950 border text-slate-100 rounded-xl px-4 py-2.5 text-xs sm:text-sm focus:outline-none focus:border-emerald-500 transition-colors ${fieldErrors.jerseyNumber ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-800'}`}
                          />
                          {fieldErrors.jerseyNumber && (
                            <p className="text-xs text-rose-400 font-semibold mt-1">{fieldErrors.jerseyNumber}</p>
                          )}
                          <p className="text-[11px] text-slate-500 mt-1">Digits 0-99</p>
                        </div>

                        {/* Jersey Size */}
                        <div>
                          <Select
                            label="Jersey Size *"
                            required
                            value={jerseySize}
                            onChange={(e) => setJerseySize(e.target.value as JerseySize)}
                            options={[
                              { value: 'S', label: 'Small (S - 38")' },
                              { value: 'M', label: 'Medium (M - 40")' },
                              { value: 'L', label: 'Large (L - 42")' },
                              { value: 'XL', label: 'X-Large (XL - 44")' },
                              { value: 'XXL', label: 'XX-Large (XXL - 46")' },
                              { value: '3XL', label: '3X-Large (3XL - 48")' },
                            ]}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Terms & Conduct Checkbox */}
                    <div className="pt-2">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={termsAccepted}
                          onChange={(e) => {
                            setTermsAccepted(e.target.checked);
                            if (e.target.checked) setErrorMsg(null);
                          }}
                          className="w-5 h-5 mt-0.5 rounded border-slate-700 bg-slate-950 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                          I agree to abide by all tournament rules and code of conduct.
                        </span>
                      </label>
                    </div>

                    <div className="pt-4 border-t border-slate-800 flex justify-end">
                      <Button
                        type="submit"
                        size="lg"
                        isLoading={submitting}
                        disabled={!tournament.registration_open}
                        rightIcon={<ArrowRight className="w-5 h-5" />}
                        className="w-full sm:w-auto"
                      >
                        {isWaitlistMode ? 'Submit & Join Waitlist' : `Complete Registration (${formatPaiseToINR(tournament.registration_fee)})`}
                      </Button>
                    </div>
                  </form>
                )}
              </Card>

              {/* REGISTRATION STATUS SECTION (User's own status only) */}
              {currentUser && confirmedPlayers.length > 0 && (() => {
                const myEntry = confirmedPlayers.find(
                  (p: any) => p.player?.email === currentUser.email
                );
                if (!myEntry) return null;

                const isPending = myEntry.registration_status === 'PENDING';
                const isConfirmedStatus = myEntry.registration_status === 'CONFIRMED';

                return (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl">
                    <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isConfirmedStatus
                          ? 'bg-emerald-950 border border-emerald-500/40 text-emerald-400'
                          : 'bg-amber-950 border border-amber-500/40 text-amber-400'
                      }`}>
                        {isConfirmedStatus ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-white">Your Registration Status</h2>
                        <p className="text-xs text-slate-400">
                          {tournament.name}
                        </p>
                      </div>
                    </div>

                    <div className={`p-4 rounded-2xl border ${
                      isConfirmedStatus
                        ? 'bg-emerald-950/40 border-emerald-500/40'
                        : 'bg-amber-950/40 border-amber-500/40'
                    }`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {myEntry.registered_image_snapshot || profileImageUrl ? (
                            <img
                              src={myEntry.registered_image_snapshot || profileImageUrl}
                              alt="Your Photo"
                              className={`w-12 h-12 rounded-full object-cover border-2 shrink-0 ${
                                isConfirmedStatus ? 'border-emerald-500' : 'border-amber-500'
                              }`}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
                              <Users className="w-6 h-6" />
                            </div>
                          )}
                          <div>
                            <h4 className="font-bold text-white text-sm">{myEntry.registered_name_snapshot}</h4>
                            <span className="text-xs text-slate-300 font-semibold">
                              {cricketRoleLabels[myEntry.registered_role_snapshot as keyof typeof cricketRoleLabels] || myEntry.registered_role_snapshot}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                            isConfirmedStatus
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          }`}>
                            {isConfirmedStatus ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                            {myEntry.registration_status}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-slate-800/60 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400 block">Ref ID</span>
                          <span className="font-mono font-bold text-emerald-400">{myEntry.registration_number}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Jersey Name / No</span>
                          <span className="font-bold text-amber-300">
                            {myEntry.registered_jersey_name_snapshot || myEntry.registered_name_snapshot || '-'} {myEntry.registered_jersey_number_snapshot ? `#${myEntry.registered_jersey_number_snapshot}` : ''}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Jersey Size</span>
                          <span className="font-bold text-amber-400">{myEntry.registered_jersey_size_snapshot || 'M'}</span>
                        </div>
                        {myEntry.team_name ? (
                          <div>
                            <span className="text-slate-400 block">Team</span>
                            <span className="font-bold text-teal-400">🛡️ {myEntry.team_name}</span>
                          </div>
                        ) : (
                          <div>
                            <span className="text-slate-400 block">Role</span>
                            <span className="font-bold text-teal-400">{myEntry.registered_role_snapshot || 'BATSMAN'}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {isPending && (
                      <p className="text-xs text-amber-300/80 text-center">
                        ⏳ Your registration is awaiting admin approval. Once verified, your status will change to <strong>CONFIRMED</strong>.
                      </p>
                    )}
                    {isConfirmedStatus && (
                      <p className="text-xs text-emerald-300/80 text-center">
                        ✅ Your registration has been approved! You are confirmed for this tournament.
                      </p>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </main>

      {tournament && (
        <TeamOwnerRegistrationModal
          isOpen={isOwnerModalOpen}
          onClose={() => setIsOwnerModalOpen(false)}
          tournament={tournament}
          currentUser={currentUser}
        />
      )}

      <Footer />
    </div>
  );
}
