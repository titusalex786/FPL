import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireManager } from '@/lib/auth/is-manager';
import { resolveImageUrl } from '@/lib/storage/upload';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { user, isAdmin, role } = await requireManager();
    const { id: tournamentId } = await params;
    const supabase = createAdminClient();

    // 1. Concurrently fetch independent initial data: Tournament, Registrations, and Team Owners
    const [tourneyRes, regRes, ownersRes] = await Promise.all([
      supabase
        .from('tournaments')
        .select('*')
        .eq('id', tournamentId)
        .single(),
      supabase
        .from('registrations')
        .select(`
          id,
          tournament_id,
          player_id,
          registration_number,
          status,
          registration_status,
          registration_type,
          team_name,
          team_owner_id,
          waitlist_position,
          registered_name_snapshot,
          registered_role_snapshot,
          registered_batting_style_snapshot,
          registered_jersey_size_snapshot,
          registered_at,
          players (
            id,
            full_name,
            email
          )
        `)
        .eq('tournament_id', tournamentId)
        .order('registered_at', { ascending: true }),
      supabase
        .from('team_owners')
        .select('*')
        .eq('tournament_id', tournamentId)
        .order('slot_number', { ascending: true }),
    ]);

    const tournament = tourneyRes.data;
    if (tourneyRes.error || !tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    let registrations: any[] = [];
    if (regRes.error) {
      const { data: fbData } = await supabase
        .from('registrations')
        .select(`
          id,
          tournament_id,
          player_id,
          registration_number,
          registration_status,
          waitlist_position,
          registered_name_snapshot,
          registered_role_snapshot,
          registered_at
        `)
        .eq('tournament_id', tournamentId)
        .order('registered_at', { ascending: true });
      registrations = (fbData || []).map((r: any) => ({
        ...r,
        status: r.registration_status,
        registration_type: 'PLAYER',
        registered_image_snapshot: '/logo.png',
      }));
    } else {
      registrations = regRes.data || [];
    }

    // 2. Fetch payments for registrations in this tournament
    const regIds = registrations.map((r: any) => r.id);
    let payments: any[] = [];
    if (regIds.length > 0) {
      const { data: pData } = await supabase
        .from('payments')
        .select(`
          id,
          registration_id,
          team_owner_id,
          amount,
          payment_method,
          payment_status,
          payment_screenshot_url,
          screenshot_object_path,
          screenshot_bucket,
          transaction_reference,
          verification_note,
          verified_by,
          verified_at,
          created_at
        `)
        .in('registration_id', regIds);
      payments = pData || [];
    }

    // Fast in-memory map without blocking signed URL API loop
    const enrichedPayments = payments.map((p: any) => ({
      ...p,
      payment_screenshot_url: p.payment_screenshot_url || p.screenshot_object_path || '',
    }));

    // 3. Process Team Owners if OWNER_BASED
    let teamOwners: any[] = [];
    if (tournament.tournament_type === 'OWNER_BASED') {
      const ownersData = ownersRes.data || [];
      teamOwners = ownersData.map((o: any) => {
        const matchingPayment = enrichedPayments.find((p: any) => p.team_owner_id === o.id || p.registration_id === o.owner_registration_id);
        const ownerScreenshotUrl = matchingPayment?.payment_screenshot_url || o.payment_screenshot_url || '';
        return {
          ...o,
          team_logo_url: resolveImageUrl(o.team_logo_url, 'team-logos', '/logo.png'),
          payment_screenshot_url: ownerScreenshotUrl,
        };
      });
    }

    // Combine registrations with payments (match direct registration_id OR team_owner_id for Icon registrations)
    const enrichedRegistrations = registrations.map((r: any) => {
      const payment = enrichedPayments.find(
        (p: any) => p.registration_id === r.id || (r.team_owner_id && p.team_owner_id === r.team_owner_id)
      ) || null;
      const effectiveStatus = r.registration_status || r.status || 'PENDING';
      return {
        ...r,
        registered_image_snapshot: '/logo.png',
        registration_status: effectiveStatus,
        status: effectiveStatus,
        payment,
      };
    });

    const isConfirmedReg = (r: any) => r.registration_status === 'CONFIRMED' || r.status === 'CONFIRMED';
    const isPendingReg = (r: any) => r.registration_status === 'PENDING' || r.status === 'PENDING';
    const isWaitlistReg = (r: any) => r.registration_status === 'WAITING_LIST' || r.status === 'WAITING_LIST';

    const confirmedPlayersCount = enrichedRegistrations.filter(isConfirmedReg).length;
    const pendingCount = enrichedRegistrations.filter(isPendingReg).length;
    const waitlistCount = enrichedRegistrations.filter(isWaitlistReg).length;
    const ownerRegistrationsCount = enrichedRegistrations.filter((r: any) => r.registration_type === 'OWNER').length;
    const iconRegistrationsCount = enrichedRegistrations.filter((r: any) => r.registration_type === 'ICON').length;
    const standardPlayersCount = enrichedRegistrations.filter((r: any) => r.registration_type === 'PLAYER' || !r.registration_type).length;

    const successfulPayments = payments.filter((p: any) => p.payment_status === 'SUCCESSFUL').length;
    
    // Server-side construction of the verification queue
    const pendingApprovals: any[] = [];
    const seenPayments = new Set();

    for (const r of enrichedRegistrations) {
      const pStatus = r.payment?.payment_status;
      const rStatus = r.registration_status || r.status;

      // Exclude terminal / verified states
      if (pStatus === 'SUCCESSFUL' || pStatus === 'CANCELLED' || pStatus === 'REJECTED') {
        continue;
      }
      if (rStatus === 'CANCELLED' || rStatus === 'REJECTED') {
        continue;
      }

      // Check if payment needs verification
      if (
        pStatus === 'PENDING' ||
        pStatus === 'VERIFICATION_REQUIRED' ||
        pStatus === 'AWAITING_ORGANISER_ACKNOWLEDGEMENT'
      ) {
        // Deduplicate by payment ID to avoid showing Owner/Icon duplicates
        if (r.payment?.id) {
          if (seenPayments.has(r.payment.id)) continue;
          seenPayments.add(r.payment.id);
        }
        pendingApprovals.push(r);
      }
    }
    
    const pendingPayments = pendingApprovals.length;

    const maxTeams = tournament.max_teams || 8;

    return NextResponse.json({
      tournament,
      registrations: enrichedRegistrations,
      pendingApprovals,
      teamOwners,
      role,
      isAdmin,
      stats: {
        totalRegistered: enrichedRegistrations.length,
        confirmedCount: confirmedPlayersCount,
        pendingCount,
        waitlistCount,
        availableSlots: Math.max(0, tournament.max_players - confirmedPlayersCount),
        ownerRegistrationsCount,
        iconRegistrationsCount,
        standardPlayersCount,
        ownerSlotsUsed: teamOwners.length,
        ownerSlotsTotal: maxTeams,
        ownerSlotsRemaining: Math.max(0, maxTeams - teamOwners.length),
        successfulPayments,
        pendingPayments,
      },
    });
  } catch (err: any) {
    const status = err.message?.includes('Unauthorized') ? 403 : 500;
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status });
  }
}
