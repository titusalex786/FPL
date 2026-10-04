'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/public/Header';
import { Footer } from '@/components/public/Footer';
import { StepProgress } from '@/components/ui/StepProgress';
import { Step1Personal } from '@/components/register/Step1Personal';
import { Step2Cricket } from '@/components/register/Step2Cricket';
import { Step3Review } from '@/components/register/Step3Review';
import { Step1PersonalInput, Step2CricketInput } from '@/lib/validation/registration';
import { ShieldAlert, Lock, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { createClient } from '@/lib/supabase/client';

export default function RegisterPage() {
  const router = useRouter();
  const supabase = createClient();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTournament, setActiveTournament] = useState<any>(null);

  const [personalData, setPersonalData] = useState<Step1PersonalInput>({
    fullName: '',
    mobile: '',
    email: '',
    dateOfBirth: '',
    city: '',
    profilePhotoPath: '',
  });

  const [cricketData, setCricketData] = useState<Step2CricketInput>({
    primaryRole: 'BATSMAN',
    battingStyle: 'RIGHT_HAND',
    bowlingStyle: 'DOESNT_BOWL',
    experienceLevel: 'INTERMEDIATE',
    additionalSkills: '',
    jerseyName: '',
    jerseyNumber: '',
    jerseySize: 'M',
  });

  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Parallel Auth, Profile, and Tournament Initial Loading
  useEffect(() => {
    let isMounted = true;

    const loadInitialData = async () => {
      try {
        const [authRes, tournamentsRes, profileRes] = await Promise.all([
          supabase.auth.getUser().catch(() => ({ data: { user: null } })),
          fetch('/api/tournaments/upcoming').then((res) => res.json()).catch(() => ({})),
          fetch('/api/players/profile').then((res) => res.json()).catch(() => ({})),
        ]);

        if (!isMounted) return;

        // 1. Process Tournament Data
        if (tournamentsRes?.tournaments && Array.isArray(tournamentsRes.tournaments)) {
          const openT = tournamentsRes.tournaments.find((t: any) => t.registration_open) || tournamentsRes.tournaments[0];
          setActiveTournament(openT);
        }

        // 2. Process Auth & Profile Data
        const user = authRes?.data?.user || null;
        if (user) {
          setCurrentUser(user);
          const defaultName = (user.email || '')
            .split('@')[0]
            .replace(/[._-]/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase());

          const player = profileRes?.player;
          setPersonalData((prev) => ({
            ...prev,
            fullName: player?.full_name || defaultName,
            email: player?.email || user.email || '',
            profilePhotoPath: player?.profile_image_url || '',
          }));

          if (player) {
            setCricketData((prev) => ({
              ...prev,
              primaryRole: player.cricket_role || 'BATSMAN',
              battingStyle: player.batting_style || 'RIGHT_HAND',
              bowlingStyle: player.bowling_style || 'DOESNT_BOWL',
              jerseyName: player.jersey_name || player.full_name || defaultName,
              jerseyNumber: player.jersey_number || '',
              jerseySize: player.jersey_size || 'M',
            }));
          }
        } else {
          setCurrentUser(null);
        }
      } catch (err) {
        console.error('Error loading registration page data:', err);
      } finally {
        if (isMounted) {
          setCheckingAuth(false);
        }
      }
    };

    loadInitialData();

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        loadInitialData();
      }
    });

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [supabase]);

  const handleStep1Submit = (data: Step1PersonalInput) => {
    setPersonalData(data);
    setSubmitError(null);
    setCricketData((prev) => ({
      ...prev,
      jerseyName: prev.jerseyName || data.fullName,
    }));
    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStep2Submit = (data: Step2CricketInput) => {
    setCricketData(data);
    setSubmitError(null);
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFinalSubmitPayment = async () => {
    setIsLoading(true);
    setSubmitError(null);

    try {
      const payload = {
        tournamentId: activeTournament?.id,
        registrationFor: personalData.registrationFor || 'SELF',
        fullName: personalData.fullName,
        email: personalData.email || (personalData.mobile ? `${personalData.mobile}@fairplay.local` : ''),
        profileImageUrl: personalData.profilePhotoPath,
        profilePhotoPath: personalData.profilePhotoPath,
        cricketRole: (cricketData.primaryRole === 'WICKETKEEPER' || cricketData.primaryRole === 'BATSMAN_BOWLER' ? 'ALL_ROUNDER' : cricketData.primaryRole),
        primaryRole: cricketData.primaryRole,
        battingStyle: cricketData.battingStyle || 'RIGHT_HAND',
        bowlingStyle: cricketData.bowlingStyle || 'DOESNT_BOWL',
        jerseyName: (cricketData.jerseyName || personalData.fullName).trim(),
        jerseyNumber: (cricketData.jerseyNumber || '').trim(),
        jerseySize: cricketData.jerseySize || 'M',
        mobile: personalData.mobile,
        city: personalData.city,
        dateOfBirth: personalData.dateOfBirth,
        termsAccepted: true,
      };

      const regResponse = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const regResult = await regResponse.json();

      if (!regResponse.ok || regResult.error) {
        setSubmitError(regResult.error || 'Failed to process registration');
        setIsLoading(false);
        return;
      }

      const { registrationId } = regResult;

      // Redirect to official registration pass & UPI payment details page
      router.push(`/registration/${registrationId}`);
    } catch (err: any) {
      setSubmitError(err.message || 'An unexpected network error occurred');
      setIsLoading(false);
    }
  };

  const registrationFeePaise = activeTournament?.registration_fee || 50000;

  const steps = [
    { id: 1, title: 'Personal Info', subtitle: 'Name & Mobile' },
    { id: 2, title: 'Cricket Info', subtitle: 'Role & Skills' },
    { id: 3, title: 'Review & Pay', subtitle: 'Summary & Fee' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
      <Header />

      <main className="flex-1 py-8 sm:py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Header Title */}
          <div className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              Player Registration Form
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              {activeTournament?.name || 'FairPlay Premier League'}
            </p>
          </div>

          {/* Responsive Step Progress Indicator */}
          <StepProgress currentStep={currentStep} steps={steps} />

          {/* Auth Guard Banner */}
          {!checkingAuth && !currentUser ? (
            <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 shadow-2xl">
              <div className="w-14 h-14 rounded-2xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto">
                <Lock className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold text-white">Sign In Required to Register</h3>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  Please sign in or create an account before completing registration. You will be brought directly back here to finalize entry.
                </p>
              </div>
              <div className="pt-2 flex justify-center">
                <Button
                  size="lg"
                  onClick={() => router.push('/auth/login?redirect=/register')}
                  leftIcon={<LogIn className="w-5 h-5" />}
                  className="w-full sm:w-auto"
                >
                  Sign In to Continue Registration
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Submission Error Banner */}
              {submitError && (
                <div className="p-4 bg-rose-950/80 border border-rose-500/50 rounded-2xl text-rose-300 text-xs sm:text-sm flex items-start gap-3 shadow-lg animate-fadeIn">
                  <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Registration Issue</span>
                    <p>{submitError}</p>
                  </div>
                </div>
              )}

              {/* Step 1 Component */}
              {currentStep === 1 && (
                <Step1Personal initialData={personalData} onNext={handleStep1Submit} />
              )}

              {/* Step 2 Component */}
              {currentStep === 2 && (
                <Step2Cricket
                  initialData={cricketData}
                  onNext={handleStep2Submit}
                  onBack={() => setCurrentStep(1)}
                />
              )}

              {/* Step 3 Component */}
              {currentStep === 3 && (
                <Step3Review
                  personalData={personalData}
                  cricketData={cricketData}
                  registrationFeePaise={registrationFeePaise}
                  onEdit={() => setCurrentStep(1)}
                  onSubmitPayment={handleFinalSubmitPayment}
                  isLoading={isLoading}
                />
              )}
            </>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}
