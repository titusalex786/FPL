'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { useMyRegistrations } from './MyRegistrationContext';
import { formatPaiseToINR } from '@/lib/utils/format';
import { UserCheck, ArrowRight, Check } from 'lucide-react';

interface TournamentCtaButtonProps {
  tournamentId: string;
  registrationFee: number;
  tournamentType?: string;
  isHero?: boolean;
  isClosed?: boolean;
  isCompleted?: boolean;
  className?: string;
}

export const TournamentCtaButton: React.FC<TournamentCtaButtonProps> = ({
  tournamentId,
  registrationFee,
  tournamentType,
  isHero = false,
  isClosed = false,
  isCompleted = false,
  className = '',
}) => {
  const { getRegistrationForTournament } = useMyRegistrations();
  const registration = getRegistrationForTournament(tournamentId);

  const feeDisplay = formatPaiseToINR(registrationFee);

  // If user has an active registration for this tournament, show "My Registration" CTA
  if (registration) {
    return (
      <Link href="#my-registration" className={isHero ? 'w-full sm:w-auto' : 'w-full sm:w-auto'}>
        <Button
          size={isHero ? 'lg' : 'md'}
          variant="outline"
          className={`border-emerald-500/60 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 font-bold shadow-lg shadow-emerald-950/50 ${
            isHero ? 'w-full sm:w-auto' : 'w-full sm:w-auto'
          } ${className}`}
          leftIcon={<Check className="w-4 h-4 text-emerald-400" />}
        >
          My Registration
        </Button>
      </Link>
    );
  }

  // Completed tournament display
  if (isCompleted) {
    return (
      <Link href={`/tournament/${tournamentId}`} className={isHero ? 'w-full sm:w-auto' : 'w-full sm:w-auto'}>
        <Button size={isHero ? 'lg' : 'md'} variant="outline" className={`w-full sm:w-auto ${className}`}>
          View Tournament
        </Button>
      </Link>
    );
  }

  // Closed tournament display
  if (isClosed) {
    return (
      <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-center text-slate-400 text-xs font-semibold">
        Registration Closed
      </div>
    );
  }

  // Normal Player Registration CTA
  return (
    <Link href={`/tournament/${tournamentId}?type=player`} className={isHero ? 'w-full sm:w-auto' : 'w-full sm:w-auto'}>
      <Button
        size={isHero ? 'lg' : 'md'}
        className={`shadow-lg shadow-emerald-950/60 ${isHero ? 'w-full sm:w-auto' : 'w-full sm:w-auto'} ${className}`}
        leftIcon={<UserCheck className="w-5 h-5" />}
        rightIcon={!isHero ? <ArrowRight className="w-4 h-4" /> : undefined}
      >
        {isHero ? `Register as Player (${feeDisplay})` : `Register Now (${feeDisplay})`}
      </Button>
    </Link>
  );
};
