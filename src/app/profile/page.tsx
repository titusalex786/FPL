'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/public/Header';
import { Footer } from '@/components/public/Footer';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';
import { User, Upload, Save, CheckCircle2, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { CricketRole, BattingStyle, JerseySize } from '@/types';

export default function ProfilePage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [cricketRole, setCricketRole] = useState<CricketRole>('BATSMAN');
  const [battingStyle, setBattingStyle] = useState<BattingStyle>('RIGHT_HAND');
  const [jerseySize, setJerseySize] = useState<JerseySize>('M');

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [registrations, setRegistrations] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/players/profile')
      .then((res) => res.json())
      .then((data) => {
        if (data.error === 'Unauthorized') {
          router.push('/auth/login?redirect=/profile');
          return;
        }

        if (data.authUser) {
          setEmail(data.authUser.email);

          const defaultName = data.authUser.email
            .split('@')[0]
            .replace(/[._-]/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());

          if (data.player) {
            setFullName(data.player.full_name || defaultName);
            setProfileImageUrl(data.player.profile_image_url || '');
            setCricketRole(data.player.cricket_role || 'BATSMAN');
            setBattingStyle(data.player.batting_style || 'RIGHT_HAND');
            setJerseySize(data.player.jersey_size || 'M');
          } else {
            setFullName(defaultName);
          }

          setRegistrations(data.registrations || []);
        }
      })
      .catch(() => setErrorMsg('Failed to load profile details'))
      .finally(() => setLoading(false));
  }, [router]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setErrorMsg('Please upload a JPG, PNG, or WebP image');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMsg('File size must be under 2 MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setProfileImageUrl(result);
      setErrorMsg(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/players/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          profileImageUrl,
          cricketRole,
          battingStyle,
          jerseySize,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setErrorMsg(data.error || 'Failed to save profile');
      } else {
        setSuccessMsg('Reusable player profile updated successfully! Preferences saved for future tournament registrations.');
      }
    } catch (err: any) {
      setErrorMsg('Network error saving profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-8">
          <div className="border-b border-slate-800 pb-4">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-2">
              <User className="w-7 h-7 text-emerald-400" />
              <span>Persistent Player Profile & History</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Your profile preferences are saved and automatically prefilled when registering for any tournament.
            </p>
          </div>

          {successMsg && (
            <div className="p-4 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-300 text-xs sm:text-sm flex items-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-300 text-xs sm:text-sm flex items-center gap-2 animate-fadeIn">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Profile Editor Form */}
          <form onSubmit={handleSaveProfile} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-white">Edit Saved Profile</h2>
            </div>

            {/* Profile Image Section */}
            <div className="space-y-2">
              <label className="text-xs sm:text-sm font-medium text-slate-300 block">
                Profile Image <span className="text-rose-400">*</span>
              </label>
              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 bg-slate-950/60 border border-dashed border-slate-700 rounded-2xl">
                {profileImageUrl ? (
                  <div className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-emerald-500 shrink-0">
                    <img src={profileImageUrl} alt="Player Avatar" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 shrink-0">
                    <ImageIcon className="w-10 h-10" />
                  </div>
                )}
                <div className="flex-1 text-center sm:text-left">
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs sm:text-sm font-medium rounded-xl border border-slate-700 transition-colors">
                    <Upload className="w-4 h-4 text-emerald-400" />
                    <span>Upload Image</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                  </label>
                  <p className="text-[11px] text-slate-400 mt-1">
                    JPG, PNG or WebP (Max 2 MB)
                  </p>
                </div>
              </div>
            </div>

            {/* Full Name */}
            <Input
              label="Full Name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Rahul Patil"
              helperText="Prefilled from your account. You can edit your name at any time."
            />

            {/* Email (Readonly) */}
            <Input
              label="Email Address (Authenticated)"
              type="email"
              disabled
              value={email}
              helperText="Linked to your authenticated account"
            />

            {/* Cricket Role */}
            <Select
              label="Cricket Role"
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

            {/* Jersey Size */}
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

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <Button type="submit" size="lg" isLoading={saving} leftIcon={<Save className="w-5 h-5" />}>
                Save Reusable Profile
              </Button>
            </div>
          </form>

          {/* Tournament Participation History & Registration Passes */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl">
            <h2 className="text-lg font-bold text-white flex items-center justify-between">
              <span>My Tournament Participation & Passes</span>
              <span className="text-xs text-emerald-400 font-mono font-bold bg-emerald-950/80 px-3 py-1 rounded-full border border-emerald-500/30">
                {registrations.length} Tournaments
              </span>
            </h2>

            {registrations.length === 0 ? (
              <div className="p-6 bg-slate-950/60 border border-slate-800 rounded-2xl text-center text-xs text-slate-400">
                You have not registered anyone for any tournaments yet. Check upcoming tournaments below!
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {registrations.map((reg) => {
                  const payment = reg.payments?.[0];
                  const hasCorrection = reg.registration_status === 'CORRECTION_REQUESTED';
                  const needsPaymentCorrection = payment?.payment_status === 'PENDING' && payment?.verification_note?.includes('Screenshot'); // Simple heuristic for now, we will refine.

                  return (
                    <div
                      key={reg.id}
                      className={`p-5 rounded-2xl border flex flex-col gap-4 shadow-sm transition-all duration-300 ${
                        hasCorrection ? 'bg-amber-950/20 border-amber-500/30' : 'bg-slate-900 border-slate-700'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-bold text-white text-lg">{reg.registered_name_snapshot}</h3>
                          <span className="text-xs font-mono text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded border border-emerald-500/30">
                            {reg.registration_number}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mb-2">
                          {reg.tournament?.name}
                        </div>
                        
                        <div className="flex flex-col gap-1 text-sm mt-3">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Registration:</span>
                            <span className={`font-semibold ${
                              reg.registration_status === 'CONFIRMED' ? 'text-emerald-400' : 
                              reg.registration_status === 'CORRECTION_REQUESTED' ? 'text-amber-400' : 'text-slate-300'
                            }`}>{reg.registration_status}</span>
                          </div>
                          {payment && (
                            <div className="flex justify-between">
                              <span className="text-slate-400">Payment:</span>
                              <span className={`font-semibold ${
                                payment.payment_status === 'SUCCESSFUL' ? 'text-emerald-400' : 'text-amber-400'
                              }`}>{payment.payment_status}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {hasCorrection && (
                        <div className="p-3 bg-amber-950/40 rounded-xl border border-amber-500/20 text-xs text-amber-200 flex flex-col gap-1">
                          <span className="font-bold flex items-center gap-1"><AlertCircle className="w-3 h-3" /> CORRECTION REQUIRED</span>
                          <span>{reg.admin_remarks || 'Please update your details'}</span>
                        </div>
                      )}

                      <div className="mt-auto pt-4 border-t border-slate-800">
                        <Button
                          variant={hasCorrection ? "primary" : "secondary"}
                          className={`w-full ${hasCorrection ? 'bg-amber-500 hover:bg-amber-600 text-black' : ''}`}
                          onClick={() => router.push(`/registration/${reg.id}`)}
                        >
                          {hasCorrection ? 'Update Details' : 'View Details'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
