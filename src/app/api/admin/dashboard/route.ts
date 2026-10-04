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
      { data: registrations },
      { data: payments },
      { data: teamOwners },
    ] = await Promise.all([
      supabase.from('tournaments').select('*').order('created_at', { ascending: false }),
      supabase.from('registrations').select('id, tournament_id, registration_status, status'),
      supabase.from('payments').select('id, amount, payment_status, registration_id'),
      supabase.from('team_owners').select('id, tournament_id, status, payment_status'),
    ]);

    if (tourneyErr) throw tourneyErr;

    const tournamentSummaries = (tournaments || []).map((t) => {
      const tRegs = (registrations || []).filter((r) => r.tournament_id === t.id);
      const confirmedCount = tRegs.filter((r) => r.registration_status === 'CONFIRMED' || r.status === 'CONFIRMED').length;
      const waitlistCount = tRegs.filter((r) => r.registration_status === 'WAITING_LIST' || r.status === 'WAITING_LIST').length;

      const tRegIds = new Set(tRegs.map((r) => r.id));
      const tPayments = (payments || []).filter((p) => tRegIds.has(p.registration_id));
      const successfulPayments = tPayments.filter((p) => p.payment_status === 'SUCCESSFUL').length;

      // Canonical Payment Verification Queue Count:
      // Includes registrations whose payment needs admin review (PENDING, VERIFICATION_REQUIRED,
      // AWAITING_ORGANISER_ACKNOWLEDGEMENT, or missing payment row as effective PENDING),
      // excluding cancelled/rejected registrations, deduplicated by payment ID.
      const seenPayments = new Set<string>();
      let pendingPayments = 0;

      for (const r of tRegs) {
        const p = (payments || []).find((pay) => pay.registration_id === r.id);
        const pStatus = p?.payment_status || 'PENDING';
        const rStatus = r.registration_status || r.status;

        if (pStatus === 'SUCCESSFUL' || pStatus === 'CANCELLED' || pStatus === 'REJECTED') continue;
        if (rStatus === 'CANCELLED' || rStatus === 'REJECTED') continue;

        const needsVerification =
          pStatus === 'PENDING' ||
          pStatus === 'VERIFICATION_REQUIRED' ||
          pStatus === 'AWAITING_ORGANISER_ACKNOWLEDGEMENT';

        if (needsVerification) {
          if (p?.id) {
            if (seenPayments.has(p.id)) continue;
            seenPayments.add(p.id);
          }
          pendingPayments++;
        }
      }

      const revenuePaise = tPayments
        .filter((p) => p.payment_status === 'SUCCESSFUL')
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      const tOwners = (teamOwners || []).filter((o) => o.tournament_id === t.id);
      const ownerCount = tOwners.length;
      const pendingOwners = tOwners.filter((o) => o.status === 'PENDING').length;
      const maxTeams = t.max_teams || 8;

      return {
        ...t,
        banner_url: t.banner_url?.startsWith('data:image/') ? '/logo.png' : t.banner_url,
        payment_qr_url: t.payment_qr_url?.startsWith('data:image/') ? '/images/qr/titusalex786.png' : t.payment_qr_url,
        stats: {
          totalRegistered: tRegs.length,
          confirmedCount,
          waitlistCount,
          availableSlots: Math.max(0, (t.max_players || 100) - confirmedCount),
          successfulPayments,
          pendingPayments,
          revenuePaise,
          ownerCount,
          pendingOwners,
          ownerSlotsUsed: ownerCount,
          ownerSlotsTotal: maxTeams,
          ownerSlotsRemaining: Math.max(0, maxTeams - ownerCount),
        },
      };
    });

    const totalRegisteredPlayers = registrations?.length || 0;
    const totalSuccessfulPayments = payments?.filter((p) => p.payment_status === 'SUCCESSFUL').length || 0;
    const totalPendingPayments = tournamentSummaries.reduce((sum, t) => sum + (t.stats?.pendingPayments || 0), 0);
    const totalRevenuePaise = payments
      ?.filter((p) => p.payment_status === 'SUCCESSFUL')
      .reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

    return NextResponse.json({
      tournaments: tournamentSummaries,
      globalStats: {
        totalRegisteredPlayers,
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
