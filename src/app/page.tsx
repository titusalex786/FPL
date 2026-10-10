import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Header } from '@/components/public/Header';
import { Footer } from '@/components/public/Footer';
import { Button } from '@/components/ui/Button';
import { formatPaiseToINR, formatDate } from '@/lib/utils/format';
import { getOrderedTournaments, isTournamentCompleted } from '@/lib/utils/tournament';
import { getPublicTournaments } from '@/lib/data/tournaments';
import {
  Trophy,
  Calendar,
  UserCheck,
  ArrowRight,
  Phone,
  Sparkles,
  Check,
  Clock,
} from 'lucide-react';
import { MyRegistrationProvider } from '@/components/home/MyRegistrationContext';
import { MyRegistrationSection } from '@/components/home/MyRegistrationSection';
import { TournamentCtaButton } from '@/components/home/TournamentCtaButton';

export const revalidate = 60; // Revalidate public homepage every 60 seconds

interface HomePageProps {
  searchParams: Promise<{
    submitted?: string;
    tName?: string;
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedParams = await searchParams;
  const isSubmitted = resolvedParams?.submitted === 'true';
  const submittedTournamentName = resolvedParams?.tName || 'FairPlay Premier League';

  const tournaments = await getPublicTournaments();

  // Ordered by created_at DESC — latest created tournament is always first/hero.
  // Past tournaments remain in the list; isTournamentCompleted() drives display-only badges.
  const orderedTournaments = getOrderedTournaments(tournaments);
  const activeTournament = orderedTournaments[0] || null;
  const remainingTournaments = orderedTournaments.slice(1);
  const feeDisplay = activeTournament ? formatPaiseToINR(activeTournament.registration_fee) : '₹0';

  return (
    <MyRegistrationProvider>
      <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500 selection:text-white">
        <Header />

        <main className="flex-1 space-y-16 md:space-y-24 pb-20">
          {/* SUBMITTED PAYMENT SCREENSHOT BANNER */}
          {isSubmitted && (
            <div className="bg-emerald-950/90 border-b border-emerald-500/50 py-4 px-4 sm:px-6 shadow-2xl animate-fadeIn">
              <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                    <Check className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white text-sm sm:text-base">
                      🎉 Registration Submitted Successfully!
                    </h3>
                    <p className="text-xs text-slate-300 mt-0.5">
                      Your entry for <strong className="text-emerald-300">{submittedTournamentName}</strong> is now <strong className="text-amber-300">PENDING</strong> admin review. You will be confirmed once your payment is verified.
                    </p>
                  </div>
                </div>
                <Link href="#my-registration">
                  <Button size="sm" variant="outline">
                    Check Registration Status
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* MY REGISTRATION PASS SECTION (Displayed for authenticated players with active entry) */}
          <MyRegistrationSection />

        {/* HERO SECTION */}
        <section className="relative overflow-hidden pt-6 pb-12 md:pt-12 md:pb-20 border-b border-slate-900 bg-gradient-to-b from-slate-900/80 via-slate-950 to-slate-950">
          {/* Ambient Lighting Gradients */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[140px] pointer-events-none rounded-full" />
          <div className="absolute top-1/3 right-10 w-[300px] h-[300px] bg-teal-500/10 blur-[100px] pointer-events-none rounded-full" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 space-y-6">
            {/* Registration Deadline Banner Notice if closed */}
            {activeTournament && (() => {
              const isCompleted = isTournamentCompleted(activeTournament.tournament_date);
              const isDeadlinePassed = activeTournament.registration_end_date ? new Date(activeTournament.registration_end_date) < new Date() : false;
              const isClosed = !activeTournament.registration_open || isDeadlinePassed;
              if (isCompleted) {
                return (
                  <div className="p-4 bg-slate-900/90 border border-slate-700 rounded-2xl text-slate-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 shadow-xl">
                    <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
                    <span>
                      <strong>{activeTournament.name}</strong> — Tournament Completed on{' '}
                      <strong className="text-amber-300">{formatDate(activeTournament.tournament_date)}</strong>
                    </span>
                  </div>
                );
              }
              if (isClosed) {
                return (
                  <div className="p-4 bg-rose-950/90 border border-rose-500/50 rounded-2xl text-rose-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-3 shadow-xl">
                    <Clock className="w-5 h-5 text-rose-400 shrink-0" />
                    <span>
                      Registration for <strong>{activeTournament.name}</strong> is currently <strong>CLOSED</strong>
                      {isDeadlinePassed && activeTournament.registration_end_date ? ` (Deadline passed on ${formatDate(activeTournament.registration_end_date)})` : ''}.
                    </span>
                  </div>
                );
              }
              return null;
            })()}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* TOURNAMENT BANNER DISPLAY (Mobile top / Desktop side) */}
              <div className="lg:col-span-6 space-y-4">
                <div className="w-full rounded-3xl overflow-hidden border border-slate-800 bg-slate-950 shadow-2xl relative group">
                  {activeTournament?.banner_url ? (
                    <div className="relative w-full flex items-center justify-center bg-slate-950 overflow-hidden min-h-[220px] sm:min-h-[300px]">
                      {/* Ambient background glow image */}
                      <Image
                        src={activeTournament.banner_url}
                        alt=""
                        aria-hidden="true"
                        width={800}
                        height={420}
                        className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-25 scale-110 pointer-events-none"
                      />
                      {/* Optimized main hero banner image */}
                      <Image
                        src={activeTournament.banner_url}
                        alt={activeTournament.name}
                        width={800}
                        height={420}
                        priority
                        className="w-full h-auto max-h-[420px] object-contain relative z-10 group-hover:scale-[1.01] transition-transform duration-500"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
                      />
                    </div>
                  ) : (
                    <div className="w-full h-56 sm:h-72 md:h-80 bg-gradient-to-tr from-slate-900 via-emerald-950 to-teal-900 p-8 flex flex-col justify-between relative overflow-hidden">
                      <div className="absolute -right-10 -bottom-10 opacity-10">
                        <Trophy className="w-80 h-80 text-white" />
                      </div>
                      <span className="px-3 py-1 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs font-bold rounded-full uppercase self-start">
                        {activeTournament?.tournament_type === 'OWNER_BASED' ? '👑 Owner-Based League' : '🏏 Premier Championship'}
                      </span>
                      <div>
                        <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                          {activeTournament?.name || 'FairPlay Premier League'}
                        </h2>
                        <p className="text-xs text-slate-300 mt-1 line-clamp-2">
                          {activeTournament?.description || 'Official Player Registration & Auction Portal'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Banner Overlay Badge */}
                  <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full bg-slate-950/90 backdrop-blur-md border border-slate-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg">
                      <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                      {activeTournament ? formatDate(activeTournament.tournament_date) : 'Coming Soon'}
                    </span>
                  </div>
                </div>

                {/* MOBILE DISPLAY: ACTION BUTTONS RIGHT BELOW BANNER */}
                <div className="block lg:hidden space-y-3">
                  {activeTournament && (() => {
                    const isCompleted = isTournamentCompleted(activeTournament.tournament_date);
                    const isDeadlinePassed = activeTournament.registration_end_date ? new Date(activeTournament.registration_end_date) < new Date() : false;
                    const isClosed = !activeTournament.registration_open || isDeadlinePassed;

                    if (isCompleted) {
                      return (
                        <div className="p-3 bg-slate-900/80 border border-slate-700 rounded-xl text-center text-amber-300 text-xs font-semibold flex items-center justify-center gap-2">
                          <Trophy className="w-4 h-4 text-amber-400" />
                          Tournament Completed — {formatDate(activeTournament.tournament_date)}
                        </div>
                      );
                    }

                    if (isClosed) {
                      return (
                        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center text-slate-400 text-xs font-semibold">
                          Registration Closed for this Tournament
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <TournamentCtaButton
                          tournamentId={activeTournament.id}
                          registrationFee={activeTournament.registration_fee}
                          tournamentType={activeTournament.tournament_type}
                          isHero={true}
                        />

                        {activeTournament.tournament_type === 'OWNER_BASED' && (
                          <Link href={`/tournament/${activeTournament.id}?type=owner`} className="w-full">
                            <Button size="lg" variant="gold" className="w-full" leftIcon={<Trophy className="w-5 h-5" />}>
                              Register as Team Owner 👑
                            </Button>
                          </Link>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* DESKTOP SIDE: TOURNAMENT DETAILS & REGISTRATION CTAS */}
              <div className="lg:col-span-6 space-y-6 text-center lg:text-left">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs md:text-sm font-semibold tracking-wide">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span>FairPlay Premier League Registration Portal</span>
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-white leading-[1.1]">
                  {activeTournament?.name || 'FairPlay Cricket Championship'}
                </h1>

                <p className="text-sm sm:text-base text-slate-300 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
                  {activeTournament?.description ||
                    'Showcase your batting, bowling, and fielding skills. Register online to lock in your official tournament entry or team ownership slot.'}
                </p>

                {/* Key Metrics Quick Ribbon */}
                {activeTournament && (
                  <div className="pt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-xl mx-auto lg:mx-0">
                    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-center sm:text-left">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Player Fee
                      </span>
                      <span className="text-lg md:text-xl font-extrabold text-emerald-400">
                        {feeDisplay}
                      </span>
                    </div>
                    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-center sm:text-left">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Tournament Date
                      </span>
                      <span className="text-xs md:text-sm font-bold text-slate-200">
                        {formatDate(activeTournament.tournament_date)}
                      </span>
                    </div>
                    <div className="col-span-2 sm:col-span-1 bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-center sm:text-left">
                      <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider block">
                        Registration Deadline
                      </span>
                      <span className="text-xs md:text-sm font-bold text-amber-300">
                        {activeTournament.registration_end_date ? formatDate(activeTournament.registration_end_date) : 'Until Capacity'}
                      </span>
                    </div>
                  </div>
                )}

                {/* DESKTOP CTA BUTTONS */}
                <div className="hidden lg:flex flex-col sm:flex-row items-center justify-start gap-4 pt-4">
                  {activeTournament ? (() => {
                    const isCompleted = isTournamentCompleted(activeTournament.tournament_date);
                    const isDeadlinePassed = activeTournament.registration_end_date ? new Date(activeTournament.registration_end_date) < new Date() : false;
                    const isClosed = !activeTournament.registration_open || isDeadlinePassed;

                    if (isCompleted) {
                      return (
                        <div className="p-3 bg-slate-900/80 border border-slate-700 rounded-xl text-amber-300 text-xs font-semibold flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-amber-400" />
                          Tournament Completed — {formatDate(activeTournament.tournament_date)}
                        </div>
                      );
                    }

                    if (isClosed) {
                      return (
                        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 text-xs font-semibold">
                          Registration Closed for this Tournament
                        </div>
                      );
                    }

                    return (
                      <div className="flex flex-wrap items-center gap-3">
                        <TournamentCtaButton
                          tournamentId={activeTournament.id}
                          registrationFee={activeTournament.registration_fee}
                          tournamentType={activeTournament.tournament_type}
                          isHero={true}
                        />

                        {activeTournament.tournament_type === 'OWNER_BASED' && (
                          <Link href={`/tournament/${activeTournament.id}?type=owner`}>
                            <Button size="lg" variant="gold" leftIcon={<Trophy className="w-5 h-5" />}>
                              Register as Team Owner 👑
                            </Button>
                          </Link>
                        )}
                      </div>
                    );
                  })() : (
                    <Link href="/admin/login">
                      <Button size="lg" variant="outline">
                        Admin Login to Create Tournament
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* UPCOMING TOURNAMENTS DASHBOARD SECTION */}
        <section id="upcoming-tournaments" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-900 pb-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Player Registration Portal
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 flex items-center gap-2">
                <Trophy className="w-7 h-7 text-emerald-400" />
                <span>All Tournaments</span>
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md">
              Select any tournament created by the admin below to register for entry.
            </p>
          </div>

          {orderedTournaments.length === 0 ? (
            <div className="p-8 bg-slate-900 border border-slate-800 rounded-3xl text-center space-y-4 shadow-xl">
              <Trophy className="w-12 h-12 text-emerald-400 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">No Tournaments Published Yet</h3>
                <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                  The admin has not created any active tournaments in the system. Log in to the Admin Portal to publish a new tournament.
                </p>
              </div>
              <div className="pt-2 flex justify-center">
                <Link href="/admin/login">
                  <Button size="md" leftIcon={<ArrowRight className="w-4 h-4" />}>
                    Go to Admin Dashboard to Create Tournament
                  </Button>
                </Link>
              </div>
            </div>
          ) : remainingTournaments.length === 0 ? (
            <div className="p-8 bg-slate-900/60 border border-slate-800/80 rounded-3xl text-center space-y-2 shadow-xl">
              <p className="text-xs sm:text-sm text-slate-400">
                No other tournaments at this time. See the featured tournament above.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {remainingTournaments.map((item) => (
                <div
                  key={item.id}
                  className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-xl relative overflow-hidden group hover:border-emerald-500/50 transition-all"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shrink-0">
                        <Trophy className="w-7 h-7" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-white text-lg">{item.name}</h3>
                        <span className="text-xs text-slate-400">Official Tournament</span>
                      </div>
                    </div>
                    {isTournamentCompleted(item.tournament_date) ? (
                      <span className="px-3 py-1 bg-slate-800 border border-slate-600 text-amber-300 text-xs font-bold rounded-full uppercase">
                        Completed
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-xs font-bold rounded-full uppercase">
                        {item.registration_open ? 'Open' : 'Closed'}
                      </span>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {item.description || 'Showcase your skills in front of top selectors and coaches.'}
                  </p>

                  <div className="grid grid-cols-3 gap-3 p-3.5 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Fee</span>
                      <span className="font-extrabold text-emerald-400 text-sm">
                        {formatPaiseToINR(item.registration_fee)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Date</span>
                      <span className="font-bold text-slate-200">{formatDate(item.tournament_date)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-bold block">Capacity</span>
                      <span className="font-bold text-sky-400">{item.max_players} Players</span>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <TournamentCtaButton
                      tournamentId={item.id}
                      registrationFee={item.registration_fee}
                      isHero={false}
                      isCompleted={isTournamentCompleted(item.tournament_date)}
                      isClosed={!item.registration_open}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* QUICK LINKS TO ABOUT & HOW IT WORKS */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Link href="/how-it-works" className="block group">
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xl hover:border-emerald-500/50 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold shrink-0">
                    📋
                  </div>
                  <h3 className="font-extrabold text-white text-lg">How It Works</h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Step-by-step guide for completing your player or team owner registration with payment verification.
                </p>
                <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-bold group-hover:gap-2 transition-all">
                  Learn More <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>

            <Link href="/about" className="block group">
              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-3 shadow-xl hover:border-amber-500/50 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-950 border border-amber-500/40 text-amber-400 flex items-center justify-center font-bold shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="font-extrabold text-white text-lg">About FPL</h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Learn about FairPlay Premier League&apos;s mission, principles, code of conduct, and benefits.
                </p>
                <span className="inline-flex items-center gap-1 text-amber-400 text-xs font-bold group-hover:gap-2 transition-all">
                  Read More <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </Link>
          </div>
        </section>

        {/* CONTACT SECTION */}
        <section id="contact" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 scroll-mt-24">
          <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-10 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-3 text-center md:text-left">
              <h2 className="text-xl sm:text-2xl font-bold text-white">Have Questions or Need Venue Details?</h2>
              <p className="text-xs sm:text-sm text-slate-400 max-w-xl flex items-center justify-center md:justify-start gap-2">
                <span>Official Venue:</span>
                <a
                  href="https://share.google/jhDr1oV9hKexMdG3Q"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:underline font-bold inline-flex items-center gap-1"
                >
                  Turf Titans 📍
                </a>
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-4 shrink-0">
              <a
                href="https://share.google/jhDr1oV9hKexMdG3Q"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 font-semibold rounded-xl text-xs sm:text-sm border border-emerald-500/40 transition-colors shadow-lg"
              >
                <span>📍 Turf Titans Location</span>
              </a>
              <a
                href="tel:+918433832332"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl text-xs sm:text-sm border border-slate-700 transition-colors"
              >
                <Phone className="w-4 h-4 text-emerald-400" />
                <span>+91 84338 32332</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  </MyRegistrationProvider>
  );
}
