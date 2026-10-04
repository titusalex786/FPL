import { RegistrationStatus, PaymentStatus } from '@/types';

export type DerivedStatusKey =
  | 'CORRECTION_REQUIRED'
  | 'REJECTED'
  | 'WAITLISTED'
  | 'CONFIRMED'
  | 'PAYMENT_PENDING';

export interface DerivedStatusInfo {
  key: DerivedStatusKey;
  label: string;
  emoji: string;
  fullLabel: string;
  badgeVariant: 'warning' | 'success' | 'danger' | 'info' | 'neutral';
  colorClasses: {
    bg: string;
    border: string;
    text: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
  };
  description: string;
}

/**
 * Computes the canonical derived status for a registration across the player-facing UI:
 * 1. 🟠 Correction Required (CORRECTION_REQUESTED)
 * 2. 🔴 Registration Rejected (REJECTED)
 * 3. ⚪ Waitlisted (WAITING_LIST / WAITLISTED)
 * 4. 🟢 Registration Confirmed (CONFIRMED / SUCCESSFUL + Payment SUCCESSFUL)
 * 5. 🟡 Payment Verification Pending (Default for active pending payment / awaiting verification)
 */
export function computeDerivedRegistrationStatus(
  registration: {
    registration_status?: string | null;
    status?: string | null;
    waitlist_position?: number | null;
  } | null | undefined,
  payment?: {
    payment_status?: string | null;
  } | null | undefined,
  tournament?: {
    payment_enabled?: boolean | null;
    registration_fee?: number | null;
  } | null | undefined
): DerivedStatusInfo {
  const regStatus = (registration?.registration_status || registration?.status || '').toUpperCase();
  const payStatus = (payment?.payment_status || '').toUpperCase();

  // 1. Correction Required
  if (regStatus === 'CORRECTION_REQUESTED') {
    return {
      key: 'CORRECTION_REQUIRED',
      label: 'Correction Required',
      emoji: '🟠',
      fullLabel: '🟠 Correction Required',
      badgeVariant: 'warning',
      colorClasses: {
        bg: 'bg-amber-950/40',
        border: 'border-amber-500/50',
        text: 'text-amber-300',
        badgeBg: 'bg-amber-950/80',
        badgeText: 'text-amber-300',
        badgeBorder: 'border-amber-500/50',
      },
      description: 'Admin has requested corrections to your registration details or payment. Please review and resubmit.',
    };
  }

  // 2. Registration Rejected
  if (regStatus === 'REJECTED' || regStatus === 'CANCELLED' || payStatus === 'REJECTED' || payStatus === 'FAILED') {
    return {
      key: 'REJECTED',
      label: 'Registration Rejected',
      emoji: '🔴',
      fullLabel: '🔴 Registration Rejected',
      badgeVariant: 'danger',
      colorClasses: {
        bg: 'bg-rose-950/40',
        border: 'border-rose-500/50',
        text: 'text-rose-300',
        badgeBg: 'bg-rose-950/80',
        badgeText: 'text-rose-300',
        badgeBorder: 'border-rose-500/50',
      },
      description: 'Registration or payment was not approved by the tournament administrator.',
    };
  }

  // 3. Waitlisted
  if (regStatus === 'WAITING_LIST' || regStatus === 'WAITLISTED') {
    const pos = registration?.waitlist_position || 1;
    return {
      key: 'WAITLISTED',
      label: 'Waitlisted',
      emoji: '⚪',
      fullLabel: '⚪ Waitlisted',
      badgeVariant: 'info',
      colorClasses: {
        bg: 'bg-slate-900/80',
        border: 'border-slate-700',
        text: 'text-slate-300',
        badgeBg: 'bg-slate-800',
        badgeText: 'text-slate-300',
        badgeBorder: 'border-slate-600',
      },
      description: `Waitlist Position #${pos}. Regular tournament slots are currently full. You will be automatically promoted if a slot opens!`,
    };
  }

  // 4. Registration Confirmed
  const isFreeTournament = tournament && (!tournament.payment_enabled || (tournament.registration_fee || 0) === 0);
  const isPaidAndVerified = payStatus === 'SUCCESSFUL';

  if ((regStatus === 'CONFIRMED' || regStatus === 'SUCCESSFUL') && (isPaidAndVerified || isFreeTournament)) {
    return {
      key: 'CONFIRMED',
      label: 'Registration Confirmed',
      emoji: '🟢',
      fullLabel: '🟢 Registration Confirmed',
      badgeVariant: 'success',
      colorClasses: {
        bg: 'bg-emerald-950/40',
        border: 'border-emerald-500/50',
        text: 'text-emerald-300',
        badgeBg: 'bg-emerald-950/80',
        badgeText: 'text-emerald-300',
        badgeBorder: 'border-emerald-500/50',
      },
      description: 'Your slot and payment are verified and confirmed! You are officially registered for the tournament.',
    };
  }

  // 5. Payment Verification Pending (Default for all other active states)
  return {
    key: 'PAYMENT_PENDING',
    label: 'Payment Verification Pending',
    emoji: '🟡',
    fullLabel: '🟡 Payment Verification Pending',
    badgeVariant: 'warning',
    colorClasses: {
      bg: 'bg-yellow-950/30',
      border: 'border-yellow-500/50',
      text: 'text-yellow-300',
      badgeBg: 'bg-yellow-950/80',
      badgeText: 'text-yellow-300',
      badgeBorder: 'border-yellow-500/50',
    },
    description: 'Your registration has been submitted and is currently awaiting Admin payment review.',
  };
}
