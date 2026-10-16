import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/is-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
    const supabase = createAdminClient();

    // Execute queries in parallel for high performance
    const [
      { data: tournaments, error: tourneyErr },
      { data: registrations, error: registrationsErr },
      { data: payments, error: paymentsErr },
      { data: teamOwners, error: ownersErr },
    ] = await Promise.all([
      supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
      supabase.from('registrations').select('id, tournament_id, registration_status, status'),
      supabase.from('payments').select('id, amount, payment_status, registration_id'),
      supabase.from('team_owners').select('id, tournament_id, status, payment_status'),
    ]);

    if (tourneyErr) throw tourneyErr;
    if (registrationsErr) throw registrationsErr;
    if (paymentsErr) throw paymentsErr;
    if (ownersErr) throw ownersErr;

    const allTournaments = tournaments || [];
    const allRegistrations = registrations || [];
    const allPayments = payments || [];
    const allOwners = teamOwners || [];

    type TournamentStats = {
      totalRegistered: number;
      confirmedCount: number;
      waitlistCount: number;
      successfulPayments: number;
      pendingPayments: number;
      revenuePaise: number;
      ownerCount: number;
      pendingOwners: number;
    };

    const statsByTournament = new Map<string, TournamentStats>(
      allTournaments.map((t) => [
        t.id,
        {
          totalRegistered: 0,
          confirmedCount: 0,
          waitlistCount: 0,
          successfulPayments: 0,
          pendingPayments: 0,
          revenuePaise: 0,
          ownerCount: 0,
          pendingOwners: 0,
        },
      ])
    );
    const tournamentByRegistration = new Map<string, string>();

    for (const registration of allRegistrations) {
      const stats = statsByTournament.get(registration.tournament_id);
      if (!stats) continue;

      stats.totalRegistered++;
      if (registration.registration_status === 'CONFIRMED' || registration.status === 'CONFIRMED') {
        stats.confirmedCount++;
      }
      if (registration.registration_status === 'WAITING_LIST' || registration.status === 'WAITING_LIST') {
        stats.waitlistCount++;
      }
      tournamentByRegistration.set(registration.id, registration.tournament_id);
    }

    let totalSuccessfulPayments = 0;
    let totalRevenuePaise = 0;
    const firstPaymentByRegistration = new Map<string, (typeof allPayments)[number]>();

    for (const payment of allPayments) {
      if (payment.registration_id && !firstPaymentByRegistration.has(payment.registration_id)) {
        firstPaymentByRegistration.set(payment.registration_id, payment);
      }

      if (payment.payment_status !== 'SUCCESSFUL') continue;

      totalSuccessfulPayments++;
      totalRevenuePaise += payment.amount || 0;

      const tournamentId = tournamentByRegistration.get(payment.registration_id);
      const stats = tournamentId ? statsByTournament.get(tournamentId) : undefined;
      if (stats) {
        stats.successfulPayments++;
        stats.revenuePaise += payment.amount || 0;
      }
    }

    const seenPendingPaymentIds = new Map<string, Set<string>>();
    for (const registration of allRegistrations) {
      const stats = statsByTournament.get(registration.tournament_id);
      if (!stats) continue;

      const payment = firstPaymentByRegistration.get(registration.id);
      const paymentStatus = payment?.payment_status || 'PENDING';
      const registrationStatus = registration.registration_status || registration.status;

      if (
        paymentStatus === 'SUCCESSFUL' ||
        paymentStatus === 'CANCELLED' ||
        paymentStatus === 'REJECTED' ||
        registrationStatus === 'CANCELLED' ||
        registrationStatus === 'REJECTED'
      ) {
        continue;
      }

      if (
        paymentStatus !== 'PENDING' &&
        paymentStatus !== 'VERIFICATION_REQUIRED' &&
        paymentStatus !== 'AWAITING_ORGANISER_ACKNOWLEDGEMENT'
      ) {
        continue;
      }

      if (payment?.id) {
        let seenIds = seenPendingPaymentIds.get(registration.tournament_id);
        if (!seenIds) {
          seenIds = new Set<string>();
          seenPendingPaymentIds.set(registration.tournament_id, seenIds);
        }
        if (seenIds.has(payment.id)) continue;
        seenIds.add(payment.id);
      }

      stats.pendingPayments++;
    }

    for (const owner of allOwners) {
      const stats = statsByTournament.get(owner.tournament_id);
      if (!stats) continue;
      stats.ownerCount++;
      if (owner.status === 'PENDING') stats.pendingOwners++;
    }

    const tournamentSummaries = allTournaments.map((t) => {
      const stats = statsByTournament.get(t.id)!;
      const maxTeams = t.max_teams || 8;

      return {
        ...t,
        banner_url: t.banner_url?.startsWith('data:image/') ? '/logo.png' : t.banner_url,
        payment_qr_url: t.payment_qr_url?.startsWith('data:image/') ? '/images/qr/titusalex786.png' : t.payment_qr_url,
        stats: {
          ...stats,
          availableSlots: Math.max(0, (t.max_players || 100) - stats.confirmedCount),
          ownerSlotsUsed: stats.ownerCount,
          ownerSlotsTotal: maxTeams,
          ownerSlotsRemaining: Math.max(0, maxTeams - stats.ownerCount),
        },
      };
    });

    const totalPendingPayments = [...statsByTournament.values()].reduce(
      (sum, stats) => sum + stats.pendingPayments,
      0
    );

    return NextResponse.json({
      tournaments: tournamentSummaries,
      globalStats: {
        totalRegisteredPlayers: allRegistrations.length,
        totalSuccessfulPayments,
        totalPendingPayments,
        totalRevenuePaise,
      },
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status });
  }
}
